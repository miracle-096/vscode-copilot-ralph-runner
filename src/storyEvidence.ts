import * as fs from 'fs';
import {
	ExecutionCheckpointArtifact,
	StoryEvidenceArtifact,
	StoryEvidenceTestResult,
	StoryExecutionStatus,
	StoryRiskLevel,
	TaskMemoryArtifact,
	UserStory,
} from './types';
import {
	ensureStoryEvidenceDirectory,
	getStoryEvidencePath,
} from './workspacePaths';

export interface StoryEvidenceValidationResult {
	artifact: StoryEvidenceArtifact;
	errors: string[];
	isValid: boolean;
}

export interface SynthesizedStoryEvidenceOptions {
	changedFiles?: string[];
	changedModules?: string[];
	tests?: StoryEvidenceTestResult[];
	taskMemory?: TaskMemoryArtifact;
	checkpoint?: ExecutionCheckpointArtifact;
	source?: 'copilot' | 'synthesized';
}

export function createEmptyStoryEvidence(
	storyId: string,
	title = '',
	status: Extract<StoryExecutionStatus, 'completed' | 'pendingReview' | 'pendingRelease'> = 'completed',
): StoryEvidenceArtifact {
	return {
		storyId,
		title,
		status,
		summary: '',
		changedFiles: [],
		changedModules: [],
		tests: [],
		riskLevel: 'medium',
		riskReasons: [],
		releaseNotes: [],
		rollbackHints: [],
		followUps: [],
		recommendFeatureFlag: false,
		evidenceGaps: [],
		generatedAt: new Date().toISOString(),
	};
}

export function hasStoryEvidenceArtifact(workspaceRoot: string, storyId: string): boolean {
	return fs.existsSync(getStoryEvidencePath(workspaceRoot, storyId));
}

export function writeStoryEvidence(
	workspaceRoot: string,
	storyId: string,
	evidence: Partial<StoryEvidenceArtifact>,
): string {
	ensureStoryEvidenceDirectory(workspaceRoot);
	const filePath = getStoryEvidencePath(workspaceRoot, storyId);
	const validation = validateStoryEvidence(evidence, storyId);
	fs.writeFileSync(filePath, `${JSON.stringify(validation.artifact, null, 2)}\n`, 'utf-8');
	return filePath;
}

export function readStoryEvidence(workspaceRoot: string, storyId: string): StoryEvidenceArtifact | null {
	try {
		const content = fs.readFileSync(getStoryEvidencePath(workspaceRoot, storyId), 'utf-8');
		return normalizeStoryEvidence(JSON.parse(content) as Partial<StoryEvidenceArtifact>, storyId);
	} catch {
		return null;
	}
}

export function validateStoryEvidence(
	value: Partial<StoryEvidenceArtifact> | null | undefined,
	storyId: string,
): StoryEvidenceValidationResult {
	const artifact = normalizeStoryEvidence(value, storyId);
	const errors: string[] = [];

	if (artifact.title.trim().length === 0) {
		errors.push('title is required');
	}
	if (artifact.summary.trim().length === 0) {
		errors.push('summary is required');
	}
	if (artifact.riskReasons.length === 0) {
		errors.push('riskReasons must include at least one item');
	}
	if (artifact.releaseNotes.length === 0) {
		errors.push('releaseNotes must include at least one item');
	}
	if (artifact.rollbackHints.length === 0) {
		errors.push('rollbackHints must include at least one item');
	}
	if (artifact.tests.length === 0 && artifact.evidenceGaps.length === 0) {
		errors.push('evidenceGaps must explain why no tests were recorded');
	}
	if (artifact.tests.length === 0 && artifact.riskLevel === 'low') {
		errors.push('riskLevel cannot stay low when no tests were recorded');
	}
	if (artifact.evidenceGaps.length > 0 && artifact.status === 'completed') {
		errors.push('status cannot be completed when evidenceGaps are present');
	}
	if (artifact.riskLevel === 'high' && artifact.status === 'completed') {
		errors.push('high-risk evidence must end in pendingReview or pendingRelease');
	}

	return {
		artifact,
		errors,
		isValid: errors.length === 0,
	};
}

export function normalizeStoryEvidence(
	value: Partial<StoryEvidenceArtifact> | null | undefined,
	storyId: string,
): StoryEvidenceArtifact {
	const fallback = createEmptyStoryEvidence(storyId);
	const status = value?.status === 'pendingReview' || value?.status === 'pendingRelease' || value?.status === 'completed'
		? value.status
		: fallback.status;
	const riskLevel = value?.riskLevel === 'low' || value?.riskLevel === 'medium' || value?.riskLevel === 'high'
		? value.riskLevel
		: fallback.riskLevel;

	return {
		storyId,
		title: typeof value?.title === 'string' ? value.title.trim() : fallback.title,
		status,
		summary: typeof value?.summary === 'string' ? value.summary.trim() : fallback.summary,
		changedFiles: toStringArray(value?.changedFiles),
		changedModules: toStringArray(value?.changedModules),
		tests: normalizeTestResults(value?.tests),
		riskLevel,
		riskReasons: toStringArray(value?.riskReasons),
		releaseNotes: toStringArray(value?.releaseNotes),
		rollbackHints: toStringArray(value?.rollbackHints),
		followUps: toStringArray(value?.followUps),
		recommendFeatureFlag: value?.recommendFeatureFlag === true,
		evidenceGaps: toStringArray(value?.evidenceGaps),
		generatedAt: typeof value?.generatedAt === 'string' && value.generatedAt.trim().length > 0 ? value.generatedAt : fallback.generatedAt,
		source: value?.source === 'copilot' ? 'copilot' : value?.source === 'synthesized' ? 'synthesized' : undefined,
	};
}

