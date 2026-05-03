import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ImageContent, Model } from "@mariozechner/pi-ai";
import type { Agent } from "../agent.js";
import type { AgentEvent, AgentMessage, AgentTool, ThinkingLevel } from "../types.js";
import { collectEntriesForBranchSummary, generateBranchSummary } from "./compaction/branch-summarization.js";
import { compact, DEFAULT_COMPACTION_SETTINGS, prepareCompaction } from "./compaction/compaction.js";
import { expandPromptTemplate } from "./prompt-templates.js";
import type {
	AbortResult,
	AgentHarness,
	AgentHarnessContext,
	AgentHarnessConversationState,
	AgentHarnessEvent,
	AgentHarnessEventResultMap,
	AgentHarnessOperationState,
	AgentHarnessOptions,
	AgentHarnessOwnEvent,
	ExecutionEnv,
	NavigateTreeResult,
	PromptTemplate,
	SessionTree,
	Skill,
	SystemPromptInputs,
} from "./types.js";

function buildSystemPrompt(inputs: SystemPromptInputs, cwd: string): string {
	const parts: string[] = [];
	if (inputs.basePrompt) parts.push(inputs.basePrompt);
	if (inputs.appendPrompt) parts.push(inputs.appendPrompt);
	if (inputs.contextFiles && inputs.contextFiles.length > 0) {
		parts.push("# Project Context\n");
		for (const file of inputs.contextFiles) {
			parts.push(`## ${file.path}\n\n${file.content}`);
		}
	}
	if (inputs.skills && inputs.skills.length > 0) {
		parts.push("# Available Skills\n");
		for (const skill of inputs.skills.filter((s) => !s.disableModelInvocation)) {
			parts.push(`- ${skill.name}: ${skill.description}`);
		}
	}
	parts.push(`Current working directory: ${cwd}`);
	return parts.filter(Boolean).join("\n\n");
}

function createUserMessage(text: string, images?: ImageContent[]): AgentMessage {
	const content: Array<{ type: "text"; text: string } | ImageContent> = [{ type: "text", text }];
	if (images) content.push(...images);
	return { role: "user", content, timestamp: Date.now() };
}

export class DefaultAgentHarness implements AgentHarness {
	readonly agent: Agent;
	readonly env: ExecutionEnv;
	readonly conversation: AgentHarnessConversationState;
	readonly operation: AgentHarnessOperationState;

	private sessionTree: SessionTree;
	private promptTemplates: PromptTemplate[];
	private skills: Skill[];
	private requestAuth?: AgentHarnessOptions["requestAuth"];
	private toolRegistry = new Map<string, AgentTool>();
	private listeners = new Set<(event: AgentHarnessEvent, signal?: AbortSignal) => Promise<void> | void>();
	private hooks = new Map<
		keyof AgentHarnessEventResultMap,
		Set<(event: any, ctx: AgentHarnessContext) => Promise<any> | any>
	>();

	constructor(options: AgentHarnessOptions) {
		this.agent = options.agent;
		this.env = options.env;
		this.sessionTree = options.sessionTree;
		this.promptTemplates = options.promptTemplates ?? [];
		this.skills = options.skills ?? [];
		this.requestAuth = options.requestAuth;
		for (const tool of this.agent.state.tools) {
			this.toolRegistry.set(tool.name, tool);
		}
		this.conversation = {
			sessionTree: options.sessionTree,
			model: options.initialModel ?? this.agent.state.model,
			thinkingLevel: options.initialThinkingLevel ?? this.agent.state.thinkingLevel,
			activeToolNames: options.initialActiveToolNames ?? this.agent.state.tools.map((tool) => tool.name),
			systemPromptInputs: options.initialSystemPromptInputs ?? { skills: this.skills },
			nextTurnQueue: [],
		};
		this.operation = {
			idle: true,
			abortRequested: false,
			steerQueue: [],
			followUpQueue: [],
			pendingMutations: {
				appendMessages: [],
			},
		};
		this.agent.transformContext = async (messages, signal) => {
			const result = await this.emitHook("context", { type: "context", messages: [...messages] }, signal);
			return result?.messages ?? messages;
		};
		this.agent.beforeToolCall = async ({ toolCall, args }, signal) => {
			const result = await this.emitHook(
				"tool_call",
				{
					type: "tool_call",
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					input: args as Record<string, unknown>,
				},
				signal,
			);
			return result ? { block: result.block, reason: result.reason } : undefined;
		};
		this.agent.afterToolCall = async ({ toolCall, args, result, isError }, signal) => {
			const patch = await this.emitHook(
				"tool_result",
				{
					type: "tool_result",
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					input: args as Record<string, unknown>,
					content: result.content,
					details: result.details,
					isError,
				},
				signal,
			);
			return patch
				? { content: patch.content, details: patch.details, isError: patch.isError, terminate: patch.terminate }
				: undefined;
		};
		this.agent.onPayload = async (payload) => {
			const result = await this.emitHook("before_provider_request", { type: "before_provider_request", payload });
			return result?.payload ?? payload;
		};
		this.agent.onResponse = async (response) => {
			const headers = { ...(response.headers as Record<string, string>) };
			await this.emitOwn({ type: "after_provider_response", status: response.status, headers }, this.agent.signal);
		};
		this.agent.subscribe(async (event, signal) => {
			await this.handleAgentEvent(event, signal);
		});
		void this.syncFromTree();
	}

