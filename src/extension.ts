import { execSync } from 'child_process';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
	buildStoryDesignContextBatchMatchPrompt,
	buildStoryDesignContextSuggestionPrompt,
	buildVisualDesignContextDraftPrompt,
	createReviewStoryDesignContextDraft,
	createStoryDesignContextOverride,
	hasAnyDesignContextForStory,
	hasStoryLevelDesignContext,
	listAvailableSharedDesignContextTargets,
	mergeSharedDesignContextTargets,
	normalizeStoryDesignContextBatchMatchResult,
	readDesignContext,
	readDesignContextForScope,
	resolveDesignContextForStory,
	resolveSharedDesignContextForStory,
	synthesizeExecutionDesignContextPromptLines,
	summarizeDesignContextForPrompt,
	validateDesignContext,
	writeDesignContext,
	writeDesignContextForScope,
} from './designContext';
import { generateAgentMapArtifacts } from './agentMap';
import {
	createEmptyKnowledgeCheckReport,
	evaluateKnowledgeCoverage,
	summarizeKnowledgeCheckForPrompt,
} from './knowledgeCheck';
import {
	composeStoryExecutionPrompt,
	composeStoryRefactorPrompt,
	composeStoryReviewerPrompt,
} from './promptContext';
import {
	createSynthesizedTaskMemory,
	hasTaskMemoryArtifact,
	recallRelatedTaskMemories,
	readTaskMemory,
	summarizeRecalledTaskMemoriesForPrompt,
	summarizeTaskMemoryForPrompt,
	upsertTaskMemoryIndexEntry,
	validateTaskMemory,
	writeTaskMemory,
} from './taskMemory';
import {
	createSynthesizedExecutionCheckpoint,
	getRecentExecutionCheckpoint,
	hasExecutionCheckpointArtifact,
	listValidExecutionCheckpoints,
	readExecutionCheckpoint,
	summarizeExecutionCheckpointForPrompt,
	validateExecutionCheckpoint,
	writeExecutionCheckpoint,
} from './executionCheckpoint';
import {
	applyStoryApprovalDecision,
	createSynthesizedStoryEvidence,
	hasStoryEvidenceArtifact,
	readStoryEvidence,
	summarizeStoryEvidenceForStatus,
	validateStoryEvidence,
	writeStoryEvidence,
} from './storyEvidence';
import {
	buildStoryReviewLoopState,
	createSynthesizedStoryReview,
	DEFAULT_STORY_AUTO_REFACTOR_LIMIT,
	DEFAULT_STORY_REVIEW_PASSING_SCORE,
	deriveMaxReviewerPasses,
	summarizeStoryReviewForPrompt,
	summarizeStoryReviewForStatus,
	validateStoryReviewResult,
} from './storyReview';
import { parseTaskSignalStatus } from './taskStatus';
import { buildHarnessGuideDocument } from './helpManual';
import {
	buildProjectConstraintChatAdvicePrompt,
	buildProjectConstraintsInitializationPrompt,
	ensureProjectConstraintsScaffold,
	extractRunnableProjectConstraintRequest,
	hasProjectConstraintsArtifacts,
	loadMergedProjectConstraints,
	ProjectConstraintReferenceSource,
	scanWorkspaceForProjectConstraints,
	summarizeProjectConstraintsForPrompt,
} from './projectConstraints';
import {
	refreshSourceContextIndex,
	getSourceContextIndex,
	recallRelevantSourceContext,
	summarizeRecalledSourceContextForPrompt,
	writeSourceContextIndex,
} from './sourceContext';
import {
	buildEffectivePolicyConfig,
	clearPolicyBaseline,
	createDefaultPolicyConfig,
	deriveStoryChangedFiles,
	evaluatePolicyGates,
	normalizePolicyConfig,
	readPolicyBaseline,
	summarizePolicyConfigForPrompt,
	summarizePolicyViolations,
	writePolicyBaseline,
} from './policyGate';
import { createStoryRunLogRecorder, StoryRunLogRecorder } from './runLog';
import {
	DesignContextScope,
	StoryApprovalAction,
	ExecutionCheckpointArtifact,
	ExecutionCheckpointStatus,
	GeneratedProjectConstraints,
	PrdFile,
	StoryEvidenceArtifact,
	StoryReviewLoopState,
	StoryReviewResult,
	STORY_STATUSES,
	StoryExecutionStatus,
	TaskMemoryArtifact,
	UserStory,
	normalizeStoryExecutionStatus,
} from './types';
import {
	PRD_FILENAME,
	HARNESS_RUNNER_DIR,
	STORY_STATUS_FILENAME,
	ensureDesignContextSuggestionDirectory,
	getDesignContextSuggestionPath as resolveDesignContextSuggestionPath,
	getDesignContextPath as resolveDesignContextPath,
	getModuleDesignContextPath as resolveModuleDesignContextPath,
	getPrdDirectoryPath as resolvePrdDirectoryPath,
	getPrdPath as resolvePrdPath,
	getEditableProjectConstraintsPath as resolveEditableProjectConstraintsPath,
	getExecutionCheckpointPath as resolveExecutionCheckpointPath,
	getGeneratedProjectConstraintsPath as resolveGeneratedProjectConstraintsPath,
	getProjectDesignContextPath as resolveProjectDesignContextPath,
	getHarnessRunnerDir as resolveHarnessRunnerDir,
	getScreenDesignContextPath as resolveScreenDesignContextPath,
	getStoryEvidencePath as resolveStoryEvidencePath,
	getStoryStatusRegistryPath as resolveStoryStatusRegistryPath,
	getSourceContextIndexPath as resolveSourceContextIndexPath,
	getTaskMemoryPath as resolveTaskMemoryPath,
} from './workspacePaths';
import {
HarnessLanguagePack,
HarnessMenuItem,
HarnessMenuNode,
HarnessMenuCommandItem,
HarnessMenuSubmenuItem,
getLocalizedStoryStatus,
getHarnessLanguagePack,
normalizeHarnessLanguage,
} from './localization';
import {
	buildHarnessMenuOrderEditorHtml,
	HarnessMenuOrderEditorItem,
	normalizeHarnessMenuOrderEditorPayload,
} from './menuOrderEditor';
import {
	buildExecutionCheckpointConfigHtml,
	ExecutionCheckpointConfigState,
	PolicyRuleItem,
	StoryCheckpointInfo,
	ConstantParamInfo,
} from './executionCheckpointConfig';

interface ClineAPI {
	startNewTask(task?: string, images?: string[]): Promise<void>;
	sendMessage?(message?: string, images?: string[]): Promise<void>;
	pressPrimaryButton?(): Promise<void>;
	pressSecondaryButton?(): Promise<void>;
}

function getNumericConfigWithLegacyFallback(
	cfg: vscode.WorkspaceConfiguration,
	key: string,
	legacyKey: string,
	defaultValue: number,
): number {
	return cfg.get<number>(key, cfg.get<number>(legacyKey, defaultValue));
}

function getConfig() {
	const cfg = vscode.workspace.getConfiguration('harness-runner');
	const approvalPromptMode = resolveWorkspaceApprovalPromptMode(cfg.inspect<string>('approvalPromptMode'));
	const reviewerLoopEnabled = resolveWorkspaceReviewerLoopEnabled(cfg.inspect<boolean>('enableReviewerLoop'));
	const reviewerPassingScore = resolveWorkspaceReviewerPassingScore(cfg.inspect<number>('reviewPassingScore'));
	const reviewerAutoRefactorLimit = resolveWorkspaceReviewerAutoRefactorLimit(cfg.inspect<number>('maxAutoRefactorRounds'));
	return {
		MAX_AUTONOMOUS_LOOPS: cfg.get<number>('maxAutonomousLoops', 2),
		LOOP_DELAY_MS: cfg.get<number>('loopDelayMs', 3000),
		EXECUTION_RESPONSE_POLL_MS: getNumericConfigWithLegacyFallback(cfg, 'executionResponsePollMs', 'copilotResponsePollMs', 5000),
		EXECUTION_TIMEOUT_MS: getNumericConfigWithLegacyFallback(cfg, 'executionTimeoutMs', 'copilotTimeoutMs', 600000),
		EXECUTION_MIN_WAIT_MS: getNumericConfigWithLegacyFallback(cfg, 'executionMinWaitMs', 'copilotMinWaitMs', 15000),
		AUTO_INJECT_PROJECT_CONSTRAINTS: cfg.get<boolean>('autoInjectProjectConstraints', true),
		AUTO_INJECT_DESIGN_CONTEXT: cfg.get<boolean>('autoInjectDesignContext', true),
		AUTO_RECALL_TASK_MEMORY: cfg.get<boolean>('autoRecallTaskMemory', true),
		AUTO_COMMIT_GIT: cfg.get<boolean>('autoCommitGit', true),
		RECALLED_TASK_MEMORY_LIMIT: cfg.get<number>('recalledTaskMemoryLimit', 3),
		REQUIRE_PROJECT_CONSTRAINTS_BEFORE_RUN: cfg.get<boolean>('requireProjectConstraintsBeforeRun', false),
		REQUIRE_DESIGN_CONTEXT_FOR_TAGGED_STORIES: cfg.get<boolean>('requireDesignContextForTaggedStories', false),
		POLICY_GATES: cfg.get<unknown>('policyGates', undefined),
		POLICY_GATE_COMMAND_TIMEOUT_MS: cfg.get<number>('policyGateCommandTimeoutMs', 600000),
		APPROVAL_PROMPT_MODE: approvalPromptMode,
		ENABLE_REVIEWER_LOOP: reviewerLoopEnabled,
		REVIEW_PASSING_SCORE: reviewerPassingScore,
		MAX_AUTO_REFACTOR_ROUNDS: reviewerAutoRefactorLimit,
		LANGUAGE: normalizeHarnessLanguage(cfg.get<string>('language', 'Chinese')),
	};
}

type ApprovalPromptMode = 'default' | 'bypass' | 'autopilot';

type WorkspacePinnedRunnerSettings = {
	approvalPromptMode: ApprovalPromptMode;
	enableReviewerLoop: boolean;
	reviewPassingScore: number;
	maxAutoRefactorRounds: number;
};

type WorkspacePinnedSettingInspection<T> = {
	key?: string;
	defaultValue?: T;
	globalValue?: T;
	workspaceValue?: T;
	workspaceFolderValue?: T;
};

function normalizeApprovalPromptMode(value: unknown): ApprovalPromptMode {
	return value === 'bypass' || value === 'autopilot' ? value : 'default';
}

export function normalizeReviewerLoopEnabled(value: unknown): boolean {
	return value !== false;
}

export function normalizeReviewerPassingScore(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return DEFAULT_STORY_REVIEW_PASSING_SCORE;
	}

	return Math.min(100, Math.max(1, Math.round(value)));
}

export function normalizeReviewerAutoRefactorLimit(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return DEFAULT_STORY_AUTO_REFACTOR_LIMIT;
	}

	return Math.max(0, Math.round(value));
}

export function resolveWorkspaceApprovalPromptMode(
	inspection: WorkspacePinnedSettingInspection<string> | undefined,
): ApprovalPromptMode {
	return normalizeApprovalPromptMode(inspection?.workspaceFolderValue ?? inspection?.workspaceValue ?? inspection?.globalValue);
}

export function resolveWorkspaceReviewerLoopEnabled(
	inspection: WorkspacePinnedSettingInspection<boolean> | undefined,
): boolean {
	return normalizeReviewerLoopEnabled(inspection?.workspaceFolderValue ?? inspection?.workspaceValue ?? inspection?.globalValue);
}

export function resolveWorkspaceReviewerPassingScore(
	inspection: WorkspacePinnedSettingInspection<number> | undefined,
): number {
	return normalizeReviewerPassingScore(inspection?.workspaceFolderValue ?? inspection?.workspaceValue ?? inspection?.globalValue);
}

export function resolveWorkspaceReviewerAutoRefactorLimit(
	inspection: WorkspacePinnedSettingInspection<number> | undefined,
): number {
	return normalizeReviewerAutoRefactorLimit(inspection?.workspaceFolderValue ?? inspection?.workspaceValue ?? inspection?.globalValue);
}

function getLanguagePack() {
	return getHarnessLanguagePack(getConfig().LANGUAGE);
}

const HARNESS_ROOT_MENU_ORDER_SETTING = 'rootMenuOrder';
const HARNESS_ROOT_MENU_COMMAND_ORDER_KEYS: Record<string, string> = {
'harness-runner.quickStart': 'quickStart',
'harness-runner.appendUserStories': 'appendUserStories',
'harness-runner.showGuide': 'showGuide',
};
const HARNESS_ROOT_MENU_LEGACY_ORDER_ALIASES: Record<string, readonly string[]> = {
planning: ['quickStart', 'appendUserStories'],
guides: ['showGuide'],
};

export interface HarnessMenuQuickPickEntry extends vscode.QuickPickItem {
	menuItem: HarnessMenuItem;
}

function getHarnessMenuNode(languagePack: HarnessLanguagePack, menuId: string): HarnessMenuNode {
	const node = languagePack.menu.nodes[menuId];
	if (!node) {
		throw new Error(`Unknown Harness menu node: ${menuId}`);
	}
	return node;
}

function getHarnessRootMenuIds(languagePack: HarnessLanguagePack): string[] {
	return getHarnessMenuNode(languagePack, languagePack.menu.rootId).items.flatMap(menuItem =>
		getHarnessRootMenuItemOrderKey(menuItem)
			? [getHarnessRootMenuItemOrderKey(menuItem)!]
			: []
	);
}

function getHarnessRootMenuItemOrderKey(menuItem: HarnessMenuItem): string | undefined {
	if (menuItem.kind === 'submenu') {
		return menuItem.target;
	}
	if (menuItem.kind === 'command') {
		return HARNESS_ROOT_MENU_COMMAND_ORDER_KEYS[menuItem.command] ?? menuItem.command;
	}
	return undefined;
}

export function normalizeHarnessRootMenuOrder(configuredValue: unknown, defaultOrder: readonly string[]): string[] {
	const configuredOrder = Array.isArray(configuredValue)
		? configuredValue.filter((value): value is string => typeof value === 'string')
		: [];
	const normalized: string[] = [];
	const seen = new Set<string>();
	const validTargets = new Set(defaultOrder);

	for (const target of configuredOrder) {
		const expandedTargets = HARNESS_ROOT_MENU_LEGACY_ORDER_ALIASES[target] ?? [target];
		for (const expandedTarget of expandedTargets) {
			if (!validTargets.has(expandedTarget) || seen.has(expandedTarget)) {
				continue;
			}
			seen.add(expandedTarget);
			normalized.push(expandedTarget);
		}
	}

	for (const target of defaultOrder) {
		if (seen.has(target)) {
			continue;
		}
		seen.add(target);
		normalized.push(target);
	}

	return normalized;
}

function getHarnessMenuItems(languagePack: HarnessLanguagePack, menuId: string): HarnessMenuItem[] {
let items = [...getHarnessMenuNode(languagePack, menuId).items];
if (menuId !== languagePack.menu.rootId) {
return items;
}

// Read raw configured order to detect legacy tokens like 'guides'
const rawConfigured = vscode.workspace.getConfiguration('harness-runner').get(HARNESS_ROOT_MENU_ORDER_SETTING);
const rawConfiguredOrder = Array.isArray(rawConfigured) ? rawConfigured.filter((v): v is string => typeof v === 'string') : [];

// Back-compat: if the persisted workspace config used the legacy 'guides' token,
// expose a 'guides' submenu at the root so the persisted ordering and navigation still work.
// Also remove the new canonical 'harness-runner.showGuide' command to avoid duplicating entries.
if (rawConfiguredOrder.includes('guides')) {
const hasGuidesSubmenu = items.some(i => i.kind === 'submenu' && (i as HarnessMenuSubmenuItem).target === 'guides');
if (!hasGuidesSubmenu) {
// remove canonical showGuide command if present
items = items.filter(i => !(i.kind === 'command' && (i as HarnessMenuCommandItem).command === 'harness-runner.showGuide'));

// build submenu label/description from the guides node if available
const guidesNode = (languagePack.menu.nodes as Record<string, HarnessMenuNode>)['guides'];
const fallbackLabel = stripHarnessMenuLabelDecoration('$(book)  Harness Runner Guide');
const submenuLabel = guidesNode?.items?.find(it => it.kind === 'command')?.label ?? guidesNode?.placeholder ?? fallbackLabel;
const submenuDescription = guidesNode?.items?.find(it => it.kind === 'command')?.description ?? '';
items.push({
kind: 'submenu',
target: 'guides',
label: submenuLabel,
description: submenuDescription,
});
}
}

const defaultOrder = getHarnessRootMenuIds(languagePack);
const configuredOrder = normalizeHarnessRootMenuOrder(
vscode.workspace.getConfiguration('harness-runner').get(HARNESS_ROOT_MENU_ORDER_SETTING),
defaultOrder,
);
const orderMap = new Map(configuredOrder.map((target, index) => [target, index]));

// Build alias map from legacy tokens (e.g., 'guides') to canonical configured indices so injected
// legacy submenu targets can be ordered alongside canonical keys.
const aliasMap = new Map<string, number>();
for (const [idx, target] of configuredOrder.entries()) {
for (const [aliasKey, expansions] of Object.entries(HARNESS_ROOT_MENU_LEGACY_ORDER_ALIASES)) {
if (expansions.includes(target) && !aliasMap.has(aliasKey)) {
aliasMap.set(aliasKey, idx);
}
}
}

return items
.map((menuItem, index) => ({
menuItem,
index,
order: orderMap.get(getHarnessRootMenuItemOrderKey(menuItem) ?? '') ?? aliasMap.get(getHarnessRootMenuItemOrderKey(menuItem) ?? '') ?? configuredOrder.length + index,
}))
.sort((left, right) => left.order - right.order || left.index - right.index)
.map(entry => entry.menuItem);
}

export function buildHarnessMenuQuickPickItems(languagePack: HarnessLanguagePack, menuId: string): HarnessMenuQuickPickEntry[] {
	return getHarnessMenuItems(languagePack, menuId).map(menuItem => ({
		label: menuItem.label,
		description: menuItem.description,
		menuItem,
	}));
}

function stripHarnessMenuLabelDecoration(label: string): string {
	return label.replace(/\$\([^)]+\)\s*/g, '').trim();
}

function buildHarnessRootMenuOrderEditorItems(languagePack: HarnessLanguagePack): HarnessMenuOrderEditorItem[] {
	return buildHarnessMenuQuickPickItems(languagePack, languagePack.menu.rootId)
		.flatMap(entry => {
			const target = getHarnessRootMenuItemOrderKey(entry.menuItem);
			if (!target) {
				return [];
			}

			return [{
				target,
				label: stripHarnessMenuLabelDecoration(entry.label),
				description: entry.description ?? '',
			}];
		});
}

async function showHarnessMenuOrderEditor(
	languagePack: HarnessLanguagePack,
	items: readonly HarnessMenuOrderEditorItem[],
): Promise<string[] | undefined> {
	const panel = vscode.window.createWebviewPanel(
		'harnessMenuOrderEditor',
		languagePack.menu.customizeOrder.title,
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			retainContextWhenHidden: false,
		}
	);
	panel.iconPath = new vscode.ThemeIcon('list-ordered');
	panel.webview.html = buildHarnessMenuOrderEditorHtml({
		cspSource: panel.webview.cspSource,
		items,
		copy: {
			title: languagePack.menu.customizeOrder.title,
			description: languagePack.menu.customizeOrder.description,
			instructions: languagePack.menu.customizeOrder.instructions,
			unsavedChanges: languagePack.menu.customizeOrder.unsavedChanges,
			save: languagePack.menu.customizeOrder.save,
			cancel: languagePack.menu.customizeOrder.cancel,
			reset: languagePack.menu.customizeOrder.reset,
			positionLabel: languagePack.menu.customizeOrder.positionLabel,
		},
	});

	const validTargets = items.map(item => item.target);
	return new Promise<string[] | undefined>(resolve => {
		let settled = false;
		const disposables: vscode.Disposable[] = [];
		const finish = (value: string[] | undefined) => {
			if (settled) {
				return;
			}
			settled = true;
			while (disposables.length > 0) {
				disposables.pop()?.dispose();
			}
			resolve(value);
		};

		disposables.push(panel.onDidDispose(() => finish(undefined)));
		disposables.push(panel.webview.onDidReceiveMessage(message => {
			if (message?.type === 'cancel') {
				finish(undefined);
				panel.dispose();
				return;
			}

			if (message?.type !== 'save') {
				return;
			}

			const orderedTargets = normalizeHarnessMenuOrderEditorPayload(message.order, validTargets);
			if (!orderedTargets) {
				void vscode.window.showErrorMessage(languagePack.menu.customizeOrder.invalidOrder);
				return;
			}

			finish(orderedTargets);
			panel.dispose();
		}));
	});
}

export function resolveHarnessMenuSelection(
	languagePack: HarnessLanguagePack,
	menuStack: readonly string[],
	menuItem: HarnessMenuItem,
): { nextMenuStack: string[]; command?: string; exitMenu?: boolean; } {
	switch (menuItem.kind) {
		case 'command':
			return {
				nextMenuStack: [...menuStack],
				command: menuItem.command,
			};
		case 'submenu':
			getHarnessMenuNode(languagePack, menuItem.target);
			return {
				nextMenuStack: [...menuStack, menuItem.target],
			};
		case 'back':
			if (menuStack.length <= 1) {
				return {
					nextMenuStack: [],
					exitMenu: true,
				};
			}
			return {
				nextMenuStack: menuStack.slice(0, -1),
			};
	}
}

// ── Filesystem Task State Manager ────────────────────────────────────────────
// Manages .harness-runner/story-status.json as the shared state and completion-signal
// registry. Legacy task-<id>-status files are migrated on read.

class HarnessStateManager {

	/** Absolute path to the .harness-runner directory for the workspace. */
	static getHarnessRunnerDir(workspaceRoot: string): string {
		return resolveHarnessRunnerDir(workspaceRoot);
	}

	/** Absolute path to the story status registry stored under .harness-runner/. */
	static getStoryStatusRegistryPath(workspaceRoot: string): string {
		return resolveStoryStatusRegistryPath(workspaceRoot);
	}

	/**
	 * Ensure the .harness-runner directory exists. Safe to call multiple times.
	 */
	static ensureDir(workspaceRoot: string): void {
		const dir = HarnessStateManager.getHarnessRunnerDir(workspaceRoot);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
	}

	private static getLegacyTaskStatusPath(workspaceRoot: string, taskId: string): string {
		return path.join(HarnessStateManager.getHarnessRunnerDir(workspaceRoot), `task-${taskId}-status`);
	}

	private static clearLegacyTaskStatusFile(workspaceRoot: string, taskId: string): void {
		const legacyPath = HarnessStateManager.getLegacyTaskStatusPath(workspaceRoot, taskId);
		try {
			if (fs.existsSync(legacyPath)) {
				fs.unlinkSync(legacyPath);
			}
		} catch {
			/* ignore */
		}
	}

	private static deleteStatusEntry(workspaceRoot: string, taskId: string): void {
		const statusMap = HarnessStateManager.readStoryStatusMap(workspaceRoot);
		if (taskId in statusMap) {
			delete statusMap[taskId];
			const filePath = HarnessStateManager.getStoryStatusRegistryPath(workspaceRoot);
			if (Object.keys(statusMap).length === 0) {
				try {
					if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); }
				} catch {
					/* ignore */
				}
			} else {
				HarnessStateManager.writeStoryStatusMap(workspaceRoot, statusMap);
			}
		}

		HarnessStateManager.clearLegacyTaskStatusFile(workspaceRoot, taskId);
	}

	private static setTaskSignalStatus(
		workspaceRoot: string,
		taskId: string,
		status: Extract<StoryExecutionStatus, 'inprogress' | 'completed'>,
	): void {
		const statusMap = HarnessStateManager.readStoryStatusMap(workspaceRoot);
		statusMap[taskId] = status;
		HarnessStateManager.writeStoryStatusMap(workspaceRoot, statusMap);
		HarnessStateManager.clearLegacyTaskStatusFile(workspaceRoot, taskId);
	}

	/**
	 * Write "inprogress" for the given task.
	 * Stores the transient signal inside .harness-runner/story-status.json.
	 */
	static setInProgress(workspaceRoot: string, taskId: string): void {
		HarnessStateManager.ensureDir(workspaceRoot);
		HarnessStateManager.setTaskSignalStatus(workspaceRoot, taskId, 'inprogress');
	}

	/**
	 * Write "completed" for the given task.
	 * Safe to call even if the signal entry does not already exist.
	 */
	static setCompleted(workspaceRoot: string, taskId: string): void {
		HarnessStateManager.ensureDir(workspaceRoot);
		HarnessStateManager.setTaskSignalStatus(workspaceRoot, taskId, 'completed');
	}

	/**
	 * Read the current task signal from story-status.json.
	 * Falls back to a legacy task-<id>-status file and migrates it when present.
	 */
	static getTaskSignalStatus(workspaceRoot: string, taskId: string): 'inprogress' | 'completed' | 'none' {
		const statusMap = HarnessStateManager.readStoryStatusMap(workspaceRoot);
		const mappedStatus = statusMap[taskId];
		if (mappedStatus === 'inprogress' || mappedStatus === 'completed') {
			return mappedStatus;
		}

		const legacyPath = HarnessStateManager.getLegacyTaskStatusPath(workspaceRoot, taskId);
		try {
			const content = fs.readFileSync(legacyPath, 'utf-8').trim();
			const parsedStatus = parseTaskSignalStatus(content);
			if (parsedStatus === 'inprogress' || parsedStatus === 'completed') {
				HarnessStateManager.setTaskSignalStatus(workspaceRoot, taskId, parsedStatus);
				return parsedStatus;
			}
		} catch {
			/* file missing or unreadable */
		}
		return 'none';
	}

	/**
	 * Returns the id of the first task whose signal entry contains "inprogress",
	 * or null if no task is currently active.
	 */
	static getInProgressTaskId(workspaceRoot: string): string | null {
		for (const [taskId, status] of Object.entries(HarnessStateManager.readStoryStatusMap(workspaceRoot))) {
			if (status === 'inprogress') {
				return taskId;
			}
		}

		const dir = HarnessStateManager.getHarnessRunnerDir(workspaceRoot);
		if (!fs.existsSync(dir)) { return null; }

		try {
			for (const entry of fs.readdirSync(dir)) {
				const match = entry.match(/^task-(.+)-status$/);
				if (!match) { continue; }
				const taskId = match[1];
				if (HarnessStateManager.getTaskSignalStatus(workspaceRoot, taskId) === 'inprogress') {
					return taskId;
				}
			}
		} catch {
			return null;
		}
		return null;
	}

	/** True if any task status file currently contains "inprogress". */
	static isAnyInProgress(workspaceRoot: string): boolean {
		return HarnessStateManager.getInProgressTaskId(workspaceRoot) !== null;
	}

	/**
	 * Reset a stalled inprogress task back to "none" by deleting its signal entry.
	 * Used during startup recovery when a previous HARNESS session crashed.
	 */
	static clearStalledTask(workspaceRoot: string, taskId: string): void {
		HarnessStateManager.deleteStatusEntry(workspaceRoot, taskId);
	}

	/** Read the persisted per-story execution status map. */
	static readStoryStatusMap(workspaceRoot: string): Record<string, StoryExecutionStatus> {
		const filePath = HarnessStateManager.getStoryStatusRegistryPath(workspaceRoot);
		if (!fs.existsSync(filePath)) {
			return {};
		}

		try {
			const content = fs.readFileSync(filePath, 'utf-8');
			const parsed = JSON.parse(content) as Record<string, unknown>;
			const statusMap: Record<string, StoryExecutionStatus> = {};

			for (const [storyId, rawStatus] of Object.entries(parsed)) {
				const normalized = normalizeStoryExecutionStatus(rawStatus);
				if (normalized) {
					statusMap[storyId] = normalized;
				}
			}

			return statusMap;
		} catch {
			return {};
		}
	}

	/** Persist the per-story execution status map to .harness-runner/story-status.json. */
	static writeStoryStatusMap(workspaceRoot: string, statusMap: Record<string, StoryExecutionStatus>): void {
		HarnessStateManager.ensureDir(workspaceRoot);
		const filePath = HarnessStateManager.getStoryStatusRegistryPath(workspaceRoot);
		fs.writeFileSync(filePath, `${JSON.stringify(statusMap, null, 2)}\n`, 'utf-8');
	}

	/** Store the latest execution status for one story. */
	static setStoryExecutionStatus(workspaceRoot: string, taskId: string, status: StoryExecutionStatus): void {
		const statusMap = HarnessStateManager.readStoryStatusMap(workspaceRoot);
		statusMap[taskId] = status;
		HarnessStateManager.writeStoryStatusMap(workspaceRoot, statusMap);
	}

	/**
	 * Resolve the latest execution status for a story.
	 * Falls back to transient signal entries when needed.
	 */
	static getStoryExecutionStatus(workspaceRoot: string, taskId: string): StoryExecutionStatus | 'none' {
		const statusMap = HarnessStateManager.readStoryStatusMap(workspaceRoot);
		const mappedStatus = statusMap[taskId];
		if (mappedStatus) {
			return mappedStatus;
		}

		const taskSignal = HarnessStateManager.getTaskSignalStatus(workspaceRoot, taskId);
		if (taskSignal === 'inprogress' || taskSignal === 'completed') {
			return taskSignal;
		}

		return 'none';
	}

	/** Remove a story from the persisted execution status map. */
	static clearStoryExecutionStatus(workspaceRoot: string, taskId: string): void {
		HarnessStateManager.deleteStatusEntry(workspaceRoot, taskId);
	}

	/**
	 * Ensure `.harness-runner/` is present in the workspace's .gitignore.
	 * Creates .gitignore if it does not exist. Safe to call multiple times.
	 */
	static ensureGitignore(workspaceRoot: string): void {
		const gitignorePath = path.join(workspaceRoot, '.gitignore');
		const entriesToIgnore = ['.harness-runner/'];

		try {
			let content = '';
			if (fs.existsSync(gitignorePath)) {
				content = fs.readFileSync(gitignorePath, 'utf-8');
			}

			const missing: string[] = [];
			for (const entry of entriesToIgnore) {
				const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				const pattern = new RegExp(`^\\s*${escaped}\\s*$`, 'm');
				if (!pattern.test(content)) {
					missing.push(entry);
				}
			}

			if (missing.length === 0) { return; }

			const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
			const block = missing.join('\n');
			fs.writeFileSync(gitignorePath, `${content}${separator}\n# Harness Runner task state\n${block}\n`, 'utf-8');
			log(`  Added to .gitignore: ${missing.join(', ')}`);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			log(`  WARNING: Could not update .gitignore: ${msg}`);
		}
	}
}

