import * as __phaseRouterFs from "node:fs";
// PHASE_ROUTER_LOG_V1
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { Type } from "typebox";
import {
    readFileSync,
    writeFileSync,
    existsSync,
} from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

type ProfileName = "memory" | "project" | "inspect";

interface RouterState {
    profile: ProfileName;
    tools: string[];
    objective?: string;
    reason?: string;
    updatedAt?: string;
}

interface RouterReply {
    status?: string;
    profile?: string;
    tools?: unknown;
    reason?: unknown;
}

interface ToolOverride {
    category?: string;
    purpose?: string;
    use_when?: string[];
    do_not_use_when?: string[];
    relationships?: Record<string, string>;
    examples?: Array<{
        objective: string;
        correct: boolean;
        use_instead?: string;
    }>;
    side_effect?: string;
    read_only?: boolean;
    risk?: string;
    phase_roles?: ProfileName[];
    context_cost?: string;
    notes?: string[];
}

const AGENT_DIR = join(homedir(), ".pi", "agent");

const STATE_PATH =
    join(AGENT_DIR, "phase-router-state.json");

const CATALOG_PATH =
    join(AGENT_DIR, "phase-tool-catalog.json");

const LENS_PATH = join(
    AGENT_DIR,
    "npm",
    "node_modules",
    "pi-lens",
    "dist",
    "index.js",
);

const PROFILE_DEFAULTS: Record<
    ProfileName,
    readonly string[]
> = {
    memory: [
        "mem_get_observation",
        "mem_save",
    ],

    project: [
        "read",
        "bash",
        "edit",
        "write",
        "mem_save",
    ],

    inspect: [
        "read",
        "grep",
        "find",
        "lsp_diagnostics",
        "lens_diagnostics",
        "mem_save",
    ],
};

/*
 * Human-curated routing metadata.
 *
 * Raw name / description / parameters / sourceInfo always come from
 * the real Pi runtime via pi.getAllTools().
 *
 * These overrides only enrich routing semantics.
 */
const TOOL_OVERRIDES: Record<string, ToolOverride> = {

    // ------------------------------------------------------------
    // PI BUILTINS
    // ------------------------------------------------------------

    read: {
        category: "filesystem.read",
        purpose:
            "Read the contents of a known file or a specific region of a file.",
        use_when: [
            "The relevant file path is already known.",
            "Exact source text or configuration must be inspected.",
            "A later edit requires reading the current file first.",
        ],
        do_not_use_when: [
            "The file itself still needs to be discovered.",
            "The task is to search for a symbol or text across many files.",
        ],
        relationships: {
            grep:
                "Use grep instead when searching text across files.",
            find:
                "Use find instead when locating files by path/name pattern.",
            ls:
                "Use ls instead when only directory contents are needed.",
        },
        examples: [
            {
                objective:
                    "Read industrial_system_twin.py.",
                correct: true,
            },
            {
                objective:
                    "Find every file that mentions IndustrialSystemTwin.",
                correct: false,
                use_instead: "grep",
            },
        ],
        side_effect: "none",
        read_only: true,
        risk: "low",
        phase_roles: ["memory", "project", "inspect"],
        context_cost: "low",
    },

    grep: {
        category: "filesystem.search",
        purpose:
            "Search file contents for text, names, symbols, or patterns across one or more files.",
        use_when: [
            "The location of relevant text or a symbol is unknown.",
            "Occurrences across multiple files must be found.",
        ],
        do_not_use_when: [
            "The exact file is already known and only its contents are needed.",
            "The task is to locate files by filename rather than content.",
        ],
        relationships: {
            read:
                "Use read after grep identifies the exact relevant file/region.",
            find:
                "find searches paths/names; grep searches file contents.",
        },
        examples: [
            {
                objective:
                    "Find all references to IndustrialHardwareTwin.",
                correct: true,
            },
            {
                objective:
                    "Read lines 200-300 of a known Python file.",
                correct: false,
                use_instead: "read",
            },
        ],
        side_effect: "none",
        read_only: true,
        risk: "low",
        phase_roles: ["project", "inspect"],
        context_cost: "low",
    },

    find: {
        category: "filesystem.discovery",
        purpose:
            "Locate files or directories when their exact path is unknown.",
        use_when: [
            "The filename or path must be discovered.",
            "A path pattern can identify candidate files.",
        ],
        do_not_use_when: [
            "Searching the contents of files.",
            "The exact target file is already known.",
        ],
        relationships: {
            grep:
                "grep searches contents; find searches filesystem paths.",
            ls:
                "ls enumerates one known directory; find searches recursively/pattern-wise.",
        },
        examples: [
            {
                objective:
                    "Locate files named industrial_system_twin.py.",
                correct: true,
            },
            {
                objective:
                    "Find references to request_backup_relay inside source code.",
                correct: false,
                use_instead: "grep",
            },
        ],
        side_effect: "none",
        read_only: true,
        risk: "low",
        phase_roles: ["project", "inspect"],
        context_cost: "low",
    },

    ls: {
        category: "filesystem.discovery",
        purpose:
            "List the immediate contents of a known directory.",
        use_when: [
            "Directory structure must be inspected.",
            "Candidate files in one known directory are needed.",
        ],
        do_not_use_when: [
            "Recursive content search is required.",
            "A specific known file should simply be read.",
        ],
        relationships: {
            find:
                "Use find for recursive or pattern-based path discovery.",
        },
        examples: [
            {
                objective:
                    "List files in nucleo_determinista.",
                correct: true,
            },
        ],
        side_effect: "none",
        read_only: true,
        risk: "low",
        phase_roles: ["project", "inspect"],
        context_cost: "low",
    },

    edit: {
        category: "filesystem.write",
        purpose:
            "Apply a targeted modification to an existing file.",
        use_when: [
            "A known existing file requires a localized controlled change.",
            "Preserving unrelated file contents is important.",
        ],
        do_not_use_when: [
            "The entire file should be newly created or replaced.",
            "No modification has been authorized or required.",
        ],
        relationships: {
            write:
                "Prefer edit for surgical changes; write for complete creation/replacement.",
            read:
                "Read existing content before editing when current state matters.",
        },
        examples: [
            {
                objective:
                    "Change one validation branch in an existing Python file.",
                correct: true,
            },
            {
                objective:
                    "Create a completely new configuration file.",
                correct: false,
                use_instead: "write",
            },
        ],
        side_effect: "modifies files",
        read_only: false,
        risk: "medium",
        phase_roles: ["project"],
        context_cost: "low",
    },

    write: {
        category: "filesystem.write",
        purpose:
            "Create a new file or completely overwrite an existing file.",
        use_when: [
            "A complete new file must be created.",
            "Full replacement is deliberately intended.",
        ],
        do_not_use_when: [
            "Only a localized edit is required.",
            "Overwriting existing unrelated content would be unsafe.",
        ],
        relationships: {
            edit:
                "Prefer edit when changing only part of an existing file.",
        },
        examples: [
            {
                objective:
                    "Create a new complete JSON configuration file.",
                correct: true,
            },
        ],
        side_effect: "creates or overwrites files",
        read_only: false,
        risk: "medium",
        phase_roles: ["project"],
        context_cost: "low",
    },

    bash: {
        category: "execution.shell",
        purpose:
            "Execute command-line operations through Pi's configured shell.",
        use_when: [
            "Tests, scripts, build commands, Git inspection, or other CLI operations are required.",
            "No safer specialized Pi tool performs the operation.",
        ],
        do_not_use_when: [
            "A dedicated read/search/edit tool can perform the task more safely.",
            "The requested operation is destructive and has not been authorized.",
        ],
        relationships: {
            read:
                "Prefer read for file inspection rather than shelling out to cat/type.",
            grep:
                "Prefer grep for normal repository text search.",
        },
        examples: [
            {
                objective:
                    "Run the project's focused Python test suite.",
                correct: true,
            },
            {
                objective:
                    "Read a known source file.",
                correct: false,
                use_instead: "read",
            },
        ],
        side_effect: "arbitrary command execution",
        read_only: false,
        risk: "high",
        phase_roles: ["project"],
        context_cost: "low",
    },

    powershell: {
        category: "execution.shell",
        purpose:
            "Execute PowerShell commands when Windows/PowerShell semantics are specifically required.",
        use_when: [
            "The operation specifically requires PowerShell cmdlets or Windows PowerShell semantics.",
        ],
        do_not_use_when: [
            "No command execution is needed.",
            "A safer specialized tool already covers the operation.",
        ],
        examples: [
            {
                objective:
                    "Inspect a Windows service using PowerShell cmdlets.",
                correct: true,
            },
        ],
        side_effect: "arbitrary command execution",
        read_only: false,
        risk: "high",
        phase_roles: ["project"],
        context_cost: "low",
    },

    // ------------------------------------------------------------
    // ENGRAM
    // ------------------------------------------------------------

    mem_search: {
        category: "memory.discovery",
        purpose:
            "Semantically search persisted Engram observations when the required observation ID is not already known.",
        use_when: [
            "Past knowledge must be discovered by topic or meaning.",
            "The relevant observation ID is unknown.",
            "The user asks what was previously decided about a topic.",
        ],
        do_not_use_when: [
            "A specific observation ID is already known.",
            "The objective explicitly requests direct observation retrieval.",
            "Repeated synonym searches are being attempted after an adequate search returned nothing.",
        ],
        relationships: {
            mem_get_observation:
                "If the observation ID is known, use mem_get_observation directly instead of searching.",
            mem_context:
                "Use mem_context for a compact broad continuity snapshot; mem_search for targeted discovery.",
        },
        examples: [
            {
                objective:
                    "Find our previous decision about Pi-Lens routing.",
                correct: true,
            },
            {
                objective:
                    "Retrieve observation 113.",
                correct: false,
                use_instead: "mem_get_observation",
            },
        ],
        side_effect: "none",
        read_only: true,
        risk: "low",
        phase_roles: ["memory", "project", "inspect"],
        context_cost: "low",
        notes: [
            "Avoid semantically equivalent repeated searches.",
            "A NOT_FOUND outcome is valid.",
        ],
    },

    mem_get_observation: {
        category: "memory.direct_retrieval",
        purpose:
            "Retrieve one exact persisted Engram observation when its numeric observation ID is already known.",
        use_when: [
            "The objective supplies a known observation ID.",
            "A previous step returned an observation ID that must now be read.",
            "Exact stored content from one observation is required.",
        ],
        do_not_use_when: [
            "The relevant observation ID is unknown.",
            "The task requires semantic discovery across memory.",
        ],
        relationships: {
            mem_search:
                "Known ID -> mem_get_observation. Unknown ID/topic search -> mem_search.",
        },
        examples: [
            {
                objective:
                    "Retrieve persistent observation 113 directly by ID.",
                correct: true,
            },
            {
                objective:
                    "Find previous work concerning IndustrialSystemTwin.",
                correct: false,
                use_instead: "mem_search",
            },
        ],
        side_effect: "none",
        read_only: true,
        risk: "low",
        phase_roles: ["memory", "project", "inspect"],
        context_cost: "low",
    },

    mem_context: {
        category: "memory.context",
        purpose:
            "Load a compact relevant Engram context snapshot for continuity when several prior facts may matter.",
        use_when: [
            "Beginning or resuming work that depends on broader prior project context.",
            "Several related persisted facts may be relevant.",
        ],
        do_not_use_when: [
            "One exact observation ID is already known.",
            "Only one narrow semantic fact needs to be found.",
        ],
        relationships: {
            mem_search:
                "mem_context provides broad continuity; mem_search performs targeted semantic discovery.",
            mem_get_observation:
                "Use mem_get_observation for one known exact ID.",
        },
        examples: [
            {
                objective:
                    "Resume the previous project state and load relevant memory context.",
                correct: true,
            },
        ],
        side_effect: "none",
        read_only: true,
        risk: "low",
        phase_roles: ["memory", "project", "inspect"],
        context_cost: "medium",
    },

    mem_save: {
        category: "memory.persistence",
        purpose:
            "Persist a durable discovery, decision, constraint, environment fact, or reusable result into Engram.",
        use_when: [
            "A phase produced knowledge needed by future phases.",
            "An architectural/design decision was established.",
            "A non-obvious discovery or environment/configuration fact should survive worker-context destruction.",
        ],
        do_not_use_when: [
            "The task is only retrieving existing memory.",
            "The information is transient tool chatter with no future value.",
            "The same fact has already been persisted adequately.",
        ],
        relationships: {
            mem_session_summary:
                "mem_save stores focused durable facts; mem_session_summary stores a structured session/phase summary.",
            mem_update:
                "Use mem_update when an existing observation should be corrected rather than creating a new fact.",
        },
        examples: [
            {
                objective:
                    "Persist the discovered IndustrialSystemTwin responsibility and Pyright findings.",
                correct: true,
            },
            {
                objective:
                    "Retrieve observation 113.",
                correct: false,
                use_instead: "mem_get_observation",
            },
        ],
        side_effect: "writes persistent memory",
        read_only: false,
        risk: "low",
        phase_roles: ["memory", "project", "inspect"],
        context_cost: "low",
        notes: [
            "A successful saved observation ID can serve as the persistence ACK before destroying worker context.",
        ],
    },

    mem_update: {
        category: "memory.persistence",
        purpose:
            "Update or correct an existing Engram observation.",
        use_when: [
            "A persisted observation is known to be stale, incomplete, or incorrect.",
            "The same semantic fact should be revised rather than duplicated.",
        ],
        do_not_use_when: [
            "Creating a genuinely new independent observation.",
            "The existing observation to update has not been identified.",
        ],
        relationships: {
            mem_save:
                "Use mem_save for a new durable fact; mem_update to revise an existing one.",
        },
        examples: [
            {
                objective:
                    "Correct a previously saved observation whose conclusion was superseded.",
                correct: true,
            },
        ],
        side_effect: "modifies persistent memory",
        read_only: false,
        risk: "medium",
        phase_roles: ["memory", "project", "inspect"],
        context_cost: "low",
    },

    mem_delete: {
        category: "memory.persistence",
        purpose:
            "Delete an existing persisted Engram observation.",
        use_when: [
            "A specific persisted observation is explicitly known to require deletion.",
        ],
        do_not_use_when: [
            "The user has not requested or authorized deletion.",
            "The issue can be solved by updating/correcting the observation instead.",
        ],
        relationships: {
            mem_update:
                "Prefer correction via mem_update when the observation should remain but needs revision.",
        },
        examples: [
            {
                objective:
                    "Delete explicitly identified obsolete observation 200.",
                correct: true,
            },
        ],
        side_effect: "deletes persistent memory",
        read_only: false,
        risk: "high",
        phase_roles: ["memory"],
        context_cost: "low",
    },

    mem_session_summary: {
        category: "memory.persistence",
        purpose:
            "Persist a structured summary of a completed session or substantial phase.",
        use_when: [
            "A substantial phase/session is ending and its goal, discoveries, accomplishments, next steps, and files must survive.",
            "Worker context is about to be discarded after a meaningful body of work.",
        ],
        do_not_use_when: [
            "Only one focused durable fact needs to be stored.",
            "No meaningful session/phase work has occurred.",
        ],
        relationships: {
            mem_save:
                "Use mem_save for individual durable facts; mem_session_summary for structured phase/session continuity.",
        },
        examples: [
            {
                objective:
                    "Persist a structured phase summary before clearing the worker context.",
                correct: true,
            },
        ],
        side_effect: "writes persistent memory",
        read_only: false,
        risk: "low",
        phase_roles: ["memory", "project", "inspect"],
        context_cost: "low",
    },

    mem_stats: {
        category: "memory.admin",
        purpose:
            "Inspect Engram memory statistics and storage-level summary information.",
        use_when: [
            "Diagnosing memory-store state or understanding stored observation counts/statistics.",
        ],
        do_not_use_when: [
            "Retrieving a specific fact or observation.",
        ],
        examples: [
            {
                objective:
                    "Check Engram storage statistics.",
                correct: true,
            },
        ],
        side_effect: "none",
        read_only: true,
        risk: "low",
        phase_roles: ["memory"],
        context_cost: "low",
    },

    mem_timeline: {
        category: "memory.discovery",
        purpose:
            "Inspect persisted memory in chronological/timeline form.",
        use_when: [
            "The temporal sequence of prior observations matters.",
        ],
        do_not_use_when: [
            "A known exact observation ID should be retrieved directly.",
            "Semantic topic search is sufficient.",
        ],
        examples: [
            {
                objective:
                    "Review the chronology of recent persisted project decisions.",
                correct: true,
            },
        ],
        side_effect: "none",
        read_only: true,
        risk: "low",
        phase_roles: ["memory"],
        context_cost: "medium",
    },

    mem_current_project: {
        category: "memory.admin",
        purpose:
            "Determine which project Engram currently associates with the active working context.",
        use_when: [
            "Diagnosing project scoping or confirming the active Engram project.",
        ],
        do_not_use_when: [
            "The task is ordinary retrieval or persistence and project scope is already known.",
        ],
        examples: [
            {
                objective:
                    "Verify which Engram project is currently active.",
                correct: true,
            },
        ],
        side_effect: "none",
        read_only: true,
        risk: "low",
        phase_roles: ["memory"],
        context_cost: "low",
    },

    mem_doctor: {
        category: "memory.admin",
        purpose:
            "Diagnose Engram backend/connection/configuration health.",
        use_when: [
            "Engram tools are failing or memory backend health is in doubt.",
        ],
        do_not_use_when: [
            "Normal retrieval is simply returning no matching observation.",
        ],
        examples: [
            {
                objective:
                    "Diagnose why Engram memory operations are failing.",
                correct: true,
            },
        ],
        side_effect: "diagnostic",
        read_only: true,
        risk: "low",
        phase_roles: ["memory"],
        context_cost: "low",
    },

    // ------------------------------------------------------------
    // PI-LENS
    // ------------------------------------------------------------

    lsp_diagnostics: {
        category: "code.lsp",
        purpose:
            "Request language-server diagnostics for source code, including syntax, typing, and language-aware errors where supported.",
        use_when: [
            "The task explicitly requires LSP diagnostics.",
            "Type/syntax/language-server errors must be checked.",
            "A modified file should be validated with its language server.",
        ],
        do_not_use_when: [
            "Only plain file contents are needed.",
            "The language/server is unavailable and broader static diagnostics are more appropriate.",
        ],
        relationships: {
            lens_diagnostics:
                "lsp_diagnostics is language-server focused; lens_diagnostics can provide broader Lens/static-analysis diagnostics.",
        },
        examples: [
            {
                objective:
                    "Check IndustrialSystemTwin for Python LSP/type errors.",
                correct: true,
            },
            {
                objective:
                    "Read the responsibility of a class from known source.",
                correct: false,
                use_instead: "read",
            },
        ],
        side_effect: "none",
        read_only: true,
        risk: "low",
        phase_roles: ["inspect"],
        context_cost: "medium",
        notes: [
            "Requires Pi-Lens to be loaded.",
        ],
    },

    lens_diagnostics: {
        category: "code.static_analysis",
        purpose:
            "Run or coordinate broader Pi-Lens diagnostics/static-analysis capabilities beyond a single plain file read.",
        use_when: [
            "The objective explicitly asks for static analysis, code-quality diagnostics, or broader Lens inspection.",
            "LSP alone may not cover the requested analysis.",
        ],
        do_not_use_when: [
            "A simple known-file read is sufficient.",
            "No code diagnostics are requested.",
        ],
        relationships: {
            lsp_diagnostics:
                "Use lsp_diagnostics for specifically LSP-driven errors; lens_diagnostics for broader Lens diagnostics.",
        },
        examples: [
            {
                objective:
                    "Inspect a module with static-analysis diagnostics.",
                correct: true,
            },
        ],
        side_effect: "none",
        read_only: true,
        risk: "low",
        phase_roles: ["inspect"],
        context_cost: "medium",
        notes: [
            "Requires Pi-Lens to be loaded.",
        ],
    },

    pi_lens_activate_tools: {
        category: "code.capability_activation",
        purpose:
            "Ask Pi-Lens to activate additional specialized analysis tools needed for the current inspection.",
        use_when: [
            "The required specialized Lens capability is not already active.",
            "Pi-Lens needs to expose deeper language/static-analysis tooling for the task.",
        ],
        do_not_use_when: [
            "Existing active tools already satisfy the objective.",
            "The task does not require Pi-Lens.",
        ],
        relationships: {
            lsp_diagnostics:
                "Activate additional Lens tooling only when existing diagnostics are insufficient.",
        },
        examples: [
            {
                objective:
                    "Activate additional Lens tooling needed for deeper Python static analysis.",
                correct: true,
            },
        ],
        side_effect: "changes active analysis capability set",
        read_only: false,
        risk: "low",
        phase_roles: ["inspect"],
        context_cost: "medium",
        notes: [
            "Requires Pi-Lens to be loaded.",
        ],
    },
};


function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}


function truncate(
    value: unknown,
    max = 400,
): string {
    const text = typeof value === "string"
        ? value
        : String(value ?? "");

    return text.length <= max
        ? text
        : text.slice(0, max - 3) + "...";
}


function inferProvider(
    name: string,
    sourceInfo: unknown,
): string {
    if (name.startsWith("mem_")) {
        return "gentle-engram";
    }

    if (
        name.startsWith("lens_") ||
        name.startsWith("lsp_") ||
        name.startsWith("pi_lens_")
    ) {
        return "pi-lens";
    }

    if (
        [
            "read",
            "bash",
            "powershell",
            "edit",
            "write",
            "grep",
            "find",
            "ls",
        ].includes(name)
    ) {
        return "pi-builtin";
    }

    const raw = JSON.stringify(sourceInfo ?? {}).toLowerCase();

    if (raw.includes("pi-lens")) {
        return "pi-lens";
    }

    if (raw.includes("engram")) {
        return "gentle-engram";
    }

    return "unknown";
}


function inferCategory(
    name: string,
    description: string,
): string {
    if (name.startsWith("mem_")) {
        return "memory.other";
    }

    if (
        name.startsWith("lsp_") ||
        name.startsWith("lens_") ||
        name.startsWith("pi_lens_")
    ) {
        return "code.analysis";
    }

    const text =
        `${name} ${description}`.toLowerCase();

    if (
        text.includes("search") ||
        text.includes("find")
    ) {
        return "discovery";
    }

    if (
        text.includes("write") ||
        text.includes("edit") ||
        text.includes("update") ||
        text.includes("delete")
    ) {
        return "mutation";
    }

    if (
        text.includes("diagnostic") ||
        text.includes("lint") ||
        text.includes("analysis")
    ) {
        return "analysis";
    }

    return "other";
}


function inferReadOnly(
    name: string,
    description: string,
): boolean {
    const text =
        `${name} ${description}`.toLowerCase();

    return !(
        text.includes("write") ||
        text.includes("edit") ||
        text.includes("update") ||
        text.includes("delete") ||
        text.includes("save") ||
        text.includes("execute") ||
        text.includes("run command") ||
        text.includes("activate")
    );
}


function inferRisk(
    name: string,
    readOnly: boolean,
): string {
    if (
        [
            "bash",
            "powershell",
            "mem_delete",
        ].includes(name)
    ) {
        return "high";
    }

    if (!readOnly) {
        return "medium";
    }

    return "low";
}


function parameterSummary(
    parameters: any,
): {
    required: string[];
    properties: string[];
} {
    const required =
        Array.isArray(parameters?.required)
            ? parameters.required.filter(
                  (x: unknown) => typeof x === "string",
              )
            : [];

    const properties =
        parameters?.properties &&
        typeof parameters.properties === "object"
            ? Object.keys(parameters.properties)
            : [];

    return {
        required,
        properties,
    };
}


function genericMetadata(
    name: string,
    description: string,
    provider: string,
): ToolOverride {
    const readOnly =
        inferReadOnly(name, description);

    const category =
        inferCategory(name, description);

    return {
        category,
        purpose:
            truncate(
                description ||
                `Use the ${name} tool for its registered Pi capability.`,
                500,
            ),

        use_when: [
            `The objective directly matches this tool's registered purpose: ${truncate(description, 220)}`,
        ],

        do_not_use_when: [
            "Another available tool more directly and safely matches the objective.",
            "The tool is being selected only because it is available rather than because its capability is required.",
        ],

        examples: [
            {
                objective:
                    `Use ${name} when the task explicitly requires: ${truncate(description, 160)}`,
                correct: true,
            },
            {
                objective:
                    `Use ${name} for an unrelated task.`,
                correct: false,
            },
        ],

        side_effect:
            readOnly
                ? "none or diagnostic"
                : "possible state change; inspect registered description/schema",

        read_only: readOnly,

        risk:
            inferRisk(name, readOnly),

        phase_roles:
            provider === "pi-lens"
                ? ["inspect"]
                : provider === "gentle-engram"
                  ? ["memory", "project", "inspect"]
                  : ["project", "inspect"],

        context_cost: "unknown",

        notes: [
            "Auto-enriched from the real registered Pi tool description.",
            "Review this entry if the tool becomes important to routing.",
        ],
    };
}


function buildToolEntry(
    raw: any,
): any {
    const name =
        String(raw?.name ?? "");

    const description =
        String(raw?.description ?? "");

    const provider =
        inferProvider(
            name,
            raw?.sourceInfo,
        );

    const auto =
        genericMetadata(
            name,
            description,
            provider,
        );

    const override =
        TOOL_OVERRIDES[name] ?? {};

    const merged: ToolOverride = {
        ...auto,
        ...override,

        use_when:
            override.use_when ??
            auto.use_when,

        do_not_use_when:
            override.do_not_use_when ??
            auto.do_not_use_when,

        relationships:
            override.relationships ??
            auto.relationships,

        examples:
            override.examples ??
            auto.examples,

        notes: [
            ...(auto.notes ?? []),
            ...(override.notes ?? []),
        ],
    };

    const parameters =
        cloneJson(raw?.parameters ?? {});

    return {
        resource_type: "tool",

        name,

        provider,

        source_info:
            cloneJson(raw?.sourceInfo ?? null),

        registered_description:
            description,

        parameters,

        parameter_summary:
            parameterSummary(parameters),

        prompt_guidelines:
            cloneJson(
                raw?.promptGuidelines ?? [],
            ),

        category:
            merged.category,

        purpose:
            merged.purpose,

        use_when:
            merged.use_when,

        do_not_use_when:
            merged.do_not_use_when,

        relationships:
            merged.relationships ?? {},

        examples:
            merged.examples ?? [],

        side_effect:
            merged.side_effect,

        read_only:
            merged.read_only,

        risk:
            merged.risk,

        requires_extension:
            provider === "pi-lens"
                ? "pi-lens"
                : provider === "gentle-engram"
                  ? "gentle-engram"
                  : null,

        phase_roles:
            merged.phase_roles,

        context_cost:
            merged.context_cost,

        curation:
            TOOL_OVERRIDES[name]
                ? "human_curated"
                : "auto_enriched",

        notes:
            merged.notes ?? [],
    };
}


function writeCatalog(
    pi: ExtensionAPI,
    cwd: string,
): any {
    const now =
        new Date().toISOString();

    const currentProfile =
        readState().profile;

    const currentTools =
        pi.getAllTools()
            .filter(
                (tool) =>
                    tool.name !== "phase_complete",
            )
            .map(buildToolEntry);

    /*
     * The canonical catalog is cumulative.
     *
     * A dynamic extension such as Pi-Lens may not be loaded in the
     * current phase. Its tools must nevertheless remain known to the
     * router so Qwen can request that capability for the NEXT phase.
     */
    let previousTools: any[] = [];

    if (existsSync(CATALOG_PATH)) {
        try {
            const previousCatalog =
                JSON.parse(
                    readFileSync(
                        CATALOG_PATH,
                        "utf8",
                    ),
                );

            if (
                Array.isArray(
                    previousCatalog?.tools,
                )
            ) {
                previousTools =
                    previousCatalog.tools;
            }
        } catch {
            previousTools = [];
        }
    }

    const byName =
        new Map<string, any>();

    for (
        const previous
        of previousTools
    ) {
        if (
            previous &&
            typeof previous.name === "string"
        ) {
            byName.set(
                previous.name,
                previous,
            );
        }
    }

    const currentNames =
        new Set<string>();

    for (
        const tool
        of currentTools
    ) {
        currentNames.add(
            tool.name,
        );

        const previous =
            byName.get(tool.name);

        const seenInProfiles =
            new Set<string>([
                ...(
                    Array.isArray(
                        previous?.seen_in_profiles,
                    )
                        ? previous.seen_in_profiles
                        : []
                ),
                currentProfile,
            ]);

        byName.set(
            tool.name,
            {
                ...previous,
                ...tool,

                currently_registered:
                    true,

                last_seen_at:
                    now,

                seen_in_profiles:
                    [...seenInProfiles],
            },
        );
    }

    /*
     * Keep known tools from extensions that are not loaded in this
     * phase. They remain selectable by Qwen for a future phase.
     */
    for (
        const [name, tool]
        of byName.entries()
    ) {
        if (
            !currentNames.has(name)
        ) {
            byName.set(
                name,
                {
                    ...tool,
                    currently_registered:
                        false,
                },
            );
        }
    }

    const tools =
        Array.from(
            byName.values(),
        ).sort(
            (a: any, b: any) =>
                a.name.localeCompare(
                    b.name,
                ),
        );

    const curated =
        tools.filter(
            (tool: any) =>
                tool.curation ===
                "human_curated",
        ).length;

    const auto =
        tools.length -
        curated;

    const extensions = [
        {
            name:
                "gentle-engram",

            role:
                "Persistent memory, retrieval, phase-result persistence and ACK.",

            loading:
                "resident",

            routing_note:
                "Keep loaded; activate only the memory tools required by the phase.",
        },
        {
            name:
                "pi-lens",

            role:
                "LSP, code navigation and static-analysis capability.",

            loading:
                "dynamic",

            routing_note:
                "Load only for inspect phases that actually require Lens/LSP/static analysis.",
        },
        {
            name:
                "phase-router",

            role:
                "Resident controller. Validates Qwen selections and configures the next Pi phase.",

            loading:
                "resident",
        },
    ];

    const catalog = {
        schema_version:
            "1.1",

        generated_at:
            now,

        generated_by:
            "phase-router.ts using cumulative live pi.getAllTools() discovery",

        runtime: {
            cwd,

            current_profile:
                currentProfile,

            tool_count:
                tools.length,

            currently_registered_count:
                currentNames.size,

            currently_unloaded_count:
                tools.length -
                currentNames.size,

            human_curated_count:
                curated,

            auto_enriched_count:
                auto,
        },

        routing_policy: {
            objective:
                "Choose the minimum sufficient resources for exactly the next phase.",

            principles: [
                "Tool names must come from this catalog; never invent tools.",
                "A tool may be selectable even when currently_registered is false if its requires_extension identifies an approved dynamic extension.",
                "Prefer the narrowest tool that directly matches the objective.",
                "Known exact identifiers should use direct-retrieval tools rather than semantic search.",
                "Do not load Pi-Lens unless Lens/LSP/static-analysis capability is actually required.",
                "Do not select mutation or command-execution tools for read-only work.",
                "Do not select redundant tools that perform the same function.",
                "A NOT_FOUND memory search result is valid; do not loop through equivalent search rewrites.",
                "Persist durable phase knowledge before worker context is discarded.",
            ],

            important_distinctions: [
                {
                    tools: [
                        "mem_search",
                        "mem_get_observation",
                    ],

                    rule:
                        "Unknown observation/topic -> mem_search. Known numeric observation ID -> mem_get_observation.",
                },
                {
                    tools: [
                        "mem_save",
                        "mem_session_summary",
                    ],

                    rule:
                        "Focused durable fact -> mem_save. Structured phase/session continuity -> mem_session_summary.",
                },
                {
                    tools: [
                        "read",
                        "grep",
                        "find",
                        "ls",
                    ],

                    rule:
                        "Known file contents -> read. Search contents -> grep. Locate paths -> find. List one directory -> ls.",
                },
                {
                    tools: [
                        "edit",
                        "write",
                    ],

                    rule:
                        "Localized modification -> edit. Complete creation/replacement -> write.",
                },
                {
                    tools: [
                        "lsp_diagnostics",
                        "lens_diagnostics",
                    ],

                    rule:
                        "Language-server errors -> lsp_diagnostics. Broader Lens/static analysis -> lens_diagnostics.",
                },
            ],
        },

        resources: {
            extensions,

            skills: [],

            agents: [],

            note:
                "Skills and agents will use the same catalog structure when added to phase routing.",
        },

        tools,
    };

    writeFileSync(
        CATALOG_PATH,
        JSON.stringify(
            catalog,
            null,
            2,
        ),
        "utf8",
    );

    return catalog;
}


