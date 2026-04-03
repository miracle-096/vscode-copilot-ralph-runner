import {
	ExecutionCheckpointArtifact,
	StoryEvidenceArtifact,
	StoryReviewDimensionId,
	StoryReviewDimensionScore,
	StoryReviewLoopEndedReason,
	StoryReviewLoopState,
	StoryReviewResult,
	TaskMemoryArtifact,
	UserStory,
} from './types';

export const STORY_REVIEW_DIMENSIONS: StoryReviewDimensionId[] = [
	'architectureConsistency',
	'acceptanceCoverage',
	'changeScopeControl',
	'verifiability',
];

export const DEFAULT_STORY_REVIEW_PASSING_SCORE = 85;
export const DEFAULT_STORY_AUTO_REFACTOR_LIMIT = 2;
export const DEFAULT_STORY_REVIEW_MAX_SCORE = 100;
const DIMENSION_MAX_SCORE = 25;

export interface StoryReviewValidationResult {
	artifact: StoryReviewResult;
	errors: string[];
	isValid: boolean;
}

export interface StoryReviewNormalizationOptions {
	reviewPass?: number;
	maxAutoRefactorRounds?: number;
	passingScore?: number;
	refactorPerformed?: boolean;
	refactorSummary?: string;
	reviewedAt?: string;
	source?: 'copilot' | 'synthesized';
}

export interface StoryReviewLoopOptions {
	reviewerPasses?: number;
	autoRefactorRounds?: number;
	maxAutoRefactorRounds?: number;
	endedReason?: StoryReviewLoopEndedReason;
	lastReviewedAt?: string;
}

export interface SynthesizedStoryReviewOptions extends StoryReviewNormalizationOptions {
	changedFiles?: string[];
	taskMemory?: TaskMemoryArtifact;
	checkpoint?: ExecutionCheckpointArtifact;
	evidence?: StoryEvidenceArtifact;
	fallbackReason?: string;
}

export function deriveMaxReviewerPasses(maxAutoRefactorRounds = DEFAULT_STORY_AUTO_REFACTOR_LIMIT): number {
	return Math.max(1, maxAutoRefactorRounds) + 1;
}

export function createEmptyStoryReviewResult(options: StoryReviewNormalizationOptions = {}): StoryReviewResult {
	const maxAutoRefactorRounds = normalizePositiveInteger(options.maxAutoRefactorRounds, DEFAULT_STORY_AUTO_REFACTOR_LIMIT);
	const reviewPass = normalizePositiveInteger(options.reviewPass, 1);
	const reviewedAt = normalizeOptionalString(options.reviewedAt) ?? new Date().toISOString();
	const refactorPerformed = options.refactorPerformed === true;
	const refactorSummary = normalizeOptionalString(options.refactorSummary);

	return {
		totalScore: 0,
		maxScore: DEFAULT_STORY_REVIEW_MAX_SCORE,
		passingScore: normalizeScore(options.passingScore, DEFAULT_STORY_REVIEW_PASSING_SCORE),
		passed: false,
		reviewPass,
		maxReviewerPasses: deriveMaxReviewerPasses(maxAutoRefactorRounds),
		maxAutoRefactorRounds,
		dimensions: STORY_REVIEW_DIMENSIONS.map(dimension => ({
			dimension,
			label: getDimensionLabel(dimension),
			score: 0,
			summary: '',
			issues: [],
			recommendations: [],
		})),
		findings: [],
		recommendations: [],
		refactorPerformed,
		refactorSummary,
		reviewedAt,
		source: options.source,
	};
}

