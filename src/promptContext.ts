import {
	PromptSection,
	StoryPromptContext,
	StoryRefactorPromptContext,
	StoryReviewerPromptContext,
} from './types';

const MAX_PROJECT_CONSTRAINT_LINES = 12;
const MAX_DESIGN_CONTEXT_LINES = 12;
const MAX_PRIOR_WORK_LINES = 14;
const MAX_SOURCE_CONTEXT_LINES = 12;
const MAX_KNOWLEDGE_LINES = 14;
const MAX_RECENT_CHECKPOINT_LINES = 12;
const MAX_ACCEPTANCE_CRITERIA = 8;
const MAX_LINE_LENGTH = 220;

export function composePromptSections(sections: PromptSection[]): string {
	const renderedSections = sections
		.map(section => ({
			...section,
			lines: normalizeSectionLines(section.lines),
		}))
		.filter(section => !(section.omitWhenEmpty && section.lines.length === 0))
		.map(section => {
			if (section.lines.length === 0) {
				return section.title;
			}
			return [section.title, ...section.lines].join('\n');
		});

	return renderedSections.join('\n\n');
}

export function composeStoryExecutionPrompt(context: StoryPromptContext): string {
	const projectConstraintsLines = boundContextLines(context.projectConstraintsLines ?? [], MAX_PROJECT_CONSTRAINT_LINES);
	const designContextLines = boundContextLines(context.designContextLines ?? [], MAX_DESIGN_CONTEXT_LINES);
	const priorWorkLines = boundContextLines(context.priorWorkLines ?? [], MAX_PRIOR_WORK_LINES);
	const sourceContextLines = boundContextLines(context.sourceContextLines ?? [], MAX_SOURCE_CONTEXT_LINES);
	const knowledgeLines = boundContextLines(context.knowledgeLines ?? [], MAX_KNOWLEDGE_LINES);
	const recentCheckpointLines = boundContextLines(context.recentCheckpointLines ?? [], MAX_RECENT_CHECKPOINT_LINES);
	const policyLines = boundContextLines(context.policyLines ?? [], MAX_SOURCE_CONTEXT_LINES);
	const acceptanceCriteriaLines = context.story.acceptanceCriteria
		.slice(0, MAX_ACCEPTANCE_CRITERIA)
		.map((acceptanceCriteria, index) => `${index + 1}. ${truncateLine(acceptanceCriteria)}`);

	if ((context.story.acceptanceCriteria?.length ?? 0) > MAX_ACCEPTANCE_CRITERIA) {
		acceptanceCriteriaLines.push(`... ${context.story.acceptanceCriteria.length - MAX_ACCEPTANCE_CRITERIA} more acceptance criteria omitted for brevity.`);
	}

	const sections: PromptSection[] = [
		{
			title: 'System Execution Rules:',
			lines: [
				`You are executing User Story ${context.story.id} of the current PRD.`,
				`Workspace root: ${context.workspaceRoot}`,
				'',
				`Title: ${context.story.title}`,
				`Priority: ${context.story.priority}`,
				...(context.additionalExecutionRules ?? []),
			],
		},
		{
			title: 'Project Constraints:',
			lines: projectConstraintsLines,
			omitWhenEmpty: true,
		},
		{
			title: 'Design Context:',
			lines: designContextLines,
			omitWhenEmpty: true,
		},
		{
			title: 'Relevant Prior Work:',
			lines: priorWorkLines,
			omitWhenEmpty: true,
		},
		{
			title: 'Relevant Source Context:',
			lines: sourceContextLines,
			omitWhenEmpty: true,
		},
		{
			title: 'Knowledge Freshness Checks:',
			lines: knowledgeLines,
			omitWhenEmpty: true,
		},
		{
			title: 'Recent Checkpoint:',
			lines: recentCheckpointLines,
			omitWhenEmpty: true,
		},
		{
			title: 'Machine Policy Gates:',
			lines: policyLines,
			omitWhenEmpty: true,
		},
		{
			title: 'Current Story:',
			lines: [
				`Story ID: ${context.story.id}`,
				`Title: ${context.story.title}`,
				`Description: ${truncateLine(context.story.description)}`,
				'Acceptance Criteria:',
				...acceptanceCriteriaLines,
				'',
				'Execute the following task:',
				truncateLine(context.story.description),
			],
		},
		{
			title: 'Completion Contract:',
			lines: [
				'After completing this executor pass, confirm what was done.',
				'',
				'HARNESS will launch a separate Reviewer Agent pass after this executor pass completes.',
				'Focus this pass on implementation, relevant validation, and leaving auditable artifacts for the reviewer handoff.',
				'Apply architecture thinking during execution: keep module boundaries explicit, keep responsibilities cohesive, prefer reuse over copy-paste, and leave a credible rollback path for risky edits.',
				'Do not reduce governance to language-specific lint or static complexity rules; use repository structure, changed-file grouping, artifact evidence, and cross-toolchain signals instead.',
				'Do not skip artifact updates just because a later reviewer pass may request another targeted refactor.',
				'',
				'⚠️ IMPORTANT: Do NOT modify prd.json. Never edit, overwrite, or update prd.json for any reason.',
				'Progress is tracked separately — your only responsibility is to execute the task and write the completion signal below.',
				'',
				'Before writing the completion signal, write a structured task memory artifact as valid JSON to:',
				context.taskMemoryPath,
				'The task memory artifact must include: summary, changedFiles, changedModules, keyDecisions, constraintsConfirmed, testsRun, risks, followUps, and searchKeywords.',
				'Also persist reusable architecture conclusions in architectureNotes plus the existing decision/risk/follow-up fields, covering module boundaries, responsibility clarity, reuse opportunities, and rollback seams when relevant.',
				'You may add reviewSummary and reviewLoop fields when they help the next reviewer handoff.',
				'Use source: "copilot" when you write the task memory artifact yourself.',
				'',
				'Also write a structured execution checkpoint artifact as valid JSON to:',
				context.executionCheckpointPath,
				'The execution checkpoint must include: status, summary, stageGoal, keyDecisions, confirmedConstraints, unresolvedRisks, nextStoryPrerequisites, and resumeRecommendation.',
				'Use architectureNotes in the checkpoint to capture the current architecture judgment and any suggested split points for the next handoff.',
				'Keep the checkpoint specific enough that a fresh Reviewer Agent session can continue from it without hidden context.',
				'When you write the checkpoint yourself for a successful story, use status: "completed" and source: "copilot".',
				'',
				'Also write a structured evidence artifact as valid JSON to:',
				context.evidencePath,
				'The evidence artifact must include: changedFiles, tests, riskLevel, riskReasons, releaseNotes, rollbackHints, followUps, recommendFeatureFlag, evidenceGaps, and a final auditable status.',
				'Use architectureNotes and rollbackHints to explain why the current change surface is cohesive enough, or where it should be split if responsibilities are mixed.',
				'If you already know likely reviewer concerns, capture them in the artifact details so the later reviewer pass can score architecture consistency, acceptance coverage, change scope control, and verifiability.',
				'Only write the completion signal after the task memory artifact, execution checkpoint, and evidence artifact all exist and are complete.',
				'',
				'━━━ TASK COMPLETION SIGNAL (REQUIRED) ━━━',
				'When you have fully completed ALL work for this task, update the completion signal entry below to the exact text `completed`.',
				`Completion Signal File: ${context.completionSignalPath}`,
				`Completion Signal Key: ${context.completionSignalKey}`,
				'Preserve valid JSON in the file and keep other entries untouched.',
				'This is how HARNESS knows the task is done and can move to the next step.',
				'Do NOT skip this step — without it HARNESS will time out waiting.',
			],
		},
	];

	return composePromptSections(sections);
}