// ── PRD File Operations ─────────────────────────────────────────────────────

function getPrdPath(workspaceRoot: string): string {
	return resolvePrdPath(workspaceRoot);
}

function getPrdDirectoryPath(workspaceRoot: string): string {
	return resolvePrdDirectoryPath(workspaceRoot);
}

function writeJsonFile(filePath: string, content: unknown): void {
	fs.writeFileSync(filePath, `${JSON.stringify(content, null, 2)}\n`, 'utf-8');
}

function readJsonFile<T>(filePath: string): T | null {
	try {
		const content = fs.readFileSync(filePath, 'utf-8');
		return JSON.parse(content) as T;
	} catch {
		return null;
	}
}

export function persistWorkspacePinnedRunnerSettingsFile(
	workspaceRoot: string,
	settings: WorkspacePinnedRunnerSettings,
): string {
	const settingsDir = path.join(workspaceRoot, '.vscode');
	const settingsPath = path.join(settingsDir, 'settings.json');
	if (!fs.existsSync(settingsDir)) {
		fs.mkdirSync(settingsDir, { recursive: true });
	}

	const current = readJsonFile<Record<string, unknown>>(settingsPath) ?? {};
	const next: Record<string, unknown> = { ...current };
	delete next['ralph-runner.approvalPromptMode'];
	delete next['ralph-runner.enableReviewerLoop'];
	delete next['ralph-runner.reviewPassingScore'];
	delete next['ralph-runner.maxAutoRefactorRounds'];
	delete next['harness-runner.approvalPromptMode'];
	delete next['harness-runner.enableReviewerLoop'];
	delete next['harness-runner.reviewPassingScore'];
	delete next['harness-runner.maxAutoRefactorRounds'];

	next['harness-runner.approvalPromptMode'] = settings.approvalPromptMode;
	next['harness-runner.enableReviewerLoop'] = settings.enableReviewerLoop;
	next['harness-runner.reviewPassingScore'] = settings.reviewPassingScore;
	next['harness-runner.maxAutoRefactorRounds'] = settings.maxAutoRefactorRounds;

	writeJsonFile(settingsPath, next);
	return settingsPath;
}

export function persistWorkspacePinnedRootMenuOrderFile(
	workspaceRoot: string,
	orderedTargets: readonly string[],
): string {
	const settingsDir = path.join(workspaceRoot, '.vscode');
	const settingsPath = path.join(settingsDir, 'settings.json');
	if (!fs.existsSync(settingsDir)) {
		fs.mkdirSync(settingsDir, { recursive: true });
	}

	const current = readJsonFile<Record<string, unknown>>(settingsPath) ?? {};
	const next: Record<string, unknown> = { ...current };
	delete next['ralph-runner.rootMenuOrder'];
	delete next['harness-runner.rootMenuOrder'];
	next['harness-runner.rootMenuOrder'] = [...orderedTargets];

	writeJsonFile(settingsPath, next);
	return settingsPath;
}

function compareStoriesByPriority(left: UserStory, right: UserStory): number {
	if (left.priority !== right.priority) {
		return left.priority - right.priority;
	}
	return left.id.localeCompare(right.id);
}

function parsePrd(workspaceRoot: string): PrdFile | null {
	const prdPath = getPrdPath(workspaceRoot);
	try {
		const content = fs.readFileSync(prdPath, 'utf-8');
		return JSON.parse(content) as PrdFile;
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		log(`ERROR: Failed to read/parse prd.json: ${msg}`);
		return null;
	}
}

function getStoriesFromPrd(workspaceRoot: string): UserStory[] {
	const prd = parsePrd(workspaceRoot);
	if (!prd) {
		return [];
	}

	return [...prd.userStories].sort(compareStoriesByPriority);
}

function getNextUserStoryIdFromPrd(stories: UserStory[]): string {
	let maxNumericId = 0;

	for (const story of stories) {
		const match = story.id.match(/^US-(\d+)/i);
		if (!match) {
			continue;
		}

		const numericId = Number(match[1]);
		if (Number.isFinite(numericId)) {
			maxNumericId = Math.max(maxNumericId, numericId);
		}
	}

	return `US-${String(maxNumericId + 1).padStart(3, '0')}`;
}


function findNextPendingStory(prd: PrdFile, workspaceRoot: string): UserStory | null {
	// Sort by priority (ascending — lower number = higher priority)
	const sorted = [...prd.userStories].sort((a, b) => a.priority - b.priority);
	return sorted.find(story => {
		const status = HarnessStateManager.getStoryExecutionStatus(workspaceRoot, story.id);
		return status === 'none' || status === '未开始';
	}) || null;
}

export function getReplayStoryRange(prd: PrdFile, startStoryId: string): UserStory[] {
	const sorted = [...prd.userStories].sort((a, b) => a.priority - b.priority);
	const startIndex = sorted.findIndex(story => story.id === startStoryId);
	if (startIndex === -1) {
		return [];
	}

	return sorted.slice(startIndex);
}

export function isHarnessRunnerActive(workspaceRoot: string | undefined, runnerRunning: boolean): boolean {
	if (runnerRunning) {
		return true;
	}

	if (!workspaceRoot) {
		return false;
	}

	return HarnessStateManager.getInProgressTaskId(workspaceRoot) !== null;
}

// ── Globals ─────────────────────────────────────────────────────────────────

let outputChannel: vscode.OutputChannel;
let cancelToken: vscode.CancellationTokenSource | null = null;
let isRunning = false;
let statusBarItem: vscode.StatusBarItem;
let activeRunLog: StoryRunLogRecorder | null = null;
let activeClineSessionStartedAt: number | null = null;

// ── Activation ──────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel('Harness Runner');
	const languagePack = getLanguagePack();

	// ── Status bar icon ────────────────────────────────────────────────────
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.text = languagePack.statusBar.idleText;
	statusBarItem.tooltip = languagePack.statusBar.idleTooltip;
	statusBarItem.command = 'harness-runner.showMenu';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
		if (!event.affectsConfiguration('harness-runner.language')
			&& !event.affectsConfiguration('harness-runner.policyGates')
			&& !event.affectsConfiguration('harness-runner.approvalPromptMode')
			&& !event.affectsConfiguration('harness-runner.enableReviewerLoop')
			&& !event.affectsConfiguration('harness-runner.reviewPassingScore')
			&& !event.affectsConfiguration('harness-runner.maxAutoRefactorRounds')) {
			return;
		}
		updateStatusBar(isRunning ? 'running' : 'idle');
		if (event.affectsConfiguration('harness-runner.language')) {
			vscode.window.showInformationMessage(getLanguagePack().initProjectConstraints.languageChanged);
		}
	}));

	context.subscriptions.push(
		vscode.commands.registerCommand('harness-runner.configurePolicyGates', () => configurePolicyGates()),
		vscode.commands.registerCommand('harness-runner.showGuide', () => showGuideDocument()),
		vscode.commands.registerCommand('harness-runner.start', () => startHarnessRunner()),
		vscode.commands.registerCommand('harness-runner.stop', () => stopHarnessRunner()),
		vscode.commands.registerCommand('harness-runner.status', () => showStatus()),
		vscode.commands.registerCommand('harness-runner.reviewStoryApproval', () => reviewStoryApproval()),
		vscode.commands.registerCommand('harness-runner.resetStep', () => resetStory()),
		vscode.commands.registerCommand('harness-runner.rerunFailedStory', () => rerunFailedStory()),
		vscode.commands.registerCommand('harness-runner.initProjectConstraints', () => initializeProjectConstraints()),
		vscode.commands.registerCommand('harness-runner.refreshSourceContextIndex', () => refreshSourceContextIndexCommand()),
		vscode.commands.registerCommand('harness-runner.previewSourceContextRecall', () => previewSourceContextRecall()),
		vscode.commands.registerCommand('harness-runner.generateAgentMap', () => generateAgentMapCommand()),
		vscode.commands.registerCommand('harness-runner.recordDesignContext', () => recordDesignContext()),
		vscode.commands.registerCommand('harness-runner.generateDesignContextDraft', () => generateVisualDesignContextDraft()),
		vscode.commands.registerCommand('harness-runner.suggestStoryDesignContext', () => suggestStoryDesignContext()),
		vscode.commands.registerCommand('harness-runner.customizeMenuOrder', () => customizeMenuOrder()),
		vscode.commands.registerCommand('harness-runner.openSettings', () => {
			vscode.commands.executeCommand('workbench.action.openSettings', 'harness-runner');
		}),
		vscode.commands.registerCommand('harness-runner.showMenu', () => showCommandMenu()),
		vscode.commands.registerCommand('harness-runner.quickStart', () => quickStart()),
		vscode.commands.registerCommand('harness-runner.appendUserStories', () => appendUserStories())
	);

	log('Harness Runner extension activated.');
}

export function deactivate() {
	stopHarnessRunner();
	statusBarItem?.dispose();
	outputChannel?.dispose();
}

// ── Core Loop ───────────────────────────────────────────────────────────────

async function startHarnessRunner(): Promise<void> {
	const languagePack = getLanguagePack();
	if (isRunning) {
		vscode.window.showWarningMessage(languagePack.runtime.alreadyRunning);
		return;
	}

	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage(languagePack.common.noWorkspaceFolder);
		return;
	}

	const prdPath = getPrdPath(workspaceRoot);
	if (!fs.existsSync(prdPath)) {
		vscode.window.showErrorMessage(languagePack.runtime.prdNotFoundRoot);
		return;
	}

	// ── Startup: ensure .harness-runner/ dir exists and is gitignored in the workspace ──
	HarnessStateManager.ensureDir(workspaceRoot);
	HarnessStateManager.ensureGitignore(workspaceRoot);

	const stalledTaskId = HarnessStateManager.getInProgressTaskId(workspaceRoot);
	if (stalledTaskId !== null) {
		const stalledStory = getStoriesFromPrd(workspaceRoot).find(story => story.id === stalledTaskId)
			?? createCheckpointFallbackStory(stalledTaskId);
		const action = await vscode.window.showWarningMessage(
			languagePack.runtime.stalledTaskWarning(stalledTaskId),
			languagePack.runtime.clearAndRetry, languagePack.runtime.cancel
		);
		if (action !== languagePack.runtime.clearAndRetry) {
			log(`Startup aborted — stalled task ${stalledTaskId} left untouched.`);
			return;
		}
		const recoveryCheckpoint = ensureExecutionCheckpointPersistence(stalledStory, workspaceRoot, {
			status: 'interrupted',
			failureMessage: 'HARNESS detected and cleared a stale in-progress lock during startup recovery.',
		});
		HarnessStateManager.clearStalledTask(workspaceRoot, stalledTaskId);
		HarnessStateManager.clearStoryExecutionStatus(workspaceRoot, stalledTaskId);
		log(`Cleared stalled inprogress state for task ${stalledTaskId}; checkpoint persisted (${recoveryCheckpoint.source}).`);
	}

	const config = getConfig();
	if (!getEffectivePolicyConfig().enabled && config.REQUIRE_PROJECT_CONSTRAINTS_BEFORE_RUN && !hasProjectConstraintsArtifacts(workspaceRoot)) {
		vscode.window.showWarningMessage(languagePack.runtime.projectConstraintsRequiredBeforeRun);
		log('Startup aborted — project constraints are required but have not been initialized yet.');
		return;
	}

	isRunning = true;
	cancelToken = new vscode.CancellationTokenSource();
	outputChannel.show(true);
	log('═══════════════════════════════════════════════════');
	log('Harness Runner started — autonomous task runner');
	log(`Max loops: ${config.MAX_AUTONOMOUS_LOOPS}`);
	log('═══════════════════════════════════════════════════');

	updateStatusBar('running');

	let loopsExecuted = 0;

	while (loopsExecuted < config.MAX_AUTONOMOUS_LOOPS && isRunning) {
		if (cancelToken?.token.isCancellationRequested) {
			log('Cancelled by user.');
			break;
		}

		// Re-read PRD each iteration (it may have been modified externally)
		const prd = parsePrd(workspaceRoot);
		if (!prd) {
			log('ERROR: Could not parse prd.json');
			break;
		}

		if (prd.userStories.length === 0) {
			log('ERROR: No user stories found in prd.json');
			break;
		}

		log(`Loaded ${prd.userStories.length} user stories from prd.json`);

		const nextStory = findNextPendingStory(prd, workspaceRoot);

		if (!nextStory) {
			log('🎉 All user stories completed!');
			vscode.window.showInformationMessage(languagePack.runtime.allStoriesCompleted);
			break;
		}

		log('');
		log(`──── Loop ${loopsExecuted + 1}/${config.MAX_AUTONOMOUS_LOOPS} ────`);
		log(`Story ${nextStory.id}: ${nextStory.title}`);
		log(`Description: ${nextStory.description}`);
		log(`Priority: ${nextStory.priority}`);
		activeRunLog = createStoryRunLogRecorder(workspaceRoot, nextStory);
		activeRunLog.transitionPhase('startup', `Selected ${nextStory.id}: ${nextStory.title}.`);
		log(`  Run log created: ${activeRunLog.filePath.replace(/\\/g, '/')}`);
		refreshSourceContextIndexArtifact(workspaceRoot, `before ${nextStory.id}`);
		activeRunLog.transitionPhase('preflight', `Running preflight checks for ${nextStory.id}.`);

		const effectivePolicyConfig = getEffectivePolicyConfig();
		const preflightKnowledgeReport = getKnowledgeCheckReportSafe(workspaceRoot, {
			scope: 'run-preflight',
			story: nextStory,
		});
		if (effectivePolicyConfig.enabled) {
			const preflightPolicyResult = evaluatePolicyGates(effectivePolicyConfig, {
				workspaceRoot,
				story: nextStory,
				phase: 'preflight',
				projectConstraints: getMergedProjectConstraintsSafe(workspaceRoot),
				isDesignSensitiveStory: isDesignSensitiveStory(nextStory),
				hasExecutionTimeDesignFallback: synthesizeExecutionDesignContextPromptLines(nextStory, null).length > 0,
				hasArtifact: artifact => hasPolicyArtifact(workspaceRoot, nextStory, artifact),
				knowledgeCheckReport: preflightKnowledgeReport,
				commandTimeoutMs: config.POLICY_GATE_COMMAND_TIMEOUT_MS,
				artifactPaths: getPolicyArtifactPaths(workspaceRoot, nextStory),
			});
			activeRunLog?.recordPolicyEvaluation('preflight', preflightPolicyResult);
			if (!preflightPolicyResult.ok) {
				log(`  Policy gates blocked ${nextStory.id} before execution.`);
				for (const line of summarizePolicyViolations(preflightPolicyResult)) {
					log(`  ${line}`);
				}
				activeRunLog?.finalize('blocked', `Preflight policy gates blocked ${nextStory.id}.`, 'preflight');
				vscode.window.showWarningMessage(languagePack.runtime.policyBlockedBeforeStory(nextStory.id));
				activeRunLog = null;
				break;
			}
		}

		const missingRequiredDesignContext = getMissingRequiredDesignContextReason(workspaceRoot, nextStory);
		if (missingRequiredDesignContext) {
			log(`  ${missingRequiredDesignContext}`);
			activeRunLog?.recordEvent({
				phase: 'preflight',
				category: 'diagnostic',
				kind: 'failure',
				title: 'design-context-required',
				summary: missingRequiredDesignContext,
				details: [],
			});
			activeRunLog?.finalize('blocked', `Required design context was missing for ${nextStory.id}.`, 'preflight');
			vscode.window.showWarningMessage(missingRequiredDesignContext);
			activeRunLog = null;
			break;
		}

		// Guard: ensure no other task is inprogress before queuing this one.
		await ensureNoActiveTask(workspaceRoot);
		const baselinePath = writePolicyBaseline(workspaceRoot, nextStory.id, detectChangedFilesForWorkspace(workspaceRoot));
		log(`  Policy baseline captured for ${nextStory.id}: ${baselinePath.replace(/\\/g, '/')}`);
		activeRunLog?.recordEvent({
			phase: 'preflight',
			category: 'signal',
			kind: 'summary',
			title: 'policy-baseline',
			summary: `Captured policy baseline for ${nextStory.id}.`,
			details: [baselinePath.replace(/\\/g, '/')],
		});

		// ── Persist "inprogress" state to .harness-runner/story-status.json ───────────
		HarnessStateManager.setInProgress(workspaceRoot, nextStory.id);
		HarnessStateManager.setStoryExecutionStatus(workspaceRoot, nextStory.id, 'inprogress');
		log(`  Task state written: .harness-runner/story-status.json[${nextStory.id}] = inprogress`);

		try {
			activeRunLog?.transitionPhase('execution', `Delegating ${nextStory.id} to Cline for implementation.`);
			// executeStory returns only after Cline has written "completed"
			// to .harness-runner/story-status.json for this story id (or after a timeout).
			const executionResult = await executeStory(nextStory, workspaceRoot);

			// Safety net: ensure the lock is always cleared on success
			HarnessStateManager.setCompleted(workspaceRoot, nextStory.id);
			HarnessStateManager.setStoryExecutionStatus(workspaceRoot, nextStory.id, executionResult.evidence.artifact.status);

			log(`✅ Story ${nextStory.id} finalized as ${executionResult.evidence.artifact.status} with task memory (${executionResult.taskMemory.source}), checkpoint (${executionResult.checkpoint.source}), and evidence (${executionResult.evidence.source}).`);
			activeRunLog?.finalize('completed', `Story ${nextStory.id} finalized as ${executionResult.evidence.artifact.status}.`);
			await maybePromptForManualApproval(workspaceRoot, nextStory, executionResult.evidence.artifact);
		} catch (err: unknown) {
			const errMsg = err instanceof Error ? err.message : String(err);
			if (errMsg === 'Cancelled by user') {
				const interruptedCheckpoint = ensureExecutionCheckpointPersistence(nextStory, workspaceRoot, {
					status: 'interrupted',
					failureMessage: 'Execution stopped after user cancellation.',
				});
				log(`⏹ Story ${nextStory.id} cancelled by user.`);
				log(`  Checkpoint persisted for interrupted story ${nextStory.id} (${interruptedCheckpoint.source}).`);
				activeRunLog?.recordEvent({
					phase: 'finalization',
					category: 'diagnostic',
					kind: 'failure',
					title: 'cancelled',
					summary: `Story ${nextStory.id} was cancelled by the user.`,
					details: [errMsg],
				});
				activeRunLog?.finalize('cancelled', `Story ${nextStory.id} was cancelled during execution.`);
				HarnessStateManager.clearStalledTask(workspaceRoot, nextStory.id);
				HarnessStateManager.clearStoryExecutionStatus(workspaceRoot, nextStory.id);
				activeRunLog = null;
				break;
			}
			log(`❌ Story ${nextStory.id} failed: ${errMsg}`);
			activeRunLog?.recordEvent({
				phase: 'finalization',
				category: 'diagnostic',
				kind: 'failure',
				title: 'execution-failed',
				summary: `Story ${nextStory.id} failed.`,
				details: [errMsg],
			});
			const failedCheckpoint = ensureExecutionCheckpointPersistence(nextStory, workspaceRoot, {
				status: 'failed',
				failureMessage: errMsg,
			});

			// Always release the inprogress lock so the loop can advance
			HarnessStateManager.setCompleted(workspaceRoot, nextStory.id);
			HarnessStateManager.setStoryExecutionStatus(workspaceRoot, nextStory.id, 'failed');

			activeRunLog?.finalize('failed', `Story ${nextStory.id} failed with an unrecovered error.`);
			vscode.window.showErrorMessage(`HARNESS：${nextStory.id} 执行失败，已停止自动运行。`);
			break;
		} finally {
			clearPolicyBaseline(workspaceRoot, nextStory.id);
			activeRunLog = null;
		}

		loopsExecuted++;

		// Small delay to let VS Code settle
		await sleep(config.LOOP_DELAY_MS);
	}

	if (loopsExecuted >= config.MAX_AUTONOMOUS_LOOPS && isRunning) {
		log(`Reached MAX_AUTONOMOUS_LOOPS (${config.MAX_AUTONOMOUS_LOOPS}). Pausing. Run 'HARNESS: Start' to continue.`);
		vscode.window.showInformationMessage(languagePack.runtime.pausedAfterLoops(config.MAX_AUTONOMOUS_LOOPS));
	}

	isRunning = false;
	cancelToken = null;
	updateStatusBar('idle');
}

async function stopHarnessRunner(): Promise<void> {
	const languagePack = getLanguagePack();
	if (!isRunning) {
		vscode.window.showInformationMessage(languagePack.runtime.notRunning);
		return;
	}
	cancelToken?.cancel();
	isRunning = false;
	const stoppedExternalSession = await stopActiveClineSession();
	if (stoppedExternalSession) {
		log('Harness Runner stopped by user. Active Cline task cancellation requested.');
	} else {
		log('Harness Runner stopped by user.');
	}
	vscode.window.showInformationMessage(languagePack.runtime.stopped);
	updateStatusBar('idle');
}

async function refreshSourceContextIndexCommand(): Promise<void> {
	const languagePack = getLanguagePack();
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage(languagePack.common.noWorkspaceFolder);
		return;
	}

	const result = refreshSourceContextIndexArtifact(workspaceRoot, 'manual refresh');
	if (!result.ok) {
		vscode.window.showErrorMessage(languagePack.sourceContext.failed(result.message));
		return;
	}

	const action = await vscode.window.showInformationMessage(
		languagePack.sourceContext.success(result.filePath),
		languagePack.sourceContext.openIndex,
	);
	if (action === languagePack.sourceContext.openIndex) {
		const document = await vscode.workspace.openTextDocument(result.filePath);
		await vscode.window.showTextDocument(document);
	}
}

async function previewSourceContextRecall(): Promise<void> {
	const languagePack = getLanguagePack();
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage(languagePack.common.noWorkspaceFolder);
		return;
	}

	const stories = getStoriesFromPrd(workspaceRoot);
	if (stories.length === 0) {
		vscode.window.showWarningMessage(languagePack.designContext.noStories);
		return;
	}

	const selection = await vscode.window.showQuickPick(
		stories.map(story => ({
			label: `${story.id} — ${story.title}`,
			description: languagePack.common.statusPriority(getLocalizedStoryStatus(normalizeStoryExecutionStatus(story.status) || 'none', languagePack.language), story.priority),
			story,
		})),
		{ placeHolder: languagePack.sourceContext.previewPlaceholder }
	);

	if (!selection) {
		return;
	}

	const refreshResult = refreshSourceContextIndexArtifact(workspaceRoot, `preview ${selection.story.id}`);
	if (!refreshResult.ok) {
		vscode.window.showErrorMessage(languagePack.sourceContext.failed(refreshResult.message));
		return;
	}

	const index = getSourceContextIndex(workspaceRoot);
	const memoryHints = recallRelatedTaskMemories(workspaceRoot, selection.story, {
		limit: Math.min(getConfig().RECALLED_TASK_MEMORY_LIMIT, 2),
	}).map(match => match.memory);
	const matches = recallRelevantSourceContext(index, selection.story, {
		limit: 5,
		memoryHints,
	});

	outputChannel.show(true);
	log('');
	log(languagePack.sourceContext.previewTitle);
	log(languagePack.sourceContext.previewStory(selection.story.id, selection.story.title));
	if (matches.length === 0) {
		log(`  ${languagePack.sourceContext.noMatches(selection.story.id)}`);
		vscode.window.showInformationMessage(languagePack.sourceContext.noMatches(selection.story.id));
		return;
	}

	for (const match of matches) {
		log(`  ${languagePack.sourceContext.previewScore(match.score)}`);
		log(`  ${languagePack.sourceContext.previewReasons(match.reasons)}`);
		log(`  ${languagePack.sourceContext.previewValue(match.label)}`);
	}

	vscode.window.showInformationMessage(languagePack.sourceContext.previewReady(selection.story.id, matches.length));
}

