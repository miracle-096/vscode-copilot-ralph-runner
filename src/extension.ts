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
import { composeStoryExecutionPrompt } from './promptContext';
import {
	createSynthesizedTaskMemory,
	hasTaskMemoryArtifact,
	recallRelatedTaskMemories,
	readTaskMemory,
	summarizeRecalledTaskMemoriesForPrompt,
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
import { parseTaskSignalStatus } from './taskStatus';
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
	DesignContextScope,
	ExecutionCheckpointArtifact,
	ExecutionCheckpointStatus,
	PrdFile,
	STORY_STATUSES,
	StoryExecutionStatus,
	TaskMemoryArtifact,
	UserStory,
	normalizeStoryExecutionStatus,
} from './types';
import {
	PRD_FILENAME,
	PROGRESS_FILENAME,
	RALPH_DIR,
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
	getRalphDir as resolveRalphDir,
	getScreenDesignContextPath as resolveScreenDesignContextPath,
	getStoryStatusRegistryPath as resolveStoryStatusRegistryPath,
	getSourceContextIndexPath as resolveSourceContextIndexPath,
	getTaskMemoryPath as resolveTaskMemoryPath,
	getTaskStatusPath as resolveTaskStatusPath,
} from './workspacePaths';
import { getLocalizedStoryStatus, getRalphLanguagePack, normalizeRalphLanguage } from './localization';

// ────────────────────────────────────────────────────────────────────────────
// RALPH Runner — Autonomous Task Runner for VS Code
//
// Reads prd.json for user story definitions and tracks progress inline.
// Loops autonomously (up to MAX_AUTONOMOUS_LOOPS) injecting Copilot chat
// tasks for each user story. Fully resumable.
//
// Task execution state is persisted in the .ralph directory:
//   .ralph/task-<id>-status  →  "inprogress" | "completed"
// This provides a reliable, crash-safe lock that prevents overlapping tasks.
// ────────────────────────────────────────────────────────────────────────────

// ── Configuration helpers ───────────────────────────────────────────────────

function getConfig() {
	const cfg = vscode.workspace.getConfiguration('ralph-runner');
	return {
		MAX_AUTONOMOUS_LOOPS: cfg.get<number>('maxAutonomousLoops', 2),
		LOOP_DELAY_MS: cfg.get<number>('loopDelayMs', 3000),
		COPILOT_RESPONSE_POLL_MS: cfg.get<number>('copilotResponsePollMs', 5000),
		COPILOT_TIMEOUT_MS: cfg.get<number>('copilotTimeoutMs', 600000),
		COPILOT_MIN_WAIT_MS: cfg.get<number>('copilotMinWaitMs', 15000),
		AUTO_INJECT_PROJECT_CONSTRAINTS: cfg.get<boolean>('autoInjectProjectConstraints', true),
		AUTO_INJECT_DESIGN_CONTEXT: cfg.get<boolean>('autoInjectDesignContext', true),
		AUTO_RECALL_TASK_MEMORY: cfg.get<boolean>('autoRecallTaskMemory', true),
		AUTO_COMMIT_GIT: cfg.get<boolean>('autoCommitGit', true),
		RECALLED_TASK_MEMORY_LIMIT: cfg.get<number>('recalledTaskMemoryLimit', 3),
		REQUIRE_PROJECT_CONSTRAINTS_BEFORE_RUN: cfg.get<boolean>('requireProjectConstraintsBeforeRun', false),
		REQUIRE_DESIGN_CONTEXT_FOR_TAGGED_STORIES: cfg.get<boolean>('requireDesignContextForTaggedStories', false),
		LANGUAGE: normalizeRalphLanguage(cfg.get<string>('language', 'Chinese')),
	};
}

function getLanguagePack() {
	return getRalphLanguagePack(getConfig().LANGUAGE);
}

// ── Filesystem Task State Manager ────────────────────────────────────────────
// Manages .ralph/task-<id>-status files to provide a durable, process-safe
// execution lock.  File content is either "inprogress" or "completed".

class RalphStateManager {

	/** Absolute path to the .ralph directory for the workspace. */
	static getRalphDir(workspaceRoot: string): string {
		return resolveRalphDir(workspaceRoot);
	}

	/** Absolute path to the status file for a given task id. */
	static getTaskStatusPath(workspaceRoot: string, taskId: string): string {
		return resolveTaskStatusPath(workspaceRoot, taskId);
	}

	/** Absolute path to the story status registry stored under .ralph/. */
	static getStoryStatusRegistryPath(workspaceRoot: string): string {
		return resolveStoryStatusRegistryPath(workspaceRoot);
	}

	/**
	 * Ensure the .ralph directory exists.  Safe to call multiple times.
	 */
	static ensureDir(workspaceRoot: string): void {
		const dir = RalphStateManager.getRalphDir(workspaceRoot);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
	}

	/**
	 * Write "inprogress" for the given task.
	 * Creates the .ralph directory if it does not yet exist.
	 * Overwrites any previous state for this task id.
	 */
	static setInProgress(workspaceRoot: string, taskId: string): void {
		RalphStateManager.ensureDir(workspaceRoot);
		fs.writeFileSync(
			RalphStateManager.getTaskStatusPath(workspaceRoot, taskId),
			'inprogress',
			{ encoding: 'utf-8', flag: 'w' }
		);
	}

	/**
	 * Write "completed" for the given task.
	 * Safe to call even if the file does not already exist.
	 */
	static setCompleted(workspaceRoot: string, taskId: string): void {
		RalphStateManager.ensureDir(workspaceRoot);
		fs.writeFileSync(
			RalphStateManager.getTaskStatusPath(workspaceRoot, taskId),
			'completed',
			{ encoding: 'utf-8', flag: 'w' }
		);
	}

	/**
	 * Read the current task state from disk.
	 * Returns "inprogress" | "completed" | "none" (file absent or unreadable).
	 */
	static getTaskStatus(workspaceRoot: string, taskId: string): 'inprogress' | 'completed' | 'none' {
		const filePath = RalphStateManager.getTaskStatusPath(workspaceRoot, taskId);
		try {
			const content = fs.readFileSync(filePath, 'utf-8').trim();
			const parsedStatus = parseTaskSignalStatus(content);
			if (parsedStatus !== 'none' && content !== parsedStatus) {
				fs.writeFileSync(filePath, parsedStatus, { encoding: 'utf-8', flag: 'w' });
			}
			if (parsedStatus === 'inprogress' || parsedStatus === 'completed') { return parsedStatus; }
		} catch { /* file missing or unreadable */ }
		return 'none';
	}

