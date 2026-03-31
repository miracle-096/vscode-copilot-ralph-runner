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

export function normalizeTaskMemory(value: Partial<TaskMemoryArtifact> | null | undefined, storyId: string): TaskMemoryArtifact {
	const fallback = createEmptyTaskMemory(storyId);
	if (!value) {
		return fallback;
	}
	return {
		storyId,
		title: typeof value.title === 'string' ? value.title : fallback.title,
		summary: typeof value.summary === 'string' ? value.summary : fallback.summary,
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
		createdAt: typeof value.createdAt === 'string' ? value.createdAt : fallback.createdAt,
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
		...prefixLines('Key Decisions', memory.keyDecisions),
		...prefixLines('Confirmed Constraints', memory.constraintsConfirmed),
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
		title: entry.title,
		changedFiles: toStringArray(entry.changedFiles),
		changedModules: toStringArray(entry.changedModules),
		searchKeywords: toStringArray(entry.searchKeywords),
		relatedStories: toStringArray(entry.relatedStories),
		createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString(),
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
	return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}