async function generateAgentMapCommand(): Promise<void> {
	const languagePack = getLanguagePack();
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage(languagePack.common.noWorkspaceFolder);
		return;
	}

	try {
		const result = generateAgentMapArtifacts(workspaceRoot);
		log(`  Agent Map refreshed: ${result.overviewPath.replace(/\\/g, '/')} and ${result.knowledgeCatalogPath.replace(/\\/g, '/')}`);
		const action = await vscode.window.showInformationMessage(
			languagePack.agentMap.success(result.overview.gaps.length),
			languagePack.agentMap.openOverview,
			languagePack.agentMap.openKnowledgeCatalog,
		);
		if (action === languagePack.agentMap.openOverview) {
			const document = await vscode.workspace.openTextDocument(result.overviewPath);
			await vscode.window.showTextDocument(document);
		} else if (action === languagePack.agentMap.openKnowledgeCatalog) {
			const document = await vscode.workspace.openTextDocument(result.knowledgeCatalogPath);
			await vscode.window.showTextDocument(document);
		}
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		log(`  WARNING: Failed to generate Agent Map: ${message}`);
		vscode.window.showErrorMessage(languagePack.agentMap.failed(message));
	}
}

function refreshSourceContextIndexArtifact(
	workspaceRoot: string,
	reason: string,
): { ok: true; filePath: string; } | { ok: false; message: string; } {
	try {
		const index = refreshSourceContextIndex(workspaceRoot);
		const filePath = writeSourceContextIndex(workspaceRoot, index);
		log(`  Source context index refreshed (${reason}): ${filePath.replace(/\\/g, '/')}`);
		return {
			ok: true,
			filePath: resolveSourceContextIndexPath(workspaceRoot),
		};
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		log(`  WARNING: Failed to refresh source context index (${reason}): ${message}`);
		return {
			ok: false,
			message,
		};
	}
}

// ── Story Execution ─────────────────────────────────────────────────────────

interface TaskMemoryPersistenceResult {
	filePath: string;
	source: 'cline' | 'synthesized';
	artifact: TaskMemoryArtifact;
}

interface ExecutionCheckpointPersistenceResult {
	filePath: string;
	source: 'cline' | 'synthesized';
	artifact: ExecutionCheckpointArtifact;
}

interface StoryEvidencePersistenceResult {
	filePath: string;
	source: 'cline' | 'synthesized';
	artifact: StoryEvidenceArtifact;
}

interface StoryReviewPersistenceResult {
	source: 'cline' | 'synthesized';
	artifact: StoryReviewResult;
	loop: StoryReviewLoopState;
}

interface StoryExecutionArtifacts {
	taskMemory: TaskMemoryPersistenceResult;
	checkpoint: ExecutionCheckpointPersistenceResult;
	evidence: StoryEvidencePersistenceResult;
}

function getPolicyAutoFixRounds(): number {
	return vscode.workspace.getConfiguration('harness-runner').get<number>('policyGateAutoFixRounds', 1);
}


interface PolicyAutoFixResult {
	ok: boolean;
	summary?: string;
	rounds: number;
}

async function runCompletionPolicyWithAutoFix(
	story: UserStory,
	workspaceRoot: string,
	maxRounds: number,
): Promise<PolicyAutoFixResult> {
	let rounds = 0;
	let lastResult = evaluateCompletionPolicyGates(workspaceRoot, story);

	while (!lastResult.ok && rounds < maxRounds) {
		const hasRemediableViolations = lastResult.violations.some(v => v.remediable !== false);
		if (!hasRemediableViolations) {
			log(`  Policy violations for ${story.id} are not auto-fixable; aborting auto-fix loop.`);
			for (const line of summarizePolicyViolations(lastResult)) {
				log(`  ${line}`);
			}
			return { ok: false, summary: lastResult.violations.map(v => v.summary).join('; '), rounds };
		}

		rounds += 1;
		log(`  Policy auto-fix round ${rounds}/${maxRounds} for ${story.id}.`);
		activeRunLog?.recordEvent({
			phase: 'completion-gates',
			category: 'diagnostic',
			kind: 'failure',
			title: 'policy-auto-fix',
			summary: `Attempting policy auto-fix round ${rounds}/${maxRounds} for ${story.id}.`,
			details: lastResult.violations.map(v => v.summary),
		});

		const fixPrompt = buildPromptForPolicyFix(story, workspaceRoot, lastResult);
		await sendToCline(fixPrompt, story.id, workspaceRoot);

		// Re-evaluate after the fix
		lastResult = evaluateCompletionPolicyGates(workspaceRoot, story);
		if (lastResult.ok) {
			log(`  Policy auto-fix round ${rounds} succeeded for ${story.id}.`);
			activeRunLog?.recordEvent({
				phase: 'completion-gates',
				category: 'signal',
				kind: 'summary',
				title: 'policy-auto-fix-success',
				summary: `Policy auto-fix round ${rounds} succeeded for ${story.id}.`,
				details: [],
			});
			return { ok: true, rounds };
		}
	}

	if (!lastResult.ok) {
		log(`  Policy auto-fix failed after ${rounds} rounds for ${story.id}.`);
		for (const line of summarizePolicyViolations(lastResult)) {
			log(`  ${line}`);
		}
	}

	return { ok: lastResult.ok, summary: lastResult.ok ? undefined : lastResult.violations.map(v => v.summary).join('; '), rounds };
}

function buildPromptForPolicyFix(story: UserStory, workspaceRoot: string, policyResult: ReturnType<typeof evaluateCompletionPolicyGates>): string {
	const languagePack = getLanguagePack();
	const violationSummary = policyResult.violations.map(v => {
		const lines = [`Rule: ${v.ruleId} - ${v.title}`, `Summary: ${v.summary}`];
		for (const detail of v.details) {
			lines.push(`  Detail: ${detail}`);
		}
		for (const nextStep of v.nextSteps) {
			lines.push(`  Next Step: ${nextStep}`);
		}
		return lines.join('\n');
	}).join('\n\n');

	return [
		languagePack.language === 'Chinese' ? '门禁校验失败，请修复以下问题：' : 'Policy gate failed. Please fix the following issues:',
		'',
		violationSummary,
		'',
		languagePack.language === 'Chinese' ? '修复完成后，确保所有相关的工件都已更新，并重新写出完成信号。' : 'After fixing, ensure all related artifacts are updated and the completion signal is written again.',
	].join('\n');
}

async function executeStory(story: UserStory, workspaceRoot: string): Promise<{
	taskMemory: TaskMemoryPersistenceResult;
	checkpoint: ExecutionCheckpointPersistenceResult;
	evidence: StoryEvidencePersistenceResult;
	review: StoryReviewPersistenceResult;
}> {
	const prompt = buildClinePromptForStory(story, workspaceRoot);
	const config = getConfig();
	activeRunLog?.recordEvent({
		phase: 'execution',
		category: 'signal',
		kind: 'summary',
		title: 'prompt-composed',
		summary: `Execution prompt composed for ${story.id}.`,
		details: [`length=${prompt.length}`],
	});
	log(`  Delegating user story to Cline...`);
	await sendToCline(prompt, story.id, workspaceRoot);

	const policyAutoFixRounds = getPolicyAutoFixRounds();
	const completionResult = await runCompletionPolicyWithAutoFix(story, workspaceRoot, policyAutoFixRounds);
	if (!completionResult.ok) {
		throw new Error(`Policy gates blocked completion for ${story.id}: ${completionResult.summary}`);
	}

	activeRunLog?.transitionPhase('artifact-persistence', `Persisting story artifacts for ${story.id}.`);
	let artifacts = refreshStoryExecutionArtifacts(story, workspaceRoot);
	log(`  Task memory ready for ${story.id}: ${artifacts.taskMemory.filePath} (${artifacts.taskMemory.source})`);
	log(`  Execution checkpoint ready for ${story.id}: ${artifacts.checkpoint.filePath} (${artifacts.checkpoint.source})`);
	log(`  Story evidence ready for ${story.id}: ${artifacts.evidence.filePath} (${artifacts.evidence.source})`);
	if (!config.ENABLE_REVIEWER_LOOP) {
		log(`  Reviewer loop disabled for workspace; skipping reviewer pass for ${story.id}.`);
		const reviewResult = ensureStoryReviewPersistence(story, workspaceRoot, artifacts, {
			reviewPass: 1,
			autoRefactorRounds: 0,
			maxAutoRefactorRounds: config.MAX_AUTO_REFACTOR_ROUNDS,
			passingScore: config.REVIEW_PASSING_SCORE,
			allowMissingReview: true,
			skipReason: 'Reviewer loop disabled in workspace settings.',
		});
		artifacts = reviewResult.artifacts;
		return {
			taskMemory: artifacts.taskMemory,
			checkpoint: artifacts.checkpoint,
			evidence: artifacts.evidence,
			review: reviewResult.review,
		};
	}

	HarnessStateManager.setStoryExecutionStatus(workspaceRoot, story.id, 'pendingReview');
	log(`  Story ${story.id} moved into Reviewer Agent pass.`);
	activeRunLog?.transitionPhase('review', `Story ${story.id} moved into Reviewer Agent pass.`);

	const reviewResult = await runReviewerAndAutoRefactorLoop(story, workspaceRoot, artifacts, config);
	artifacts = reviewResult.artifacts;
	return {
		taskMemory: artifacts.taskMemory,
		checkpoint: artifacts.checkpoint,
		evidence: artifacts.evidence,
		review: reviewResult.review,
	};
}

function refreshStoryExecutionArtifacts(story: UserStory, workspaceRoot: string): StoryExecutionArtifacts {
	const taskMemory = ensureTaskMemoryPersistence(story, workspaceRoot);
	const checkpoint = ensureExecutionCheckpointPersistence(story, workspaceRoot, {
		status: 'completed',
		taskMemory: taskMemory.artifact,
	});
	const evidence = ensureStoryEvidencePersistence(story, workspaceRoot, {
		taskMemory: taskMemory.artifact,
		checkpoint: checkpoint.artifact,
	});

	return { taskMemory, checkpoint, evidence };
}

async function runReviewerAndAutoRefactorLoop(
	story: UserStory,
	workspaceRoot: string,
	initialArtifacts: StoryExecutionArtifacts,
	config = getConfig(),
): Promise<{
	artifacts: StoryExecutionArtifacts;
	review: StoryReviewPersistenceResult;
}> {
	let artifacts = initialArtifacts;
	let autoRefactorRounds = 0;
	let latestReview: StoryReviewPersistenceResult | null = null;
	const maxReviewerPasses = deriveMaxReviewerPasses(config.MAX_AUTO_REFACTOR_ROUNDS);

	for (let reviewPass = 1; reviewPass <= maxReviewerPasses; reviewPass++) {
		setTaskInProgressForFollowUpPass(workspaceRoot, story.id, 'pendingReview');
		log(`  Launching Reviewer Agent pass ${reviewPass}/${maxReviewerPasses} for ${story.id}.`);
		activeRunLog?.transitionPhase('review', `Launching reviewer pass ${reviewPass}/${maxReviewerPasses} for ${story.id}.`);
		await sendToCline(
			buildReviewerPromptForStory(story, workspaceRoot, artifacts, reviewPass),
			story.id,
			workspaceRoot,
		);

		artifacts = refreshStoryExecutionArtifacts(story, workspaceRoot);
		const persistedReview = ensureStoryReviewPersistence(story, workspaceRoot, artifacts, {
			reviewPass,
			autoRefactorRounds,
			maxAutoRefactorRounds: config.MAX_AUTO_REFACTOR_ROUNDS,
			passingScore: config.REVIEW_PASSING_SCORE,
		});
		artifacts = persistedReview.artifacts;
		latestReview = persistedReview.review;
		log(`  Reviewer Agent scored ${story.id} at ${latestReview.artifact.totalScore}/${latestReview.artifact.maxScore}.`);
		activeRunLog?.recordReview(latestReview.artifact, latestReview.loop, latestReview.source);

		if (latestReview.artifact.passed) {
			log(`  Reviewer Agent accepted ${story.id} after pass ${reviewPass}.`);
			return { artifacts, review: latestReview };
		}

		if (autoRefactorRounds >= config.MAX_AUTO_REFACTOR_ROUNDS || reviewPass >= maxReviewerPasses) {
			log(`  Reviewer Agent reached the maximum automatic refactor limit for ${story.id}.`);
			return { artifacts, review: latestReview };
		}

		const nextRefactorRound = autoRefactorRounds + 1;
		setTaskInProgressForFollowUpPass(workspaceRoot, story.id, 'inprogress');
		log(`  Launching Executor Agent auto-refactor round ${nextRefactorRound}/${config.MAX_AUTO_REFACTOR_ROUNDS} for ${story.id}.`);
		activeRunLog?.transitionPhase('refactor', `Launching auto-refactor round ${nextRefactorRound}/${config.MAX_AUTO_REFACTOR_ROUNDS} for ${story.id}.`);
		activeRunLog?.recordRefactorRound(nextRefactorRound, config.MAX_AUTO_REFACTOR_ROUNDS, `Reviewer findings triggered an automatic refactor for ${story.id}.`);
		await sendToCline(
			buildRefactorPromptForStory(story, workspaceRoot, artifacts, latestReview, nextRefactorRound, config),
			story.id,
			workspaceRoot,
		);

		autoRefactorRounds = nextRefactorRound;
		const completionPolicyResult = evaluateCompletionPolicyGates(workspaceRoot, story);
		if (!completionPolicyResult.ok) {
			throw new Error(`Policy gates blocked completion for ${story.id} after auto-refactor round ${autoRefactorRounds}`);
		}
		artifacts = refreshStoryExecutionArtifacts(story, workspaceRoot);
	}

	const fallbackResult = latestReview
		? { artifacts, review: latestReview }
		: ensureStoryReviewPersistence(story, workspaceRoot, artifacts, {
		reviewPass: 1,
		autoRefactorRounds,
		maxAutoRefactorRounds: config.MAX_AUTO_REFACTOR_ROUNDS,
		passingScore: config.REVIEW_PASSING_SCORE,
	});
	return {
		artifacts: fallbackResult.artifacts,
		review: fallbackResult.review,
	};
}

function setTaskInProgressForFollowUpPass(
	workspaceRoot: string,
	storyId: string,
	status: Extract<StoryExecutionStatus, 'inprogress' | 'pendingReview'>,
): void {
	HarnessStateManager.setInProgress(workspaceRoot, storyId);
	HarnessStateManager.setStoryExecutionStatus(workspaceRoot, storyId, status);
}

// ── Cline Integration ───────────────────────────────────────────────────────

function buildClinePromptForStory(story: UserStory, workspaceRoot: string): string {
	const projectConstraintsLines = getProjectConstraintsPromptLines(workspaceRoot, story.id);
	const designContextLines = getDesignContextPromptLines(workspaceRoot, story);
	const priorWorkLines = getPriorWorkPromptLines(workspaceRoot, story);
	const sourceContextLines = getSourceContextPromptLines(workspaceRoot, story);
	const knowledgeLines = getKnowledgePromptLines(workspaceRoot, story);
	const recentCheckpointLines = getRecentCheckpointPromptLines(workspaceRoot, story);
	const policyLines = getPolicyPromptLines();
	const additionalExecutionRules = [
		'Greedily execute as many sub-tasks as possible in a single pass.',
		'If something partially fails, keep all the parts that passed and do not revert them.',
		'Do not ask questions — execute directly.',
		'Make the actual code changes to the files in the workspace.',
		'Follow an explicit plan -> execute -> checkpoint -> reset workflow for each story handoff.',
		'Each story execution starts in a fresh agent session; do not rely on implicit context from previous sessions.',
		'If a Recent Checkpoint section is present, treat it as the authoritative short handoff from the previous execution state.',
		...getGitExecutionRules(workspaceRoot),
	];

	return composeStoryExecutionPrompt({
		story,
		workspaceRoot,
		projectConstraintsLines,
		designContextLines,
		priorWorkLines,
		sourceContextLines,
		knowledgeLines,
		recentCheckpointLines,
		policyLines,
		taskMemoryPath: resolveTaskMemoryPath(workspaceRoot, story.id).replace(/\\/g, '/'),
		executionCheckpointPath: resolveExecutionCheckpointPath(workspaceRoot, story.id).replace(/\\/g, '/'),
		evidencePath: resolveStoryEvidencePath(workspaceRoot, story.id).replace(/\\/g, '/'),
		completionSignalPath: resolveStoryStatusRegistryPath(workspaceRoot).replace(/\\/g, '/'),
		completionSignalKey: story.id,
		additionalExecutionRules,
	});
}

function buildReviewerPromptForStory(
	story: UserStory,
	workspaceRoot: string,
	artifacts: StoryExecutionArtifacts,
	reviewPass: number,
	config = getConfig(),
): string {
	return composeStoryReviewerPrompt({
		story,
		workspaceRoot,
		reviewPass,
		maxReviewerPasses: deriveMaxReviewerPasses(config.MAX_AUTO_REFACTOR_ROUNDS),
		maxAutoRefactorRounds: config.MAX_AUTO_REFACTOR_ROUNDS,
		passingScore: config.REVIEW_PASSING_SCORE,
		taskMemoryPath: resolveTaskMemoryPath(workspaceRoot, story.id).replace(/\\/g, '/'),
		executionCheckpointPath: resolveExecutionCheckpointPath(workspaceRoot, story.id).replace(/\\/g, '/'),
		evidencePath: resolveStoryEvidencePath(workspaceRoot, story.id).replace(/\\/g, '/'),
		completionSignalPath: resolveStoryStatusRegistryPath(workspaceRoot).replace(/\\/g, '/'),
		completionSignalKey: story.id,
		taskMemoryLines: summarizeTaskMemoryForPrompt(artifacts.taskMemory.artifact),
		checkpointLines: summarizeExecutionCheckpointForPrompt(artifacts.checkpoint.artifact),
		evidenceLines: summarizeStoryEvidenceForPrompt(artifacts.evidence.artifact),
		reviewLoopLines: summarizeCurrentReviewLoop(artifacts),
	});
}

function buildRefactorPromptForStory(
	story: UserStory,
	workspaceRoot: string,
	artifacts: StoryExecutionArtifacts,
	review: StoryReviewPersistenceResult,
	refactorRound: number,
	config = getConfig(),
): string {
	return composeStoryRefactorPrompt({
		story,
		workspaceRoot,
		refactorRound,
		maxAutoRefactorRounds: config.MAX_AUTO_REFACTOR_ROUNDS,
		reviewPass: review.artifact.reviewPass,
		reviewSummaryLines: summarizeStoryReviewForPrompt(review.artifact),
		taskMemoryPath: resolveTaskMemoryPath(workspaceRoot, story.id).replace(/\\/g, '/'),
		executionCheckpointPath: resolveExecutionCheckpointPath(workspaceRoot, story.id).replace(/\\/g, '/'),
		evidencePath: resolveStoryEvidencePath(workspaceRoot, story.id).replace(/\\/g, '/'),
		completionSignalPath: resolveStoryStatusRegistryPath(workspaceRoot).replace(/\\/g, '/'),
		completionSignalKey: story.id,
		taskMemoryLines: summarizeTaskMemoryForPrompt(artifacts.taskMemory.artifact),
		checkpointLines: summarizeExecutionCheckpointForPrompt(artifacts.checkpoint.artifact),
		evidenceLines: summarizeStoryEvidenceForPrompt(artifacts.evidence.artifact),
	});
}