	/**
	 * Returns the id of the first task whose status file contains "inprogress",
	 * or null if no task is currently active.
	 */
	static getInProgressTaskId(workspaceRoot: string): string | null {
		const dir = RalphStateManager.getRalphDir(workspaceRoot);
		if (!fs.existsSync(dir)) { return null; }

		let entries: string[];
		try {
			entries = fs.readdirSync(dir);
		} catch {
			return null;
		}

		for (const entry of entries) {
			const match = entry.match(/^task-(.+)-status$/);
			if (!match) { continue; }
			const taskId = match[1];
			if (RalphStateManager.getTaskStatus(workspaceRoot, taskId) === 'inprogress') {
				return taskId;
			}
		}
		return null;
	}

	/** True if any task status file currently contains "inprogress". */
	static isAnyInProgress(workspaceRoot: string): boolean {
		return RalphStateManager.getInProgressTaskId(workspaceRoot) !== null;
	}

	/**
	 * Reset a stalled inprogress task back to "none" by deleting its file.
	 * Used during startup recovery when a previous RALPH session crashed.
	 */
	static clearStalledTask(workspaceRoot: string, taskId: string): void {
		const filePath = RalphStateManager.getTaskStatusPath(workspaceRoot, taskId);
		try {
			if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); }
		} catch { /* ignore */ }
	}

	/** Read the persisted per-story execution status map. */
	static readStoryStatusMap(workspaceRoot: string): Record<string, StoryExecutionStatus> {
		const filePath = RalphStateManager.getStoryStatusRegistryPath(workspaceRoot);
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

	/** Persist the per-story execution status map to .ralph/story-status.json. */
	static writeStoryStatusMap(workspaceRoot: string, statusMap: Record<string, StoryExecutionStatus>): void {
		RalphStateManager.ensureDir(workspaceRoot);
		const filePath = RalphStateManager.getStoryStatusRegistryPath(workspaceRoot);
		fs.writeFileSync(filePath, `${JSON.stringify(statusMap, null, 2)}\n`, 'utf-8');
	}

	/** Store the latest execution status for one story. */
	static setStoryExecutionStatus(workspaceRoot: string, taskId: string, status: StoryExecutionStatus): void {
		const statusMap = RalphStateManager.readStoryStatusMap(workspaceRoot);
		statusMap[taskId] = status;
		RalphStateManager.writeStoryStatusMap(workspaceRoot, statusMap);
	}

	/**
	 * Resolve the latest execution status for a story.
	 * Falls back to progress.txt and only treats lock files as in-progress signals.
	 * task-<id>-status files are execution locks, not durable completion truth.
	 */
	static getStoryExecutionStatus(workspaceRoot: string, taskId: string): StoryExecutionStatus | 'none' {
		const statusMap = RalphStateManager.readStoryStatusMap(workspaceRoot);
		const mappedStatus = statusMap[taskId];
		if (mappedStatus) {
			return mappedStatus;
		}

		const progressEntry = getStoryProgress(workspaceRoot, taskId);
		if (progressEntry?.status === 'done') {
			return 'completed';
		}
		if (progressEntry?.status === 'failed') {
			return 'failed';
		}

		const taskStatus = RalphStateManager.getTaskStatus(workspaceRoot, taskId);
		if (taskStatus === 'inprogress') {
			return 'inprogress';
		}

		return 'none';
	}

	/** Remove a story from the persisted execution status map. */
	static clearStoryExecutionStatus(workspaceRoot: string, taskId: string): void {
		const statusMap = RalphStateManager.readStoryStatusMap(workspaceRoot);
		if (!(taskId in statusMap)) {
			return;
		}

		delete statusMap[taskId];
		const filePath = RalphStateManager.getStoryStatusRegistryPath(workspaceRoot);
		if (Object.keys(statusMap).length === 0) {
			try {
				if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); }
			} catch { /* ignore */ }
			return;
		}

		RalphStateManager.writeStoryStatusMap(workspaceRoot, statusMap);
	}

	/**
	 * Ensure `.ralph/` is present in the workspace's .gitignore.
	 * Creates .gitignore if it does not exist. Safe to call multiple times.
	 */
	static ensureGitignore(workspaceRoot: string): void {
		const gitignorePath = path.join(workspaceRoot, '.gitignore');
		const entriesToIgnore = ['.ralph/'];

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
			fs.writeFileSync(gitignorePath, `${content}${separator}\n# RALPH Runner task state\n${block}\n`, 'utf-8');
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

// ── Progress File Operations ─────────────────────────────────────────────────
// progress.txt tracks which user stories have been completed or failed.
// Each line is: <storyId> | <status> | <timestamp> | <notes>
// e.g.: US-001 | done | 2026-02-24 12:00:00 | Completed successfully

interface ProgressEntry {
	id: string;
	status: 'done' | 'failed';
	timestamp: string;
	notes: string;
}

function getProgressPath(workspaceRoot: string): string {
	return path.join(workspaceRoot, PROGRESS_FILENAME);
}

function readProgress(workspaceRoot: string): ProgressEntry[] {
	const progressPath = getProgressPath(workspaceRoot);
	if (!fs.existsSync(progressPath)) { return []; }

	try {
		const content = fs.readFileSync(progressPath, 'utf-8');
		const entries: ProgressEntry[] = [];

		for (const line of content.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) { continue; }

			const parts = trimmed.split('|').map((part: string) => part.trim());
			if (parts.length >= 2) {
				entries.push({
					id: parts[0],
					status: parts[1] as 'done' | 'failed',
					timestamp: parts[2] || '',
					notes: parts[3] || '',
				});
			}
		}

		return entries;
	} catch {
		return [];
	}
}

function writeProgressEntry(workspaceRoot: string, id: string, status: 'done' | 'failed', notes: string): void {
	const progressPath = getProgressPath(workspaceRoot);
	const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
	const line = `${id} | ${status} | ${timestamp} | ${notes}`;

	let content = '';
	if (fs.existsSync(progressPath)) {
		content = fs.readFileSync(progressPath, 'utf-8');

		// Remove any existing entry for this id so we don't duplicate
		const lines = content.split('\n').filter((lineText: string) => {
			const trimmed = lineText.trim();
			if (!trimmed || trimmed.startsWith('#')) { return true; }
			const entryId = trimmed.split('|')[0].trim();
			return entryId !== id;
		});
		content = lines.join('\n');
	} else {
		content = '# RALPH Runner Progress\n# Format: <storyId> | <status> | <timestamp> | <notes>\n';
	}

	if (!content.endsWith('\n')) { content += '\n'; }
	content += line + '\n';

	fs.writeFileSync(progressPath, content, 'utf-8');
}