export function normalizeStoryReviewResult(
	value: Partial<StoryReviewResult> | null | undefined,
	options: StoryReviewNormalizationOptions = {},
): StoryReviewResult {
	const fallback = createEmptyStoryReviewResult(options);
	if (!value) {
		return fallback;
	}

	const maxAutoRefactorRounds = normalizePositiveInteger(value.maxAutoRefactorRounds, fallback.maxAutoRefactorRounds);
	const reviewPass = normalizePositiveInteger(value.reviewPass, fallback.reviewPass);
	const maxReviewerPasses = normalizePositiveInteger(value.maxReviewerPasses, deriveMaxReviewerPasses(maxAutoRefactorRounds));
	const passingScore = normalizeScore(value.passingScore, fallback.passingScore);
	const dimensions = normalizeDimensions(value.dimensions);
	const totalScore = clampNumber(typeof value.totalScore === 'number' ? value.totalScore : sumDimensionScores(dimensions), 0, DEFAULT_STORY_REVIEW_MAX_SCORE);
	const passed = typeof value.passed === 'boolean' ? value.passed : totalScore >= passingScore;
	const refactorPerformed = value.refactorPerformed === true || options.refactorPerformed === true;
	const refactorSummary = normalizeOptionalString(value.refactorSummary) ?? normalizeOptionalString(options.refactorSummary);
	const reviewedAt = normalizeOptionalString(value.reviewedAt) ?? normalizeOptionalString(options.reviewedAt) ?? fallback.reviewedAt;

	return {
		totalScore,
		maxScore: normalizeScore(value.maxScore, DEFAULT_STORY_REVIEW_MAX_SCORE),
		passingScore,
		passed,
		reviewPass,
		maxReviewerPasses,
		maxAutoRefactorRounds,
		dimensions,
		findings: toStringArray(value.findings),
		recommendations: toStringArray(value.recommendations),
		refactorPerformed,
		refactorSummary,
		reviewedAt,
		source: normalizeSource(value.source) ?? options.source,
	};
}

export function validateStoryReviewResult(
	value: Partial<StoryReviewResult> | null | undefined,
	options: StoryReviewNormalizationOptions = {},
): StoryReviewValidationResult {
	const artifact = normalizeStoryReviewResult(value, options);
	const errors: string[] = [];

	if (artifact.dimensions.length !== STORY_REVIEW_DIMENSIONS.length) {
		errors.push('Story review must include all four scoring dimensions.');
	}
	if (artifact.totalScore < 0 || artifact.totalScore > artifact.maxScore) {
		errors.push('Story review totalScore must stay within the review score range.');
	}
	if (artifact.reviewPass > artifact.maxReviewerPasses) {
		errors.push('Story review pass cannot exceed maxReviewerPasses.');
	}
	if (artifact.maxReviewerPasses !== deriveMaxReviewerPasses(artifact.maxAutoRefactorRounds)) {
		errors.push('Story review maxReviewerPasses must align with maxAutoRefactorRounds.');
	}
	if (artifact.reviewedAt.trim().length === 0) {
		errors.push('Story review must include reviewedAt.');
	}
	for (const dimension of artifact.dimensions) {
		if (dimension.summary.trim().length === 0) {
			errors.push(`Story review dimension ${dimension.dimension} must include a summary.`);
		}
		if (dimension.score < 0 || dimension.score > DIMENSION_MAX_SCORE) {
			errors.push(`Story review dimension ${dimension.dimension} must stay within 0-${DIMENSION_MAX_SCORE}.`);
		}
	}
	if (!artifact.passed && artifact.findings.length === 0) {
		errors.push('Story review must list findings when the story does not pass review.');
	}
	if (!artifact.passed && artifact.recommendations.length === 0) {
		errors.push('Story review must list recommendations when the story does not pass review.');
	}

	return {
		artifact,
		errors,
		isValid: errors.length === 0,
	};
}

export function normalizeStoryReviewLoopState(
	value: Partial<StoryReviewLoopState> | null | undefined,
	options: StoryReviewLoopOptions = {},
): StoryReviewLoopState {
	const maxAutoRefactorRounds = normalizePositiveInteger(
		value?.maxAutoRefactorRounds,
		normalizePositiveInteger(options.maxAutoRefactorRounds, DEFAULT_STORY_AUTO_REFACTOR_LIMIT),
	);
	const reviewerPasses = clampNumber(
		normalizePositiveInteger(value?.reviewerPasses, normalizePositiveInteger(options.reviewerPasses, 0)),
		0,
		deriveMaxReviewerPasses(maxAutoRefactorRounds),
	);
	const autoRefactorRounds = clampNumber(
		normalizePositiveInteger(value?.autoRefactorRounds, normalizePositiveInteger(options.autoRefactorRounds, 0)),
		0,
		maxAutoRefactorRounds,
	);
	const endedReason = normalizeEndedReason(value?.endedReason) ?? normalizeEndedReason(options.endedReason);
	const lastReviewedAt = normalizeOptionalString(value?.lastReviewedAt) ?? normalizeOptionalString(options.lastReviewedAt);

	return {
		reviewerPasses,
		autoRefactorRounds,
		maxAutoRefactorRounds,
		endedReason,
		lastReviewedAt,
	};
}