	private createContext(signal?: AbortSignal): AgentHarnessContext {
		return {
			env: this.env,
			conversation: this.conversation,
			operation: this.operation,
			abortSignal: signal,
		};
	}

	private async emitOwn(event: AgentHarnessOwnEvent, signal?: AbortSignal): Promise<void> {
		for (const listener of this.listeners) {
			await listener(event, signal);
		}
	}

	private async emitAny(event: AgentHarnessEvent, signal?: AbortSignal): Promise<void> {
		for (const listener of this.listeners) {
			await listener(event, signal);
		}
	}

	private async emitHook<TType extends keyof AgentHarnessEventResultMap>(
		type: TType,
		event: Extract<AgentHarnessOwnEvent, { type: TType }>,
		signal?: AbortSignal,
	): Promise<AgentHarnessEventResultMap[TType] | undefined> {
		const handlers = this.hooks.get(type);
		if (!handlers || handlers.size === 0) return undefined;
		let lastResult: AgentHarnessEventResultMap[TType] | undefined;
		for (const handler of handlers) {
			const result = await handler(event, this.createContext(signal));
			if (result !== undefined) {
				lastResult = result;
			}
		}
		return lastResult;
	}

	private async emitQueueUpdate(): Promise<void> {
		await this.emitOwn({
			type: "queue_update",
			steer: [...this.operation.steerQueue],
			followUp: [...this.operation.followUpQueue],
			nextTurn: [...this.conversation.nextTurnQueue],
		});
	}

	private async syncFromTree(): Promise<void> {
		const context = await this.sessionTree.buildContext();
		this.agent.state.messages = context.messages;
		if (context.model && this.conversation.model) {
			// leave active model untouched; harness-level model is source of truth
		}
		this.agent.state.systemPrompt = buildSystemPrompt(this.conversation.systemPromptInputs, this.env.cwd);
	}

	private async applyPendingMutations(): Promise<void> {
		for (const message of this.operation.pendingMutations.appendMessages) {
			await this.sessionTree.appendMessage(message);
		}
		this.operation.pendingMutations.appendMessages = [];

		if (this.operation.pendingMutations.model) {
			const model = this.operation.pendingMutations.model;
			const previousModel = this.conversation.model;
			this.conversation.model = model;
			this.agent.state.model = model;
			await this.sessionTree.appendModelChange(model.provider, model.id);
			await this.emitOwn({ type: "model_select", model, previousModel, source: "set" });
			this.operation.pendingMutations.model = undefined;
		}

		if (this.operation.pendingMutations.thinkingLevel !== undefined) {
			const level = this.operation.pendingMutations.thinkingLevel;
			const previousLevel = this.conversation.thinkingLevel;
			this.conversation.thinkingLevel = level;
			this.agent.state.thinkingLevel = level;
			await this.sessionTree.appendThinkingLevelChange(level);
			await this.emitOwn({ type: "thinking_level_select", level, previousLevel });
			this.operation.pendingMutations.thinkingLevel = undefined;
		}

		if (this.operation.pendingMutations.activeToolNames) {
			this.conversation.activeToolNames = [...this.operation.pendingMutations.activeToolNames];
			this.agent.state.tools = this.conversation.activeToolNames
				.map((name) => this.toolRegistry.get(name))
				.filter((tool): tool is (typeof this.agent.state.tools)[number] => tool !== undefined);
			this.operation.pendingMutations.activeToolNames = undefined;
		}

		if (this.operation.pendingMutations.systemPromptInputs) {
			this.conversation.systemPromptInputs = this.operation.pendingMutations.systemPromptInputs;
			this.agent.state.systemPrompt = buildSystemPrompt(this.conversation.systemPromptInputs, this.env.cwd);
			this.operation.pendingMutations.systemPromptInputs = undefined;
		}

		await this.syncFromTree();
	}