function removeProgressEntry(workspaceRoot: string, id: string): void {
	const progressPath = getProgressPath(workspaceRoot);
	if (!fs.existsSync(progressPath)) { return; }

	const content = fs.readFileSync(progressPath, 'utf-8');
	const lines = content.split('\n').filter((lineText: string) => {
		const trimmed = lineText.trim();
		if (!trimmed || trimmed.startsWith('#')) { return true; }
		const entryId = trimmed.split('|')[0].trim();
		return entryId !== id;
	});
	fs.writeFileSync(progressPath, lines.join('\n') + '\n', 'utf-8');
}

function getStoryProgress(workspaceRoot: string, storyId: string): ProgressEntry | undefined {
	const entries = readProgress(workspaceRoot);
	return entries.find(e => e.id === storyId);
}

function findNextPendingStory(prd: PrdFile, workspaceRoot: string): UserStory | null {
	const progress = readProgress(workspaceRoot);
	const doneIds = new Set(progress.filter(e => e.status === 'done').map(e => e.id));

	// Sort by priority (ascending — lower number = higher priority)
	const sorted = [...prd.userStories].sort((a, b) => a.priority - b.priority);
	return sorted.find(s => !doneIds.has(s.id)) || null;
}

// ── Globals ─────────────────────────────────────────────────────────────────

let outputChannel: vscode.OutputChannel;
let cancelToken: vscode.CancellationTokenSource | null = null;
let isRunning = false;
let statusBarItem: vscode.StatusBarItem;

// ── Activation ──────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel('RALPH Runner');
	const languagePack = getLanguagePack();
	registerRalphChatParticipant(context);

	// ── Status bar icon ────────────────────────────────────────────────────
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.text = languagePack.statusBar.idleText;
	statusBarItem.tooltip = languagePack.statusBar.idleTooltip;
	statusBarItem.command = 'ralph-runner.showMenu';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
		if (!event.affectsConfiguration('ralph-runner.language')) {
			return;
		}
		updateStatusBar(isRunning ? 'running' : 'idle');
		vscode.window.showInformationMessage(getLanguagePack().initProjectConstraints.languageChanged);
	}));

	context.subscriptions.push(
		vscode.commands.registerCommand('ralph-runner.start', () => startRalph()),
		vscode.commands.registerCommand('ralph-runner.stop', () => stopRalph()),
		vscode.commands.registerCommand('ralph-runner.status', () => showStatus()),
		vscode.commands.registerCommand('ralph-runner.resetStep', () => resetStory()),
		vscode.commands.registerCommand('ralph-runner.initProjectConstraints', () => initializeProjectConstraints()),
		vscode.commands.registerCommand('ralph-runner.refreshSourceContextIndex', () => refreshSourceContextIndexCommand()),
		vscode.commands.registerCommand('ralph-runner.previewSourceContextRecall', () => previewSourceContextRecall()),
		vscode.commands.registerCommand('ralph-runner.recordDesignContext', () => recordDesignContext()),
		vscode.commands.registerCommand('ralph-runner.generateDesignContextDraft', () => generateVisualDesignContextDraft()),
		vscode.commands.registerCommand('ralph-runner.suggestStoryDesignContext', () => suggestStoryDesignContext()),
		vscode.commands.registerCommand('ralph-runner.openSettings', () => {
			vscode.commands.executeCommand('workbench.action.openSettings', 'ralph-runner');
		}),
		vscode.commands.registerCommand('ralph-runner.showMenu', () => showCommandMenu()),
		vscode.commands.registerCommand('ralph-runner.quickStart', () => quickStart()),
		vscode.commands.registerCommand('ralph-runner.appendUserStories', () => appendUserStories())
	);

	log('RALPH Runner extension activated.');
}

export function deactivate() {
	stopRalph();
	statusBarItem?.dispose();
	outputChannel?.dispose();
}

// ── Core Loop ───────────────────────────────────────────────────────────────

async function startRalph(): Promise<void> {
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

	// ── Startup: ensure .ralph/ dir exists and is gitignored in the workspace ──
	RalphStateManager.ensureDir(workspaceRoot);
	RalphStateManager.ensureGitignore(workspaceRoot);

	const stalledTaskId = RalphStateManager.getInProgressTaskId(workspaceRoot);
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
			failureMessage: 'RALPH detected and cleared a stale in-progress lock during startup recovery.',
		});
		RalphStateManager.clearStalledTask(workspaceRoot, stalledTaskId);
		RalphStateManager.clearStoryExecutionStatus(workspaceRoot, stalledTaskId);
		log(`Cleared stalled inprogress state for task ${stalledTaskId}; checkpoint persisted (${recoveryCheckpoint.source}).`);
	}

	const config = getConfig();
	if (config.REQUIRE_PROJECT_CONSTRAINTS_BEFORE_RUN && !hasProjectConstraintsArtifacts(workspaceRoot)) {
		vscode.window.showWarningMessage(languagePack.runtime.projectConstraintsRequiredBeforeRun);
		log('Startup aborted — project constraints are required but have not been initialized yet.');
		return;
	}

	isRunning = true;
	cancelToken = new vscode.CancellationTokenSource();
	outputChannel.show(true);
	log('═══════════════════════════════════════════════════');
	log('RALPH Runner started — autonomous task runner');
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
		refreshSourceContextIndexArtifact(workspaceRoot, `before ${nextStory.id}`);

		const missingRequiredDesignContext = getMissingRequiredDesignContextReason(workspaceRoot, nextStory);
		if (missingRequiredDesignContext) {
			log(`  ${missingRequiredDesignContext}`);
			vscode.window.showWarningMessage(missingRequiredDesignContext);
			break;
		}

		// Guard: ensure no other task is inprogress before queuing this one.
		await ensureNoActiveTask(workspaceRoot);

		// ── Persist "inprogress" state to .ralph/task-<id>-status ───────────
		RalphStateManager.setInProgress(workspaceRoot, nextStory.id);
		RalphStateManager.setStoryExecutionStatus(workspaceRoot, nextStory.id, 'inprogress');
		log(`  Task state written: .ralph/task-${nextStory.id}-status = inprogress`);

		try {
			// executeStory returns only after Copilot has written "completed"
			// to .ralph/task-<id>-status (or after a timeout).
			const executionResult = await executeStory(nextStory, workspaceRoot);

			// Safety net: ensure the lock is always cleared on success
			RalphStateManager.setCompleted(workspaceRoot, nextStory.id);
			RalphStateManager.setStoryExecutionStatus(workspaceRoot, nextStory.id, 'completed');

			// Write completion to progress.txt (prd.json is never modified)
			writeProgressEntry(
				workspaceRoot,
				nextStory.id,
				'done',
				`Completed successfully; task memory persisted (${executionResult.taskMemory.source}) and checkpoint persisted (${executionResult.checkpoint.source})`
			);

			log(`✅ Story ${nextStory.id} completed with task memory (${executionResult.taskMemory.source}) and checkpoint (${executionResult.checkpoint.source}).`);
		} catch (err: unknown) {
			const errMsg = err instanceof Error ? err.message : String(err);
			if (errMsg === 'Cancelled by user') {
				const interruptedCheckpoint = ensureExecutionCheckpointPersistence(nextStory, workspaceRoot, {
					status: 'interrupted',
					failureMessage: 'Execution stopped after user cancellation.',
				});
				log(`⏹ Story ${nextStory.id} cancelled by user.`);
				log(`  Checkpoint persisted for interrupted story ${nextStory.id} (${interruptedCheckpoint.source}).`);
				RalphStateManager.clearStalledTask(workspaceRoot, nextStory.id);
				RalphStateManager.clearStoryExecutionStatus(workspaceRoot, nextStory.id);
				break;
			}
			log(`❌ Story ${nextStory.id} failed: ${errMsg}`);
			const failedCheckpoint = ensureExecutionCheckpointPersistence(nextStory, workspaceRoot, {
				status: 'failed',
				failureMessage: errMsg,
			});

			// Always release the inprogress lock so the loop can advance
			RalphStateManager.setCompleted(workspaceRoot, nextStory.id);
			RalphStateManager.setStoryExecutionStatus(workspaceRoot, nextStory.id, 'failed');

			// Write failure to progress.txt (prd.json is never modified)
			writeProgressEntry(workspaceRoot, nextStory.id, 'failed', `${errMsg}; checkpoint persisted (${failedCheckpoint.source})`);
		}

		loopsExecuted++;

		// Small delay to let VS Code settle
		await sleep(config.LOOP_DELAY_MS);
	}

	if (loopsExecuted >= config.MAX_AUTONOMOUS_LOOPS && isRunning) {
		log(`Reached MAX_AUTONOMOUS_LOOPS (${config.MAX_AUTONOMOUS_LOOPS}). Pausing. Run 'RALPH: Start' to continue.`);
		vscode.window.showInformationMessage(languagePack.runtime.pausedAfterLoops(config.MAX_AUTONOMOUS_LOOPS));
	}

	isRunning = false;
	cancelToken = null;
	updateStatusBar('idle');
}

