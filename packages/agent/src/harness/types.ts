import type { ImageContent, Model, TextContent } from "@mariozechner/pi-ai";
import type { Agent, AgentEvent, AgentMessage, ThinkingLevel } from "../index.js";

export type SourceScope = "user" | "project" | "temporary";
export type SourceOrigin = "package" | "top-level";

export interface SourceInfo {
	path: string;
	source: string;
	scope: SourceScope;
	origin: SourceOrigin;
	baseDir?: string;
}

export interface Skill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	sourceInfo: SourceInfo;
	disableModelInvocation: boolean;
}

export interface PromptTemplate {
	name: string;
	description: string;
	argumentHint?: string;
	content: string;
	sourceInfo: SourceInfo;
	filePath: string;
}

export interface SystemPromptInputs {
	basePrompt?: string;
	appendPrompt?: string;
	contextFiles?: Array<{ path: string; content: string }>;
	skills?: Skill[];
}

export interface ExecutionEnvExecOptions {
	cwd?: string;
	env?: Record<string, string>;
	timeout?: number;
	signal?: AbortSignal;
	onStdout?: (chunk: string) => void;
	onStderr?: (chunk: string) => void;
}

export interface ExecutionEnv {
	cwd: string;

	exec(
		command: string,
		options?: ExecutionEnvExecOptions,
	): Promise<{ stdout: string; stderr: string; exitCode: number }>;

	readTextFile(path: string): Promise<string>;
	readBinaryFile(path: string): Promise<Uint8Array>;
	writeFile(path: string, content: string | Uint8Array): Promise<void>;
	stat(path: string): Promise<{
		isFile: boolean;
		isDirectory: boolean;
		isSymbolicLink: boolean;
		size: number;
		mtime: Date;
	}>;
	listDir(path: string): Promise<string[]>;
	pathExists(path: string): Promise<boolean>;
	createDir(path: string, options?: { recursive?: boolean }): Promise<void>;
	remove(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
	createTempDir(prefix?: string): Promise<string>;
	createTempFile(options?: { prefix?: string; suffix?: string }): Promise<string>;

	resolvePath(path: string): string;
	cleanup(): Promise<void>;
}

export interface SessionTreeEntryBase {
	type: string;
	id: string;
	parentId: string | null;
	timestamp: string;
}

export interface MessageEntry extends SessionTreeEntryBase {
	type: "message";
	message: AgentMessage;
}

export interface ThinkingLevelChangeEntry extends SessionTreeEntryBase {
	type: "thinking_level_change";
	thinkingLevel: string;
}

export interface ModelChangeEntry extends SessionTreeEntryBase {
	type: "model_change";
	provider: string;
	modelId: string;
}

export interface CompactionEntry<T = unknown> extends SessionTreeEntryBase {
	type: "compaction";
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	details?: T;
	fromHook?: boolean;
}

export interface BranchSummaryEntry<T = unknown> extends SessionTreeEntryBase {
	type: "branch_summary";
	fromId: string;
	summary: string;
	details?: T;
	fromHook?: boolean;
}

export interface CustomEntry<T = unknown> extends SessionTreeEntryBase {
	type: "custom";
	customType: string;
	data?: T;
}

export interface CustomMessageEntry<T = unknown> extends SessionTreeEntryBase {
	type: "custom_message";
	customType: string;
	content: string | (TextContent | ImageContent)[];
	details?: T;
	display: boolean;
}

export interface LabelEntry extends SessionTreeEntryBase {
	type: "label";
	targetId: string;
	label: string | undefined;
}

export interface SessionInfoEntry extends SessionTreeEntryBase {
	type: "session_info";
	name?: string;
}

export type SessionTreeEntry =
	| MessageEntry
	| ThinkingLevelChangeEntry
	| ModelChangeEntry
	| CompactionEntry
	| BranchSummaryEntry
	| CustomEntry
	| CustomMessageEntry
	| LabelEntry
	| SessionInfoEntry;

export interface SessionContext {
	messages: AgentMessage[];
	thinkingLevel: string;
	model: { provider: string; modelId: string } | null;
}

export interface SessionInfo {
	id: string;
	createdAt: string;
	parentSession?: string;
}

export interface CodingAgentSessionInfo extends SessionInfo {
	projectCwd: string;
	filePath?: string;
}

export interface SessionTreeStorage {
	getSessionInfo(): Promise<SessionInfo>;
	getLeafId(): Promise<string | null>;
	setLeafId(leafId: string | null): Promise<void>;
	appendEntry(entry: SessionTreeEntry): Promise<void>;
	getEntry(id: string): Promise<SessionTreeEntry | undefined>;
	getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]>;
	getEntries(): Promise<SessionTreeEntry[]>;
}

