import * as fs from 'fs';
import {
	TaskMemoryArtifact,
	TaskMemoryIndex,
	TaskMemoryIndexEntry,
} from './types';
import {
	ensureTaskMemoryDirectory,
	getTaskMemoryIndexPath,
	getTaskMemoryPath,
} from './workspacePaths';

export interface TaskMemoryValidationResult {
	artifact: TaskMemoryArtifact;
	errors: string[];
	isValid: boolean;
}

export function createEmptyTaskMemory(storyId: string, title = ''): TaskMemoryArtifact {
	return {
		storyId,
		title,
		summary: '',
		changedFiles: [],
		changedModules: [],
		keyDecisions: [],
		patternsUsed: [],
		constraintsConfirmed: [],
		testsRun: [],
		risks: [],
		followUps: [],
		searchKeywords: [],
		relatedStories: [],
		createdAt: new Date().toISOString(),
	};
}

export function createEmptyTaskMemoryIndex(): TaskMemoryIndex {
	return {
		version: 1,
		updatedAt: new Date().toISOString(),
		entries: [],
	};
}

export function ensureTaskMemoryScaffold(workspaceRoot: string): { memoryDirectory: string; indexPath: string } {
	const memoryDirectory = ensureTaskMemoryDirectory(workspaceRoot);
	const indexPath = getTaskMemoryIndexPath(workspaceRoot);
	if (!fs.existsSync(indexPath)) {
		fs.writeFileSync(indexPath, `${JSON.stringify(createEmptyTaskMemoryIndex(), null, 2)}\n`, 'utf-8');
	}
	return { memoryDirectory, indexPath };
}

export function hasTaskMemoryArtifact(workspaceRoot: string, storyId: string): boolean {
	return fs.existsSync(getTaskMemoryPath(workspaceRoot, storyId));
}

export function writeTaskMemory(
	workspaceRoot: string,
	storyId: string,
	memory: Partial<TaskMemoryArtifact>,
): string {
	ensureTaskMemoryScaffold(workspaceRoot);
	const filePath = getTaskMemoryPath(workspaceRoot, storyId);
	const validation = validateTaskMemory(memory, storyId);
	fs.writeFileSync(filePath, `${JSON.stringify(validation.artifact, null, 2)}\n`, 'utf-8');
	return filePath;
}

export function validateTaskMemory(
	value: Partial<TaskMemoryArtifact> | null | undefined,
	storyId: string,
): TaskMemoryValidationResult {
	const artifact = normalizeTaskMemory(value, storyId);
	const errors: string[] = [];

	if (artifact.summary.length === 0) {
		errors.push('A task memory entry should include a summary.');
	}
	if (artifact.changedFiles.length === 0) {
		errors.push('A task memory entry should include at least one changed file.');
	}
	if (artifact.keyDecisions.length === 0) {
		errors.push('A task memory entry should include at least one key decision.');
	}
	if (artifact.searchKeywords.length === 0) {
		errors.push('A task memory entry should include recall keywords in searchKeywords.');
	}

	return {
		artifact,
		errors,
		isValid: errors.length === 0,
	};
}

export function readTaskMemory(workspaceRoot: string, storyId: string): TaskMemoryArtifact | null {
	try {
		const content = fs.readFileSync(getTaskMemoryPath(workspaceRoot, storyId), 'utf-8');
		return normalizeTaskMemory(JSON.parse(content) as Partial<TaskMemoryArtifact>, storyId);
	} catch {
		return null;
	}
}

export function readTaskMemoryIndex(workspaceRoot: string): TaskMemoryIndex {
	try {
		const content = fs.readFileSync(getTaskMemoryIndexPath(workspaceRoot), 'utf-8');
		return normalizeTaskMemoryIndex(JSON.parse(content) as Partial<TaskMemoryIndex>);
	} catch {
		return createEmptyTaskMemoryIndex();
	}
}

export function writeTaskMemoryIndex(workspaceRoot: string, index: Partial<TaskMemoryIndex> | null | undefined): string {
	ensureTaskMemoryScaffold(workspaceRoot);
	const filePath = getTaskMemoryIndexPath(workspaceRoot);
	const normalizedIndex = normalizeTaskMemoryIndex(index);
	fs.writeFileSync(filePath, `${JSON.stringify(normalizedIndex, null, 2)}\n`, 'utf-8');
	return filePath;
}

export function createTaskMemoryIndexEntry(memory: TaskMemoryArtifact, memoryPath: string): TaskMemoryIndexEntry {
	return {
		storyId: memory.storyId,
		title: memory.title,
		changedFiles: memory.changedFiles,
		changedModules: memory.changedModules,
		searchKeywords: memory.searchKeywords,
		relatedStories: memory.relatedStories,
		createdAt: memory.createdAt,
		memoryPath,
	};
}

export function upsertTaskMemoryIndexEntry(workspaceRoot: string, memory: Partial<TaskMemoryArtifact>, storyId: string): TaskMemoryIndex {
	ensureTaskMemoryScaffold(workspaceRoot);
	const normalizedMemory = normalizeTaskMemory(memory, storyId);
	const nextEntry = createTaskMemoryIndexEntry(normalizedMemory, getTaskMemoryPath(workspaceRoot, storyId));
	const currentIndex = readTaskMemoryIndex(workspaceRoot);
	const entries = currentIndex.entries.filter(entry => entry.storyId !== storyId);
	entries.push(nextEntry);
	entries.sort(compareIndexEntries);

	const nextIndex: TaskMemoryIndex = {
		version: currentIndex.version,
		updatedAt: new Date().toISOString(),
		entries,
	};

	writeTaskMemoryIndex(workspaceRoot, nextIndex);
	return nextIndex;
}