	private async handleAgentEvent(event: AgentEvent, signal?: AbortSignal): Promise<void> {
		await this.emitAny(event, signal);
		if (event.type === "message_start") {
			const steerIndex = this.operation.steerQueue.indexOf(event.message);
			if (steerIndex !== -1) {
				this.operation.steerQueue.splice(steerIndex, 1);
				await this.emitQueueUpdate();
			} else {
				const followUpIndex = this.operation.followUpQueue.indexOf(event.message);
				if (followUpIndex !== -1) {
					this.operation.followUpQueue.splice(followUpIndex, 1);
					await this.emitQueueUpdate();
				}
			}
		}
		if (event.type === "message_end") {
			await this.sessionTree.appendMessage(event.message);
		}
		if (event.type === "turn_end") {
			const hadPendingMutations =
				this.operation.pendingMutations.appendMessages.length > 0 ||
				this.operation.pendingMutations.model !== undefined ||
				this.operation.pendingMutations.thinkingLevel !== undefined ||
				this.operation.pendingMutations.activeToolNames !== undefined ||
				this.operation.pendingMutations.systemPromptInputs !== undefined;
			await this.emitOwn(
				{ type: "save_point", liveOperationId: this.operation.liveOperationId ?? "unknown", hadPendingMutations },
				signal,
			);
			if (hadPendingMutations) {
				await this.applyPendingMutations();
			}
		}
		if (event.type === "agent_end") {
			this.operation.idle = true;
			this.operation.liveOperationId = undefined;
			this.operation.abortRequested = false;
			await this.syncFromTree();
			await this.emitOwn({ type: "settled", nextTurnCount: this.conversation.nextTurnQueue.length }, signal);
		}
	}

