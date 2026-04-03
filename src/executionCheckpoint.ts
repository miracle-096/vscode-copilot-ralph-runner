import * as fs from 'fs';
import {
	ExecutionCheckpointArtifact,
	ExecutionCheckpointStatus,
	StoryReviewLoopState,
	StoryReviewResult,
} from './types';
import {
	normalizeStoryReviewLoopState,
	normalizeStoryReviewResult,
	summarizeStoryReviewForPrompt,
} from './storyReview';
import {
	ensureExecutionCheckpointDirectory,
	getExecutionCheckpointDirectoryPath,
	getExecutionCheckpointPath,
	EXECUTION_CHECKPOINT_FILE_SUFFIX,
} from './workspacePaths';

export interface ExecutionCheckpointValidationResult {
	artifact: ExecutionCheckpointArtifact;
	errors: string[];
	isValid: boolean;
}

export interface SynthesizedExecutionCheckpointOptions {
	stageGoal?: string;
	keyDecisions?: string[];
	confirmedConstraints?: string[];
	unresolvedRisks?: string[];
	nextStoryPrerequisites?: string[];
	resumeRecommendation?: string;
	source?: 'copilot' | 'synthesized';
}

export function createEmptyExecutionCheckpoint(
	storyId: string,
	title = '',
	status: ExecutionCheckpointStatus = 'interrupted',
): ExecutionCheckpointArtifact {
	return {
		storyId,
		title,
		status,
		stageGoal: '',
		summary: '',
		keyDecisions: [],
		confirmedConstraints: [],
		unresolvedRisks: [],
		nextStoryPrerequisites: [],
		resumeRecommendation: '',
		reviewSummary: undefined,
		reviewLoop: undefined,
		updatedAt: new Date().toISOString(),
	};
}

export function createSynthesizedExecutionCheckpoint(
	storyId: string,
	title: string,
	status: ExecutionCheckpointStatus,
	summary: string,
	options: SynthesizedExecutionCheckpointOptions = {},
): ExecutionCheckpointArtifact {
	return normalizeExecutionCheckpoint({
		storyId,
		title,
		status,
		stageGoal: options.stageGoal ?? title,
		summary,
		keyDecisions: options.keyDecisions ?? ['RALPH synthesized this execution checkpoint because a valid checkpoint artifact was not available.'],
		confirmedConstraints: options.confirmedConstraints ?? ['prd.json remained read-only during task execution.'],
		unresolvedRisks: options.unresolvedRisks ?? ['Checkpoint details may need manual review before the next handoff.'],
		nextStoryPrerequisites: options.nextStoryPrerequisites ?? ['Review the latest workspace state before continuing execution.'],
		resumeRecommendation: options.resumeRecommendation ?? 'Re-open the story context, verify the current workspace changes, and continue from the latest stable point.',
		source: options.source ?? 'synthesized',
	}, storyId, status);
}

export function ensureExecutionCheckpointScaffold(workspaceRoot: string): string {
	return ensureExecutionCheckpointDirectory(workspaceRoot);
}

export function hasExecutionCheckpointArtifact(workspaceRoot: string, storyId: string): boolean {
	return fs.existsSync(getExecutionCheckpointPath(workspaceRoot, storyId));
}

export function writeExecutionCheckpoint(
	workspaceRoot: string,
	storyId: string,
	checkpoint: Partial<ExecutionCheckpointArtifact>,
	expectedStatus?: ExecutionCheckpointStatus,
): string {
	ensureExecutionCheckpointScaffold(workspaceRoot);
	const filePath = getExecutionCheckpointPath(workspaceRoot, storyId);
	const validation = validateExecutionCheckpoint(checkpoint, storyId, expectedStatus);
	fs.writeFileSync(filePath, `${JSON.stringify(validation.artifact, null, 2)}\n`, 'utf-8');
	return filePath;
}

export function readExecutionCheckpoint(workspaceRoot: string, storyId: string): ExecutionCheckpointArtifact | null {
	try {
		const content = fs.readFileSync(getExecutionCheckpointPath(workspaceRoot, storyId), 'utf-8');
		return normalizeExecutionCheckpoint(JSON.parse(content) as Partial<ExecutionCheckpointArtifact>, storyId);
	} catch {
		return null;
	}
}

export function listValidExecutionCheckpoints(workspaceRoot: string): ExecutionCheckpointArtifact[] {
	const checkpointDirectory = getExecutionCheckpointDirectoryPath(workspaceRoot);
	if (!fs.existsSync(checkpointDirectory)) {
		return [];
	}

	const checkpoints: ExecutionCheckpointArtifact[] = [];
	for (const entryName of fs.readdirSync(checkpointDirectory)) {
		if (!entryName.endsWith(EXECUTION_CHECKPOINT_FILE_SUFFIX)) {
			continue;
		}

		const storyId = entryName.replace(/\.checkpoint\.json$/i, '');
		const checkpoint = readExecutionCheckpoint(workspaceRoot, storyId);
		if (!checkpoint) {
			continue;
		}

		const validation = validateExecutionCheckpoint(checkpoint, storyId);
		if (!validation.isValid) {
			continue;
		}

		checkpoints.push(validation.artifact);
	}

	return checkpoints.sort(compareExecutionCheckpointsByRecency);
}

