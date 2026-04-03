import * as fs from 'fs';
import {
	StoryReviewLoopState,
	StoryReviewResult,
	TaskMemoryArtifact,
	TaskMemoryIndex,
	TaskMemoryIndexEntry,
	UserStory,
} from './types';
import {
	normalizeStoryReviewLoopState,
	normalizeStoryReviewResult,
	summarizeStoryReviewForPrompt,
} from './storyReview';
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

export interface SynthesizedTaskMemoryOptions {
	changedFiles?: string[];
	changedModules?: string[];
	keyDecisions?: string[];
	constraintsConfirmed?: string[];
	testsRun?: string[];
	risks?: string[];
	followUps?: string[];
	searchKeywords?: string[];
	relatedStories?: string[];
}

export interface RecalledTaskMemoryMatch {
	memory: TaskMemoryArtifact;
	score: number;
	reasons: string[];
	keywordOverlap: string[];
	moduleOverlap: string[];
	fileOverlap: string[];
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
		reviewSummary: undefined,
		reviewLoop: undefined,
		createdAt: new Date().toISOString(),
	};
}

export function createSynthesizedTaskMemory(
	storyId: string,
	title: string,
	summary: string,
	options: SynthesizedTaskMemoryOptions = {},
): TaskMemoryArtifact {
	return normalizeTaskMemory({
		storyId,
		title,
		summary,
		changedFiles: options.changedFiles ?? ['(unable to determine changed files automatically)'],
		changedModules: options.changedModules ?? [],
		keyDecisions: options.keyDecisions ?? ['RALPH synthesized this task memory because a valid artifact was not persisted before completion.'],
		constraintsConfirmed: options.constraintsConfirmed ?? ['prd.json remained read-only during task execution.'],
		testsRun: options.testsRun ?? [],
		risks: options.risks ?? ['Synthesized memory may need manual review before using it for recall.'],
		followUps: options.followUps ?? ['Review synthesized task memory fields for completeness.'],
		searchKeywords: options.searchKeywords ?? [storyId.toLowerCase(), title.toLowerCase()],
		relatedStories: options.relatedStories ?? [],
		source: 'synthesized',
	}, storyId);
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
		reviewSummary: normalizeOptionalReviewSummary(value.reviewSummary),
		reviewLoop: normalizeOptionalReviewLoop(value.reviewLoop),
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
		...prefixLines('Review Summary', summarizeStoryReviewForPrompt(memory.reviewSummary ?? null), 8),
	];
}

export function recallRelatedTaskMemories(
	workspaceRoot: string,
	story: UserStory,
	options?: { limit?: number },
): RecalledTaskMemoryMatch[] {
	const limit = options?.limit ?? 3;
	const recallContext = buildStoryRecallContext(story);
	const index = readTaskMemoryIndex(workspaceRoot);
	const matches: RecalledTaskMemoryMatch[] = [];

	for (const entry of index.entries) {
		if (entry.storyId === story.id) {
			continue;
		}

		const memory = readTaskMemory(workspaceRoot, entry.storyId);
		if (!memory) {
			continue;
		}

		const scored = scoreTaskMemoryMatch(memory, entry, recallContext, index.entries);
		if (scored.score <= 0) {
			continue;
		}

		matches.push(scored);
	}

	matches.sort((left, right) => {
		if (right.score !== left.score) {
			return right.score - left.score;
		}
		return right.memory.createdAt.localeCompare(left.memory.createdAt);
	});

	return matches.slice(0, limit);
}

export function summarizeRecalledTaskMemoriesForPrompt(matches: RecalledTaskMemoryMatch[], limit = 3): string[] {
	if (matches.length === 0) {
		return [];
	}

	const lines: string[] = [];
	for (const match of matches.slice(0, limit)) {
		lines.push(`${match.memory.storyId} — ${match.memory.title} (score ${match.score})`);
		lines.push(`Why it matters: ${match.reasons.slice(0, 3).join('; ')}`);
		if (match.memory.summary) {
			lines.push(`Summary: ${match.memory.summary}`);
		}
		for (const decision of match.memory.keyDecisions.slice(0, 2)) {
			lines.push(`- Decision: ${decision}`);
		}
		for (const changedFile of match.memory.changedFiles.slice(0, 2)) {
			lines.push(`- File: ${changedFile}`);
		}
		lines.push('');
	}

	return lines.slice(0, lines[lines.length - 1] === '' ? lines.length - 1 : lines.length);
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

function prefixLines(label: string, values: string[], limit?: number): string[] {
	if (values.length === 0) {
		return [];
	}
	const boundedValues = typeof limit === 'number' ? values.slice(0, limit) : values;
	return [label, ...boundedValues.map(value => `- ${value}`), ''];
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

function normalizeOptionalReviewSummary(value: unknown): StoryReviewResult | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}

	return normalizeStoryReviewResult(value as Partial<StoryReviewResult>);
}

function normalizeOptionalReviewLoop(value: unknown): StoryReviewLoopState | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}

	return normalizeStoryReviewLoopState(value as Partial<StoryReviewLoopState>);
}