	async prompt(text: string, options?: { images?: ImageContent[] }): Promise<void> {
		if (!this.operation.idle) throw new Error("AgentHarness is busy");
		this.operation.idle = false;
		this.operation.liveOperationId = randomUUID();
		const expanded = this.expandSkillCommand(expandPromptTemplate(text, this.promptTemplates));
		let messages: AgentMessage[] = [createUserMessage(expanded, options?.images)];
		if (this.conversation.nextTurnQueue.length > 0) {
			messages = [messages[0]!, ...this.conversation.nextTurnQueue];
			this.conversation.nextTurnQueue = [];
			await this.emitQueueUpdate();
		}
		this.agent.state.systemPrompt = buildSystemPrompt(this.conversation.systemPromptInputs, this.env.cwd);
		const beforeResult = await this.emitHook(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: expanded,
				images: options?.images,
				systemPrompt: this.agent.state.systemPrompt,
				systemPromptInputs: this.conversation.systemPromptInputs,
			},
			this.agent.signal,
		);
		if (beforeResult?.messages) messages = [...beforeResult.messages, ...messages];
		if (beforeResult?.systemPrompt) this.agent.state.systemPrompt = beforeResult.systemPrompt;
		await this.agent.prompt(messages);
	}

	async skill(name: string, args?: string): Promise<void> {
		const skill = this.skills.find((candidate) => candidate.name === name);
		if (!skill) throw new Error(`Unknown skill: ${name}`);
		let content = readFileSync(skill.filePath, "utf8");
		content = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
		const prompt = args ? `${content}\n\n${args}` : content;
		await this.prompt(prompt);
	}

	steer(message: AgentMessage): void {
		if (this.operation.idle) throw new Error("Cannot steer while idle");
		this.operation.steerQueue.push(message);
		this.agent.steer(message);
		void this.emitQueueUpdate();
	}

	followUp(message: AgentMessage): void {
		if (this.operation.idle) throw new Error("Cannot follow up while idle");
		this.operation.followUpQueue.push(message);
		this.agent.followUp(message);
		void this.emitQueueUpdate();
	}

	nextTurn(message: AgentMessage): void {
		this.conversation.nextTurnQueue.push(message);
		void this.emitQueueUpdate();
	}

	async appendMessage(message: AgentMessage): Promise<void> {
		if (this.operation.idle) {
			await this.sessionTree.appendMessage(message);
			await this.syncFromTree();
		} else {
			this.operation.pendingMutations.appendMessages.push(message);
		}
	}

	async shell(
		command: string,
		options?: {
			cwd?: string;
			env?: Record<string, string>;
			timeout?: number;
			signal?: AbortSignal;
			onStdout?: (chunk: string) => void;
			onStderr?: (chunk: string) => void;
		},
	): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		return await this.env.exec(command, options);
	}

	async compact(
		customInstructions?: string,
	): Promise<{ summary: string; firstKeptEntryId: string; tokensBefore: number; details?: unknown }> {
		if (!this.operation.idle) throw new Error("compact() requires idle harness");
		const model = this.conversation.model;
		if (!model) throw new Error("No model set for compaction");
		const auth = await this.requestAuth?.(model);
		if (!auth) throw new Error("No auth available for compaction");
		const branchEntries = await this.sessionTree.getBranch();
		const preparation = prepareCompaction(branchEntries, DEFAULT_COMPACTION_SETTINGS);
		if (!preparation) throw new Error("Nothing to compact");
		const hookResult = await this.emitHook("session_before_compact", {
			type: "session_before_compact",
			preparation,
			branchEntries,
			customInstructions,
			signal: new AbortController().signal,
		});
		if (hookResult?.cancel) throw new Error("Compaction cancelled");
		const provided = hookResult?.compaction;
		const result =
			provided ??
			(await compact(
				preparation,
				model,
				auth.apiKey,
				auth.headers,
				customInstructions,
				undefined,
				this.conversation.thinkingLevel,
			));
		const entryId = await this.sessionTree.appendCompaction(
			result.summary,
			result.firstKeptEntryId,
			result.tokensBefore,
			result.details,
			provided !== undefined,
		);
		const entry = await this.sessionTree.getEntry(entryId);
		await this.syncFromTree();
		if (entry?.type === "compaction") {
			await this.emitOwn({ type: "session_compact", compactionEntry: entry, fromHook: provided !== undefined });
		}
		return result;
	}

	async navigateTree(
		targetId: string,
		options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string },
	): Promise<NavigateTreeResult> {
		if (!this.operation.idle) throw new Error("navigateTree() requires idle harness");
		const oldLeafId = await this.sessionTree.getLeafId();
		if (oldLeafId === targetId) return { cancelled: false };
		const targetEntry = await this.sessionTree.getEntry(targetId);
		if (!targetEntry) throw new Error(`Entry ${targetId} not found`);
		const { entries, commonAncestorId } = await collectEntriesForBranchSummary(this.sessionTree, oldLeafId, targetId);
		const preparation = {
			targetId,
			oldLeafId,
			commonAncestorId,
			entriesToSummarize: entries,
			userWantsSummary: options?.summarize ?? false,
			customInstructions: options?.customInstructions,
			replaceInstructions: options?.replaceInstructions,
			label: options?.label,
		};
		const signal = new AbortController().signal;
		const hookResult = await this.emitHook("session_before_tree", {
			type: "session_before_tree",
			preparation,
			signal,
		});
		if (hookResult?.cancel) return { cancelled: true };
		let summaryEntry: any | undefined;
		let summaryText: string | undefined = hookResult?.summary?.summary;
		let summaryDetails: unknown = hookResult?.summary?.details;
		if (!summaryText && options?.summarize && entries.length > 0) {
			const model = this.conversation.model;
			if (!model) throw new Error("No model set for branch summary");
			const auth = await this.requestAuth?.(model);
			if (!auth) throw new Error("No auth available for branch summary");
			const branchSummary = await generateBranchSummary(entries, {
				model,
				apiKey: auth.apiKey,
				headers: auth.headers,
				signal: new AbortController().signal,
				customInstructions: hookResult?.customInstructions ?? options?.customInstructions,
				replaceInstructions: hookResult?.replaceInstructions ?? options?.replaceInstructions,
			});
			if (branchSummary.aborted) return { cancelled: true };
			if (branchSummary.error) throw new Error(branchSummary.error);
			summaryText = branchSummary.summary;
			summaryDetails = {
				readFiles: branchSummary.readFiles ?? [],
				modifiedFiles: branchSummary.modifiedFiles ?? [],
			};
		}
		let editorText: string | undefined;
		let newLeafId: string | null;
		if (targetEntry.type === "message" && targetEntry.message.role === "user") {
			newLeafId = targetEntry.parentId;
			const content = targetEntry.message.content;
			editorText =
				typeof content === "string"
					? content
					: content
							.filter((c): c is { type: "text"; text: string } => c.type === "text")
							.map((c) => c.text)
							.join("");
		} else if (targetEntry.type === "custom_message") {
			newLeafId = targetEntry.parentId;
			editorText =
				typeof targetEntry.content === "string"
					? targetEntry.content
					: targetEntry.content
							.filter((c): c is { type: "text"; text: string } => c.type === "text")
							.map((c) => c.text)
							.join("");
		} else {
			newLeafId = targetId;
		}
		await this.sessionTree.moveTo(newLeafId);
		if (summaryText) {
			const summaryId = await this.sessionTree.appendBranchSummary(
				newLeafId ?? "root",
				summaryText,
				summaryDetails,
				hookResult?.summary !== undefined,
			);
			summaryEntry = await this.sessionTree.getEntry(summaryId);
		}
		await this.syncFromTree();
		await this.emitOwn({
			type: "session_tree",
			newLeafId: await this.sessionTree.getLeafId(),
			oldLeafId,
			summaryEntry,
			fromHook: hookResult?.summary !== undefined,
		});
		return { cancelled: false, editorText, summaryEntry };
	}

	async setModel(model: Model<any>): Promise<void> {
		if (this.operation.idle) {
			const previousModel = this.conversation.model;
			this.conversation.model = model;
			this.agent.state.model = model;
			await this.sessionTree.appendModelChange(model.provider, model.id);
			await this.emitOwn({ type: "model_select", model, previousModel, source: "set" });
		} else {
			this.operation.pendingMutations.model = model;
		}
	}

	async setThinkingLevel(level: ThinkingLevel): Promise<void> {
		if (this.operation.idle) {
			const previousLevel = this.conversation.thinkingLevel;
			this.conversation.thinkingLevel = level;
			this.agent.state.thinkingLevel = level;
			await this.sessionTree.appendThinkingLevelChange(level);
			await this.emitOwn({ type: "thinking_level_select", level, previousLevel });
		} else {
			this.operation.pendingMutations.thinkingLevel = level;
		}
	}

	async setActiveTools(toolNames: string[]): Promise<void> {
		if (this.operation.idle) {
			this.conversation.activeToolNames = [...toolNames];
			this.agent.state.tools = toolNames.map((name) => this.toolRegistry.get(name)).filter(Boolean) as any;
		} else {
			this.operation.pendingMutations.activeToolNames = [...toolNames];
		}
	}

	async setSystemPromptInputs(inputs: SystemPromptInputs): Promise<void> {
		if (this.operation.idle) {
			this.conversation.systemPromptInputs = inputs;
			this.agent.state.systemPrompt = buildSystemPrompt(this.conversation.systemPromptInputs, this.env.cwd);
		} else {
			this.operation.pendingMutations.systemPromptInputs = inputs;
		}
	}

	async abort(): Promise<AbortResult> {
		this.operation.abortRequested = true;
		const clearedSteer = [...this.operation.steerQueue];
		const clearedFollowUp = [...this.operation.followUpQueue];
		this.operation.steerQueue = [];
		this.operation.followUpQueue = [];
		this.agent.clearAllQueues();
		await this.emitQueueUpdate();
		this.agent.abort();
		await this.agent.waitForIdle();
		await this.emitOwn({ type: "abort", clearedSteer, clearedFollowUp });
		return { clearedSteer, clearedFollowUp };
	}

	async waitForIdle(): Promise<void> {
		await this.agent.waitForIdle();
	}

	subscribe(listener: (event: AgentHarnessEvent, signal?: AbortSignal) => Promise<void> | void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	on<TType extends keyof AgentHarnessEventResultMap>(
		type: TType,
		handler: (
			event: Extract<import("./types.js").AgentHarnessOwnEvent, { type: TType }>,
			ctx: AgentHarnessContext,
		) => Promise<AgentHarnessEventResultMap[TType]> | AgentHarnessEventResultMap[TType],
	): () => void {
		let handlers = this.hooks.get(type);
		if (!handlers) {
			handlers = new Set();
			this.hooks.set(type, handlers);
		}
		handlers.add(handler as any);
		return () => handlers!.delete(handler as any);
	}

	private expandSkillCommand(text: string): string {
		if (!text.startsWith("/skill:")) return text;
		const spaceIndex = text.indexOf(" ");
		const skillName = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex);
		const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();
		const skill = this.skills.find((candidate) => candidate.name === skillName);
		if (!skill) return text;
		let content = readFileSync(skill.filePath, "utf8");
		content = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
		return args ? `${content}\n\n${args}` : content;
	}
}