function isGitRepository(workspaceRoot: string): boolean {
	try {
		const output = execSync('git rev-parse --is-inside-work-tree', {
			cwd: workspaceRoot,
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
		return output === 'true';
	} catch {
		return false;
	}
}

function shouldAutoCommitGit(workspaceRoot: string): boolean {
	const config = getConfig();
	return config.AUTO_COMMIT_GIT && isGitRepository(workspaceRoot);
}

function getGitExecutionRules(workspaceRoot: string): string[] {
	if (!shouldAutoCommitGit(workspaceRoot)) {
		return [];
	}

	return [
		'This workspace is inside a Git repository and automatic Git commit is enabled.',
		'If you make meaningful changes for this story, stage the relevant files and create one conventional commit for this story before writing the completion signal.',
		'Reuse the project constraint Git rules for commit language and format. Do not create or wait for a separate Git commit story.',
	];
}

function getProjectConstraintsPromptLines(workspaceRoot: string, storyId: string): string[] {
	const config = getConfig();
	if (!config.AUTO_INJECT_PROJECT_CONSTRAINTS) {
		log(`  Project constraints injection disabled by settings for story ${storyId}.`);
		activeRunLog?.recordContextInjection({
			name: 'project-constraints',
			lineCount: 0,
			injected: false,
			summary: 'Project constraints injection was disabled by settings.',
			details: [storyId],
		});
		return [];
	}

	if (!hasProjectConstraintsArtifacts(workspaceRoot)) {
		log(`  Project constraints not initialized for story ${storyId}; continuing without injected constraints.`);
		activeRunLog?.recordContextInjection({
			name: 'project-constraints',
			lineCount: 0,
			injected: false,
			summary: 'Project constraints artifacts were missing, so nothing was injected.',
			details: [storyId],
		});
		return [];
	}

	try {
		const mergedConstraints = loadMergedProjectConstraints(workspaceRoot);
		const promptLines = summarizeProjectConstraintsForPrompt(mergedConstraints);
		if (promptLines.length === 0) {
			log(`  Project constraints loaded for story ${storyId}, but no normalized prompt lines were produced.`);
			activeRunLog?.recordContextInjection({
				name: 'project-constraints',
				lineCount: 0,
				injected: false,
				summary: 'Project constraints loaded but produced no prompt lines.',
				details: [storyId],
			});
			return [];
		}

		log(`  Injecting ${promptLines.length} project constraint prompt lines for story ${storyId}.`);
		activeRunLog?.recordContextInjection({
			name: 'project-constraints',
			lineCount: promptLines.length,
			injected: true,
			summary: `Injected ${promptLines.length} project constraint prompt lines.`,
			details: [],
		});
		return promptLines;
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		log(`  WARNING: Failed to load project constraints for story ${storyId}: ${message}`);
		activeRunLog?.recordContextInjection({
			name: 'project-constraints',
			lineCount: 0,
			injected: false,
			summary: 'Project constraints injection failed.',
			details: [message],
		});
		return [];
	}
}

function getDesignContextPromptLines(workspaceRoot: string, story: UserStory): string[] {
	const config = getConfig();
	if (!config.AUTO_INJECT_DESIGN_CONTEXT) {
		log(`  Design context injection disabled by settings for story ${story.id}.`);
		activeRunLog?.recordContextInjection({
			name: 'design-context',
			lineCount: 0,
			injected: false,
			summary: 'Design context injection was disabled by settings.',
			details: [story.id],
		});
		return [];
	}

	const hasStoryContext = hasStoryLevelDesignContext(workspaceRoot, story.id);
	if (!hasStoryContext && isDesignSensitiveStory(story)) {
		const sharedContext = resolveSharedDesignContextForStory(workspaceRoot, story);
		const promptLines = synthesizeExecutionDesignContextPromptLines(story, sharedContext);
		if (promptLines.length > 0) {
			log(`  Synthesized ${promptLines.length} execution-time design context prompt lines for story ${story.id}.`);
			activeRunLog?.recordContextInjection({
				name: 'design-context',
				lineCount: promptLines.length,
				injected: true,
				summary: `Synthesized ${promptLines.length} execution-time design context prompt lines.`,
				details: ['execution-time fallback'],
			});
			return promptLines;
		}
	}

	const designContext = resolveDesignContextForStory(workspaceRoot, story);
	if (!designContext) {
		log(`  No design context found for story ${story.id}; continuing without injected design guidance.`);
		activeRunLog?.recordContextInjection({
			name: 'design-context',
			lineCount: 0,
			injected: false,
			summary: 'No design context was found for this story.',
			details: [story.id],
		});
		return [];
	}

	const validation = validateDesignContext(designContext, story.id);
	if (!validation.isValid) {
		log(`  Design context for story ${story.id} has validation warnings: ${validation.errors.join(' | ')}`);
	}

	const promptLines = summarizeDesignContextForPrompt(validation.artifact);
	if (promptLines.length === 0) {
		log(`  Design context loaded for story ${story.id}, but no prompt lines were produced.`);
		activeRunLog?.recordContextInjection({
			name: 'design-context',
			lineCount: 0,
			injected: false,
			summary: 'Design context loaded but produced no prompt lines.',
			details: [story.id],
		});
		return [];
	}

	log(`  Injecting ${promptLines.length} design context prompt lines for story ${story.id}.`);
	activeRunLog?.recordContextInjection({
		name: 'design-context',
		lineCount: promptLines.length,
		injected: true,
		summary: `Injected ${promptLines.length} design context prompt lines.`,
		details: validation.isValid ? [] : validation.errors,
	});
	return promptLines;
}

function getPriorWorkPromptLines(workspaceRoot: string, story: UserStory): string[] {
	const config = getConfig();
	if (!config.AUTO_RECALL_TASK_MEMORY) {
		log(`  Prior-work recall disabled by settings for story ${story.id}.`);
		activeRunLog?.recordContextInjection({
			name: 'prior-work',
			lineCount: 0,
			injected: false,
			summary: 'Prior-work recall was disabled by settings.',
			details: [story.id],
		});
		return [];
	}

	const matches = recallRelatedTaskMemories(workspaceRoot, story, {
		limit: config.RECALLED_TASK_MEMORY_LIMIT,
	});
	if (matches.length === 0) {
		log(`  No related task memories found for story ${story.id}; continuing without prior-work context.`);
		activeRunLog?.recordContextInjection({
			name: 'prior-work',
			lineCount: 0,
			injected: false,
			summary: 'No related task memories were recalled.',
			details: [story.id],
		});
		return [];
	}

	const promptLines = summarizeRecalledTaskMemoriesForPrompt(matches, config.RECALLED_TASK_MEMORY_LIMIT);
	log(`  Injecting ${matches.length} recalled task memories for story ${story.id}.`);
	activeRunLog?.recordContextInjection({
		name: 'prior-work',
		lineCount: promptLines.length,
		injected: true,
		summary: `Injected ${matches.length} recalled task memories.`,
		details: matches.slice(0, 3).map(match => match.memory.storyId),
	});
	return promptLines;
}

function getSourceContextPromptLines(workspaceRoot: string, story: UserStory): string[] {
	const index = getSourceContextIndex(workspaceRoot);
	if (!index) {
		log(`  Source context index missing for story ${story.id}; continuing without source context recall.`);
		activeRunLog?.recordContextInjection({
			name: 'source-context',
			lineCount: 0,
			injected: false,
			summary: 'Source context index was missing.',
			details: [story.id],
		});
		return [];
	}

	const memoryHints = recallRelatedTaskMemories(workspaceRoot, story, {
		limit: Math.min(getConfig().RECALLED_TASK_MEMORY_LIMIT, 2),
	}).map(match => match.memory);
	const matches = recallRelevantSourceContext(index, story, {
		limit: 4,
		memoryHints,
	});
	if (matches.length === 0) {
		log(`  No source context recall matches found for story ${story.id}; continuing without source context prompt lines.`);
		activeRunLog?.recordContextInjection({
			name: 'source-context',
			lineCount: 0,
			injected: false,
			summary: 'No source-context recall matches were found.',
			details: [story.id],
		});
		return [];
	}

	const promptLines = summarizeRecalledSourceContextForPrompt(matches, 4);
	log(`  Injecting ${matches.length} recalled source context matches for story ${story.id}.`);
	activeRunLog?.recordContextInjection({
		name: 'source-context',
		lineCount: promptLines.length,
		injected: true,
		summary: `Injected ${matches.length} recalled source-context matches.`,
		details: matches.slice(0, 4).map(match => `${match.category}:${match.value}`),
	});
	return promptLines;
}

function getKnowledgePromptLines(workspaceRoot: string, story: UserStory): string[] {
	const report = getKnowledgeCheckReportSafe(workspaceRoot, {
		scope: 'run-preflight',
		story,
	});
	if (report.issues.length === 0) {
		log(`  Knowledge checks found no freshness or coverage issues for story ${story.id}.`);
		activeRunLog?.recordContextInjection({
			name: 'knowledge-check',
			lineCount: 0,
			injected: false,
			summary: 'Knowledge checks found no issues to inject.',
			details: [story.id],
		});
		return [];
	}

	log(`  Knowledge checks found ${report.issues.length} issue(s) for story ${story.id}.`);
	const promptLines = summarizeKnowledgeCheckForPrompt(report);
	activeRunLog?.recordContextInjection({
		name: 'knowledge-check',
		lineCount: promptLines.length,
		injected: true,
		summary: `Injected ${report.issues.length} knowledge-check issue(s).`,
		details: report.issues.slice(0, 3).map(issue => issue.summary),
	});
	return promptLines;
}

function getRecentCheckpointPromptLines(workspaceRoot: string, story: UserStory): string[] {
	const validCheckpointCount = listValidExecutionCheckpoints(workspaceRoot).length;
	if (validCheckpointCount === 0) {
		log(`  No execution checkpoints found for story ${story.id}; continuing with a fresh chat and no checkpoint handoff.`);
		activeRunLog?.recordContextInjection({
			name: 'recent-checkpoint',
			lineCount: 0,
			injected: false,
			summary: 'No prior execution checkpoint was available to inject.',
			details: [story.id],
		});
		return [];
	}

	const checkpoint = getRecentExecutionCheckpoint(workspaceRoot, { preferredStoryId: story.id });
	if (!checkpoint) {
		log(`  Execution checkpoints exist, but none were valid for story ${story.id}; skipping checkpoint injection.`);
		activeRunLog?.recordContextInjection({
			name: 'recent-checkpoint',
			lineCount: 0,
			injected: false,
			summary: 'Execution checkpoints existed but none were valid for injection.',
			details: [story.id],
		});
		return [];
	}

	const promptLines = summarizeExecutionCheckpointForPrompt(checkpoint);
	if (promptLines.length === 0) {
		log(`  Recent checkpoint for story ${story.id} produced no prompt lines; skipping checkpoint injection.`);
		activeRunLog?.recordContextInjection({
			name: 'recent-checkpoint',
			lineCount: 0,
			injected: false,
			summary: 'Recent checkpoint resolved but produced no prompt lines.',
			details: [checkpoint.storyId],
		});
		return [];
	}

	log(`  Injecting recent checkpoint from ${checkpoint.storyId} (${checkpoint.status}) for story ${story.id}.`);
	activeRunLog?.recordContextInjection({
		name: 'recent-checkpoint',
		lineCount: promptLines.length,
		injected: true,
		summary: `Injected recent checkpoint from ${checkpoint.storyId}.`,
		details: [checkpoint.status],
	});
	return promptLines;
}

function getPolicyPromptLines(): string[] {
	const promptLines = summarizePolicyConfigForPrompt(getEffectivePolicyConfig());
	if (promptLines.length > 0) {
		log(`  Injecting ${promptLines.length} machine policy prompt lines.`);
		activeRunLog?.recordContextInjection({
			name: 'policy-gates',
			lineCount: promptLines.length,
			injected: true,
			summary: `Injected ${promptLines.length} machine policy prompt lines.`,
			details: promptLines.slice(0, 3),
		});
	} else {
		activeRunLog?.recordContextInjection({
			name: 'policy-gates',
			lineCount: 0,
			injected: false,
			summary: 'No machine policy prompt lines were active.',
			details: [],
		});
	}
	return promptLines;
}

function getMissingRequiredDesignContextReason(workspaceRoot: string, story: UserStory): string | null {
	const config = getConfig();
	if (getEffectivePolicyConfig().enabled) {
		return null;
	}
	if (!config.REQUIRE_DESIGN_CONTEXT_FOR_TAGGED_STORIES) {
		return null;
	}

	if (!isDesignSensitiveStory(story)) {
		return null;
	}

	if (hasAnyDesignContextForStory(workspaceRoot, story)) {
		return null;
	}

	if (synthesizeExecutionDesignContextPromptLines(story, null).length > 0) {
		return null;
	}

	return getLanguagePack().runtime.designContextRequiredBeforeStory(story.id);
}

function isDesignSensitiveStory(story: UserStory): boolean {
	const tags = extractStoryTags(story);
	if (tags.some(tag => DESIGN_SENSITIVE_TAGS.has(tag))) {
		return true;
	}

	const searchableText = [story.title, story.description, ...story.acceptanceCriteria]
		.filter((value): value is string => typeof value === 'string')
		.join(' ')
		.toLowerCase();

	return DESIGN_SENSITIVE_KEYWORDS.some(keyword => searchableText.includes(keyword));
}

function extractStoryTags(story: UserStory): string[] {
	const values: string[] = [];
	for (const key of ['tags', 'labels', 'categories']) {
		const rawValue = story[key];
		if (!Array.isArray(rawValue)) {
			continue;
		}

		for (const item of rawValue) {
			if (typeof item === 'string' && item.trim().length > 0) {
				values.push(item.trim().toLowerCase());
			}
		}
	}

	return Array.from(new Set(values));
}

const DESIGN_SENSITIVE_TAGS = new Set(['design', 'ui', 'ux', 'frontend', 'visual', 'figma']);

const DESIGN_SENSITIVE_KEYWORDS = ['design', 'figma', 'layout', 'responsive', 'ui', 'ux', 'visual', 'token', 'spacing'];

async function getClineApi(): Promise<ClineAPI | null> {
	const clineExtension = vscode.extensions.getExtension<ClineAPI>('saoudrizwan.claude-dev');
	if (!clineExtension) {
		return null;
	}

	if (!clineExtension.isActive) {
		try {
			await clineExtension.activate();
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			log(`WARNING: Failed to activate Cline extension (${message})`);
			return null;
		}
	}

	return clineExtension.exports ?? null;
}

async function stopActiveClineSession(): Promise<boolean> {
	if (!activeClineSessionStartedAt) {
		return false;
	}

	activeClineSessionStartedAt = null;

	const cline = await getClineApi();
	if (!cline) {
		return false;
	}

	try {
		// Try to send a stop message first (more reliable for stopping current task)
		if (cline.sendMessage) {
			await cline.sendMessage('STOP');
		}
		// Also press the secondary button (stop button)
		if (cline.pressSecondaryButton) {
			await cline.pressSecondaryButton();
		}
		await cline.startNewTask(""); // Ensure a fresh task to fully clear context
		return true;
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		log(`WARNING: Failed to stop active Cline task (${message})`);
		return false;
	}
}

async function openClineWithPrompt(prompt: string, copiedPromptMessage?: string, options?: { startNewChat?: boolean }): Promise<boolean> {
	async function tryExecuteVsCodeCommand(commandId: string, ...args: unknown[]): Promise<boolean> {
		try {
			await vscode.commands.executeCommand(commandId, ...args);
			return true;
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			log(`WARNING: Cline command failed: ${commandId} (${message})`);
			return false;
		}
	}

	const cline = await getClineApi();
	if (cline) {
		try {
			if (options?.startNewChat || !activeClineSessionStartedAt) {
				await cline.startNewTask(prompt);
			} else if (cline.sendMessage) {
				await cline.sendMessage(prompt);
			} else {
				await cline.startNewTask(prompt);
			}

			activeClineSessionStartedAt = Date.now();
			return true;
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			log(`WARNING: Cline API prompt dispatch failed (${message}); falling back to command automation.`);
		}
	}

	await vscode.env.clipboard.writeText(prompt);
	const sidebarOpened = await tryExecuteVsCodeCommand('claude-dev.SidebarProvider.focus');
	await sleep(150);

	if (options?.startNewChat) {
		await tryExecuteVsCodeCommand('cline.plusButtonClicked');
		await sleep(200);
	}

	const inputFocused = await tryExecuteVsCodeCommand('cline.focusChatInput');
	if (!sidebarOpened || !inputFocused) {
		vscode.window.showWarningMessage('HARNESS: Cline 未就绪或未安装。提示词已复制到剪贴板，请安装并启用 Cline。');
		return false;
	}

	if (copiedPromptMessage) {
		vscode.window.showInformationMessage(copiedPromptMessage);
	}
	return false;
}

async function openClineTaskWithPrompt(prompt: string, copiedPromptMessage?: string, options?: { startNewChat?: boolean }): Promise<boolean> {
	return openClineWithPrompt(prompt, copiedPromptMessage, options);
}

async function sendToCline(prompt: string, taskId: string, workspaceRoot: string): Promise<void> {
	log('  Resetting Cline session before story execution...');
	log('  Sending prompt to Cline...');
	try {
		await openClineTaskWithPrompt(prompt, undefined, { startNewChat: true });

		await waitForClineCompletion(taskId, workspaceRoot);
	} finally {
		activeClineSessionStartedAt = null;
	}
}

export function shouldAbortClineWait(
	isCancellationRequested: boolean,
	requireRunnerActive: boolean,
	runnerIsActive: boolean,
): boolean {
	if (isCancellationRequested) {
		return true;
	}

	if (requireRunnerActive && !runnerIsActive) {
		return true;
	}

	return false;
}

interface ClineCompletionWaitOptions {
	requireRunnerActive?: boolean;
}

/**
	* Polls .harness-runner/story-status.json until Cline writes "completed" to the task entry.
	* Enforces a minimum wait before checking so that Cline
 * has time to begin working before the first read.
 * Throws if the timeout is exceeded without seeing "completed".
 */
async function waitForClineCompletion(
	taskId: string,
	workspaceRoot: string,
	options?: ClineCompletionWaitOptions,
): Promise<void> {
	const config = getConfig();
	const requireRunnerActive = options?.requireRunnerActive ?? true;
	log(`  Waiting for Cline to write "completed" to .harness-runner/story-status.json[${taskId}]...`);

	const startTime = Date.now();

	while (Date.now() - startTime < config.EXECUTION_TIMEOUT_MS) {
		if (shouldAbortClineWait(Boolean(cancelToken?.token.isCancellationRequested), requireRunnerActive, isRunning)) {
			throw new Error('Cancelled by user');
		}

		await sleep(config.EXECUTION_RESPONSE_POLL_MS);
		if (shouldAbortClineWait(Boolean(cancelToken?.token.isCancellationRequested), requireRunnerActive, isRunning)) {
			throw new Error('Cancelled by user');
		}
		const elapsed = Date.now() - startTime;

		// Enforce a minimum wait before the first status check
		if (elapsed < config.EXECUTION_MIN_WAIT_MS) {
			log(`  … minimum wait in progress (${Math.round(elapsed / 1000)}s / ${Math.round(config.EXECUTION_MIN_WAIT_MS / 1000)}s)`);
			continue;
		}

		const status = HarnessStateManager.getTaskSignalStatus(workspaceRoot, taskId);
		if (status === 'completed') {
			log(`  ✓ Cline wrote "completed" to .harness-runner/story-status.json[${taskId}] (elapsed ${Math.round(elapsed / 1000)}s); validating artifacts next.`);
			return;
		}

		log(`  … still waiting for Cline to complete task ${taskId} (status: ${status}, elapsed ${Math.round(elapsed / 1000)}s)`);
	}

	log(`  ⚠ Cline timed out after ${Math.round(config.EXECUTION_TIMEOUT_MS / 1000)}s without writing "completed" — proceeding.`);
	throw new Error(`Cline timed out on task ${taskId}`);
}

function ensureTaskMemoryPersistence(story: UserStory, workspaceRoot: string): TaskMemoryPersistenceResult {
	const existingMemory = hasTaskMemoryArtifact(workspaceRoot, story.id) ? readTaskMemory(workspaceRoot, story.id) : null;
	const validation = existingMemory ? validateTaskMemory(existingMemory, story.id) : null;

	if (validation?.isValid) {
		const filePath = writeTaskMemory(workspaceRoot, story.id, {
			...validation.artifact,
			source: validation.artifact.source ?? 'cline',
		});
		const persistedArtifact: TaskMemoryArtifact = {
			...validation.artifact,
			source: validation.artifact.source ?? 'cline',
		};
		upsertTaskMemoryIndexEntry(workspaceRoot, persistedArtifact, story.id);
		log(`  Valid task memory artifact accepted for ${story.id}.`);
		activeRunLog?.recordArtifact('task-memory', filePath, persistedArtifact.source ?? 'cline');
		return { filePath, source: persistedArtifact.source ?? 'cline', artifact: persistedArtifact };
	}

	if (validation && !validation.isValid) {
		log(`  WARNING: Task memory for ${story.id} failed validation: ${validation.errors.join(' | ')}`);
	} else {
		log(`  WARNING: Task memory artifact missing for ${story.id}; synthesizing fallback memory.`);
	}

	const fallbackMemory = synthesizeTaskMemoryForStory(story, workspaceRoot, validation?.errors ?? []);
	const fallbackPath = writeTaskMemory(workspaceRoot, story.id, fallbackMemory);
	upsertTaskMemoryIndexEntry(workspaceRoot, fallbackMemory, story.id);
	log(`  Synthesized fallback task memory for ${story.id} at ${fallbackPath}.`);
	activeRunLog?.recordArtifact('task-memory', fallbackPath, 'synthesized');
	return { filePath: fallbackPath, source: 'synthesized', artifact: fallbackMemory };
}

function ensureExecutionCheckpointPersistence(
	story: UserStory,
	workspaceRoot: string,
	options: {
		status: ExecutionCheckpointStatus;
		taskMemory?: TaskMemoryArtifact;
		failureMessage?: string;
	},
): ExecutionCheckpointPersistenceResult {
	const checkpointExists = hasExecutionCheckpointArtifact(workspaceRoot, story.id);
	const existingCheckpoint = checkpointExists ? readExecutionCheckpoint(workspaceRoot, story.id) : null;
	const validation = existingCheckpoint ? validateExecutionCheckpoint(existingCheckpoint, story.id, options.status) : null;

	if (validation?.isValid) {
		const filePath = writeExecutionCheckpoint(workspaceRoot, story.id, {
			...validation.artifact,
			source: validation.artifact.source ?? 'cline',
		}, options.status);
		const persistedArtifact: ExecutionCheckpointArtifact = {
			...validation.artifact,
			source: validation.artifact.source ?? 'cline',
		};
		log(`  Valid execution checkpoint accepted for ${story.id}.`);
		activeRunLog?.recordArtifact('execution-checkpoint', filePath, persistedArtifact.source ?? 'cline');
		return {
			filePath,
			source: persistedArtifact.source ?? 'cline',
			artifact: persistedArtifact,
		};
	}

	if (checkpointExists && !existingCheckpoint) {
		log(`  WARNING: Execution checkpoint for ${story.id} was unreadable or invalid JSON; synthesizing a fresh checkpoint.`);
	} else if (validation && !validation.isValid) {
		log(`  WARNING: Execution checkpoint for ${story.id} failed validation: ${validation.errors.join(' | ')}`);
	} else {
		log(`  WARNING: Execution checkpoint missing for ${story.id}; synthesizing fallback checkpoint.`);
	}

	const fallbackCheckpoint = synthesizeExecutionCheckpointForStory(story, workspaceRoot, options);
	const fallbackPath = writeExecutionCheckpoint(workspaceRoot, story.id, fallbackCheckpoint, options.status);
	log(`  Synthesized fallback execution checkpoint for ${story.id} at ${fallbackPath}.`);
	activeRunLog?.recordArtifact('execution-checkpoint', fallbackPath, 'synthesized');
	return {
		filePath: fallbackPath,
		source: 'synthesized',
		artifact: fallbackCheckpoint,
	};
}

function synthesizeTaskMemoryForStory(story: UserStory, workspaceRoot: string, validationErrors: string[]): TaskMemoryArtifact {
	const changedFiles = detectChangedFilesForTaskMemory(workspaceRoot, story.id);
	const changedModules = deriveChangedModules(changedFiles);
	const searchKeywords = deriveTaskMemorySearchKeywords(story, changedFiles, changedModules);
	const risks = validationErrors.length > 0
		? validationErrors.map(error => `Recovered from invalid task memory: ${error}`)
		: ['Changed files were inferred automatically because Cline did not persist task memory.'];

	return createSynthesizedTaskMemory(story.id, story.title, `Fallback task memory synthesized for ${story.id}: ${story.title}.`, {
		changedFiles,
		changedModules,
		keyDecisions: [
			'HARNESS synthesized a task memory artifact because completion was signaled before a valid memory artifact was available.',
			'Prompt recall should use this synthesized entry until a richer memory artifact is recorded.',
		],
		constraintsConfirmed: ['prd.json remained read-only during task execution.'],
		testsRun: ['Validation occurred during post-completion finalization.'],
		risks,
		followUps: ['Review the synthesized memory artifact and replace it with a richer entry if needed.'],
		searchKeywords,
		relatedStories: extractRelatedStoryIds(story),
	});
}

function synthesizeExecutionCheckpointForStory(
	story: UserStory,
	workspaceRoot: string,
	options: {
		status: ExecutionCheckpointStatus;
		taskMemory?: TaskMemoryArtifact;
		failureMessage?: string;
	},
): ExecutionCheckpointArtifact {
	const taskMemory = options.taskMemory;
	const changedFiles = detectChangedFilesForTaskMemory(workspaceRoot, story.id);
	const changedModules = deriveChangedModules(changedFiles);
	const inferredImpact = changedModules.length > 0 ? changedModules.join(', ') : 'the current workspace changes';
	const confirmedConstraints = Array.from(new Set([
		...(taskMemory?.constraintsConfirmed ?? []),
		'prd.json remained read-only during task execution.',
	]));

	if (options.status === 'completed') {
		return createSynthesizedExecutionCheckpoint(
			story.id,
			story.title,
			'completed',
			taskMemory?.summary || `Completed ${story.id}: ${story.title}.`,
			{
				stageGoal: story.description || story.title,
				keyDecisions: taskMemory?.keyDecisions?.length
					? taskMemory.keyDecisions
					: ['Persist the latest execution checkpoint after successful completion to preserve a durable resume point.'],
				confirmedConstraints,
				unresolvedRisks: taskMemory?.risks?.length
					? taskMemory.risks
					: ['No unresolved risks were recorded at checkpoint time.'],
				nextStoryPrerequisites: taskMemory?.followUps?.length
					? taskMemory.followUps
					: [`Review ${inferredImpact} before starting the next related story.`],
				resumeRecommendation: `Resume from the next pending story after reviewing the persisted task memory and checkpoint for ${story.id}.`,
			}
		);
	}

	const interruptionReason = options.failureMessage?.trim().length
		? options.failureMessage.trim()
		: options.status === 'failed'
			? 'Execution ended with an unrecovered runtime failure.'
			: 'Execution stopped before the story reached completion.';

	return createSynthesizedExecutionCheckpoint(
		story.id,
		story.title,
		options.status,
		`${options.status === 'failed' ? 'Execution failed' : 'Execution was interrupted'} for ${story.id}: ${story.title}. ${interruptionReason}`,
		{
			stageGoal: story.description || story.title,
			keyDecisions: [
				'Preserve the latest execution state in a synthesized checkpoint instead of relying on transient chat context.',
				'Keep partial changes that already passed locally rather than reverting workspace state automatically.',
			],
			confirmedConstraints,
			unresolvedRisks: [
				`Latest blocker: ${interruptionReason}`,
				`Affected areas may include ${inferredImpact}.`,
			],
			nextStoryPrerequisites: [
				'Review the current working tree and confirm which partial changes are intentional.',
				'Resolve the blocking issue before rerunning this story or starting the dependent next story.',
			],
			resumeRecommendation: `Resume ${story.id} by inspecting the current workspace changes, validating the last stable edits, and then rerunning the story once the blocker is cleared.`,
		}
	);
}

function createCheckpointFallbackStory(storyId: string): UserStory {
	return {
		id: storyId,
		title: storyId,
		description: `Recovered story context placeholder for ${storyId}.`,
		acceptanceCriteria: [],
		priority: 0,
	};
}

function detectChangedFilesForWorkspace(workspaceRoot: string): string[] {
	try {
		const output = execSync('git status --short --untracked-files=all', {
			cwd: workspaceRoot,
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});

		const changedFiles = output
			.split(/\r?\n/)
			.map((line: string) => line.trim())
			.filter((line: string) => line.length > 0)
			.map((line: string) => line.slice(3).split(' -> ').pop() ?? '')
			.map((filePath: string) => filePath.replace(/\\/g, '/'))
			.filter((filePath: string) => filePath.length > 0 && !filePath.startsWith('.harness-runner/'));

		if (changedFiles.length > 0) {
			return Array.from(new Set(changedFiles));
		}
	} catch {
		log('  WARNING: Unable to inspect git status for workspace change detection.');
	}

	return ['(unable to determine changed files automatically)'];
}

function getStoryChangedFiles(workspaceRoot: string, storyId: string): string[] {
	const currentChangedFiles = detectChangedFilesForWorkspace(workspaceRoot);
	const baseline = readPolicyBaseline(workspaceRoot, storyId);
	if (baseline) {
		return deriveStoryChangedFiles(currentChangedFiles, baseline)
			.filter(filePath => !filePath.startsWith('.harness-runner/'));
	}

	return currentChangedFiles.filter(filePath => !filePath.startsWith('.harness-runner/'));
}

function detectChangedFilesForTaskMemory(workspaceRoot: string, storyId: string): string[] {
	const storyChangedFiles = getStoryChangedFiles(workspaceRoot, storyId)
		.filter(filePath => !filePath.startsWith('.prd/') && filePath !== 'prd.json');
	if (storyChangedFiles.length > 0) {
		return storyChangedFiles;
	}

	log(`  WARNING: Unable to derive story-specific changed files for fallback task memory on ${storyId}.`);
	return ['(unable to determine changed files automatically)'];
}

function getEffectivePolicyConfig() {
	const config = getConfig();
	return buildEffectivePolicyConfig(config.POLICY_GATES, {
		requireProjectConstraintsBeforeRun: config.REQUIRE_PROJECT_CONSTRAINTS_BEFORE_RUN,
		requireDesignContextForTaggedStories: config.REQUIRE_DESIGN_CONTEXT_FOR_TAGGED_STORIES,
	});
}

function getMergedProjectConstraintsSafe(workspaceRoot: string): GeneratedProjectConstraints | null {
	if (!hasProjectConstraintsArtifacts(workspaceRoot)) {
		return null;
	}

	try {
		return loadMergedProjectConstraints(workspaceRoot);
	} catch {
		return null;
	}
}

function hasPolicyArtifact(workspaceRoot: string, story: UserStory, artifact: 'project-constraints' | 'design-context' | 'task-memory' | 'execution-checkpoint' | 'story-evidence' | 'source-context-index'): boolean {
	if (artifact === 'project-constraints') {
		return hasProjectConstraintsArtifacts(workspaceRoot);
	}
	if (artifact === 'design-context') {
		return hasAnyDesignContextForStory(workspaceRoot, story);
	}
	if (artifact === 'task-memory') {
		return hasTaskMemoryArtifact(workspaceRoot, story.id);
	}
	if (artifact === 'execution-checkpoint') {
		return hasExecutionCheckpointArtifact(workspaceRoot, story.id);
	}
	if (artifact === 'story-evidence') {
		return hasStoryEvidenceArtifact(workspaceRoot, story.id);
	}
	return Boolean(getSourceContextIndex(workspaceRoot));
}

function getPolicyArtifactPaths(workspaceRoot: string, story: UserStory) {
	return {
		'project-constraints': `${resolveGeneratedProjectConstraintsPath(workspaceRoot).replace(/\\/g, '/')} and ${resolveEditableProjectConstraintsPath(workspaceRoot).replace(/\\/g, '/')}`,
		'design-context': resolveDesignContextPath(workspaceRoot, story.id).replace(/\\/g, '/'),
		'task-memory': resolveTaskMemoryPath(workspaceRoot, story.id).replace(/\\/g, '/'),
		'execution-checkpoint': resolveExecutionCheckpointPath(workspaceRoot, story.id).replace(/\\/g, '/'),
		'story-evidence': resolveStoryEvidencePath(workspaceRoot, story.id).replace(/\\/g, '/'),
		'source-context-index': resolveSourceContextIndexPath(workspaceRoot).replace(/\\/g, '/'),
	};
}

function evaluateCompletionPolicyGates(workspaceRoot: string, story: UserStory) {
	const policyConfig = getEffectivePolicyConfig();
	if (!policyConfig.enabled) {
		return { ok: true, violations: [], executedCommands: [] };
	}

	const result = evaluatePolicyGates(policyConfig, {
		workspaceRoot,
		story,
		phase: 'completion',
		changedFiles: getStoryChangedFiles(workspaceRoot, story.id),
		projectConstraints: getMergedProjectConstraintsSafe(workspaceRoot),
		isDesignSensitiveStory: isDesignSensitiveStory(story),
		hasExecutionTimeDesignFallback: synthesizeExecutionDesignContextPromptLines(story, null).length > 0,
		hasArtifact: artifact => hasPolicyArtifact(workspaceRoot, story, artifact),
		knowledgeCheckReport: getKnowledgeCheckReportSafe(workspaceRoot, {
			scope: 'run-completion',
			story,
			changedFiles: getStoryChangedFiles(workspaceRoot, story.id),
		}),
		commandTimeoutMs: getConfig().POLICY_GATE_COMMAND_TIMEOUT_MS,
		artifactPaths: getPolicyArtifactPaths(workspaceRoot, story),
	});

	if (!result.ok) {
		log(`  Policy gates blocked completion for ${story.id}.`);
		for (const line of summarizePolicyViolations(result)) {
			log(`  ${line}`);
		}
		vscode.window.showWarningMessage(getLanguagePack().runtime.policyBlockedAfterStory(story.id));
	}
	activeRunLog?.recordPolicyEvaluation('completion', result);

	return result;
}

function ensureStoryEvidencePersistence(
	story: UserStory,
	workspaceRoot: string,
	options: {
		taskMemory: TaskMemoryArtifact;
		checkpoint: ExecutionCheckpointArtifact;
	},
): StoryEvidencePersistenceResult {
	const existingEvidence = hasStoryEvidenceArtifact(workspaceRoot, story.id) ? readStoryEvidence(workspaceRoot, story.id) : null;
	const validation = existingEvidence ? validateStoryEvidence(existingEvidence, story.id) : null;

	if (validation?.isValid) {
		const filePath = writeStoryEvidence(workspaceRoot, story.id, {
			...validation.artifact,
			source: validation.artifact.source ?? 'cline',
		});
		const persistedArtifact: StoryEvidenceArtifact = {
			...validation.artifact,
			source: validation.artifact.source ?? 'cline',
		};
		log(`  Valid story evidence artifact accepted for ${story.id}.`);
		activeRunLog?.recordArtifact('story-evidence', filePath, persistedArtifact.source ?? 'cline');
		return { filePath, source: persistedArtifact.source ?? 'cline', artifact: persistedArtifact };
	}

	if (validation && !validation.isValid) {
		log(`  WARNING: Story evidence for ${story.id} failed validation: ${validation.errors.join(' | ')}`);
	} else {
		log(`  WARNING: Story evidence artifact missing for ${story.id}; synthesizing fallback evidence.`);
	}

	const fallbackEvidence = synthesizeStoryEvidenceForStory(story, workspaceRoot, options);
	const fallbackPath = writeStoryEvidence(workspaceRoot, story.id, fallbackEvidence);
	log(`  Synthesized fallback story evidence for ${story.id} at ${fallbackPath}.`);
	activeRunLog?.recordArtifact('story-evidence', fallbackPath, 'synthesized');
	return { filePath: fallbackPath, source: 'synthesized', artifact: fallbackEvidence };
}

function synthesizeStoryEvidenceForStory(
	story: UserStory,
	workspaceRoot: string,
	options: {
		taskMemory: TaskMemoryArtifact;
		checkpoint: ExecutionCheckpointArtifact;
	},
): StoryEvidenceArtifact {
	const changedFiles = detectChangedFilesForTaskMemory(workspaceRoot, story.id);
	const changedModules = deriveChangedModules(changedFiles);
	const executedTestCommands = getCompletionPolicyExecutedTestCommands(workspaceRoot, story);
	const testEvidence = executedTestCommands.length > 0
		? executedTestCommands
		: options.taskMemory.testsRun.map(command => ({
			command,
			success: true,
			outputSummary: 'Recorded in task memory.',
		}));
	if (testEvidence.length > 0) {
		activeRunLog?.recordTests(testEvidence.map(test => ({
			command: test.command,
			success: test.success,
			summary: test.outputSummary ?? 'Recorded in synthesized story evidence.',
			source: 'artifact',
			phase: 'artifact-persistence',
		})));
	}
	return createSynthesizedStoryEvidence(story, {
		changedFiles,
		changedModules,
		tests: testEvidence,
		taskMemory: options.taskMemory,
		checkpoint: options.checkpoint,
		source: 'synthesized',
	});
}

function ensureStoryReviewPersistence(
	story: UserStory,
	workspaceRoot: string,
	artifacts: StoryExecutionArtifacts,
	options: {
		reviewPass: number;
		autoRefactorRounds: number;
		maxAutoRefactorRounds: number;
		passingScore: number;
		allowMissingReview?: boolean;
		skipReason?: string;
	},
): {
	artifacts: StoryExecutionArtifacts;
	review: StoryReviewPersistenceResult;
} {
	const reviewCandidates: Array<{ value: Partial<StoryReviewResult> | undefined; source: 'cline' | 'synthesized'; label: string; }> = [
		{ value: artifacts.evidence.artifact.reviewSummary, source: artifacts.evidence.source, label: 'story evidence' },
		{ value: artifacts.checkpoint.artifact.reviewSummary, source: artifacts.checkpoint.source, label: 'execution checkpoint' },
		{ value: artifacts.taskMemory.artifact.reviewSummary, source: artifacts.taskMemory.source, label: 'task memory' },
	];

	let reviewArtifact: StoryReviewResult | null = null;
	let reviewSource: 'cline' | 'synthesized' = 'synthesized';
	for (const candidate of reviewCandidates) {
		if (!candidate.value) {
			continue;
		}

		const validation = validateStoryReviewResult(candidate.value, {
			reviewPass: options.reviewPass,
			maxAutoRefactorRounds: options.maxAutoRefactorRounds,
			passingScore: options.passingScore,
			refactorPerformed: options.autoRefactorRounds > 0,
			refactorSummary: options.autoRefactorRounds > 0 ? `Automatic refactor rounds executed: ${options.autoRefactorRounds}.` : undefined,
		});
		if (validation.isValid) {
			reviewArtifact = validation.artifact;
			reviewSource = candidate.source === 'cline' ? 'cline' : 'synthesized';
			break;
		}

		log(`  WARNING: Review summary from ${candidate.label} failed validation for ${story.id}: ${validation.errors.join(' | ')}`);
	}

	if (!reviewArtifact && options.allowMissingReview) {
		reviewArtifact = createSynthesizedStoryReview(story, {
			reviewPass: options.reviewPass,
			maxAutoRefactorRounds: options.maxAutoRefactorRounds,
			passingScore: options.passingScore,
			refactorPerformed: false,
			changedFiles: artifacts.evidence.artifact.changedFiles,
			taskMemory: artifacts.taskMemory.artifact,
			checkpoint: artifacts.checkpoint.artifact,
			evidence: artifacts.evidence.artifact,
			fallbackReason: options.skipReason ?? 'Reviewer loop skipped in workspace settings.',
		});
		reviewSource = 'synthesized';
		reviewArtifact.passed = true;
		reviewArtifact.totalScore = reviewArtifact.maxScore;
		reviewArtifact.findings = [];
		reviewArtifact.recommendations = options.skipReason ? [options.skipReason] : [];
		const perDimensionScore = Math.floor(reviewArtifact.maxScore / Math.max(1, reviewArtifact.dimensions.length));
		reviewArtifact.dimensions = reviewArtifact.dimensions.map(dimension => ({
			...dimension,
			score: perDimensionScore,
			summary: options.skipReason ?? 'Reviewer loop skipped by workspace configuration.',
			issues: [],
			recommendations: options.skipReason ? [options.skipReason] : [],
		}));
	}

	if (!reviewArtifact) {
		reviewArtifact = createSynthesizedStoryReview(story, {
			reviewPass: options.reviewPass,
			maxAutoRefactorRounds: options.maxAutoRefactorRounds,
			passingScore: options.passingScore,
			refactorPerformed: options.autoRefactorRounds > 0,
			refactorSummary: options.autoRefactorRounds > 0 ? `Automatic refactor rounds executed: ${options.autoRefactorRounds}.` : undefined,
			changedFiles: artifacts.evidence.artifact.changedFiles,
			taskMemory: artifacts.taskMemory.artifact,
			checkpoint: artifacts.checkpoint.artifact,
			evidence: artifacts.evidence.artifact,
			fallbackReason: 'Reviewer pass did not persist a valid structured review summary, so Harness synthesized one from the available artifacts.',
		});
		reviewSource = 'synthesized';
		log(`  WARNING: Synthesized structured review summary for ${story.id}.`);
	}

	const reviewLoop = buildStoryReviewLoopState(reviewArtifact, {
		reviewerPasses: options.reviewPass,
		autoRefactorRounds: options.autoRefactorRounds,
		maxAutoRefactorRounds: options.maxAutoRefactorRounds,
		endedReason: options.allowMissingReview ? 'passed' : undefined,
	});
	const finalEvidenceStatus = reviewArtifact.passed
		? artifacts.evidence.artifact.status
		: 'pendingReview';
	const finalApprovalState = reviewArtifact.passed
			? artifacts.evidence.artifact.approvalState
			: 'pending';

	const nextTaskMemoryArtifact: TaskMemoryArtifact = {
		...artifacts.taskMemory.artifact,
		reviewSummary: reviewArtifact,
		reviewLoop,
	};
	const nextCheckpointArtifact: ExecutionCheckpointArtifact = {
		...artifacts.checkpoint.artifact,
		reviewSummary: reviewArtifact,
		reviewLoop,
	};
	const nextEvidenceArtifact: StoryEvidenceArtifact = {
		...artifacts.evidence.artifact,
		status: finalEvidenceStatus,
		approvalState: finalApprovalState,
		reviewSummary: reviewArtifact,
		reviewLoop,
	};

	const taskMemoryPath = writeTaskMemory(workspaceRoot, story.id, nextTaskMemoryArtifact);
	upsertTaskMemoryIndexEntry(workspaceRoot, nextTaskMemoryArtifact, story.id);
	const checkpointPath = writeExecutionCheckpoint(workspaceRoot, story.id, nextCheckpointArtifact, 'completed');
	const evidencePath = writeStoryEvidence(workspaceRoot, story.id, nextEvidenceArtifact);

	return {
		artifacts: {
			taskMemory: {
				filePath: taskMemoryPath,
				source: nextTaskMemoryArtifact.source ?? artifacts.taskMemory.source,
				artifact: nextTaskMemoryArtifact,
			},
			checkpoint: {
				filePath: checkpointPath,
				source: nextCheckpointArtifact.source ?? artifacts.checkpoint.source,
				artifact: nextCheckpointArtifact,
			},
			evidence: {
				filePath: evidencePath,
				source: nextEvidenceArtifact.source ?? artifacts.evidence.source,
				artifact: nextEvidenceArtifact,
			},
		},
		review: {
			source: reviewSource,
			artifact: reviewArtifact,
			loop: reviewLoop,
		},
	};
}

function getCompletionPolicyExecutedTestCommands(workspaceRoot: string, story: UserStory) {
	const policyConfig = getEffectivePolicyConfig();
	if (!policyConfig.enabled) {
		return [];
	}

	const result = evaluatePolicyGates(policyConfig, {
		workspaceRoot,
		story,
		phase: 'completion',
		changedFiles: getStoryChangedFiles(workspaceRoot, story.id),
		projectConstraints: getMergedProjectConstraintsSafe(workspaceRoot),
		isDesignSensitiveStory: isDesignSensitiveStory(story),
		hasExecutionTimeDesignFallback: synthesizeExecutionDesignContextPromptLines(story, null).length > 0,
		hasArtifact: artifact => artifact === 'story-evidence' ? true : hasPolicyArtifact(workspaceRoot, story, artifact),
		knowledgeCheckReport: getKnowledgeCheckReportSafe(workspaceRoot, {
			scope: 'run-completion',
			story,
			changedFiles: getStoryChangedFiles(workspaceRoot, story.id),
		}),
		commandTimeoutMs: getConfig().POLICY_GATE_COMMAND_TIMEOUT_MS,
		artifactPaths: getPolicyArtifactPaths(workspaceRoot, story),
	});

	return result.executedCommands.map(command => ({
		command: command.command,
		success: command.success,
		outputSummary: command.output,
	}));
}

function buildStoryCompletionNote(executionResult: {
	taskMemory: TaskMemoryPersistenceResult;
	checkpoint: ExecutionCheckpointPersistenceResult;
	evidence: StoryEvidencePersistenceResult;
	review: StoryReviewPersistenceResult;
}): string {
	const evidenceSummary = summarizeStoryEvidenceForStatus(executionResult.evidence.artifact).join('; ');
	const reviewSummary = summarizeStoryReviewForStatus(executionResult.review.artifact, executionResult.review.loop).join('; ');
	return `Finalized as ${executionResult.evidence.artifact.status}; task memory persisted (${executionResult.taskMemory.source}); checkpoint persisted (${executionResult.checkpoint.source}); evidence persisted (${executionResult.evidence.source}); reviewer persisted (${executionResult.review.source})${reviewSummary ? `; ${reviewSummary}` : ''}${evidenceSummary ? `; ${evidenceSummary}` : ''}`;
}

function summarizeStoryEvidenceForPrompt(evidence: StoryEvidenceArtifact): string[] {
	const lines = [
		`Summary: ${evidence.summary}`,
		`Status: ${evidence.status}`,
		`Risk Level: ${evidence.riskLevel}`,
		...summarizeStoryEvidenceForStatus(evidence),
	];

	for (const test of evidence.tests.slice(0, 4)) {
		lines.push(`Test: ${test.command} => ${test.success ? 'passed' : 'failed'}`);
	}
	for (const gap of evidence.evidenceGaps.slice(0, 3)) {
		lines.push(`Gap: ${gap}`);
	}
	for (const followUp of evidence.followUps.slice(0, 3)) {
		lines.push(`Follow Up: ${followUp}`);
	}

	return lines;
}

function summarizeCurrentReviewLoop(artifacts: StoryExecutionArtifacts): string[] {
	const reviewSummary = artifacts.evidence.artifact.reviewSummary
		?? artifacts.checkpoint.artifact.reviewSummary
		?? artifacts.taskMemory.artifact.reviewSummary
		?? null;
	const reviewLoop = artifacts.evidence.artifact.reviewLoop
		?? artifacts.checkpoint.artifact.reviewLoop
		?? artifacts.taskMemory.artifact.reviewLoop
		?? null;
	return summarizeStoryReviewForStatus(reviewSummary, reviewLoop);
}

function getKnowledgeCheckReportSafe(
	workspaceRoot: string,
	input: Parameters<typeof evaluateKnowledgeCoverage>[1],
) {
	try {
		return evaluateKnowledgeCoverage(workspaceRoot, input);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		log(`  WARNING: Failed to evaluate knowledge freshness checks${input.story ? ` for ${input.story.id}` : ''}: ${message}`);
		return createEmptyKnowledgeCheckReport(input.scope, input.story?.id);
	}
}

function buildApprovalProgressNote(evidence: StoryEvidenceArtifact, action: StoryApprovalAction): string {
	const evidenceSummary = summarizeStoryEvidenceForStatus(evidence).join('; ');
	const latestRecord = evidence.approvalHistory[evidence.approvalHistory.length - 1];
	const latestNote = latestRecord?.note ? `; note=${latestRecord.note}` : '';
	return `Approval ${action}; status=${evidence.status}; updatedAt=${evidence.approvalUpdatedAt ?? evidence.generatedAt}${latestNote}${evidenceSummary ? `; ${evidenceSummary}` : ''}`;
}

function deriveChangedModules(changedFiles: string[]): string[] {
	const modules = changedFiles
		.filter(filePath => !filePath.startsWith('('))
		.map(filePath => filePath.split('/').slice(0, -1).join('/') || path.basename(filePath, path.extname(filePath)))
		.filter(moduleName => moduleName.length > 0);

	return Array.from(new Set(modules));
}

function deriveTaskMemorySearchKeywords(story: UserStory, changedFiles: string[], changedModules: string[]): string[] {
	const keywords = new Set<string>();
	for (const value of [story.id, story.title, ...changedModules]) {
		if (typeof value !== 'string') {
			continue;
		}

		for (const token of value.toLowerCase().split(/[^a-z0-9]+/)) {
			if (token.length >= 3) {
				keywords.add(token);
			}
		}
	}

	for (const filePath of changedFiles) {
		const fileName = path.basename(filePath, path.extname(filePath)).toLowerCase();
		if (fileName.length >= 3) {
			keywords.add(fileName);
		}
	}

	return Array.from(keywords).slice(0, 12);
}

function extractRelatedStoryIds(story: UserStory): string[] {
	const relatedIds = new Set<string>();
	for (const key of ['dependsOn', 'relatedStories']) {
		const rawValue = story[key];
		if (!Array.isArray(rawValue)) {
			continue;
		}

		for (const item of rawValue) {
			if (typeof item === 'string' && /^US-\d+$/i.test(item.trim())) {
				relatedIds.add(item.trim().toUpperCase());
			}
		}
	}

	return Array.from(relatedIds);
}

/**
 * Block until no transient signal entry in .harness-runner/story-status.json is "inprogress".
 * Under normal sequential operation this resolves immediately.
 * Polls every EXECUTION_RESPONSE_POLL_MS and times out after EXECUTION_TIMEOUT_MS.
 */
async function ensureNoActiveTask(workspaceRoot: string): Promise<void> {
	const config = getConfig();

	if (!HarnessStateManager.isAnyInProgress(workspaceRoot)) {
		return; // Fast path — no active task
	}

	const activeId = HarnessStateManager.getInProgressTaskId(workspaceRoot);
	log(`  ⏳ Task ${activeId} is still marked inprogress in .harness-runner/story-status.json — waiting for it to complete...`);

	const waitStart = Date.now();

	while (Date.now() - waitStart < config.EXECUTION_TIMEOUT_MS) {
		if (cancelToken?.token.isCancellationRequested) {
			throw new Error('Cancelled by user');
		}

		await sleep(config.EXECUTION_RESPONSE_POLL_MS);
		if (cancelToken?.token.isCancellationRequested || !isRunning) {
			throw new Error('Cancelled by user');
		}

		if (!HarnessStateManager.isAnyInProgress(workspaceRoot)) {
			const waited = Math.round((Date.now() - waitStart) / 1000);
			log(`  ✓ No active task on disk — proceeding (waited ${waited}s)`);
			return;
		}

		const stillActive = HarnessStateManager.getInProgressTaskId(workspaceRoot);
		log(`  … still waiting for task ${stillActive} to clear inprogress state`);
	}

	// Timed out — clear the lock to prevent a permanent deadlock
	const timedOutId = HarnessStateManager.getInProgressTaskId(workspaceRoot);
	if (timedOutId !== null) {
		log(`  WARNING: Timed out waiting for task ${timedOutId} — clearing stale lock and proceeding.`);
		HarnessStateManager.clearStalledTask(workspaceRoot, timedOutId);
	}
}

// ── Status & Reset Commands ─────────────────────────────────────────────────

async function showStatus(): Promise<void> {
	const languagePack = getLanguagePack();
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) { return; }

	const prd = parsePrd(workspaceRoot);
	if (!prd) {
		vscode.window.showErrorMessage(languagePack.runtime.prdNotFoundRoot);
		return;
	}

	const total = prd.userStories.length;
	let completed = 0;
	let failed = 0;
	let awaitingApproval = 0;
	let pending = 0;
	for (const story of prd.userStories) {
		const status = HarnessStateManager.getStoryExecutionStatus(workspaceRoot, story.id);
		if (status === 'completed') {
			completed += 1;
		} else if (status === 'failed') {
			failed += 1;
		} else if (status === 'pendingReview' || status === 'pendingRelease') {
			awaitingApproval += 1;
		} else if (status === 'none' || status === '未开始') {
			pending += 1;
		}
	}
	const inProgress = HarnessStateManager.getInProgressTaskId(workspaceRoot);
	const nextPending = findNextPendingStory(prd, workspaceRoot);

	const lines = [
		languagePack.status.title(prd.project),
		``,
		`✅ ${languagePack.status.completed(completed, total)}`,
		`❌ ${languagePack.status.failed(failed)}`,
		`🟣 ${languagePack.status.awaitingRelease(awaitingApproval)}`,
		`⏳ ${languagePack.status.pending(pending)}`,
		`🔄 ${languagePack.status.inProgress(isRunning ? inProgress : null)}`,
		`📍 ${languagePack.status.next(nextPending ? `${nextPending.id} — ${nextPending.title}` : languagePack.status.allDone)}`,
		``,
		languagePack.status.running(isRunning)
	];

	outputChannel.show(true);
	log(lines.join('\n'));
	vscode.window.showInformationMessage(languagePack.status.summary(completed, total, nextPending ? nextPending.id : null));
}

async function reviewStoryApproval(targetStoryId?: string): Promise<void> {
	const languagePack = getLanguagePack();
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage(languagePack.common.noWorkspaceFolder);
		return;
	}

	const prd = parsePrd(workspaceRoot);
	if (!prd) {
		vscode.window.showErrorMessage(languagePack.runtime.prdNotFoundRoot);
		return;
	}

	const candidates = getPendingApprovalCandidates(workspaceRoot, prd);

	if (candidates.length === 0) {
		vscode.window.showInformationMessage(languagePack.approval.noReviewableStories);
		return;
	}

	const selectedCandidate = targetStoryId
		? candidates.find(candidate => candidate.story.id === targetStoryId)
		: undefined;
	const candidate = selectedCandidate ?? await pickApprovalCandidate(candidates);
	if (!candidate) {
		return;
	}

	logApprovalReviewSummary(candidate.story, candidate.evidence);

	const action = await pickApprovalAction(candidate.story.id, candidate.evidence);
	if (!action) {
		return;
	}

	const note = await promptForApprovalNote(candidate.story.id, action, action === 'rejected');
	if (note === undefined) {
		return;
	}

	const updatedEvidence = applyStoryApprovalDecision(candidate.evidence, {
		action,
		note,
	});
	writeStoryEvidence(workspaceRoot, candidate.story.id, updatedEvidence);
	HarnessStateManager.setCompleted(workspaceRoot, candidate.story.id);
	HarnessStateManager.setStoryExecutionStatus(workspaceRoot, candidate.story.id, updatedEvidence.status);

	log(`Approval updated for ${candidate.story.id}: action=${action}; status=${updatedEvidence.status}; approval=${updatedEvidence.approvalState}.`);
	const message = languagePack.approval.updated(
		candidate.story.id,
		getLocalizedStoryStatus(updatedEvidence.status, getConfig().LANGUAGE)
	);
	const response = await vscode.window.showInformationMessage(message, languagePack.approval.openEvidence);
	if (response === languagePack.approval.openEvidence) {
		await openStoryEvidenceArtifact(workspaceRoot, candidate.story.id);
	}
	updateStatusBar(isRunning ? 'running' : 'idle');
}