function routingView(
    catalog: any,
): any[] {
    return (catalog?.tools ?? []).map(
        (tool: any) => ({
            name:
                tool.name,

            provider:
                tool.provider,

            category:
                tool.category,

            purpose:
                truncate(tool.purpose, 260),

            use_when:
                (tool.use_when ?? [])
                    .slice(0, 4),

            do_not_use_when:
                (tool.do_not_use_when ?? [])
                    .slice(0, 4),

            relationships:
                tool.relationships ?? {},

            examples:
                (tool.examples ?? [])
                    .slice(0, 3),

            requires_extension:
                tool.requires_extension,

            phase_roles:
                tool.phase_roles,

            read_only:
                tool.read_only,

            risk:
                tool.risk,

            context_cost:
                tool.context_cost,
        }),
    );
}


function readCatalog(): any {
    if (!existsSync(CATALOG_PATH)) {
        throw new Error(
            `Tool catalog not found: ${CATALOG_PATH}`,
        );
    }

    return JSON.parse(
        readFileSync(
            CATALOG_PATH,
            "utf8",
        ),
    );
}


function defaultState(): RouterState {
    return {
        profile: "memory",
        tools: [
            "mem_get_observation",
            "mem_save",
        ],
    };
}


function readState(): RouterState {
    if (!existsSync(STATE_PATH)) {
        return defaultState();
    }

    try {
        const raw =
            JSON.parse(
                readFileSync(
                    STATE_PATH,
                    "utf8",
                ),
            ) as RouterState;

        if (
            ![
                "memory",
                "project",
                "inspect",
            ].includes(raw.profile)
        ) {
            return defaultState();
        }

        return {
            ...raw,

            tools:
                Array.isArray(raw.tools) &&
                raw.tools.length > 0
                    ? raw.tools
                    : [
                          ...PROFILE_DEFAULTS[
                              raw.profile
                          ],
                      ],
        };
    } catch {
        return defaultState();
    }
}


function writeState(
    state: RouterState,
): void {
    writeFileSync(
        STATE_PATH,
        JSON.stringify(
            state,
            null,
            2,
        ),
        "utf8",
    );
}


async function loadLens(
    pi: ExtensionAPI,
): Promise<void> {
    const href =
        pathToFileURL(LENS_PATH).href +
        `?phase_router=${Date.now()}`;

    const module =
        await import(href);

    const factory =
        typeof module.default === "function"
            ? module.default
            : typeof module === "function"
              ? module
              : undefined;

    if (
        typeof factory !== "function"
    ) {
        throw new Error(
            `pi-lens does not expose a usable factory: ${LENS_PATH}`,
        );
    }

    await factory(pi);
}


function deriveProfile(
    requestedProfile: unknown,
    tools: string[],
    catalog: any,
): ProfileName {
    const byName =
        new Map(
            (catalog.tools ?? []).map(
                (tool: any) => [
                    tool.name,
                    tool,
                ],
            ),
        );

    const requiresLens =
        tools.some(
            (name) =>
                byName.get(name)
                    ?.requires_extension ===
                "pi-lens",
        );

    if (requiresLens) {
        return "inspect";
    }

    if (
        requestedProfile === "memory" ||
        requestedProfile === "project"
    ) {
        return requestedProfile;
    }

    if (
        tools.every(
            (name) =>
                String(name)
                    .startsWith("mem_") ||
                name === "read",
        )
    ) {
        return "memory";
    }

    return "project";
}


function normalizeRoute(
    raw: RouterReply,
    objective: string,
    catalog: any,
): RouterState {
    const known =
        new Set(
            (catalog.tools ?? [])
                .map(
                    (tool: any) =>
                        tool.name,
                ),
        );

    const requested =
        Array.isArray(raw.tools)
            ? raw.tools.filter(
                  (tool): tool is string =>
                      typeof tool === "string" &&
                      known.has(tool),
              )
            : [];

    if (requested.length === 0) {
        throw new Error(
            "Qwen selected no valid tools from the catalog.",
        );
    }

    const requestedTools =
        [...new Set(requested)];

    const profile =
        deriveProfile(
            raw.profile,
            requestedTools,
            catalog,
        );

    /*
     * PROJECT_PROFILE_BASELINE_V1
     *
     * Qwen selects the minimum task-specific tools, but that selection must
     * not remove the baseline capabilities of the selected execution profile.
     *
     * Observed failure:
     * a project phase was routed with ["symbol_search", "read"] while the
     * worker needed filesystem discovery / shell access. The project profile
     * already defines bash/read/edit/write/mem_save as its safe execution
     * baseline, but normalizeRoute replaced that baseline with Qwen's subset.
     *
     * Keep Qwen's selected tools and add the canonical profile baseline.
     */
    const tools =
        [
            ...new Set([
                ...PROFILE_DEFAULTS[
                    profile
                ],
                ...requestedTools,
            ]),
        ];

    return {
        profile,

        tools,

        objective,

        reason:
            typeof raw.reason === "string"
                ? raw.reason.slice(0, 240)
                : "",

        updatedAt:
            new Date().toISOString(),
    };
}


type RoutingIntent =
    | "memory_exact"
    | "memory_search"
    | "memory_context"
    | "file_read"
    | "file_discovery"
    | "content_search"
    | "code_navigation"
    | "code_diagnostics"
    | "code_static_analysis"
    | "code_modify"
    | "shell_execute"
    | "memory_persist"
    | "other";


interface IntentReply {
    intent?: string;
    reason?: string;
}


const INTENT_TOOL_HINTS: Record<
    RoutingIntent,
    readonly string[]
> = {
    memory_exact: [
        "mem_get_observation",
    ],

    memory_search: [
        "mem_search",
    ],

    memory_context: [
        "mem_context",
        "mem_search",
        "mem_get_observation",
    ],

    file_read: [
        "read",
    ],

    file_discovery: [
        "find",
        "ls",
    ],

    content_search: [
        "grep",
    ],

    code_navigation: [
        "symbol_search",
        "lsp_navigation",
        "grep",
        "find",
        "read",
    ],

    code_diagnostics: [
        "lsp_diagnostics",
        "lens_diagnostics",
        "read",
    ],

    code_static_analysis: [
        "lens_diagnostics",
        "lsp_diagnostics",
        "read",
    ],

    code_modify: [
        "read",
        "edit",
        "write",
        "grep",
    ],

    shell_execute: [
        "bash",
        "powershell",
    ],

    memory_persist: [
        "mem_save",
        "mem_update",
        "mem_session_summary",
    ],

    other: [],
};


async function classifyIntent(
    objective: string,
): Promise<RoutingIntent> {
    const intents = [
        "memory_exact",
        "memory_search",
        "memory_context",
        "file_read",
        "file_discovery",
        "content_search",
        "code_navigation",
        "code_diagnostics",
        "code_static_analysis",
        "code_modify",
        "shell_execute",
        "memory_persist",
        "other",
    ];

    const schema = {
        type: "object",

        properties: {
            intent: {
                type: "string",
                enum: intents,
            },

            reason: {
                type: "string",
            },
        },

        required: [
            "intent",
            "reason",
        ],

        additionalProperties: false,
    };

    const system = `
You classify exactly ONE next Pi worker operation.

Do not solve the task.
Do not select tools.
Do not use outside context.
Use ONLY the objective text.

INTENTS:

memory_exact
- Retrieve one exact persisted memory item whose numeric observation ID is already known.
- Example pattern: "retrieve observation 113".
- If an exact observation ID is supplied, prefer this over memory_search.

memory_search
- Find persisted memory by topic/meaning when the observation ID is unknown.

memory_context
- Load broader prior-memory context involving multiple potentially relevant facts.

file_read
- Read a known file/path.

file_discovery
- Locate files/directories by path/name or list a directory.

content_search
- Search text/content across files.

code_navigation
- Locate definitions, references, symbols, callers, implementations.

code_diagnostics
- LSP/type/syntax/language-server diagnostics.

code_static_analysis
- Broader static analysis, linting, structural/code-quality diagnostics.

code_modify
- Modify/create source or project files.

shell_execute
- Execute tests, builds, scripts, Git or other command-line operations.

memory_persist
- Save/update/summarize durable memory.

other
- None of the above.

Critical rule:
An explicit numeric observation ID requested for direct retrieval is memory_exact, not memory_search.

Return only the schema-conforming JSON.
`.trim();

    const body = {
        model: "qwen3.5:4b",
        stream: false,
        format: schema,
        think: false,
        keep_alive: -1,

        options: {
            temperature: 0,
            top_p: 1,
        },

        messages: [
            {
                role: "system",
                content: system,
            },
            {
                role: "user",
                content:
                    "<OBJECTIVE>\n" +
                    objective +
                    "\n</OBJECTIVE>",
            },
        ],
    };

    const response =
        await fetch(
            "http://127.0.0.1:11434/api/chat",
            {
                method: "POST",
                headers: {
                    "content-type":
                        "application/json",
                },
                body:
                    JSON.stringify(body),
            },
        );

    if (!response.ok) {
        throw new Error(
            `Qwen intent classifier HTTP ${response.status}: ${await response.text()}`,
        );
    }

    const payload =
        (await response.json()) as {
            message?: {
                content?: string;
            };
        };

    const content =
        payload.message?.content;

    if (!content) {
        throw new Error(
            "Qwen intent classifier returned no content.",
        );
    }

    const parsed =
        JSON.parse(content) as IntentReply;

    if (
        typeof parsed.intent !== "string" ||
        !intents.includes(parsed.intent)
    ) {
        throw new Error(
            `Invalid routing intent: ${String(parsed.intent)}`,
        );
    }

    return parsed.intent as RoutingIntent;
}


function candidateToolsForIntent(
    catalog: any,
    intent: RoutingIntent,
): any[] {
    const byName =
        new Map(
            (catalog.tools ?? []).map(
                (tool: any) => [
                    tool.name,
                    tool,
                ],
            ),
        );

    let names =
        [...INTENT_TOOL_HINTS[intent]];

    /*
     * For "other", expose a small broad fallback rather than all 41
     * tools. The router must never be flooded with the entire catalog.
     */
    if (
        intent === "other"
    ) {
        names = [
            "read",
            "grep",
            "find",
            "mem_search",
            "mem_get_observation",
            "lsp_diagnostics",
            "lens_diagnostics",
            "edit",
            "bash",
        ];
    }

    return names
        .map(
            (name) =>
                byName.get(name),
        )
        .filter(
            (tool) =>
                tool !== undefined,
        )
        .map(
            (tool: any) => ({
                name:
                    tool.name,

                provider:
                    tool.provider,

                category:
                    tool.category,

                purpose:
                    tool.purpose,

                use_when:
                    tool.use_when,

                do_not_use_when:
                    tool.do_not_use_when,

                relationships:
                    tool.relationships,

                requires_extension:
                    tool.requires_extension,

                currently_registered:
                    tool.currently_registered,

                read_only:
                    tool.read_only,

                risk:
                    tool.risk,
            }),
        );
}


async function routeWithQwen(
    objective: string,
): Promise<RouterState> {
    const catalog =
        readCatalog();

    const intent =
        await classifyIntent(
            objective,
        );

    const candidates =
        candidateToolsForIntent(
            catalog,
            intent,
        );

    if (
        candidates.length === 0
    ) {
        throw new Error(
            `No catalog tools available for routing intent: ${intent}`,
        );
    }

    /*
     * If only one tool satisfies the classified intent, no second
     * model decision is needed.
     */
    if (
        candidates.length === 1
    ) {
        const only =
            candidates[0];

        const profile: ProfileName =
            only.requires_extension ===
            "pi-lens"
                ? "inspect"
                : String(only.name)
                      .startsWith("mem_")
                  ? "memory"
                  : "project";

        const state: RouterState = {
            profile,

            tools: [
                only.name,
            ],

            objective,

            reason:
                `${intent}: single matching catalog tool ${only.name}`,

            updatedAt:
                new Date()
                    .toISOString(),
        };

        writeFileSync(
            join(
                AGENT_DIR,
                "phase-router-last-qwen.json",
            ),
            JSON.stringify(
                {
                    timestamp:
                        new Date()
                            .toISOString(),

                    objective,

                    intent,

                    candidates,

                    decision:
                        state,

                    second_stage:
                        false,
                },
                null,
                2,
            ),
            "utf8",
        );

        return state;
    }

    const candidateNames =
        candidates.map(
            (candidate: any) =>
                candidate.name,
        );

    const schema = {
        type:
            "object",

        properties: {
            tools: {
                type:
                    "array",

                items: {
                    type:
                        "string",

                    enum:
                        candidateNames,
                },

                minItems:
                    1,
            },

            reason: {
                type:
                    "string",
            },
        },

        required: [
            "tools",
            "reason",
        ],

        additionalProperties:
            false,
    };

    const system = `
You select the minimum sufficient Pi tools for exactly ONE already-classified operation.

The operation intent has already been determined.
Do not reinterpret the original objective into a different task.
Do not execute the objective.
Do not output tool-call arguments.

Rules:

1. Select only from CANDIDATES.
2. Read purpose, use_when, do_not_use_when and relationships.
3. Choose the minimum sufficient tool set.
4. Never choose a tool contradicted by do_not_use_when.
5. Do not choose redundant tools.
6. Do not choose mutation/execute tools unless the classified operation requires them.
7. currently_registered=false is allowed; the controller can load the required extension.
8. Copy tool names exactly.
9. Return only schema-conforming JSON.

No examples from unrelated tasks are provided deliberately.
`.trim();

    const body = {
        model:
            "qwen3.5:4b",

        stream:
            false,

        format:
            schema,

        think:
            false,

        keep_alive: -1,

        options: {
            temperature:
                0,

            top_p:
                1,
        },

        messages: [
            {
                role:
                    "system",

                content:
                    system,
            },

            {
                role:
                    "user",

                content:
                    "<INTENT>\n" +
                    intent +
                    "\n</INTENT>\n\n" +

                    "<OBJECTIVE>\n" +
                    objective +
                    "\n</OBJECTIVE>\n\n" +

                    "<CANDIDATES>\n" +
                    JSON.stringify(
                        candidates,
                        null,
                        2,
                    ) +
                    "\n</CANDIDATES>",
            },
        ],
    };

    const response =
        await fetch(
            "http://127.0.0.1:11434/api/chat",
            {
                method:
                    "POST",

                headers: {
                    "content-type":
                        "application/json",
                },

                body:
                    JSON.stringify(
                        body,
                    ),
            },
        );

    if (!response.ok) {
        throw new Error(
            `Qwen tool selector HTTP ${response.status}: ${await response.text()}`,
        );
    }

    const payload =
        (await response.json()) as {
            message?: {
                content?: string;
            };
        };

    const content =
        payload.message?.content;

    if (!content) {
        throw new Error(
            "Qwen tool selector returned no content.",
        );
    }

    const parsed =
        JSON.parse(
            content,
        ) as RouterReply;

    const state =
        normalizeRoute(
            parsed,
            objective,
            catalog,
        );

    writeFileSync(
        join(
            AGENT_DIR,
            "phase-router-last-qwen.json",
        ),
        JSON.stringify(
            {
                timestamp:
                    new Date()
                        .toISOString(),

                objective,

                intent,

                candidates,

                raw_content:
                    content,

                parsed,

                normalized:
                    state,

                second_stage:
                    true,
            },
            null,
            2,
        ),
        "utf8",
    );

    return state;
}


function applyTools(
    pi: ExtensionAPI,
    state: RouterState,
): string[] {
    const available =
        new Set(
            pi.getAllTools()
                .map(
                    (tool) =>
                        tool.name,
                ),
        );

    const requested =
        [...state.tools];

    const cycle =
        readCycleState();

    /*
     * Autonomous phases always receive:
     *
     * - mem_save:
     *   explicit persistence barrier.
     *
     * - phase_complete:
     *   internal terminal tool that refuses to close a phase until
     *   mem_save has produced a successful ACK for this phase.
     */
    if (
        cycle?.status === "running"
    ) {
        for (
            const required
            of [
                "mem_save",
                "phase_complete",
            ]
        ) {
            if (
                available.has(required) &&
                !requested.includes(required)
            ) {
                requested.push(required);
            }
        }
    }

    const active =
        [...new Set(requested)]
            .filter(
                (tool) =>
                    available.has(tool),
            );

    pi.setActiveTools(active);

    return active;
}



// ============================================================================
// PHASE_CYCLE_V1
// Autonomous ephemeral worker phases with explicit Engram persistence barrier.
// ============================================================================

type CycleStatus =
    | "running"
    | "done"
    | "blocked"
    | "error"
    | "stopped";

interface CycleMemoryAck {
    phase: number;
    observation_id: number;
    at: string;
}

interface CyclePhaseResult {
    phase: number;
    outcome: "completed" | "blocked";
    summary: string;
    relevant_files: string[];
    blockers: string[];
    memory_id: number;
    completed_at: string;
}

interface CycleHistoryEntry {
    phase: number;
    objective: string;
    outcome: "completed" | "blocked";
    summary: string;
    relevant_files: string[];
    blockers: string[];
    memory_id: number;
}

// ============================================================================
// EVIDENCE_PLAN_V1
//
// Qwen structures evidence sufficiency BEFORE the execution worker starts.
// The plan guides acquisition; it does not solve the engineering task.
// ============================================================================

interface EvidencePlanClaim {
    id: string;
    claim: string;
    evidence_target: string;
    source_hint: string;
    required: boolean;
}

interface EvidencePlan {
    task_id: string;
    phase: number;
    objective_fingerprint: string;

    reason: string;

    claims:
        EvidencePlanClaim[];

    diagnostics: {
        policy:
            | "required_once"
            | "optional_once"
            | "none";

        purpose: string;
    };

    stop_condition: string;

    created_at: string;
}


/*
 * PERSISTENT_RESUME_CHECKPOINT_V1
 *
 * Compact cross-session continuation state.
 *
 * A resumed execution always receives a NEW task_id. The checkpoint is
 * accepted only when the original objective fingerprint matches, preserving
 * task isolation while avoiding reacquisition of already verified evidence.
 */
interface ResumeCheckpoint {
    source_task_id: string;
    original_objective_fingerprint: string;
    source_status: string;
    source_phase: number;
    captured_at: string;

    completed_phases: Array<{
        phase: number;
        objective: string;
        outcome: string;
        summary: string;
        relevant_files: string[];
        memory_id: number | null;
    }>;

    prior_memory_ids: number[];

    verified_reads: string[];

    successful_evidence: Array<{
        tool: string;
        args: string;
        result: string;
    }>;

    diagnostics: Array<{
        tool: string;
        args: string;
        result: string;
    }>;

    avoid_repeating: string[];

    do_not_reacquire: string[];

    /*
     * SEMANTIC_RESUME_CHECKPOINT_V1
     */
    verified_facts: string[];
    validated_operations: string[];
    relevant_files: string[];
    unresolved_facts: string[];

    next_unresolved_action: string;

    recovery_summary: string;
}

interface CycleState {
    schema_version: "1.0";
    task_id: string;
    status: CycleStatus;

    original_objective: string;

    resume_checkpoint?:
        ResumeCheckpoint | null;

    phase: number;
    phase_objective: string;

    current_route?: RouterState;

    /*
     * EVIDENCE_PLAN_V1
     *
     * Freshly regenerated for every phase. Null means the phase does not
     * require an explicit evidence-sufficiency contract.
     */
    evidence_plan?:
        EvidencePlan | null;

    memory_ids: number[];

    last_memory_ack?: CycleMemoryAck | null;
    phase_result?: CyclePhaseResult | null;

    watchdog?: WatchdogState;
    watchdog_recovery?: WatchdogRecovery | null;
    watchdog_history?: WatchdogRecovery[];

    history: CycleHistoryEntry[];

    final_summary?: string;
    error?: string;

    created_at: string;
    updated_at: string;
}

interface FirstPhaseReply {
    phase_objective?: string;
    reason?: string;
}

interface CycleSupervisorReply {
    status?: "done" | "continue" | "blocked";
    next_objective?: string;
    reason?: string;
    final_summary?: string;
}


// ============================================================================
// PHASE_WATCHDOG_V1
// ============================================================================

// ============================================================================
// HARDENING_20260828_V1
//
// - GLIMMER_ANALYST_JSON_SCHEMA_V1
// - EVIDENCE_VALIDATION_BINDING_V1
// - ENGRAM_ACK_BARRIER_V1
// - READ_COVERAGE_V1
// - SUCCESS_RESULT_EVIDENCE_V1
// ============================================================================

interface WatchdogToolEvent {
    call_id: string;
    at: string;
    tool: string;
    signature: string;
    args_hint: string;
    is_error?: boolean;
    result_hint?: string;

    // READ_COVERAGE_V1
    read_path?: string;
    read_offset?: number;
    read_limit?: number;
    read_new_lines?: number;
    read_repeated_lines?: number;
    read_overlap_ratio?: number;
    read_redundant_count?: number;
}

interface WatchdogState {
    phase: number;
    started_at: string;

    tool_calls: number;
    turns: number;

    reviews: number;

    last_review_at?: string;
    last_review_tool_calls: number;

    last_context_tokens?: number;
    last_context_percent?: number;

    last_trigger?: string;
    last_decision?: string;

    /*
     * WATCHDOG_SEMANTIC_CHECKPOINT_V1
     *
     * Compact factual state synthesized from successful tool evidence.
     * This survives interruption and is reused by persistent resume.
     */
    semantic_checkpoint?: {
        verified_facts: string[];
        validated_operations: string[];
        relevant_files: string[];
        unresolved_facts: string[];
        continuation_objective: string;
        captured_at: string;
    };

    events: WatchdogToolEvent[];
}

interface WatchdogRecovery {
    phase: number;

    action:
        | "abort_reroute"
        | "blocked";

    trigger: string;
    reason: string;
    summary: string;

    next_objective: string;

    missing_information: string[];
    avoid_repeating: string[];

    /*
     * RECOVERY_EVIDENCE_V1
     * Evidence acquired by an interrupted worker before its context is
     * destroyed. This is evidence, not a conclusion.
     */
    evidence_snapshot?: any;

    at: string;
}

interface WatchdogDecision {
    action:
        | "continue"
        | "abort_reroute"
        | "blocked";

    reason: string;
    summary: string;
    next_objective: string;

    missing_information: string[];
    avoid_repeating: string[];

    /*
     * SEMANTIC_CONTINUATION_V1
     */
    verified_facts?: string[];
    validated_operations?: string[];
    relevant_files?: string[];
    unresolved_facts?: string[];
    continuation_objective?: string;
}

// ============================================================================
// END PHASE_WATCHDOG_V1 TYPES
// ============================================================================
const CYCLE_STATE_PATH =
    join(
        AGENT_DIR,
        "phase-cycle-state.json",
    );

const CYCLE_QWEN_TRACE_PATH =
    join(
        AGENT_DIR,
        "phase-cycle-last-qwen.json",
    );

const INTERNAL_PHASE_COMPLETE_TOOL =
    "phase_complete";

const MAX_CYCLE_PHASES =
    10;

const WATCHDOG_POLL_MS =
    1500;

const WATCHDOG_SOFT_CONTEXT_PERCENT =
    40;

const WATCHDOG_HARD_CONTEXT_PERCENT =
    70;

const WATCHDOG_SOFT_TOOL_CALLS =
    18;

const WATCHDOG_HARD_TOOL_CALLS =
    45;

const WATCHDOG_SOFT_TURNS =
    10;

const WATCHDOG_HARD_TURNS =
    24;

const WATCHDOG_SOFT_ELAPSED_MS =
    8 * 60 * 1000;

const WATCHDOG_HARD_ELAPSED_MS =
    20 * 60 * 1000;

const WATCHDOG_REVIEW_COOLDOWN_MS =
    30 * 1000;

const WATCHDOG_MAX_REVIEWS =
    3;


function clipCycleText(
    value: unknown,
    max: number,
): string {
    const text =
        String(value ?? "")
            .trim();

    if (
        text.length <= max
    ) {
        return text;
    }

    return (
        text.slice(
            0,
            Math.max(
                0,
                max - 3,
            ),
        ) +
        "..."
    );
}