export function buildStoryReviewLoopState(review: StoryReviewResult, options: StoryReviewLoopOptions = {}): StoryReviewLoopState {
	const normalizedReview = normalizeStoryReviewResult(review, {
		reviewPass: options.reviewerPasses,
		maxAutoRefactorRounds: options.maxAutoRefactorRounds,
	});
	const autoRefactorRounds = clampNumber(
		normalizePositiveInteger(options.autoRefactorRounds, normalizedReview.refactorPerformed ? 1 : 0),
		0,
		normalizedReview.maxAutoRefactorRounds,
	);
	const endedReason = normalizeEndedReason(options.endedReason)
		?? (normalizedReview.passed ? 'passed' : autoRefactorRounds >= normalizedReview.maxAutoRefactorRounds ? 'max-rounds' : undefined);

	return normalizeStoryReviewLoopState({
		reviewerPasses: normalizedReview.reviewPass,
		autoRefactorRounds,
		maxAutoRefactorRounds: normalizedReview.maxAutoRefactorRounds,
		endedReason,
		lastReviewedAt: normalizedReview.reviewedAt,
	});
}

export function createSynthesizedStoryReview(
	story: UserStory,
	options: SynthesizedStoryReviewOptions = {},
): StoryReviewResult {
	const base = createEmptyStoryReviewResult({
		reviewPass: options.reviewPass,
		maxAutoRefactorRounds: options.maxAutoRefactorRounds,
		passingScore: options.passingScore,
		refactorPerformed: options.refactorPerformed,
		refactorSummary: options.refactorSummary,
		reviewedAt: options.reviewedAt,
		source: options.source ?? 'synthesized',
	});
	const changedFiles = toStringArray(
		options.changedFiles
			?? options.evidence?.changedFiles
			?? options.taskMemory?.changedFiles
			?? []
	);
	const changedFileCount = changedFiles.filter(filePath => !filePath.startsWith('(')).length;
	const changedModules = Array.from(new Set([
		...(options.taskMemory?.changedModules ?? []),
		...(options.evidence?.changedModules ?? []),
	]));
	const architectureNotes = Array.from(new Set([
		...(options.taskMemory?.architectureNotes ?? []),
		...(options.checkpoint?.architectureNotes ?? []),
		...(options.evidence?.architectureNotes ?? []),
	]));
	const evidenceGaps = options.evidence?.evidenceGaps ?? [];
	const successfulTests = options.evidence?.tests.filter(test => test.success).length ?? 0;
	const unresolvedRisks = options.checkpoint?.unresolvedRisks ?? [];
	const reviewNotes = options.fallbackReason ? [options.fallbackReason] : [];
	const broadScope = changedFileCount > 5 || changedModules.length > 2;
	const mixedResponsibilities = changedFileCount > 0 && changedModules.length > 1;
	const rollbackSignalMissing = architectureNotes.length === 0 && unresolvedRisks.length > 0;

	const dimensions: StoryReviewDimensionScore[] = [
		buildDimensionScore(
			'architectureConsistency',
			25,
			[
				changedFiles.some(filePath => ['src/extension.ts', 'src/promptContext.ts', 'package.json'].includes(filePath)) ? 4 : 0,
				broadScope ? 4 : 0,
				rollbackSignalMissing ? 2 : 0,
				unresolvedRisks.length > 0 ? 3 : 0,
			],
			unresolvedRisks.length > 0
				? 'Architecture fit is only partial because module boundaries or rollback seams still need clarification in the persisted handoff.'
				: broadScope
					? 'Architecture fit is mixed because the story spans a broad surface and may blur module boundaries or responsibilities.'
					: 'Changes stay aligned with module boundaries, coherent responsibilities, reuse opportunities, and checkpointed rollback decisions.',
			Array.from(new Set([
				...(unresolvedRisks.length > 0 ? ['Residual execution risks were still present at review time.'] : []),
				...(broadScope ? ['The implementation spans enough files/modules that architecture boundaries need a clearer split.'] : []),
				...(rollbackSignalMissing ? ['Rollback seams were not clearly captured in the persisted architecture notes.'] : []),
			])),
			Array.from(new Set([
				...(unresolvedRisks.length > 0 ? ['Close the unresolved checkpoint risks or narrow the implementation surface.'] : []),
				...(broadScope ? ['Split the next pass by module boundary or extract shared logic so each change cluster has one primary responsibility.'] : []),
				...(rollbackSignalMissing ? ['Document the rollback path for the riskiest files before broadening the story further.'] : []),
			]))
		),
		buildDimensionScore(
			'acceptanceCoverage',
			25,
			[
				evidenceGaps.length > 0 ? Math.min(10, evidenceGaps.length * 4) : 0,
				story.acceptanceCriteria.length > 4 && !(options.taskMemory?.summary ?? '').includes(story.acceptanceCriteria[0] ?? '') ? 2 : 0,
			],
			evidenceGaps.length > 0
				? 'Acceptance coverage is partial because evidence gaps remain in the final artifacts.'
				: 'Artifacts describe the delivered scope against the acceptance criteria.',
			evidenceGaps.length > 0 ? ['Acceptance evidence is incomplete or missing in the final artifacts.'] : [],
			evidenceGaps.length > 0 ? ['Expand the task memory/evidence summary so each acceptance criterion has concrete proof.'] : []
		),
		buildDimensionScore(
			'changeScopeControl',
			25,
			[
				changedFileCount === 0 ? 15 : 0,
				changedFileCount > 8 ? 10 : changedFileCount > 5 ? 5 : 0,
				mixedResponsibilities ? 4 : 0,
			],
			changedFileCount === 0
				? 'Changed-file scope could not be established reliably.'
				: changedFileCount > 5
					? 'The story touched a broad file surface, so scope control is only partial and may need a narrower handoff.'
					: 'The changed-file surface stays relatively focused for this story.',
			changedFileCount === 0
				? ['The review could not confirm which files changed.']
				: changedFileCount > 5
					? ['The implementation spans many files for a single story handoff.']
					: mixedResponsibilities
						? ['The story appears to mix responsibilities across multiple modules.']
					: [],
			changedFileCount === 0
				? ['Record concrete changedFiles in task memory and evidence before final handoff.']
				: changedFileCount > 5
					? ['Trim incidental edits and keep the next refactor limited to reviewer-identified hotspots.']
					: mixedResponsibilities
						? ['Split follow-up work by module or extract the shared logic so each story handoff stays cohesive.']
					: []
		),
		buildDimensionScore(
			'verifiability',
			25,
			[
				successfulTests === 0 ? 12 : successfulTests === 1 ? 5 : 0,
				evidenceGaps.length > 0 ? 4 : 0,
			],
			successfulTests === 0
				? 'No passing tests were available to validate the delivered behavior.'
				: successfulTests === 1
					? 'Verification exists but is thin for the change surface.'
					: 'Passing test evidence exists for the delivered behavior.',
			successfulTests === 0 ? ['The final state has no passing automated verification.'] : [],
			successfulTests === 0
				? ['Run or record at least one relevant passing test command before final completion.']
				: successfulTests === 1
					? ['Consider adding one more focused verification signal if the change surface remains broad.']
					: []
		),
	];

	const findings = Array.from(new Set([
		...reviewNotes,
		...architectureNotes.slice(0, 3).map(note => `Architecture note: ${note}`),
		...dimensions.flatMap(dimension => dimension.issues),
	]));
	const recommendations = Array.from(new Set(dimensions.flatMap(dimension => dimension.recommendations)));
	const totalScore = sumDimensionScores(dimensions);

	return normalizeStoryReviewResult({
		...base,
		totalScore,
		passed: totalScore >= base.passingScore,
		dimensions,
		findings,
		recommendations,
		source: options.source ?? 'synthesized',
	});
}