async function resetStory(): Promise<void> {
	const languagePack = getLanguagePack();
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) { return; }

	const prd = parsePrd(workspaceRoot);
	if (!prd) {
		vscode.window.showErrorMessage(languagePack.runtime.prdNotFoundRoot);
		return;
	}

	const statusMap = HarnessStateManager.readStoryStatusMap(workspaceRoot);
	const trackedStories = prd.userStories.filter(s => s.id in statusMap);

	if (trackedStories.length === 0) {
		vscode.window.showInformationMessage(languagePack.reset.noTrackedStories);
		return;
	}

	const items = trackedStories.map(s => {
		const status = statusMap[s.id];
		return {
			label: `${s.id} — ${s.title}`,
			description: getLocalizedStoryStatus(status, languagePack.language),
			storyId: s.id
		};
	});

	const selection = await vscode.window.showQuickPick(items, {
		placeHolder: languagePack.reset.placeholder
	});

	if (selection) {
		HarnessStateManager.clearStalledTask(workspaceRoot, selection.storyId);
		HarnessStateManager.clearStoryExecutionStatus(workspaceRoot, selection.storyId);
		try {
			const evidencePath = resolveStoryEvidencePath(workspaceRoot, selection.storyId);
			if (fs.existsSync(evidencePath)) {
				fs.unlinkSync(evidencePath);
			}
		} catch {
			// ignore evidence cleanup failures during reset
		}
		vscode.window.showInformationMessage(languagePack.reset.storyReset(selection.storyId));
		log(`Story ${selection.storyId} reset by user.`);
		updateStatusBar(isRunning ? 'running' : 'idle');
	}
}

function clearStoryForReplay(workspaceRoot: string, storyId: string): void {
	HarnessStateManager.clearStalledTask(workspaceRoot, storyId);
	HarnessStateManager.clearStoryExecutionStatus(workspaceRoot, storyId);
	clearPolicyBaseline(workspaceRoot, storyId);

	for (const filePath of [
		resolveStoryEvidencePath(workspaceRoot, storyId),
	]) {
		try {
			if (fs.existsSync(filePath)) {
				fs.unlinkSync(filePath);
			}
		} catch {
			// ignore cleanup failures during replay preparation
		}
	}
}

async function rerunFailedStory(): Promise<void> {
	const languagePack = getLanguagePack();
	if (isRunning) {
		vscode.window.showWarningMessage(languagePack.runtime.alreadyRunning);
		return;
	}

	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) { return; }

	const prd = parsePrd(workspaceRoot);
	if (!prd) {
		vscode.window.showErrorMessage(languagePack.runtime.prdNotFoundRoot);
		return;
	}

	const failedStories = [...prd.userStories]
		.sort((a, b) => a.priority - b.priority)
		.filter(story => HarnessStateManager.getStoryExecutionStatus(workspaceRoot, story.id) === 'failed');

	if (failedStories.length === 0) {
		vscode.window.showInformationMessage(languagePack.reset.noFailedStories);
		return;
	}

	const selection = await vscode.window.showQuickPick(
		failedStories.map(story => ({
			label: `${story.id} — ${story.title}`,
			description: languagePack.status.failed(1),
			storyId: story.id,
		})),
		{
			placeHolder: languagePack.reset.rerunPlaceholder,
		}
	);

	if (!selection) {
		return;
	}

	const replayStories = getReplayStoryRange(prd, selection.storyId);
	for (const story of replayStories) {
		clearStoryForReplay(workspaceRoot, story.id);
	}

	log(`Replay requested from ${selection.storyId}; cleared ${replayStories.length} stories from progress and status tracking.`);
	vscode.window.showInformationMessage(languagePack.reset.rerunPrepared(selection.storyId, replayStories.length));
	updateStatusBar('idle');
	await startHarnessRunner();
}

async function maybePromptForManualApproval(
	workspaceRoot: string,
	story: UserStory,
	evidence: StoryEvidenceArtifact,
): Promise<void> {
	if (!isStoryAwaitingApproval(evidence)) {
		return;
	}

	const languagePack = getLanguagePack();
	const localizedStatus = getLocalizedStoryStatus(evidence.status, getConfig().LANGUAGE);
	const approvalPromptMode = getConfig().APPROVAL_PROMPT_MODE;
	if (approvalPromptMode === 'bypass') {
		log(`Approval prompt mode=bypass; opening approval flow directly for ${story.id}.`);
		await reviewStoryApproval(story.id);
		return;
	}
	if (approvalPromptMode === 'autopilot') {
		log(`Approval prompt mode=autopilot; ${story.id} is awaiting approval (${evidence.status}). Review it from the command menu or the approval command.`);
		updateStatusBar(isRunning ? 'running' : 'idle');
		return;
	}

	const choice = await vscode.window.showInformationMessage(
		languagePack.approval.required(story.id, localizedStatus),
		languagePack.approval.openFlow,
		languagePack.approval.openEvidence
	);

	if (choice === languagePack.approval.openFlow) {
		await reviewStoryApproval(story.id);
		return;
	}
	if (choice === languagePack.approval.openEvidence) {
		await openStoryEvidenceArtifact(workspaceRoot, story.id);
	}
	updateStatusBar(isRunning ? 'running' : 'idle');
}

function getPendingApprovalCandidates(
	workspaceRoot: string,
	prd = parsePrd(workspaceRoot),
): Array<{ story: UserStory; evidence: StoryEvidenceArtifact; status: ReturnType<typeof HarnessStateManager.getStoryExecutionStatus>; }> {
	if (!prd) {
		return [];
	}

	return prd.userStories
		.map(story => ({
			story,
			evidence: readStoryEvidence(workspaceRoot, story.id),
			status: HarnessStateManager.getStoryExecutionStatus(workspaceRoot, story.id),
		}))
		.filter((item): item is { story: UserStory; evidence: StoryEvidenceArtifact; status: ReturnType<typeof HarnessStateManager.getStoryExecutionStatus>; } =>
			item.evidence !== null && isStoryAwaitingApproval(item.evidence)
		);
}

function getEnabledBuiltinPolicyRuleIds(config: ReturnType<typeof normalizePolicyConfig>): string[] {
	return [...config.preflightRules, ...config.completionRules]
		.filter(rule => rule.enabled !== false)
		.map(rule => rule.id)
		.filter(ruleId => [
			'require-project-constraints',
			'require-design-context',
			'protect-dangerous-paths',
			'require-relevant-tests',
			'require-task-memory-artifact',
			'require-execution-checkpoint-artifact',
			'require-story-evidence-artifact',
		].includes(ruleId));
}

