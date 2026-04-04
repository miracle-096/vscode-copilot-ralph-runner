import * as fs from 'fs';
import {
	PolicyEvaluationResult,
	StoryReviewLoopState,
	StoryReviewResult,
	StoryRunLogCategory,
	StoryRunLogContextInjection,
	StoryRunLogPhase,
	StoryRunLogStatus,
	StoryRunLogTestResult,
	UserStory,
} from './types';
import {
	ensureStoryRunLogDirectory,
	getStoryRunLogPath,
} from './workspacePaths';

const OUTPUT_SUMMARY_MAX_LENGTH = 220;

export interface StoryRunLogRecorder {
	runId: string;
	filePath: string;
	transitionPhase(phase: StoryRunLogPhase, summary: string, status?: StoryRunLogStatus): void;
	recordEvent(event: { phase: StoryRunLogPhase; category: StoryRunLogCategory; kind: string; title: string; summary: string; details: string[]; data?: Record<string, unknown>; }): void;
	recordOutput(message: string, phase?: StoryRunLogPhase): void;
	recordContextInjection(entry: StoryRunLogContextInjection, phase?: StoryRunLogPhase): void;
	recordPolicyEvaluation(phase: 'preflight' | 'completion', result: PolicyEvaluationResult): void;
	recordTests(results: StoryRunLogTestResult[]): void;
	recordArtifact(kind: 'task-memory' | 'execution-checkpoint' | 'story-evidence', filePath: string, source: 'copilot' | 'synthesized'): void;
	recordReview(review: StoryReviewResult, reviewLoop: StoryReviewLoopState, source: 'copilot' | 'synthesized'): void;
	recordRefactorRound(round: number, maxRounds: number, summary: string): void;
	finalize(status: StoryRunLogStatus, summary: string, phase?: StoryRunLogPhase): void;
}

export function createStoryRunLogRecorder(workspaceRoot: string, story: UserStory): StoryRunLogRecorder {
	ensureStoryRunLogDirectory(workspaceRoot);
	const startedAt = new Date().toISOString();
	const runId = `${story.id}-${toCompactTimestamp(startedAt)}`;
	const filePath = getStoryRunLogPath(workspaceRoot, runId);
	let currentPhase: StoryRunLogPhase = 'startup';
	let status: StoryRunLogStatus = 'running';
	let skippedNoise = 0;

	persistLines(filePath, [
		`RUN ${runId}`,
		`Story: ${story.id} - ${story.title}`,
		`Started: ${startedAt}`,
		'',
	]);

	const appendLogLine = (category: Exclude<StoryRunLogCategory, 'noise'>, phase: StoryRunLogPhase, summary: string): void => {
		const normalizedSummary = trimSummary(summary);
		if (normalizedSummary.length === 0) {
			return;
		}
		appendLine(filePath, `[${new Date().toISOString()}] [${phase}] [${category}] ${normalizedSummary}`);
	};

	const recorder: StoryRunLogRecorder = {
		runId,
		filePath,
		transitionPhase: (phase, summary, nextStatus) => {
			currentPhase = phase;
			if (nextStatus) {
				status = nextStatus;
			}
		},
		recordEvent: event => {
			if (event.kind !== 'output') {
				return;
			}
			if (event.category === 'noise') {
				skippedNoise += 1;
				return;
			}
			appendLogLine(event.category, event.phase, event.summary);
		},
		recordOutput: (message, phase = currentPhase) => {
			const classification = classifyOutputMessage(message);
			if (classification.category === 'noise') {
				skippedNoise += 1;
				return;
			}
			appendLogLine(classification.category, phase, classification.summary);
		},
		recordContextInjection: (_entry, _phase = currentPhase) => {
			return;
		},
		recordPolicyEvaluation: (_phase, _result) => {
			return;
		},
		recordTests: (_results) => {
			return;
		},
		recordArtifact: (_kind, _nextFilePath, _source) => {
			return;
		},
		recordReview: (_review, _reviewLoop, _source) => {
			return;
		},
		recordRefactorRound: (_round, _maxRounds, _summary) => {
			return;
		},
		finalize: (status, summary, phase = 'finalization') => {
			const endedAt = new Date().toISOString();
			const durationMs = Date.parse(endedAt) - Date.parse(startedAt);
			currentPhase = phase;
			status = status;
			appendLine(filePath, '');
			appendLine(filePath, `Finished: ${endedAt}`);
			appendLine(filePath, `Status: ${status}`);
			appendLine(filePath, `Summary: ${trimSummary(summary)}`);
			appendLine(filePath, `DurationMs: ${durationMs}`);
			appendLine(filePath, `SkippedNoise: ${skippedNoise}`);
		},
	};

	return recorder;
}

export function readStoryRunLog(filePath: string): string | null {
	try {
		return fs.readFileSync(filePath, 'utf-8');
	} catch {
		return null;
	}
}

export function classifyOutputMessage(message: string): { category: StoryRunLogCategory; summary: string } {
	const normalized = message.replace(/\s+/g, ' ').trim();
	if (normalized.length === 0) {
		return { category: 'noise', summary: '' };
	}
	if (
		normalized.startsWith('… still waiting for Copilot')
		|| normalized.startsWith('… minimum wait in progress')
		|| /^[-═]{4,}/.test(normalized)
		|| normalized === 'Harness Runner started — autonomous task runner'
		|| normalized.startsWith('Loaded ')
		|| normalized.startsWith('Max loops:')
	) {
		return { category: 'noise', summary: normalized };
	}
	if (/WARNING|blocked|failed|ERROR|timed out|cancelled/i.test(normalized)) {
		return { category: 'diagnostic', summary: trimSummary(normalized) };
	}
	return { category: 'signal', summary: trimSummary(normalized) };
}

export function summarizeCommandOutput(output: string): string {
	const normalized = Array.from(new Set(output
		.split(/\r?\n/)
		.map((line: string) => line.replace(/\s+/g, ' ').trim())
		.filter((line: string) => line.length > 0)
		.slice(0, 5)));
	if (normalized.length === 0) {
		return 'No structured output captured.';
	}
	return trimSummary(normalized.join(' | '));
}

function trimSummary(value: string): string {
	const normalized = value.replace(/\s+/g, ' ').trim();
	if (normalized.length <= OUTPUT_SUMMARY_MAX_LENGTH) {
		return normalized;
	}
	return `${normalized.slice(0, OUTPUT_SUMMARY_MAX_LENGTH - 3)}...`;
}

function persistLines(filePath: string, lines: string[]): void {
	fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf-8');
}

function appendLine(filePath: string, line: string): void {
	fs.appendFileSync(filePath, `${line}\n`, 'utf-8');
}

function toCompactTimestamp(value: string): string {
	return value.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', 'T');
}