export interface SessionTree {
	getSessionInfo(): Promise<SessionInfo>;
	getLeafId(): Promise<string | null>;
	getEntry(id: string): Promise<SessionTreeEntry | undefined>;
	getEntries(): Promise<SessionTreeEntry[]>;
	getBranch(fromId?: string): Promise<SessionTreeEntry[]>;
	buildContext(): Promise<SessionContext>;
	getLabel(id: string): Promise<string | undefined>;
	getSessionName(): Promise<string | undefined>;

	appendMessage(message: AgentMessage): Promise<string>;
	appendThinkingLevelChange(thinkingLevel: string): Promise<string>;
	appendModelChange(provider: string, modelId: string): Promise<string>;
	appendCompaction<T = unknown>(
		summary: string,
		firstKeptEntryId: string,
		tokensBefore: number,
		details?: T,
		fromHook?: boolean,
	): Promise<string>;
	appendBranchSummary<T = unknown>(fromId: string, summary: string, details?: T, fromHook?: boolean): Promise<string>;
	appendCustomEntry(customType: string, data?: unknown): Promise<string>;
	appendCustomMessageEntry<T = unknown>(
		customType: string,
		content: string | (TextContent | ImageContent)[],
		display: boolean,
		details?: T,
	): Promise<string>;
	appendLabelChange(targetId: string, label: string | undefined): Promise<string>;
	appendSessionInfo(name: string): Promise<string>;

	moveTo(entryId: string | null): Promise<void>;
}

export interface Session<TInfo extends SessionInfo = SessionInfo> {
	info: TInfo;
	tree: SessionTree;
}

export interface SessionRepo<TRef = string, TInfo extends SessionInfo = SessionInfo> {
	create(options?: { id?: string; parentSession?: string }): Promise<Session<TInfo>>;
	open(ref: TRef): Promise<Session<TInfo>>;
	list(): Promise<Array<Session<TInfo>>>;
	delete(ref: TRef): Promise<void>;
	fork(ref: TRef, options: { entryId: string; position?: "before" | "at"; id?: string }): Promise<Session<TInfo>>;
}

export interface CodingAgentSessionRepo<TRef = string> extends SessionRepo<TRef, CodingAgentSessionInfo> {
	listByCwd(cwd: string): Promise<Array<Session<CodingAgentSessionInfo>>>;
	getMostRecentByCwd(cwd: string): Promise<Session<CodingAgentSessionInfo> | undefined>;
}

export interface AgentHarnessPendingMutations {
	appendMessages: AgentMessage[];
	model?: Model<any>;
	thinkingLevel?: ThinkingLevel;
	activeToolNames?: string[];
	systemPromptInputs?: SystemPromptInputs;
}

export interface AgentHarnessConversationState {
	sessionTree: SessionTree;
	model: Model<any> | undefined;
	thinkingLevel: ThinkingLevel;
	activeToolNames: string[];
	systemPromptInputs: SystemPromptInputs;
	nextTurnQueue: AgentMessage[];
}

export interface AgentHarnessOperationState {
	idle: boolean;
	liveOperationId?: string;
	abortRequested: boolean;
	steerQueue: AgentMessage[];
	followUpQueue: AgentMessage[];
	pendingMutations: AgentHarnessPendingMutations;
}

export interface SavePointSnapshot {
	messages: AgentMessage[];
	model: Model<any> | undefined;
	thinkingLevel: ThinkingLevel;
	activeToolNames: string[];
	systemPrompt: string;
}

export interface AgentHarnessContext {
	env: ExecutionEnv;
	conversation: Readonly<AgentHarnessConversationState>;
	operation: Readonly<AgentHarnessOperationState>;
	abortSignal?: AbortSignal;
}

export interface QueueUpdateEvent {
	type: "queue_update";
	steer: AgentMessage[];
	followUp: AgentMessage[];
	nextTurn: AgentMessage[];
}