function applyBuiltinRuleSelections(
	config: ReturnType<typeof normalizePolicyConfig>,
	enabled: boolean,
	selectedRuleIds: Set<string>,
) {
	const base = normalizePolicyConfig(config);
	const defaults = createDefaultPolicyConfig();
	const builtinRuleIds = new Set([
		'require-project-constraints',
		'require-design-context',
		'protect-dangerous-paths',
		'require-relevant-tests',
		'require-task-memory-artifact',
		'require-execution-checkpoint-artifact',
		'require-story-evidence-artifact',
	]);
	const mergeRuleArray = (rules: typeof base.preflightRules, defaultRules: typeof defaults.preflightRules | typeof defaults.completionRules) => {
		const merged = [...rules];
		for (const defaultRule of defaultRules) {
			if (!merged.some(rule => rule.id === defaultRule.id)) {
				merged.push(defaultRule);
			}
		}
		return merged.map(rule => builtinRuleIds.has(rule.id)
			? { ...rule, enabled: selectedRuleIds.has(rule.id) }
			: rule);
	};

	return {
		enabled,
		preflightRules: mergeRuleArray(base.preflightRules, defaults.preflightRules),
		completionRules: mergeRuleArray(base.completionRules, defaults.completionRules),
	};
}

function isStoryAwaitingApproval(evidence: StoryEvidenceArtifact): boolean {
	return evidence.status === 'pendingRelease'
		|| (evidence.status === 'pendingReview' && evidence.reviewSummary?.passed === true);
}

async function pickApprovalCandidate(candidates: Array<{ story: UserStory; evidence: StoryEvidenceArtifact; status: ReturnType<typeof HarnessStateManager.getStoryExecutionStatus>; }>) {
	const languagePack = getLanguagePack();
	const items = candidates.map(candidate => ({
		label: languagePack.common.storyFormat(candidate.story.id, candidate.story.title),
		description: `[${getLocalizedStoryStatus(candidate.evidence.status, getConfig().LANGUAGE)}] ${languagePack.approval.riskLabel(candidate.evidence.riskLevel)} · ${languagePack.approval.approvalLabel(formatApprovalState(candidate.evidence.approvalState))}`,
		detail: candidate.evidence.summary,
		candidate,
	}));

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: languagePack.approval.storyPlaceholder,
	});

	return selected?.candidate;
}

async function pickApprovalAction(storyId: string, evidence: StoryEvidenceArtifact): Promise<StoryApprovalAction | undefined> {
	const languagePack = getLanguagePack();
	const items: Array<vscode.QuickPickItem & { action: StoryApprovalAction; }> = [
		{
			label: languagePack.approval.approveLabel,
			description: languagePack.approval.approveDescription,
			action: 'approved',
		},
		{
			label: languagePack.approval.rejectLabel,
			description: languagePack.approval.rejectDescription,
			action: 'rejected',
		},
		{
			label: languagePack.approval.addNoteLabel,
			description: languagePack.approval.addNoteDescription,
			action: 'note',
		},
	];

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: languagePack.approval.actionPlaceholder(storyId),
	});

	return selected?.action;
}

async function promptForApprovalNote(storyId: string, action: StoryApprovalAction, required: boolean): Promise<string | undefined> {
	const languagePack = getLanguagePack();
	const input = await vscode.window.showInputBox({
		title: languagePack.approval.noteTitle(storyId),
		prompt: languagePack.approval.notePrompt(describeApprovalAction(action)),
		placeHolder: languagePack.approval.notePlaceholder,
		ignoreFocusOut: true,
	});

	if (input === undefined) {
		return undefined;
	}

	const normalized = input.trim();
	if (required && normalized.length === 0) {
		vscode.window.showWarningMessage(languagePack.approval.rejectNoteRequired);
		return undefined;
	}

	return normalized;
}

function logApprovalReviewSummary(story: UserStory, evidence: StoryEvidenceArtifact): void {
	const languagePack = getLanguagePack();
	outputChannel.show(true);
	log(`Approval review for ${story.id}: ${story.title}`);
	log(`  Status: ${evidence.status}`);
	log(`  Risk: ${evidence.riskLevel}`);
	log(`  Approval: ${evidence.approvalState}`);
	log(`  Summary: ${evidence.summary}`);
	if (evidence.riskReasons.length > 0) {
		log(`  Risk reasons: ${evidence.riskReasons.join('; ')}`);
	}
	if (evidence.evidenceGaps.length > 0) {
		log(`  Evidence gaps: ${evidence.evidenceGaps.join('; ')}`);
	}
	if (evidence.approvalHistory.length === 0) {
		log(`  ${languagePack.approval.noHistory}`);
		return;
	}
	log(`  ${languagePack.approval.historyHeading}`);
	for (const entry of evidence.approvalHistory) {
		log(`    - ${entry.createdAt} | ${entry.action} | ${entry.fromStatus ?? 'unknown'} -> ${entry.toStatus ?? evidence.status}${entry.note ? ` | ${entry.note}` : ''}`);
	}
}

function describeApprovalAction(action: StoryApprovalAction): string {
	const languagePack = getLanguagePack();
	if (action === 'approved') {
		return languagePack.approval.approveLabel;
	}
	if (action === 'rejected') {
		return languagePack.approval.rejectLabel;
	}
	return languagePack.approval.addNoteLabel;
}

function formatApprovalState(state: StoryEvidenceArtifact['approvalState']): string {
	if (state === 'notRequired') {
		return 'not-required';
	}
	return state;
}

async function openStoryEvidenceArtifact(workspaceRoot: string, storyId: string): Promise<void> {
	const filePath = resolveStoryEvidencePath(workspaceRoot, storyId);
	const document = await vscode.workspace.openTextDocument(filePath);
	await vscode.window.showTextDocument(document, { preview: false });
}

async function initializeProjectConstraints(): Promise<void> {
	const languagePack = getLanguagePack();
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage(languagePack.common.noWorkspaceFolder);
		return;
	}

	outputChannel.show(true);
	log('═══════════════════════════════════════════════════');
	log('HARNESS Initialize Project Constraints');
	log('═══════════════════════════════════════════════════');

	try {
		const config = getConfig();
		const scanResult = scanWorkspaceForProjectConstraints(workspaceRoot, {
			language: config.LANGUAGE,
		});
		const referenceSources = await collectProjectConstraintReferenceSources(workspaceRoot);
		if (referenceSources === undefined) {
			return;
		}
		const scaffold = ensureProjectConstraintsScaffold(workspaceRoot);
		const taskId = 'project-constraints-init';
		HarnessStateManager.clearStalledTask(workspaceRoot, taskId);
		const prompt = buildProjectConstraintsInitializationPrompt({
			workspaceRoot,
			language: config.LANGUAGE,
			generatedPath: resolveGeneratedProjectConstraintsPath(workspaceRoot),
			editablePath: resolveEditableProjectConstraintsPath(workspaceRoot),
			completionSignalPath: resolveStoryStatusRegistryPath(workspaceRoot),
			completionSignalKey: taskId,
			scanResult,
			referenceSources: referenceSources.sources,
			additionalInstructions: referenceSources.additionalInstructions,
		});
		log(`Project constraints scaffold ready: ${scaffold.generatedPath}`);
		log(`Project constraints editable scaffold: ${scaffold.editablePath}`);
		log(`Technology summary items: ${scanResult.generatedConstraints.technologySummary.length}`);
		log(`Delivery checklist items: ${scanResult.generatedConstraints.deliveryChecklist.length}`);
		await openClineTaskWithPrompt(prompt, languagePack.initProjectConstraints.copiedPrompt);
		vscode.window.showInformationMessage(languagePack.initProjectConstraints.started);

		try {
			await waitForClineCompletion(taskId, workspaceRoot, { requireRunnerActive: false });
			HarnessStateManager.clearStalledTask(workspaceRoot, taskId);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			log(`ERROR: Failed to initialize project constraints: ${message}`);
			vscode.window.showErrorMessage(languagePack.initProjectConstraints.failed(message));
			return;
		}

		const generatedPath = resolveGeneratedProjectConstraintsPath(workspaceRoot);
		const editablePath = resolveEditableProjectConstraintsPath(workspaceRoot);
		log(`Project constraints generated: ${generatedPath}`);
		log(`Project constraints editable rules: ${editablePath}`);

		const action = await vscode.window.showInformationMessage(
			languagePack.initProjectConstraints.success,
			languagePack.initProjectConstraints.openEditableRules,
			languagePack.initProjectConstraints.openGeneratedSummary
		);

		if (action === languagePack.initProjectConstraints.openEditableRules) {
			const document = await vscode.workspace.openTextDocument(editablePath);
			await vscode.window.showTextDocument(document, { preview: false });
		} else if (action === languagePack.initProjectConstraints.openGeneratedSummary) {
			const document = await vscode.workspace.openTextDocument(generatedPath);
			await vscode.window.showTextDocument(document, { preview: false });
		}
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		log(`ERROR: Failed to initialize project constraints: ${message}`);
		vscode.window.showErrorMessage(languagePack.initProjectConstraints.failed(message));
	}
}

async function collectProjectConstraintReferenceSources(
	workspaceRoot: string,
): Promise<{ sources: ProjectConstraintReferenceSource[]; additionalInstructions?: string; } | undefined> {
	const languagePack = getLanguagePack();
	const sources: ProjectConstraintReferenceSource[] = [];
	const additionalInstructions: string[] = [];

	while (true) {
		const progress = languagePack.initProjectConstraints.referenceCollectionProgress(
			sources.length,
			additionalInstructions.length,
		);
		const referenceAction = await vscode.window.showQuickPick([
			{
				label: languagePack.initProjectConstraints.referenceSourceOptions.files.label,
				description: languagePack.initProjectConstraints.referenceSourceOptions.files.description,
				value: 'files' as const,
			},
			{
				label: languagePack.initProjectConstraints.referenceSourceOptions.notes.label,
				description: languagePack.initProjectConstraints.referenceSourceOptions.notes.description,
				value: 'notes' as const,
			},
			{
				label: languagePack.initProjectConstraints.referenceSourceOptions.finish.label,
				description: languagePack.initProjectConstraints.referenceSourceOptions.finish.description,
				value: 'finish' as const,
			},
		], {
			placeHolder: `${languagePack.initProjectConstraints.referenceSourcePlaceholder} ${progress}`,
			ignoreFocusOut: true,
		});
		if (!referenceAction) {
			return undefined;
		}

		if (referenceAction.value === 'finish') {
			break;
		}

		if (referenceAction.value === 'files') {
			const uris = await vscode.window.showOpenDialog({
				title: languagePack.initProjectConstraints.referenceFilesDialogTitle,
				canSelectMany: true,
				canSelectFiles: true,
				canSelectFolders: false,
				openLabel: languagePack.initProjectConstraints.referenceFilesOpenLabel,
			});
			if (uris === undefined) {
				return undefined;
			}
			for (const uri of uris) {
				const absolutePath = uri.fsPath;
				const relativePath = vscode.workspace.asRelativePath(uri, false);
				const note = await vscode.window.showInputBox({
					title: languagePack.initProjectConstraints.referenceFileNoteTitle(relativePath),
					prompt: languagePack.initProjectConstraints.referenceFileNotePrompt,
					placeHolder: languagePack.initProjectConstraints.referenceFileNotePlaceholder,
					ignoreFocusOut: true,
				});
				upsertProjectConstraintReferenceSource(sources, {
					label: relativePath,
					content: readProjectConstraintReferenceFile(absolutePath),
					note: note?.trim() || undefined,
				});
			}
			continue;
		}

		const note = await vscode.window.showInputBox({
			title: languagePack.initProjectConstraints.additionalNotesTitle,
			prompt: languagePack.initProjectConstraints.additionalNotesPrompt,
			ignoreFocusOut: true,
		});
		if (note === undefined) {
			return undefined;
		}
		const trimmed = note.trim();
		if (trimmed.length > 0) {
			additionalInstructions.push(trimmed);
		}
	}

	void workspaceRoot;
	return {
		sources,
		additionalInstructions: additionalInstructions.length > 0
			? additionalInstructions.join('\n\n')
			: undefined,
	};
}

function upsertProjectConstraintReferenceSource(
	sources: ProjectConstraintReferenceSource[],
	source: ProjectConstraintReferenceSource,
): void {
	const existingIndex = sources.findIndex(entry => entry.label === source.label);
	if (existingIndex >= 0) {
		sources[existingIndex] = source;
		return;
	}
	sources.push(source);
}

function readProjectConstraintReferenceFile(filePath: string): string {
	try {
		const content = fs.readFileSync(filePath, 'utf-8');
		const normalized = content.trim();
		if (normalized.length <= 4000) {
			return normalized;
		}
		return `${normalized.slice(0, 4000)}\n\n[Content truncated by Harness]`;
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return `[HARNESS could not read this file: ${message}]`;
	}
}

async function recordDesignContext(): Promise<void> {
	const languagePack = getLanguagePack();
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage(languagePack.common.noWorkspaceFolder);
		return;
	}

	const stories = getStoriesFromPrd(workspaceRoot);
	if (stories.length === 0) {
		vscode.window.showWarningMessage(languagePack.designContext.noStories);
		return;
	}

	const existingDrafts = listExistingDesignDrafts(workspaceRoot);
	const reusableDrafts = existingDrafts.filter(draft => draft.scope !== 'story');
	const pendingStories = getPendingStoriesForDesignMatching(workspaceRoot, stories);
	const action = await promptForDesignContextManagementAction(existingDrafts.length > 0);
	if (!action) {
		return;
	}

	if (action === 'create') {
		await createDesignDraftFromMenu(workspaceRoot);
		return;
	}

	if (action === 'delete') {
		await deleteExistingDesignDraft(existingDrafts);
		return;
	}

	await matchDesignDraftsToStories(workspaceRoot, reusableDrafts, pendingStories);
}

interface VisualDesignContextDraftTarget {
	scope: DesignContextScope;
	scopeId: string;
	label: string;
	filePath: string;
}

interface VisualDesignContextDraftInput {
	figmaUrl?: string;
	screenshotPaths: string[];
	referenceDocs: string[];
	additionalInstructions?: string;
}

interface DesignDraftRevisionInput extends VisualDesignContextDraftInput {
	seedArtifact: import('./types').DesignContextArtifact;
}

interface StoryDesignContextSuggestionInput {
	additionalInstructions?: string;
}

interface ExistingDesignDraft {
	scope: DesignContextScope;
	scopeId: string;
	filePath: string;
	artifact: import('./types').DesignContextArtifact;
}

type DesignContextManagementAction = 'create' | 'delete' | 'match';

async function generateVisualDesignContextDraft(): Promise<void> {
	const languagePack = getLanguagePack();
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage(languagePack.common.noWorkspaceFolder);
		return;
	}

	const stories = getStoriesFromPrd(workspaceRoot);
	if (stories.length === 0) {
		vscode.window.showWarningMessage(languagePack.designContext.noStories);
		return;
	}

	const selectedStory = await selectStoryForDesignContext(stories);
	if (!selectedStory) {
		return;
	}

	const target = await selectVisualDesignContextDraftTarget(workspaceRoot, selectedStory);
	if (!target) {
		return;
	}

	await runVisualDesignContextDraft(workspaceRoot, selectedStory, target);
}

async function runVisualDesignContextDraft(
	workspaceRoot: string,
	selectedStory: UserStory | undefined,
	target: VisualDesignContextDraftTarget,
	options?: {
		visualInputOverride?: VisualDesignContextDraftInput;
		existingContextLinesOverride?: string[];
	},
): Promise<void> {
	const languagePack = getLanguagePack();
	const visualInput = options?.visualInputOverride
		?? await collectVisualDesignContextDraftInput(workspaceRoot, selectedStory, target);
	if (!visualInput) {
		return;
	}

	const existingContextLines = options?.existingContextLinesOverride
		?? (selectedStory
			? summarizeDesignContextForPrompt(resolveDesignContextForStory(workspaceRoot, selectedStory))
			: summarizeDesignContextForPrompt(readDesignContextForScope(workspaceRoot, target.scope, target.scopeId)));

	if (!visualInput.figmaUrl && visualInput.screenshotPaths.length === 0 && existingContextLines.length === 0) {
		vscode.window.showWarningMessage(languagePack.designContext.draft.noVisualSources);
		return;
	}

	const taskId = createVisualDesignContextDraftTaskId(selectedStory?.id ?? target.scopeId, target.scope, target.scopeId);
	HarnessStateManager.clearStalledTask(workspaceRoot, taskId);

	const prompt = buildVisualDesignContextDraftPrompt({
		workspaceRoot,
		targetScope: target.scope,
		targetScopeId: target.scopeId,
		targetFilePath: target.filePath,
		completionSignalPath: resolveStoryStatusRegistryPath(workspaceRoot),
		completionSignalKey: taskId,
		story: selectedStory,
		figmaUrl: visualInput.figmaUrl,
		screenshotPaths: visualInput.screenshotPaths,
		referenceDocs: visualInput.referenceDocs,
		additionalInstructions: visualInput.additionalInstructions,
		existingContextLines,
	});

	log(`Generating visual design context draft for ${selectedStory?.id ?? target.scopeId} -> ${target.label}`);
	vscode.window.showInformationMessage(languagePack.designContext.draft.started(target.label));
	await openClineTaskWithPrompt(prompt, languagePack.designContext.draft.copiedPrompt);

	try {
		await waitForClineCompletion(taskId, workspaceRoot);
		HarnessStateManager.clearStalledTask(workspaceRoot, taskId);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		log(`ERROR: Visual design context draft generation failed for ${target.label}: ${message}`);
		vscode.window.showErrorMessage(languagePack.designContext.draft.failed(message));
		return;
	}

	const generatedDraft = readDesignContextForScope(workspaceRoot, target.scope, target.scopeId);
	if (!generatedDraft) {
		log(`ERROR: Cline completed the visual draft task but no artifact was found at ${target.filePath}`);
		vscode.window.showErrorMessage(languagePack.designContext.draft.missingArtifact(target.label));
		return;
	}

	const validation = validateDesignContext({
		...generatedDraft,
		scope: target.scope,
		scopeId: target.scopeId,
		figmaUrl: generatedDraft.figmaUrl ?? visualInput.figmaUrl,
		screenshotPaths: generatedDraft.screenshotPaths.length > 0 ? generatedDraft.screenshotPaths : visualInput.screenshotPaths,
		referenceDocs: generatedDraft.referenceDocs.length > 0 ? generatedDraft.referenceDocs : visualInput.referenceDocs,
	}, selectedStory?.id ?? target.scopeId);
	const filePath = writeDesignContextForScope(workspaceRoot, target.scope, target.scopeId, validation.artifact);
	log(`Visual design context draft saved for ${target.label}: ${filePath}`);

	if (!validation.isValid) {
		log(`Visual design context draft validation warnings for ${target.label}: ${validation.errors.join(' | ')}`);
	}

	const action = await vscode.window.showInformationMessage(
		languagePack.designContext.draft.saved(target.label, !validation.isValid),
		languagePack.designContext.open
	);

	if (action === languagePack.designContext.open) {
		const document = await vscode.workspace.openTextDocument(filePath);
		await vscode.window.showTextDocument(document, { preview: false });
	}
}

async function suggestStoryDesignContext(): Promise<void> {
	const languagePack = getLanguagePack();
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage(languagePack.common.noWorkspaceFolder);
		return;
	}

	const stories = getStoriesFromPrd(workspaceRoot);
	if (stories.length === 0) {
		vscode.window.showWarningMessage(languagePack.designContext.noStories);
		return;
	}

	const selectedStory = await selectStoryForDesignContext(stories);
	if (!selectedStory) {
		return;
	}

	const sharedContext = resolveSharedDesignContextForStory(workspaceRoot, selectedStory);
	if (!sharedContext) {
		vscode.window.showWarningMessage(languagePack.designContext.suggestion.noSharedContext(selectedStory.id));
		return;
	}

	const suggestionInput = await collectStoryDesignContextSuggestionInput();
	if (!suggestionInput) {
		return;
	}

	ensureDesignContextSuggestionDirectory(workspaceRoot);
	const suggestionPath = resolveDesignContextSuggestionPath(workspaceRoot, selectedStory.id);
	const taskId = `design-context-suggest-${selectedStory.id.toLowerCase()}`;
	HarnessStateManager.clearStalledTask(workspaceRoot, taskId);

	const prompt = buildStoryDesignContextSuggestionPrompt({
		workspaceRoot,
		targetFilePath: suggestionPath,
		completionSignalPath: resolveStoryStatusRegistryPath(workspaceRoot),
		completionSignalKey: taskId,
		story: selectedStory,
		sharedContextLines: summarizeDesignContextForPrompt(sharedContext),
		existingStoryContextLines: summarizeDesignContextForPrompt(readDesignContext(workspaceRoot, selectedStory.id)),
		additionalInstructions: suggestionInput.additionalInstructions,
	});

	log(`Generating story design context suggestion for ${selectedStory.id}`);
	vscode.window.showInformationMessage(languagePack.designContext.suggestion.started(selectedStory.id));
	await openClineTaskWithPrompt(prompt, languagePack.designContext.suggestion.copiedPrompt);

	try {
		await waitForClineCompletion(taskId, workspaceRoot);
		HarnessStateManager.clearStalledTask(workspaceRoot, taskId);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		log(`ERROR: Story design context suggestion failed for ${selectedStory.id}: ${message}`);
		vscode.window.showErrorMessage(languagePack.designContext.suggestion.failed(message));
		return;
	}

	const rawSuggestion = readJsonFile<Partial<import('./types').DesignContextArtifact>>(suggestionPath);
	if (!rawSuggestion) {
		log(`ERROR: Cline completed suggestion task but no suggestion artifact was found for ${selectedStory.id}`);
		vscode.window.showErrorMessage(languagePack.designContext.suggestion.missingArtifact(selectedStory.id));
		return;
	}

	const normalizedSuggestion = validateDesignContext({
		...rawSuggestion,
		storyId: selectedStory.id,
		scope: 'story',
		scopeId: selectedStory.id,
	}, selectedStory.id).artifact;
	const storyOverride = createStoryDesignContextOverride(selectedStory.id, normalizedSuggestion, sharedContext);
	const validation = validateDesignContext(storyOverride, selectedStory.id);
	const filePath = writeDesignContext(workspaceRoot, selectedStory.id, validation.artifact);
	log(`Story design context suggestion saved for ${selectedStory.id}: ${filePath}`);

	if (!validation.isValid) {
		log(`Story design context suggestion validation warnings for ${selectedStory.id}: ${validation.errors.join(' | ')}`);
	}

	const action = await vscode.window.showInformationMessage(
		languagePack.designContext.suggestion.saved(selectedStory.id, !validation.isValid),
		languagePack.designContext.open
	);

	if (action === languagePack.designContext.open) {
		const document = await vscode.workspace.openTextDocument(filePath);
		await vscode.window.showTextDocument(document, { preview: false });
	}
}

async function recallRelatedTaskMemory(): Promise<void> {
	const languagePack = getLanguagePack();
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage(languagePack.common.noWorkspaceFolder);
		return;
	}

	const targetStory = await selectStoryForTaskMemoryRecall(workspaceRoot);
	if (!targetStory) {
		return;
	}

	const config = getConfig();
	const matches = recallRelatedTaskMemories(workspaceRoot, targetStory, {
		limit: config.RECALLED_TASK_MEMORY_LIMIT,
	});

	if (matches.length === 0) {
		vscode.window.showInformationMessage(languagePack.taskMemoryRecall.noRelatedTaskMemories(targetStory.id));
		log(`No related task memories found for ${targetStory.id}.`);
		return;
	}

	const preview = renderRecalledTaskMemoryPreview(targetStory, matches);
	const document = await vscode.workspace.openTextDocument({
		content: preview,
		language: 'markdown',
	});
	await vscode.window.showTextDocument(document, { preview: false });
	log(`Previewed ${matches.length} recalled task memories for ${targetStory.id}.`);
}

async function selectStoryForTaskMemoryRecall(workspaceRoot: string): Promise<UserStory | undefined> {
	const languagePack = getLanguagePack();
	const prd = parsePrd(workspaceRoot);
	const nextPendingStory = prd ? findNextPendingStory(prd, workspaceRoot) : null;
	const stories = getStoriesFromPrd(workspaceRoot);

	const choice = await vscode.window.showQuickPick([
		...(nextPendingStory ? [{
			label: languagePack.taskMemoryRecall.nextPendingStoryLabel,
			description: languagePack.taskMemoryRecall.nextPendingStoryDescription(nextPendingStory.id, nextPendingStory.title),
			value: 'next' as const,
		}] : []),
		...(stories.length > 0 ? [{
			label: languagePack.taskMemoryRecall.chooseStoryLabel,
			description: languagePack.taskMemoryRecall.chooseStoryDescription,
			value: 'choose' as const,
		}] : []),
	], {
		placeHolder: languagePack.taskMemoryRecall.chooseStoryPlaceholder,
	});

	if (!choice) {
		return undefined;
	}

	if (choice.value === 'next') {
		return nextPendingStory ?? undefined;
	}

	const selected = await vscode.window.showQuickPick(
		stories.map(story => ({
			label: languagePack.common.storyFormat(story.id, story.title || languagePack.common.untitledStory),
			description: languagePack.common.statusPriority(getLocalizedStoryStatus(HarnessStateManager.getStoryExecutionStatus(workspaceRoot, story.id), languagePack.language), story.priority),
			detail: (story.description || '').trim() || languagePack.common.noDescription,
			story,
		})),
		{
			matchOnDescription: true,
			matchOnDetail: true,
			placeHolder: languagePack.taskMemoryRecall.previewPlaceholder,
		}
	);

	return selected?.story;
}

function renderRecalledTaskMemoryPreview(story: UserStory, matches: ReturnType<typeof recallRelatedTaskMemories>): string {
	const languagePack = getLanguagePack();
	const lines = [`# ${languagePack.taskMemoryRecall.previewTitle}`, '', languagePack.taskMemoryRecall.previewStory(story.id, story.title), ''];
	for (const match of matches) {
		lines.push(`## ${match.memory.storyId} — ${match.memory.title}`);
		lines.push(languagePack.taskMemoryRecall.previewScore(match.score));
		lines.push(languagePack.taskMemoryRecall.previewReasons(match.reasons));
		if (match.memory.summary) {
			lines.push(languagePack.taskMemoryRecall.previewSummary(match.memory.summary));
		}
		if (match.memory.keyDecisions.length > 0) {
			lines.push(languagePack.taskMemoryRecall.previewKeyDecisions);
			for (const decision of match.memory.keyDecisions.slice(0, 3)) {
				lines.push(`- ${decision}`);
			}
		}
		if (match.memory.changedFiles.length > 0) {
			lines.push(languagePack.taskMemoryRecall.previewChangedFiles);
			for (const changedFile of match.memory.changedFiles.slice(0, 3)) {
				lines.push(`- ${changedFile}`);
			}
		}
		lines.push('');
	}

	return lines.join('\n').trimEnd();
}