export function createSynthesizedStoryEvidence(
	story: UserStory,
	options: SynthesizedStoryEvidenceOptions = {},
): StoryEvidenceArtifact {
	const changedFiles = Array.from(new Set(options.changedFiles ?? []));
	const changedModules = Array.from(new Set(options.changedModules ?? []));
	const tests = normalizeTestResults(options.tests);
	const evidenceGaps: string[] = [];
	const riskReasons: string[] = [];

	const passingTests = tests.filter(test => test.success);
	if (passingTests.length === 0) {
		evidenceGaps.push('No passing tests were recorded for this story.');
		riskReasons.push('Missing passing tests increases change risk.');
	}

	if (changedFiles.length === 0 || changedFiles[0]?.startsWith('(unable')) {
		evidenceGaps.push('Changed file scope could not be fully determined.');
		riskReasons.push('Incomplete changed-file evidence reduces rollback confidence.');
	}

	const touchesCoreExecutionSurface = changedFiles.some(filePath => [
		'src/extension.ts',
		'package.json',
		'src/policyGate.ts',
		'src/localization.ts',
	].includes(filePath));
	if (touchesCoreExecutionSurface) {
		riskReasons.push('The story changes Ralph core execution or packaging surfaces.');
	}

	if (changedFiles.length >= 8) {
		riskReasons.push('The story touches a relatively broad file surface.');
	}

	const recommendFeatureFlag = touchesCoreExecutionSurface || changedFiles.some(filePath => filePath.startsWith('src/'));
	const riskLevel = touchesCoreExecutionSurface
		? 'high'
		: deriveRiskLevel(evidenceGaps, riskReasons, changedFiles.length);
	const status = deriveEvidenceStatus(riskLevel, evidenceGaps, recommendFeatureFlag);
	const summary = options.taskMemory?.summary
		|| options.checkpoint?.summary
		|| `Evidence synthesized for ${story.id}: ${story.title}.`;

	return normalizeStoryEvidence({
		storyId: story.id,
		title: story.title,
		status,
		summary,
		changedFiles,
		changedModules,
		tests,
		riskLevel,
		riskReasons: riskReasons.length > 0 ? riskReasons : ['The story risk was inferred from the available completion evidence.'],
		releaseNotes: [
			`Completed scope: ${story.title}.`,
			...(changedModules.length > 0 ? [`Primary modules: ${changedModules.join(', ')}.`] : []),
		],
		rollbackHints: buildRollbackHints(changedFiles),
		followUps: options.taskMemory?.followUps?.length ? options.taskMemory.followUps : ['Review the synthesized evidence artifact before using it in approvals.'],
		recommendFeatureFlag,
		evidenceGaps,
		generatedAt: new Date().toISOString(),
		source: options.source ?? 'synthesized',
	}, story.id);
}

export function summarizeStoryEvidenceForStatus(evidence: StoryEvidenceArtifact | null): string[] {
	if (!evidence) {
		return [];
	}

	return [
		`status=${evidence.status}`,
		`risk=${evidence.riskLevel}`,
		`featureFlag=${evidence.recommendFeatureFlag ? 'yes' : 'no'}`,
		...(evidence.evidenceGaps.length > 0 ? [`gaps=${evidence.evidenceGaps.join('; ')}`] : []),
	];
}

function normalizeTestResults(value: unknown): StoryEvidenceTestResult[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const normalized: StoryEvidenceTestResult[] = [];
	for (const item of value) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const command = typeof (item as { command?: unknown; }).command === 'string' ? (item as { command: string; }).command.trim() : '';
		if (command.length === 0) {
			continue;
		}
		normalized.push({
			command,
			success: (item as { success?: unknown; }).success === true,
			outputSummary: typeof (item as { outputSummary?: unknown; }).outputSummary === 'string'
				? (item as { outputSummary: string; }).outputSummary.trim()
				: undefined,
		});
	}
	return normalized;
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

function deriveRiskLevel(evidenceGaps: string[], riskReasons: string[], changedFileCount: number): StoryRiskLevel {
	if (evidenceGaps.length > 0 || riskReasons.length >= 2 || changedFileCount >= 8) {
		return 'high';
	}
	if (riskReasons.length > 0 || changedFileCount >= 4) {
		return 'medium';
	}
	return 'low';
}

function deriveEvidenceStatus(
	riskLevel: StoryRiskLevel,
	evidenceGaps: string[],
	recommendFeatureFlag: boolean,
): Extract<StoryExecutionStatus, 'completed' | 'pendingReview' | 'pendingRelease'> {
	if (riskLevel === 'high' && evidenceGaps.length > 0) {
		return 'pendingReview';
	}
	if (riskLevel === 'high' || recommendFeatureFlag) {
		return 'pendingRelease';
	}
	return 'completed';
}

function buildRollbackHints(changedFiles: string[]): string[] {
	const normalizedFiles = Array.from(new Set(changedFiles.filter(filePath => filePath.length > 0)));
	if (normalizedFiles.length === 0) {
		return ['Review the latest commit diff and revert the story changes as a single unit if necessary.'];
	}

	return [
		`Review and revert these paths together if rollback is needed: ${normalizedFiles.join(', ')}.`,
		'Use the story-scoped commit as the primary rollback unit before considering any selective revert.',
	];
}