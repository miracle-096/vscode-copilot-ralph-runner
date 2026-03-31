import { execSync } from 'child_process';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { readDesignContext, summarizeDesignContextForPrompt, validateDesignContext, writeDesignContext } from './designContext';
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
	hasProjectConstraintsArtifacts,
	initializeProjectConstraintsArtifacts,
	loadMergedProjectConstraints,
	summarizeProjectConstraintsForPrompt,
} from './projectConstraints';
import {
	BasePrdFile,
	PrdFile,
	SplitUserStory,
	STORY_STATUSES,
	StoryExecutionStatus,
	TaskMemoryArtifact,
	UserStory,
	normalizeStoryExecutionStatus,
} from './types';
import {
	BASE_PRD_FILENAME,
	PRD_DIR,
	PRD_FILENAME,
	PROGRESS_FILENAME,
	RALPH_DIR,
	STORY_STATUS_FILENAME,
	USER_STORIES_DIR,
	ensurePrdDirectories as ensureWorkspacePrdDirectories,
	getBasePrdPath as resolveBasePrdPath,
	getPrdDirectoryPath as resolvePrdDirectoryPath,
	getPrdPath as resolvePrdPath,
	getRalphDir as resolveRalphDir,
	getStoryStatusRegistryPath as resolveStoryStatusRegistryPath,
	getTaskMemoryPath as resolveTaskMemoryPath,
	getTaskStatusPath as resolveTaskStatusPath,
	getUserStoriesDirectoryPath as resolveUserStoriesDirectoryPath,
	getUserStoryFilePath as resolveUserStoryFilePath,
} from './workspacePaths';

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
		RECALLED_TASK_MEMORY_LIMIT: cfg.get<number>('recalledTaskMemoryLimit', 3),
		REQUIRE_PROJECT_CONSTRAINTS_BEFORE_RUN: cfg.get<boolean>('requireProjectConstraintsBeforeRun', false),
		REQUIRE_DESIGN_CONTEXT_FOR_TAGGED_STORIES: cfg.get<boolean>('requireDesignContextForTaggedStories', false),
	};
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
			if (content === 'inprogress' || content === 'completed') { return content; }
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
		syncSplitStoryStatus(workspaceRoot, taskId, status);
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
		syncSplitStoryStatus(workspaceRoot, taskId, '未开始');
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

function getUserStoriesDirectoryPath(workspaceRoot: string): string {
	return resolveUserStoriesDirectoryPath(workspaceRoot);
}

function getBasePrdPath(workspaceRoot: string): string {
	return resolveBasePrdPath(workspaceRoot);
}

function getUserStoryFilePath(workspaceRoot: string, storyId: string): string {
	return resolveUserStoryFilePath(workspaceRoot, storyId);
}

function ensurePrdDirectories(workspaceRoot: string): { prdDir: string; userStoriesDir: string } {
	return ensureWorkspacePrdDirectories(workspaceRoot);
}

function writeJsonFile(filePath: string, content: unknown): void {
	fs.writeFileSync(filePath, `${JSON.stringify(content, null, 2)}\n`, 'utf-8');
}

function syncSplitStoryStatus(workspaceRoot: string, storyId: string, status: StoryExecutionStatus): void {
	const storyPath = getUserStoryFilePath(workspaceRoot, storyId);
	if (!fs.existsSync(storyPath)) {
		return;
	}

	const story = readJsonFile<Record<string, unknown>>(storyPath);
	if (!story) {
		log(`WARNING: Could not sync status for invalid split user story file ${storyId}.json.`);
		return;
	}

	writeJsonFile(storyPath, {
		...story,
		status,
	});
}

function readJsonFile<T>(filePath: string): T | null {
	try {
		const content = fs.readFileSync(filePath, 'utf-8');
		return JSON.parse(content) as T;
	} catch {
		return null;
	}
}

function stripStoryStatus(story: UserStory): UserStory {
	const { status: _status, ...storyWithoutStatus } = story;
	return storyWithoutStatus;
}

function stripUserStoriesFromPrd(prd: PrdFile): BasePrdFile {
	const { userStories: _userStories, ...basePrd } = prd;
	return basePrd;
}