export interface SavePointEvent {
	type: "save_point";
	liveOperationId: string;
	hadPendingMutations: boolean;
}

export interface AbortEvent {
	type: "abort";
	clearedSteer: AgentMessage[];
	clearedFollowUp: AgentMessage[];
}

export interface SettledEvent {
	type: "settled";
	nextTurnCount: number;
}

export interface BeforeAgentStartEvent {
	type: "before_agent_start";
	prompt: string;
	images?: ImageContent[];
	systemPrompt: string;
	systemPromptInputs: SystemPromptInputs;
}

export interface ContextEvent {
	type: "context";
	messages: AgentMessage[];
}

export interface BeforeProviderRequestEvent {
	type: "before_provider_request";
	payload: unknown;
}

export interface AfterProviderResponseEvent {
	type: "after_provider_response";
	status: number;
	headers: Record<string, string>;
}

export interface ToolCallEvent {
	type: "tool_call";
	toolCallId: string;
	toolName: string;
	input: Record<string, unknown>;
}

export interface ToolResultEvent {
	type: "tool_result";
	toolCallId: string;
	toolName: string;
	input: Record<string, unknown>;
	content: Array<TextContent | ImageContent>;
	details: unknown;
	isError: boolean;
}

export interface SessionBeforeCompactEvent {
	type: "session_before_compact";
	preparation: CompactionPreparation;
	branchEntries: SessionTreeEntry[];
	customInstructions?: string;
	signal: AbortSignal;
}

export interface SessionCompactEvent {
	type: "session_compact";
	compactionEntry: CompactionEntry;
	fromHook: boolean;
}

export interface SessionBeforeTreeEvent {
	type: "session_before_tree";
	preparation: TreePreparation;
	signal: AbortSignal;
}

export interface SessionTreeEvent {
	type: "session_tree";
	newLeafId: string | null;
	oldLeafId: string | null;
	summaryEntry?: BranchSummaryEntry;
	fromHook?: boolean;
}

export interface ModelSelectEvent {
	type: "model_select";
	model: Model<any>;
	previousModel: Model<any> | undefined;
	source: "set" | "restore";
}

export interface ThinkingLevelSelectEvent {
	type: "thinking_level_select";
	level: ThinkingLevel;
	previousLevel: ThinkingLevel;
}

export type AgentHarnessOwnEvent =
	| QueueUpdateEvent
	| SavePointEvent
	| AbortEvent
	| SettledEvent
	| BeforeAgentStartEvent
	| ContextEvent
	| BeforeProviderRequestEvent
	| AfterProviderResponseEvent
	| ToolCallEvent
	| ToolResultEvent
	| SessionBeforeCompactEvent
	| SessionCompactEvent
	| SessionBeforeTreeEvent
	| SessionTreeEvent
	| ModelSelectEvent
	| ThinkingLevelSelectEvent;

export type AgentHarnessEvent = AgentEvent | AgentHarnessOwnEvent;

export interface BeforeAgentStartResult {
	messages?: AgentMessage[];
	systemPrompt?: string;
}

export interface ContextResult {
	messages: AgentMessage[];
}

export interface BeforeProviderRequestResult {
	payload: unknown;
}

export interface ToolCallResult {
	block?: boolean;
	reason?: string;
}

export interface ToolResultPatch {
	content?: Array<TextContent | ImageContent>;
	details?: unknown;
	isError?: boolean;
	terminate?: boolean;
}

export interface SessionBeforeCompactResult {
	cancel?: boolean;
	compaction?: CompactResult;
}

export interface SessionBeforeTreeResult {
	cancel?: boolean;
	summary?: { summary: string; details?: unknown };
	customInstructions?: string;
	replaceInstructions?: boolean;
	label?: string;
}

export type AgentHarnessEventResultMap = {
	before_agent_start: BeforeAgentStartResult | undefined;
	context: ContextResult | undefined;
	before_provider_request: BeforeProviderRequestResult | undefined;
	after_provider_response: undefined;
	tool_call: ToolCallResult | undefined;
	tool_result: ToolResultPatch | undefined;
	session_before_compact: SessionBeforeCompactResult | undefined;
	session_compact: undefined;
	session_before_tree: SessionBeforeTreeResult | undefined;
	session_tree: undefined;
	model_select: undefined;
	thinking_level_select: undefined;
	queue_update: undefined;
	save_point: undefined;
	abort: undefined;
	settled: undefined;
};