function stopRalph(): void {
	const languagePack = getLanguagePack();
	if (!isRunning) {
		vscode.window.showInformationMessage(languagePack.runtime.notRunning);
		return;
	}
	cancelToken?.cancel();
	isRunning = false;
	log('RALPH Runner stopped by user.');
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

function registerRalphChatParticipant(context: vscode.ExtensionContext): void {
	const participant = vscode.chat.createChatParticipant('recent-graduates.ralph-runner', handleRalphChatRequest);
	participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'ralph_runner.ico');
	context.subscriptions.push(participant);
}

const handleRalphChatRequest: vscode.ChatRequestHandler = async (
	request,
	_chatContext,
	stream,
	token,
) => {
	const languagePack = getLanguagePack();
	const workspaceRoot = getWorkspaceRoot();

	if (!workspaceRoot) {
		stream.markdown(languagePack.chatSpec.missingWorkspace);
		return;
	}

	if (!hasProjectConstraintsArtifacts(workspaceRoot)) {
		stream.markdown(languagePack.chatSpec.missingConstraints);
		return;
	}

	const userRequest = request.prompt.trim();
	if (request.command === 'ralph-spec' && userRequest.length === 0) {
		stream.markdown(languagePack.chatSpec.emptyPrompt);
		return;
	}

	const mergedConstraints = loadMergedProjectConstraints(workspaceRoot);
	const prompt = buildProjectConstraintChatAdvicePrompt({
		workspaceRoot,
		language: getConfig().LANGUAGE,
		userRequest: userRequest.length > 0 ? userRequest : languagePack.chatSpec.emptyPrompt,
		constraints: mergedConstraints,
		generatedPath: resolveGeneratedProjectConstraintsPath(workspaceRoot),
		editablePath: resolveEditableProjectConstraintsPath(workspaceRoot),
	});

	stream.progress(languagePack.chatSpec.thinking);

	try {
		const response = await request.model.sendRequest([
			vscode.LanguageModelChatMessage.User(prompt),
		], {}, token);

		const responseFragments: string[] = [];
		for await (const fragment of response.text) {
			responseFragments.push(fragment);
			stream.markdown(fragment);
		}

		const runnablePrompt = extractRunnableProjectConstraintRequest(responseFragments.join(''));
		if (!runnablePrompt) {
			stream.markdown(`\n\n${languagePack.chatSpec.autoSendSkipped}`);
			return;
		}

		const tempFileResult = writeRalphSpecFinalRequestTempFile(workspaceRoot, runnablePrompt);
		if (tempFileResult.ok) {
			stream.markdown(`\n\n${languagePack.chatSpec.tempFileSaved(tempFileResult.filePath)}`);
		} else {
			stream.markdown(`\n\n${languagePack.chatSpec.tempFileSaveFailed(tempFileResult.message)}`);
		}

		const autoSent = await openCopilotChatWithPrompt(
			runnablePrompt,
			languagePack.chatSpec.copiedPrompt,
			{ startNewChat: true }
		);
		stream.markdown(`\n\n${autoSent ? languagePack.chatSpec.autoSent : languagePack.chatSpec.openedWithClipboardFallback}`);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		stream.markdown(languagePack.chatSpec.error(message));
	}
};

function writeRalphSpecFinalRequestTempFile(
	workspaceRoot: string,
	content: string,
): { ok: true; filePath: string; } | { ok: false; message: string; } {
	try {
		RalphStateManager.ensureDir(workspaceRoot);
		const filePath = path.join(resolveRalphDir(workspaceRoot), 'ralph-spec-final-request.md');
		fs.writeFileSync(filePath, `${content.trim()}\n`, 'utf-8');
		return {
			ok: true,
			filePath: filePath.replace(/\\/g, '/'),
		};
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		log(`WARNING: Failed to persist /ralph-spec final request: ${message}`);
		return {
			ok: false,
			message,
		};
	}
}

// ── Story Execution ─────────────────────────────────────────────────────────

interface TaskMemoryPersistenceResult {
	filePath: string;
	source: 'copilot' | 'synthesized';
	artifact: TaskMemoryArtifact;
}

interface ExecutionCheckpointPersistenceResult {
	filePath: string;
	source: 'copilot' | 'synthesized';
	artifact: ExecutionCheckpointArtifact;
}