function resolveStoryStatusForSplit(workspaceRoot: string, story: UserStory): StoryExecutionStatus {
	const inlineStatus = normalizeStoryExecutionStatus(story.status);
	if (inlineStatus === 'completed') {
		return 'completed';
	}

	const trackedStatus = RalphStateManager.getStoryExecutionStatus(workspaceRoot, story.id);
	if (trackedStatus === 'completed') {
		return 'completed';
	}

	return '未开始';
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

			const parts = trimmed.split('|').map(p => p.trim());
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
		const lines = content.split('\n').filter(l => {
			const trimmed = l.trim();
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
	const lines = content.split('\n').filter(l => {
		const trimmed = l.trim();
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

	// ── Status bar icon ────────────────────────────────────────────────────
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.text = '$(rocket) Ralph Runner';
	statusBarItem.tooltip = 'RALPH Runner — click to show commands';
	statusBarItem.command = 'ralph-runner.showMenu';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	context.subscriptions.push(
		vscode.commands.registerCommand('ralph-runner.start', () => startRalph()),
		vscode.commands.registerCommand('ralph-runner.stop', () => stopRalph()),
		vscode.commands.registerCommand('ralph-runner.status', () => showStatus()),
		vscode.commands.registerCommand('ralph-runner.resetStep', () => resetStory()),
		vscode.commands.registerCommand('ralph-runner.initProjectConstraints', () => initializeProjectConstraints()),
		vscode.commands.registerCommand('ralph-runner.recordDesignContext', () => recordDesignContext()),
		vscode.commands.registerCommand('ralph-runner.recallTaskMemory', () => recallRelatedTaskMemory()),
		vscode.commands.registerCommand('ralph-runner.openSettings', () => {
			vscode.commands.executeCommand('workbench.action.openSettings', 'ralph-runner');
		}),
		vscode.commands.registerCommand('ralph-runner.showMenu', () => showCommandMenu()),
		vscode.commands.registerCommand('ralph-runner.quickStart', () => quickStart()),
		vscode.commands.registerCommand('ralph-runner.splitPrd', () => splitPrd()),
		vscode.commands.registerCommand('ralph-runner.mergePrd', () => mergePrd()),
		vscode.commands.registerCommand('ralph-runner.openUserStoryEditor', () => openUserStoryEditor())
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
	if (isRunning) {
		vscode.window.showWarningMessage('RALPH is already running.');
		return;
	}

	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage('No workspace folder open.');
		return;
	}

	const prdPath = getPrdPath(workspaceRoot);
	if (!fs.existsSync(prdPath)) {
		vscode.window.showErrorMessage('prd.json not found in workspace root.');
		return;
	}

	// ── Startup: ensure .ralph/ dir exists and is gitignored in the workspace ──
	RalphStateManager.ensureDir(workspaceRoot);
	RalphStateManager.ensureGitignore(workspaceRoot);

	const stalledTaskId = RalphStateManager.getInProgressTaskId(workspaceRoot);
	if (stalledTaskId !== null) {
		const action = await vscode.window.showWarningMessage(
			`RALPH: Task ${stalledTaskId} was left "inprogress" from a previous interrupted run.`,
			'Clear & Retry', 'Cancel'
		);
		if (action !== 'Clear & Retry') {
			log(`Startup aborted — stalled task ${stalledTaskId} left untouched.`);
			return;
		}
		RalphStateManager.clearStalledTask(workspaceRoot, stalledTaskId);
		RalphStateManager.clearStoryExecutionStatus(workspaceRoot, stalledTaskId);
		log(`Cleared stalled inprogress state for task ${stalledTaskId}.`);
	}

	const config = getConfig();
	if (config.REQUIRE_PROJECT_CONSTRAINTS_BEFORE_RUN && !hasProjectConstraintsArtifacts(workspaceRoot)) {
		vscode.window.showWarningMessage(
			'RALPH: Project constraints are required before execution. Run "RALPH: Initialize Project Constraints" first.'
		);
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
			vscode.window.showInformationMessage('RALPH: All user stories completed!');
			break;
		}

		log('');
		log(`──── Loop ${loopsExecuted + 1}/${config.MAX_AUTONOMOUS_LOOPS} ────`);
		log(`Story ${nextStory.id}: ${nextStory.title}`);
		log(`Description: ${nextStory.description}`);
		log(`Priority: ${nextStory.priority}`);

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
			const taskMemoryResult = await executeStory(nextStory, workspaceRoot);

			// Safety net: ensure the lock is always cleared on success
			RalphStateManager.setCompleted(workspaceRoot, nextStory.id);
			RalphStateManager.setStoryExecutionStatus(workspaceRoot, nextStory.id, 'completed');

			// Write completion to progress.txt (prd.json is never modified)
			writeProgressEntry(workspaceRoot, nextStory.id, 'done', `Completed successfully; task memory persisted (${taskMemoryResult.source})`);

			log(`✅ Story ${nextStory.id} completed with task memory (${taskMemoryResult.source}).`);
		} catch (err: unknown) {
			const errMsg = err instanceof Error ? err.message : String(err);
			log(`❌ Story ${nextStory.id} failed: ${errMsg}`);

			// Always release the inprogress lock so the loop can advance
			RalphStateManager.setCompleted(workspaceRoot, nextStory.id);
			RalphStateManager.setStoryExecutionStatus(workspaceRoot, nextStory.id, 'failed');

			// Write failure to progress.txt (prd.json is never modified)
			writeProgressEntry(workspaceRoot, nextStory.id, 'failed', errMsg);
		}

		loopsExecuted++;

		// Small delay to let VS Code settle
		await sleep(config.LOOP_DELAY_MS);
	}

	if (loopsExecuted >= config.MAX_AUTONOMOUS_LOOPS && isRunning) {
		log(`Reached MAX_AUTONOMOUS_LOOPS (${config.MAX_AUTONOMOUS_LOOPS}). Pausing. Run 'RALPH: Start' to continue.`);
		vscode.window.showInformationMessage(
			`RALPH paused after ${config.MAX_AUTONOMOUS_LOOPS} steps. Run 'RALPH: Start' to resume.`
		);
	}

	isRunning = false;
	cancelToken = null;
	updateStatusBar('idle');
}

function stopRalph(): void {
	if (!isRunning) {
		vscode.window.showInformationMessage('RALPH is not running.');
		return;
	}
	cancelToken?.cancel();
	isRunning = false;
	log('RALPH Runner stopped by user.');
	vscode.window.showInformationMessage('RALPH stopped.');
	updateStatusBar('idle');
}

// ── Story Execution ─────────────────────────────────────────────────────────

async function executeStory(story: UserStory, workspaceRoot: string): Promise<{ filePath: string; source: 'copilot' | 'synthesized' }> {
	const prompt = buildCopilotPromptForStory(story, workspaceRoot);
	log('  Delegating user story to Copilot...');
	await sendToCopilot(prompt, story.id, workspaceRoot);
	const taskMemoryResult = ensureTaskMemoryPersistence(story, workspaceRoot);
	log(`  Task memory ready for ${story.id}: ${taskMemoryResult.filePath} (${taskMemoryResult.source})`);
	return taskMemoryResult;
}

// ── Copilot Integration ─────────────────────────────────────────────────────

function buildCopilotPromptForStory(story: UserStory, workspaceRoot: string): string {
	const projectConstraintsLines = getProjectConstraintsPromptLines(workspaceRoot, story.id);
	const designContextLines = getDesignContextPromptLines(workspaceRoot, story);
	const priorWorkLines = getPriorWorkPromptLines(workspaceRoot, story);

	return composeStoryExecutionPrompt({
		story,
		workspaceRoot,
		projectConstraintsLines,
		designContextLines,
		priorWorkLines,
		taskMemoryPath: resolveTaskMemoryPath(workspaceRoot, story.id).replace(/\\/g, '/'),
		completionSignalPath: resolveTaskStatusPath(workspaceRoot, story.id).replace(/\\/g, '/'),
		additionalExecutionRules: [
			'Greedily execute as many sub-tasks as possible in a single pass.',
			'If something partially fails, keep all the parts that passed and do not revert them.',
			'Do not ask questions — execute directly.',
			'Make the actual code changes to the files in the workspace.',
		],
	});
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

	const designContext = readDesignContext(workspaceRoot, story.id);
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

function getMissingRequiredDesignContextReason(workspaceRoot: string, story: UserStory): string | null {
	const config = getConfig();
	if (!config.REQUIRE_DESIGN_CONTEXT_FOR_TAGGED_STORIES) {
		return null;
	}

	if (!isDesignSensitiveStory(story)) {
		return null;
	}

	if (readDesignContext(workspaceRoot, story.id)) {
		return null;
	}

	return `RALPH: Design context is required before executing ${story.id}. Run "RALPH: Record Design Context" first.`;
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

async function sendToCopilot(prompt: string, taskId: string, workspaceRoot: string): Promise<void> {
	log('  Sending prompt to Copilot Chat...');

	try {
		await vscode.commands.executeCommand('workbench.action.chat.open', {
			query: prompt,
			isPartialQuery: false
		});
	} catch {
		// Fallback: try older command API
		try {
			await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
			await sleep(1000);
			await vscode.commands.executeCommand('workbench.action.chat.open', prompt);
		} catch {
			log('  WARNING: Could not programmatically send to Copilot. Copying to clipboard.');
			await vscode.env.clipboard.writeText(prompt);
			await vscode.commands.executeCommand('workbench.action.chat.open');
			log('  Prompt copied to clipboard. Paste into Copilot Chat.');
		}
	}

	// Poll the .ralph status file until Copilot writes "completed" to it
	await waitForCopilotCompletion(taskId, workspaceRoot);
}

/**
 * Polls .ralph/task-<id>-status until Copilot writes "completed" to it.
 * Enforces a minimum wait (copilotMinWaitMs) before checking so that Copilot
 * has time to begin working before the first read.
 * Throws if the timeout is exceeded without seeing "completed".
 */
async function waitForCopilotCompletion(taskId: string, workspaceRoot: string): Promise<void> {
	const config = getConfig();
	log(`  Waiting for Copilot to write "completed" to .ralph/task-${taskId}-status...`);

	const startTime = Date.now();

	while (Date.now() - startTime < config.COPILOT_TIMEOUT_MS) {
		if (cancelToken?.token.isCancellationRequested) {
			throw new Error('Cancelled by user');
		}

		await sleep(config.COPILOT_RESPONSE_POLL_MS);
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

function ensureTaskMemoryPersistence(story: UserStory, workspaceRoot: string): { filePath: string; source: 'copilot' | 'synthesized' } {
	const existingMemory = hasTaskMemoryArtifact(workspaceRoot, story.id) ? readTaskMemory(workspaceRoot, story.id) : null;
	const validation = existingMemory ? validateTaskMemory(existingMemory, story.id) : null;

	if (validation?.isValid) {
		const filePath = writeTaskMemory(workspaceRoot, story.id, {
			...validation.artifact,
			source: validation.artifact.source ?? 'copilot',
		});
		upsertTaskMemoryIndexEntry(workspaceRoot, validation.artifact, story.id);
		log(`  Valid task memory artifact accepted for ${story.id}.`);
		return { filePath, source: validation.artifact.source ?? 'copilot' };
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
	return { filePath: fallbackPath, source: 'synthesized' };
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

function detectChangedFilesForTaskMemory(workspaceRoot: string, storyId: string): string[] {
	try {
		const output = execSync('git status --short --untracked-files=all', {
			cwd: workspaceRoot,
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});

		const changedFiles = output
			.split(/\r?\n/)
			.map(line => line.trim())
			.filter(line => line.length > 0)
			.map(line => line.slice(3).split(' -> ').pop() ?? '')
			.map(filePath => filePath.replace(/\\/g, '/'))
			.filter(filePath => filePath.length > 0 && !filePath.startsWith('.prd/') && filePath !== 'prd.json');

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
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) { return; }

	const prd = parsePrd(workspaceRoot);
	if (!prd) {
		vscode.window.showErrorMessage('prd.json not found or invalid.');
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
		`RALPH Status — ${prd.project}`,
		``,
		`✅ Completed: ${completed}/${total}`,
		`❌ Failed: ${failed}`,
		`⏳ Pending: ${pending}`,
		`🔄 In Progress: ${inProgress || 'None'}`,
		`📍 Next: ${nextPending ? `${nextPending.id} — ${nextPending.title}` : 'All done!'}`,
		``,
		`Running: ${isRunning ? 'Yes' : 'No'}`
	];

	outputChannel.show(true);
	log(lines.join('\n'));
	vscode.window.showInformationMessage(
		`RALPH: ${completed}/${total} stories done. ` +
		`Next: ${nextPending ? nextPending.id : 'Complete!'}`
	);
}

async function resetStory(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) { return; }

	const prd = parsePrd(workspaceRoot);
	if (!prd) {
		vscode.window.showErrorMessage('prd.json not found or invalid.');
		return;
	}

	const progress = readProgress(workspaceRoot);
	const trackedIds = new Set(progress.map(e => e.id));
	const trackedStories = prd.userStories.filter(s => trackedIds.has(s.id));

	if (trackedStories.length === 0) {
		vscode.window.showInformationMessage('没有可重置的已完成或失败故事。');
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
		placeHolder: '选择要重置的用户故事'
	});

	if (selection) {
		removeProgressEntry(workspaceRoot, selection.storyId);
		// Also clear the .ralph status file if present
		RalphStateManager.clearStalledTask(workspaceRoot, selection.storyId);
		RalphStateManager.clearStoryExecutionStatus(workspaceRoot, selection.storyId);
		vscode.window.showInformationMessage(`故事 ${selection.storyId} 已重置。`);
		log(`Story ${selection.storyId} reset by user.`);
	}
}

async function initializeProjectConstraints(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage('当前未打开工作区文件夹。');
		return;
	}

	outputChannel.show(true);
	log('═══════════════════════════════════════════════════');
	log('RALPH Initialize Project Constraints');
	log('═══════════════════════════════════════════════════');

	try {
		const result = initializeProjectConstraintsArtifacts(workspaceRoot);
		log(`Project constraints generated: ${result.generatedPath}`);
		log(`Project constraints editable rules: ${result.editablePath}`);
		log(`Technology summary items: ${result.generatedConstraints.technologySummary.length}`);
		log(`Delivery checklist items: ${result.generatedConstraints.deliveryChecklist.length}`);

		const action = await vscode.window.showInformationMessage(
			'RALPH：项目约束已初始化。',
			'打开可编辑规则',
			'打开生成摘要'
		);

		if (action === '打开可编辑规则') {
			const document = await vscode.workspace.openTextDocument(result.editablePath);
			await vscode.window.showTextDocument(document, { preview: false });
		} else if (action === '打开生成摘要') {
			const document = await vscode.workspace.openTextDocument(result.generatedPath);
			await vscode.window.showTextDocument(document, { preview: false });
		}
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		log(`ERROR: Failed to initialize project constraints: ${message}`);
		vscode.window.showErrorMessage(`RALPH：初始化项目约束失败：${message}`);
	}
}

async function recordDesignContext(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage('当前未打开工作区文件夹。');
		return;
	}

	const stories = getExistingSplitUserStories(workspaceRoot);
	if (stories.length === 0) {
		vscode.window.showWarningMessage('未找到已拆分的用户故事，请先执行“拆分 PRD”。');
		return;
	}

	const selectedStory = await selectStoryForDesignContext(stories);
	if (!selectedStory) {
		return;
	}

	const sourceType = await promptForDesignSourceType();
	if (!sourceType) {
		return;
	}

	const designContext = await collectDesignContextInput(workspaceRoot, selectedStory.id, sourceType);
	if (!designContext) {
		return;
	}

	const validation = validateDesignContext(designContext, selectedStory.id);
	const filePath = writeDesignContext(workspaceRoot, selectedStory.id, validation.artifact);
	log(`Design context saved for ${selectedStory.id}: ${filePath}`);

	if (!validation.isValid) {
		log(`Design context validation warnings for ${selectedStory.id}: ${validation.errors.join(' | ')}`);
	}

	const action = await vscode.window.showInformationMessage(
		validation.isValid
			? `RALPH：已为 ${selectedStory.id} 保存设计上下文。`
			: `RALPH：已为 ${selectedStory.id} 保存设计上下文，但存在警告。`,
		'打开设计上下文'
	);

	if (action === '打开设计上下文') {
		const document = await vscode.workspace.openTextDocument(filePath);
		await vscode.window.showTextDocument(document, { preview: false });
	}
}

async function recallRelatedTaskMemory(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage('No workspace folder open.');
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
		vscode.window.showInformationMessage(`RALPH: No related task memories found for ${targetStory.id}.`);
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
	const prd = parsePrd(workspaceRoot);
	const nextPendingStory = prd ? findNextPendingStory(prd, workspaceRoot) : null;
	const splitStories = getExistingSplitUserStories(workspaceRoot);

	const choice = await vscode.window.showQuickPick([
		...(nextPendingStory ? [{
			label: '下一个待执行故事',
			description: `${nextPendingStory.id} — ${nextPendingStory.title}`,
			value: 'next' as const,
		}] : []),
		...(splitStories.length > 0 ? [{
			label: '选择故事',
			description: '选择任意已拆分的用户故事以预览相关任务记忆',
			value: 'choose' as const,
		}] : []),
	], {
		placeHolder: '选择用于回忆相关任务记忆的故事',
	});

	if (!choice) {
		return undefined;
	}

	if (choice.value === 'next') {
		return nextPendingStory ?? undefined;
	}

	const selected = await vscode.window.showQuickPick(
		splitStories.map(story => ({
			label: `${story.id} — ${story.title || '未命名故事'}`,
			description: `[${normalizeStoryExecutionStatus(story.status) || '未开始'}] 优先级 ${story.priority}`,
			detail: (story.description || '').trim() || '无描述。',
			story,
		})),
		{
			matchOnDescription: true,
			matchOnDetail: true,
			placeHolder: '选择一个已拆分的故事以预览相关任务记忆',
		}
	);

	return selected?.story;
}

function renderRecalledTaskMemoryPreview(story: UserStory, matches: ReturnType<typeof recallRelatedTaskMemories>): string {
	const lines = [`# 相关任务记忆预览`, '', `故事：${story.id} — ${story.title}`, ''];
	for (const match of matches) {
		lines.push(`## ${match.memory.storyId} — ${match.memory.title}`);
		lines.push(`分数：${match.score}`);
		lines.push(`原因：${match.reasons.join('; ')}`);
		if (match.memory.summary) {
			lines.push(`摘要：${match.memory.summary}`);
		}
		if (match.memory.keyDecisions.length > 0) {
			lines.push('关键决策：');
			for (const decision of match.memory.keyDecisions.slice(0, 3)) {
				lines.push(`- ${decision}`);
			}
		}
		if (match.memory.changedFiles.length > 0) {
			lines.push('变更文件：');
			for (const changedFile of match.memory.changedFiles.slice(0, 3)) {
				lines.push(`- ${changedFile}`);
			}
		}
		lines.push('');
	}

	return lines.join('\n').trimEnd();
}

async function selectStoryForDesignContext(stories: SplitUserStory[]): Promise<SplitUserStory | undefined> {
	const selected = await vscode.window.showQuickPick(
		stories.map(story => ({
			label: `${story.id} — ${story.title || '未命名故事'}`,
			description: `[${normalizeStoryExecutionStatus(story.status) || '未开始'}] 优先级 ${story.priority}`,
			detail: (story.description || '').trim() || '无描述。',
			story,
		})),
		{
			matchOnDescription: true,
			matchOnDetail: true,
			placeHolder: '选择要附加设计上下文的已拆分故事',
		}
	);

	return selected?.story;
}

async function promptForDesignSourceType(): Promise<'figma' | 'screenshots' | 'notes' | undefined> {
	const picked = await vscode.window.showQuickPick([
		{
			label: '$(figma) Figma 链接',
			description: '记录 Figma 链接以及补充说明',
			value: 'figma' as const,
		},
		{
			label: '$(device-camera) 截图',
			description: '记录本地截图路径以及补充说明',
			value: 'screenshots' as const,
		},
		{
			label: '$(note) 手动备注',
			description: '仅以结构化备注的方式记录设计要求',
			value: 'notes' as const,
		},
	], {
		placeHolder: '选择主要的设计上下文来源',
	});

	return picked?.value;
}

async function collectDesignContextInput(
	workspaceRoot: string,
	storyId: string,
	sourceType: 'figma' | 'screenshots' | 'notes',
): Promise<Partial<import('./types').DesignContextArtifact> | undefined> {
	const existing = readDesignContext(workspaceRoot, storyId);
	const figmaUrl = sourceType === 'figma'
		? await vscode.window.showInputBox({
			title: 'Design Context — Figma URL',
			prompt: 'Paste the Figma link for this story',
			value: existing?.figmaUrl ?? '',
			ignoreFocusOut: true,
		})
		: existing?.figmaUrl;

	if (sourceType === 'figma' && figmaUrl === undefined) {
		return undefined;
	}

	let screenshotPaths = existing?.screenshotPaths ?? [];
	if (sourceType === 'screenshots') {
		const uris = await vscode.window.showOpenDialog({
			title: 'Select screenshot files for this story',
			canSelectMany: true,
			canSelectFiles: true,
			canSelectFolders: false,
			filters: { Images: ['png', 'jpg', 'jpeg', 'webp'] },
			openLabel: 'Use Screenshots',
		});
		if (uris === undefined) {
			return undefined;
		}
		screenshotPaths = uris.map(uri => vscode.workspace.asRelativePath(uri, false));
	}

	const summary = await promptForTextValue('Design Context — Summary', 'Summarize the design intent for this story', existing?.summary);
	if (summary === undefined) {
		return undefined;
	}

	const pageOrScreenName = await promptForTextValue('Design Context — Screen Name', 'Optional page or screen name', existing?.pageOrScreenName);
	if (pageOrScreenName === undefined) {
		return undefined;
	}

	const manualNotes = await promptForListValue('Design Context — Manual Notes', 'Optional notes, separated by commas or new lines', existing?.manualNotes ?? []);
	if (manualNotes === undefined) {
		return undefined;
	}

	const referenceDocs = await promptForListValue('Design Context — Reference Docs', 'Optional relative document paths or URLs', existing?.referenceDocs ?? []);
	if (referenceDocs === undefined) {
		return undefined;
	}

	const layoutConstraints = await promptForListValue('Design Context — Layout Constraints', 'List key layout constraints for this story', existing?.layoutConstraints ?? []);
	if (layoutConstraints === undefined) {
		return undefined;
	}

	const componentReuseTargets = await promptForListValue('Design Context — Component Reuse', 'List components that should be reused', existing?.componentReuseTargets ?? []);
	if (componentReuseTargets === undefined) {
		return undefined;
	}

	const tokenRules = await promptForListValue('Design Context — Token Rules', 'List color, spacing, or typography token rules', existing?.tokenRules ?? []);
	if (tokenRules === undefined) {
		return undefined;
	}

	const responsiveRules = await promptForListValue('Design Context — Responsive Rules', 'List responsive behavior requirements', existing?.responsiveRules ?? []);
	if (responsiveRules === undefined) {
		return undefined;
	}

	const doNotChange = await promptForListValue('Design Context — Do Not Change', 'List areas that must stay untouched', existing?.doNotChange ?? []);
	if (doNotChange === undefined) {
		return undefined;
	}

	const acceptanceChecks = await promptForListValue('Design Context — Acceptance Checks', 'List visual acceptance checks for implementation', existing?.acceptanceChecks ?? []);
	if (acceptanceChecks === undefined) {
		return undefined;
	}

	return {
		storyId,
		sourceType,
		figmaUrl: figmaUrl?.trim(),
		screenshotPaths,
		manualNotes,
		referenceDocs,
		summary,
		pageOrScreenName: pageOrScreenName?.trim(),
		layoutConstraints,
		componentReuseTargets,
		tokenRules,
		responsiveRules,
		doNotChange,
		acceptanceChecks,
		updatedAt: new Date().toISOString(),
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

async function splitPrd(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage('No workspace folder open.');
		return;
	}

	const prd = parsePrd(workspaceRoot);
	if (!prd) {
		vscode.window.showWarningMessage('prd.json not found. Please run Generate PRD first.');
		return;
	}

	writeSplitPrdFiles(workspaceRoot, prd);

	log(`Split PRD complete — wrote ${prd.userStories.length} user stories into ${PRD_DIR}/${USER_STORIES_DIR}.`);
	vscode.window.showInformationMessage(`RALPH: Split PRD complete. Exported ${prd.userStories.length} user stories.`);
}

async function mergePrd(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage('No workspace folder open.');
		return;
	}

	ensurePrdDirectories(workspaceRoot);
	const basePrd = readJsonFile<BasePrdFile>(getBasePrdPath(workspaceRoot));
	if (!basePrd) {
		vscode.window.showWarningMessage('base_prd.json not found. Please run Split PRD first.');
		return;
	}

	const userStoriesDir = getUserStoriesDirectoryPath(workspaceRoot);
	const pendingStories: UserStory[] = [];
	let normalizedCount = 0;

	for (const entry of fs.readdirSync(userStoriesDir)) {
		if (!/^US-.*\.json$/i.test(entry)) {
			continue;
		}

		const storyPath = path.join(userStoriesDir, entry);
		const story = readJsonFile<SplitUserStory>(storyPath);
		if (!story) {
			log(`WARNING: Skipping invalid user story file: ${entry}`);
			continue;
		}

		const normalizedStatus = normalizeStoryExecutionStatus(story.status) || '未开始';
		if (story.status !== normalizedStatus) {
			story.status = normalizedStatus;
			writeJsonFile(storyPath, story);
			normalizedCount++;
		}

		if (normalizedStatus !== 'completed') {
			pendingStories.push(stripStoryStatus(story));
		}
	}

	pendingStories.sort(compareStoriesByPriority);

	const mergedPrd = {
		...basePrd,
		userStories: pendingStories,
	} as PrdFile;

	writeJsonFile(getPrdPath(workspaceRoot), mergedPrd);
	log(`Merge PRD complete — normalized ${normalizedCount} story statuses and wrote ${pendingStories.length} pending stories to prd.json.`);
	vscode.window.showInformationMessage(`RALPH: Merge PRD complete. Normalized ${normalizedCount} stories and kept ${pendingStories.length} pending stories.`);
}

function loadSplitUserStories(workspaceRoot: string): SplitUserStory[] {
	const userStoriesDir = getUserStoriesDirectoryPath(workspaceRoot);
	if (!fs.existsSync(userStoriesDir)) {
		return [];
	}

	const stories: SplitUserStory[] = [];
	for (const entry of fs.readdirSync(userStoriesDir)) {
		if (!/^US-.*\.json$/i.test(entry)) {
			continue;
		}

		const storyPath = path.join(userStoriesDir, entry);
		const story = readJsonFile<UserStory>(storyPath);
		if (!story) {
			log(`WARNING: Skipping invalid user story file: ${entry}`);
			continue;
		}

		stories.push({
			...story,
			status: normalizeStoryExecutionStatus(story.status) || '未开始',
		});
	}

	return stories.sort(compareStoriesByPriority);
}

function writeSplitPrdFiles(workspaceRoot: string, prd: PrdFile): void {
	ensurePrdDirectories(workspaceRoot);
	const basePrd = stripUserStoriesFromPrd(prd);
	writeJsonFile(getBasePrdPath(workspaceRoot), basePrd);

	const storyIds = new Set(prd.userStories.map(story => story.id));
	for (const story of prd.userStories) {
		const splitStory: SplitUserStory = {
			...stripStoryStatus(story),
			status: resolveStoryStatusForSplit(workspaceRoot, story),
		};
		writeJsonFile(getUserStoryFilePath(workspaceRoot, story.id), splitStory);
	}

	const userStoriesDir = getUserStoriesDirectoryPath(workspaceRoot);
	for (const entry of fs.readdirSync(userStoriesDir)) {
		if (!/^US-.*\.json$/i.test(entry)) {
			continue;
		}

		const storyId = path.basename(entry, '.json');
		if (!storyIds.has(storyId)) {
			fs.unlinkSync(path.join(userStoriesDir, entry));
		}
	}
}


function getExistingSplitUserStories(workspaceRoot: string): SplitUserStory[] {
	const stories = loadSplitUserStories(workspaceRoot);
	if (stories.length > 0) {
		log(`User story editor loaded ${stories.length} stories from ${PRD_DIR}/${USER_STORIES_DIR}.`);
	} else {
		log(`User story editor found no readable stories in ${PRD_DIR}/${USER_STORIES_DIR}.`);
	}
	return stories;
}

function getUserStoryEditorPayload(workspaceRoot: string): SplitUserStory[] {
	return loadSplitUserStories(workspaceRoot);
}

function getNextUserStoryId(stories: SplitUserStory[]): string {
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

function createEmptyUserStoryTemplate(stories: SplitUserStory[]): SplitUserStory {
	const nextId = getNextUserStoryId(stories);
	return {
		id: nextId,
		title: 'New User Story',
		description: '',
		priority: stories.length > 0 ? Math.max(...stories.map(story => Number(story.priority) || 0)) + 1 : 1,
		acceptanceCriteria: [],
		status: '未开始',
		screenIds: [],
		dependsOn: [],
		designTrace: {},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function openNativeStoryFile(workspaceRoot: string, storyId: string): Promise<void> {
	const storyPath = getUserStoryFilePath(workspaceRoot, storyId);
	if (!fs.existsSync(storyPath)) {
		vscode.window.showErrorMessage(`Story file not found for ${storyId}.`);
		return;
	}

	const document = await vscode.workspace.openTextDocument(storyPath);
	await vscode.window.showTextDocument(document, {
		preview: false,
		preserveFocus: false,
	});
}

async function createStoryFromNativeEditor(workspaceRoot: string): Promise<SplitUserStory | null> {
	const storiesBeforeCreate = getExistingSplitUserStories(workspaceRoot);
	const newStory = createEmptyUserStoryTemplate(storiesBeforeCreate);
	writeJsonFile(getUserStoryFilePath(workspaceRoot, newStory.id), newStory);
	log(`User story ${newStory.id} created from native editor.`);
	vscode.window.showInformationMessage(`RALPH: ${newStory.id} created.`);
	await openNativeStoryFile(workspaceRoot, newStory.id);
	return newStory;
}

async function deleteStoryFromNativeEditor(workspaceRoot: string, story: SplitUserStory): Promise<boolean> {
	const confirmed = await vscode.window.showWarningMessage(
		`Delete ${story.id} — ${story.title}? This removes the split story file.`,
		{ modal: true },
		'Delete'
	);

	if (confirmed !== 'Delete') {
		return false;
	}

	const storyPath = getUserStoryFilePath(workspaceRoot, story.id);
	if (!fs.existsSync(storyPath)) {
		vscode.window.showErrorMessage(`Story file not found for ${story.id}.`);
		return false;
	}

	fs.unlinkSync(storyPath);
	log(`User story ${story.id} deleted from native editor.`);
	vscode.window.showInformationMessage(`RALPH: ${story.id} deleted.`);
	return true;
}

async function showNativeStoryActions(workspaceRoot: string, story: SplitUserStory): Promise<'back' | 'deleted' | 'exit'> {
	while (true) {
		const action = await vscode.window.showQuickPick([
			{
				label: '$(edit) 在编辑器中打开 JSON',
				description: `${story.id} — 使用 VS Code 原生文本编辑器编辑`,
				value: 'open',
			},
			{
				label: '$(refresh) 从磁盘重新打开',
				description: '从磁盘重新加载该故事并在编辑器中打开',
				value: 'reload',
			},
			{
				label: '$(trash) 删除故事',
				description: '删除该已拆分的故事文件',
				value: 'delete',
			},
			{
				label: '$(arrow-left) 返回故事列表',
				description: '选择其他故事',
				value: 'back',
			},
		], {
			placeHolder: `${story.id} — 选择一个操作`,
			ignoreFocusOut: false,
		});

		if (!action) {
			return 'exit';
		}

		if (action.value === 'open') {
			await openNativeStoryFile(workspaceRoot, story.id);
			return 'exit';
		}

		if (action.value === 'reload') {
			const refreshedStory = readJsonFile<SplitUserStory>(getUserStoryFilePath(workspaceRoot, story.id));
			if (!refreshedStory) {
				vscode.window.showErrorMessage(`无法从磁盘重新加载 ${story.id}。`);
				return 'back';
			}
			story = {
				...refreshedStory,
				status: normalizeStoryExecutionStatus(refreshedStory.status) || '未开始',
			};
			await openNativeStoryFile(workspaceRoot, story.id);
			return 'exit';
		}

		if (action.value === 'delete') {
			const deleted = await deleteStoryFromNativeEditor(workspaceRoot, story);
			if (deleted) {
				return 'deleted';
			}
			continue;
		}

		return 'back';
	}
}

async function openUserStoryEditor(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage('当前未打开工作区文件夹。');
		return;
	}

	const userStoriesDir = getUserStoriesDirectoryPath(workspaceRoot);
	if (!fs.existsSync(userStoriesDir)) {
		vscode.window.showWarningMessage('未找到已拆分的用户故事，请先执行“拆分 PRD”。');
		return;
	}

	const stories = getExistingSplitUserStories(workspaceRoot);
	if (stories.length === 0) {
		vscode.window.showWarningMessage('未找到可读取的已拆分用户故事，请检查 .prd/user_stories/*.json 或重新执行“拆分 PRD”。');
		return;
	}

	while (true) {
		const refreshedStories = getExistingSplitUserStories(workspaceRoot);
		const picked = await vscode.window.showQuickPick([
			{
				label: '$(add) 新建故事',
				description: '创建新的已拆分用户故事 JSON 文件并在编辑器中打开',
				value: '__create__',
			},
			{
				label: '$(refresh) 刷新故事列表',
				description: '从 .prd/user_stories 重新加载用户故事',
				value: '__refresh__',
			},
			...refreshedStories.map(story => ({
				label: `${story.id} — ${story.title || '未命名故事'}`,
				description: `[${normalizeStoryExecutionStatus(story.status) || '未开始'}] 优先级 ${story.priority}`,
				detail: (story.description || '').trim() || '无描述。',
				value: story.id,
			})),
		], {
			matchOnDescription: true,
			matchOnDetail: true,
			ignoreFocusOut: false,
			placeHolder: '选择要在 VS Code 中原生编辑的用户故事',
		});

		if (!picked) {
			return;
		}

		if (picked.value === '__refresh__') {
			continue;
		}

		if (picked.value === '__create__') {
			await createStoryFromNativeEditor(workspaceRoot);
			continue;
		}

		const selectedStory = refreshedStories.find(story => story.id === picked.value);
		if (!selectedStory) {
			vscode.window.showWarningMessage(`找不到用户故事 ${picked.value}。`);
			continue;
		}

		const result = await showNativeStoryActions(workspaceRoot, selectedStory);
		if (result === 'exit') {
			return;
		}
	}
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
	return new Promise(resolve => setTimeout(resolve, ms));
}

function updateStatusBar(state: 'idle' | 'running'): void {
	if (!statusBarItem) { return; }
	if (state === 'running') {
		statusBarItem.text = '$(sync~spin) Ralph Runner';
		statusBarItem.tooltip = 'RALPH Runner：任务执行中，点击打开菜单';
		statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
	} else {
		statusBarItem.text = '$(rocket) Ralph Runner';
		statusBarItem.tooltip = 'RALPH Runner：点击显示命令菜单';
		statusBarItem.backgroundColor = undefined;
	}
}

async function showCommandMenu(): Promise<void> {
	const items: vscode.QuickPickItem[] = [
		{ label: '$(symbol-key)  初始化项目约束', description: '扫描仓库并生成可编辑和机器可读的项目规则' },
		{ label: '$(device-camera-video)  记录设计上下文', description: '为已拆分的故事附加结构化设计输入' },
		{ label: '$(history)  回忆相关任务记忆', description: '预览某个故事最相关的历史任务记忆' },
		{ label: '$(zap)  生成 PRD', description: '通过 Copilot 生成 prd.json' },
		{ label: '$(split-horizontal)  拆分 PRD', description: '将 prd.json 拆分为 base_prd.json 和每个故事的独立文件' },
		{ label: '$(git-merge)  合并 PRD', description: '将 base_prd.json 和待处理故事文件合并回 prd.json' },
		{ label: '$(edit)  编辑用户故事', description: '打开已拆分用户故事的可视化编辑入口' },
		{ label: '$(play)  开始执行', description: '开始或继续自动任务循环' },
		{ label: '$(debug-stop)  停止执行', description: '取消当前运行' },
		{ label: '$(info)  查看状态', description: '显示用户故事进度摘要' },
		{ label: '$(debug-restart)  重置故事', description: '重置某个已完成的用户故事' },
		{ label: '$(gear)  打开设置', description: '配置 RALPH Runner 选项' },
	];

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: 'RALPH Runner：选择一个命令',
	});

	if (!selected) { return; }

	const commandMap: Record<string, string> = {
		'$(symbol-key)  初始化项目约束': 'ralph-runner.initProjectConstraints',
		'$(device-camera-video)  记录设计上下文': 'ralph-runner.recordDesignContext',
		'$(history)  回忆相关任务记忆': 'ralph-runner.recallTaskMemory',
		'$(zap)  生成 PRD': 'ralph-runner.quickStart',
		'$(split-horizontal)  拆分 PRD': 'ralph-runner.splitPrd',
		'$(git-merge)  合并 PRD': 'ralph-runner.mergePrd',
		'$(edit)  编辑用户故事': 'ralph-runner.openUserStoryEditor',
		'$(play)  开始执行': 'ralph-runner.start',
		'$(debug-stop)  停止执行': 'ralph-runner.stop',
		'$(info)  查看状态': 'ralph-runner.status',
		'$(debug-restart)  重置故事': 'ralph-runner.resetStep',
		'$(gear)  打开设置': 'ralph-runner.openSettings',
	};

	const cmd = commandMap[selected.label];
	if (cmd) {
		vscode.commands.executeCommand(cmd);
	}
}

// ── Quick Start ─────────────────────────────────────────────────────────────
// Guides the user through setting up prd.json.
// 1. Checks if prd.json already exists in the workspace root.
// 2. If missing, asks the user to provide a path to an existing file.
// 3. If the user doesn't have one, asks what they want to accomplish and
//    uses Copilot to generate prd.json in the expected format.

async function quickStart(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage('No workspace folder open.');
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
			'RALPH：工作区根目录中已存在 prd.json。',
			'开始执行', '打开 PRD'
		);
		if (action === '开始执行') {
			vscode.commands.executeCommand('ralph-runner.start');
		} else if (action === '打开 PRD') {
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
				label: '$(file-directory) 我已有这个文件，手动提供路径',
				description: '选择一个已有的 prd.json 文件',
				value: 'provide'
			},
			{
				label: '$(sparkle) 我还没有，让 Copilot 帮我生成',
				description: '描述你的目标，让 Copilot 生成 prd.json',
				value: 'generate'
			}
		],
		{ placeHolder: '工作区根目录中未找到 prd.json，你希望如何继续？' }
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
	const uris = await vscode.window.showOpenDialog({
		title: '选择你的 prd.json 文件',
		canSelectMany: false,
		canSelectFolders: false,
		filters: { 'JSON': ['json'], 'All Files': ['*'] },
		openLabel: '选择 prd.json'
	});

	if (!uris || uris.length === 0) {
		vscode.window.showWarningMessage('RALPH：已取消，未选择 prd.json。');
		return;
	}

	const srcPath = uris[0].fsPath;
	fs.copyFileSync(srcPath, prdPath);
	log(`Copied prd.json from ${srcPath}`);
	vscode.window.showInformationMessage('RALPH：prd.json 已准备完成，现在可以执行“RALPH: 开始执行”。');
	log('Generate PRD complete — file placed in workspace root.');
}

/**
 * Ask the user what they want to accomplish, then send a Copilot prompt that
 * generates prd.json in the expected format used by the RALPH Runner extension.
 */
async function quickStartGenerate(workspaceRoot: string): Promise<void> {
	const userGoal = await vscode.window.showInputBox({
		title: 'RALPH 生成 PRD：描述你的目标',
		prompt: '你想完成什么？例如“修复所有 TypeScript 错误”“给所有服务补充单元测试”“从 jQuery 迁移到 React”',
		placeHolder: '请描述你想完成的目标…',
		ignoreFocusOut: true
	});

	if (!userGoal || userGoal.trim().length === 0) {
		vscode.window.showWarningMessage('RALPH：已取消，未提供目标描述。');
		return;
	}

	log(`User goal: ${userGoal}`);
	log('Sending generation prompt to Copilot…');

	const prompt = buildQuickStartPrompt(userGoal, workspaceRoot);

	try {
		await vscode.commands.executeCommand('workbench.action.chat.open', {
			query: prompt,
			isPartialQuery: false
		});
	} catch {
		try {
			await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
			await sleep(1000);
			await vscode.commands.executeCommand('workbench.action.chat.open', prompt);
		} catch {
			log('WARNING: Could not programmatically send to Copilot. Copying to clipboard.');
			await vscode.env.clipboard.writeText(prompt);
			await vscode.commands.executeCommand('workbench.action.chat.open');
			vscode.window.showInformationMessage('RALPH：提示词已复制到剪贴板，请粘贴到 Copilot Chat。');
		}
	}

	vscode.window.showInformationMessage(
		'RALPH：Copilot 正在生成 prd.json。生成后出现在工作区根目录时，执行“RALPH: 开始执行”。'
	);
	log('Generate PRD prompt sent to Copilot. Waiting for file generation…');
}

/**
 * Builds the Copilot prompt that instructs it to generate prd.json
 * in the exact format the RALPH Runner expects.
 */
function buildQuickStartPrompt(userGoal: string, workspaceRoot: string): string {
	return [
		'Go through entire codebase and understand the code.',
		`The user wants to accomplish the following goal: ${userGoal}`,
		``,
		`Workspace root: ${workspaceRoot}`,
		``,
		`Please analyze the workspace and generate one file in the workspace root called prd.json following the syntax below.`,
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
		`INSTRUCTIONS:`,
		`- If the user forgot to provide a goal, ask him again to provide one. A goal is mandatory. If the provided goal is generic/placeholder/not clear enough. Ask again.`,
		`- The json should have a logical sequence of user stories organized into phases.`,
		`- Each user story should be granular enough to be independently executable and verifiable.`,
		`- Number user stories sequentially starting from "US-001".`,
		`- Do NOT include "passes" or "notes" fields in the user stories. Progress is tracked separately.`,
		`- After EVERY user story, insert a git commit user story. This story should stage all changes and commit them with a meaningful message describing what was done in the preceding user story. For example: { "id": "US-002", "title": "Git Commit: Setup Project Structure", "description": "Stage all changes and commit to git with message: 'feat: setup project structure and enums'", "acceptanceCriteria": ["All changes are staged", "Changes are committed with a descriptive message"], "priority": 2 }.`,
		`- The git commit stories must use conventional commit message format (feat:, fix:, refactor:, docs:, chore:, etc.).`,
		``,
		`IMPORTANT:`,
		`- DO NOT use any absolute, user-specific, or local system-specific paths, directories, namespaces, or usernames in any command or file path.`,
		`- All file paths and commands must be relative and portable, so the plan works for any user on any system.`,
		`- Avoid referencing any local folders outside the workspace root.`,
		`- Do not use commands that reference your own username, home directory, or machine-specific details.`,
		`- The plan must be fully shareable and portable.`,
		``,
		`IMPORTANT:`,
		`- Create the file at the workspace root: ${workspaceRoot}`,
		`- Be thorough: include all necessary user stories for the user's goal`,
		`- Actually create the file — do not just show its content`,
	].join('\n');
}