export function composeStoryReviewerPrompt(context: StoryReviewerPromptContext): string {
	const sections: PromptSection[] = [
		{
			title: 'Reviewer Agent Rules:',
			lines: [
				`You are the Reviewer Agent for User Story ${context.story.id}.`,
				`Workspace root: ${context.workspaceRoot}`,
				'',
				`Review Pass: ${context.reviewPass}/${context.maxReviewerPasses}`,
				`Maximum Auto-Refactor Rounds: ${context.maxAutoRefactorRounds}`,
				`Passing Score Threshold: ${context.passingScore}/${100}`,
				'Review the current workspace and persisted artifacts. Do not make code changes in this pass.',
				'Score the result across exactly four dimensions: architecture consistency, acceptance coverage, change scope control, and verifiability.',
				'For architecture consistency, explicitly judge module boundaries, responsibility clarity, reuse opportunities, and rollback safety.',
				'Do not rely on language-specific static complexity metrics or lint-only signals; use repository structure, artifact evidence, and cross-language change grouping.',
				'If the story touches too many files or mixes responsibilities, require a focused split or refactor recommendation tied to concrete files or modules.',
				'Each dimension must be scored from 0 to 25, with a totalScore out of 100.',
			],
		},
		{
			title: 'Current Story:',
			lines: [
				`Story ID: ${context.story.id}`,
				`Title: ${context.story.title}`,
				`Description: ${context.story.description}`,
				'Acceptance Criteria:',
				...context.story.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`),
			],
		},
		{
			title: 'Artifact Inputs:',
			lines: [
				'Task Memory Path:',
				context.taskMemoryPath,
				'Execution Checkpoint Path:',
				context.executionCheckpointPath,
				'Evidence Path:',
				context.evidencePath,
				...boundContextLines(context.taskMemoryLines ?? [], 10),
				...boundContextLines(context.checkpointLines ?? [], 10),
				...boundContextLines(context.evidenceLines ?? [], 10),
				...boundContextLines(context.reviewLoopLines ?? [], 8),
			],
		},
		{
			title: 'Review Contract:',
			lines: [
				'Update the execution checkpoint and evidence artifacts so they both contain reviewSummary and reviewLoop fields.',
				'Persist reusable architecture conclusions in architectureNotes on the checkpoint and evidence artifacts, and mirror them into task memory when they will help future story recall.',
				'You may mirror the same reviewSummary and reviewLoop into task memory when useful for recall.',
				'reviewSummary must include: totalScore, passingScore, passed, reviewPass, maxReviewerPasses, maxAutoRefactorRounds, dimensions, findings, recommendations, refactorPerformed, reviewedAt, and source: "copilot".',
				'reviewLoop must include: reviewerPasses, autoRefactorRounds, maxAutoRefactorRounds, and endedReason when this review is terminal.',
				'If the story does not pass review, findings and recommendations must be concrete and immediately actionable by a later Executor Agent pass.',
				'When architecture consistency or change scope control is weak, recommendations must say how to split the work, extract shared logic, or tighten rollback boundaries.',
				'If the story passes review, say so explicitly and keep recommendations minimal.',
				'After updating the artifacts, set the completion signal entry below to the exact text `completed` and preserve valid JSON in the file:',
				context.completionSignalPath,
				`Completion Signal Key: ${context.completionSignalKey}`,
			],
		},
	];

	return composePromptSections(sections);
}

export function composeStoryRefactorPrompt(context: StoryRefactorPromptContext): string {
	const sections: PromptSection[] = [
		{
			title: 'Executor Refactor Rules:',
			lines: [
				`You are the Executor Agent continuing User Story ${context.story.id}.`,
				`Workspace root: ${context.workspaceRoot}`,
				'',
				`Auto-Refactor Round: ${context.refactorRound}/${context.maxAutoRefactorRounds}`,
				`This refactor follows reviewer pass ${context.reviewPass}.`,
				'Apply only the smallest set of code changes needed to resolve the reviewer findings.',
				'Do not broaden scope, restart the story, or rewrite settled areas without a reviewer-backed reason.',
			],
		},
		{
			title: 'Current Story:',
			lines: [
				`Story ID: ${context.story.id}`,
				`Title: ${context.story.title}`,
				`Description: ${context.story.description}`,
			],
		},
		{
			title: 'Reviewer Findings To Fix:',
			lines: context.reviewSummaryLines,
		},
		{
			title: 'Artifact Handoff:',
			lines: [
				'Task Memory Path:',
				context.taskMemoryPath,
				'Execution Checkpoint Path:',
				context.executionCheckpointPath,
				'Evidence Path:',
				context.evidencePath,
				...boundContextLines(context.taskMemoryLines ?? [], 8),
				...boundContextLines(context.checkpointLines ?? [], 8),
				...boundContextLines(context.evidenceLines ?? [], 8),
			],
		},
		{
			title: 'Refactor Contract:',
			lines: [
				'Update code, tests, task memory, execution checkpoint, and evidence as needed to reflect the targeted fixes from this refactor round.',
				'Preserve or improve auditability: changedFiles, tests, risks, followUps, releaseNotes, rollbackHints, and checkpoint decisions should match the latest workspace state.',
				'Capture in the artifact details that an auto-refactor round occurred, so the next Reviewer Agent pass can judge whether the fixes addressed the findings.',
				'After updating the code and artifacts for this refactor round, set the completion signal entry below to the exact text `completed` and preserve valid JSON in the file:',
				context.completionSignalPath,
				`Completion Signal Key: ${context.completionSignalKey}`,
			],
		},
	];

	return composePromptSections(sections);
}

function boundContextLines(lines: string[], maxLines: number): string[] {
	const normalizedLines = normalizeSectionLines(lines);
	if (normalizedLines.length <= maxLines) {
		return normalizedLines;
	}

	const boundedLines = normalizedLines.slice(0, maxLines);
	boundedLines.push(`... ${normalizedLines.length - maxLines} more lines omitted for brevity.`);
	return boundedLines;
}

function normalizeSectionLines(lines: string[]): string[] {
	const normalizedLines: string[] = [];
	let lastWasBlank = false;

	for (const line of lines) {
		const normalizedLine = truncateLine(line ?? '');
		const isBlank = normalizedLine.trim().length === 0;
		if (isBlank) {
			if (!lastWasBlank && normalizedLines.length > 0) {
				normalizedLines.push('');
			}
			lastWasBlank = true;
			continue;
		}

		normalizedLines.push(normalizedLine);
		lastWasBlank = false;
	}

	if (normalizedLines[normalizedLines.length - 1] === '') {
		normalizedLines.pop();
	}

	return normalizedLines;
}

function truncateLine(line: string): string {
	if (line.length <= MAX_LINE_LENGTH) {
		return line;
	}

	return `${line.slice(0, MAX_LINE_LENGTH - 3)}...`;
}