export function getRecentExecutionCheckpoint(
	workspaceRoot: string,
	options?: { preferredStoryId?: string },
): ExecutionCheckpointArtifact | null {
	const preferredStoryId = options?.preferredStoryId;
	if (preferredStoryId) {
		const preferredCheckpoint = readExecutionCheckpoint(workspaceRoot, preferredStoryId);
		if (preferredCheckpoint) {
			const validation = validateExecutionCheckpoint(preferredCheckpoint, preferredStoryId);
			if (validation.isValid) {
				return validation.artifact;
			}
		}
	}

	const checkpoints = listValidExecutionCheckpoints(workspaceRoot);
	for (const checkpoint of checkpoints) {
		if (checkpoint.storyId !== preferredStoryId) {
			return checkpoint;
		}
	}

	return null;
}

export function summarizeExecutionCheckpointForPrompt(checkpoint: ExecutionCheckpointArtifact | null): string[] {
	if (!checkpoint) {
		return [];
	}

	const lines = [
		`${checkpoint.storyId} — ${checkpoint.title} [${checkpoint.status}]`,
		`Stage Goal: ${checkpoint.stageGoal}`,
		`Summary: ${checkpoint.summary}`,
		`Resume Recommendation: ${checkpoint.resumeRecommendation}`,
		...prefixLines('Review Summary', summarizeStoryReviewForPrompt(checkpoint.reviewSummary ?? null), 8),
		...prefixLines('Key Decisions', checkpoint.keyDecisions, 2),
		...prefixLines('Confirmed Constraints', checkpoint.confirmedConstraints, 2),
		...prefixLines('Unresolved Risks', checkpoint.unresolvedRisks, 2),
		...prefixLines('Next Story Prerequisites', checkpoint.nextStoryPrerequisites, 2),
	];

	return lines.slice(0, lines[lines.length - 1] === '' ? lines.length - 1 : lines.length);
}

export function validateExecutionCheckpoint(
	value: Partial<ExecutionCheckpointArtifact> | null | undefined,
	storyId: string,
	expectedStatus?: ExecutionCheckpointStatus,
): ExecutionCheckpointValidationResult {
	const artifact = normalizeExecutionCheckpoint(value, storyId, expectedStatus);
	const errors: string[] = [];

	if (artifact.stageGoal.length === 0) {
		errors.push('An execution checkpoint should include the current stage goal.');
	}
	if (artifact.summary.length === 0) {
		errors.push('An execution checkpoint should include a summary.');
	}
	if (artifact.keyDecisions.length === 0) {
		errors.push('An execution checkpoint should include at least one key decision.');
	}
	if (artifact.confirmedConstraints.length === 0) {
		errors.push('An execution checkpoint should include at least one confirmed constraint.');
	}
	if (artifact.nextStoryPrerequisites.length === 0) {
		errors.push('An execution checkpoint should include at least one next-story prerequisite.');
	}
	if (artifact.resumeRecommendation.length === 0) {
		errors.push('An execution checkpoint should include a resume recommendation.');
	}
	if (expectedStatus && artifact.status !== expectedStatus) {
		errors.push(`Execution checkpoint status must be ${expectedStatus}.`);
	}

	return {
		artifact,
		errors,
		isValid: errors.length === 0,
	};
}

export function normalizeExecutionCheckpoint(
	value: Partial<ExecutionCheckpointArtifact> | null | undefined,
	storyId: string,
	fallbackStatus: ExecutionCheckpointStatus = 'interrupted',
): ExecutionCheckpointArtifact {
	const fallback = createEmptyExecutionCheckpoint(storyId, '', fallbackStatus);
	if (!value) {
		return fallback;
	}

	return {
		storyId,
		title: normalizeOptionalString(value.title) ?? fallback.title,
		status: normalizeCheckpointStatus(value.status) ?? fallback.status,
		stageGoal: normalizeOptionalString(value.stageGoal) ?? fallback.stageGoal,
		summary: normalizeOptionalString(value.summary) ?? fallback.summary,
		keyDecisions: toStringArray(value.keyDecisions),
		confirmedConstraints: toStringArray(value.confirmedConstraints),
		unresolvedRisks: toStringArray(value.unresolvedRisks),
		nextStoryPrerequisites: toStringArray(value.nextStoryPrerequisites),
		resumeRecommendation: normalizeOptionalString(value.resumeRecommendation) ?? fallback.resumeRecommendation,
		reviewSummary: normalizeOptionalReviewSummary(value.reviewSummary),
		reviewLoop: normalizeOptionalReviewLoop(value.reviewLoop),
		updatedAt: normalizeOptionalString(value.updatedAt) ?? fallback.updatedAt,
		source: value.source === 'copilot' || value.source === 'synthesized' ? value.source : undefined,
	};
}

function normalizeCheckpointStatus(value: unknown): ExecutionCheckpointStatus | undefined {
	if (value === 'completed' || value === 'failed' || value === 'interrupted') {
		return value;
	}

	return undefined;
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const normalized = value
		.filter((item): item is string => typeof item === 'string')
		.map(item => item.trim())
		.filter(item => item.length > 0);

	return Array.from(new Set(normalized));
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

function prefixLines(label: string, values: string[], limit: number): string[] {
	if (values.length === 0) {
		return [];
	}

	return [label, ...values.slice(0, limit).map(value => `- ${value}`), ''];
}

function compareExecutionCheckpointsByRecency(left: ExecutionCheckpointArtifact, right: ExecutionCheckpointArtifact): number {
	const updatedComparison = right.updatedAt.localeCompare(left.updatedAt);
	if (updatedComparison !== 0) {
		return updatedComparison;
	}

	return left.storyId.localeCompare(right.storyId);
}