function compareIndexEntries(left: TaskMemoryIndexEntry, right: TaskMemoryIndexEntry): number {
	const dateComparison = right.createdAt.localeCompare(left.createdAt);
	if (dateComparison !== 0) {
		return dateComparison;
	}

	return left.storyId.localeCompare(right.storyId);
}

interface StoryRecallContext {
	storyId: string;
	relatedStories: string[];
	keywords: string[];
	moduleHints: string[];
	fileHints: string[];
}

function buildStoryRecallContext(story: UserStory): StoryRecallContext {
	const relatedStories = new Set<string>();
	for (const key of ['dependsOn', 'relatedStories']) {
		const rawValue = story[key];
		if (!Array.isArray(rawValue)) {
			continue;
		}

		for (const item of rawValue) {
			if (typeof item === 'string' && /^US-\d+$/i.test(item.trim())) {
				relatedStories.add(item.trim().toUpperCase());
			}
		}
	}

	const keywords = extractKeywords([
		story.id,
		story.title,
		story.description,
		...story.acceptanceCriteria,
	]);
	const moduleHints = extractPathLikeValues(story, ['moduleHints', 'changedModules', 'paths']);
	const fileHints = extractPathLikeValues(story, ['fileHints', 'changedFiles', 'paths']);

	return {
		storyId: story.id,
		relatedStories: Array.from(relatedStories),
		keywords,
		moduleHints,
		fileHints,
	};
}

function scoreTaskMemoryMatch(
	memory: TaskMemoryArtifact,
	entry: TaskMemoryIndexEntry,
	context: StoryRecallContext,
	entries: TaskMemoryIndexEntry[],
): RecalledTaskMemoryMatch {
	let score = 0;
	const reasons: string[] = [];
	const keywordOverlap = intersect(context.keywords, entry.searchKeywords.map(value => value.toLowerCase()));
	const moduleOverlap = intersect(normalizeLower(context.moduleHints), normalizeLower(entry.changedModules));
	const fileOverlap = intersect(normalizeLower(context.fileHints), normalizeLower(entry.changedFiles));

	if (context.relatedStories.includes(memory.storyId) || memory.relatedStories.includes(context.storyId)) {
		score += 50;
		reasons.push('direct story relationship');
	}

	const sharedRelatedStories = intersect(context.relatedStories.map(value => value.toLowerCase()), memory.relatedStories.map(value => value.toLowerCase()));
	if (sharedRelatedStories.length > 0) {
		score += Math.min(24, sharedRelatedStories.length * 12);
		reasons.push(`shared related stories: ${sharedRelatedStories.join(', ')}`);
	}

	if (keywordOverlap.length > 0) {
		score += Math.min(32, keywordOverlap.length * 8);
		reasons.push(`keyword overlap: ${keywordOverlap.slice(0, 4).join(', ')}`);
	}

	if (moduleOverlap.length > 0) {
		score += Math.min(24, moduleOverlap.length * 12);
		reasons.push(`module overlap: ${moduleOverlap.slice(0, 3).join(', ')}`);
	}

	if (fileOverlap.length > 0) {
		score += Math.min(30, fileOverlap.length * 15);
		reasons.push(`file overlap: ${fileOverlap.slice(0, 3).join(', ')}`);
	}

	const recencyBonus = calculateRecencyBonus(entry, entries);
	if (recencyBonus > 0) {
		score += recencyBonus;
		reasons.push(`recent work bonus: ${recencyBonus}`);
	}

	return {
		memory,
		score,
		reasons,
		keywordOverlap,
		moduleOverlap,
		fileOverlap,
	};
}

function calculateRecencyBonus(entry: TaskMemoryIndexEntry, entries: TaskMemoryIndexEntry[]): number {
	const orderedEntries = [...entries].sort(compareIndexEntries);
	const index = orderedEntries.findIndex(candidate => candidate.storyId === entry.storyId);
	if (index < 0) {
		return 0;
	}

	return Math.max(4, 20 - index * 3);
}

function extractKeywords(values: string[]): string[] {
	const keywords = new Set<string>();
	for (const value of values) {
		if (typeof value !== 'string') {
			continue;
		}

		for (const token of value.toLowerCase().split(/[^a-z0-9_./-]+/)) {
			if (token.length >= 3) {
				keywords.add(token);
			}
		}
	}

	return Array.from(keywords);
}

function extractPathLikeValues(story: UserStory, keys: string[]): string[] {
	const values = new Set<string>();
	for (const key of keys) {
		const rawValue = story[key];
		if (!Array.isArray(rawValue)) {
			continue;
		}

		for (const item of rawValue) {
			if (typeof item === 'string' && item.trim().length > 0) {
				values.add(item.trim().toLowerCase());
			}
		}
	}

	return Array.from(values);
}

function intersect(left: string[], right: string[]): string[] {
	const rightValues = new Set(right);
	return left.filter(value => rightValues.has(value));
}

function normalizeLower(values: string[]): string[] {
	return values.map(value => value.toLowerCase());
}