async function selectStoryForDesignContext(stories: UserStory[]): Promise<UserStory | undefined> {
	const languagePack = getLanguagePack();
	const selected = await vscode.window.showQuickPick(
		stories.map(story => ({
			label: languagePack.common.storyFormat(story.id, story.title || languagePack.common.untitledStory),
			description: languagePack.common.statusPriority(getLocalizedStoryStatus(normalizeStoryExecutionStatus(story.status) || 'none', languagePack.language), story.priority),
			detail: (story.description || '').trim() || languagePack.common.noDescription,
			story,
		})),
		{
			matchOnDescription: true,
			matchOnDetail: true,
			placeHolder: languagePack.designContext.selectStoryPlaceholder,
		}
	);

	return selected?.story;
}

async function selectVisualDesignContextDraftTarget(
	workspaceRoot: string,
	story?: UserStory,
	allowedScopes: ReadonlyArray<DesignContextScope> = ['story', 'screen', 'module', 'project'],
): Promise<VisualDesignContextDraftTarget | undefined> {
	const languagePack = getLanguagePack();
	const scopeOptions = [
		...(allowedScopes.includes('story') ? [{
			label: languagePack.designContext.draft.scopeOptions.story.label,
			description: languagePack.designContext.draft.scopeOptions.story.description,
			value: 'story' as const,
		}] : []),
		...(allowedScopes.includes('screen') ? [{
			label: languagePack.designContext.draft.scopeOptions.screen.label,
			description: languagePack.designContext.draft.scopeOptions.screen.description,
			value: 'screen' as const,
		}] : []),
		...(allowedScopes.includes('module') ? [{
			label: languagePack.designContext.draft.scopeOptions.module.label,
			description: languagePack.designContext.draft.scopeOptions.module.description,
			value: 'module' as const,
		}] : []),
		...(allowedScopes.includes('project') ? [{
			label: languagePack.designContext.draft.scopeOptions.project.label,
			description: languagePack.designContext.draft.scopeOptions.project.description,
			value: 'project' as const,
		}] : []),
	];
	const pickedScope = await vscode.window.showQuickPick(scopeOptions, {
		placeHolder: languagePack.designContext.draft.scopePlaceholder,
	});

	if (!pickedScope) {
		return undefined;
	}

	if (pickedScope.value === 'project') {
		return {
			scope: 'project',
			scopeId: 'project',
			label: languagePack.designContext.draft.scopeOptions.project.label,
			filePath: resolveProjectDesignContextPath(workspaceRoot),
		};
	}

	if (pickedScope.value === 'story') {
		if (!story) {
			return undefined;
		}
		return {
			scope: 'story',
			scopeId: story.id,
			label: `${pickedScope.label} — ${story.id}`,
			filePath: resolveDesignContextPath(workspaceRoot, story.id),
		};
	}

	const scopeId = await vscode.window.showInputBox({
		title: pickedScope.value === 'screen'
			? languagePack.designContext.draft.screenIdTitle
			: languagePack.designContext.draft.moduleIdTitle,
		prompt: pickedScope.value === 'screen'
			? languagePack.designContext.draft.screenIdPrompt
			: languagePack.designContext.draft.moduleIdPrompt,
		value: getDefaultDraftScopeId(story, pickedScope.value),
		ignoreFocusOut: true,
	});

	if (scopeId === undefined || scopeId.trim().length === 0) {
		return undefined;
	}

	const normalizedScopeId = scopeId.trim();
	return {
		scope: pickedScope.value,
		scopeId: normalizedScopeId,
		label: `${pickedScope.label} — ${normalizedScopeId}`,
		filePath: pickedScope.value === 'screen'
			? resolveScreenDesignContextPath(workspaceRoot, normalizedScopeId)
			: resolveModuleDesignContextPath(workspaceRoot, normalizedScopeId),
	};
}

function getDefaultDraftScopeId(story: UserStory | undefined, scope: 'screen' | 'module'): string {
	if (!story) {
		return scope === 'screen' ? 'default-screen' : 'default-module';
	}

	if (scope === 'screen') {
		for (const key of ['screenId', 'screenName', 'page', 'pageName', 'pageOrScreenName', 'screen']) {
			const value = story[key];
			if (typeof value === 'string' && value.trim().length > 0) {
				return value.trim();
			}
		}
		return story.title;
	}

	for (const key of ['module', 'moduleName']) {
		const value = story[key];
		if (typeof value === 'string' && value.trim().length > 0) {
			return value.trim();
		}
	}

	if (Array.isArray(story.moduleHints)) {
		for (const value of story.moduleHints) {
			if (typeof value === 'string' && value.trim().length > 0) {
				return value.trim();
			}
		}
	}

	return story.title;
}

async function promptForDesignSourceType(): Promise<'figma' | 'screenshots' | 'notes' | undefined> {
	const languagePack = getLanguagePack();
	const picked = await vscode.window.showQuickPick([
		{
			label: languagePack.designContext.sources.figma.label,
			description: languagePack.designContext.sources.figma.description,
			value: 'figma' as const,
		},
		{
			label: languagePack.designContext.sources.screenshots.label,
			description: languagePack.designContext.sources.screenshots.description,
			value: 'screenshots' as const,
		},
		{
			label: languagePack.designContext.sources.notes.label,
			description: languagePack.designContext.sources.notes.description,
			value: 'notes' as const,
		},
	], {
		placeHolder: languagePack.designContext.sourcePlaceholder,
	});

	return picked?.value;
}

async function promptForDesignContextManagementAction(hasDrafts: boolean): Promise<DesignContextManagementAction | undefined> {
	const languagePack = getLanguagePack();
	const picked = await vscode.window.showQuickPick([
		{
			label: hasDrafts
				? languagePack.designContext.managementActions.create.label
				: languagePack.designContext.managementActions.createFirst.label,
			description: hasDrafts
				? languagePack.designContext.managementActions.create.description
				: languagePack.designContext.managementActions.createFirst.description,
			value: 'create' as const,
		},
		...(hasDrafts ? [{
			label: languagePack.designContext.managementActions.delete.label,
			description: languagePack.designContext.managementActions.delete.description,
			value: 'delete' as const,
		}] : []),
		...(hasDrafts ? [{
			label: languagePack.designContext.managementActions.match.label,
			description: languagePack.designContext.managementActions.match.description,
			value: 'match' as const,
		}] : []),
	], {
		placeHolder: hasDrafts
			? languagePack.designContext.managementPlaceholder
			: languagePack.designContext.createFirstPlaceholder,
	});

	return picked?.value;
}

async function promptForSharedDesignContextTargets(
	targets: ReturnType<typeof listAvailableSharedDesignContextTargets>,
	currentReferences: string[],
): Promise<ReturnType<typeof listAvailableSharedDesignContextTargets> | undefined> {
	const languagePack = getLanguagePack();
	const currentReferenceSet = new Set(currentReferences);
	const picked = await vscode.window.showQuickPick(
		targets.map(target => ({
			label: getSharedDesignContextTargetLabel(target.scope, target.scopeId),
			description: summarizeSharedDesignContextTarget(target.artifact),
			picked: currentReferenceSet.has(`${target.scope}:${target.scopeId}`),
			target,
		})),
		{
			canPickMany: true,
			matchOnDescription: true,
			placeHolder: languagePack.designContext.linkTargetPlaceholder,
		}
	);

	if (picked === undefined) {
		return undefined;
	}

	return picked.map(item => item.target);
}

function getSharedDesignContextTargetLabel(scope: 'project' | 'screen' | 'module', scopeId: string): string {
	if (scope === 'project') {
		return '$(layers) Project Defaults';
	}
	if (scope === 'screen') {
		return `$(browser) Screen: ${scopeId}`;
	}
	return `$(symbol-module) Module: ${scopeId}`;
}

function summarizeSharedDesignContextTarget(artifact: import('./types').DesignContextArtifact): string {
	const summaryParts = [artifact.summary, artifact.pageOrScreenName]
		.map(value => value?.trim())
		.filter((value): value is string => Boolean(value));
	if (summaryParts.length > 0) {
		return summaryParts.join(' | ');
	}
	if (artifact.layoutConstraints.length > 0) {
		return artifact.layoutConstraints.slice(0, 2).join('; ');
	}
	if (artifact.acceptanceChecks.length > 0) {
		return artifact.acceptanceChecks.slice(0, 2).join('; ');
	}
	return `Source: ${artifact.sourceType}`;
}

function listExistingDesignDrafts(workspaceRoot: string): ExistingDesignDraft[] {
	const drafts: ExistingDesignDraft[] = [];
	const designContextDir = path.join(resolvePrdDirectoryPath(workspaceRoot), 'design-context');
	const sharedDir = path.join(designContextDir, 'shared');

	if (fs.existsSync(sharedDir)) {
		for (const entry of fs.readdirSync(sharedDir)) {
			if (!entry.endsWith('.design.json')) {
				continue;
			}

			let scope: DesignContextScope | null = null;
			if (entry === 'project.design.json') {
				scope = 'project';
			} else if (entry.startsWith('screen-')) {
				scope = 'screen';
			} else if (entry.startsWith('module-')) {
				scope = 'module';
			}
			if (!scope) {
				continue;
			}

			const filePath = path.join(sharedDir, entry);
			const artifact = validateDesignContext(
				JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<import('./types').DesignContextArtifact>,
				scope === 'project' ? 'project' : entry.replace(/\.design\.json$/i, ''),
			).artifact;
			if (!artifact) {
				continue;
			}

			drafts.push({
				scope,
				scopeId: artifact.scopeId ?? (scope === 'project' ? 'project' : entry.replace('.design.json', '')),
				filePath,
				artifact,
			});
		}
	}

	if (fs.existsSync(designContextDir)) {
		for (const entry of fs.readdirSync(designContextDir)) {
			if (!entry.endsWith('.design.json') || entry === 'shared') {
				continue;
			}

			const storyId = entry.replace(/\.design\.json$/i, '');
			const filePath = path.join(designContextDir, entry);
			const artifact = readDesignContext(workspaceRoot, storyId);
			if (!artifact) {
				continue;
			}

			drafts.push({
				scope: 'story',
				scopeId: storyId,
				filePath,
				artifact,
			});
		}
	}

	return drafts.sort((left, right) => {
		const order: Record<DesignContextScope, number> = { project: 0, screen: 1, module: 2, story: 3 };
		if (order[left.scope] !== order[right.scope]) {
			return order[left.scope] - order[right.scope];
		}
		return left.scopeId.localeCompare(right.scopeId, undefined, { sensitivity: 'base' });
	});
}

function getPendingStoriesForDesignMatching(workspaceRoot: string, stories: UserStory[]): UserStory[] {
	void workspaceRoot;
	return stories.filter(story => normalizeStoryExecutionStatus(story.status) !== 'completed');
}

async function createDesignDraftFromMenu(workspaceRoot: string): Promise<void> {
	const target = await selectVisualDesignContextDraftTarget(workspaceRoot, undefined, ['project', 'screen', 'module']);
	if (!target) {
		return;
	}

	await runVisualDesignContextDraft(workspaceRoot, undefined, target);
	log(`Created UI design draft from menu for ${target.label}`);
}

async function deleteExistingDesignDraft(existingDrafts: ExistingDesignDraft[]): Promise<void> {
	const languagePack = getLanguagePack();
	const draft = await promptForExistingDesignDraft(existingDrafts);
	if (!draft) {
		return;
	}

	const label = getExistingDesignDraftLabel(draft);
	const confirm = await vscode.window.showWarningMessage(
		languagePack.designContext.deleteConfirm(label),
		{ modal: true },
		languagePack.designContext.deleteAction
	);
	if (confirm !== languagePack.designContext.deleteAction) {
		return;
	}

	fs.unlinkSync(draft.filePath);
	log(`Deleted design draft: ${draft.filePath}`);
	vscode.window.showInformationMessage(languagePack.designContext.deleted(label));
}

async function matchDesignDraftsToStories(
	workspaceRoot: string,
	reusableDrafts: ExistingDesignDraft[],
	pendingStories: UserStory[],
): Promise<void> {
	const languagePack = getLanguagePack();
	if (reusableDrafts.length === 0) {
		vscode.window.showWarningMessage(languagePack.designContext.noReusableDrafts);
		return;
	}
	if (pendingStories.length === 0) {
		vscode.window.showInformationMessage(languagePack.designContext.noPendingStories);
		return;
	}

	const selectedDrafts = await promptForReusableDraftsToMatch(reusableDrafts);
	if (!selectedDrafts || selectedDrafts.length === 0) {
		return;
	}

	const selectedStories = await promptForStoriesToMatch(workspaceRoot, pendingStories);
	if (!selectedStories || selectedStories.length === 0) {
		return;
	}

	ensureDesignContextSuggestionDirectory(workspaceRoot);
	const taskId = `design-context-match-${Date.now()}`;
	const matchPlanPath = path.join(ensureDesignContextSuggestionDirectory(workspaceRoot), `${taskId}.json`);
	HarnessStateManager.clearStalledTask(workspaceRoot, taskId);

	const allowedReferences = selectedDrafts.map(draft => `${draft.scope}:${draft.scopeId}`);
	const prompt = buildStoryDesignContextBatchMatchPrompt({
		workspaceRoot,
		targetFilePath: matchPlanPath,
		completionSignalPath: resolveStoryStatusRegistryPath(workspaceRoot),
		completionSignalKey: taskId,
		candidateStories: selectedStories,
		candidateDrafts: selectedDrafts.map(draft => ({
			reference: `${draft.scope}:${draft.scopeId}`,
			summaryLines: summarizeDesignContextForPrompt(draft.artifact),
		})),
	});

	log(`Generating AI-guided design-story matches for ${selectedStories.length} candidate stories using ${selectedDrafts.length} reusable drafts.`);
	vscode.window.showInformationMessage(languagePack.designContext.matching.started(selectedStories.length, selectedDrafts.length));
	await openClineTaskWithPrompt(prompt, languagePack.designContext.matching.copiedPrompt);

	try {
		await waitForClineCompletion(taskId, workspaceRoot);
		HarnessStateManager.clearStalledTask(workspaceRoot, taskId);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		log(`ERROR: Design draft matching failed: ${message}`);
		vscode.window.showErrorMessage(languagePack.designContext.matching.failed(message));
		return;
	}

	const rawMatchPlan = readJsonFile<unknown>(matchPlanPath);
	if (!rawMatchPlan) {
		log('ERROR: Cline completed design matching task but no match plan artifact was found.');
		vscode.window.showErrorMessage(languagePack.designContext.matching.missingArtifact);
		return;
	}

	const normalizedMatchPlan = normalizeStoryDesignContextBatchMatchResult(rawMatchPlan, selectedStories, allowedReferences);
	if (normalizedMatchPlan.matches.length === 0) {
		vscode.window.showInformationMessage(languagePack.designContext.matching.noRelevantMatches(selectedStories.length));
		return;
	}

	await applyDesignDraftMatches(workspaceRoot, selectedStories, selectedDrafts, normalizedMatchPlan);

	vscode.window.showInformationMessage(languagePack.designContext.matching.completed(
		normalizedMatchPlan.matches.length,
		selectedStories.length,
		selectedDrafts.length,
	));
}


async function applyDesignDraftMatches(
	workspaceRoot: string,
	selectedStories: UserStory[],
	selectedDrafts: ExistingDesignDraft[],
	normalizedMatchPlan: ReturnType<typeof normalizeStoryDesignContextBatchMatchResult>,
): Promise<void> {
	for (const match of normalizedMatchPlan.matches) {
		const story = selectedStories.find(candidate => candidate.id === match.storyId);
		if (!story) {
			continue;
		}

		const existingContext = readDesignContext(workspaceRoot, story.id);
		const availableTargets = listAvailableSharedDesignContextTargets(workspaceRoot, story);
		const preservedTargets = availableTargets.filter(target => (existingContext?.inheritsFrom ?? []).includes(`${target.scope}:${target.scopeId}`));
		const mergedTargetsMap = new Map<string, ReturnType<typeof listAvailableSharedDesignContextTargets>[number]>();
		for (const target of [...preservedTargets, ...selectedDrafts
			.filter(draft => match.linkedReferences.includes(`${draft.scope}:${draft.scopeId}`))
			.map(draft => ({
			scope: draft.scope as 'project' | 'screen' | 'module',
			scopeId: draft.scopeId,
			artifact: draft.artifact,
		}))]) {
			mergedTargetsMap.set(`${target.scope}:${target.scopeId}`, target);
		}

		const mergedTargets = Array.from(mergedTargetsMap.values());
		const linkedReferences = mergedTargets.map(target => `${target.scope}:${target.scopeId}`);
		const linkedSharedContext = mergeSharedDesignContextTargets(story.id, mergedTargets);
		const draft = createReviewStoryDesignContextDraft(story, {
			existingContext,
			sharedContext: linkedSharedContext,
			linkedReferences,
		});
		const validation = validateDesignContext(draft, story.id);
		const filePath = writeDesignContext(workspaceRoot, story.id, validation.artifact);
		log(`Matched UI design drafts to ${story.id}: ${filePath}`);
		if (match.reason) {
			log(`Design draft match rationale for ${story.id}: ${match.reason}`);
		}
		if (!validation.isValid) {
			log(`UI design note warnings for ${story.id}: ${validation.errors.join(' | ')}`);
		}
	}
}

async function promptForExistingDesignDraft(
	existingDrafts: ExistingDesignDraft[],
): Promise<ExistingDesignDraft | undefined> {
	const languagePack = getLanguagePack();
	const picked = await vscode.window.showQuickPick(
		existingDrafts.map(draft => ({
			label: getExistingDesignDraftLabel(draft),
			description: summarizeSharedDesignContextTarget(draft.artifact),
			detail: draft.filePath,
			draft,
		})),
		{
			matchOnDescription: true,
			matchOnDetail: true,
			placeHolder: languagePack.designContext.deletePlaceholder,
		}
	);

	return picked?.draft;
}

async function promptForReusableDraftsToMatch(existingDrafts: ExistingDesignDraft[]): Promise<ExistingDesignDraft[] | undefined> {
	const languagePack = getLanguagePack();
	const picked = await vscode.window.showQuickPick(
		existingDrafts.map(draft => ({
			label: getExistingDesignDraftLabel(draft),
			description: summarizeSharedDesignContextTarget(draft.artifact),
			detail: draft.filePath,
			draft,
		})),
		{
			canPickMany: true,
			matchOnDescription: true,
			matchOnDetail: true,
			placeHolder: languagePack.designContext.matchDraftPlaceholder,
		}
	);

	if (picked === undefined) {
		return undefined;
	}

	return picked.map(item => item.draft);
}

async function promptForStoriesToMatch(workspaceRoot: string, stories: UserStory[]): Promise<UserStory[] | undefined> {
	const languagePack = getLanguagePack();
	return new Promise(resolve => {
		const quickPick = vscode.window.createQuickPick<{
			label: string;
			description?: string;
			detail?: string;
			story?: UserStory;
			value: 'all' | 'story';
		}>();
		let resolved = false;

		const finish = (result: UserStory[] | undefined) => {
			if (resolved) {
				return;
			}
			resolved = true;
			quickPick.dispose();
			resolve(result);
		};

		quickPick.canSelectMany = true;
		quickPick.matchOnDescription = true;
		quickPick.matchOnDetail = true;
		quickPick.placeholder = languagePack.designContext.matchStoryPlaceholder;
		quickPick.items = [
			{
				label: languagePack.designContext.matchAllPending.label,
				description: languagePack.designContext.matchAllPending.description(stories.length),
				value: 'all',
			},
			...stories.map(story => ({
				label: languagePack.common.storyFormat(story.id, story.title || languagePack.common.untitledStory),
				description: languagePack.common.statusPriority(getLocalizedStoryStatus(normalizeStoryExecutionStatus(story.status) || 'none', languagePack.language), story.priority),
				detail: (story.description || '').trim() || languagePack.common.noDescription,
				story,
				value: 'story' as const,
			})),
		];

		quickPick.onDidChangeSelection(selection => {
			if (selection.some(item => item.value === 'all')) {
				quickPick.hide();
				finish(stories);
			}
		});

		quickPick.onDidAccept(() => {
			const selectedStories = quickPick.selectedItems
				.filter(item => item.value === 'story' && item.story)
				.map(item => item.story as UserStory);
			quickPick.hide();
			finish(selectedStories);
		});

		quickPick.onDidHide(() => finish(undefined));
		quickPick.show();
	});
}

function getExistingDesignDraftLabel(draft: ExistingDesignDraft): string {
	const languagePack = getLanguagePack();
	if (draft.scope === 'project') {
		return languagePack.designContext.draft.scopeOptions.project.label;
	}
	if (draft.scope === 'screen') {
		return `${languagePack.designContext.draft.scopeOptions.screen.label} - ${draft.scopeId}`;
	}
	if (draft.scope === 'module') {
		return `${languagePack.designContext.draft.scopeOptions.module.label} - ${draft.scopeId}`;
	}
	return `${languagePack.designContext.draft.scopeOptions.story.label} - ${draft.scopeId}`;
}

async function saveStoryDesignContextArtifact(
	workspaceRoot: string,
	storyId: string,
	validation: ReturnType<typeof validateDesignContext>,
	messageFactory: (validation: ReturnType<typeof validateDesignContext>) => string,
): Promise<void> {
	const languagePack = getLanguagePack();
	const filePath = writeDesignContext(workspaceRoot, storyId, validation.artifact);
	log(`Design context saved for ${storyId}: ${filePath}`);

	if (!validation.isValid) {
		log(`Design context validation warnings for ${storyId}: ${validation.errors.join(' | ')}`);
	}

	const action = await vscode.window.showInformationMessage(
		messageFactory(validation),
		languagePack.designContext.open
	);

	if (action === languagePack.designContext.open) {
		const document = await vscode.workspace.openTextDocument(filePath);
		await vscode.window.showTextDocument(document, { preview: false });
	}
}

async function collectVisualDesignContextDraftInput(
	workspaceRoot: string,
	story: UserStory | undefined,
	target: VisualDesignContextDraftTarget,
): Promise<VisualDesignContextDraftInput | undefined> {
	const languagePack = getLanguagePack();
	const existing = readDesignContextForScope(workspaceRoot, target.scope, target.scopeId)
		?? (target.scope === 'story' && story ? readDesignContext(workspaceRoot, story.id) : null);

	const inputMode = await vscode.window.showQuickPick([
		{
			label: languagePack.designContext.draft.inputModes.figma.label,
			description: languagePack.designContext.draft.inputModes.figma.description,
			value: 'figma' as const,
		},
		{
			label: languagePack.designContext.draft.inputModes.screenshots.label,
			description: languagePack.designContext.draft.inputModes.screenshots.description,
			value: 'screenshots' as const,
		},
		{
			label: languagePack.designContext.draft.inputModes.both.label,
			description: languagePack.designContext.draft.inputModes.both.description,
			value: 'both' as const,
		},
	], {
		placeHolder: languagePack.designContext.draft.inputModePlaceholder,
	});

	if (!inputMode) {
		return undefined;
	}

	let figmaUrl = existing?.figmaUrl;
	if (inputMode.value === 'figma' || inputMode.value === 'both') {
		const nextValue = await promptForTextValue(
			languagePack.designContext.draft.figmaUrlTitle,
			languagePack.designContext.draft.figmaUrlPrompt,
			existing?.figmaUrl,
		);
		if (nextValue === undefined) {
			return undefined;
		}
		figmaUrl = nextValue.trim() || undefined;
	}

	let screenshotPaths = existing?.screenshotPaths ?? [];
	if (inputMode.value === 'screenshots' || inputMode.value === 'both') {
		const uris = await vscode.window.showOpenDialog({
			title: languagePack.designContext.draft.screenshotDialogTitle,
			canSelectMany: true,
			canSelectFiles: true,
			canSelectFolders: false,
			filters: { Images: ['png', 'jpg', 'jpeg', 'webp'] },
			openLabel: languagePack.designContext.draft.screenshotOpenLabel,
		});
		if (uris === undefined) {
			return undefined;
		}
		screenshotPaths = uris.map(uri => vscode.workspace.asRelativePath(uri, false));
	}

	const referenceDocs = await promptForListValue(
		languagePack.designContext.input.referenceDocsTitle,
		languagePack.designContext.input.referenceDocsPrompt,
		existing?.referenceDocs ?? []
	);
	if (referenceDocs === undefined) {
		return undefined;
	}

	const additionalInstructions = await promptForTextValue(
		languagePack.designContext.draft.additionalInstructionsTitle,
		languagePack.designContext.draft.additionalInstructionsPrompt,
		''
	);
	if (additionalInstructions === undefined) {
		return undefined;
	}

	return {
		figmaUrl,
		screenshotPaths,
		referenceDocs,
		additionalInstructions: additionalInstructions.trim() || undefined,
	};
}

function createVisualDesignContextDraftTaskId(storyId: string, scope: DesignContextScope, scopeId: string): string {
	const normalizedScopeId = scopeId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'default';
	return `design-context-draft-${storyId.toLowerCase()}-${scope}-${normalizedScopeId}`;
}

async function collectStoryDesignContextSuggestionInput(): Promise<StoryDesignContextSuggestionInput | undefined> {
	const languagePack = getLanguagePack();
	const additionalInstructions = await promptForTextValue(
		languagePack.designContext.suggestion.additionalInstructionsTitle,
		languagePack.designContext.suggestion.additionalInstructionsPrompt,
		''
	);
	if (additionalInstructions === undefined) {
		return undefined;
	}

	return {
		additionalInstructions: additionalInstructions.trim() || undefined,
	};
}

async function promptForTextValue(title: string, prompt: string, currentValue?: string): Promise<string | undefined> {
	return vscode.window.showInputBox({
		title,
		prompt,
		value: currentValue ?? '',
		ignoreFocusOut: true,
	});
}

async function promptForListValue(title: string, prompt: string, currentValue: string[]): Promise<string[] | undefined> {
	const rawValue = await vscode.window.showInputBox({
		title,
		prompt,
		value: currentValue.join(', '),
		ignoreFocusOut: true,
	});

	if (rawValue === undefined) {
		return undefined;
	}

	return rawValue
		.split(/[\n,;]+/)
		.map(item => item.trim())
		.filter(item => item.length > 0);
}

async function appendUserStories(): Promise<void> {
	const languagePack = getLanguagePack();
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage(languagePack.common.noWorkspaceFolder);
		return;
	}

	const prd = parsePrd(workspaceRoot);
	if (!prd) {
		vscode.window.showWarningMessage(languagePack.appendStories.missingPrd);
		return;
	}

	const request = await vscode.window.showInputBox({
		title: languagePack.appendStories.requestTitle,
		prompt: languagePack.appendStories.requestPrompt,
		placeHolder: languagePack.appendStories.requestPlaceholder,
		ignoreFocusOut: true,
	});

	if (!request || request.trim().length === 0) {
		vscode.window.showWarningMessage(languagePack.appendStories.requestCancelled);
		return;
	}

	const prompt = buildAppendUserStoriesPrompt(request.trim(), workspaceRoot, prd);
	log(`Append user stories request: ${request.trim()}`);
	await openClineTaskWithPrompt(prompt, languagePack.appendStories.copiedPrompt);
	vscode.window.showInformationMessage(languagePack.appendStories.started);
	log('Append user stories prompt sent to Cline. Waiting for prd.json update…');
}