export function rebuildTaskMemoryIndex(workspaceRoot: string): TaskMemoryIndex {
	ensureTaskMemoryScaffold(workspaceRoot);
	const memoryDirectory = ensureTaskMemoryDirectory(workspaceRoot);
	const entries: TaskMemoryIndexEntry[] = [];

	for (const entryName of fs.readdirSync(memoryDirectory)) {
		if (!entryName.endsWith('.json')) {
			continue;
		}

		const storyId = entryName.replace(/\.json$/i, '');
		const memory = readTaskMemory(workspaceRoot, storyId);
		if (!memory) {
			continue;
		}

		entries.push(createTaskMemoryIndexEntry(memory, getTaskMemoryPath(workspaceRoot, storyId)));
	}

	entries.sort(compareIndexEntries);
	const rebuiltIndex: TaskMemoryIndex = {
		version: 1,
		updatedAt: new Date().toISOString(),
		entries,
	};

	writeTaskMemoryIndex(workspaceRoot, rebuiltIndex);
	return rebuiltIndex;
}

export function normalizeTaskMemory(value: Partial<TaskMemoryArtifact> | null | undefined, storyId: string): TaskMemoryArtifact {
	const fallback = createEmptyTaskMemory(storyId);
	if (!value) {
		return fallback;
	}
	return {
		storyId,
		title: normalizeOptionalString(value.title) ?? fallback.title,
		summary: normalizeOptionalString(value.summary) ?? fallback.summary,
		changedFiles: toStringArray(value.changedFiles),
		changedModules: toStringArray(value.changedModules),
		keyDecisions: toStringArray(value.keyDecisions),
		patternsUsed: toStringArray(value.patternsUsed),
		constraintsConfirmed: toStringArray(value.constraintsConfirmed),
		testsRun: toStringArray(value.testsRun),
		risks: toStringArray(value.risks),
		followUps: toStringArray(value.followUps),
		searchKeywords: toStringArray(value.searchKeywords),
		relatedStories: toStringArray(value.relatedStories),
		createdAt: normalizeOptionalString(value.createdAt) ?? fallback.createdAt,
		source: value.source === 'copilot' || value.source === 'synthesized' ? value.source : undefined,
	};
}

export function normalizeTaskMemoryIndex(value: Partial<TaskMemoryIndex> | null | undefined): TaskMemoryIndex {
	const fallback = createEmptyTaskMemoryIndex();
	if (!value) {
		return fallback;
	}
	return {
		version: typeof value.version === 'number' ? value.version : fallback.version,
		updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : fallback.updatedAt,
		entries: Array.isArray(value.entries) ? value.entries.map(normalizeTaskMemoryIndexEntry).filter((entry): entry is TaskMemoryIndexEntry => entry !== null) : [],
	};
}

export function summarizeTaskMemoryForPrompt(memory: TaskMemoryArtifact | null): string[] {
	if (!memory) {
		return [];
	}
	return [
		...(memory.summary ? [`Summary: ${memory.summary}`, ''] : []),
		...prefixLines('Changed Files', memory.changedFiles),
		...prefixLines('Changed Modules', memory.changedModules),
		...prefixLines('Key Decisions', memory.keyDecisions),
		...prefixLines('Confirmed Constraints', memory.constraintsConfirmed),
		...prefixLines('Tests Run', memory.testsRun),
		...prefixLines('Risks', memory.risks),
		...prefixLines('Follow Ups', memory.followUps),
	];
}

function normalizeTaskMemoryIndexEntry(value: unknown): TaskMemoryIndexEntry | null {
	if (!value || typeof value !== 'object') {
		return null;
	}
	const entry = value as Partial<TaskMemoryIndexEntry>;
	if (typeof entry.storyId !== 'string' || typeof entry.title !== 'string' || typeof entry.memoryPath !== 'string') {
		return null;
	}
	return {
		storyId: entry.storyId,
		title: normalizeOptionalString(entry.title) ?? '',
		changedFiles: toStringArray(entry.changedFiles),
		changedModules: toStringArray(entry.changedModules),
		searchKeywords: toStringArray(entry.searchKeywords),
		relatedStories: toStringArray(entry.relatedStories),
		createdAt: normalizeOptionalString(entry.createdAt) ?? new Date().toISOString(),
		memoryPath: entry.memoryPath,
	};
}

function prefixLines(label: string, values: string[]): string[] {
	if (values.length === 0) {
		return [];
	}
	return [label, ...values.map(value => `- ${value}`), ''];
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const normalizedItems = value
		.filter((item): item is string => typeof item === 'string')
		.map(item => item.trim())
		.filter(item => item.length > 0);

	return Array.from(new Set(normalizedItems));
}

function normalizeOptionalString(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function compareIndexEntries(left: TaskMemoryIndexEntry, right: TaskMemoryIndexEntry): number {
	const dateComparison = right.createdAt.localeCompare(left.createdAt);
	if (dateComparison !== 0) {
		return dateComparison;
	}

	return left.storyId.localeCompare(right.storyId);
}