function readCycleState():
    CycleState | null {
    if (
        !existsSync(
            CYCLE_STATE_PATH,
        )
    ) {
        return null;
    }

    try {
        const parsed =
            JSON.parse(
                readFileSync(
                    CYCLE_STATE_PATH,
                    "utf8",
                ),
            ) as CycleState;

        if (
            !parsed ||
            typeof parsed !== "object" ||
            typeof parsed.task_id !== "string"
        ) {
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}


function writeCycleState(
    state: CycleState,
): void {
    state.updated_at =
        new Date()
            .toISOString();

    writeFileSync(
        CYCLE_STATE_PATH,
        JSON.stringify(
            state,
            null,
            2,
        ),
        "utf8",
    );
}


function markCycleError(
    error: unknown,
): void {
    const cycle =
        readCycleState();

    if (!cycle) {
        return;
    }

    cycle.status =
        "error";

    cycle.error =
        clipCycleText(
            error instanceof Error
                ? error.message
                : String(error),
            1200,
        );

    writeCycleState(
        cycle,
    );
}


function extractEngramSaveId(
    result: any,
): number | null {
    const candidates = [
        result?.details?.data?.id,
        result?.details?.id,
        result?.data?.id,
    ];

    for (
        const candidate
        of candidates
    ) {
        const value =
            Number(candidate);

        if (
            Number.isInteger(value) &&
            value > 0
        ) {
            return value;
        }
    }

    /*
     * Fallback only.
     * Normal gentle-engram results expose details.data.id.
     */
    try {
        const serialized =
            JSON.stringify(
                result,
            );

        const saved =
            serialized.match(
                /saved\s*#\s*(\d+)/i,
            );

        if (saved) {
            const id =
                Number(saved[1]);

            if (
                Number.isInteger(id) &&
                id > 0
            ) {
                return id;
            }
        }
    } catch {
        // Strict barrier: no id means no ACK.
    }

    return null;
}


async function qwenCycleJson(
    schema: any,
    system: string,
    user: string,
    traceKind: string,
): Promise<any> {
    const body = {
        model:
            "qwen3.5:4b",

        stream:
            false,

        format:
            schema,

        think:
            false,

        keep_alive: -1,

        options: {
            temperature:
                0,

            top_p:
                1,
        },

        messages: [
            {
                role:
                    "system",

                content:
                    system,
            },

            {
                role:
                    "user",

                content:
                    user,
            },
        ],
    };

    const response =
        await fetch(
            "http://127.0.0.1:11434/api/chat",
            {
                method:
                    "POST",

                headers: {
                    "content-type":
                        "application/json",
                },

                body:
                    JSON.stringify(
                        body,
                    ),
            },
        );

    if (!response.ok) {
        const errorText =
            await response.text();

        writeFileSync(
            CYCLE_QWEN_TRACE_PATH,
            JSON.stringify(
                {
                    timestamp:
                        new Date()
                            .toISOString(),

                    kind:
                        traceKind,

                    http_status:
                        response.status,

                    error:
                        errorText,
                },
                null,
                2,
            ),
            "utf8",
        );

        throw new Error(
            `Qwen cycle HTTP ${response.status}: ${errorText}`,
        );
    }

    const payload =
        (await response.json()) as {
            message?: {
                content?: string;
            };
        };

    const content =
        payload.message?.content;

    if (!content) {
        throw new Error(
            "Qwen cycle supervisor returned no content.",
        );
    }

    let parsed: any;

    try {
        parsed =
            JSON.parse(
                content,
            );
    } catch (error) {
        writeFileSync(
            CYCLE_QWEN_TRACE_PATH,
            JSON.stringify(
                {
                    timestamp:
                        new Date()
                            .toISOString(),

                    kind:
                        traceKind,

                    raw_content:
                        content,

                    parse_error:
                        error instanceof Error
                            ? error.message
                            : String(error),
                },
                null,
                2,
            ),
            "utf8",
        );

        throw error;
    }

    writeFileSync(
        CYCLE_QWEN_TRACE_PATH,
        JSON.stringify(
            {
                timestamp:
                    new Date()
                        .toISOString(),

                kind:
                    traceKind,

                raw_content:
                    content,

                parsed,
            },
            null,
            2,
        ),
        "utf8",
    );

    return parsed;
}


async function chooseFirstPhaseObjective(
    originalObjective: string,
): Promise<{
    phaseObjective: string;
    reason: string;
}> {
    const schema = {
        type:
            "object",

        properties: {
            phase_objective: {
                type:
                    "string",

                minLength:
                    1,

                maxLength:
                    600,
            },

            reason: {
                type:
                    "string",

                maxLength:
                    300,
            },
        },

        required: [
            "phase_objective",
            "reason",
        ],

        additionalProperties:
            false,
    };

    const system = `
You are the phase planner for an autonomous Pi engineering task.

Choose ONLY the first bounded worker operation.

Rules:

1. Preserve the user's original objective exactly in meaning.
2. Do not solve the objective.
3. Do not choose tools.
4. Do not output commands.
5. One phase must represent one coherent bounded operation.
6. Do not combine independent retrieval, inspection, modification, testing,
   review, or execution operations into one phase when they can be separated.
7. Preserve exact identifiers, paths, observation IDs and constraints needed
   for the selected phase.
8. If the original objective is already one bounded operation, keep the phase
   objective materially equivalent to it.
9. The phase objective must be directly executable by a worker.
10. Return only schema-conforming JSON.
`.trim();

    const parsed =
        (await qwenCycleJson(
            schema,
            system,
            "<ORIGINAL_OBJECTIVE>\n" +
                originalObjective +
                "\n</ORIGINAL_OBJECTIVE>",
            "first_phase",
        )) as FirstPhaseReply;

    const phaseObjective =
        clipCycleText(
            parsed.phase_objective,
            600,
        );

    if (!phaseObjective) {
        throw new Error(
            "Qwen returned an empty first phase objective.",
        );
    }

    return {
        phaseObjective,

        reason:
            clipCycleText(
                parsed.reason,
                300,
            ),
    };
}


// ============================================================================
// EVIDENCE_PLAN_V1 CORE
// ============================================================================

async function buildEvidencePlan(
    cycle: CycleState,
): Promise<EvidencePlan | null> {
    const route =
        cycle.current_route;

    /*
     * First deployment is deliberately narrow.
     *
     * We are solving the observed failure mode in inspection/verification
     * phases before generalising the mechanism to implementation phases.
     */
    if (
        !route ||
        route.profile !==
            "inspect"
    ) {
        return null;
    }

    const objectiveFingerprint =
        phaseObjectiveFingerprint(
            cycle.phase_objective,
        );

    const schema = {
        type:
            "object",

        properties: {
            task_id: {
                type:
                    "string",

                enum: [
                    cycle.task_id,
                ],
            },

            phase: {
                type:
                    "integer",

                enum: [
                    cycle.phase,
                ],
            },

            objective_fingerprint: {
                type:
                    "string",

                enum: [
                    objectiveFingerprint,
                ],
            },

            applicable: {
                type:
                    "boolean",
            },

            reason: {
                type:
                    "string",

                maxLength:
                    700,
            },

            claims: {
                type:
                    "array",

                maxItems:
                    8,

                items: {
                    type:
                        "object",

                    properties: {
                        id: {
                            type:
                                "string",

                            maxLength:
                                24,
                        },

                        claim: {
                            type:
                                "string",

                            maxLength:
                                700,
                        },

                        evidence_target: {
                            type:
                                "string",

                            maxLength:
                                700,
                        },

                        source_hint: {
                            type:
                                "string",

                            maxLength:
                                500,
                        },

                        required: {
                            type:
                                "boolean",
                        },
                    },

                    required: [
                        "id",
                        "claim",
                        "evidence_target",
                        "source_hint",
                        "required",
                    ],

                    additionalProperties:
                        false,
                },
            },

            diagnostics: {
                type:
                    "object",

                properties: {
                    policy: {
                        type:
                            "string",

                        enum: [
                            "required_once",
                            "optional_once",
                            "none",
                        ],
                    },

                    purpose: {
                        type:
                            "string",

                        maxLength:
                            700,
                    },
                },

                required: [
                    "policy",
                    "purpose",
                ],

                additionalProperties:
                    false,
            },

            stop_condition: {
                type:
                    "string",

                maxLength:
                    1000,
            },
        },

        required: [
            "task_id",
            "phase",
            "objective_fingerprint",
            "applicable",
            "reason",
            "claims",
            "diagnostics",
            "stop_condition",
        ],

        additionalProperties:
            false,
    };

    const system = `
You are Qwen acting as an EVIDENCE PLANNER for a fresh Pi worker phase.

You are NOT the execution worker.
Do NOT solve the engineering task.
Do NOT invent source evidence.
Do NOT issue commands.

Your job is to decide WHAT concrete evidence is sufficient for the worker to
finish the current inspection/verification phase without open-ended exploration.

WHY THIS EXISTS

Execution workers can acquire correct evidence and nevertheless continue reading
because "enough evidence" was never defined. Your plan must convert that
subjective confidence problem into a bounded set of verifiable claims.

APPLICABILITY

Set applicable=true when the phase requires inspection, verification, audit,
comparison, architectural confirmation, or another judgement whose completion
depends on evidence sufficiency.

Set applicable=false for a trivial bounded acquisition such as:
- retrieve one known source range;
- return one known symbol;
- run one diagnostic whose result itself is the requested output.

CLAIMS

When applicable=true:

1. Produce between 1 and 8 claims.
2. Claims must collectively cover the material assertions that must be
   supported or contradicted to answer the PHASE OBJECTIVE.
3. Do not create generic claims such as "inspect the file".
4. Each claim must have a concrete evidence_target describing what source
   evidence would be sufficient.
5. Use source_hint only when a path, class, method, line, symbol, or region is
   already known from supplied evidence. Otherwise use an empty string.
6. Do not require whole-file coverage unless the objective genuinely requires
   it.
7. Do not split one fact into artificial micro-claims.

DIAGNOSTICS

Static diagnostics and source evidence have different semantics.

- Source evidence can establish implementation structure and behaviour.
- LSP/static diagnostics can identify errors, typing issues, symbols, and
  anomalies.
- Diagnostics do NOT by themselves prove an architectural responsibility.

Use:
- required_once when the user/objective explicitly requires static diagnostics;
- optional_once when diagnostics may materially affect the conclusion;
- none when diagnostics add no relevant evidence.

Never request repeated diagnostic runs merely for confidence.

STOP CONDITION

Define an explicit semantic stopping rule.

Normally:
"As soon as every required claim is either SUPPORTED or CONTRADICTED by concrete
evidence, stop acquiring evidence and synthesize the conclusion."

The stop condition MUST prevent additional reads or diagnostics performed only
to increase confidence after the required claims are already resolved.

BINDING

Copy task_id, phase, and objective_fingerprint EXACTLY from the supplied
planning context.

Return JSON only.
`.trim();

    const planningContext = {
        task_id:
            cycle.task_id,

        phase:
            cycle.phase,

        objective_fingerprint:
            objectiveFingerprint,

        original_objective:
            cycle.original_objective,

        phase_objective:
            cycle.phase_objective,

        route: {
            profile:
                route.profile,

            tools:
                route.tools,
        },

        completed_phase_evidence:
            compactCycleEvidence(
                cycle,
            ),

        interrupted_phase_evidence:
            allRecoveryEvidence(
                cycle,
            ),
    };

    phaseLog(
        "EVIDENCE_PLAN_START",
        {
            task_id:
                cycle.task_id,

            phase:
                cycle.phase,

            profile:
                route.profile,

            objective_fingerprint:
                objectiveFingerprint,
        },
    );

    const started =
        Date.now();

    const raw =
        await qwenCycleJson(
            schema,
            system,
            "<EVIDENCE_PLANNING_CONTEXT>\n" +
                JSON.stringify(
                    planningContext,
                    null,
                    2,
                ) +
                "\n</EVIDENCE_PLANNING_CONTEXT>",
            "evidence_plan",
        );

    const bindingMatches =
        String(
            raw.task_id ??
            "",
        ) ===
            cycle.task_id &&
        Number(
            raw.phase,
        ) ===
            cycle.phase &&
        String(
            raw.objective_fingerprint ??
            "",
        ) ===
            objectiveFingerprint;

    if (!bindingMatches) {
        phaseLog(
            "EVIDENCE_PLAN_BINDING_REJECTED",
            {
                expected: {
                    task_id:
                        cycle.task_id,

                    phase:
                        cycle.phase,

                    objective_fingerprint:
                        objectiveFingerprint,
                },

                received: {
                    task_id:
                        raw.task_id ??
                        null,

                    phase:
                        raw.phase ??
                        null,

                    objective_fingerprint:
                        raw.objective_fingerprint ??
                        null,
                },
            },
        );

        throw new Error(
            "Evidence plan response was not bound to the active task/phase.",
        );
    }

    if (
        raw.applicable !==
            true
    ) {
        phaseLog(
            "EVIDENCE_PLAN_SKIPPED",
            {
                phase:
                    cycle.phase,

                duration_ms:
                    Date.now() -
                    started,

                reason:
                    clipCycleText(
                        raw.reason,
                        700,
                    ),
            },
        );

        return null;
    }

    const claims =
        Array.isArray(
            raw.claims,
        )
            ? raw.claims
                  .filter(
                      (item: any) =>
                          item &&
                          typeof item ===
                              "object" &&
                          typeof item.id ===
                              "string" &&
                          typeof item.claim ===
                              "string" &&
                          typeof item.evidence_target ===
                              "string",
                  )
                  .map(
                      (
                          item: any,
                          index: number,
                      ): EvidencePlanClaim => ({
                          id:
                              clipCycleText(
                                  item.id,
                                  24,
                              ) ||
                              `C${index + 1}`,

                          claim:
                              clipCycleText(
                                  item.claim,
                                  700,
                              ),

                          evidence_target:
                              clipCycleText(
                                  item.evidence_target,
                                  700,
                              ),

                          source_hint:
                              clipCycleText(
                                  item.source_hint,
                                  500,
                              ),

                          required:
                              item.required !==
                              false,
                      }),
                  )
                  .slice(
                      0,
                      8,
                  )
            : [];

    if (
        claims.length ===
        0
    ) {
        throw new Error(
            "Evidence planner marked the phase applicable but returned no claims.",
        );
    }

    const rawPolicy =
        String(
            raw.diagnostics
                ?.policy ??
                "none",
        );

    const diagnosticPolicy:
        "required_once" |
        "optional_once" |
        "none" =
        rawPolicy ===
            "required_once"
            ? "required_once"
            : rawPolicy ===
                "optional_once"
              ? "optional_once"
              : "none";

    const stopCondition =
        clipCycleText(
            raw.stop_condition,
            1000,
        ) ||
        "As soon as every required claim is supported or contradicted by concrete evidence, stop acquiring evidence and synthesize the conclusion.";

    const plan:
        EvidencePlan = {
        task_id:
            cycle.task_id,

        phase:
            cycle.phase,

        objective_fingerprint:
            objectiveFingerprint,

        reason:
            clipCycleText(
                raw.reason,
                700,
            ),

        claims,

        diagnostics: {
            policy:
                diagnosticPolicy,

            purpose:
                clipCycleText(
                    raw.diagnostics
                        ?.purpose,
                    700,
                ),
        },

        stop_condition:
            stopCondition,

        created_at:
            new Date()
                .toISOString(),
    };

    phaseLog(
        "EVIDENCE_PLAN_CREATED",
        {
            task_id:
                plan.task_id,

            phase:
                plan.phase,

            claims:
                plan.claims.map(
                    (claim) => ({
                        id:
                            claim.id,

                        claim:
                            clipCycleText(
                                claim.claim,
                                220,
                            ),

                        evidence_target:
                            clipCycleText(
                                claim.evidence_target,
                                220,
                            ),
                    }),
                ),

            diagnostics:
                plan.diagnostics,

            stop_condition:
                clipCycleText(
                    plan.stop_condition,
                    500,
                ),

            duration_ms:
                Date.now() -
                started,
        },
    );

    return plan;
}


function formatEvidencePlanForWorker(
    plan: EvidencePlan,
): string {
    const claims =
        plan.claims
            .map(
                (
                    claim,
                    index,
                ) =>
                    [
                        `${index + 1}. ${claim.id}`,
                        `CLAIM: ${claim.claim}`,
                        `EVIDENCE SUFFICIENT WHEN: ${claim.evidence_target}`,
                        `SOURCE HINT: ${claim.source_hint || "NONE"}`,
                        `REQUIRED: ${claim.required ? "YES" : "NO"}`,
                    ].join(
                        "\n",
                    ),
            )
            .join(
                "\n\n",
            );

    return `
<EVIDENCE_PLAN>

This is a controller-approved evidence acquisition contract for this phase.

${claims}

DIAGNOSTICS POLICY:
${plan.diagnostics.policy}

DIAGNOSTICS PURPOSE:
${plan.diagnostics.purpose || "NONE"}

STOP CONDITION:
${plan.stop_condition}

EXECUTION RULES

1. Work claim-by-claim. Do not perform general exploratory coverage.

2. Before every source acquisition, determine internally which unresolved claim
   that tool call serves.

3. Do not make a read or diagnostic call that serves no unresolved claim.

4. After every successful evidence-producing tool result, update your internal
   claim status:
   - SUPPORTED
   - CONTRADICTED
   - STILL MISSING A SPECIFIC FACT

5. If a claim is STILL MISSING A SPECIFIC FACT, acquire only that fact.

6. Do not re-read evidence already available merely to increase confidence.

7. Different offsets do not constitute progress when they return evidence
   already sufficient for a resolved claim.

8. Source evidence and static diagnostics are not interchangeable.
   Diagnostics do not prove architectural behaviour by themselves.

9. Respect the diagnostics policy:
   - required_once: run one materially relevant diagnostics pass;
   - optional_once: run at most one pass and only if materially useful;
   - none: do not run diagnostics for this phase.

10. Once every REQUIRED claim is SUPPORTED or CONTRADICTED, evidence
    acquisition is COMPLETE.

11. After evidence acquisition is complete:
    - DO NOT read more source;
    - DO NOT run another diagnostic for confidence;
    - synthesize the answer;
    - persist the durable result with mem_save;
    - after a real Engram ACK, call phase_complete.

12. The objective is not maximum certainty or maximum source coverage.
    The objective is sufficient concrete evidence to resolve the defined claims.

</EVIDENCE_PLAN>
`.trim();
}


// ============================================================================
// END EVIDENCE_PLAN_V1 CORE
// ============================================================================


function compactCycleEvidence(
    cycle: CycleState,
): any {
    return {
        task_id:
            cycle.task_id,

        original_objective:
            cycle.original_objective,

        current_phase:
            cycle.phase,

        current_phase_objective:
            cycle.phase_objective,

        memory_ids:
            cycle.memory_ids,

        completed_phases:
            cycle.history.map(
                (entry) => ({
                    phase:
                        entry.phase,

                    objective:
                        entry.objective,

                    outcome:
                        entry.outcome,

                    summary:
                        clipCycleText(
                            entry.summary,
                            1800,
                        ),

                    relevant_files:
                        entry.relevant_files
                            .slice(
                                0,
                                12,
                            ),

                    blockers:
                        entry.blockers
                            .slice(
                                0,
                                8,
                            ),

                    memory_id:
                        entry.memory_id,
                }),
            ),
    };
}


async function superviseCycle(
    cycle: CycleState,
): Promise<CycleSupervisorReply> {
    const schema = {
        type:
            "object",

        properties: {
            status: {
                type:
                    "string",

                enum: [
                    "done",
                    "continue",
                    "blocked",
                ],
            },

            next_objective: {
                type:
                    "string",

                maxLength:
                    600,
            },

            reason: {
                type:
                    "string",

                maxLength:
                    500,
            },

            final_summary: {
                type:
                    "string",

                maxLength:
                    1500,
            },
        },

        required: [
            "status",
            "next_objective",
            "reason",
            "final_summary",
        ],

        additionalProperties:
            false,
    };

    const system = `
You supervise a sequence of ephemeral Pi worker phases.

You receive:
- the original user objective;
- compact evidence from already completed phases;
- Engram observation IDs created as persistence checkpoints.

Your job is ONLY to decide whether the original objective is complete and,
if not, define exactly ONE next bounded worker operation.

Rules:

1. Use only the supplied evidence.
2. Never invent completed work.
3. status="done" only if the ORIGINAL OBJECTIVE is fully satisfied.
4. status="continue" if concrete work remains and can proceed.
5. status="blocked" only when the remaining objective cannot currently proceed.
6. For continue, next_objective must describe exactly ONE coherent bounded
   operation.
7. Preserve exact file paths, IDs and constraints from the evidence when they
   are needed by the next phase.
8. Do not select tools. The separate router will do that.
9. Do not execute, reason through, or solve the engineering operation itself.
10. Do not repeat a completed phase.
11. final_summary must contain only evidence-backed conclusions.
12. Return only schema-conforming JSON.
`.trim();

    return (
        await qwenCycleJson(
            schema,
            system,
            "<CYCLE_EVIDENCE>\n" +
                JSON.stringify(
                    compactCycleEvidence(
                        cycle,
                    ),
                    null,
                    2,
                ) +
                "\n</CYCLE_EVIDENCE>",
            "supervisor",
        )
    ) as CycleSupervisorReply;
}


function buildWorkerKickoff(
    cycle: CycleState,
): string {
    const previous =
        cycle.history.length > 0
            ? cycle.history[
                  cycle.history.length - 1
              ]
            : undefined;

    const previousSummary =
        previous
            ? clipCycleText(
                  previous.summary,
                  1800,
              )
            : "NONE";

    const ids =
        cycle.memory_ids.length > 0
            ? cycle.memory_ids.join(", ")
            : "NONE";

    const recoveryEvidence =
        latestRecoveryEvidence(
            cycle,
        );

    const recoveryEvidenceText =
        recoveryEvidence
            ? JSON.stringify(
                  recoveryEvidence,
                  null,
                  2,
              )
            : "NONE";

    const resumeCheckpoint =
        cycle.resume_checkpoint ??
        null;

    const resumeCheckpointText =
        resumeCheckpoint
            ? JSON.stringify(
                  resumeCheckpoint,
                  null,
                  2,
              )
            : "NONE";

    if (resumeCheckpoint) {
        phaseLog(
            "RESUME_CHECKPOINT_INJECTED",
            {
                source_task_id:
                    resumeCheckpoint
                        .source_task_id,

                source_phase:
                    resumeCheckpoint
                        .source_phase,

                target_task_id:
                    cycle.task_id,

                target_phase:
                    cycle.phase,

                verified_reads:
                    resumeCheckpoint
                        .verified_reads
                        .length,

                successful_evidence:
                    resumeCheckpoint
                        .successful_evidence
                        .length,
            },
        );
    }

    if (recoveryEvidence) {
        phaseLog(
            "RECOVERY_EVIDENCE_INJECTED",
            {
                target_phase:
                    cycle.phase,

                source_phase:
                    recoveryEvidence
                        .source_phase ??
                    null,
            },
        );
    }

    return `
You are an ephemeral Pi worker executing exactly ONE bounded phase.

<ORIGINAL_OBJECTIVE>
${cycle.original_objective}
</ORIGINAL_OBJECTIVE>

<PHASE_NUMBER>
${cycle.phase}
</PHASE_NUMBER>

<PHASE_OBJECTIVE>
${cycle.phase_objective}
</PHASE_OBJECTIVE>

<PREVIOUS_PHASE_SUMMARY>
${previousSummary}
</PREVIOUS_PHASE_SUMMARY>

<PERSISTED_OBSERVATION_IDS>
${ids}
</PERSISTED_OBSERVATION_IDS>

<RECOVERY_EVIDENCE>
${recoveryEvidenceText}
</RECOVERY_EVIDENCE>

<RESUME_CHECKPOINT>
${resumeCheckpointText}
</RESUME_CHECKPOINT>

PERSISTENT RESUME CHECKPOINT CONTRACT

- RESUME_CHECKPOINT comes from a previous interrupted execution of the SAME
  original objective, verified by controller-side objective fingerprint.
- The current execution has a NEW task_id. Never treat the old task_id as the
  active task.
- Treat completed_phases, verified_reads, successful_evidence and diagnostics
  as already-acquired evidence.
- Treat verified_facts and validated_operations as compact controller-verified
  continuation evidence derived from successful prior tool results.
- Treat unresolved_facts as the remaining factual gaps from the last watchdog
  checkpoint.
- Use relevant_files to avoid rediscovering already-established file scope.
- DO NOT rediscover files listed in verified_reads merely to establish their
  location again.
- DO NOT repeat items listed in do_not_reacquire merely for confidence.
- A fresh read/test/diagnostic is justified only when:
  1. the current phase needs a specific fact not present in the checkpoint;
  2. a relevant file has been modified since that evidence was acquired; or
  3. the operation itself requires post-modification validation.
- Continue from next_unresolved_action using the supplied evidence.
- The checkpoint is evidence, not an engineering conclusion. Resolve only the
  facts still missing.
- Do not restart the original objective from discovery unless the checkpoint
  is demonstrably insufficient or stale.

RECOVERY EVIDENCE CONTRACT

- RECOVERY_EVIDENCE contains successful evidence acquired by an interrupted
  worker before its context was destroyed.
- Treat that evidence as already acquired.
- Do NOT call memory/file/diagnostic tools merely to reconfirm evidence already
  present there.
- A fresh tool call is justified only when you can identify a SPECIFIC missing
  fact required by PHASE_OBJECTIVE.
- RECOVERY_EVIDENCE is evidence, not a conclusion. You must still evaluate it.

OPERATING CONTRACT

- Work only on PHASE_OBJECTIVE.
- Do not expand into later phases.
- Use only the tools currently active.
- Do not repeat prior work unless PHASE_OBJECTIVE explicitly requires it.
- Persist only durable information needed by later phases.

MANDATORY PHASE TERMINATION

When this phase is complete or genuinely blocked:

1. Call mem_save EXACTLY ONCE.
2. Save a compact structured durable summary of this phase.
3. Wait for mem_save to return successfully.
4. Confirm that the save produced a real persistence ACK.
5. Only AFTER that ACK, call phase_complete.
6. phase_complete MUST be your final action.
7. Do not call mem_save and phase_complete in parallel.
8. Do not finish with ordinary prose instead of phase_complete.

If mem_save fails, DO NOT call phase_complete.
If the work is blocked, persist the blocker with mem_save and then call
phase_complete with outcome="blocked".

Keep phase_complete.summary factual, compact and sufficient for the next
phase. Do not include hidden reasoning.
`.trim();
}



// ============================================================================
// PHASE_WATCHDOG_V1 CORE
// ============================================================================

function newWatchdogState(
    phase: number,
): WatchdogState {
    return {
        phase,
        started_at:
            new Date()
                .toISOString(),

        tool_calls:
            0,

        turns:
            0,

        reviews:
            0,

        last_review_tool_calls:
            0,

        events:
            [],
    };
}


function ensureWatchdogState(
    cycle: CycleState,
): WatchdogState {
    if (
        !cycle.watchdog ||
        cycle.watchdog.phase !==
            cycle.phase
    ) {
        cycle.watchdog =
            newWatchdogState(
                cycle.phase,
            );
    }

    return cycle.watchdog;
}


function canonicalWatchdogValue(
    value: any,
    depth = 0,
): any {
    if (
        depth > 6
    ) {
        return "[depth-limit]";
    }

    if (
        value === null ||
        value === undefined ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
    ) {
        return value;
    }

    if (
        Array.isArray(value)
    ) {
        return value.map(
            (item) =>
                canonicalWatchdogValue(
                    item,
                    depth + 1,
                ),
        );
    }

    if (
        typeof value === "object"
    ) {
        const result:
            Record<string, any> = {};

        for (
            const key
            of Object.keys(value)
                .sort()
        ) {
            result[key] =
                canonicalWatchdogValue(
                    value[key],
                    depth + 1,
                );
        }

        return result;
    }

    return String(value);
}


function watchdogJson(
    value: unknown,
    max = 800,
): string {
    try {
        return clipCycleText(
            JSON.stringify(
                canonicalWatchdogValue(
                    value,
                ),
            ),
            max,
        );
    } catch {
        return clipCycleText(
            String(value ?? ""),
            max,
        );
    }
}


function watchdogSignature(
    toolName: string,
    args: unknown,
): string {
    return (
        toolName +
        ":" +
        watchdogJson(
            args,
            900,
        )
    );
}


function watchdogTailRepeats(
    values: string[],
    patternSize: number,
    repetitions: number,
): boolean {
    const required =
        patternSize *
        repetitions;

    if (
        values.length <
        required
    ) {
        return false;
    }

    const tail =
        values.slice(
            -patternSize,
        );

    for (
        let repetition = 2;
        repetition <= repetitions;
        repetition++
    ) {
        const start =
            values.length -
            patternSize *
                repetition;

        const candidate =
            values.slice(
                start,
                start +
                    patternSize,
            );

        if (
            candidate.length !==
            tail.length
        ) {
            return false;
        }

        for (
            let i = 0;
            i < tail.length;
            i++
        ) {
            if (
                candidate[i] !==
                tail[i]
            ) {
                return false;
            }
        }
    }

    return true;
}


function evaluateWatchdog(
    cycle: CycleState,
    usage: any,
    model: any,
): {
    suspicious: boolean;
    hard: boolean;
    trigger: string;
    metrics: any;
} {
    const watchdog =
        ensureWatchdogState(
            cycle,
        );

    const now =
        Date.now();

    const started =
        Date.parse(
            watchdog.started_at,
        );

    const elapsedMs =
        Number.isFinite(started)
            ? now - started
            : 0;

    const contextTokens =
        Number(
            usage?.tokens ??
            0,
        );

    const contextWindow =
        Number(
            model?.contextWindow ??
            65536,
        );

    const contextPercent =
        contextWindow > 0
            ? (
                contextTokens /
                contextWindow
              ) * 100
            : 0;

    watchdog.last_context_tokens =
        contextTokens;

    watchdog.last_context_percent =
        contextPercent;

    const events =
        watchdog.events;

    const signatures =
        events.map(
            (event) =>
                event.signature,
        );

    const lastSignature =
        signatures.length > 0
            ? signatures[
                  signatures.length - 1
              ]
            : undefined;

    const recentSignatures =
        signatures.slice(
            -10,
        );

    const sameRecentCall =
        lastSignature
            ? recentSignatures.filter(
                  (signature) =>
                      signature ===
                      lastSignature,
              ).length
            : 0;

    const repeat2x3 =
        watchdogTailRepeats(
            signatures,
            2,
            3,
        );

    const repeat3x3 =
        watchdogTailRepeats(
            signatures,
            3,
            3,
        );

    const repeat2x4 =
        watchdogTailRepeats(
            signatures,
            2,
            4,
        );

    const repeat3x4 =
        watchdogTailRepeats(
            signatures,
            3,
            4,
        );

    const errorEvents =
        events
            .filter(
                (event) =>
                    event.is_error &&
                    event.result_hint,
            )
            .slice(
                -12,
            );

    const lastError =
        errorEvents.length > 0
            ? (
                errorEvents[
                    errorEvents.length - 1
                ].tool +
                ":" +
                errorEvents[
                    errorEvents.length - 1
                ].result_hint
              )
            : undefined;

    const sameRecentError =
        lastError
            ? errorEvents.filter(
                  (event) =>
                      (
                          event.tool +
                          ":" +
                          event.result_hint
                      ) ===
                      lastError,
              ).length
            : 0;

    const callsSinceReview =
        watchdog.tool_calls -
        watchdog.last_review_tool_calls;

    const recentReadEvents =
        events
            .filter(
                (event) =>
                    event.tool ===
                        "read" &&
                    event.read_path,
            )
            .slice(
                -16,
            );

    const latestReadEvent =
        recentReadEvents.length > 0
            ? recentReadEvents[
                  recentReadEvents.length -
                  1
              ]
            : undefined;

    const latestReadOverlap =
        Number(
            latestReadEvent
                ?.read_overlap_ratio ??
                0,
        );

    const latestReadRedundantCount =
        Number(
            latestReadEvent
                ?.read_redundant_count ??
                0,
        );

    const hardReasons:
        string[] = [];

    const softReasons:
        string[] = [];

    if (
        sameRecentCall >= 5
    ) {
        hardReasons.push(
            `same tool call repeated ${sameRecentCall} times`,
        );
    } else if (
        sameRecentCall >= 3
    ) {
        softReasons.push(
            `same tool call repeated ${sameRecentCall} times`,
        );
    }

    if (
        repeat2x4 ||
        repeat3x4
    ) {
        hardReasons.push(
            "repeating tool sequence detected",
        );
    } else if (
        repeat2x3 ||
        repeat3x3
    ) {
        softReasons.push(
            "possible repeating tool sequence",
        );
    }

    // READ_COVERAGE_V1
    //
    // Strong overlap is semantic repetition even when the offset/limit
    // arguments differ. The second strongly redundant read causes review;
    // the third becomes a hard reroute trigger.
    if (
        latestReadEvent &&
        latestReadOverlap >=
            0.70
    ) {
        if (
            latestReadRedundantCount >=
            3
        ) {
            hardReasons.push(
                `read coverage strongly redundant ${latestReadRedundantCount} times for ${latestReadEvent.read_path} (${(latestReadOverlap * 100).toFixed(0)}% overlap on latest read)`,
            );
        } else if (
            latestReadRedundantCount >=
            2
        ) {
            softReasons.push(
                `read coverage strongly redundant ${latestReadRedundantCount} times for ${latestReadEvent.read_path} (${(latestReadOverlap * 100).toFixed(0)}% overlap on latest read)`,
            );
        }
    }

    if (
        sameRecentError >= 5
    ) {
        hardReasons.push(
            `same tool error repeated ${sameRecentError} times`,
        );
    } else if (
        sameRecentError >= 3
    ) {
        softReasons.push(
            `same tool error repeated ${sameRecentError} times`,
        );
    }

    if (
        watchdog.tool_calls >=
        WATCHDOG_HARD_TOOL_CALLS
    ) {
        hardReasons.push(
            `phase reached ${watchdog.tool_calls} tool calls`,
        );
    } else if (
        callsSinceReview >=
        WATCHDOG_SOFT_TOOL_CALLS
    ) {
        softReasons.push(
            `${callsSinceReview} tool calls since last review`,
        );
    }

    if (
        watchdog.turns >=
        WATCHDOG_HARD_TURNS
    ) {
        hardReasons.push(
            `phase reached ${watchdog.turns} turns`,
        );
    } else if (
        watchdog.turns >=
        WATCHDOG_SOFT_TURNS
    ) {
        softReasons.push(
            `phase reached ${watchdog.turns} turns`,
        );
    }

    if (
        contextPercent >=
        WATCHDOG_HARD_CONTEXT_PERCENT
    ) {
        hardReasons.push(
            `context ${contextPercent.toFixed(1)}%`,
        );
    } else if (
        contextPercent >=
        WATCHDOG_SOFT_CONTEXT_PERCENT
    ) {
        softReasons.push(
            `context ${contextPercent.toFixed(1)}%`,
        );
    }

    if (
        elapsedMs >=
        WATCHDOG_HARD_ELAPSED_MS
    ) {
        hardReasons.push(
            `phase running ${(elapsedMs / 60000).toFixed(1)} minutes`,
        );
    } else if (
        elapsedMs >=
        WATCHDOG_SOFT_ELAPSED_MS
    ) {
        softReasons.push(
            `phase running ${(elapsedMs / 60000).toFixed(1)} minutes`,
        );
    }

    // WATCHDOG_ELAPSED_GUARD_V1
    //
    // Repeated reviews caused ONLY by elapsed time must never manufacture
    // a hard failure. Time has its own explicit hard threshold above.
    //
    // Review-count escalation is allowed only when at least one non-time
    // structural signal remains present: repetition, errors, tool/turn
    // pressure, context pressure, redundant reads, etc.
    const nonElapsedSoftReasons =
        softReasons.filter(
            (reason) =>
                !reason.startsWith(
                    "phase running ",
                ),
        );

    /*
     * WATCHDOG_REVIEW_PROGRESS_GUARD_V1
     *
     * Review count alone must not turn a soft suspicion into a hard failure
     * while the worker is still producing new execution evidence.
     *
     * Observed failure:
     * three consecutive Qwen reviews all returned "continue" and the worker
     * kept discovering/reading new files, but the next evaluation became hard
     * only because WATCHDOG_MAX_REVIEWS had been reached while context pressure
     * remained as a soft reason.
     *
     * Escalate by review count only when the worker has made no new tool calls
     * since the previous review. Independent explicit hard limits remain
     * unaffected.
     */
    /*
     * WATCHDOG_STRUCTURAL_ESCALATION_V1
     *
     * Review-count escalation is reserved for evidence of an actual
     * structural loop/degradation. Context, turn-count and generic tool
     * pressure already have independent explicit HARD thresholds and must
     * not become hard merely because several reviews occurred.
     */
    const structuralEscalationReasons =
        nonElapsedSoftReasons.filter(
            (reason) =>
                reason.startsWith(
                    "same tool call repeated ",
                ) ||
                reason ===
                    "possible repeating tool sequence" ||
                reason.startsWith(
                    "read coverage strongly redundant ",
                ) ||
                reason.startsWith(
                    "same tool error repeated ",
                ),
        );

    const reviewCountCanEscalate =
        watchdog.reviews >=
            WATCHDOG_MAX_REVIEWS &&
        structuralEscalationReasons.length >
            0 &&
        callsSinceReview <=
            0;

    if (reviewCountCanEscalate) {
        hardReasons.push(
            `worker remained structurally suspicious after ${watchdog.reviews} Qwen reviews without new tool progress: ${structuralEscalationReasons.join("; ")}`,
        );
    }

    const hard =
        hardReasons.length > 0;

    const suspicious =
        hard ||
        softReasons.length > 0;

    return {
        suspicious,
        hard,

        trigger:
            (
                hard
                    ? hardReasons
                    : softReasons
            ).join("; "),

        metrics: {
            elapsed_ms:
                elapsedMs,

            tool_calls:
                watchdog.tool_calls,

            turns:
                watchdog.turns,

            context_tokens:
                contextTokens,

            context_window:
                contextWindow,

            context_percent:
                Number(
                    contextPercent
                        .toFixed(1),
                ),

            reviews:
                watchdog.reviews,

            same_recent_call:
                sameRecentCall,

            same_recent_error:
                sameRecentError,

            repeated_sequence:
                repeat2x3 ||
                repeat3x3,

            non_elapsed_soft_reasons:
                nonElapsedSoftReasons,

            latest_read:
                latestReadEvent
                    ? {
                          path:
                              latestReadEvent
                                  .read_path,

                          offset:
                              latestReadEvent
                                  .read_offset,

                          limit:
                              latestReadEvent
                                  .read_limit,

                          new_lines:
                              latestReadEvent
                                  .read_new_lines,

                          repeated_lines:
                              latestReadEvent
                                  .read_repeated_lines,

                          overlap_ratio:
                              latestReadEvent
                                  .read_overlap_ratio,

                          redundant_count:
                              latestReadEvent
                                  .read_redundant_count,
                      }
                    : null,
        },
    };
}


async function reviewWatchdog(
    cycle: CycleState,
    trigger: string,
    hard: boolean,
    metrics: any,
): Promise<WatchdogDecision> {
    const actionEnum =
        hard
            ? [
                  "abort_reroute",
                  "blocked",
              ]
            : [
                  "continue",
                  "abort_reroute",
                  "blocked",
              ];

    /*
     * READ_COVERAGE_V1:
     * metrics.latest_read describes semantic source overlap. Treat >= 0.70
     * overlap as strongly redundant unless there is a concrete reason that
     * the repeated region supplies a previously missing fact. Different
     * offset/limit arguments do not by themselves constitute progress.
     */
    const schema = {
        type:
            "object",

        properties: {
            action: {
                type:
                    "string",

                enum:
                    actionEnum,
            },

            reason: {
                type:
                    "string",

                maxLength:
                    800,
            },

            summary: {
                type:
                    "string",

                maxLength:
                    1600,
            },

            next_objective: {
                type:
                    "string",

                maxLength:
                    700,
            },

            missing_information: {
                type:
                    "array",

                items: {
                    type:
                        "string",
                    maxLength:
                        400,
                },

                maxItems:
                    12,
            },

            avoid_repeating: {
                type:
                    "array",

                items: {
                    type:
                        "string",
                    maxLength:
                        400,
                },

                maxItems:
                    12,
            },

            verified_facts: {
                type:
                    "array",
                items: {
                    type:
                        "string",
                    maxLength:
                        700,
                },
                maxItems:
                    16,
            },

            validated_operations: {
                type:
                    "array",
                items: {
                    type:
                        "string",
                    maxLength:
                        700,
                },
                maxItems:
                    12,
            },

            relevant_files: {
                type:
                    "array",
                items: {
                    type:
                        "string",
                    maxLength:
                        700,
                },
                maxItems:
                    16,
            },

            unresolved_facts: {
                type:
                    "array",
                items: {
                    type:
                        "string",
                    maxLength:
                        700,
                },
                maxItems:
                    16,
            },

            continuation_objective: {
                type:
                    "string",
                maxLength:
                    900,
            },
        },

        required: [
            "action",
            "reason",
            "summary",
            "next_objective",
            "missing_information",
            "avoid_repeating",
            "verified_facts",
            "validated_operations",
            "relevant_files",
            "unresolved_facts",
            "continuation_objective",
        ],

        additionalProperties:
            false,
    };

    const system = `
You are Qwen, the external watchdog supervising an active Pi worker.

Determine whether the worker is making useful progress or is stuck.

You are NOT the worker.
Do not execute tools.
Do not solve the engineering task.
Use only the supplied telemetry and task state.

Actions:

continue
- There is credible evidence of progress.
- Use only for a SOFT watchdog trigger.

abort_reroute
- The worker is looping, repeatedly failing, consuming context without
  convergence, or lacks information needed for the current strategy.
- Provide one bounded next_objective for a fresh context.
- The next objective must avoid the failed/repeated strategy and preserve
  exact identifiers, files and useful evidence.

blocked
- Progress cannot continue without information or capability that is
  genuinely unavailable.

Rules:

1. A HARD trigger cannot be continued.
2. Repeated identical tool calls or repeated identical errors are strong
   evidence of a loop.
3. High token/context usage alone is a warning, not proof; examine the
   activity evidence.
4. If information is missing but can be obtained by another bounded phase,
   choose abort_reroute rather than blocked.
5. next_objective must be self-contained enough for a fresh worker context.
6. Explicitly identify information that is missing.
7. Explicitly identify actions/strategies that should not be repeated.
8. Successful tool results are evidence. Use their result fields to distinguish
   already verified facts from work that is still unresolved.
9. Never recommend reacquiring a fact already demonstrated by a successful
   tool result unless later evidence makes it stale or contradictory.
10. Build a compact semantic continuation checkpoint:
    - verified_facts: facts directly supported by successful tool results;
    - validated_operations: tests, diagnostics, builds or checks already executed,
      including their observed outcome;
    - relevant_files: concrete files whose content or role was established;
    - unresolved_facts: specific facts still needed to finish the phase;
    - continuation_objective: the smallest useful next action from the CURRENT
      progress point. Do not restate the original discovery objective.
11. previous_semantic_checkpoint, when present, is the accumulated factual state
    from the preceding review of this SAME active phase. Return a COMPLETE updated
    checkpoint, not merely facts from recent_tool_activity.
12. Preserve prior verified facts, validated operations and relevant files unless
    newer supplied evidence specifically contradicts them or makes them stale.
13. Remove an unresolved fact when supplied evidence has resolved it. Add newly
    demonstrated facts and newly identified unresolved facts as appropriate.
14. Do not infer facts that are absent from either successful supplied evidence
    or the previous semantic checkpoint.
15. Return only schema-conforming JSON.
`.trim();

    const watchdog =
        ensureWatchdogState(
            cycle,
        );

    const recentEvents =
        watchdog.events
            .slice(
                -14,
            )
            .map(
                (event) => ({
                    tool:
                        event.tool,

                    args:
                        event.args_hint,

                    /*
                     * WATCHDOG_SUCCESS_EVIDENCE_V1
                     *
                     * Qwen must see successful tool evidence, not merely the
                     * fact that a tool was called. Otherwise it cannot retain
                     * verified facts across reviews or build a meaningful
                     * continuation checkpoint.
                     */
                    result:
                        !event.is_error
                            ? clipCycleText(
                                  event.result_hint,
                                  1800,
                              )
                            : undefined,

                    error:
                        event.is_error
                            ? clipCycleText(
                                  event.result_hint,
                                  1200,
                              )
                            : undefined,

                    read_path:
                        event.read_path,
                }),
            );

    const user =
        "<WATCHDOG_STATE>\n" +
        JSON.stringify(
            {
                original_objective:
                    cycle.original_objective,

                phase:
                    cycle.phase,

                phase_objective:
                    cycle.phase_objective,

                trigger,

                hard_limit:
                    hard,

                metrics,

                recent_tool_activity:
                    recentEvents,

                /*
                 * WATCHDOG_SEMANTIC_CARRY_FORWARD_V1
                 *
                 * Give Qwen the previous semantic checkpoint so each review
                 * updates accumulated verified knowledge instead of replacing
                 * it from only the latest telemetry window.
                 */
                previous_semantic_checkpoint:
                    watchdog.semantic_checkpoint ??
                    null,

                persisted_memory_ids:
                    cycle.memory_ids,

                completed_phase_summaries:
                    cycle.history
                        .slice(
                            -3,
                        )
                        .map(
                            (entry) => ({
                                phase:
                                    entry.phase,

                                objective:
                                    entry.objective,

                                summary:
                                    clipCycleText(
                                        entry.summary,
                                        1000,
                                    ),

                                memory_id:
                                    entry.memory_id,
                            }),
                        ),
            },
            null,
            2,
        ) +
        "\n</WATCHDOG_STATE>";

    return (
        await qwenCycleJson(
            schema,
            system,
            user,
            "watchdog",
        )
    ) as WatchdogDecision;
}



// ============================================================================
// COGNITIVE_RECOVERY_V1
//
// Escalation:
// Qwen watchdog
//   -> Glimmer analyst (reasoning only, no project tools)
//   -> Qwen validation/global replan
//   -> abort_reroute or verified blocked
// ============================================================================

interface GlimmerRecoveryAnalysis {
    root_cause: string;
    evidence: string[];
    strategy: string;
    next_objective: string;
    required_tools: string[];
    avoid_repeating: string[];
    confidence: number;
}


function parseRecoveryJson(
    value: string,
): any {
    const text =
        String(value ?? "")
            .trim();

    try {
        return JSON.parse(
            text,
        );
    } catch {
        const first =
            text.indexOf("{");

        const last =
            text.lastIndexOf("}");

        if (
            first < 0 ||
            last <= first
        ) {
            throw new Error(
                "Glimmer analyst did not return a JSON object.",
            );
        }

        return JSON.parse(
            text.slice(
                first,
                last + 1,
            ),
        );
    }
}


function buildWatchdogFailureDossier(
    cycle: CycleState,
    trigger: string,
    metrics: any,
    qwenDecision: WatchdogDecision,
): any {
    const watchdog =
        ensureWatchdogState(
            cycle,
        );

    return {
        original_objective:
            cycle.original_objective,

        current_phase:
            cycle.phase,

        current_phase_objective:
            cycle.phase_objective,

        current_route:
            cycle.current_route,

        trigger,

        metrics,

        qwen_local_review: {
            action:
                qwenDecision.action,

            reason:
                qwenDecision.reason,

            summary:
                qwenDecision.summary,

            proposed_next_objective:
                qwenDecision.next_objective,

            missing_information:
                qwenDecision.missing_information,

            avoid_repeating:
                qwenDecision.avoid_repeating,
        },

        completed_phases:
            cycle.history
                .slice(
                    -6,
                )
                .map(
                    (entry) => ({
                        phase:
                            entry.phase,

                        objective:
                            entry.objective,

                        outcome:
                            entry.outcome,

                        summary:
                            clipCycleText(
                                entry.summary,
                                1800,
                            ),

                        relevant_files:
                            entry.relevant_files,

                        blockers:
                            entry.blockers,

                        memory_id:
                            entry.memory_id,
                    }),
                ),

        persisted_memory_ids:
            cycle.memory_ids,

        active_route_tools:
            cycle.current_route?.tools ??
            [],

        watchdog: {
            tool_calls:
                watchdog.tool_calls,

            turns:
                watchdog.turns,

            reviews:
                watchdog.reviews,

            context_tokens:
                watchdog.last_context_tokens,

            context_percent:
                watchdog.last_context_percent,

            recent_activity:
                watchdog.events
                    .slice(
                        -24,
                    )
                    .map(
                        (event) => ({
                            tool:
                                event.tool,

                            args:
                                event.args_hint,

                            is_error:
                                event.is_error,

                            result:
                                event.result_hint,
                        }),
                    ),
        },

        instruction:
            "Find a materially different way to finish the original task. " +
            "Do not merely recommend retrying the same reads, diagnostics, " +
            "or reasoning pattern.",
    };
}



// ============================================================================
// HARDENING HELPERS
// ============================================================================

function phaseObjectiveFingerprint(
    value: string,
): string {
    /*
     * Deterministic FNV-1a 32-bit fingerprint.
     *
     * This is not a security hash. It is a controller-side binding token used
     * to detect stale/cross-task validator responses.
     */
    let hash =
        0x811c9dc5;

    const text =
        String(value ?? "");

    for (
        let index = 0;
        index < text.length;
        index++
    ) {
        hash ^=
            text.charCodeAt(
                index,
            );

        hash =
            Math.imul(
                hash,
                0x01000193,
            );
    }

    return (
        "fnv1a32:" +
        (
            hash >>> 0
        )
            .toString(16)
            .padStart(
                8,
                "0",
            )
    );
}


function originalObjectiveResumeFingerprint(
    value: string,
): string {
    /*
     * Normalize only transport-level differences. Semantic/textual changes
     * still produce another fingerprint and therefore another clean task.
     */
    const normalized =
        String(value ?? "")
            .replace(
                /\r\n/g,
                "\n",
            )
            .trim();

    return phaseObjectiveFingerprint(
        normalized,
    );
}


function resumeReadPathFromArgs(
    value: unknown,
): string | null {
    try {
        const parsed =
            typeof value === "string"
                ? JSON.parse(value)
                : value;

        const path =
            (parsed as any)
                ?.path;

        return typeof path === "string" &&
            path.trim().length > 0
            ? path.trim()
            : null;
    } catch {
        return null;
    }
}


function buildPersistentResumeCheckpoint(
    previous:
        CycleState | null,
    incomingObjective:
        string,
): ResumeCheckpoint | null {
    if (!previous) {
        return null;
    }

    /*
     * A fully completed objective starts clean when explicitly launched again.
     * Resume is intended for interrupted, blocked or otherwise unfinished work.
     */
    if (
        String(
            (previous as any)
                .status ?? "",
        ) === "done"
    ) {
        return null;
    }

    const previousFingerprint =
        originalObjectiveResumeFingerprint(
            previous.original_objective,
        );

    const incomingFingerprint =
        originalObjectiveResumeFingerprint(
            incomingObjective,
        );

    if (
        previousFingerprint !==
        incomingFingerprint
    ) {
        return null;
    }

    const watchdogEvents =
        Array.isArray(
            previous.watchdog?.events,
        )
            ? previous.watchdog!
                  .events
            : [];

    const previousRecoveryEvidence =
        latestRecoveryEvidence(
            previous,
        );

    const currentSuccessful =
        watchdogEvents
            .filter(
                (event) =>
                    !event.is_error,
            )
            .slice(
                -18,
            )
            .map(
                (event) => ({
                    tool:
                        String(
                            event.tool ??
                            "",
                        ),

                    args:
                        clipCycleText(
                            event.args_hint,
                            700,
                        ),

                    result:
                        clipCycleText(
                            event.result_hint,
                            900,
                        ),
                }),
            );

    const recoveredSuccessful =
        Array.isArray(
            previousRecoveryEvidence
                ?.successful_tool_evidence,
        )
            ? previousRecoveryEvidence
                  .successful_tool_evidence
                  .slice(
                      -12,
                  )
                  .map(
                      (event: any) => ({
                          tool:
                              String(
                                  event?.tool ??
                                  "",
                              ),

                          args:
                              clipCycleText(
                                  event?.args,
                                  700,
                              ),

                          result:
                              clipCycleText(
                                  event?.result,
                                  900,
                              ),
                      }),
                  )
            : [];

    const successfulEvidence =
        [
            ...recoveredSuccessful,
            ...currentSuccessful,
        ]
            .filter(
                (item) =>
                    item.tool.length > 0,
            )
            .slice(
                -20,
            );

    const currentReadPaths =
        watchdogEvents
            .filter(
                (event) =>
                    event.tool ===
                        "read" &&
                    !event.is_error &&
                    typeof event.read_path ===
                        "string",
            )
            .map(
                (event) =>
                    String(
                        event.read_path,
                    ),
            );

    const recoveredReadPaths =
        Array.isArray(
            previousRecoveryEvidence
                ?.source_reads,
        )
            ? previousRecoveryEvidence
                  .source_reads
                  .map(
                      (event: any) => {
                          const explicitPath =
                              String(
                                  event?.path ??
                                  "",
                              ).trim();

                          if (
                              explicitPath.length >
                              0
                          ) {
                              return explicitPath;
                          }

                          /*
                           * Legacy snapshots may not have path yet.
                           */
                          return resumeReadPathFromArgs(
                              event?.args,
                          );
                      },
                  )
                  .filter(
                      (
                          value: string | null,
                      ): value is string =>
                          Boolean(value),
                  )
            : [];

    const verifiedReads =
        Array.from(
            new Set(
                [
                    ...recoveredReadPaths,
                    ...currentReadPaths,
                ],
            ),
        ).slice(
            -20,
        );

    const diagnostics =
        watchdogEvents
            .filter(
                (event) =>
                    !event.is_error &&
                    (
                        event.tool ===
                            "lens_diagnostics" ||
                        event.tool.includes(
                            "diagnostic",
                        )
                    ),
            )
            .slice(
                -8,
            )
            .map(
                (event) => ({
                    tool:
                        String(
                            event.tool,
                        ),

                    args:
                        clipCycleText(
                            event.args_hint,
                            700,
                        ),

                    result:
                        clipCycleText(
                            event.result_hint,
                            900,
                        ),
                }),
            );

    const recovery =
        previous.watchdog_recovery;

    const semanticCheckpoint =
        previous.watchdog
            ?.semantic_checkpoint;

    const semanticVerifiedFacts =
        Array.isArray(
            semanticCheckpoint
                ?.verified_facts,
        )
            ? semanticCheckpoint!
                  .verified_facts
                  .slice(
                      0,
                      16,
                  )
            : [];

    const semanticValidatedOperations =
        Array.isArray(
            semanticCheckpoint
                ?.validated_operations,
        )
            ? semanticCheckpoint!
                  .validated_operations
                  .slice(
                      0,
                      12,
                  )
            : [];

    const semanticRelevantFiles =
        Array.isArray(
            semanticCheckpoint
                ?.relevant_files,
        )
            ? semanticCheckpoint!
                  .relevant_files
                  .slice(
                      0,
                      16,
                  )
            : [];

    const semanticUnresolvedFacts =
        Array.isArray(
            semanticCheckpoint
                ?.unresolved_facts,
        )
            ? semanticCheckpoint!
                  .unresolved_facts
                  .slice(
                      0,
                      16,
                  )
            : [];

    const avoidRepeating =
        Array.from(
            new Set(
                Array.isArray(
                    recovery
                        ?.avoid_repeating,
                )
                    ? recovery!
                          .avoid_repeating
                          .map(
                              (value) =>
                                  clipCycleText(
                                      value,
                                      500,
                                  ),
                          )
                    : [],
            ),
        ).slice(
            0,
            16,
        );

    const doNotReacquire =
        Array.from(
            new Set(
                [
                    ...verifiedReads,
                    ...avoidRepeating,
                ],
            ),
        ).slice(
            0,
            28,
        );

    const completedPhases =
        previous.history
            .slice(
                -8,
            )
            .map(
                (entry) => ({
                    phase:
                        entry.phase,

                    objective:
                        clipCycleText(
                            entry.objective,
                            900,
                        ),

                    outcome:
                        String(
                            entry.outcome ??
                            "",
                        ),

                    summary:
                        clipCycleText(
                            entry.summary,
                            1800,
                        ),

                    relevant_files:
                        Array.isArray(
                            entry.relevant_files,
                        )
                            ? entry
                                  .relevant_files
                                  .slice(
                                      0,
                                      12,
                                  )
                            : [],

                    memory_id:
                        Number.isInteger(
                            entry.memory_id,
                        )
                            ? entry.memory_id
                            : null,
                }),
            );

    /*
     * Resume the phase that was actually in progress.
     *
     * We deliberately do NOT trust a watchdog-generated reroute objective as
     * the primary continuation point because watchdog reasoning itself may be
     * stale. The checkpoint evidence tells the fresh worker which parts of
     * this phase are already complete.
     */
    const nextUnresolvedAction =
        clipCycleText(
            semanticCheckpoint
                ?.continuation_objective ||
                previous.phase_objective,
            1200,
        );

    return {
        source_task_id:
            previous.task_id,

        original_objective_fingerprint:
            previousFingerprint,

        source_status:
            String(
                previous.status,
            ),

        source_phase:
            previous.phase,

        captured_at:
            new Date()
                .toISOString(),

        completed_phases:
            completedPhases,

        prior_memory_ids:
            Array.isArray(
                previous.memory_ids,
            )
                ? [
                      ...previous.memory_ids,
                  ]
                : [],

        verified_reads:
            verifiedReads,

        successful_evidence:
            successfulEvidence,

        diagnostics,

        avoid_repeating:
            avoidRepeating,

        do_not_reacquire:
            doNotReacquire,

        verified_facts:
            semanticVerifiedFacts,

        validated_operations:
            semanticValidatedOperations,

        relevant_files:
            semanticRelevantFiles,

        unresolved_facts:
            semanticUnresolvedFacts,

        next_unresolved_action:
            nextUnresolvedAction,

        recovery_summary:
            clipCycleText(
                recovery?.summary ??
                    "",
                1600,
            ),
    };
}

function createValidationNonce():
    string {
    return (
        Date.now()
            .toString(36) +
        "-" +
        Math.random()
            .toString(36)
            .slice(
                2,
                12,
            )
    );
}


function validateGlimmerRecoveryPayload(
    value: any,
): GlimmerRecoveryAnalysis {
    if (
        !value ||
        typeof value !==
            "object" ||
        Array.isArray(value)
    ) {
        throw new Error(
            "Glimmer recovery analysis is not an object.",
        );
    }

    const requiredStrings = [
        "root_cause",
        "strategy",
        "next_objective",
    ];

    for (
        const key of requiredStrings
    ) {
        if (
            typeof value[key] !==
                "string" ||
            !value[key].trim()
        ) {
            throw new Error(
                `Glimmer recovery analysis has invalid ${key}.`,
            );
        }
    }

    if (
        !Array.isArray(
            value.evidence,
        ) ||
        !Array.isArray(
            value.required_tools,
        ) ||
        !Array.isArray(
            value.avoid_repeating,
        )
    ) {
        throw new Error(
            "Glimmer recovery analysis has invalid array fields.",
        );
    }

    const confidence =
        Number(
            value.confidence,
        );

    if (
        !Number.isFinite(
            confidence,
        ) ||
        confidence < 0 ||
        confidence > 1
    ) {
        throw new Error(
            "Glimmer recovery analysis confidence must be between 0 and 1.",
        );
    }

    return {
        root_cause:
            clipCycleText(
                value.root_cause,
                1800,
            ),

        evidence:
            value.evidence
                .filter(
                    (item: unknown) =>
                        typeof item ===
                        "string",
                )
                .map(
                    (item: string) =>
                        clipCycleText(
                            item,
                            800,
                        ),
                )
                .slice(
                    0,
                    20,
                ),

        strategy:
            clipCycleText(
                value.strategy,
                1800,
            ),

        next_objective:
            clipCycleText(
                value.next_objective,
                1800,
            ),

        required_tools:
            value.required_tools
                .filter(
                    (item: unknown) =>
                        typeof item ===
                        "string",
                )
                .map(
                    (item: string) =>
                        item.trim(),
                )
                .filter(
                    Boolean,
                )
                .slice(
                    0,
                    20,
                ),

        avoid_repeating:
            value.avoid_repeating
                .filter(
                    (item: unknown) =>
                        typeof item ===
                        "string",
                )
                .map(
                    (item: string) =>
                        clipCycleText(
                            item,
                            700,
                        ),
                )
                .slice(
                    0,
                    20,
                ),

        confidence,
    };
}


function normalizedReadPath(
    value: unknown,
): string {
    return String(
        value ?? "",
    )
        .replace(
            /\\/g,
            "/",
        )
        .toLowerCase();
}


function watchdogReadCoverage(
    watchdog: WatchdogState,
    args: any,
): {
    read_path: string;
    read_offset: number;
    read_limit: number;
    read_new_lines: number;
    read_repeated_lines: number;
    read_overlap_ratio: number;
    read_redundant_count: number;
} | null {
    if (
        !args ||
        typeof args !==
            "object"
    ) {
        return null;
    }

    const path =
        normalizedReadPath(
            args.path,
        );

    if (!path) {
        return null;
    }

    const offsetRaw =
        Number(
            args.offset ?? 1,
        );

    const limitRaw =
        Number(
            args.limit,
        );

    if (
        !Number.isFinite(
            offsetRaw,
        ) ||
        !Number.isFinite(
            limitRaw,
        ) ||
        limitRaw <= 0
    ) {
        return null;
    }

    const offset =
        Math.max(
            1,
            Math.floor(
                offsetRaw,
            ),
        );

    const limit =
        Math.max(
            1,
            Math.floor(
                limitRaw,
            ),
        );

    const end =
        offset +
        limit -
        1;

    const clipped:
        Array<{
            start: number;
            end: number;
        }> = [];

    for (
        const event of watchdog.events
    ) {
        if (
            event.tool !==
                "read" ||
            !event.read_path ||
            event.read_offset ===
                undefined ||
            event.read_limit ===
                undefined ||
            normalizedReadPath(
                event.read_path,
            ) !==
                path
        ) {
            continue;
        }

        const previousStart =
            event.read_offset;

        const previousEnd =
            previousStart +
            event.read_limit -
            1;

        const intersectionStart =
            Math.max(
                offset,
                previousStart,
            );

        const intersectionEnd =
            Math.min(
                end,
                previousEnd,
            );

        if (
            intersectionStart <=
            intersectionEnd
        ) {
            clipped.push({
                start:
                    intersectionStart,

                end:
                    intersectionEnd,
            });
        }
    }

    clipped.sort(
        (left, right) =>
            left.start -
            right.start,
    );

    let repeatedLines =
        0;

    let mergeStart:
        number | null =
        null;

    let mergeEnd:
        number | null =
        null;

    for (
        const range of clipped
    ) {
        if (
            mergeStart ===
                null ||
            mergeEnd ===
                null
        ) {
            mergeStart =
                range.start;

            mergeEnd =
                range.end;

            continue;
        }

        if (
            range.start <=
            mergeEnd + 1
        ) {
            mergeEnd =
                Math.max(
                    mergeEnd,
                    range.end,
                );

            continue;
        }

        repeatedLines +=
            mergeEnd -
            mergeStart +
            1;

        mergeStart =
            range.start;

        mergeEnd =
            range.end;
    }

    if (
        mergeStart !==
            null &&
        mergeEnd !==
            null
    ) {
        repeatedLines +=
            mergeEnd -
            mergeStart +
            1;
    }

    repeatedLines =
        Math.min(
            repeatedLines,
            limit,
        );

    const newLines =
        Math.max(
            0,
            limit -
                repeatedLines,
        );

    const overlapRatio =
        limit > 0
            ? repeatedLines /
              limit
            : 0;

    const previousStrongRedundant =
        watchdog.events.filter(
            (event) =>
                event.tool ===
                    "read" &&
                event.read_path &&
                normalizedReadPath(
                    event.read_path,
                ) ===
                    path &&
                Number(
                    event
                        .read_overlap_ratio ??
                        0,
                ) >=
                    0.70,
        ).length;

    const redundantCount =
        overlapRatio >=
        0.70
            ? previousStrongRedundant +
              1
            : previousStrongRedundant;

    return {
        read_path:
            path,

        read_offset:
            offset,

        read_limit:
            limit,

        read_new_lines:
            newLines,

        read_repeated_lines:
            repeatedLines,

        read_overlap_ratio:
            Number(
                overlapRatio
                    .toFixed(
                        3,
                    ),
            ),

        read_redundant_count:
            redundantCount,
    };
}

// ============================================================================
// END HARDENING HELPERS
// ============================================================================


async function glimmerRecoveryAnalysis(
    cycle: CycleState,
    trigger: string,
    metrics: any,
    qwenDecision: WatchdogDecision,
): Promise<GlimmerRecoveryAnalysis> {
    const dossier =
        buildWatchdogFailureDossier(
            cycle,
            trigger,
            metrics,
            qwenDecision,
        );

    phaseLog(
        "GLIMMER_ANALYST_START",
        {
            monitored_phase:
                cycle.phase,

            trigger,

            watchdog_reviews:
                cycle.watchdog?.reviews ??
                0,
        },
    );

    const started =
        Date.now();

    const system = `
You are Glimmer acting ONLY as a recovery analyst.

You are NOT the execution worker.
You have no project tools in this call.
Do not modify files.
Do not continue the failed tool loop.

Study the supplied failure dossier and diagnose WHY the worker failed to
converge.

Your job is to design a materially different bounded strategy that a fresh
worker can execute.

Important:

1. Reuse evidence that has already been obtained.
2. Do not request repeated reads or diagnostics unless a precise missing fact
   genuinely requires them.
3. Distinguish a worker reasoning failure from a real task blocker.
4. Prefer a different method of solving the task rather than retrying the same
   method with slightly different arguments.
5. next_objective must be self-contained enough for a completely fresh worker.
6. required_tools should contain only capabilities actually needed by the new
   strategy.
7. confidence is a number from 0 to 1.
8. Return JSON only.

Required JSON:

{
  "root_cause": "...",
  "evidence": ["..."],
  "strategy": "...",
  "next_objective": "...",
  "required_tools": ["..."],
  "avoid_repeating": ["..."],
  "confidence": 0.0
}
`.trim();

    const body = {
        model:
            "unsloth/muse-glimmer-30b",

        temperature:
            0,

        stream:
            false,

        max_tokens:
            1800,

        // GLIMMER_ANALYST_JSON_SCHEMA_V1
        response_format: {
            type:
                "json_schema",

            json_schema: {
                name:
                    "glimmer_recovery_analysis",

                strict:
                    true,

                schema: {
                    type:
                        "object",

                    properties: {
                        root_cause: {
                            type:
                                "string",
                        },

                        evidence: {
                            type:
                                "array",

                            items: {
                                type:
                                    "string",
                            },
                        },

                        strategy: {
                            type:
                                "string",
                        },

                        next_objective: {
                            type:
                                "string",
                        },

                        required_tools: {
                            type:
                                "array",

                            items: {
                                type:
                                    "string",
                            },
                        },

                        avoid_repeating: {
                            type:
                                "array",

                            items: {
                                type:
                                    "string",
                            },
                        },

                        confidence: {
                            type:
                                "number",

                            minimum:
                                0,

                            maximum:
                                1,
                        },
                    },

                    required: [
                        "root_cause",
                        "evidence",
                        "strategy",
                        "next_objective",
                        "required_tools",
                        "avoid_repeating",
                        "confidence",
                    ],

                    additionalProperties:
                        false,
                },
            },
        },

        messages: [
            {
                role:
                    "system",

                content:
                    system,
            },
            {
                role:
                    "user",

                content:
                    "<FAILURE_DOSSIER>\n" +
                    JSON.stringify(
                        dossier,
                        null,
                        2,
                    ) +
                    "\n</FAILURE_DOSSIER>",
            },
        ],
    };

    const response =
        await fetch(
            "http://127.0.0.1:1234/v1/chat/completions",
            {
                method:
                    "POST",

                headers: {
                    "content-type":
                        "application/json",
                },

                body:
                    JSON.stringify(
                        body,
                    ),
            },
        );

    if (!response.ok) {
        const text =
            await response.text();

        phaseLog(
            "GLIMMER_ANALYST_END",
            {
                monitored_phase:
                    cycle.phase,

                duration_ms:
                    Date.now() -
                    started,

                ok:
                    false,

                error:
                    clipCycleText(
                        text,
                        700,
                    ),
            },
        );

        throw new Error(
            `Glimmer analyst HTTP ${response.status}: ${text}`,
        );
    }

    const payload =
        (await response.json()) as any;

    const content =
        payload?.choices?.[0]?.message?.content;

    if (!content) {
        throw new Error(
            "Glimmer analyst returned no content.",
        );
    }

    const parsed =
        validateGlimmerRecoveryPayload(
            parseRecoveryJson(
                content,
            ),
        );

    const analysis:
        GlimmerRecoveryAnalysis = {
            root_cause:
                clipCycleText(
                    parsed.root_cause,
                    1800,
                ),

            evidence:
                Array.isArray(
                    parsed.evidence,
                )
                    ? parsed.evidence
                          .map(
                              (item: unknown) =>
                                  clipCycleText(
                                      item,
                                      700,
                                  ),
                          )
                          .slice(
                              0,
                              16,
                          )
                    : [],

            strategy:
                clipCycleText(
                    parsed.strategy,
                    2200,
                ),

            next_objective:
                clipCycleText(
                    parsed.next_objective,
                    1200,
                ),

            required_tools:
                Array.isArray(
                    parsed.required_tools,
                )
                    ? parsed.required_tools
                          .map(
                              (item: unknown) =>
                                  clipCycleText(
                                      item,
                                      120,
                                  ),
                          )
                          .slice(
                              0,
                              16,
                          )
                    : [],

            avoid_repeating:
                Array.isArray(
                    parsed.avoid_repeating,
                )
                    ? parsed.avoid_repeating
                          .map(
                              (item: unknown) =>
                                  clipCycleText(
                                      item,
                                      500,
                                  ),
                          )
                          .slice(
                              0,
                              16,
                          )
                    : [],

            confidence:
                Math.max(
                    0,
                    Math.min(
                        1,
                        Number(
                            parsed.confidence ??
                            0,
                        ),
                    ),
                ),
        };

    phaseLog(
        "GLIMMER_ANALYST_END",
        {
            monitored_phase:
                cycle.phase,

            duration_ms:
                Date.now() -
                started,

            ok:
                true,

            root_cause:
                clipCycleText(
                    analysis.root_cause,
                    500,
                ),

            strategy:
                clipCycleText(
                    analysis.strategy,
                    600,
                ),

            confidence:
                analysis.confidence,
        },
    );

    return analysis;
}


async function qwenValidateRecoveryAnalysis(
    cycle: CycleState,
    trigger: string,
    metrics: any,
    localDecision: WatchdogDecision,
    analysis: GlimmerRecoveryAnalysis,
): Promise<WatchdogDecision> {
    const schema = {
        type:
            "object",

        properties: {
            action: {
                type:
                    "string",

                enum: [
                    "abort_reroute",
                    "blocked",
                ],
            },

            reason: {
                type:
                    "string",

                maxLength:
                    1200,
            },

            summary: {
                type:
                    "string",

                maxLength:
                    1800,
            },

            next_objective: {
                type:
                    "string",

                maxLength:
                    1200,
            },

            missing_information: {
                type:
                    "array",

                items: {
                    type:
                        "string",

                    maxLength:
                        500,
                },

                maxItems:
                    16,
            },

            avoid_repeating: {
                type:
                    "array",

                items: {
                    type:
                        "string",

                    maxLength:
                        500,
                },

                maxItems:
                    16,
            },

            blocking_fact: {
                type:
                    "string",

                maxLength:
                    1000,
            },

            why_not_recoverable: {
                type:
                    "string",

                maxLength:
                    1200,
            },

            missing_capability_or_information: {
                type:
                    "string",

                maxLength:
                    1000,
            },

            attempted_strategies: {
                type:
                    "array",

                items: {
                    type:
                        "string",

                    maxLength:
                        500,
                },

                maxItems:
                    12,
            },
        },

        required: [
            "action",
            "reason",
            "summary",
            "next_objective",
            "missing_information",
            "avoid_repeating",
            "blocking_fact",
            "why_not_recoverable",
            "missing_capability_or_information",
            "attempted_strategies",
        ],

        additionalProperties:
            false,
    };

    phaseLog(
        "GLOBAL_REPLAN_START",
        {
            monitored_phase:
                cycle.phase,

            trigger,
        },
    );

    phaseLog(
        "QWEN_VALIDATION_START",
        {
            monitored_phase:
                cycle.phase,

            analyst_confidence:
                analysis.confidence,
        },
    );

    const started =
        Date.now();

    const system = `
You are Qwen, the authoritative supervisor.

A worker failed to converge. You previously reviewed the failure, and a
separate Glimmer analyst has now proposed a recovery strategy.

Validate that proposal against the supplied task state.

You are NOT the execution worker.
Do not execute tools.

Your primary goal is to KEEP THE ORIGINAL TASK RUNNING whenever autonomous
recovery is possible.

Choose abort_reroute when:
- the worker was looping or reasoning badly;
- a different bounded strategy exists;
- additional evidence can be acquired autonomously;
- the Glimmer proposal can be corrected into an executable fresh phase.

Choose blocked ONLY when there is a CONCRETE AND VERIFIABLE obstacle that
cannot be solved by another autonomous phase.

Examples of valid blockers:
- indispensable information is genuinely unavailable;
- a required capability/tool does not exist;
- access or permission is missing and cannot be obtained autonomously;
- the task requires a user decision that cannot safely be inferred.

Worker confusion, repeated reads, failed reasoning, contradictory intermediate
reasoning, or a poor strategy are NOT blockers.

For blocked:
- blocking_fact MUST be concrete and non-empty.
- why_not_recoverable MUST explain why another strategy cannot work.
- missing_capability_or_information MUST identify the unavailable requirement.
- attempted_strategies MUST summarize materially different approaches already
  attempted.

If those conditions are not satisfied, you MUST choose abort_reroute.

When choosing abort_reroute:
- next_objective must be self-contained;
- incorporate useful evidence already collected;
- explicitly avoid the failed strategy;
- it may restructure the method completely;
- do not require the fresh worker to rediscover information already known.

Return JSON only.
`.trim();

    const user =
        "<RECOVERY_VALIDATION>\n" +
        JSON.stringify(
            {
                original_objective:
                    cycle.original_objective,

                phase:
                    cycle.phase,

                failed_phase_objective:
                    cycle.phase_objective,

                trigger,

                metrics,

                local_qwen_decision:
                    localDecision,

                glimmer_analysis:
                    analysis,

                current_route:
                    cycle.current_route,

                completed_phases:
                    cycle.history
                        .slice(
                            -6,
                        ),

                persisted_memory_ids:
                    cycle.memory_ids,
            },
            null,
            2,
        ) +
        "\n</RECOVERY_VALIDATION>";

    const raw =
        await qwenCycleJson(
            schema,
            system,
            user,
            "recovery_validation",
        );

    /*
     * Controller-side invariant:
     * Qwen is not allowed to terminate the task with an unsubstantiated
     * "blocked".
     */
    if (
        raw.action ===
        "blocked"
    ) {
        const blockingFact =
            clipCycleText(
                raw.blocking_fact,
                1000,
            );

        const whyNotRecoverable =
            clipCycleText(
                raw.why_not_recoverable,
                1200,
            );

        const missingRequirement =
            clipCycleText(
                raw.missing_capability_or_information,
                1000,
            );

        if (
            !blockingFact ||
            !whyNotRecoverable ||
            !missingRequirement
        ) {
            raw.action =
                "abort_reroute";

            raw.reason =
                "Controller rejected an unsubstantiated blocked decision. " +
                clipCycleText(
                    raw.reason,
                    800,
                );

            raw.next_objective =
                analysis.next_objective ||
                (
                    "Re-evaluate the original task using a materially different " +
                    "strategy based on the accumulated evidence. Do not repeat " +
                    "the failed tool/reasoning loop. " +
                    analysis.strategy
                );
        }
    }

    if (
        raw.action ===
        "abort_reroute" &&
        !clipCycleText(
            raw.next_objective,
            1200,
        )
    ) {
        raw.next_objective =
            analysis.next_objective ||
            (
                "Continue the original objective using this alternative strategy: " +
                analysis.strategy
            );
    }

    const decision:
        WatchdogDecision = {
            action:
                raw.action,

            reason:
                clipCycleText(
                    raw.reason,
                    1200,
                ),

            summary:
                clipCycleText(
                    raw.summary,
                    1800,
                ),

            next_objective:
                clipCycleText(
                    raw.next_objective,
                    1200,
                ),

            missing_information:
                Array.isArray(
                    raw.missing_information,
                )
                    ? raw.missing_information
                          .map(
                              (item: unknown) =>
                                  clipCycleText(
                                      item,
                                      500,
                                  ),
                          )
                          .slice(
                              0,
                              16,
                          )
                    : [],

            avoid_repeating: [
                ...(
                    Array.isArray(
                        raw.avoid_repeating,
                    )
                        ? raw.avoid_repeating
                        : []
                ),
                ...analysis.avoid_repeating,
            ]
                .map(
                    (item: unknown) =>
                        clipCycleText(
                            item,
                            500,
                        ),
                )
                .filter(
                    Boolean,
                )
                .slice(
                    0,
                    16,
                ),
        };

    phaseLog(
        "QWEN_VALIDATION_END",
        {
            monitored_phase:
                cycle.phase,

            duration_ms:
                Date.now() -
                started,

            decision:
                decision.action,

            next_objective:
                clipCycleText(
                    decision.next_objective,
                    600,
                ),

            blocking_fact:
                clipCycleText(
                    raw.blocking_fact,
                    500,
                ),
        },
    );

    phaseLog(
        "GLOBAL_REPLAN_END",
        {
            monitored_phase:
                cycle.phase,

            decision:
                decision.action,
        },
    );

    return decision;
}



function preserveRecoveryRoute(
    previousRoute: RouterState,
    proposedRoute: RouterState,
    recoveryObjective: string,
): RouterState {
    // RECOVERY_ROUTE_PRESERVATION_V1
    //
    // Observed failure:
    // an inspect phase was aborted, the generic fallback objective was routed
    // as memory, and the fresh worker lost the source/diagnostic capabilities
    // needed to finish the still-inspection-oriented objective.
    //
    // Do not override a genuinely different PROJECT strategy. This guard only
    // prevents accidental inspect -> memory capability loss.
    if (
        previousRoute.profile !==
            "inspect" ||
        proposedRoute.profile !==
            "memory"
    ) {
        return proposedRoute;
    }

    const text =
        String(
            recoveryObjective ??
            "",
        ).toLowerCase();

    const stillNeedsInspection =
        /\b(inspect|inspection|source|implementation|code|class|method|file|read|diagnostic|diagnostics|lsp|lens|pyright|static)\b/
            .test(
                text,
            );

    if (!stillNeedsInspection) {
        return proposedRoute;
    }

    const preserved: RouterState = {
        ...previousRoute,

        objective:
            recoveryObjective,

        reason:
            "RECOVERY_ROUTE_PRESERVATION_V1: preserved inspect capabilities after recovery objective was classified as memory.",

        updatedAt:
            new Date()
                .toISOString(),
    };

    phaseLog(
        "RECOVERY_ROUTE_PRESERVED",
        {
            from_profile:
                previousRoute.profile,

            rejected_profile:
                proposedRoute.profile,

            final_profile:
                preserved.profile,

            tools:
                preserved.tools,

            objective:
                clipCycleText(
                    recoveryObjective,
                    700,
                ),
        },
    );

    return preserved;
}


function localRecoveryObjective(
    cycle: CycleState,
    trigger: string,
): string {
    const watchdog =
        ensureWatchdogState(
            cycle,
        );

    const recent =
        watchdog.events
            .slice(
                -12,
            )
            .map(
                (event) =>
                    `${event.tool} ${event.args_hint}`,
            )
            .join(
                "; ",
            );

    return clipCycleText(
        `
Continue the original objective in a completely fresh worker context.

Preserve the technical capability class of the failed phase unless the new
strategy explicitly requires a materially different capability. If the failed
phase was inspecting source code or diagnostics, retain source-inspection and
diagnostic capability. Do not downgrade an inspection task to memory-only work.

The previous phase failed to converge.

Failure trigger:
${trigger}

Previous phase objective:
${cycle.phase_objective}

Recent failed/repeated activity:
${recent}

Use a materially different strategy.
Reuse previously obtained evidence.
Do not repeat the same reads, diagnostics, or reasoning cycle.
Identify the minimum remaining fact needed, obtain it only if necessary,
then reach a conclusion, persist the durable result, and call phase_complete.
        `.trim(),
        1200,
    );
}

async function escalateWatchdogRecovery(
    cycle: CycleState,
    trigger: string,
    metrics: any,
    localDecision: WatchdogDecision,
): Promise<WatchdogDecision> {
    const analysis =
        await glimmerRecoveryAnalysis(
            cycle,
            trigger,
            metrics,
            localDecision,
        );

    return await qwenValidateRecoveryAnalysis(
        cycle,
        trigger,
        metrics,
        localDecision,
        analysis,
    );
}

// ============================================================================
// END COGNITIVE_RECOVERY_V1
// ============================================================================


// ============================================================================
// RECOVERY_SERIALIZATION_20260828_V1
//
// ANALYST_SERIALIZATION_V1
// WATCHDOG_ELAPSED_GUARD_V1
// RECOVERY_ROUTE_PRESERVATION_V1
// EVIDENCE_PROVENANCE_V1
// ============================================================================


// ============================================================================
// RECOVERY_EVIDENCE_V1
//
// Preserve useful evidence from an interrupted phase and require explicit
// evidence sufficiency validation before accepting AUTO DONE.
// ============================================================================

interface CompletionEvidenceValidation {
    status:
        | "accepted"
        | "insufficient";

    reason: string;

    supported_claims:
        string[];

    // EVIDENCE_PROVENANCE_V1
    evidence_provenance:
        Array<{
            claim: string;
            phase: number;
            tool: string;
            evidence: string;
        }>;

    unsupported_claims:
        string[];

    missing_evidence:
        string[];

    next_objective:
        string;
}


function buildRecoveryEvidenceSnapshot(
    cycle: CycleState,
): any {
    const watchdog =
        ensureWatchdogState(
            cycle,
        );

    const successful =
        watchdog.events
            .filter(
                (event) =>
                    !event.is_error,
            )
            .slice(
                -40,
            )
            .map(
                (event) => ({
                    phase:
                        cycle.phase,

                    tool:
                        event.tool,

                    args:
                        event.args_hint,

                    result:
                        event.result_hint,
                }),
            );

    const failures =
        watchdog.events
            .filter(
                (event) =>
                    event.is_error,
            )
            .slice(
                -20,
            )
            .map(
                (event) => ({
                    tool:
                        event.tool,

                    args:
                        event.args_hint,

                    error:
                        event.result_hint,
                }),
            );

    const reads =
        watchdog.events
            .filter(
                (event) =>
                    event.tool ===
                        "read" &&
                    !event.is_error,
            )
            .slice(
                -24,
            )
            .map(
                (event) => ({
                    phase:
                        cycle.phase,

                    tool:
                        "read",

                    /*
                     * RECOVERY_READ_PATH_V1
                     *
                     * Preserve the structured path directly. Reconstructing it
                     * later from args_hint is unnecessary and fragile.
                     */
                    path:
                        event.read_path,

                    args:
                        event.args_hint,

                    result:
                        event.result_hint,
                }),
            );

    const diagnostics =
        watchdog.events
            .filter(
                (event) =>
                    (
                        event.tool ===
                            "lens_diagnostics" ||
                        event.tool.includes(
                            "diagnostic",
                        )
                    ) &&
                    !event.is_error,
            )
            .slice(
                -16,
            )
            .map(
                (event) => ({
                    phase:
                        cycle.phase,

                    tool:
                        event.tool,

                    args:
                        event.args_hint,

                    result:
                        event.result_hint,
                }),
            );

    return {
        /*
         * TASK_SCOPED_RECOVERY_EVIDENCE_V1
         *
         * Recovery evidence is valid only for the task that produced it.
         * This prevents watchdog/recovery snapshots from a previous task
         * becoming evidence requirements for a later unrelated task.
         */
        source_task_id:
            String(
                (cycle as any)
                    .task_id ??
                "",
            ),

        source_original_objective:
            String(
                cycle.original_objective ??
                "",
            ),

        source_phase:
            cycle.phase,

        phase_objective:
            cycle.phase_objective,

        route:
            cycle.current_route,

        captured_at:
            new Date()
                .toISOString(),

        successful_tool_evidence:
            successful,

        source_reads:
            reads,

        diagnostics,

        tool_errors:
            failures,

        established_from_prior_phases:
            cycle.history
                .slice(
                    -4,
                )
                .map(
                    (entry) => ({
                        phase:
                            entry.phase,

                        objective:
                            entry.objective,

                        summary:
                            clipCycleText(
                                entry.summary,
                                1600,
                            ),

                        memory_id:
                            entry.memory_id,
                    }),
                ),

        /*
         * A fresh worker must treat the snapshot as already-acquired
         * evidence. It may obtain new evidence, but should not reacquire
         * the same information merely for confirmation.
         */
        evidence_contract: {
            authoritative_as_observation:
                true,

            conclusion_not_implied:
                true,

            do_not_reacquire_without_specific_gap:
                true,
        },
    };
}


function recoveryEvidenceMatchesActiveTask(
    cycle: CycleState,
    snapshot: any,
): boolean {
    if (
        !snapshot ||
        typeof snapshot !== "object"
    ) {
        return false;
    }

    const activeTaskId =
        String(
            (cycle as any)
                .task_id ??
            "",
        ).trim();

    const snapshotTaskId =
        String(
            snapshot
                .source_task_id ??
            "",
        ).trim();

    /*
     * Primary binding: task_id.
     *
     * A recovery snapshot from another task must never become evidence,
     * validation criteria, or a recovery objective for the active task.
     */
    if (
        activeTaskId.length > 0 &&
        snapshotTaskId.length > 0
    ) {
        return (
            activeTaskId ===
            snapshotTaskId
        );
    }

    /*
     * Defensive fallback for environments where task_id is unavailable.
     * Legacy snapshots lacking both bindings are deliberately rejected.
     */
    const activeObjective =
        String(
            cycle.original_objective ??
            "",
        ).trim();

    const snapshotObjective =
        String(
            snapshot
                .source_original_objective ??
            "",
        ).trim();

    return (
        activeObjective.length > 0 &&
        snapshotObjective.length > 0 &&
        activeObjective ===
            snapshotObjective
    );
}


function latestRecoveryEvidence(
    cycle: CycleState,
): any | null {
    if (
        !Array.isArray(
            cycle.watchdog_history,
        ) ||
        cycle.watchdog_history.length ===
            0
    ) {
        return null;
    }

    for (
        let index =
            cycle.watchdog_history.length -
            1;
        index >= 0;
        index -= 1
    ) {
        const recovery =
            cycle.watchdog_history[
                index
            ] as WatchdogRecovery;

        const snapshot =
            recovery
                ?.evidence_snapshot;

        if (
            snapshot &&
            recoveryEvidenceMatchesActiveTask(
                cycle,
                snapshot,
            )
        ) {
            return snapshot;
        }
    }

    return null;
}


function allRecoveryEvidence(
    cycle: CycleState,
): any[] {
    if (
        !Array.isArray(
            cycle.watchdog_history,
        )
    ) {
        return [];
    }

    return cycle.watchdog_history
        .map(
            (
                recovery:
                    WatchdogRecovery,
            ) =>
                recovery
                    ?.evidence_snapshot,
        )
        .filter(
            (snapshot: any) =>
                Boolean(
                    snapshot,
                ) &&
                recoveryEvidenceMatchesActiveTask(
                    cycle,
                    snapshot,
                ),
        )
        .slice(
            -6,
        );
}

async function validateCompletionEvidence(
    cycle: CycleState,
    phaseResult: any,
    supervisorDecision: any,
): Promise<CompletionEvidenceValidation> {
    // EVIDENCE_VALIDATION_BINDING_V1
    const validationBinding = {
        task_id:
            String(
                (cycle as any)
                    .task_id ??
                    "",
            ),

        phase:
            cycle.phase,

        validation_nonce:
            createValidationNonce(),

        objective_fingerprint:
            phaseObjectiveFingerprint(
                cycle.original_objective,
            ),

        objective_under_validation:
            cycle.original_objective,
    };

    const schema = {
        type:
            "object",

        properties: {
            task_id: {
                type:
                    "string",

                enum: [
                    validationBinding
                        .task_id,
                ],
            },

            phase: {
                type:
                    "integer",

                enum: [
                    validationBinding
                        .phase,
                ],
            },

            validation_nonce: {
                type:
                    "string",

                enum: [
                    validationBinding
                        .validation_nonce,
                ],
            },

            objective_fingerprint: {
                type:
                    "string",

                enum: [
                    validationBinding
                        .objective_fingerprint,
                ],
            },

            objective_under_validation: {
                type:
                    "string",

                enum: [
                    validationBinding
                        .objective_under_validation,
                ],
            },

            status: {
                type:
                    "string",

                enum: [
                    "accepted",
                    "insufficient",
                ],
            },

            reason: {
                type:
                    "string",

                maxLength:
                    1400,
            },

            supported_claims: {
                type:
                    "array",

                items: {
                    type:
                        "string",

                    maxLength:
                        700,
                },

                maxItems:
                    16,
            },

            evidence_provenance: {
                type:
                    "array",

                items: {
                    type:
                        "object",

                    properties: {
                        claim: {
                            type:
                                "string",

                            maxLength:
                                700,
                        },

                        phase: {
                            type:
                                "integer",

                            minimum:
                                1,
                        },

                        tool: {
                            type:
                                "string",

                            maxLength:
                                120,
                        },

                        evidence: {
                            type:
                                "string",

                            maxLength:
                                1000,
                        },
                    },

                    required: [
                        "claim",
                        "phase",
                        "tool",
                        "evidence",
                    ],

                    additionalProperties:
                        false,
                },

                maxItems:
                    24,
            },

            unsupported_claims: {
                type:
                    "array",

                items: {
                    type:
                        "string",

                    maxLength:
                        700,
                },

                maxItems:
                    16,
            },

            missing_evidence: {
                type:
                    "array",

                items: {
                    type:
                        "string",

                    maxLength:
                        700,
                },

                maxItems:
                    16,
            },

            next_objective: {
                type:
                    "string",

                maxLength:
                    1400,
            },
        },

        required: [
            "task_id",
            "phase",
            "validation_nonce",
            "objective_fingerprint",
            "objective_under_validation",
            "status",
            "reason",
            "supported_claims",
            "evidence_provenance",
            "unsupported_claims",
            "missing_evidence",
            "next_objective",
        ],

        additionalProperties:
            false,
    };

    const currentWatchdog =
        cycle.watchdog
            ? {
                  phase:
                      cycle.watchdog.phase,

                  tool_calls:
                      cycle.watchdog.tool_calls,

                  turns:
                      cycle.watchdog.turns,

                  tool_evidence:
                      cycle.watchdog.events
                          .slice(
                              -32,
                          )
                          .map(
                              (event) => ({
                                  phase:
                                      cycle.watchdog
                                          ?.phase ??
                                      cycle.phase,

                                  tool:
                                      event.tool,

                                  args:
                                      event.args_hint,

                                  is_error:
                                      event.is_error,

                                  result:
                                      event.result_hint,
                              }),
                          ),
              }
            : null;

    const evidenceBundle = {
        validation_binding:
            validationBinding,

        objective_under_validation:
            cycle.original_objective,

        original_objective:
            cycle.original_objective,

        current_phase:
            cycle.phase,

        current_phase_objective:
            cycle.phase_objective,

        phase_result:
            phaseResult,

        proposed_supervisor_completion:
            supervisorDecision,

        completed_phase_history:
            cycle.history
                .slice(
                    -8,
                ),

        current_phase_tool_evidence:
            currentWatchdog,

        interrupted_phase_evidence:
            allRecoveryEvidence(
                cycle,
            ),

        persisted_memory_ids:
            cycle.memory_ids,
    };

    phaseLog(
        "EVIDENCE_VALIDATION_START",
        {
            monitored_phase:
                cycle.phase,

            recovery_snapshots:
                evidenceBundle
                    .interrupted_phase_evidence
                    .length,

            current_tool_calls:
                cycle.watchdog
                    ?.tool_calls ??
                0,

            task_id:
                validationBinding
                    .task_id,

            validation_nonce:
                validationBinding
                    .validation_nonce,

            objective_fingerprint:
                validationBinding
                    .objective_fingerprint,
        },
    );

    const started =
        Date.now();

    const system = `
You are Qwen acting as the final evidence sufficiency validator.

The execution supervisor currently wants to declare the ORIGINAL OBJECTIVE
complete.

Do NOT solve the task from general knowledge.
Do NOT invent evidence.
Do NOT treat a worker conclusion or mem_save text as proof merely because it
exists.

Judge only whether the supplied execution evidence is sufficient to support
the material claims in the proposed completion.

Important rules:

1. Distinguish CLAIMS from EVIDENCE.

2. A statement stored by a worker in memory is not automatically evidence for
   itself.

3. Evidence from an interrupted worker remains valid if it came from a
   successful tool result and is included in interrupted_phase_evidence.

4. If the conclusion says VERIFIED, MATCHES, CONFIRMED, EXACTLY, NO
   DISCREPANCY, or equivalent, require concrete evidence supporting that
   conclusion.

5. Do not require reacquisition of evidence that is already present in the
   evidence bundle.

6. If only one precise fact is missing, choose insufficient and create a
   bounded next_objective that obtains ONLY that missing fact.

7. If sufficient evidence exists, choose accepted.

8. An auxiliary type/lint error does not by itself prove or disprove an
   architectural responsibility. Evaluate relevance.

9. next_objective MUST be empty for accepted.

10. For insufficient, next_objective must be self-contained for a fresh
    worker and explicitly state what evidence is missing.

11. The response MUST copy task_id, phase, validation_nonce,
    objective_fingerprint, and objective_under_validation EXACTLY from
    validation_binding.

12. objective_under_validation is the ONLY original objective being judged.
    Do not answer for any previous task, previous validation, or stale memory.

13. For every material supported claim, populate evidence_provenance with:
    - the phase that ACTUALLY produced the evidence;
    - the actual tool that produced it;
    - a concise description of the concrete evidence.

14. Evidence copied into a later recovery phase does NOT change its provenance.
    If P2/read produced evidence and P3 consumed that recovery snapshot, report
    phase=2 and tool="read", NOT phase=3.

15. Never claim that a phase executed diagnostics, reads, or another tool unless
    the supplied evidence bundle shows that tool execution in that phase.

16. An accepted decision without concrete evidence_provenance is invalid.

Return JSON only.
`.trim();

    const user =
        "<COMPLETION_EVIDENCE>\n" +
        JSON.stringify(
            evidenceBundle,
            null,
            2,
        ) +
        "\n</COMPLETION_EVIDENCE>";

    const raw =
        await qwenCycleJson(
            schema,
            system,
            user,
            "evidence_validation",
        );

    const bindingMatches =
        String(
            raw.task_id ??
            "",
        ) ===
            validationBinding.task_id &&
        Number(
            raw.phase,
        ) ===
            validationBinding.phase &&
        String(
            raw.validation_nonce ??
            "",
        ) ===
            validationBinding.validation_nonce &&
        String(
            raw.objective_fingerprint ??
            "",
        ) ===
            validationBinding.objective_fingerprint &&
        String(
            raw.objective_under_validation ??
            "",
        ) ===
            validationBinding.objective_under_validation;

    if (!bindingMatches) {
        phaseLog(
            "EVIDENCE_VALIDATION_BINDING_REJECTED",
            {
                expected:
                    validationBinding,

                received: {
                    task_id:
                        raw.task_id ??
                        null,

                    phase:
                        raw.phase ??
                        null,

                    validation_nonce:
                        raw.validation_nonce ??
                        null,

                    objective_fingerprint:
                        raw.objective_fingerprint ??
                        null,

                    objective_under_validation:
                        clipCycleText(
                            raw.objective_under_validation ??
                            "",
                            500,
                        ),
                },
            },
        );

        return {
            status:
                "insufficient",

            reason:
                "Evidence validator response was rejected because it was not bound to the active task/objective. The controller will not accept this completion.",

            supported_claims:
                [],

            evidence_provenance:
                [],

            unsupported_claims: [
                "The proposed completion has not passed a task-bound evidence validation.",
            ],

            missing_evidence:
                [],

            next_objective:
                "Reassess the ORIGINAL OBJECTIVE using only the evidence already available in the phase history and recovery evidence. Do not rely on any previous validator conclusion. Acquire additional evidence only if a concrete fact required by the original objective is actually missing.",
        };
    }

    const validation:
        CompletionEvidenceValidation = {
            status:
                raw.status ===
                    "accepted"
                    ? "accepted"
                    : "insufficient",

            reason:
                clipCycleText(
                    raw.reason,
                    1400,
                ),

            supported_claims:
                Array.isArray(
                    raw.supported_claims,
                )
                    ? raw.supported_claims
                          .map(
                              (item: unknown) =>
                                  clipCycleText(
                                      item,
                                      700,
                                  ),
                          )
                          .slice(
                              0,
                              16,
                          )
                    : [],

            evidence_provenance:
                Array.isArray(
                    raw.evidence_provenance,
                )
                    ? raw.evidence_provenance
                          .filter(
                              (item: any) =>
                                  item &&
                                  typeof item ===
                                      "object" &&
                                  Number.isInteger(
                                      Number(
                                          item.phase,
                                      ),
                                  ) &&
                                  typeof item.tool ===
                                      "string" &&
                                  typeof item.claim ===
                                      "string" &&
                                  typeof item.evidence ===
                                      "string",
                          )
                          .map(
                              (item: any) => ({
                                  claim:
                                      clipCycleText(
                                          item.claim,
                                          700,
                                      ),

                                  phase:
                                      Number(
                                          item.phase,
                                      ),

                                  tool:
                                      clipCycleText(
                                          item.tool,
                                          120,
                                      ),

                                  evidence:
                                      clipCycleText(
                                          item.evidence,
                                          1000,
                                      ),
                              }),
                          )
                          .slice(
                              0,
                              24,
                          )
                    : [],

            unsupported_claims:
                Array.isArray(
                    raw.unsupported_claims,
                )
                    ? raw.unsupported_claims
                          .map(
                              (item: unknown) =>
                                  clipCycleText(
                                      item,
                                      700,
                                  ),
                          )
                          .slice(
                              0,
                              16,
                          )
                    : [],

            missing_evidence:
                Array.isArray(
                    raw.missing_evidence,
                )
                    ? raw.missing_evidence
                          .map(
                              (item: unknown) =>
                                  clipCycleText(
                                      item,
                                      700,
                                  ),
                          )
                          .slice(
                              0,
                              16,
                          )
                    : [],

            next_objective:
                clipCycleText(
                    raw.next_objective,
                    1400,
                ),
        };

    // EVIDENCE_PROVENANCE_V1 controller invariant.
    //
    // Qwen must not merely narrate provenance. At least one reported
    // phase/tool pair must exist in the supplied execution evidence before an
    // "accepted" decision can survive.
    const availableProvenance =
        new Set<string>();

    if (
        currentWatchdog
            ?.tool_evidence
    ) {
        for (
            const item of currentWatchdog
                .tool_evidence
        ) {
            availableProvenance.add(
                `${Number(item.phase)}:${String(item.tool)}`,
            );
        }
    }

    for (
        const snapshot of evidenceBundle
            .interrupted_phase_evidence
    ) {
        const sourcePhase =
            Number(
                snapshot
                    ?.source_phase,
            );

        for (
            const item of (
                snapshot
                    ?.successful_tool_evidence ??
                []
            )
        ) {
            availableProvenance.add(
                `${sourcePhase}:${String(item.tool)}`,
            );
        }

        for (
            const item of (
                snapshot
                    ?.source_reads ??
                []
            )
        ) {
            availableProvenance.add(
                `${sourcePhase}:read`,
            );
        }

        for (
            const item of (
                snapshot
                    ?.diagnostics ??
                []
            )
        ) {
            availableProvenance.add(
                `${sourcePhase}:${String(item.tool)}`,
            );
        }
    }

    const validProvenance =
        validation
            .evidence_provenance
            .filter(
                (item) =>
                    availableProvenance.has(
                        `${item.phase}:${item.tool}`,
                    ),
            );

    if (
        validation.status ===
            "accepted" &&
        validProvenance.length ===
            0
    ) {
        phaseLog(
            "EVIDENCE_PROVENANCE_REJECTED",
            {
                monitored_phase:
                    cycle.phase,

                reported:
                    validation
                        .evidence_provenance,

                available:
                    Array.from(
                        availableProvenance,
                    ),
            },
        );

        validation.status =
            "insufficient";

        validation.reason =
            "Evidence validation reported acceptance without valid execution provenance. Controller rejected the completion.";

        validation.unsupported_claims.push(
            "The proposed completion lacks a valid phase/tool provenance reference.",
        );

        validation.next_objective =
            "Reassess the original objective from the existing execution evidence and explicitly identify the phase and tool that produced each material supporting fact. Acquire new evidence only if the required fact is genuinely absent.";
    } else {
        validation.evidence_provenance =
            validProvenance;
    }

    if (
        validation.status ===
            "insufficient" &&
        !validation.next_objective
    ) {
        validation.next_objective =
            clipCycleText(
                `
Obtain only the concrete evidence missing from the previous attempted
completion, then reassess the original objective.

Missing evidence:
${validation.missing_evidence.join("; ")}

Do not reacquire evidence already present in the recovery evidence snapshot.
Do not repeat successful diagnostics or source reads unless they directly
supply one of the missing facts.
                `.trim(),
                1400,
            );
    }

    phaseLog(
        "EVIDENCE_VALIDATION_END",
        {
            monitored_phase:
                cycle.phase,

            duration_ms:
                Date.now() -
                started,

            status:
                validation.status,

            reason:
                clipCycleText(
                    validation.reason,
                    700,
                ),

            evidence_provenance:
                validation
                    .evidence_provenance,

            missing_evidence:
                validation
                    .missing_evidence,

            next_objective:
                clipCycleText(
                    validation
                        .next_objective,
                    700,
                ),
        },
    );

    return validation;
}

// ============================================================================
// END RECOVERY_EVIDENCE_V1 CORE
// ============================================================================

async function monitorWorkerPhase(
    ctx: any,
    phase: number,
): Promise<void> {
        // WATCHDOG_START_GATE_V1
    //
    // sendUserMessage() can be asynchronous with respect to isIdle().
    // The watchdog must not die simply because it observes the tiny
    // idle window before the worker becomes active.
    const watchdogStartupStarted =
        Date.now();

    const watchdogStartupTimeoutMs =
        15000;

    let watchdogSawWorkerActive =
        !ctx.isIdle();

    phaseLog(
        "WATCHDOG_MONITOR_START",
        {
            monitored_phase:
                phase,

            initially_idle:
                ctx.isIdle(),
        },
    );

    while (
        !watchdogSawWorkerActive &&
        Date.now() -
            watchdogStartupStarted <
            watchdogStartupTimeoutMs
    ) {
        const startupCycle =
            readCycleState();

        if (
            !startupCycle ||
            startupCycle.status !==
                "running" ||
            startupCycle.phase !==
                phase
        ) {
            phaseLog(
                "WATCHDOG_MONITOR_CANCELLED",
                {
                    monitored_phase:
                        phase,

                    reason:
                        "cycle_or_phase_changed_before_worker_start",
                },
            );

            return;
        }

        /*
         * A genuinely very fast phase may already have completed before
         * we managed to observe the worker as non-idle.
         */
        if (
            startupCycle.phase_result
        ) {
            phaseLog(
                "WATCHDOG_MONITOR_FAST_COMPLETE",
                {
                    monitored_phase:
                        phase,

                    startup_wait_ms:
                        Date.now() -
                        watchdogStartupStarted,
                },
            );

            return;
        }

        if (
            !ctx.isIdle()
        ) {
            watchdogSawWorkerActive =
                true;

            break;
        }

        await new Promise(
            (resolve) =>
                setTimeout(
                    resolve,
                    100,
                ),
        );
    }

    if (
        !watchdogSawWorkerActive
    ) {
        const startupCycle =
            readCycleState();

        if (
            startupCycle &&
            startupCycle.status ===
                "running" &&
            startupCycle.phase ===
                phase
        ) {
            const watchdog =
                ensureWatchdogState(
                    startupCycle,
                );

            watchdog.last_trigger =
                "worker_start_timeout";

            watchdog.last_decision =
                "blocked";

            startupCycle.watchdog_recovery = {
                phase,

                action:
                    "blocked",

                trigger:
                    "worker_start_timeout",

                reason:
                    "Worker did not become active within the watchdog startup window.",

                summary:
                    "Watchdog could not observe worker activation within 15 seconds.",

                next_objective:
                    "",

                missing_information:
                    [],

                avoid_repeating:
                    [],

                at:
                    new Date()
                        .toISOString(),
            };

            startupCycle.updated_at =
                new Date()
                    .toISOString();

            writeCycleState(
                startupCycle,
            );
        }

        phaseLog(
            "WATCHDOG_START_TIMEOUT",
            {
                monitored_phase:
                    phase,

                startup_wait_ms:
                    Date.now() -
                    watchdogStartupStarted,
            },
        );

        return;
    }

    phaseLog(
        "WATCHDOG_WORKER_ACTIVE",
        {
            monitored_phase:
                phase,

            startup_wait_ms:
                Date.now() -
                watchdogStartupStarted,
        },
    );

while (
        !ctx.isIdle()
    ) {
        await new Promise(
            (resolve) =>
                setTimeout(
                    resolve,
                    WATCHDOG_POLL_MS,
                ),
        );

        if (
            ctx.isIdle()
        ) {
            return;
        }

        let cycle =
            readCycleState();

        if (
            !cycle ||
            cycle.status !==
                "running" ||
            cycle.phase !==
                phase
        ) {
            return;
        }

        /*
         * WATCHDOG_TERMINATION_GRACE_V1
         *
         * Once the current phase has a real Engram persistence ACK, the
         * worker is contractually required to finish with phase_complete.
         *
         * Do not let watchdog review/recovery destroy that short terminal
         * transition. The grace is deliberately bounded so a worker that
         * genuinely hangs after mem_save is still recoverable.
         */
        const terminationAck =
            cycle.last_memory_ack;

        const terminationPending =
            Boolean(
                terminationAck &&
                terminationAck.phase ===
                    cycle.phase &&
                (
                    !cycle.phase_result ||
                    cycle.phase_result.phase !==
                        cycle.phase
                ),
            );

        const terminationAckAt =
            terminationAck?.at
                ? Date.parse(
                      terminationAck.at,
                  )
                : NaN;

        const terminationGraceAgeMs =
            Number.isFinite(
                terminationAckAt,
            )
                ? Date.now() -
                  terminationAckAt
                : Number.POSITIVE_INFINITY;

        const terminationGraceActive =
            terminationPending &&
            terminationGraceAgeMs >= 0 &&
            terminationGraceAgeMs <=
                90 * 1000;

        if (
            terminationGraceActive
        ) {
            const terminationWatchdog =
                ensureWatchdogState(
                    cycle,
                );

            /*
             * WATCHDOG_TERMINATION_GRACE_LOG_ONCE_V1
             *
             * The watchdog polls every ~1.5 s. Log only the transition into
             * termination grace instead of emitting one line per poll.
             */
            const enteringTerminationGrace =
                terminationWatchdog.last_decision !==
                "termination_grace_waiting_for_phase_complete";

            terminationWatchdog.last_decision =
                "termination_grace_waiting_for_phase_complete";

            writeCycleState(
                cycle,
            );

            if (
                enteringTerminationGrace
            ) {
                phaseLog(
                    "WATCHDOG_TERMINATION_GRACE",
                    {
                        monitored_phase:
                            cycle.phase,

                        observation_id:
                            terminationAck
                                ?.observation_id,

                        ack_age_ms:
                            terminationGraceAgeMs,

                        phase_result_present:
                            Boolean(
                                cycle.phase_result,
                            ),
                    },
                );
            }

            continue;
        }

        const usage =
            ctx.getContextUsage();

        const evaluation =
            evaluateWatchdog(
                cycle,
                usage,
                ctx.model,
            );

        if (
            !evaluation.suspicious
        ) {
            /*
             * Persist context measurements occasionally without generating
             * any model intervention.
             */
            writeCycleState(
                cycle,
            );

            continue;
        }

        const watchdog =
            ensureWatchdogState(
                cycle,
            );

        const lastReview =
            watchdog.last_review_at
                ? Date.parse(
                      watchdog.last_review_at,
                  )
                : 0;

        const inCooldown =
            !evaluation.hard &&
            Number.isFinite(
                lastReview,
            ) &&
            Date.now() -
                lastReview <
                WATCHDOG_REVIEW_COOLDOWN_MS;

        if (
            inCooldown
        ) {
            continue;
        }

        watchdog.reviews +=
            1;

        watchdog.last_review_at =
            new Date()
                .toISOString();

        watchdog.last_review_tool_calls =
            watchdog.tool_calls;

        watchdog.last_trigger =
            evaluation.trigger;

        writeCycleState(
            cycle,
        );

        let decision:
            WatchdogDecision;

        phaseLog(
            "WATCHDOG_REVIEW_START",
            {
                monitored_phase:
                    cycle.phase,

                review:
                    watchdog.reviews,

                trigger:
                    evaluation.trigger,

                hard:
                    evaluation.hard,

                metrics:
                    phaseLogPreview(
                        evaluation.metrics,
                        800,
                    ),
            },
        );

        try {
            const reviewStarted =
                Date.now();

            decision =
                await reviewWatchdog(
                    cycle,
                    evaluation.trigger,
                    evaluation.hard,
                    evaluation.metrics,
                );

            /*
             * WATCHDOG_SEMANTIC_CHECKPOINT_V1
             *
             * Persist immediately after a successful review so an external
             * shutdown/crash does not lose the latest semantic progress.
             */
            {
                const persistedCycle =
                    readCycleState() ??
                    cycle;

                const persistedWatchdog =
                    ensureWatchdogState(
                        persistedCycle,
                    );

                persistedWatchdog.semantic_checkpoint = {
                    verified_facts:
                        Array.isArray(
                            decision.verified_facts,
                        )
                            ? decision.verified_facts
                                  .map(
                                      (item) =>
                                          clipCycleText(
                                              item,
                                              700,
                                          ),
                                  )
                                  .filter(Boolean)
                                  .slice(0, 16)
                            : [],

                    validated_operations:
                        Array.isArray(
                            decision.validated_operations,
                        )
                            ? decision.validated_operations
                                  .map(
                                      (item) =>
                                          clipCycleText(
                                              item,
                                              700,
                                          ),
                                  )
                                  .filter(Boolean)
                                  .slice(0, 12)
                            : [],

                    relevant_files:
                        Array.isArray(
                            decision.relevant_files,
                        )
                            ? decision.relevant_files
                                  .map(
                                      (item) =>
                                          clipCycleText(
                                              item,
                                              700,
                                          ),
                                  )
                                  .filter(Boolean)
                                  .slice(0, 16)
                            : [],

                    unresolved_facts:
                        Array.isArray(
                            decision.unresolved_facts,
                        )
                            ? decision.unresolved_facts
                                  .map(
                                      (item) =>
                                          clipCycleText(
                                              item,
                                              700,
                                          ),
                                  )
                                  .filter(Boolean)
                                  .slice(0, 16)
                            : [],

                    continuation_objective:
                        clipCycleText(
                            decision.continuation_objective,
                            900,
                        ),

                    captured_at:
                        new Date()
                            .toISOString(),
                };

                writeCycleState(
                    persistedCycle,
                );

                phaseLog(
                    "WATCHDOG_SEMANTIC_CHECKPOINT_SAVED",
                    {
                        monitored_phase:
                            persistedCycle.phase,

                        verified_facts:
                            persistedWatchdog
                                .semantic_checkpoint
                                .verified_facts
                                .length,

                        validated_operations:
                            persistedWatchdog
                                .semantic_checkpoint
                                .validated_operations
                                .length,

                        unresolved_facts:
                            persistedWatchdog
                                .semantic_checkpoint
                                .unresolved_facts
                                .length,
                    },
                );
            }

            phaseLog(
                "WATCHDOG_REVIEW_END",
                {
                    monitored_phase:
                        cycle.phase,

                    review:
                        watchdog.reviews,

                    duration_ms:
                        Date.now() -
                        reviewStarted,

                    decision:
                        decision.action,

                    reason:
                        clipCycleText(
                            decision.reason,
                            600,
                        ),

                    next_objective:
                        clipCycleText(
                            decision.next_objective,
                            600,
                        ),
                },
            );
        } catch (error) {
            phaseLog(
                "WATCHDOG_REVIEW_END",
                {
                    monitored_phase:
                        cycle.phase,

                    review:
                        watchdog.reviews,

                    ok:
                        false,

                    error:
                        clipCycleText(
                            error instanceof Error
                                ? error.message
                                : String(error),
                            700,
                        ),
                },
            );
            /*
             * A soft Qwen-review failure must not kill healthy work.
             * A hard-limit review failure must not allow an infinite loop.
             */
            if (
                !evaluation.hard
            ) {
                cycle =
                    readCycleState() ??
                    cycle;

                ensureWatchdogState(
                    cycle,
                ).last_decision =
                    "qwen_review_failed_continue";

                writeCycleState(
                    cycle,
                );

                continue;
            }

            decision = {
                action:
                    "blocked",

                reason:
                    "Hard watchdog limit reached and Qwen watchdog review failed.",

                summary:
                    clipCycleText(
                        error instanceof Error
                            ? error.message
                            : String(error),
                        1200,
                    ),

                next_objective:
                    "",

                missing_information:
                    [],

                avoid_repeating:
                    [
                        evaluation.trigger,
                    ],
            };
        }

        /*
         * WATCHDOG_STALE_REVIEW_PRE_ABORT_V1
         *
         * A watchdog review is asynchronous while the worker continues
         * executing. Before ANY destructive recovery/serialization decision,
         * re-read authoritative state and invalidate a non-continue decision
         * if the worker produced new tool calls after the review snapshot.
         *
         * This barrier must execute before ANALYST_SERIALIZATION_V1 because
         * that path can abort the worker.
         */
        if (
            ctx.isIdle()
        ) {
            return;
        }

        cycle =
            readCycleState() ??
            cycle;

        if (
            cycle.status !==
                "running" ||
            cycle.phase !==
                phase
        ) {
            return;
        }

        const preAbortWatchdog =
            ensureWatchdogState(
                cycle,
            );

        const workerProgressedBeforeDestructiveAction =
            preAbortWatchdog.tool_calls >
            preAbortWatchdog.last_review_tool_calls;

        if (
            decision.action !==
                "continue" &&
            workerProgressedBeforeDestructiveAction
        ) {
            phaseLog(
                "WATCHDOG_STALE_REVIEW_PRE_ABORT_INVALIDATED",
                {
                    monitored_phase:
                        cycle.phase,

                    stale_decision:
                        decision.action,

                    hard:
                        evaluation.hard,

                    tool_calls:
                        preAbortWatchdog.tool_calls,

                    review_snapshot_tool_calls:
                        preAbortWatchdog
                            .last_review_tool_calls,
                },
            );

            preAbortWatchdog.last_decision =
                "stale_review_pre_abort_progress_continue";

            writeCycleState(
                cycle,
            );

            continue;
        }

        /*
         * COGNITIVE_RECOVERY_V1
         *
         * A local Qwen "blocked" decision is not enough to terminate an
         * autonomous task. Escalate reasoning to Glimmer, then let Qwen
         * validate/replan the proposed recovery.
         *
         * Also escalate malformed reroutes that do not contain an executable
         * next objective.
         */
        /*
         * WATCHDOG_SOFT_REVIEW_ADVISORY_V1
         *
         * Qwen is advisory while watchdog evaluation is SOFT.
         * Deep recovery/worker abortion is permitted only after an
         * independently established HARD watchdog condition.
         */
        if (
            evaluation.hard &&
            (
                decision.action ===
                    "blocked" ||
                (
                    decision.action ===
                        "abort_reroute" &&
                    !clipCycleText(
                        decision.next_objective,
                        1200,
                    )
                )
            )
        ) {
            try {
                // ANALYST_SERIALIZATION_V1
                //
                // The execution worker and the recovery analyst use the same
                // Glimmer model/backend. Never launch the analyst while the
                // worker is still generating.
                phaseLog(
                    "ANALYST_SERIALIZATION_START",
                    {
                        monitored_phase:
                            cycle.phase,

                        trigger:
                            evaluation.trigger,

                        worker_idle_before_abort:
                            ctx.isIdle(),
                    },
                );

                try {
                    if (!ctx.isIdle()) {
                        ctx.abort();

                        phaseLog(
                            "ANALYST_WORKER_ABORT_REQUESTED",
                            {
                                monitored_phase:
                                    cycle.phase,
                            },
                        );
                    }
                } catch (abortError) {
                    phaseLog(
                        "ANALYST_WORKER_ABORT_ERROR",
                        {
                            monitored_phase:
                                cycle.phase,

                            error:
                                clipCycleText(
                                    abortError instanceof Error
                                        ? abortError.message
                                        : String(
                                              abortError,
                                          ),
                                    700,
                                ),
                        },
                    );
                }

                /*
                 * Command context patch gives normal input/phase contexts
                 * waitForIdle(). Do not call the same LM Studio Glimmer model
                 * until the worker inference is definitively idle.
                 */
                await ctx.waitForIdle();

                const serializedCycle =
                    readCycleState();

                if (
                    !serializedCycle ||
                    serializedCycle.status !==
                        "running" ||
                    serializedCycle.phase !==
                        cycle.phase
                ) {
                    phaseLog(
                        "ANALYST_SERIALIZATION_CANCELLED",
                        {
                            monitored_phase:
                                cycle.phase,

                            reason:
                                "cycle_or_phase_changed_while_waiting_for_worker_idle",
                        },
                    );

                    return;
                }

                /*
                 * Race-safe completion:
                 *
                 * If the worker managed to complete the phase between Qwen's
                 * review and the abort becoming effective, normal phase
                 * completion takes precedence. Do not manufacture recovery.
                 */
                if (
                    serializedCycle.phase_result &&
                    serializedCycle.phase_result.phase ===
                        serializedCycle.phase
                ) {
                    phaseLog(
                        "ANALYST_SERIALIZATION_SKIPPED",
                        {
                            monitored_phase:
                                serializedCycle.phase,

                            reason:
                                "worker_completed_before_serialized_analysis",
                        },
                    );

                    return;
                }

                cycle =
                    serializedCycle;

                phaseLog(
                    "ANALYST_SERIALIZATION_READY",
                    {
                        monitored_phase:
                            cycle.phase,

                        worker_idle:
                            ctx.isIdle(),

                        tool_calls:
                            cycle.watchdog
                                ?.tool_calls ??
                            0,

                        turns:
                            cycle.watchdog
                                ?.turns ??
                            0,
                    },
                );

                decision =
                    await escalateWatchdogRecovery(
                        cycle,
                        evaluation.trigger,
                        evaluation.metrics,
                        decision,
                    );
            } catch (error) {
                /*
                 * Analyst/validator infrastructure failure is itself concrete
                 * diagnostic information. Preserve it rather than pretending
                 * the engineering task itself is blocked.
                 *
                 * Prefer a bounded reroute using Qwen's existing information.
                 */
                decision = {
                    action:
                        "abort_reroute",

                    reason:
                        "Deep recovery analysis failed, but the original task " +
                        "is not proven blocked. Continue in a fresh context " +
                        "with a materially different strategy. Recovery error: " +
                        clipCycleText(
                            error instanceof Error
                                ? error.message
                                : String(error),
                            700,
                        ),

                    summary:
                        "Worker strategy failed to converge; deep recovery " +
                        "infrastructure also failed, so controller rejected " +
                        "termination without a verified task blocker.",

                    next_objective:
                        localRecoveryObjective(
                            cycle,
                            evaluation.trigger,
                        ),

                    missing_information:
                        [],

                    avoid_repeating: [
                        evaluation.trigger,
                        "Do not repeat the previous tool/reasoning loop.",
                    ],
                };

                phaseLog(
                    "GLOBAL_REPLAN_END",
                    {
                        monitored_phase:
                            cycle.phase,

                        decision:
                            "abort_reroute",

                        degraded_fallback:
                            true,

                        error:
                            clipCycleText(
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                                700,
                            ),
                    },
                );
            }
        }

        phaseLog(
            "WATCHDOG_DECISION",
            {
                monitored_phase:
                    cycle.phase,

                review:
                    ensureWatchdogState(
                        cycle,
                    ).reviews,

                decision:
                    decision.action,

                reason:
                    clipCycleText(
                        decision.reason,
                        700,
                    ),

                next_objective:
                    clipCycleText(
                        decision.next_objective,
                        700,
                    ),
            },
        );

        /*
         * The worker may have completed while Qwen was reviewing it.
         */
        if (
            ctx.isIdle()
        ) {
            return;
        }

        cycle =
            readCycleState() ??
            cycle;

        if (
            cycle.status !==
                "running" ||
            cycle.phase !==
                phase
        ) {
            return;
        }

        const latestWatchdog =
            ensureWatchdogState(
                cycle,
            );

        /*
         * WATCHDOG_STALE_REVIEW_GUARD_V1
         *
         * The worker continues running while Qwen reviews watchdog state.
         * A review may therefore become stale before Qwen returns.
         *
         * If new tool calls were produced after the review snapshot was
         * taken, a blocked/reroute decision based on "no progress" must not
         * terminate that now-progressing worker. Let the next watchdog
         * evaluation judge the fresh state instead.
         */
        const workerProgressedDuringReview =
            latestWatchdog.tool_calls >
            latestWatchdog.last_review_tool_calls;

        if (
            decision.action !==
                "continue" &&
            workerProgressedDuringReview
        ) {
            phaseLog(
                "WATCHDOG_STALE_REVIEW_INVALIDATED",
                {
                    monitored_phase:
                        cycle.phase,

                    stale_decision:
                        decision.action,

                    tool_calls:
                        latestWatchdog.tool_calls,

                    review_snapshot_tool_calls:
                        latestWatchdog
                            .last_review_tool_calls,
                },
            );

            latestWatchdog.last_decision =
                "stale_review_progress_continue";

            writeCycleState(
                cycle,
            );

            continue;
        }

        latestWatchdog.last_decision =
            decision.action;

        writeCycleState(
            cycle,
        );

        /*
         * WATCHDOG_SOFT_DECISION_BARRIER_V1
         *
         * Soft watchdog evaluations may request a Qwen review, but the
         * reviewer has no termination authority. Explicit HARD thresholds
         * remain authoritative and continue through the recovery path below.
         */
        if (!evaluation.hard) {
            if (
                decision.action !==
                    "continue"
            ) {
                phaseLog(
                    "WATCHDOG_SOFT_ADVISORY_IGNORED",
                    {
                        monitored_phase:
                            cycle.phase,

                        advisory_action:
                            decision.action,

                        trigger:
                            evaluation.trigger,

                        reason:
                            clipCycleText(
                                decision.reason,
                                700,
                            ),
                    },
                );

                latestWatchdog.last_decision =
                    `soft_${decision.action}_advisory_continue`;

                writeCycleState(
                    cycle,
                );
            }

            continue;
        }

        let action:
            "abort_reroute" |
            "blocked" =
            decision.action ===
                "abort_reroute"
                ? "abort_reroute"
                : "blocked";

        let nextObjective =
            clipCycleText(
                decision.next_objective,
                700,
            );

        /*
         * If Qwen chose reroute, a concrete next phase is mandatory.
         */
        if (
            action ===
                "abort_reroute" &&
            !nextObjective
        ) {
            action =
                "blocked";
        }

        const recovery:
            WatchdogRecovery = {
                phase:
                    cycle.phase,

                action,

                trigger:
                    evaluation.trigger,

                reason:
                    clipCycleText(
                        decision.reason,
                        800,
                    ),

                summary:
                    clipCycleText(
                        decision.summary,
                        1600,
                    ),

                next_objective:
                    nextObjective,

                missing_information:
                    Array.isArray(
                        decision.missing_information,
                    )
                        ? decision.missing_information
                              .map(
                                  (item) =>
                                      clipCycleText(
                                          item,
                                          400,
                                      ),
                              )
                              .slice(
                                  0,
                                  12,
                              )
                        : [],

                avoid_repeating:
                    Array.isArray(
                        decision.avoid_repeating,
                    )
                        ? decision.avoid_repeating
                              .map(
                                  (item) =>
                                      clipCycleText(
                                          item,
                                          400,
                                      ),
                              )
                              .slice(
                                  0,
                                  12,
                              )
                        : [],

                at:
                    new Date()
                        .toISOString(),
            };

        cycle.watchdog_recovery =
            recovery;

        writeCycleState(
            cycle,
        );

        try {
            ctx.ui.notify(
                `WATCHDOG ${action.toUpperCase()} | ${clipCycleText(evaluation.trigger, 350)}`,
                action ===
                    "blocked"
                    ? "error"
                    : "info",
            );
        } catch {
            // State file remains authoritative.
        }

        /*
         * Programmatic equivalent of aborting the active agent run.
         */
        phaseLog(
            "WATCHDOG_ABORT_REQUEST",
            {
                source:
                    "monitorWorkerPhase",
            },
        );

        ctx.abort();

        return;
    }
}

// ============================================================================
// END PHASE_WATCHDOG_V1 CORE
// ============================================================================
function objectiveKey(
    value: string,
): string {
    return value
        .toLowerCase()
        .replace(
            /\s+/g,
            " ",
        )
        .trim();
}


function idleRouteAfterCycle(
    cycle: CycleState,
): RouterState {
    return {
        profile:
            "memory",

        tools: [
            "mem_get_observation",
        ],

        objective:
            `Idle after autonomous task ${cycle.task_id}.`,

        reason:
            "Autonomous cycle finished; lightweight idle profile.",

        updatedAt:
            new Date()
                .toISOString(),
    };
}


async function resetToFreshIdleSession(
    ctx: any,
    cycle: CycleState,
): Promise<void> {
    const idleRoute =
        idleRouteAfterCycle(
            cycle,
        );

    writeState(
        idleRoute,
    );

    /*
     * Important:
     * after newSession(), ctx becomes stale.
     * Only the fresh withSession ctx is used below.
     */
    await ctx.newSession({
        withSession:
            async (
                freshCtx: any,
            ) => {
                const current =
                    readCycleState() ??
                    cycle;

                freshCtx.ui.notify(
                    `AUTO DONE | task=${current.task_id} | completed_phases=${current.history.length} | recoveries=${current.watchdog_history?.length ?? 0} | ${clipCycleText(current.final_summary ?? "completed", 600)}`,
                    "info",
                );
            },
    });
}


async function runCyclePhase(
    ctx: any,
    cycleInput: CycleState,
): Promise<void> {
    const current =
        readCycleState() ??
        cycleInput;

    if (
        current.status !==
        "running"
    ) {
        return;
    }

    try {
        await ctx.newSession({
            withSession:
                async (
                    freshCtx: any,
                ) => {
                    try {
                        const phaseState =
                            readCycleState();

                        if (
                            !phaseState ||
                            phaseState.status !==
                                "running"
                        ) {
                            return;
                        }

                        phaseState.watchdog =
                            newWatchdogState(
                                phaseState.phase,
                            );

                        phaseState.watchdog_recovery =
                            null;

                        /*
                         * EVIDENCE_PLAN_V1
                         *
                         * Generate the sufficiency contract BEFORE Glimmer
                         * starts. Qwen is the planner; the worker remains the
                         * autonomous executor.
                         */
                        const evidencePlan =
                            await buildEvidencePlan(
                                phaseState,
                            );

                        phaseState.evidence_plan =
                            evidencePlan;

                        writeCycleState(
                            phaseState,
                        );

                        const kickoffBase =
                            buildWorkerKickoff(
                                phaseState,
                            );

                        const kickoff =
                            evidencePlan
                                ? kickoffBase +
                                  "\n\n" +
                                  formatEvidencePlanForWorker(
                                      evidencePlan,
                                  )
                                : kickoffBase;

                        // WATCHDOG_CONCURRENT_WORKER_V1
                        //
                        // sendUserMessage() remains pending for the active
                        // worker run. Therefore awaiting it before starting
                        // monitorWorkerPhase() disables real-time supervision.
                        //
                        // Start both operations concurrently. The watchdog's
                        // startup gate handles the short interval in which
                        // isIdle() may still report true.
                        const workerPromise =
                            freshCtx.sendUserMessage(
                                kickoff,
                            );

                        const watchdogPromise =
                            monitorWorkerPhase(
                                freshCtx,
                                phaseState.phase,
                            );

                        const concurrentResults =
                            await Promise.allSettled(
                                [
                                    workerPromise,
                                    watchdogPromise,
                                ],
                            );

                        /*
                         * Both operations have now settled. Keep the explicit
                         * idle barrier as an invariant before examining the
                         * transactional phase state.
                         */
                        await freshCtx.waitForIdle();

                        const workerResult =
                            concurrentResults[0];

                        const watchdogResult =
                            concurrentResults[1];

                        if (
                            watchdogResult.status ===
                            "rejected"
                        ) {
                            throw watchdogResult.reason;
                        }

                        /*
                         * ctx.abort() may reject the worker promise when the
                         * watchdog intentionally interrupts the phase.
                         * That rejection is expected only when a transactional
                         * watchdog_recovery exists.
                         */
                        if (
                            workerResult.status ===
                            "rejected"
                        ) {
                            const interruptedState =
                                readCycleState();

                            if (
                                !interruptedState?.
                                    watchdog_recovery
                            ) {
                                throw workerResult.reason;
                            }
                        }

                        let after =
                            readCycleState();

                        if (!after) {
                            throw new Error(
                                "Cycle state disappeared after worker phase.",
                            );
                        }

                        if (
                            after.status ===
                            "stopped"
                        ) {
                            freshCtx.ui.notify(
                                `AUTO STOPPED | task=${after.task_id}`,
                                "info",
                            );

                            return;
                        }

                        if (
                            after.status !==
                            "running"
                        ) {
                            return;
                        }

                        const watchdogRecovery =
                            after.watchdog_recovery;

                        if (
                            watchdogRecovery &&
                            watchdogRecovery.phase ===
                                after.phase
                        ) {
                            if (
                                !Array.isArray(
                                    after.watchdog_history,
                                )
                            ) {
                                after.watchdog_history =
                                    [];
                            }

                            if (
                                !watchdogRecovery
                                    .evidence_snapshot
                            ) {
                                watchdogRecovery
                                    .evidence_snapshot =
                                    buildRecoveryEvidenceSnapshot(
                                        after,
                                    );

                                phaseLog(
                                    "RECOVERY_EVIDENCE_CAPTURED",
                                    {
                                        source_phase:
                                            after.phase,

                                        trigger:
                                            watchdogRecovery
                                                .trigger,

                                        successful_events:
                                            after.watchdog
                                                ?.events
                                                .filter(
                                                    (
                                                        event,
                                                    ) =>
                                                        !event
                                                            .is_error,
                                                )
                                                .length ??
                                            0,

                                        errors:
                                            after.watchdog
                                                ?.events
                                                .filter(
                                                    (
                                                        event,
                                                    ) =>
                                                        event
                                                            .is_error,
                                                )
                                                .length ??
                                            0,
                                    },
                                );
                            }

                            after.watchdog_history.push(
                                watchdogRecovery,
                            );

                            after.watchdog_recovery =
                                null;

                            if (
                                watchdogRecovery.action ===
                                "blocked"
                            ) {
                                after.status =
                                    "blocked";

                                after.final_summary =
                                    watchdogRecovery.summary ||
                                    watchdogRecovery.reason ||
                                    watchdogRecovery.trigger;

                                writeCycleState(
                                    after,
                                );

                                writeState(
                                    idleRouteAfterCycle(
                                        after,
                                    ),
                                );

                                await freshCtx.newSession({
                                    withSession:
                                        async (
                                            cleanCtx: any,
                                        ) => {
                                            cleanCtx.ui.notify(
                                                `AUTO BLOCKED BY WATCHDOG | task=${after.task_id} | phase=${after.phase} | ${clipCycleText(after.final_summary ?? "", 650)}`,
                                                "error",
                                            );
                                        },
                                });

                                return;
                            }

                            if (
                                after.phase >=
                                MAX_CYCLE_PHASES
                            ) {
                                after.status =
                                    "blocked";

                                after.final_summary =
                                    `Watchdog requested recovery but maximum autonomous phase limit (${MAX_CYCLE_PHASES}) was reached.`;

                                writeCycleState(
                                    after,
                                );

                                writeState(
                                    idleRouteAfterCycle(
                                        after,
                                    ),
                                );

                                await freshCtx.newSession({
                                    withSession:
                                        async (
                                            cleanCtx: any,
                                        ) => {
                                            cleanCtx.ui.notify(
                                                after.final_summary ?? "AUTO BLOCKED",
                                                "error",
                                            );
                                        },
                                });

                                return;
                            }

                            const recoveryObjective =
                                watchdogRecovery.next_objective;

                            if (
                                !recoveryObjective
                            ) {
                                throw new Error(
                                    "Watchdog requested reroute without next_objective.",
                                );
                            }

                            /*
                             * Qwen defined a different bounded strategy.
                             * Route that strategy exactly as any normal phase.
                             */
                            phaseLog(
                                "RECOVERY_REROUTE",
                                {
                                    from_phase:
                                        after.phase,

                                    to_phase:
                                        after.phase +
                                        1,

                                    trigger:
                                        watchdogRecovery.trigger,

                                    reason:
                                        clipCycleText(
                                            watchdogRecovery.reason,
                                            700,
                                        ),

                                    next_objective:
                                        clipCycleText(
                                            recoveryObjective,
                                            900,
                                        ),

                                    avoid_repeating:
                                        watchdogRecovery.avoid_repeating,
                                },
                            );

                            const proposedRecoveryRoute =
                                await routeWithQwen(
                                    recoveryObjective,
                                );

                            const recoveryRoute =
                                preserveRecoveryRoute(
                                    after.current_route,
                                    proposedRecoveryRoute,
                                    recoveryObjective,
                                );

                            const recoveredCycle:
                                CycleState = {
                                    ...after,

                                    phase:
                                        after.phase +
                                        1,

                                    phase_objective:
                                        recoveryObjective,

                                    current_route:
                                        recoveryRoute,

                                    last_memory_ack:
                                        null,

                                    phase_result:
                                        null,

                                    watchdog:
                                        undefined,

                                    watchdog_recovery:
                                        null,

                                    error:
                                        undefined,

                                    updated_at:
                                        new Date()
                                            .toISOString(),
                                };

                            writeState(
                                recoveryRoute,
                            );

                            writeCycleState(
                                recoveredCycle,
                            );

                            try {
                                freshCtx.ui.notify(
                                    `WATCHDOG REROUTE | phase ${after.phase} → ${recoveredCycle.phase} | ${recoveryRoute.profile} | ${recoveryRoute.tools.join(", ")}`,
                                    "info",
                                );
                            } catch {
                                // Session is about to be replaced.
                            }

                            /*
                             * This creates a genuinely fresh worker context.
                             * The loop context is not inherited.
                             */
                            await runCyclePhase(
                                freshCtx,
                                recoveredCycle,
                            );

                            return;
                        }

                        const phaseResult =
                            after.phase_result;

                        const ack =
                            after.last_memory_ack;

                        if (
                            !phaseResult ||
                            phaseResult.phase !==
                                after.phase
                        ) {
                            throw new Error(
                                `Phase ${after.phase} ended without phase_complete.`,
                            );
                        }

                        if (
                            !ack ||
                            ack.phase !==
                                after.phase ||
                            ack.observation_id !==
                                phaseResult.memory_id
                        ) {
                            throw new Error(
                                `Phase ${after.phase} has no matching Engram persistence ACK.`,
                            );
                        }

                        const alreadyRecorded =
                            after.history.some(
                                (entry) =>
                                    entry.phase ===
                                    after.phase,
                            );

                        if (
                            !alreadyRecorded
                        ) {
                            after.history.push({
                                phase:
                                    after.phase,

                                objective:
                                    after.phase_objective,

                                outcome:
                                    phaseResult.outcome,

                                summary:
                                    phaseResult.summary,

                                relevant_files:
                                    phaseResult.relevant_files,

                                blockers:
                                    phaseResult.blockers,

                                memory_id:
                                    phaseResult.memory_id,
                            });
                        }

                        writeCycleState(
                            after,
                        );

                        const decision =
                            await superviseCycle(
                                after,
                            );

                        const decisionStatus =
                            decision.status;

                        if (
                            decisionStatus ===
                            "done"
                        ) {
                            const evidenceValidation =
                                await validateCompletionEvidence(
                                    after,
                                    phaseResult,
                                    decision,
                                );

                            (after as any)
                                .evidence_validation = {
                                    at:
                                        new Date()
                                            .toISOString(),

                                    ...evidenceValidation,
                                };

                            writeCycleState(
                                after,
                            );

                            if (
                                evidenceValidation
                                    .status ===
                                "insufficient"
                            ) {
                                phaseLog(
                                    "EVIDENCE_INSUFFICIENT",
                                    {
                                        phase:
                                            after.phase,

                                        reason:
                                            clipCycleText(
                                                evidenceValidation
                                                    .reason,
                                                700,
                                            ),

                                        missing_evidence:
                                            evidenceValidation
                                                .missing_evidence,

                                        next_objective:
                                            clipCycleText(
                                                evidenceValidation
                                                    .next_objective,
                                                900,
                                            ),
                                    },
                                );

                                if (
                                    after.phase >=
                                    MAX_CYCLE_PHASES
                                ) {
                                    after.status =
                                        "blocked";

                                    after.final_summary =
                                        "Evidence remains insufficient to " +
                                        "support the requested conclusion, " +
                                        `and maximum autonomous phase limit (${MAX_CYCLE_PHASES}) was reached. ` +
                                        clipCycleText(
                                            evidenceValidation
                                                .reason,
                                            900,
                                        );

                                    writeCycleState(
                                        after,
                                    );

                                    freshCtx.ui.notify(
                                        `AUTO BLOCKED | evidence insufficient | ${clipCycleText(after.final_summary, 700)}`,
                                        "error",
                                    );

                                    return;
                                }

                                const evidenceObjective =
                                    evidenceValidation
                                        .next_objective;

                                if (
                                    !evidenceObjective
                                ) {
                                    throw new Error(
                                        "Evidence validator returned insufficient without next_objective.",
                                    );
                                }

                                const proposedEvidenceRoute =
                                    await routeWithQwen(
                                        evidenceObjective,
                                    );

                                const evidenceRoute =
                                    preserveRecoveryRoute(
                                        after.current_route,
                                        proposedEvidenceRoute,
                                        evidenceObjective,
                                    );

                                const evidenceCycle:
                                    CycleState = {
                                        ...after,

                                        phase:
                                            after.phase +
                                            1,

                                        phase_objective:
                                            evidenceObjective,

                                        current_route:
                                            evidenceRoute,

                                        last_memory_ack:
                                            null,

                                        phase_result:
                                            null,

                                        watchdog:
                                            undefined,

                                        watchdog_recovery:
                                            null,

                                        error:
                                            undefined,

                                        updated_at:
                                            new Date()
                                                .toISOString(),
                                    };

                                phaseLog(
                                    "EVIDENCE_REROUTE",
                                    {
                                        from_phase:
                                            after.phase,

                                        to_phase:
                                            evidenceCycle
                                                .phase,

                                        route:
                                            evidenceRoute
                                                .profile,

                                        tools:
                                            evidenceRoute
                                                .tools,

                                        objective:
                                            clipCycleText(
                                                evidenceObjective,
                                                1000,
                                            ),
                                    },
                                );

                                writeState(
                                    evidenceRoute,
                                );

                                writeCycleState(
                                    evidenceCycle,
                                );

                                try {
                                    freshCtx.ui.notify(
                                        `EVIDENCE INSUFFICIENT | phase ${after.phase} → ${evidenceCycle.phase} | obtaining missing evidence`,
                                        "info",
                                    );
                                } catch {
                                    // Fresh session follows immediately.
                                }

                                await runCyclePhase(
                                    freshCtx,
                                    evidenceCycle,
                                );

                                return;
                            }

                            phaseLog(
                                "EVIDENCE_ACCEPTED",
                                {
                                    phase:
                                        after.phase,

                                    reason:
                                        clipCycleText(
                                            evidenceValidation
                                                .reason,
                                            700,
                                        ),

                                    supported_claims:
                                        evidenceValidation
                                            .supported_claims,
                                },
                            );

                            after.status =
                                "done";

                            after.final_summary =
                                clipCycleText(
                                    decision.final_summary ||
                                        decision.reason ||
                                        phaseResult.summary,
                                    1500,
                                );

                            writeCycleState(
                                after,
                            );

                            /*
                             * Final worker context is also discarded.
                             * Pi remains open in a clean lightweight session.
                             */
                            await resetToFreshIdleSession(
                                freshCtx,
                                after,
                            );

                            return;
                        }

                        if (
                            decisionStatus ===
                            "blocked"
                        ) {
                            after.status =
                                "blocked";

                            after.final_summary =
                                clipCycleText(
                                    decision.final_summary ||
                                        decision.reason ||
                                        phaseResult.summary,
                                    1500,
                                );

                            writeCycleState(
                                after,
                            );

                            freshCtx.ui.notify(
                                `AUTO BLOCKED | task=${after.task_id} | ${clipCycleText(after.final_summary, 700)}`,
                                "error",
                            );

                            return;
                        }

                        if (
                            decisionStatus !==
                            "continue"
                        ) {
                            throw new Error(
                                `Invalid cycle supervisor status: ${String(decisionStatus)}`,
                            );
                        }

                        if (
                            after.phase >=
                            MAX_CYCLE_PHASES
                        ) {
                            after.status =
                                "blocked";

                            after.final_summary =
                                `Maximum autonomous phase limit reached (${MAX_CYCLE_PHASES}).`;

                            writeCycleState(
                                after,
                            );

                            freshCtx.ui.notify(
                                after.final_summary,
                                "error",
                            );

                            return;
                        }

                        const nextObjective =
                            clipCycleText(
                                decision.next_objective,
                                600,
                            );

                        if (!nextObjective) {
                            throw new Error(
                                "Cycle supervisor selected continue without next_objective.",
                            );
                        }

                        if (
                            objectiveKey(
                                nextObjective,
                            ) ===
                            objectiveKey(
                                after.phase_objective,
                            )
                        ) {
                            throw new Error(
                                "Cycle supervisor attempted to repeat the same phase objective.",
                            );
                        }

                        /*
                         * Route the next bounded operation BEFORE replacing
                         * the current session. The new extension instance
                         * will read this state during startup and load only
                         * the resources required by the next phase.
                         */
                        const nextRoute =
                            await routeWithQwen(
                                nextObjective,
                            );

                        const nextCycle:
                            CycleState = {
                                ...after,

                                phase:
                                    after.phase +
                                    1,

                                phase_objective:
                                    nextObjective,

                                current_route:
                                    nextRoute,

                                last_memory_ack:
                                    null,

                                phase_result:
                                    null,

                                error:
                                    undefined,

                                updated_at:
                                    new Date()
                                        .toISOString(),
                            };

                        writeState(
                            nextRoute,
                        );

                        writeCycleState(
                            nextCycle,
                        );

                        /*
                         * freshCtx is the current valid session context here.
                         * runCyclePhase will replace it. Do not use freshCtx
                         * after this call returns.
                         */
                        await runCyclePhase(
                            freshCtx,
                            nextCycle,
                        );

                        return;
                    } catch (error) {
                        markCycleError(
                            error,
                        );

                        /*
                         * This ctx may itself have become stale if an inner
                         * session replacement already occurred. Notification
                         * is therefore best-effort only.
                         */
                        try {
                            freshCtx.ui.notify(
                                `AUTO ERROR | ${
                                    error instanceof Error
                                        ? error.message
                                        : String(error)
                                }`,
                                "error",
                            );
                        } catch {
                            // State file remains authoritative.
                        }
                    }
                },
        });
    } catch (error) {
        /*
         * Never touch the old ctx here: newSession may already have
         * invalidated it. Persist the error using plain external state.
         */
        markCycleError(
            error,
        );
    }
}

// ============================================================================
// END PHASE_CYCLE_V1
// ============================================================================


// ============================================================================
// QWEN_INPUT_SUPERVISOR_V1
//
// Qwen3.5/Ollama is the permanent control plane.
// Normal user instructions are intercepted BEFORE Glimmer sees them.
// Extension-injected worker prompts are deliberately excluded.
// ============================================================================

const QWEN_SUPERVISOR_MODEL =
    "qwen3.5:4b";

const OLLAMA_BASE_URL =
    "http://127.0.0.1:11434";

const QWEN_SUPERVISOR_STATE_PATH =
    join(
        AGENT_DIR,
        "qwen-supervisor-state.json",
    );

const QWEN_INPUT_TRACE_PATH =
    join(
        AGENT_DIR,
        "qwen-input-last.json",
    );


function sleepMs(
    ms: number,
): Promise<void> {
    return new Promise(
        (resolve) =>
            setTimeout(
                resolve,
                ms,
            ),
    );
}


async function ollamaIsReachable():
    Promise<boolean> {
    try {
        const response =
            await fetch(
                `${OLLAMA_BASE_URL}/api/tags`,
                {
                    signal:
                        AbortSignal.timeout(
                            1500,
                        ),
                },
            );

        return response.ok;
    } catch {
        return false;
    }
}


async function ensureOllamaServer():
    Promise<void> {
    if (
        await ollamaIsReachable()
    ) {
        return;
    }

    /*
     * Start Ollama detached.
     *
     * We only do this when the HTTP server is not already reachable,
     * so an existing Ollama instance is never deliberately restarted.
     */
    try {
        const child =
            spawn(
                "ollama",
                [
                    "serve",
                ],
                {
                    detached:
                        true,

                    stdio:
                        "ignore",

                    windowsHide:
                        true,
                },
            );

        child.unref();
    } catch (error) {
        throw new Error(
            `Unable to start Ollama: ${
                error instanceof Error
                    ? error.message
                    : String(error)
            }`,
        );
    }

    /*
     * Give the local server up to ~15 seconds to become available.
     */
    for (
        let attempt = 0;
        attempt < 30;
        attempt++
    ) {
        await sleepMs(
            500,
        );

        if (
            await ollamaIsReachable()
        ) {
            return;
        }
    }

    throw new Error(
        "Ollama did not become reachable at 127.0.0.1:11434.",
    );
}


async function ensureQwenSupervisorResident():
    Promise<void> {
    await ensureOllamaServer();

    /*
     * Ollama supports an empty generate request as a preload operation.
     * keep_alive=-1 keeps Qwen resident until explicitly unloaded.
     */
    const response =
        await fetch(
            `${OLLAMA_BASE_URL}/api/generate`,
            {
                method:
                    "POST",

                headers: {
                    "content-type":
                        "application/json",
                },

                body:
                    JSON.stringify({
                        model:
                            QWEN_SUPERVISOR_MODEL,

                        prompt:
                            "",

                        stream:
                            false,

                        keep_alive:
                            -1,
                    }),
            },
        );

    if (!response.ok) {
        const errorText =
            await response.text();

        throw new Error(
            `Cannot preload ${QWEN_SUPERVISOR_MODEL}: HTTP ${response.status}: ${errorText}`,
        );
    }

    writeFileSync(
        QWEN_SUPERVISOR_STATE_PATH,
        JSON.stringify(
            {
                ready:
                    true,

                backend:
                    "ollama",

                model:
                    QWEN_SUPERVISOR_MODEL,

                endpoint:
                    OLLAMA_BASE_URL,

                keep_alive:
                    -1,

                checked_at:
                    new Date()
                        .toISOString(),
            },
            null,
            2,
        ),
        "utf8",
    );
}


async function prepareSupervisedCycle(
    originalObjective: string,
): Promise<CycleState> {
    await ensureQwenSupervisorResident();

    const existing =
        readCycleState();

    const resumeCheckpoint =
        buildPersistentResumeCheckpoint(
            existing,
            originalObjective,
        );

    /*
     * A matching interrupted objective may legitimately remain marked
     * "running" after process/session loss. In that case the fresh execution
     * resumes with a NEW task_id.
     *
     * A different running objective remains protected against replacement.
     */
    if (
        existing?.status ===
            "running" &&
        !resumeCheckpoint
    ) {
        throw new Error(
            `Autonomous task already running: ${existing.task_id}`,
        );
    }

    /*
     * PERSISTENT_RESUME_CHECKPOINT_V1
     *
     * Resume the interrupted phase directly. Only a genuinely new objective
     * asks Qwen to create a fresh phase 1.
     */
    const first =
        resumeCheckpoint
            ? {
                  phaseObjective:
                      resumeCheckpoint
                          .next_unresolved_action,

                  reason:
                      `Resuming interrupted task ${resumeCheckpoint.source_task_id} from phase ${resumeCheckpoint.source_phase}`,
              }
            : await chooseFirstPhaseObjective(
                  originalObjective,
              );

    /*
     * Qwen then classifies that phase and the catalog/controller
     * resolves the minimum valid tool set.
     */
    const firstRoute =
        await routeWithQwen(
            first.phaseObjective,
        );

    const now =
        new Date()
            .toISOString();

    const cycle:
        CycleState = {
            schema_version:
                "1.0",

            task_id:
                `auto-${Date.now().toString(36)}`,

            status:
                "running",

            original_objective:
                originalObjective,

            resume_checkpoint:
                resumeCheckpoint,

            phase:
                1,

            phase_objective:
                first.phaseObjective,

            current_route:
                firstRoute,

            memory_ids:
                [],

            last_memory_ack:
                null,

            phase_result:
                null,

            history:
                [],

            created_at:
                now,

            updated_at:
                now,
        };

    writeState(
        firstRoute,
    );

    writeCycleState(
        cycle,
    );

    writeFileSync(
        QWEN_INPUT_TRACE_PATH,
        JSON.stringify(
            {
                timestamp:
                    now,

                source:
                    "normal_pi_input",

                original_objective:
                    originalObjective,

                qwen_first_phase:
                    first.phaseObjective,

                qwen_reason:
                    first.reason,

                route: {
                    profile:
                        firstRoute.profile,

                    tools:
                        firstRoute.tools,

                    reason:
                        firstRoute.reason,
                },

                task_id:
                    cycle.task_id,
            },
            null,
            2,
        ),
        "utf8",
    );

    return cycle;
}


function launchPreparedCycle(
    ctx: any,
    cycle: CycleState,
): void {
    /*
     * input handlers must return "handled" to Pi before the normal Glimmer
     * path starts. The autonomous cycle begins immediately afterwards.
     *
     * runCyclePhase creates the fresh worker session itself.
     */
    setTimeout(
        () => {
            void (
                async () => {
                    try {
                        await runCyclePhase(
                            ctx,
                            cycle,
                        );
                    } catch (error) {
                        markCycleError(
                            error,
                        );

                        try {
                            ctx.ui.notify(
                                `SUPERVISOR ERROR | ${
                                    error instanceof Error
                                        ? error.message
                                        : String(error)
                                }`,
                                "error",
                            );
                        } catch {
                            // Persistent cycle state is authoritative.
                        }
                    }
                }
            )();
        },
        0,
    );
}

// ============================================================================
// END QWEN_INPUT_SUPERVISOR_V1 CORE
// ============================================================================



// ============================================================================
// PHASE_ROUTER_LOG_V1
// Persistent JSONL control-plane telemetry.
// ============================================================================

const PHASE_ROUTER_LOG_PATH =
    `${process.env.USERPROFILE ?? "."}/.pi/agent/phase-router.log`;

const PHASE_ROUTER_LOG_OLD_PATH =
    `${PHASE_ROUTER_LOG_PATH}.1`;

const PHASE_ROUTER_CYCLE_STATE_PATH =
    `${process.env.USERPROFILE ?? "."}/.pi/agent/phase-cycle-state.json`;

const PHASE_ROUTER_LOG_MAX_BYTES =
    12 * 1024 * 1024;


function phaseLogPreview(
    value: unknown,
    maxLength = 420,
): string | null {
    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    let text: string;

    try {
        text =
            typeof value === "string"
                ? value
                : JSON.stringify(value);
    } catch {
        try {
            text = String(value);
        } catch {
            return "<unprintable>";
        }
    }

    text =
        text.replace(
            /\s+/g,
            " ",
        ).trim();

    if (
        text.length >
        maxLength
    ) {
        return (
            text.slice(
                0,
                maxLength,
            ) +
            "…"
        );
    }

    return text;
}


function phaseLogCycleMeta():
    Record<string, unknown> {
    try {
        if (
            !__phaseRouterFs.existsSync(
                PHASE_ROUTER_CYCLE_STATE_PATH,
            )
        ) {
            return {};
        }

        const raw =
            __phaseRouterFs.readFileSync(
                PHASE_ROUTER_CYCLE_STATE_PATH,
                "utf8",
            );

        const state =
            JSON.parse(
                raw,
            );

        return {
            task_id:
                state?.task_id ??
                null,

            status:
                state?.status ??
                null,

            phase:
                state?.phase ??
                null,

            phase_objective:
                phaseLogPreview(
                    state?.phase_objective,
                    260,
                ),

            route_profile:
                state?.current_route?.profile ??
                null,

            route_tools:
                state?.current_route?.tools ??
                null,

            memory_ids:
                state?.memory_ids ??
                [],

            last_memory_ack:
                state?.last_memory_ack ??
                null,

            watchdog_trigger:
                state?.watchdog?.last_trigger ??
                null,

            watchdog_decision:
                state?.watchdog?.last_decision ??
                null,

            recovery_action:
                state?.watchdog_recovery?.action ??
                null,

            recovery_trigger:
                state?.watchdog_recovery?.trigger ??
                null,

            error:
                phaseLogPreview(
                    state?.error,
                    300,
                ),
        };
    } catch {
        return {};
    }
}


function phaseLogRotateIfNeeded():
    void {
    try {
        if (
            !__phaseRouterFs.existsSync(
                PHASE_ROUTER_LOG_PATH,
            )
        ) {
            return;
        }

        const size =
            __phaseRouterFs.statSync(
                PHASE_ROUTER_LOG_PATH,
            ).size;

        if (
            size <
            PHASE_ROUTER_LOG_MAX_BYTES
        ) {
            return;
        }

        try {
            __phaseRouterFs.rmSync(
                PHASE_ROUTER_LOG_OLD_PATH,
                {
                    force:
                        true,
                },
            );
        } catch {
            // Ignore old-log cleanup failure.
        }

        __phaseRouterFs.renameSync(
            PHASE_ROUTER_LOG_PATH,
            PHASE_ROUTER_LOG_OLD_PATH,
        );
    } catch {
        // Logging must never break Pi.
    }
}


function phaseLog(
    event: string,
    data:
        Record<string, unknown> = {},
): void {
    try {
        phaseLogRotateIfNeeded();

        const record = {
            ts:
                new Date()
                    .toISOString(),

            monotonic_ms:
                Math.round(
                    performance.now(),
                ),

            pid:
                process.pid,

            event,

            ...phaseLogCycleMeta(),

            ...data,
        };

        __phaseRouterFs.appendFileSync(
            PHASE_ROUTER_LOG_PATH,
            JSON.stringify(
                record,
            ) + "\n",
            "utf8",
        );
    } catch {
        /*
         * Logging is observational only.
         * It must never alter controller behavior.
         */
    }
}


function phaseLogEngramId(
    result: any,
): string | number | null {
    const direct =
        result?.details?.data?.id ??
        result?.details?.id ??
        null;

    if (
        direct !== null &&
        direct !== undefined
    ) {
        return direct;
    }

    const text =
        phaseLogPreview(
            result,
            1800,
        ) ??
        "";

    const match =
        text.match(
            /saved\s+#(\d+)/i,
        );

    return (
        match?.[1] ??
        null
    );
}

// ============================================================================
// END PHASE_ROUTER_LOG_V1 CORE
// ============================================================================

export default async function phaseRouter(
    pi: ExtensionAPI,
) {

    // ========================================================================
    // PHASE_ROUTER_LOG_V1 EVENT TELEMETRY
    // ========================================================================

    phaseLog(
        "ROUTER_RUNTIME_READY",
        {
            cwd:
                process.cwd(),

            model:
                null,
        },
    );


    pi.on(
        "input",
        async (
            event: any,
            _ctx: any,
        ) => {
            phaseLog(
                "INPUT_RECEIVED",
                {
                    source:
                        event.source ??
                        null,

                    streaming_behavior:
                        event.streamingBehavior ??
                        null,

                    text:
                        phaseLogPreview(
                            event.text,
                            600,
                        ),
                },
            );

            return {
                action:
                    "continue",
            };
        },
    );


    pi.on(
        "session_start",
        async (
            event: any,
            ctx: any,
        ) => {
            phaseLog(
                "SESSION_START",
                {
                    reason:
                        event.reason ??
                        null,

                    cwd:
                        ctx.cwd ??
                        null,

                    model_provider:
                        ctx.model?.provider ??
                        null,

                    model_id:
                        ctx.model?.id ??
                        null,

                    thinking:
                        ctx.thinkingLevel ??
                        null,

                    active_tools:
                        (() => {
                            try {
                                return pi.getActiveTools();
                            } catch {
                                return null;
                            }
                        })(),
                },
            );
        },
    );


    pi.on(
        "session_shutdown",
        async (
            event: any,
            _ctx: any,
        ) => {
            phaseLog(
                "SESSION_SHUTDOWN",
                {
                    reason:
                        event.reason ??
                        null,
                },
            );
        },
    );


    pi.on(
        "agent_start",
        async (
            _event: any,
            _ctx: any,
        ) => {
            phaseLog(
                "WORKER_AGENT_START",
            );
        },
    );


    pi.on(
        "agent_end",
        async (
            event: any,
            _ctx: any,
        ) => {
            phaseLog(
                "WORKER_AGENT_END",
                {
                    message_count:
                        Array.isArray(
                            event.messages,
                        )
                            ? event.messages.length
                            : null,
                },
            );
        },
    );


    pi.on(
        "turn_end",
        async (
            event: any,
            _ctx: any,
        ) => {
            phaseLog(
                "TURN_END",
                {
                    turn_index:
                        event.turnIndex ??
                        null,

                    assistant:
                        phaseLogPreview(
                            event.message,
                            420,
                        ),

                    tool_result_count:
                        Array.isArray(
                            event.toolResults,
                        )
                            ? event.toolResults.length
                            : null,
                },
            );
        },
    );


    pi.on(
        "tool_execution_start",
        async (
            event: any,
            _ctx: any,
        ) => {
            phaseLog(
                "TOOL_START",
                {
                    tool_call_id:
                        event.toolCallId ??
                        null,

                    tool:
                        event.toolName ??
                        null,

                    args:
                        phaseLogPreview(
                            event.args,
                            650,
                        ),
                },
            );

            if (
                event.toolName ===
                "phase_complete"
            ) {
                phaseLog(
                    "PHASE_COMPLETE_START",
                    {
                        args:
                            phaseLogPreview(
                                event.args,
                                650,
                            ),
                    },
                );
            }
        },
    );


    pi.on(
        "tool_execution_end",
        async (
            event: any,
            _ctx: any,
        ) => {
            phaseLog(
                "TOOL_END",
                {
                    tool_call_id:
                        event.toolCallId ??
                        null,

                    tool:
                        event.toolName ??
                        null,

                    is_error:
                        event.isError ??
                        false,

                    result:
                        phaseLogPreview(
                            event.result,
                            700,
                        ),
                },
            );

            if (
                event.toolName ===
                "mem_save"
            ) {
                const telemetryObservationId =
                    event.isError
                        ? null
                        : phaseLogEngramId(
                              event.result,
                          );

                if (
                    !event.isError &&
                    telemetryObservationId !==
                        null
                ) {
                    phaseLog(
                        "ENGRAM_SAVE_ACK",
                        {
                            observation_id:
                                telemetryObservationId,

                            is_error:
                                false,
                        },
                    );
                } else {
                    phaseLog(
                        "ENGRAM_SAVE_NO_ACK",
                        {
                            observation_id:
                                null,

                            is_error:
                                event.isError ??
                                false,

                            result:
                                phaseLogPreview(
                                    event.result,
                                    500,
                                ),
                        },
                    );
                }
            }

            if (
                event.toolName ===
                "phase_complete"
            ) {
                phaseLog(
                    "PHASE_COMPLETE_END",
                    {
                        is_error:
                            event.isError ??
                            false,

                        result:
                            phaseLogPreview(
                                event.result,
                                520,
                            ),
                    },
                );
            }
        },
    );

    // ========================================================================
    // END PHASE_ROUTER_LOG_V1 EVENT TELEMETRY
    // ========================================================================


    // ========================================================================
    // QWEN_INPUT_SUPERVISOR_V1 REGISTRATION
    // ========================================================================

    /*
     * Keep Qwen ready from Pi startup/session startup.
     *
     * This is also harmless after a fresh phase session: an empty preload
     * simply ensures that the already-resident supervisor remains resident.
     */
    pi.on(
        "session_start",
        async (
            _event: any,
            ctx: any,
        ) => {
            try {
                await ensureQwenSupervisorResident();
            } catch (error) {
                try {
                    ctx.ui.notify(
                        `QWEN SUPERVISOR NOT READY | ${
                            error instanceof Error
                                ? error.message
                                : String(error)
                        }`,
                        "error",
                    );
                } catch {
                    // Do not crash Pi solely because UI notification failed.
                }
            }
        },
    );


    /*
     * Universal task gate.
     *
     * Pi's input event occurs before agent processing.
     */
    pi.on(
        "input",
        async (
            event: any,
            ctx: any,
        ) => {
            /*
             * CRITICAL:
             *
             * runCyclePhase() injects the worker kickoff using an extension
             * source. Those messages MUST reach Glimmer and MUST NOT be sent
             * back through Qwen, otherwise we create a routing recursion.
             */
            if (
                event.source ===
                "extension"
            ) {
                return {
                    action:
                        "continue",
                };
            }

            const text =
                String(
                    event.text ??
                    "",
                ).trim();

            if (!text) {
                return {
                    action:
                        "continue",
                };
            }

            /*
             * Slash commands remain control-plane commands.
             *
             * Known extension commands are normally consumed by Pi before
             * the input event, but this also protects built-ins and unknown
             * administrative slash input.
             */
            if (
                text.startsWith("/")
            ) {
                return {
                    action:
                        "continue",
                };
            }

            /*
             * User shell commands are operational control, not autonomous
             * cognitive tasks.
             */
            if (
                text.startsWith("!")
            ) {
                return {
                    action:
                        "continue",
                };
            }

            /*
             * During an already-streaming worker turn we currently preserve
             * Pi's existing steer/followUp behavior.
             *
             * This is deliberate for V1: normal NEW task instructions are
             * universally supervised now. Mid-stream steering will get its
             * own Qwen arbitration after the base path is stable.
             */
            if (
                event.streamingBehavior ===
                    "steer" ||
                event.streamingBehavior ===
                    "followUp" ||
                !ctx.isIdle()
            ) {
                return {
                    action:
                        "continue",
                };
            }

            /*
             * Fail closed:
             *
             * a normal new user task must not silently bypass Qwen if the
             * supervisor cannot prepare it.
             */
            try {
                ctx.ui.notify(
                    "Qwen supervisor reviewing input...",
                    "info",
                );

                const cycle =
                    await prepareSupervisedCycle(
                        text,
                    );

                ctx.ui.notify(
                    `QWEN → phase 1 | ${cycle.current_route?.profile ?? "unknown"} | ${(cycle.current_route?.tools ?? []).join(", ")}`,
                    "info",
                );

                /*
                 * The original user message is now owned by the autonomous
                 * controller and MUST NOT also be delivered directly to
                 * Glimmer.
                 */
                launchPreparedCycle(
                    ctx,
                    cycle,
                );

                return {
                    action:
                        "handled",
                };
            } catch (error) {
                ctx.ui.notify(
                    `QWEN INPUT BLOCKED | ${
                        error instanceof Error
                            ? error.message
                            : String(error)
                    }`,
                    "error",
                );

                /*
                 * Do not fall through to Glimmer on supervisor failure.
                 */
                return {
                    action:
                        "handled",
                };
            }
        },
    );

    // ========================================================================
    // END QWEN_INPUT_SUPERVISOR_V1 REGISTRATION
    // ========================================================================


    // ------------------------------------------------------------------------
    // PHASE_CYCLE_V1 registrations
    // ------------------------------------------------------------------------

    pi.registerTool({
        name:
            INTERNAL_PHASE_COMPLETE_TOOL,

        label:
            "Autonomous phase complete",

        description:
            "Internal terminal tool for autonomous phases. Call only after a successful mem_save ACK for the current phase.",

        promptSnippet:
            "Autonomous phase completion: persist with mem_save first, wait for ACK, then call phase_complete as the final action.",

        parameters:
            Type.Object({
                summary:
                    Type.String({
                        description:
                            "Compact factual phase result for the next phase.",
                        minLength:
                            1,
                        maxLength:
                            3000,
                    }),

                outcome:
                    Type.Union([
                        Type.Literal(
                            "completed",
                        ),
                        Type.Literal(
                            "blocked",
                        ),
                    ]),

                relevant_files:
                    Type.Optional(
                        Type.Array(
                            Type.String({
                                maxLength:
                                    500,
                            }),
                            {
                                maxItems:
                                    20,
                            },
                        ),
                    ),

                blockers:
                    Type.Optional(
                        Type.Array(
                            Type.String({
                                maxLength:
                                    500,
                            }),
                            {
                                maxItems:
                                    20,
                            },
                        ),
                    ),
            }),

        /*
         * If a model nevertheless emits mem_save and phase_complete in
         * one tool batch, sequential execution prevents a parallel race.
         * The worker contract still requires separate turns.
         */
        executionMode:
            "sequential",

        async execute(
            _toolCallId: string,
            params: any,
        ) {
            const cycle =
                readCycleState();

            if (
                !cycle ||
                cycle.status !==
                    "running"
            ) {
                throw new Error(
                    "phase_complete is only valid during a running autonomous cycle.",
                );
            }

            const ack =
                cycle.last_memory_ack;

            if (
                !ack ||
                ack.phase !==
                    cycle.phase ||
                !Number.isInteger(
                    ack.observation_id,
                ) ||
                ack.observation_id <= 0
            ) {
                throw new Error(
                    `PHASE_PERSISTENCE_ACK_MISSING: phase ${cycle.phase}. Call mem_save successfully first and wait for its ACK.`,
                );
            }

            const summary =
                clipCycleText(
                    params.summary,
                    3000,
                );

            if (!summary) {
                throw new Error(
                    "phase_complete.summary cannot be empty.",
                );
            }

            const outcome =
                params.outcome ===
                    "blocked"
                    ? "blocked"
                    : "completed";

            const relevantFiles =
                Array.isArray(
                    params.relevant_files,
                )
                    ? params.relevant_files
                          .filter(
                              (item: unknown) =>
                                  typeof item ===
                                  "string",
                          )
                          .map(
                              (item: string) =>
                                  clipCycleText(
                                      item,
                                      500,
                                  ),
                          )
                          .filter(Boolean)
                          .slice(
                              0,
                              20,
                          )
                    : [];

            const blockers =
                Array.isArray(
                    params.blockers,
                )
                    ? params.blockers
                          .filter(
                              (item: unknown) =>
                                  typeof item ===
                                  "string",
                          )
                          .map(
                              (item: string) =>
                                  clipCycleText(
                                      item,
                                      500,
                                  ),
                          )
                          .filter(Boolean)
                          .slice(
                              0,
                              20,
                          )
                    : [];

            cycle.phase_result = {
                phase:
                    cycle.phase,

                outcome,

                summary,

                relevant_files:
                    relevantFiles,

                blockers,

                memory_id:
                    ack.observation_id,

                completed_at:
                    new Date()
                        .toISOString(),
            };

            writeCycleState(
                cycle,
            );

            return {
                content: [
                    {
                        type:
                            "text",

                        text:
                            `Phase ${cycle.phase} recorded after persistence ACK #${ack.observation_id}.`,
                    },
                ],

                details: {
                    data: {
                        phase:
                            cycle.phase,

                        memory_id:
                            ack.observation_id,

                        outcome,
                    },
                },

                /*
                 * End the worker agent run. The controller, not Glimmer,
                 * decides what happens next.
                 */
                terminate:
                    true,
            };
        },
    });


    // ------------------------------------------------------------------------
    // PHASE_WATCHDOG_V1 telemetry
    // ------------------------------------------------------------------------

    pi.on(
        "tool_execution_start",
        async (
            event: any,
        ) => {
            const cycle =
                readCycleState();

            if (
                !cycle ||
                cycle.status !==
                    "running"
            ) {
                return;
            }

            const watchdog =
                ensureWatchdogState(
                    cycle,
                );

            const signature =
                watchdogSignature(
                    String(
                        event.toolName ??
                        "",
                    ),
                    event.args,
                );

            watchdog.tool_calls +=
                1;

            const watchdogToolName =
                String(
                    event.toolName ??
                    "",
                );

            const readCoverage =
                watchdogToolName ===
                    "read"
                    ? watchdogReadCoverage(
                          watchdog,
                          event.args,
                      )
                    : null;

            watchdog.events.push({
                call_id:
                    String(
                        event.toolCallId ??
                        "",
                    ),

                at:
                    new Date()
                        .toISOString(),

                tool:
                    watchdogToolName,

                signature,

                args_hint:
                    watchdogJson(
                        event.args,
                        700,
                    ),

                ...(readCoverage ??
                    {}),
            });

            if (readCoverage) {
                phaseLog(
                    "READ_COVERAGE",
                    {
                        phase:
                            cycle.phase,

                        path:
                            readCoverage
                                .read_path,

                        offset:
                            readCoverage
                                .read_offset,

                        limit:
                            readCoverage
                                .read_limit,

                        new_lines:
                            readCoverage
                                .read_new_lines,

                        repeated_lines:
                            readCoverage
                                .read_repeated_lines,

                        overlap_ratio:
                            readCoverage
                                .read_overlap_ratio,

                        redundant_count:
                            readCoverage
                                .read_redundant_count,
                    },
                );
            }

            /*
             * We only need a short rolling trace for live supervision.
             */
            if (
                watchdog.events.length >
                32
            ) {
                watchdog.events =
                    watchdog.events.slice(
                        -32,
                    );
            }

            writeCycleState(
                cycle,
            );
        },
    );


    pi.on(
        "tool_execution_end",
        async (
            event: any,
        ) => {
            const cycle =
                readCycleState();

            if (
                !cycle ||
                cycle.status !==
                    "running"
            ) {
                return;
            }

            const watchdog =
                ensureWatchdogState(
                    cycle,
                );

            const callId =
                String(
                    event.toolCallId ??
                    "",
                );

            for (
                let i =
                    watchdog.events.length - 1;
                i >= 0;
                i--
            ) {
                if (
                    watchdog.events[i]
                        .call_id ===
                    callId
                ) {
                    watchdog.events[i]
                        .is_error =
                        Boolean(
                            event.isError,
                        );

                    // SUCCESS_RESULT_EVIDENCE_V1
                    //
                    // Preserve a bounded result for successful tools too.
                    // Recovery snapshots otherwise know that a tool succeeded
                    // but lose the evidence that it actually produced.
                    watchdog.events[i]
                        .result_hint =
                        watchdogJson(
                            event.result,
                            event.isError
                                ? 900
                                : 1600,
                        );

                    break;
                }
            }

            writeCycleState(
                cycle,
            );
        },
    );


    pi.on(
        "turn_end",
        async () => {
            const cycle =
                readCycleState();

            if (
                !cycle ||
                cycle.status !==
                    "running"
            ) {
                return;
            }

            const watchdog =
                ensureWatchdogState(
                    cycle,
                );

            watchdog.turns +=
                1;

            writeCycleState(
                cycle,
            );
        },
    );

    /*
     * Explicit Engram persistence barrier.
     *
     * A phase is allowed to close only after a successful mem_save
     * tool_execution_end containing a real observation ID.
     */
    pi.on(
        "tool_execution_end",
        async (
            event: any,
        ) => {
            if (
                event?.toolName !==
                    "mem_save" ||
                event?.isError
            ) {
                return;
            }

            const cycle =
                readCycleState();

            if (
                !cycle ||
                cycle.status !==
                    "running"
            ) {
                return;
            }

            const observationId =
                extractEngramSaveId(
                    event.result,
                );

            if (
                observationId ===
                null
            ) {
                /*
                 * Successful-looking save without an ID is deliberately
                 * NOT accepted as a transactional ACK.
                 */
                return;
            }

            cycle.last_memory_ack = {
                phase:
                    cycle.phase,

                observation_id:
                    observationId,

                at:
                    new Date()
                        .toISOString(),
            };

            if (
                !cycle.memory_ids.includes(
                    observationId,
                )
            ) {
                cycle.memory_ids.push(
                    observationId,
                );
            }

            // ENGRAM_ACK_BARRIER_V1
            //
            // Once a real transactional ACK exists for this phase, persistence
            // is complete. Remove mem_save from the active tool set so the
            // worker cannot save the same phase repeatedly. If no real ID was
            // obtained, this block is never reached and retry remains allowed.
            try {
                const activeTools =
                    pi.getActiveTools();

                if (
                    Array.isArray(
                        activeTools,
                    ) &&
                    activeTools.includes(
                        "mem_save",
                    )
                ) {
                    pi.setActiveTools(
                        activeTools.filter(
                            (toolName:
                                string) =>
                                toolName !==
                                "mem_save",
                        ),
                    );

                    phaseLog(
                        "ENGRAM_ACK_BARRIER_ARMED",
                        {
                            phase:
                                cycle.phase,

                            observation_id:
                                observationId,

                            action:
                                "mem_save_removed",
                        },
                    );
                }
            } catch (error) {
                phaseLog(
                    "ENGRAM_ACK_BARRIER_ERROR",
                    {
                        phase:
                            cycle.phase,

                        observation_id:
                            observationId,

                        error:
                            clipCycleText(
                                error instanceof Error
                                    ? error.message
                                    : String(
                                          error,
                                      ),
                                700,
                            ),
                    },
                );
            }

            writeCycleState(
                cycle,
            );
        },
    );


    pi.registerCommand(
        "auto",
        {
            description:
                "Run a complete objective as autonomous fresh Pi phases with Qwen routing and Engram persistence",

            handler:
                async (
                    args,
                    ctx,
                ) => {
                    const originalObjective =
                        args.trim();

                    if (!originalObjective) {
                        ctx.ui.notify(
                            "Uso: /auto <objetivo completo>",
                            "info",
                        );

                        return;
                    }

                    await ctx.waitForIdle();

                    const existing =
                        readCycleState();

                    const resumeCheckpoint =
                        buildPersistentResumeCheckpoint(
                            existing,
                            originalObjective,
                        );

                    if (
                        existing?.status ===
                            "running" &&
                        !resumeCheckpoint
                    ) {
                        ctx.ui.notify(
                            `Ya existe un ciclo AUTO en ejecución: ${existing.task_id}`,
                            "error",
                        );

                        return;
                    }

                    let cycle:
                        CycleState;

                    try {
                        const first =
                            resumeCheckpoint
                                ? {
                                      phaseObjective:
                                          resumeCheckpoint
                                              .next_unresolved_action,

                                      reason:
                                          `Resuming interrupted task ${resumeCheckpoint.source_task_id} from phase ${resumeCheckpoint.source_phase}`,
                                  }
                                : await chooseFirstPhaseObjective(
                                      originalObjective,
                                  );

                        const firstRoute =
                            await routeWithQwen(
                                first.phaseObjective,
                            );

                        const now =
                            new Date()
                                .toISOString();

                        cycle = {
                            schema_version:
                                "1.0",

                            task_id:
                                `auto-${Date.now().toString(36)}`,

                            status:
                                "running",

                            original_objective:
                                originalObjective,

                            phase:
                                1,

                            phase_objective:
                                first.phaseObjective,

                            current_route:
                                firstRoute,

                            memory_ids:
                                [],

                            last_memory_ack:
                                null,

                            phase_result:
                                null,

                            history:
                                [],

                            created_at:
                                now,

                            updated_at:
                                now,
                        };

                        /*
                         * These files are the handoff contract between
                         * extension instances across newSession().
                         */
                        writeState(
                            firstRoute,
                        );

                        writeCycleState(
                            cycle,
                        );

                        ctx.ui.notify(
                            `AUTO START | task=${cycle.task_id} | phase=1 | ${firstRoute.profile} | ${firstRoute.tools.join(", ")}`,
                            "info",
                        );
                    } catch (error) {
                        ctx.ui.notify(
                            error instanceof Error
                                ? error.message
                                : String(error),
                            "error",
                        );

                        return;
                    }

                    /*
                     * From this point the command intentionally enters
                     * session replacement. Do not use ctx afterwards.
                     */
                    await runCyclePhase(
                        ctx,
                        cycle,
                    );

                    return;
                },
        },
    );


    pi.registerCommand(
        "auto-status",
        {
            description:
                "Show autonomous phase-cycle state",

            handler:
                async (
                    _args,
                    ctx,
                ) => {
                    const cycle =
                        readCycleState();

                    if (!cycle) {
                        ctx.ui.notify(
                            "AUTO: no cycle state.",
                            "info",
                        );

                        return;
                    }

                    ctx.ui.notify(
                        `AUTO ${cycle.status.toUpperCase()} | task=${cycle.task_id} | phase=${cycle.phase} | objective=${clipCycleText(cycle.phase_objective, 240)} | memories=${cycle.memory_ids.join(", ") || "none"}${cycle.final_summary ? ` | final=${clipCycleText(cycle.final_summary, 350)}` : ""}${cycle.error ? ` | error=${clipCycleText(cycle.error, 350)}` : ""}`,
                        cycle.status ===
                            "error" ||
                        cycle.status ===
                            "blocked"
                            ? "error"
                            : "info",
                    );
                },
        },
    );


    pi.registerCommand(
        "auto-stop",
        {
            description:
                "Stop an autonomous cycle at the next safe boundary",

            handler:
                async (
                    _args,
                    ctx,
                ) => {
                    const cycle =
                        readCycleState();

                    if (
                        !cycle ||
                        cycle.status !==
                            "running"
                    ) {
                        ctx.ui.notify(
                            "AUTO: no running cycle.",
                            "info",
                        );

                        return;
                    }

                    cycle.status =
                        "stopped";

                    writeCycleState(
                        cycle,
                    );

                    ctx.ui.notify(
                        `AUTO STOP requested | task=${cycle.task_id}`,
                        "info",
                    );
                },
        },
    );

    const initialState =
        readState();

    let lensLoadError:
        string | undefined;

    if (
        initialState.profile ===
        "inspect"
    ) {
        try {
            await loadLens(pi);
        } catch (error) {
            lensLoadError =
                error instanceof Error
                    ? error.message
                    : String(error);
        }
    }


    pi.registerCommand(
        "phase",
        {
            description:
                "Ask Qwen3.5 to select the minimum next-phase resources using the live tool catalog",

            handler:
                async (
                    args,
                    ctx,
                ) => {
                    const objective =
                        args.trim();

                    if (!objective) {
                        ctx.ui.notify(
                            "Uso: /phase <objetivo de la siguiente fase>",
                            "info",
                        );
                        return;
                    }

                    try {
                        const previous =
                            readState();

                        const next =
                            await routeWithQwen(
                                objective,
                            );

                        writeState(next);

                        ctx.ui.notify(
                            `Qwen → ${next.profile} | ${next.tools.join(", ")} | ${next.reason}`,
                            "info",
                        );

                        const lensChanged =
                            (previous.profile ===
                                "inspect") !==
                            (next.profile ===
                                "inspect");

                        if (lensChanged) {
                            await ctx.reload();
                            return;
                        }

                        const active =
                            applyTools(
                                pi,
                                next,
                            );

                        ctx.ui.notify(
                            `Tools activas: ${active.join(", ")}`,
                            "info",
                        );
                    } catch (error) {
                        ctx.ui.notify(
                            error instanceof Error
                                ? error.message
                                : String(error),
                            "error",
                        );
                    }
                },
        },
    );


    pi.registerCommand(
        "phase-status",
        {
            description:
                "Show current phase-router state",

            handler:
                async (
                    _args,
                    ctx,
                ) => {
                    const state =
                        readState();

                    ctx.ui.notify(
                        `profile=${state.profile} | tools=${state.tools.join(", ")} | reason=${state.reason ?? ""}`,
                        "info",
                    );
                },
        },
    );


    pi.registerCommand(
        "catalog-refresh",
        {
            description:
                "Regenerate phase-tool-catalog.json from live Pi tools",

            handler:
                async (
                    _args,
                    ctx,
                ) => {
                    const catalog =
                        writeCatalog(
                            pi,
                            ctx.cwd,
                        );

                    ctx.ui.notify(
                        `Catalog refreshed: ${catalog.runtime.tool_count} tools | curated=${catalog.runtime.human_curated_count} | auto=${catalog.runtime.auto_enriched_count}`,
                        "info",
                    );
                },
        },
    );
    pi.registerCommand(
        "catalog-discover-all",
        {
            description:
                "Discover approved dynamic extension tools and merge them into the canonical routing catalog",

            handler:
                async (
                    _args,
                    ctx,
                ) => {
                    try {
                        const state =
                            readState();

                        const lensAlreadyLoaded =
                            pi.getAllTools().some(
                                (tool) =>
                                    inferProvider(
                                        tool.name,
                                        tool.sourceInfo,
                                    ) ===
                                    "pi-lens",
                            );

                        let loadedLensTemporarily =
                            false;

                        if (
                            !lensAlreadyLoaded
                        ) {
                            await loadLens(pi);

                            loadedLensTemporarily =
                                true;
                        }

                        const catalog =
                            writeCatalog(
                                pi,
                                ctx.cwd,
                            );

                        ctx.ui.notify(
                            `Canonical catalog: ${catalog.runtime.tool_count} tools | registered=${catalog.runtime.currently_registered_count} | curated=${catalog.runtime.human_curated_count} | auto=${catalog.runtime.auto_enriched_count}`,
                            "info",
                        );

                        /*
                         * If Lens was loaded only for discovery, rebuild
                         * the runtime immediately. readState() preserves
                         * the real current phase, so Lens disappears again
                         * unless that phase actually requires it.
                         */
                        if (
                            loadedLensTemporarily &&
                            state.profile !==
                                "inspect"
                        ) {
                            await ctx.reload();
                            return;
                        }
                    } catch (error) {
                        ctx.ui.notify(
                            error instanceof Error
                                ? error.message
                                : String(error),
                            "error",
                        );
                    }
                },
        },
    );



    pi.registerCommand(
        "catalog-status",
        {
            description:
                "Show phase tool catalog statistics",

            handler:
                async (
                    _args,
                    ctx,
                ) => {
                    try {
                        const catalog =
                            readCatalog();

                        ctx.ui.notify(
                            `catalog=${CATALOG_PATH} | tools=${catalog.runtime.tool_count} | curated=${catalog.runtime.human_curated_count} | auto=${catalog.runtime.auto_enriched_count}`,
                            "info",
                        );
                    } catch (error) {
                        ctx.ui.notify(
                            error instanceof Error
                                ? error.message
                                : String(error),
                            "error",
                        );
                    }
                },
        },
    );


    pi.on(
        "session_start",
        async (
            _event,
            ctx,
        ) => {
            if (lensLoadError) {
                ctx.ui.notify(
                    `Lens load failed: ${lensLoadError}`,
                    "error",
                );
            }

            const catalog =
                writeCatalog(
                    pi,
                    ctx.cwd,
                );

            const state =
                readState();

            const active =
                applyTools(
                    pi,
                    state,
                );

            ctx.ui.notify(
                `Router ${state.profile} | ${active.join(", ")} | catalog=${catalog.runtime.tool_count}`,
                "info",
            );
        },
    );
}
































