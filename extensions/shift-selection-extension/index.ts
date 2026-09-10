/**
 * pi extension: Shift+Home / Shift+End text selection with delete for the main input editor.
 *
 * Load with: pi --extension ./shift-selection-extension.ts
 *
 * Behavior contract:
 *   - shift+home — set/extend the selection anchor at the cursor, move cursor to line start
 *   - shift+end  — set/extend the selection anchor at the cursor, move cursor to line end
 *   - alt+a     — select all text (ctrl+a keeps its native "cursor to line start"; in iTerm2
 *                  make sure Left Option Key is set to "Esc+" so option+a sends alt+a)
 *   - backspace / delete / printable character — replace the active selection, then behave
 *     normally (a printable character still inserts itself after the splice)
 *   - any other key (arrows, home/end, pageUp/Down, up/down, enter, app shortcuts) — collapse
 *     the selection first, then behave normally; submit never deletes the selection
 *   - ctrl+- (tui.editor.undo) reverts a selection delete in one step, restoring text AND cursor
 *   - visual feedback: reverse-video highlight of the selected span plus a bottom-border hint
 *     ("N chars selected - Del deletes - Alt+a select all")
 *
 * Debug tap: set PI_SHIFT_SELECTION_DEBUG to a writable file path and every key is appended
 * there with its raw bytes and the branch taken. Diagnoses terminals that send nothing for
 * shift+home/end (e.g. iTerm2 default profile — map them to "Send Escape Sequence" [1;2H
 * and [1;2F in Profiles > Keys > Key Mappings). Off by default; never throws into editing.
 *
 * Version coupling: accesses private TUI Editor internals (state, undo snapshot, line-edge
 * movement, visual-line map, autocomplete controls) through one cast view, and imports
 * decodePrintableKey via the deep path @earendil-works/pi-tui/dist/keys.js (pi-tui has no
 * exports map, so deep dist imports resolve). Written and verified against pi 0.85.1 —
 * re-verify these internals when upgrading pi.
 */

import { appendFileSync } from "node:fs";
import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { decodePrintableKey } from "./keys.js";

/** Cursor/anchor position in logical (line, col) editor coordinates. */
interface Point {
	line: number;
	col: number;
}

/**
 * Narrow view of the private Editor internals this extension relies on. Kept in one place so
 * a pi upgrade only needs re-verifying against this interface.
 */
interface EditorInternals {
	state: { lines: string[]; cursorLine: number; cursorCol: number };
	paddingX: number;
	scrollOffset: number;
	renderedVisibleLineCount: number;
	autocompleteState: "regular" | "force" | null;
	lastAction: "kill" | "yank" | "type-word" | null;
	pushUndoSnapshot(): void;
	setCursorCol(col: number): void;
	moveToLineStart(): void;
	moveToLineEnd(): void;
	exitHistoryBrowsing(): void;
	cancelAutocomplete(): void;
	updateAutocomplete(): void;
	buildVisualLineMap(width: number): Array<{ logicalLine: number; startCol: number; length: number }>;
}

function clamp(value: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, value));
}

/** One debug-tap line per key when PI_SHIFT_SELECTION_DEBUG points to a file. Never throws. */
function debugKey(data: string, note: string): void {
	const path = process.env.PI_SHIFT_SELECTION_DEBUG;
	if (!path) return;
	try {
		appendFileSync(path, `${new Date().toISOString()} ${JSON.stringify(data)} ${note}\n`);
	} catch {
		/* debugging must never break editing */
	}
}

/**
 * Wrap the code-unit span [startCu, endCu) of a rendered editor row in reverse video.
 *
 * Positions are code-unit offsets into the row's PLAIN text (same unit the editor uses for
 * cursorCol and visual-line map columns), so no display-width math is needed. The rendered
 * row may already contain escape sequences (SGR colors, the APC CURSOR_MARKER); the walk
 * passes those through untouched, which keeps the code-unit count aligned with the text.
 */
function withReverseSpan(row: string, startCu: number, endCu: number): string {
	let out = "";
	let cu = 0;
	let i = 0;
	let opened = false;
	while (i < row.length) {
		if (!opened && cu >= startCu) {
			out += "\x1b[7m";
			opened = true;
		}
		if (opened && cu >= endCu) {
			return `${out}\x1b[0m${row.slice(i)}`;
		}
		if (row[i] === "\x1b") {
			const seq = escapeSequenceLength(row, i);
			const chunk = row.slice(i, i + seq);
			out += chunk;
			// A nested SGR reset (e.g. the cursor block's own, when the cursor sits inside the
			// span) clears reverse for everything after it: re-arm reverse right after it.
			if (opened && cu < endCu && isSgrReset(chunk)) out += "\x1b[7m";
			i += seq;
			continue;
		}
		out += row[i];
		i += 1;
		cu += 1;
	}
	return opened ? `${out}\x1b[0m` : out;
}