function buildAppendUserStoriesPrompt(request: string, workspaceRoot: string, prd: PrdFile): string {
	const languagePack = getLanguagePack();
	const nextStoryId = getNextUserStoryIdFromPrd(prd.userStories);
	const nextPriority = prd.userStories.length > 0
		? Math.max(...prd.userStories.map(story => Number(story.priority) || 0)) + 1
		: 1;
	const hasGitRepo = isGitRepository(workspaceRoot);
	const autoCommitEnabled = getConfig().AUTO_COMMIT_GIT;

	const storySummaryLines = prd.userStories.length > 0
		? prd.userStories
			.slice()
			.sort(compareStoriesByPriority)
			.map(story => `- ${story.id} [P${story.priority}] ${story.title}`)
		: [languagePack.appendStories.prompt.noExistingStories];

	return [
		languagePack.appendStories.prompt.workspaceAnalysis,
		languagePack.appendStories.prompt.requestLine(request),
		languagePack.appendStories.prompt.workspaceRootLine(workspaceRoot),
		languagePack.appendStories.prompt.currentProjectLine(prd.project),
		languagePack.appendStories.prompt.currentBranchLine(prd.branchName),
		languagePack.appendStories.prompt.currentStoryCountLine(prd.userStories.length),
		languagePack.appendStories.prompt.gitModeLine(hasGitRepo, autoCommitEnabled),
		languagePack.appendStories.prompt.readCurrentPrd,
		languagePack.appendStories.prompt.nextStoryLine(nextStoryId, nextPriority),
		'',
		languagePack.appendStories.prompt.existingStoriesHeading,
		...storySummaryLines,
		'',
		languagePack.appendStories.prompt.instructionsHeading,
		`- ${languagePack.appendStories.prompt.appendOnlyInstruction}`,
		`- ${languagePack.appendStories.prompt.preserveExisting}`,
		`- ${languagePack.appendStories.prompt.numberStories}`,
		`- ${languagePack.appendStories.prompt.sequentialPriority}`,
		`- ${languagePack.appendStories.prompt.noPassesOrNotes}`,
		`- ${languagePack.appendStories.prompt.noSeparateGitStories}`,
		`- ${languagePack.appendStories.prompt.storyLevelGitInstruction}`,
		`- ${languagePack.appendStories.prompt.directWriteInstruction}`,
	].join('\n');
}

// ── Utilities ───────────────────────────────────────────────────────────────

function getWorkspaceRoot(): string | undefined {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) { return undefined; }
	// Use the first workspace folder
	return folders[0].uri.fsPath;
}

function log(message: string): void {
	const timestamp = new Date().toISOString().slice(11, 19);
	outputChannel.appendLine(`[${timestamp}] ${message}`);
	activeRunLog?.recordOutput(message);
}

function sleep(ms: number): Promise<void> {
	return new Promise<void>(resolve => {
		setTimeout(resolve, ms);
	});
}

function updateStatusBar(state: 'idle' | 'running'): void {
	if (!statusBarItem) { return; }
	const languagePack = getLanguagePack();
	const workspaceRoot = getWorkspaceRoot();
	if (state === 'running') {
		statusBarItem.text = languagePack.statusBar.runningText;
		statusBarItem.tooltip = languagePack.statusBar.runningTooltip;
		statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
	} else {
		const pendingApprovals = workspaceRoot ? getPendingApprovalCandidates(workspaceRoot).length : 0;
		if (pendingApprovals > 0) {
			statusBarItem.text = languagePack.statusBar.pendingApprovalsText(pendingApprovals);
			statusBarItem.tooltip = languagePack.statusBar.pendingApprovalsTooltip(pendingApprovals);
			statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
		} else {
			statusBarItem.text = languagePack.statusBar.idleText;
			statusBarItem.tooltip = languagePack.statusBar.idleTooltip;
			statusBarItem.backgroundColor = undefined;
		}
	}
}

async function showCommandMenu(): Promise<void> {
	const languagePack = getLanguagePack();
	let menuStack = [languagePack.menu.rootId];

	while (menuStack.length > 0) {
		const currentMenuId = menuStack[menuStack.length - 1];
		const currentMenu = getHarnessMenuNode(languagePack, currentMenuId);
		const selected = await vscode.window.showQuickPick(buildHarnessMenuQuickPickItems(languagePack, currentMenuId), {
			placeHolder: currentMenu.placeholder,
			matchOnDescription: true,
		});

		if (!selected) {
			return;
		}

		const resolution = resolveHarnessMenuSelection(languagePack, menuStack, selected.menuItem);
		if (resolution.command) {
			await vscode.commands.executeCommand(resolution.command);
			return;
		}
		if (resolution.exitMenu) {
			return;
		}
		menuStack = resolution.nextMenuStack;
	}
}

async function customizeMenuOrder(): Promise<void> {
	const languagePack = getLanguagePack();
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showWarningMessage(languagePack.common.noWorkspaceFolder);
		return;
	}
	const orderedTargets = await showHarnessMenuOrderEditor(
		languagePack,
		buildHarnessRootMenuOrderEditorItems(languagePack),
	);
	if (!orderedTargets) {
		return;
	}

	persistWorkspacePinnedRootMenuOrderFile(workspaceRoot, orderedTargets);
	await vscode.workspace.getConfiguration('harness-runner').update(
		HARNESS_ROOT_MENU_ORDER_SETTING,
		orderedTargets,
		vscode.ConfigurationTarget.Workspace,
	);
	vscode.window.showInformationMessage(languagePack.menu.customizeOrder.saved);
}

function showGuideDocument(): void {
	const languagePack = getLanguagePack();
	const document = buildHarnessGuideDocument(languagePack.language);
	const panel = vscode.window.createWebviewPanel(
		'harnessGuide',
		document.title,
		vscode.ViewColumn.Active,
		{
			enableFindWidget: true,
			retainContextWhenHidden: true,
		}
	);

	panel.iconPath = new vscode.ThemeIcon('library');
	panel.webview.html = document.html;
}

async function configurePolicyGates(): Promise<void> {
	const languagePack = getLanguagePack();
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage(languagePack.common.noWorkspaceFolder);
		return;
	}

	const cfg = vscode.workspace.getConfiguration('harness-runner');
	const effectivePolicyConfig = buildEffectivePolicyConfig(cfg.get<unknown>('policyGates', undefined), {
		requireProjectConstraintsBeforeRun: cfg.get<boolean>('requireProjectConstraintsBeforeRun', false),
		requireDesignContextForTaggedStories: cfg.get<boolean>('requireDesignContextForTaggedStories', false),
	});
	const currentConfig = getConfig();
	const currentEnabledRuleIds = new Set(getEnabledBuiltinPolicyRuleIds(effectivePolicyConfig));

	const rules: PolicyRuleItem[] = [
		{
			id: 'require-project-constraints',
			label: languagePack.policyConfig.ruleLabels.requireProjectConstraints,
			description: languagePack.policyConfig.ruleDescriptions.requireProjectConstraints,
			enabled: currentEnabledRuleIds.has('require-project-constraints'),
			phase: 'preflight',
		},
		{
			id: 'require-design-context',
			label: languagePack.policyConfig.ruleLabels.requireDesignContext,
			description: languagePack.policyConfig.ruleDescriptions.requireDesignContext,
			enabled: currentEnabledRuleIds.has('require-design-context'),
			phase: 'preflight',
		},
		{
			id: 'protect-dangerous-paths',
			label: languagePack.policyConfig.ruleLabels.protectDangerousPaths,
			description: languagePack.policyConfig.ruleDescriptions.protectDangerousPaths,
			enabled: currentEnabledRuleIds.has('protect-dangerous-paths'),
			phase: 'completion',
		},
		{
			id: 'require-relevant-tests',
			label: languagePack.policyConfig.ruleLabels.requireRelevantTests,
			description: languagePack.policyConfig.ruleDescriptions.requireRelevantTests,
			enabled: currentEnabledRuleIds.has('require-relevant-tests'),
			phase: 'completion',
		},
		{
			id: 'require-task-memory-artifact',
			label: languagePack.policyConfig.ruleLabels.requireTaskMemory,
			description: languagePack.policyConfig.ruleDescriptions.requireTaskMemory,
			enabled: currentEnabledRuleIds.has('require-task-memory-artifact'),
			phase: 'completion',
		},
		{
			id: 'require-execution-checkpoint-artifact',
			label: languagePack.policyConfig.ruleLabels.requireExecutionCheckpoint,
			description: languagePack.policyConfig.ruleDescriptions.requireExecutionCheckpoint,
			enabled: currentEnabledRuleIds.has('require-execution-checkpoint-artifact'),
			phase: 'completion',
		},
		{
			id: 'require-story-evidence-artifact',
			label: languagePack.policyConfig.ruleLabels.requireStoryEvidence,
			description: languagePack.policyConfig.ruleDescriptions.requireStoryEvidence,
			enabled: currentEnabledRuleIds.has('require-story-evidence-artifact'),
			phase: 'completion',
		},
	];

	// Gather story execution status for display in webview
	const prd = parsePrd(workspaceRoot);
	const stories: StoryCheckpointInfo[] = prd ? prd.userStories.map(story => {
		const status = HarnessStateManager.getStoryExecutionStatus(workspaceRoot, story.id);
		const evidence = readStoryEvidence(workspaceRoot, story.id);
		const checkpoint = readExecutionCheckpoint(workspaceRoot, story.id);
		return {
			id: story.id,
			title: story.title,
			status: status as StoryCheckpointInfo['status'],
			priority: story.priority,
		lastCheckpoint: checkpoint ? {
			status: checkpoint.status,
			updatedAt: checkpoint.updatedAt,
			summary: checkpoint.summary,
		} : evidence ? {
			status: evidence.status,
			updatedAt: evidence.generatedAt,
			summary: evidence.summary,
		} : undefined,
		};
	}) : [];

	// Build constant params from current config
	const constantParams: ConstantParamInfo[] = [
		{ key: 'maxAutonomousLoops', label: '最大自主循环次数', value: currentConfig.MAX_AUTONOMOUS_LOOPS, description: '单次启动最多自动执行的故事循环数', category: 'general' },
		{ key: 'loopDelayMs', label: '循环间隔延迟', value: currentConfig.LOOP_DELAY_MS, description: '每个故事执行完成后的等待时间（毫秒）', category: 'execution' },
		{ key: 'executionTimeoutMs', label: '执行超时', value: currentConfig.EXECUTION_TIMEOUT_MS, description: '等待 Cline 完成单个故事的最大时间（毫秒）', category: 'execution' },
		{ key: 'executionMinWaitMs', label: '最小等待时间', value: currentConfig.EXECUTION_MIN_WAIT_MS, description: '首次检查 Cline 完成状态前的最小等待时间（毫秒）', category: 'execution' },
		{ key: 'approvalPromptMode', label: '审批提示模式', value: currentConfig.APPROVAL_PROMPT_MODE, description: '审批流程的提示模式：default/bypass/autopilot', category: 'policy' },
		{ key: 'enableReviewerLoop', label: '启用审核循环', value: currentConfig.ENABLE_REVIEWER_LOOP, description: '是否启用 Reviewer Agent 审核流程', category: 'review' },
		{ key: 'reviewPassingScore', label: '审核通过分数', value: currentConfig.REVIEW_PASSING_SCORE, description: 'Reviewer 评分的通过阈值（1-100）', category: 'review' },
		{ key: 'maxAutoRefactorRounds', label: '最大自动修复轮数', value: currentConfig.MAX_AUTO_REFACTOR_ROUNDS, description: '审核不通过时自动修复的最大轮数', category: 'review' },
		{ key: 'policyGateAutoFixRounds', label: '策略门禁自动修复轮数', value: cfg.get<number>('policyGateAutoFixRounds', 1), description: '策略门禁检查失败后自动修复的最大轮数（0-5）', category: 'policy' },
		{ key: 'autoInjectProjectConstraints', label: '自动注入项目约束', value: currentConfig.AUTO_INJECT_PROJECT_CONSTRAINTS, description: '执行故事时是否自动注入项目约束', category: 'general' },
		{ key: 'autoInjectDesignContext', label: '自动注入设计上下文', value: currentConfig.AUTO_INJECT_DESIGN_CONTEXT, description: '执行故事时是否自动注入设计上下文', category: 'general' },
		{ key: 'autoRecallTaskMemory', label: '自动回忆任务记忆', value: currentConfig.AUTO_RECALL_TASK_MEMORY, description: '执行故事时是否自动回忆相关任务记忆', category: 'general' },
		{ key: 'autoCommitGit', label: '自动 Git 提交', value: currentConfig.AUTO_COMMIT_GIT, description: '故事完成后是否自动创建 Git 提交', category: 'general' },
		{ key: 'recalledTaskMemoryLimit', label: '任务记忆回忆限制', value: currentConfig.RECALLED_TASK_MEMORY_LIMIT, description: '每次执行时最多回忆的相关任务记忆数量', category: 'general' },
	];

	const configState: ExecutionCheckpointConfigState = {
		enabled: effectivePolicyConfig.enabled,
		rules,
		approvalMode: currentConfig.APPROVAL_PROMPT_MODE,
		reviewerLoopEnabled: currentConfig.ENABLE_REVIEWER_LOOP,
		reviewerPassingScore: currentConfig.REVIEW_PASSING_SCORE,
		maxAutoRefactorRounds: currentConfig.MAX_AUTO_REFACTOR_ROUNDS,
		policyGateAutoFixRounds: cfg.get<number>('policyGateAutoFixRounds', 1),
		stories,
		constantParams,
	};

	const panel = vscode.window.createWebviewPanel(
		'harnessExecutionCheckpointConfig',
		languagePack.policyConfig.title,
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			retainContextWhenHidden: false,
		}
	);
	panel.iconPath = new vscode.ThemeIcon('settings-gear');
	panel.webview.html = buildExecutionCheckpointConfigHtml(configState, languagePack, panel.webview.cspSource);

	const disposables: vscode.Disposable[] = [];
	const finish = () => {
		while (disposables.length > 0) {
			disposables.pop()?.dispose();
		}
	};

	disposables.push(panel.onDidDispose(() => finish()));
	disposables.push(panel.webview.onDidReceiveMessage(async message => {
		if (message?.type === 'cancel') {
			panel.dispose();
			return;
		}

		if (message?.type !== 'save') {
			return;
		}

		const config = message.config as {
			scope: 'Global' | 'Workspace';
			enabled: boolean;
			enabledRuleIds: string[];
			approvalMode: ApprovalPromptMode;
			reviewerLoopEnabled: boolean;
			reviewerPassingScore: number;
			maxAutoRefactorRounds: number;
			policyGateAutoFixRounds: number;
		};

		const scopeTarget = config.scope === 'Global'
			? vscode.ConfigurationTarget.Global
			: vscode.ConfigurationTarget.Workspace;

		const rawPolicyConfig = normalizePolicyConfig(cfg.get<unknown>('policyGates', undefined));
		const updatedPolicyConfig = applyBuiltinRuleSelections(
			rawPolicyConfig,
			config.enabled,
			new Set(config.enabledRuleIds)
		);

		await cfg.update('policyGates', updatedPolicyConfig, scopeTarget);
		await cfg.update('requireProjectConstraintsBeforeRun', undefined, scopeTarget);
		await cfg.update('requireDesignContextForTaggedStories', undefined, scopeTarget);
		await cfg.update('approvalPromptMode', config.approvalMode, scopeTarget);
		await cfg.update('enableReviewerLoop', config.reviewerLoopEnabled, scopeTarget);
		await cfg.update('reviewPassingScore', config.reviewerPassingScore, scopeTarget);
		await cfg.update('maxAutoRefactorRounds', config.maxAutoRefactorRounds, scopeTarget);
		await cfg.update('policyGateAutoFixRounds', config.policyGateAutoFixRounds, scopeTarget);

		if (scopeTarget === vscode.ConfigurationTarget.Workspace) {
			persistWorkspacePinnedRunnerSettingsFile(workspaceRoot, {
				approvalPromptMode: config.approvalMode,
				enableReviewerLoop: config.reviewerLoopEnabled,
				reviewPassingScore: config.reviewerPassingScore,
				maxAutoRefactorRounds: config.maxAutoRefactorRounds,
			});
		}
		if (scopeTarget === vscode.ConfigurationTarget.Global) {
			await cfg.update('policyGates', undefined, vscode.ConfigurationTarget.Workspace);
			await cfg.update('requireProjectConstraintsBeforeRun', undefined, vscode.ConfigurationTarget.Workspace);
			await cfg.update('requireDesignContextForTaggedStories', undefined, vscode.ConfigurationTarget.Workspace);
			await cfg.update('approvalPromptMode', undefined, vscode.ConfigurationTarget.Workspace);
			await cfg.update('enableReviewerLoop', undefined, vscode.ConfigurationTarget.Workspace);
			await cfg.update('reviewPassingScore', undefined, vscode.ConfigurationTarget.Workspace);
			await cfg.update('maxAutoRefactorRounds', undefined, vscode.ConfigurationTarget.Workspace);
			await cfg.update('policyGateAutoFixRounds', undefined, vscode.ConfigurationTarget.Workspace);
		}

		updateStatusBar(isRunning ? 'running' : 'idle');
		panel.webview.postMessage({ type: 'success', text: languagePack.policyConfig.saved });

		const action = await vscode.window.showInformationMessage(languagePack.policyConfig.saved, languagePack.policyConfig.openSettings);
		if (action === languagePack.policyConfig.openSettings) {
			await vscode.commands.executeCommand('workbench.action.openSettings', 'harness-runner.policyGates');
		}
		panel.dispose();
	}));
}

function buildPolicyRuleQuickPickItems(languagePack: ReturnType<typeof getLanguagePack>, enabledRuleIds: Set<string>) {
	return [
		{ label: languagePack.policyConfig.ruleLabels.requireProjectConstraints, description: languagePack.policyConfig.ruleDescriptions.requireProjectConstraints, picked: enabledRuleIds.has('require-project-constraints'), ruleId: 'require-project-constraints' },
		{ label: languagePack.policyConfig.ruleLabels.requireDesignContext, description: languagePack.policyConfig.ruleDescriptions.requireDesignContext, picked: enabledRuleIds.has('require-design-context'), ruleId: 'require-design-context' },
		{ label: languagePack.policyConfig.ruleLabels.protectDangerousPaths, description: languagePack.policyConfig.ruleDescriptions.protectDangerousPaths, picked: enabledRuleIds.has('protect-dangerous-paths'), ruleId: 'protect-dangerous-paths' },
		{ label: languagePack.policyConfig.ruleLabels.requireRelevantTests, description: languagePack.policyConfig.ruleDescriptions.requireRelevantTests, picked: enabledRuleIds.has('require-relevant-tests'), ruleId: 'require-relevant-tests' },
		{ label: languagePack.policyConfig.ruleLabels.requireTaskMemory, description: languagePack.policyConfig.ruleDescriptions.requireTaskMemory, picked: enabledRuleIds.has('require-task-memory-artifact'), ruleId: 'require-task-memory-artifact' },
		{ label: languagePack.policyConfig.ruleLabels.requireExecutionCheckpoint, description: languagePack.policyConfig.ruleDescriptions.requireExecutionCheckpoint, picked: enabledRuleIds.has('require-execution-checkpoint-artifact'), ruleId: 'require-execution-checkpoint-artifact' },
		{ label: languagePack.policyConfig.ruleLabels.requireStoryEvidence, description: languagePack.policyConfig.ruleDescriptions.requireStoryEvidence, picked: enabledRuleIds.has('require-story-evidence-artifact'), ruleId: 'require-story-evidence-artifact' },
	] as Array<vscode.QuickPickItem & { picked: boolean; ruleId: string; }>;
}

async function promptForWorkspacePinnedInteger(options: {
	title: string;
	prompt: string;
	placeHolder: string;
	initialValue: string;
	minimum: number;
	maximum?: number;
	validationMessage: string;
}): Promise<number | undefined> {
	const rawValue = await vscode.window.showInputBox({
		title: options.title,
		prompt: options.prompt,
		placeHolder: options.placeHolder,
		value: options.initialValue,
		ignoreFocusOut: true,
		validateInput: value => {
			const parsed = Number(value.trim());
			if (!Number.isInteger(parsed) || parsed < options.minimum) {
				return options.validationMessage;
			}
			if (options.maximum !== undefined && parsed > options.maximum) {
				return options.validationMessage;
			}
			return undefined;
		},
	});
	if (rawValue === undefined) {
		return undefined;
	}

	return Number(rawValue.trim());
}

// ── Quick Start ─────────────────────────────────────────────────────────────
// Guides the user through setting up prd.json.
// 1. Checks if prd.json already exists in the workspace root.
// 2. If missing, asks the user to provide a path to an existing file.
// 3. If the user doesn't have one, asks what they want to accomplish and
//    uses Cline to generate prd.json in the expected format.

async function quickStart(): Promise<void> {
	const languagePack = getLanguagePack();
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage(languagePack.common.noWorkspaceFolder);
		return;
	}

	outputChannel.show(true);
	log('═══════════════════════════════════════════════════');
	log('HARNESS Generate PRD');
	log('═══════════════════════════════════════════════════');

	const prdPath = getPrdPath(workspaceRoot);
	const prdExists = fs.existsSync(prdPath);

	// ── Case 1: File already exists ─────────────────────────────────────────
	if (prdExists) {
		log('prd.json already exists.');
		const action = await vscode.window.showInformationMessage(
			languagePack.quickStart.existingPrd,
			languagePack.quickStart.start, languagePack.quickStart.openPrd
		);
		if (action === languagePack.quickStart.start) {
			vscode.commands.executeCommand('harness-runner.start');
		} else if (action === languagePack.quickStart.openPrd) {
			const doc = await vscode.workspace.openTextDocument(prdPath);
			vscode.window.showTextDocument(doc);
		}
		return;
	}

	// ── Case 2: File missing — ask user how to proceed ──────────────────────
	log('prd.json not found — prompting user.');

	const choice = await vscode.window.showQuickPick(
		[
			{
				label: languagePack.quickStart.provideChoice.label,
				description: languagePack.quickStart.provideChoice.description,
				value: 'provide'
			},
			{
				label: languagePack.quickStart.generateChoice.label,
				description: languagePack.quickStart.generateChoice.description,
				value: 'generate'
			}
		],
		{ placeHolder: languagePack.quickStart.missingPrdPlaceholder }
	);

	if (!choice) { return; }

	if (choice.value === 'provide') {
		await quickStartProvideFile(prdPath);
	} else {
		await quickStartGenerate(workspaceRoot);
	}
}

/**
 * Let the user browse for an existing prd.json file
 * and copy it into the workspace root.
 */
async function quickStartProvideFile(prdPath: string): Promise<void> {
	const languagePack = getLanguagePack();
	const uris = await vscode.window.showOpenDialog({
		title: languagePack.quickStart.provideDialogTitle,
		canSelectMany: false,
		canSelectFolders: false,
		filters: { 'JSON': ['json'], 'All Files': ['*'] },
		openLabel: languagePack.quickStart.provideDialogOpenLabel
	});

	if (!uris || uris.length === 0) {
		vscode.window.showWarningMessage(languagePack.quickStart.provideCancelled);
		return;
	}

	const srcPath = uris[0].fsPath;
	fs.copyFileSync(srcPath, prdPath);
	log(`Copied prd.json from ${srcPath}`);
	vscode.window.showInformationMessage(languagePack.quickStart.provideSuccess);
	log('Generate PRD complete — file placed in workspace root.');
}

/**
 * Ask the user what they want to accomplish, then send a Cline prompt that
 * generates prd.json in the expected format used by the Harness Runner extension.
 */
async function quickStartGenerate(workspaceRoot: string): Promise<void> {
	const languagePack = getLanguagePack();
	const userGoal = await vscode.window.showInputBox({
		title: languagePack.quickStart.goalTitle,
		prompt: languagePack.quickStart.goalPrompt,
		placeHolder: languagePack.quickStart.goalPlaceholder,
		ignoreFocusOut: true
	});

	if (!userGoal || userGoal.trim().length === 0) {
		vscode.window.showWarningMessage(languagePack.quickStart.goalCancelled);
		return;
	}

	log(`User goal: ${userGoal}`);
	log('Sending generation prompt to Cline…');

	const prompt = buildQuickStartPrompt(userGoal, workspaceRoot);
	await openClineTaskWithPrompt(prompt, languagePack.quickStart.copiedPrompt);

	vscode.window.showInformationMessage(languagePack.quickStart.generationStarted);
	log('Generate PRD prompt sent to Cline. Waiting for file generation…');
}

/**
 * Builds the Cline prompt that instructs it to generate prd.json
 * in the exact format the Harness Runner expects.
 */
function buildQuickStartPrompt(userGoal: string, workspaceRoot: string): string {
	const languagePack = getLanguagePack();
	const hasGitRepo = isGitRepository(workspaceRoot);
	const autoCommitEnabled = getConfig().AUTO_COMMIT_GIT;
	return [
		languagePack.quickStart.prompt.workspaceAnalysis,
		languagePack.quickStart.prompt.goalLine(userGoal),
		``,
		languagePack.quickStart.prompt.workspaceRootLine(workspaceRoot),
		languagePack.quickStart.prompt.gitModeLine(hasGitRepo, autoCommitEnabled),
		``,
		languagePack.quickStart.prompt.generateFileInstruction,
		``,
		'```json',
		'{',
		'  "project": "<ProjectName>",',
		'  "branchName": "harness/<branchName>",',
		'  "description": "<Short Description of user request>",',
		'  "userStories": [',
		'    {',
		'      "id": "US-001",',
		'      "title": "Setup Project Structure and Enums",',
		'      "description": "Setup Project Structure and Enums",',
		'      "acceptanceCriteria": ["Setup Project Structure and Enums"],',
		'      "priority": 1',
		'    }',
		'  ]',
		'}',
		'```',
		``,
		languagePack.quickStart.prompt.instructionsHeading,
		`- ${languagePack.quickStart.prompt.goalMandatory}`,
		`- ${languagePack.quickStart.prompt.logicalSequence}`,
		`- ${languagePack.quickStart.prompt.granularStories}`,
		`- ${languagePack.quickStart.prompt.numberStories}`,
		`- ${languagePack.quickStart.prompt.noPassesOrNotes}`,
		`- ${languagePack.quickStart.prompt.noSeparateGitStories}`,
		`- ${languagePack.quickStart.prompt.storyLevelGitInstruction}`,
		``,
		languagePack.quickStart.prompt.importantHeading,
		...languagePack.quickStart.prompt.portablePaths.map(line => `- ${line}`),
		`- ${languagePack.language === 'Chinese' ? '不要使用引用你自己的用户名、主目录或机器特定细节的命令。' : 'Do not use commands that reference your own username, home directory, or machine-specific details.'}`,
		`- ${languagePack.language === 'Chinese' ? '整个计划必须可共享且可移植。' : 'The plan must be fully shareable and portable.'}`,
		``,
		languagePack.quickStart.prompt.importantHeading,
		`- ${languagePack.language === 'Chinese' ? `在工作区根目录创建该文件：${workspaceRoot}` : `Create the file at the workspace root: ${workspaceRoot}`}`,
		`- ${languagePack.language === 'Chinese' ? '请尽量完整，覆盖实现该目标所需的全部用户故事。' : 'Be thorough: include all necessary user stories for the user\'s goal'}`,
		`- ${languagePack.language === 'Chinese' ? '请直接创建文件，而不是仅展示其内容。' : 'Actually create the file — do not just show its content'}`,
	].join('\n');
}