export function summarizeStoryReviewForPrompt(review: StoryReviewResult | null): string[] {
	if (!review) {
		return [];
	}

	const lines = [
		`Review Pass: ${review.reviewPass}/${review.maxReviewerPasses}`,
		`Score: ${review.totalScore}/${review.maxScore} (threshold ${review.passingScore})`,
		`Passed: ${review.passed ? 'yes' : 'no'}`,
		`Auto Refactors Already Used: ${review.refactorPerformed ? 'yes' : 'no'}`,
	];

	for (const dimension of review.dimensions) {
		lines.push(`${dimension.label}: ${dimension.score}/${DIMENSION_MAX_SCORE} — ${dimension.summary}`);
		for (const issue of dimension.issues.slice(0, 2)) {
			lines.push(`- Issue: ${issue}`);
		}
		for (const recommendation of dimension.recommendations.slice(0, 2)) {
			lines.push(`- Recommendation: ${recommendation}`);
		}
	}

	for (const finding of review.findings.slice(0, 4)) {
		lines.push(`Finding: ${finding}`);
	}
	for (const recommendation of review.recommendations.slice(0, 4)) {
		lines.push(`Recommendation: ${recommendation}`);
	}

	return lines;
}

export function summarizeStoryReviewForStatus(review: StoryReviewResult | null, reviewLoop?: StoryReviewLoopState | null): string[] {
	if (!review) {
		return [];
	}

	const loop = reviewLoop ? normalizeStoryReviewLoopState(reviewLoop, {
		maxAutoRefactorRounds: review.maxAutoRefactorRounds,
	}) : null;
	return [
		`reviewScore=${review.totalScore}/${review.maxScore}`,
		`reviewPassed=${review.passed ? 'yes' : 'no'}`,
		`reviewPass=${review.reviewPass}/${review.maxReviewerPasses}`,
		...(loop ? [`autoRefactors=${loop.autoRefactorRounds}/${loop.maxAutoRefactorRounds}`] : []),
		...(loop?.endedReason ? [`reviewEnd=${loop.endedReason}`] : []),
	];
}