async function executeStory(story: UserStory, workspaceRoot: string): Promise<{
	taskMemory: TaskMemoryPersistenceResult;
	checkpoint: ExecutionCheckpointPersistenceResult;
}> {
	const prompt = buildCopilotPromptForStory(story, workspaceRoot);
	log('  Delegating user story to Copilot...');
	await sendToCopilot(prompt, story.id, workspaceRoot);
	const taskMemoryResult = ensureTaskMemoryPersistence(story, workspaceRoot);
	const checkpointResult = ensureExecutionCheckpointPersistence(story, workspaceRoot, {
		status: 'completed',
		taskMemory: taskMemoryResult.artifact,
	});
	log(`  Task memory ready for ${story.id}: ${taskMemoryResult.filePath} (${taskMemoryResult.source})`);
	log(`  Execution checkpoint ready for ${story.id}: ${checkpointResult.filePath} (${checkpointResult.source})`);
	return {
		taskMemory: taskMemoryResult,
		checkpoint: checkpointResult,
	};
}

// ── Copilot Integration ─────────────────────────────────────────────────────

function buildCopilotPromptForStory(story: UserStory, workspaceRoot: string): string {
	const projectConstraintsLines = getProjectConstraintsPromptLines(workspaceRoot, story.id);
	const designContextLines = getDesignContextPromptLines(workspaceRoot, story);
	const priorWorkLines = getPriorWorkPromptLines(workspaceRoot, story);
	const sourceContextLines = getSourceContextPromptLines(workspaceRoot, story);
	const recentCheckpointLines = getRecentCheckpointPromptLines(workspaceRoot, story);
	const additionalExecutionRules = [
		'Greedily execute as many sub-tasks as possible in a single pass.',
		'If something partially fails, keep all the parts that passed and do not revert them.',
		'Do not ask questions — execute directly.',
		'Make the actual code changes to the files in the workspace.',
		'Follow an explicit plan -> execute -> checkpoint -> reset workflow for each story handoff.',
		'Each story execution starts in a fresh Copilot Chat session; do not rely on implicit context from previous chats.',
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
		recentCheckpointLines,
		taskMemoryPath: resolveTaskMemoryPath(workspaceRoot, story.id).replace(/\\/g, '/'),
		executionCheckpointPath: resolveExecutionCheckpointPath(workspaceRoot, story.id).replace(/\\/g, '/'),
		completionSignalPath: resolveTaskStatusPath(workspaceRoot, story.id).replace(/\\/g, '/'),
		additionalExecutionRules,
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
		return [];
	}

	if (!hasProjectConstraintsArtifacts(workspaceRoot)) {
		log(`  Project constraints not initialized for story ${storyId}; continuing without injected constraints.`);
		return [];
	}

	try {
		const mergedConstraints = loadMergedProjectConstraints(workspaceRoot);
		const promptLines = summarizeProjectConstraintsForPrompt(mergedConstraints);
		if (promptLines.length === 0) {
			log(`  Project constraints loaded for story ${storyId}, but no normalized prompt lines were produced.`);
			return [];
		}

		log(`  Injecting ${promptLines.length} project constraint prompt lines for story ${storyId}.`);
		return promptLines;
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		log(`  WARNING: Failed to load project constraints for story ${storyId}: ${message}`);
		return [];
	}
}

function getDesignContextPromptLines(workspaceRoot: string, story: UserStory): string[] {
	const config = getConfig();
	if (!config.AUTO_INJECT_DESIGN_CONTEXT) {
		log(`  Design context injection disabled by settings for story ${story.id}.`);
		return [];
	}

	const hasStoryContext = hasStoryLevelDesignContext(workspaceRoot, story.id);
	if (!hasStoryContext && isDesignSensitiveStory(story)) {
		const sharedContext = resolveSharedDesignContextForStory(workspaceRoot, story);
		const promptLines = synthesizeExecutionDesignContextPromptLines(story, sharedContext);
		if (promptLines.length > 0) {
			log(`  Synthesized ${promptLines.length} execution-time design context prompt lines for story ${story.id}.`);
			return promptLines;
		}
	}

	const designContext = resolveDesignContextForStory(workspaceRoot, story);
	if (!designContext) {
		log(`  No design context found for story ${story.id}; continuing without injected design guidance.`);
		return [];
	}

	const validation = validateDesignContext(designContext, story.id);
	if (!validation.isValid) {
		log(`  Design context for story ${story.id} has validation warnings: ${validation.errors.join(' | ')}`);
	}

	const promptLines = summarizeDesignContextForPrompt(validation.artifact);
	if (promptLines.length === 0) {
		log(`  Design context loaded for story ${story.id}, but no prompt lines were produced.`);
		return [];
	}

	log(`  Injecting ${promptLines.length} design context prompt lines for story ${story.id}.`);
	return promptLines;
}

function getPriorWorkPromptLines(workspaceRoot: string, story: UserStory): string[] {
	const config = getConfig();
	if (!config.AUTO_RECALL_TASK_MEMORY) {
		log(`  Prior-work recall disabled by settings for story ${story.id}.`);
		return [];
	}

	const matches = recallRelatedTaskMemories(workspaceRoot, story, {
		limit: config.RECALLED_TASK_MEMORY_LIMIT,
	});
	if (matches.length === 0) {
		log(`  No related task memories found for story ${story.id}; continuing without prior-work context.`);
		return [];
	}

	const promptLines = summarizeRecalledTaskMemoriesForPrompt(matches, config.RECALLED_TASK_MEMORY_LIMIT);
	log(`  Injecting ${matches.length} recalled task memories for story ${story.id}.`);
	return promptLines;
}

function getSourceContextPromptLines(workspaceRoot: string, story: UserStory): string[] {
	const index = getSourceContextIndex(workspaceRoot);
	if (!index) {
		log(`  Source context index missing for story ${story.id}; continuing without source context recall.`);
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
		return [];
	}

	const promptLines = summarizeRecalledSourceContextForPrompt(matches, 4);
	log(`  Injecting ${matches.length} recalled source context matches for story ${story.id}.`);
	return promptLines;
}

function getRecentCheckpointPromptLines(workspaceRoot: string, story: UserStory): string[] {
	const validCheckpointCount = listValidExecutionCheckpoints(workspaceRoot).length;
	if (validCheckpointCount === 0) {
		log(`  No execution checkpoints found for story ${story.id}; continuing with a fresh chat and no checkpoint handoff.`);
		return [];
	}

	const checkpoint = getRecentExecutionCheckpoint(workspaceRoot, { preferredStoryId: story.id });
	if (!checkpoint) {
		log(`  Execution checkpoints exist, but none were valid for story ${story.id}; skipping checkpoint injection.`);
		return [];
	}

	const promptLines = summarizeExecutionCheckpointForPrompt(checkpoint);
	if (promptLines.length === 0) {
		log(`  Recent checkpoint for story ${story.id} produced no prompt lines; skipping checkpoint injection.`);
		return [];
	}

	log(`  Injecting recent checkpoint from ${checkpoint.storyId} (${checkpoint.status}) for story ${story.id}.`);
	return promptLines;
}

