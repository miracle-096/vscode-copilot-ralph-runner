import * as fs from 'fs';
import {
	PolicyEvaluationResult,
	StoryReviewLoopState,
	StoryReviewResult,
	StoryRunLogArtifact,
	StoryRunLogCategory,
	StoryRunLogContextInjection,
	StoryRunLogEvent,
	StoryRunLogEventKind,
	StoryRunLogPhase,
	StoryRunLogStatus,
	StoryRunLogTestResult,
	UserStory,
} from './types';
import {
	ensureStoryRunLogDirectory,
	getStoryRunLogPath,
} from './workspacePaths';

const MAX_EVENT_COUNT = 120;
const MAX_KEY_SIGNAL_COUNT = 40;
const MAX_DETAIL_COUNT = 5;
const OUTPUT_SUMMARY_MAX_LENGTH = 220;

export interface StoryRunLogRecorder {
	runId: string;
	filePath: string;
	getArtifact(): StoryRunLogArtifact;
	transitionPhase(phase: StoryRunLogPhase, summary: string, status?: StoryRunLogStatus): void;
	recordEvent(event: Omit<StoryRunLogEvent, 'id' | 'timestamp'>): void;
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
	const artifact: StoryRunLogArtifact = {
		runId,
		storyId: story.id,
		title: story.title,
		status: 'running',
		startedAt,
		currentPhase: 'startup',
		phaseHistory: [{ phase: 'startup', enteredAt: startedAt, summary: `Start ${story.id}: ${story.title}`, status: 'running' }],
		events: [],
		persistedCounts: {
			signal: 0,
			diagnostic: 0,
			noise: 0,
			skippedNoise: 0,
		},
		contextInjections: [],
		policyHits: [],
		tests: [],
		keySignals: [],
		source: 'system',
	};

	persistArtifact(filePath, artifact);