/** Length of the escape sequence at s[i] (s[i] === ESC). Unterminated sequences end the row. */
function escapeSequenceLength(s: string, i: number): number {
	const next = s[i + 1];
	if (next === "[") {
		// CSI: parameter/intermediate bytes 0x20-0x3F, final byte 0x40-0x7E.
		for (let j = i + 2; j < s.length; j++) {
			const code = s.charCodeAt(j);
			if (code >= 0x40 && code <= 0x7e) return j - i + 1;
		}
		return s.length - i;
	}
	if (next === "]" || next === "_") {
		// OSC / APC (CURSOR_MARKER is APC): terminated by BEL or ST (ESC \).
		const bel = s.indexOf("\x07", i + 2);
		const st = s.indexOf("\x1b\\", i + 2);
		if (bel === -1 && st === -1) return s.length - i;
		if (bel === -1) return st - i + 2;
		if (st === -1) return bel - i + 1;
		return Math.min(bel - i + 1, st - i + 2);
	}
	return 2;
}

/** True for SGR reset sequences ("\x1b[0m", "\x1b[m"). */
function isSgrReset(seq: string): boolean {
	return /^\x1b\[0?m$/.test(seq);
}

export class SelectingEditor extends CustomEditor {
	private anchor: Point | null = null;

	private get internals(): EditorInternals {
		return this as unknown as EditorInternals;
	}

	private get s(): EditorInternals["state"] {
		return this.internals.state;
	}

	private cursor(): Point {
		return { line: this.s.cursorLine, col: this.s.cursorCol };
	}

	private setCursor(p: Point): void {
		this.s.cursorLine = p.line;
		this.internals.setCursorCol(p.col);
	}

	/**
	 * Ordered (start, end) selection range, or null when no anchor is set. Pure: collapse
	 * decisions belong to the key handlers (no-op press → collapse), not to this read.
	 */
	private range(): [Point, Point] | null {
		if (!this.anchor) return null;
		const a = this.anchor;
		const c = this.cursor();
		const anchorFirst = a.line < c.line || (a.line === c.line && a.col < c.col);
		return anchorFirst ? [a, c] : [c, a];
	}

	/** Number of characters covered by the active selection (0 when none). */
	private selectionLength(): number {
		const range = this.range();
		if (!range) return 0;
		const [start, end] = range;
		const lines = this.s.lines;
		if (start.line === end.line) return end.col - start.col;
		let n = (lines[start.line] ?? "").length - start.col;
		for (let i = start.line + 1; i < end.line; i++) n += (lines[i] ?? "").length;
		return n + end.col;
	}

	override handleInput(data: string): void {
		if (matchesKey(data, "shift+home")) {
			debugKey(data, "-> shift+home");
			this.selectToLineEdge(false);
			return;
		}
		if (matchesKey(data, "shift+end")) {
			debugKey(data, "-> shift+end");
			this.selectToLineEdge(true);
			return;
		}
		if (matchesKey(data, "alt+a")) {
			debugKey(data, "-> select all");
			this.selectAll();
			return;
		}

		if (this.anchor) {
			if (this.isReplaceKey(data)) {
				const deleted = this.deleteSelection();
				debugKey(data, deleted ? "-> replace selection" : "-> empty selection, native");
				if (!deleted) {
					// Selection collapsed to empty (anchor met cursor): native key behavior.
					this.anchor = null;
					super.handleInput(data);
					return;
				}
				// A printable key still inserts its character at the new cursor position.
				if (this.insertsCharacter(data)) super.handleInput(data);
				return;
			}
			// Movement, enter, history, kill/yank, app shortcuts: collapse first, then normal behavior.
			this.anchor = null;
			debugKey(data, "-> collapse, native");
		} else {
			debugKey(data, "-> native");
		}

		super.handleInput(data);
	}

	/** Keys whose native effect replaces a selection: backspace/delete (and shift variants) or a printable character. */
	private isReplaceKey(data: string): boolean {
		return (
			matchesKey(data, "backspace") ||
			matchesKey(data, "shift+backspace") ||
			matchesKey(data, "delete") ||
			matchesKey(data, "shift+delete") ||
			this.insertsCharacter(data)
		);
	}

	/** True when the input inserts a text character (Kitty/CSI-u and modify-other-keys aware). */
	private insertsCharacter(data: string): boolean {
		if (decodePrintableKey(data) !== undefined) return true;
		// Plain-byte fallback. DEL (0x7f) and C1 controls (0x80-0x9f) must NOT count as
		// printable: the editor routes them to delete/other actions before its own
		// printable fallback, so re-submitting them after a splice would double-edit.
		if (data.length !== 1) return false;
		const c = data.charCodeAt(0);
		return c >= 32 && c < 127;
	}

	private selectToLineEdge(toEnd: boolean): void {
		const before = this.cursor();
		if (toEnd) this.internals.moveToLineEnd();
		else this.internals.moveToLineStart();
		this.internals.exitHistoryBrowsing();
		if (before.line === this.s.cursorLine && before.col === this.s.cursorCol) {
			// No-op press (already at that edge): nothing to select; a repeated press collapses.
			this.anchor = null;
		} else {
			this.anchor ??= before;
			// Endpoints met (cursor landed exactly on the anchor): the span is empty.
			if (this.anchor.line === this.s.cursorLine && this.anchor.col === this.s.cursorCol) {
				this.anchor = null;
			}
		}
		if (this.internals.autocompleteState) this.internals.updateAutocomplete();
		this.tui.requestRender();
	}

	/** Splice out the active selection. Returns false when there was nothing to delete. */
	/** Select the entire editor text (ctrl+a). Cursor moves to the end of the last line. */
	private selectAll(): void {
		const lines = this.s.lines;
		const lastLine = Math.max(0, lines.length - 1);
		this.anchor = { line: 0, col: 0 };
		this.s.cursorLine = lastLine;
		this.internals.setCursorCol((lines[lastLine] ?? "").length);
		this.internals.lastAction = null;
		this.internals.exitHistoryBrowsing();
		if (this.internals.autocompleteState) this.internals.cancelAutocomplete();
		this.tui.requestRender();
	}

	private deleteSelection(): boolean {
		const range = this.range();
		if (!range) return false;
		const [start, end] = range;
		if (start.line === end.line && start.col === end.col) return false;
		const internals = this.internals;
		const lines = internals.state.lines;
		// Clone-on-push snapshot: exactly one undo step restores text AND cursor.
		internals.pushUndoSnapshot();
		const merged = (lines[start.line] ?? "").slice(0, start.col) + (lines[end.line] ?? "").slice(end.col);
		lines.splice(start.line, end.line - start.line + 1, merged);
		this.anchor = null;
		this.setCursor(start);
		internals.lastAction = null;
		if (internals.autocompleteState) internals.cancelAutocomplete();
		this.onChange?.(this.getText());
		this.tui.requestRender();
		return true;
	}

	override render(width: number): string[] {
		const rows = super.render(width);
		const range = this.range();
		if (!range) return rows;
		const internals = this.internals;
		const [start, end] = range;
		// Mirror the base render() geometry so buildVisualLineMap matches the displayed wrap.
		const contentWidth = Math.max(1, width - internals.paddingX * 2);
		const layoutWidth = Math.max(1, contentWidth - (internals.paddingX ? 0 : 1));
		const visual = internals.buildVisualLineMap(layoutWidth);
		for (let r = 0; r < internals.renderedVisibleLineCount; r++) {
			const vr = visual[internals.scrollOffset + r];
			if (!vr || vr.logicalLine < start.line || vr.logicalLine > end.line) continue;
			const from =
				clamp(vr.logicalLine === start.line ? start.col - vr.startCol : 0, 0, vr.length) + internals.paddingX;
			const to =
				clamp(vr.logicalLine === end.line ? end.col - vr.startCol : vr.length, 0, vr.length) + internals.paddingX;
			if (to <= from) continue;
			const index = 1 + r; // rows[0] is the top border
			if (index < rows.length) rows[index] = withReverseSpan(rows[index] ?? "", from, to);
		}
		return rows;
	}

	override renderBottomBorder(width: number, hiddenLineCount: number): string {
		const base = super.renderBottomBorder(width, hiddenLineCount);
		const n = this.selectionLength();
		if (n <= 0) return base;
		const label = ` ${n} char${n === 1 ? "" : "s"} selected - Del deletes - Alt+a select all `;
		const labelWidth = visibleWidth(label);
		if (labelWidth + 1 >= width) return base;
		return truncateToWidth(base, width - labelWidth, "") + label;
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setEditorComponent((tui, theme, kb) => new SelectingEditor(tui, theme, kb));
	});
}
