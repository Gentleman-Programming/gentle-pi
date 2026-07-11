import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { domainHashV1 } from "./review-canonical.ts";
import { resolveRepositoryAuthorityForRecoveryV1, resolveRepositoryAuthorityV1, type RepositoryAuthorityV1 } from "./review-repository.ts";
import { ReviewGraphObjectStoreV1 } from "./review-object-store.ts";

export type LegacyDetectionOutcomeV1 = "clean" | "blocked-legacy" | "blocked-mixed" | "reset-in-progress" | "blocked-reappeared" | "blocked-ambiguous";
export interface LegacyInventoryEntryV1 { relative_path: string; kind: "file" | "directory" | "other"; size: number; modified_time: string; }
export interface LegacyInspectionOptionsV1 {
	// RESL2-001 recovery hook: use the lenient, non-fail-closed authority
	// resolver so a broken pinned-identity subset can be detected and
	// reported instead of throwing before inspection can run. See
	// `resolveRepositoryAuthorityForRecoveryV1` in review-repository.ts.
	allowBrokenIdentity?: boolean;
}
export interface LegacyInspectionV1 {
	outcome: LegacyDetectionOutcomeV1;
	repository_id: string;
	common_directory: string;
	common_directory_hash: string;
	entries: readonly LegacyInventoryEntryV1[];
	legacy_inventory_hash: string;
	invalidated_classes: readonly string[];
	reset_request: { repositoryId: string; commonDirHash: string; inventoryHash: string; confirmation: string; };
	identity_broken: boolean;
}

const LEGACY_ROOTS = ["lineages", "locks", "legacy-evidence", "migration", "migration-operations"] as const;
const INVALIDATED = ["receipts", "approvals", "escalations", "ledgers", "findings", "frozen-hashes", "lineages", "journals", "counters", "gate-evidence", "graph-v1-authority", "compact-v2-authority"] as const;

function inventoryPath(root: string, path: string, result: LegacyInventoryEntryV1[]): void {
	const stat = lstatSync(path);
	const kind = stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "other";
	result.push({ relative_path: relative(root, path), kind, size: stat.size, modified_time: stat.mtime.toISOString() });
	if (stat.isDirectory()) for (const name of readdirSync(path).toSorted()) inventoryPath(root, join(path, name), result);
}

export function inspectLegacyReviewAuthorityV1(cwd: string, options: LegacyInspectionOptionsV1 = {}): LegacyInspectionV1 {
	const authority = options.allowBrokenIdentity ? resolveRepositoryAuthorityForRecoveryV1(cwd) : resolveRepositoryAuthorityV1(cwd);
	const entries: LegacyInventoryEntryV1[] = [];
	try {
		for (const name of LEGACY_ROOTS) { const path = join(authority.store_root, name); if (existsSync(path)) inventoryPath(authority.store_root, path, entries); }
	} catch { return blocked(authority, entries, "blocked-ambiguous"); }
	const legacyEntryCount = entries.length;
	let versionAmbiguity = false;
	try {
		const graphRoot = join(authority.store_root, "graph-v1");
		const compactRoot = join(authority.store_root, "compact-v2");
		if (existsSync(graphRoot) && existsSync(compactRoot)) {
			const graph = new ReviewGraphObjectStoreV1(graphRoot, authority.repository_id, authority.authority_id);
			const graphIds = new Set((graph.readCurrent().body.lineages as Array<Record<string, unknown>>).map((entry) => String(entry.lineage_id)));
			const compactIds = readdirSync(compactRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
			versionAmbiguity = compactIds.some((id) => graphIds.has(id));
			if (versionAmbiguity) {
				inventoryPath(authority.store_root, graphRoot, entries);
				inventoryPath(authority.store_root, compactRoot, entries);
			}
		}
	} catch { return blocked(authority, entries, "blocked-ambiguous"); }
	entries.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
	const resetPath = join(authority.store_root, "control", "reset-state.json");
	let resetPhase: string | undefined;
	if (existsSync(resetPath)) { try { resetPhase = String((JSON.parse(readFileSync(resetPath, "utf8")) as { body?: { phase?: unknown } }).body?.phase); } catch { return blocked(authority, entries, "blocked-ambiguous"); } }
	const graphOrCompact = existsSync(join(authority.store_root, "graph-v1")) || existsSync(join(authority.store_root, "compact-v2"));
	if (resetPhase && resetPhase !== "complete") return blocked(authority, entries, "reset-in-progress");
	if (legacyEntryCount > 0 && resetPhase === "complete") return blocked(authority, entries, "blocked-reappeared");
	if (versionAmbiguity) return blocked(authority, entries, "blocked-mixed");
	return blocked(authority, entries, legacyEntryCount === 0 ? "clean" : graphOrCompact ? "blocked-mixed" : "blocked-legacy");
}

function blocked(authority: RepositoryAuthorityV1 & { identity_broken?: boolean }, entries: readonly LegacyInventoryEntryV1[], outcome: LegacyDetectionOutcomeV1): LegacyInspectionV1 {
	const common_directory_hash = domainHashV1("common-directory", authority.common_directory);
	const legacy_inventory_hash = domainHashV1("legacy-inventory", { repository_id: authority.repository_id, common_directory_hash, entries, invalidated_classes: INVALIDATED });
	const confirmation = `DESTROY REVIEW AUTHORITY ${authority.repository_id} AT ${common_directory_hash} INVENTORY ${legacy_inventory_hash}`;
	return { outcome, repository_id: authority.repository_id, common_directory: authority.common_directory, common_directory_hash, entries, legacy_inventory_hash, invalidated_classes: INVALIDATED, reset_request: { repositoryId: authority.repository_id, commonDirHash: common_directory_hash, inventoryHash: legacy_inventory_hash, confirmation }, identity_broken: authority.identity_broken ?? false };
}

export function assertNoLegacyReviewAuthorityV1(cwd: string): void {
	const inspection = inspectLegacyReviewAuthorityV1(cwd);
	if (inspection.outcome !== "clean") throw new Error(`Review authority blocked (${inspection.outcome}); inspect and submit destructive reset confirmation for ${inspection.repository_id}`);
}