	const recorder: StoryRunLogRecorder = {
		runId,
		filePath,
		getArtifact: () => artifact,
		transitionPhase: (phase, summary, status) => {
			if (artifact.currentPhase !== phase) {
				const previous = artifact.phaseHistory[artifact.phaseHistory.length - 1];
				if (previous && !previous.exitedAt) {
					previous.exitedAt = new Date().toISOString();
				}
				artifact.currentPhase = phase;
				artifact.phaseHistory.push({
					phase,
					enteredAt: new Date().toISOString(),
					summary,
					status: status ?? artifact.status,
				});
			}
			recorder.recordEvent({
				phase,
				category: 'signal',
				kind: 'stage-transition',
				title: `phase:${phase}`,
				summary,
				details: [],
			});
		},
		recordEvent: event => {
			const timestamp = new Date().toISOString();
			const nextEvent: StoryRunLogEvent = {
				...event,
				id: `${artifact.storyId}-${artifact.events.length + 1}`,
				timestamp,
				details: normalizeLines(event.details, MAX_DETAIL_COUNT),
			};
			artifact.events.push(nextEvent);
			if (artifact.events.length > MAX_EVENT_COUNT) {
				artifact.events.splice(0, artifact.events.length - MAX_EVENT_COUNT);
			}
			artifact.persistedCounts[event.category] += 1;
			if (event.category !== 'noise') {
				pushUnique(artifact.keySignals, `${nextEvent.kind}: ${nextEvent.summary}`, MAX_KEY_SIGNAL_COUNT);
			}
			persistArtifact(filePath, artifact);
		},
		recordOutput: (message, phase = artifact.currentPhase) => {
			const classification = classifyOutputMessage(message);
			if (classification.category === 'noise') {
				artifact.persistedCounts.skippedNoise += 1;
				persistArtifact(filePath, artifact);
				return;
			}

			recorder.recordEvent({
				phase,
				category: classification.category,
				kind: 'output',
				title: 'output',
				summary: classification.summary,
				details: [],
			});
		},
		recordContextInjection: (entry, phase = artifact.currentPhase) => {
			artifact.contextInjections.push({
				...entry,
				details: normalizeLines(entry.details, MAX_DETAIL_COUNT),
			});
			recorder.recordEvent({
				phase,
				category: entry.injected ? 'signal' : 'diagnostic',
				kind: 'context-injection',
				title: entry.name,
				summary: entry.summary,
				details: entry.details,
				data: {
					lineCount: entry.lineCount,
					injected: entry.injected,
				},
			});
		},
		recordPolicyEvaluation: (phase, result) => {
			artifact.policyHits.push({
				phase,
				ok: result.ok,
				blocking: !result.ok,
				summary: result.ok
					? `Policy gates passed during ${phase}.`
					: `Policy gates blocked ${phase} with ${result.violations.length} violation(s).`,
				ruleIds: result.violations.map(violation => violation.ruleId),
				violations: result.violations.map(violation => violation.summary),
				executedCommands: result.executedCommands.map(command => command.command),
			});
			recorder.recordEvent({
				phase: phase === 'preflight' ? 'preflight' : 'completion-gates',
				category: result.ok ? 'signal' : 'diagnostic',
				kind: 'policy',
				title: `policy:${phase}`,
				summary: result.ok
					? `Policy gates passed during ${phase}.`
					: `Policy gates blocked ${phase} with ${result.violations.length} violation(s).`,
				details: result.violations.flatMap(violation => [violation.summary, ...violation.details]).slice(0, MAX_DETAIL_COUNT),
			});

			if (result.executedCommands.length > 0) {
				recorder.recordTests(result.executedCommands.map(command => ({
					command: command.command,
					success: command.success,
					summary: summarizeCommandOutput(command.output),
					source: 'policy-gate',
					phase: phase === 'preflight' ? 'preflight' : 'completion-gates',
				})));
			}
		},
		recordTests: results => {
			for (const result of results) {
				artifact.tests.push({
					...result,
					summary: trimSummary(result.summary),
				});
				recorder.recordEvent({
					phase: result.phase,
					category: result.success ? 'signal' : 'diagnostic',
					kind: 'test',
					title: result.command,
					summary: `${result.success ? 'Passed' : 'Failed'}: ${result.command}`,
					details: result.summary ? [trimSummary(result.summary)] : [],
					data: { source: result.source, success: result.success },
				});
			}
		},
		recordArtifact: (kind, nextFilePath, source) => {
			recorder.recordEvent({
				phase: 'artifact-persistence',
				category: 'signal',
				kind: 'artifact',
				title: kind,
				summary: `Persisted ${kind} (${source}).`,
				details: [nextFilePath.replace(/\\/g, '/')],
				data: { source },
			});
		},
		recordReview: (review, reviewLoop, source) => {
			recorder.recordEvent({
				phase: 'review',
				category: review.passed ? 'signal' : 'diagnostic',
				kind: 'review',
				title: `review:${review.reviewPass}`,
				summary: `Reviewer scored ${review.totalScore}/${review.maxScore} on pass ${review.reviewPass}/${review.maxReviewerPasses}.`,
				details: [
					`passed=${review.passed ? 'yes' : 'no'}`,
					`autoRefactors=${reviewLoop.autoRefactorRounds}/${reviewLoop.maxAutoRefactorRounds}`,
					...review.findings.slice(0, 2),
				],
				data: {
					source,
					passed: review.passed,
					totalScore: review.totalScore,
					autoRefactorRounds: reviewLoop.autoRefactorRounds,
				},
			});
		},
		recordRefactorRound: (round, maxRounds, summary) => {
			recorder.recordEvent({
				phase: 'refactor',
				category: 'signal',
				kind: 'refactor',
				title: `refactor:${round}`,
				summary: `Automatic refactor round ${round}/${maxRounds}.`,
				details: [trimSummary(summary)],
			});
		},
		finalize: (status, summary, phase = 'finalization') => {
			artifact.status = status;
			artifact.endedAt = new Date().toISOString();
			artifact.durationMs = Date.parse(artifact.endedAt) - Date.parse(artifact.startedAt);
			const current = artifact.phaseHistory[artifact.phaseHistory.length - 1];
			if (current && !current.exitedAt) {
				current.exitedAt = artifact.endedAt;
				current.status = status;
			}
			if (artifact.currentPhase !== phase) {
				artifact.currentPhase = phase;
				artifact.phaseHistory.push({
					phase,
					enteredAt: artifact.endedAt,
					summary,
					status,
					exitedAt: artifact.endedAt,
				});
			} else {
				artifact.currentPhase = phase;
			}
			recorder.recordEvent({
				phase,
				category: status === 'completed' ? 'signal' : 'diagnostic',
				kind: 'summary',
				title: `final:${status}`,
				summary,
				details: [`durationMs=${artifact.durationMs ?? 0}`],
			});
		},
	};

	return recorder;
}

export function readStoryRunLog(filePath: string): StoryRunLogArtifact | null {
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StoryRunLogArtifact;
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
		|| normalized === 'RALPH Runner started — autonomous task runner'
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
	const normalized = normalizeLines(output.split(/\r?\n/), MAX_DETAIL_COUNT)
		.map(line => line.replace(/\s+/g, ' ').trim())
		.filter(line => line.length > 0);
	if (normalized.length === 0) {
		return 'No structured output captured.';
	}
	return trimSummary(normalized.join(' | '));
}

function persistArtifact(filePath: string, artifact: StoryRunLogArtifact): void {
	fs.writeFileSync(filePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf-8');
}

function trimSummary(value: string): string {
	const normalized = value.replace(/\s+/g, ' ').trim();
	if (normalized.length <= OUTPUT_SUMMARY_MAX_LENGTH) {
		return normalized;
	}
	return `${normalized.slice(0, OUTPUT_SUMMARY_MAX_LENGTH - 3)}...`;
}

function normalizeLines(lines: string[], limit: number): string[] {
	return Array.from(new Set(lines
		.map(line => line.trim())
		.filter(line => line.length > 0)
		.slice(0, limit)));
}

function pushUnique(target: string[], value: string, limit: number): void {
	if (!target.includes(value)) {
		target.push(value);
	}
	if (target.length > limit) {
		target.splice(0, target.length - limit);
	}
}

function toCompactTimestamp(value: string): string {
	return value.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', 'T');
}