export interface AgentHarnessPromptOptions {
	images?: ImageContent[];
}

export interface AbortResult {
	clearedSteer: AgentMessage[];
	clearedFollowUp: AgentMessage[];
}

export interface CompactResult {
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	details?: unknown;
}

export interface NavigateTreeResult {
	cancelled: boolean;
	editorText?: string;
	summaryEntry?: BranchSummaryEntry;
}

export interface CompactionSettings {
	enabled: boolean;
	reserveTokens: number;
	keepRecentTokens: number;
}

export interface CompactionPreparation {
	firstKeptEntryId: string;
	messagesToSummarize: AgentMessage[];
	turnPrefixMessages: AgentMessage[];
	isSplitTurn: boolean;
	tokensBefore: number;
	previousSummary?: string;
	fileOps: FileOperations;
	settings: CompactionSettings;
}

export interface FileOperations {
	read: Set<string>;
	written: Set<string>;
	edited: Set<string>;
}

export interface TreePreparation {
	targetId: string;
	oldLeafId: string | null;
	commonAncestorId: string | null;
	entriesToSummarize: SessionTreeEntry[];
	userWantsSummary: boolean;
	customInstructions?: string;
	replaceInstructions?: boolean;
	label?: string;
}

export interface GenerateBranchSummaryOptions {
	model: Model<any>;
	apiKey: string;
	headers?: Record<string, string>;
	signal: AbortSignal;
	customInstructions?: string;
	replaceInstructions?: boolean;
	reserveTokens?: number;
}

export interface BranchSummaryResult {
	summary?: string;
	readFiles?: string[];
	modifiedFiles?: string[];
	aborted?: boolean;
	error?: string;
}

export interface AgentHarnessOptions {
	agent: Agent;
	env: ExecutionEnv;
	sessionTree: SessionTree;
	promptTemplates?: PromptTemplate[];
	skills?: Skill[];
	requestAuth?: (model: Model<any>) => Promise<{ apiKey: string; headers?: Record<string, string> } | undefined>;
	initialModel?: Model<any>;
	initialThinkingLevel?: ThinkingLevel;
	initialActiveToolNames?: string[];
	initialSystemPromptInputs?: SystemPromptInputs;
}

export interface AgentHarness {
	readonly agent: Agent;
	readonly env: ExecutionEnv;
	readonly conversation: Readonly<AgentHarnessConversationState>;
	readonly operation: Readonly<AgentHarnessOperationState>;

	prompt(text: string, options?: AgentHarnessPromptOptions): Promise<void>;
	skill(name: string, args?: string): Promise<void>;

	steer(message: AgentMessage): void;
	followUp(message: AgentMessage): void;
	nextTurn(message: AgentMessage): void;

	appendMessage(message: AgentMessage): Promise<void>;

	shell(
		command: string,
		options?: {
			cwd?: string;
			env?: Record<string, string>;
			timeout?: number;
			signal?: AbortSignal;
			onStdout?: (chunk: string) => void;
			onStderr?: (chunk: string) => void;
		},
	): Promise<{ stdout: string; stderr: string; exitCode: number }>;

	compact(customInstructions?: string): Promise<CompactResult>;
	navigateTree(
		targetId: string,
		options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string },
	): Promise<NavigateTreeResult>;

	setModel(model: Model<any>): Promise<void>;
	setThinkingLevel(level: ThinkingLevel): Promise<void>;
	setActiveTools(toolNames: string[]): Promise<void>;
	setSystemPromptInputs(inputs: SystemPromptInputs): Promise<void>;

	abort(): Promise<AbortResult>;
	waitForIdle(): Promise<void>;

	subscribe(listener: (event: AgentHarnessEvent, signal?: AbortSignal) => Promise<void> | void): () => void;

	on<TType extends keyof AgentHarnessEventResultMap>(
		type: TType,
		handler: (
			event: Extract<AgentHarnessEvent, { type: TType }>,
			ctx: AgentHarnessContext,
		) => Promise<AgentHarnessEventResultMap[TType]> | AgentHarnessEventResultMap[TType],
	): () => void;
}
