/**
 * Frontmatter routing keys for discovered agent definitions.
 *
 * Model routing is persisted as `model:`/`thinking:` keys inside each agent's
 * YAML frontmatter, so any writer has to place those keys without breaking the
 * frontmatter it edits.
 *
 * The one non-obvious case is a block scalar description:
 *
 * ```yaml
 * description: >
 *   The agent summary continues on indented lines.
 * ```
 *
 * A block scalar owns every following blank or indented line. Appending a
 * routing key immediately after `description:` terminates the block early, so
 * the description parses as empty and the summary text is folded into the
 * routing value, producing a garbage model id. Insert routing keys after the
 * block scalar's continuation lines instead.
 */

const FRONTMATTER_DELIMITER = "---\n";
const DESCRIPTION_KEY = "description:";
const ROUTING_KEY_PATTERN = /^(?:model|thinking):/;
const BLOCK_SCALAR_DESCRIPTION_PATTERN = /^description:\s*[>|][0-9+-]*\s*$/;

/**
 * Index at which routing keys belong: right after a scalar `description:`
 * value, or after every continuation line of a block scalar description.
 */
function routingInsertIndex(lines: readonly string[]): number {
	const descriptionIndex = lines.findIndex((line) =>
		line.startsWith(DESCRIPTION_KEY),
	);
	if (descriptionIndex < 0) return Math.min(1, lines.length);
	if (!BLOCK_SCALAR_DESCRIPTION_PATTERN.test(lines[descriptionIndex])) {
		return descriptionIndex + 1;
	}
	let insertIndex = descriptionIndex + 1;
	for (let index = insertIndex; index < lines.length; index += 1) {
		const line = lines[index];
		if (line.startsWith(" ") || line.startsWith("\t") || line.trim() === "") {
			insertIndex = index + 1;
			continue;
		}
		break;
	}
	return insertIndex;
}

/**
 * Replace every existing `model:`/`thinking:` key with `routingLines`.
 *
 * Content without a leading frontmatter block is returned unchanged. Passing an
 * empty `routingLines` only strips existing routing keys, which is how callers
 * compare an agent definition against its packaged form.
 */
export function upsertAgentFrontmatterRouting(
	content: string,
	routingLines: readonly string[],
): string {
	if (!content.startsWith(FRONTMATTER_DELIMITER)) return content;
	const endIndex = content.indexOf("\n---", 4);
	if (endIndex === -1) return content;
	const frontmatter = content.slice(4, endIndex);
	const body = content.slice(endIndex);
	const lines = frontmatter
		.split("\n")
		.filter((line) => !ROUTING_KEY_PATTERN.test(line));
	if (routingLines.length > 0) {
		lines.splice(routingInsertIndex(lines), 0, ...routingLines);
	}
	return `${FRONTMATTER_DELIMITER}${lines.join("\n")}${body}`;
}