function getMissingRequiredDesignContextReason(workspaceRoot: string, story: UserStory): string | null {
	const config = getConfig();
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

async function openCopilotChatWithPrompt(prompt: string, copiedPromptMessage?: string, options?: { startNewChat?: boolean }): Promise<boolean> {
	async function tryExecuteVsCodeCommand(commandId: string, ...args: unknown[]): Promise<boolean> {
		try {
			await vscode.commands.executeCommand(commandId, ...args);
			return true;
		} catch {
			return false;
		}
	}

	async function startFreshCopilotChatSession(): Promise<void> {
		await tryExecuteVsCodeCommand('workbench.panel.chat.view.copilot.focus');
		for (const commandId of ['workbench.action.chat.newChat', 'workbench.action.chat.new']) {
			if (await tryExecuteVsCodeCommand(commandId)) {
				await sleep(150);
				return;
			}
		}
	}

	if (options?.startNewChat) {
		await startFreshCopilotChatSession();
	}

	try {
		await vscode.commands.executeCommand('workbench.action.chat.open', {
			query: prompt,
			isPartialQuery: false
		});
		return true;
	} catch {
		try {
			await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
			await sleep(1000);
			await vscode.commands.executeCommand('workbench.action.chat.open', prompt);
			return true;
		} catch {
			log('WARNING: Could not programmatically send to Copilot. Copying to clipboard.');
			await vscode.env.clipboard.writeText(prompt);
			await vscode.commands.executeCommand('workbench.action.chat.open');
			if (copiedPromptMessage) {
				vscode.window.showInformationMessage(copiedPromptMessage);
			}
			return false;
		}
	}
}

async function sendToCopilot(prompt: string, taskId: string, workspaceRoot: string): Promise<void> {
	log('  Resetting Copilot Chat session before story execution...');
	log('  Sending prompt to Copilot Chat...');
	await openCopilotChatWithPrompt(prompt, undefined, { startNewChat: true });

	// Poll the .ralph status file until Copilot writes "completed" to it
	await waitForCopilotCompletion(taskId, workspaceRoot);
}

export function shouldAbortCopilotWait(
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

interface CopilotCompletionWaitOptions {
	requireRunnerActive?: boolean;
}

/**
 * Polls .ralph/task-<id>-status until Copilot writes "completed" to it.
 * Enforces a minimum wait (copilotMinWaitMs) before checking so that Copilot
 * has time to begin working before the first read.
 * Throws if the timeout is exceeded without seeing "completed".
 */
async function waitForCopilotCompletion(
	taskId: string,
	workspaceRoot: string,
	options?: CopilotCompletionWaitOptions,
): Promise<void> {
	const config = getConfig();
	const requireRunnerActive = options?.requireRunnerActive ?? true;
	log(`  Waiting for Copilot to write "completed" to .ralph/task-${taskId}-status...`);

	const startTime = Date.now();

	while (Date.now() - startTime < config.COPILOT_TIMEOUT_MS) {
		if (shouldAbortCopilotWait(Boolean(cancelToken?.token.isCancellationRequested), requireRunnerActive, isRunning)) {
			throw new Error('Cancelled by user');
		}

		await sleep(config.COPILOT_RESPONSE_POLL_MS);
		if (shouldAbortCopilotWait(Boolean(cancelToken?.token.isCancellationRequested), requireRunnerActive, isRunning)) {
			throw new Error('Cancelled by user');
		}
		const elapsed = Date.now() - startTime;

		// Enforce a minimum wait before the first status check
		if (elapsed < config.COPILOT_MIN_WAIT_MS) {
			log(`  … minimum wait in progress (${Math.round(elapsed / 1000)}s / ${Math.round(config.COPILOT_MIN_WAIT_MS / 1000)}s)`);
			continue;
		}

		const status = RalphStateManager.getTaskStatus(workspaceRoot, taskId);
		if (status === 'completed') {
			log(`  ✓ Copilot wrote "completed" to .ralph/task-${taskId}-status (elapsed ${Math.round(elapsed / 1000)}s); validating task memory next.`);
			return;
		}

		log(`  … still waiting for Copilot to complete task ${taskId} (status: ${status}, elapsed ${Math.round(elapsed / 1000)}s)`);
	}

	log(`  ⚠ Copilot timed out after ${Math.round(config.COPILOT_TIMEOUT_MS / 1000)}s without writing "completed" — proceeding.`);
	throw new Error(`Copilot timed out on task ${taskId}`);
}

function ensureTaskMemoryPersistence(story: UserStory, workspaceRoot: string): TaskMemoryPersistenceResult {
	const existingMemory = hasTaskMemoryArtifact(workspaceRoot, story.id) ? readTaskMemory(workspaceRoot, story.id) : null;
	const validation = existingMemory ? validateTaskMemory(existingMemory, story.id) : null;

	if (validation?.isValid) {
		const filePath = writeTaskMemory(workspaceRoot, story.id, {
			...validation.artifact,
			source: validation.artifact.source ?? 'copilot',
		});
		const persistedArtifact: TaskMemoryArtifact = {
			...validation.artifact,
			source: validation.artifact.source ?? 'copilot',
		};
		upsertTaskMemoryIndexEntry(workspaceRoot, persistedArtifact, story.id);
		log(`  Valid task memory artifact accepted for ${story.id}.`);
		return { filePath, source: persistedArtifact.source ?? 'copilot', artifact: persistedArtifact };
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
			source: validation.artifact.source ?? 'copilot',
		}, options.status);
		const persistedArtifact: ExecutionCheckpointArtifact = {
			...validation.artifact,
			source: validation.artifact.source ?? 'copilot',
		};
		log(`  Valid execution checkpoint accepted for ${story.id}.`);
		return {
			filePath,
			source: persistedArtifact.source ?? 'copilot',
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
		: ['Changed files were inferred automatically because Copilot did not persist task memory.'];

	return createSynthesizedTaskMemory(story.id, story.title, `Fallback task memory synthesized for ${story.id}: ${story.title}.`, {
		changedFiles,
		changedModules,
		keyDecisions: [
			'RALPH synthesized a task memory artifact because completion was signaled before a valid memory artifact was available.',
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

function detectChangedFilesForTaskMemory(workspaceRoot: string, storyId: string): string[] {
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
			.filter((filePath: string) => filePath.length > 0 && !filePath.startsWith('.prd/') && filePath !== 'prd.json');

		if (changedFiles.length > 0) {
			return Array.from(new Set(changedFiles));
		}
	} catch {
		log(`  WARNING: Unable to inspect git status for fallback task memory on ${storyId}.`);
	}

	return ['(unable to determine changed files automatically)'];
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
 * Block until no .ralph/task-*-status file contains "inprogress".
 * Under normal sequential operation this resolves immediately.
 * Polls every COPILOT_RESPONSE_POLL_MS and times out after COPILOT_TIMEOUT_MS.
 */
async function ensureNoActiveTask(workspaceRoot: string): Promise<void> {
	const config = getConfig();

	if (!RalphStateManager.isAnyInProgress(workspaceRoot)) {
		return; // Fast path — no active task
	}

	const activeId = RalphStateManager.getInProgressTaskId(workspaceRoot);
	log(`  ⏳ Task ${activeId} is still inprogress on disk — waiting for it to complete...`);

	const waitStart = Date.now();

	while (Date.now() - waitStart < config.COPILOT_TIMEOUT_MS) {
		if (cancelToken?.token.isCancellationRequested) {
			throw new Error('Cancelled by user');
		}

		await sleep(config.COPILOT_RESPONSE_POLL_MS);
		if (cancelToken?.token.isCancellationRequested || !isRunning) {
			throw new Error('Cancelled by user');
		}

		if (!RalphStateManager.isAnyInProgress(workspaceRoot)) {
			const waited = Math.round((Date.now() - waitStart) / 1000);
			log(`  ✓ No active task on disk — proceeding (waited ${waited}s)`);
			return;
		}

		const stillActive = RalphStateManager.getInProgressTaskId(workspaceRoot);
		log(`  … still waiting for task ${stillActive} to clear inprogress state`);
	}

	// Timed out — clear the lock to prevent a permanent deadlock
	const timedOutId = RalphStateManager.getInProgressTaskId(workspaceRoot);
	if (timedOutId !== null) {
		log(`  WARNING: Timed out waiting for task ${timedOutId} — clearing stale lock and proceeding.`);
		RalphStateManager.clearStalledTask(workspaceRoot, timedOutId);
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

	const progress = readProgress(workspaceRoot);
	const doneIds = new Set(progress.filter(e => e.status === 'done').map(e => e.id));
	const failedIds = new Set(progress.filter(e => e.status === 'failed').map(e => e.id));

	const total = prd.userStories.length;
	const completed = prd.userStories.filter(s => doneIds.has(s.id)).length;
	const failed = prd.userStories.filter(s => failedIds.has(s.id)).length;
	const pending = total - completed;
	const inProgress = RalphStateManager.getInProgressTaskId(workspaceRoot);
	const nextPending = findNextPendingStory(prd, workspaceRoot);

	const lines = [
		languagePack.status.title(prd.project),
		``,
		`✅ ${languagePack.status.completed(completed, total)}`,
		`❌ ${languagePack.status.failed(failed)}`,
		`⏳ ${languagePack.status.pending(pending)}`,
		`🔄 ${languagePack.status.inProgress(inProgress)}`,
		`📍 ${languagePack.status.next(nextPending ? `${nextPending.id} — ${nextPending.title}` : languagePack.status.allDone)}`,
		``,
		languagePack.status.running(isRunning)
	];

	outputChannel.show(true);
	log(lines.join('\n'));
	vscode.window.showInformationMessage(languagePack.status.summary(completed, total, nextPending ? nextPending.id : null));
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

	const progress = readProgress(workspaceRoot);
	const trackedIds = new Set(progress.map(e => e.id));
	const trackedStories = prd.userStories.filter(s => trackedIds.has(s.id));

	if (trackedStories.length === 0) {
		vscode.window.showInformationMessage(languagePack.reset.noTrackedStories);
		return;
	}

	const items = trackedStories.map(s => {
		const entry = progress.find(e => e.id === s.id);
		return {
			label: `${s.id} — ${s.title}`,
			description: entry ? `[${entry.status}] ${entry.notes}` : '',
			storyId: s.id
		};
	});

	const selection = await vscode.window.showQuickPick(items, {
		placeHolder: languagePack.reset.placeholder
	});

	if (selection) {
		removeProgressEntry(workspaceRoot, selection.storyId);
		// Also clear the .ralph status file if present
		RalphStateManager.clearStalledTask(workspaceRoot, selection.storyId);
		RalphStateManager.clearStoryExecutionStatus(workspaceRoot, selection.storyId);
		vscode.window.showInformationMessage(languagePack.reset.storyReset(selection.storyId));
		log(`Story ${selection.storyId} reset by user.`);
	}
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
	log('RALPH Initialize Project Constraints');
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
		RalphStateManager.clearStalledTask(workspaceRoot, taskId);
		const prompt = buildProjectConstraintsInitializationPrompt({
			workspaceRoot,
			language: config.LANGUAGE,
			generatedPath: resolveGeneratedProjectConstraintsPath(workspaceRoot),
			editablePath: resolveEditableProjectConstraintsPath(workspaceRoot),
			completionSignalPath: resolveTaskStatusPath(workspaceRoot, taskId),
			scanResult,
			referenceSources: referenceSources.sources,
			additionalInstructions: referenceSources.additionalInstructions,
		});
		log(`Project constraints scaffold ready: ${scaffold.generatedPath}`);
		log(`Project constraints editable scaffold: ${scaffold.editablePath}`);
		log(`Technology summary items: ${scanResult.generatedConstraints.technologySummary.length}`);
		log(`Delivery checklist items: ${scanResult.generatedConstraints.deliveryChecklist.length}`);
		await openCopilotChatWithPrompt(prompt, languagePack.initProjectConstraints.copiedPrompt);
		vscode.window.showInformationMessage(languagePack.initProjectConstraints.started);

		try {
			await waitForCopilotCompletion(taskId, workspaceRoot, { requireRunnerActive: false });
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
		return `${normalized.slice(0, 4000)}\n\n[Content truncated by Ralph]`;
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return `[RALPH could not read this file: ${message}]`;
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
	RalphStateManager.clearStalledTask(workspaceRoot, taskId);

	const prompt = buildVisualDesignContextDraftPrompt({
		workspaceRoot,
		targetScope: target.scope,
		targetScopeId: target.scopeId,
		targetFilePath: target.filePath,
		completionSignalPath: resolveTaskStatusPath(workspaceRoot, taskId),
		story: selectedStory,
		figmaUrl: visualInput.figmaUrl,
		screenshotPaths: visualInput.screenshotPaths,
		referenceDocs: visualInput.referenceDocs,
		additionalInstructions: visualInput.additionalInstructions,
		existingContextLines,
	});

	log(`Generating visual design context draft for ${selectedStory?.id ?? target.scopeId} -> ${target.label}`);
	vscode.window.showInformationMessage(languagePack.designContext.draft.started(target.label));
	await openCopilotChatWithPrompt(prompt, languagePack.designContext.draft.copiedPrompt);

	try {
		await waitForCopilotCompletion(taskId, workspaceRoot);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		log(`ERROR: Visual design context draft generation failed for ${target.label}: ${message}`);
		vscode.window.showErrorMessage(languagePack.designContext.draft.failed(message));
		return;
	}

	const generatedDraft = readDesignContextForScope(workspaceRoot, target.scope, target.scopeId);
	if (!generatedDraft) {
		log(`ERROR: Copilot completed the visual draft task but no artifact was found at ${target.filePath}`);
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
	RalphStateManager.clearStalledTask(workspaceRoot, taskId);

	const prompt = buildStoryDesignContextSuggestionPrompt({
		workspaceRoot,
		targetFilePath: suggestionPath,
		completionSignalPath: resolveTaskStatusPath(workspaceRoot, taskId),
		story: selectedStory,
		sharedContextLines: summarizeDesignContextForPrompt(sharedContext),
		existingStoryContextLines: summarizeDesignContextForPrompt(readDesignContext(workspaceRoot, selectedStory.id)),
		additionalInstructions: suggestionInput.additionalInstructions,
	});

	log(`Generating story design context suggestion for ${selectedStory.id}`);
	vscode.window.showInformationMessage(languagePack.designContext.suggestion.started(selectedStory.id));
	await openCopilotChatWithPrompt(prompt, languagePack.designContext.suggestion.copiedPrompt);

	try {
		await waitForCopilotCompletion(taskId, workspaceRoot);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		log(`ERROR: Story design context suggestion failed for ${selectedStory.id}: ${message}`);
		vscode.window.showErrorMessage(languagePack.designContext.suggestion.failed(message));
		return;
	}

	const rawSuggestion = readJsonFile<Partial<import('./types').DesignContextArtifact>>(suggestionPath);
	if (!rawSuggestion) {
		log(`ERROR: Copilot completed suggestion task but no suggestion artifact was found for ${selectedStory.id}`);
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
			description: languagePack.common.statusPriority(getLocalizedStoryStatus(RalphStateManager.getStoryExecutionStatus(workspaceRoot, story.id), languagePack.language), story.priority),
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
	RalphStateManager.clearStalledTask(workspaceRoot, taskId);

	const allowedReferences = selectedDrafts.map(draft => `${draft.scope}:${draft.scopeId}`);
	const prompt = buildStoryDesignContextBatchMatchPrompt({
		workspaceRoot,
		targetFilePath: matchPlanPath,
		completionSignalPath: resolveTaskStatusPath(workspaceRoot, taskId),
		candidateStories: selectedStories,
		candidateDrafts: selectedDrafts.map(draft => ({
			reference: `${draft.scope}:${draft.scopeId}`,
			summaryLines: summarizeDesignContextForPrompt(draft.artifact),
		})),
	});

	log(`Generating AI-guided design-story matches for ${selectedStories.length} candidate stories using ${selectedDrafts.length} reusable drafts.`);
	vscode.window.showInformationMessage(languagePack.designContext.matching.started(selectedStories.length, selectedDrafts.length));
	await openCopilotChatWithPrompt(prompt, languagePack.designContext.matching.copiedPrompt);

	try {
		await waitForCopilotCompletion(taskId, workspaceRoot);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		log(`ERROR: Design draft matching failed: ${message}`);
		vscode.window.showErrorMessage(languagePack.designContext.matching.failed(message));
		return;
	}

	const rawMatchPlan = readJsonFile<unknown>(matchPlanPath);
	if (!rawMatchPlan) {
		log('ERROR: Copilot completed design matching task but no match plan artifact was found.');
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
	await openCopilotChatWithPrompt(prompt, languagePack.appendStories.copiedPrompt);
	vscode.window.showInformationMessage(languagePack.appendStories.started);
	log('Append user stories prompt sent to Copilot. Waiting for prd.json update…');
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
}

function sleep(ms: number): Promise<void> {
	return new Promise<void>(resolve => {
		setTimeout(resolve, ms);
	});
}

function updateStatusBar(state: 'idle' | 'running'): void {
	if (!statusBarItem) { return; }
	const languagePack = getLanguagePack();
	if (state === 'running') {
		statusBarItem.text = languagePack.statusBar.runningText;
		statusBarItem.tooltip = languagePack.statusBar.runningTooltip;
		statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
	} else {
		statusBarItem.text = languagePack.statusBar.idleText;
		statusBarItem.tooltip = languagePack.statusBar.idleTooltip;
		statusBarItem.backgroundColor = undefined;
	}
}

async function showCommandMenu(): Promise<void> {
	const languagePack = getLanguagePack();
	const items: Array<vscode.QuickPickItem & { command: string }> = languagePack.menu.items.map(item => ({
		label: item.label,
		description: item.description,
		command: item.command,
	}));

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: languagePack.menu.placeholder,
	});

	if (!selected) { return; }
	if (selected.command) {
		vscode.commands.executeCommand(selected.command);
	}
}

// ── Quick Start ─────────────────────────────────────────────────────────────
// Guides the user through setting up prd.json.
// 1. Checks if prd.json already exists in the workspace root.
// 2. If missing, asks the user to provide a path to an existing file.
// 3. If the user doesn't have one, asks what they want to accomplish and
//    uses Copilot to generate prd.json in the expected format.

async function quickStart(): Promise<void> {
	const languagePack = getLanguagePack();
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage(languagePack.common.noWorkspaceFolder);
		return;
	}

	outputChannel.show(true);
	log('═══════════════════════════════════════════════════');
	log('RALPH Generate PRD');
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
			vscode.commands.executeCommand('ralph-runner.start');
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
 * Ask the user what they want to accomplish, then send a Copilot prompt that
 * generates prd.json in the expected format used by the RALPH Runner extension.
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
	log('Sending generation prompt to Copilot…');

	const prompt = buildQuickStartPrompt(userGoal, workspaceRoot);
	await openCopilotChatWithPrompt(prompt, languagePack.quickStart.copiedPrompt);

	vscode.window.showInformationMessage(languagePack.quickStart.generationStarted);
	log('Generate PRD prompt sent to Copilot. Waiting for file generation…');
}

/**
 * Builds the Copilot prompt that instructs it to generate prd.json
 * in the exact format the RALPH Runner expects.
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
		'  "branchName": "ralph/<branchName>",',
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