function buildDimensionScore(
	dimension: StoryReviewDimensionId,
	baseScore: number,
	deductions: number[],
	summary: string,
	issues: string[],
	recommendations: string[],
): StoryReviewDimensionScore {
	return {
		dimension,
		label: getDimensionLabel(dimension),
		score: clampNumber(baseScore - deductions.reduce((sum, value) => sum + value, 0), 0, DIMENSION_MAX_SCORE),
		summary,
		issues: Array.from(new Set(issues)),
		recommendations: Array.from(new Set(recommendations)),
	};
}

function normalizeDimensions(value: unknown): StoryReviewDimensionScore[] {
	const normalizedById = new Map<StoryReviewDimensionId, StoryReviewDimensionScore>();
	if (Array.isArray(value)) {
		for (const item of value) {
			const normalized = normalizeDimension(item);
			if (normalized) {
				normalizedById.set(normalized.dimension, normalized);
			}
		}
	}

	return STORY_REVIEW_DIMENSIONS.map(dimension => normalizedById.get(dimension) ?? {
		dimension,
		label: getDimensionLabel(dimension),
		score: 0,
		summary: '',
		issues: [],
		recommendations: [],
	});
}

function normalizeDimension(value: unknown): StoryReviewDimensionScore | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const dimension = normalizeDimensionId((value as { dimension?: unknown; }).dimension);
	if (!dimension) {
		return null;
	}

	return {
		dimension,
		label: normalizeOptionalString((value as { label?: unknown; }).label) ?? getDimensionLabel(dimension),
		score: clampNumber(typeof (value as { score?: unknown; }).score === 'number' ? (value as { score: number; }).score : 0, 0, DIMENSION_MAX_SCORE),
		summary: normalizeOptionalString((value as { summary?: unknown; }).summary) ?? '',
		issues: toStringArray((value as { issues?: unknown; }).issues),
		recommendations: toStringArray((value as { recommendations?: unknown; }).recommendations),
	};
}

function normalizeDimensionId(value: unknown): StoryReviewDimensionId | undefined {
	return value === 'architectureConsistency' || value === 'acceptanceCoverage' || value === 'changeScopeControl' || value === 'verifiability'
		? value
		: undefined;
}

function getDimensionLabel(dimension: StoryReviewDimensionId): string {
	switch (dimension) {
		case 'architectureConsistency':
			return 'Architecture Consistency';
		case 'acceptanceCoverage':
			return 'Acceptance Coverage';
		case 'changeScopeControl':
			return 'Change Scope Control';
		case 'verifiability':
			return 'Verifiability';
		default:
			return dimension;
	}
}

function sumDimensionScores(dimensions: StoryReviewDimensionScore[]): number {
	return dimensions.reduce((sum, dimension) => sum + dimension.score, 0);
}

function normalizeEndedReason(value: unknown): StoryReviewLoopEndedReason | undefined {
	return value === 'passed' || value === 'max-rounds' ? value : undefined;
}

function normalizeSource(value: unknown): 'copilot' | 'synthesized' | undefined {
	return value === 'copilot' || value === 'synthesized' ? value : undefined;
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return Array.from(new Set(value
		.filter((item): item is string => typeof item === 'string')
		.map(item => item.trim())
		.filter(item => item.length > 0)));
}

function normalizeOptionalString(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback;
	}

	return Math.max(0, Math.floor(value));
}

function normalizeScore(value: unknown, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback;
	}

	return clampNumber(Math.round(value), 0, DEFAULT_STORY_REVIEW_MAX_SCORE);
}

function clampNumber(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}