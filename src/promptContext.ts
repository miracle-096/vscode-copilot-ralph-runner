import { PromptSection, StoryPromptContext } from './types';

const MAX_PROJECT_CONSTRAINT_LINES = 12;
const MAX_DESIGN_CONTEXT_LINES = 12;
const MAX_PRIOR_WORK_LINES = 14;
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
	const recentCheckpointLines = boundContextLines(context.recentCheckpointLines ?? [], MAX_RECENT_CHECKPOINT_LINES);
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
			title: 'Recent Checkpoint:',
			lines: recentCheckpointLines,
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
				'After completing all changes, confirm what was done.',
				'',
				'⚠️ IMPORTANT: Do NOT modify prd.json. Never edit, overwrite, or update prd.json for any reason.',
				'Progress is tracked separately — your only responsibility is to execute the task and write the completion signal below.',
				'',
				'Before writing the completion signal, write a structured task memory artifact as valid JSON to:',
				context.taskMemoryPath,
				'The task memory artifact must include: summary, changedFiles, changedModules, keyDecisions, constraintsConfirmed, testsRun, risks, followUps, and searchKeywords.',
				'Use source: "copilot" when you write the task memory artifact yourself.',
				'',
				'Also write a structured execution checkpoint artifact as valid JSON to:',
				context.executionCheckpointPath,
				'The execution checkpoint must include: status, summary, stageGoal, keyDecisions, confirmedConstraints, unresolvedRisks, nextStoryPrerequisites, and resumeRecommendation.',
				'When you write the checkpoint yourself for a successful story, use status: "completed" and source: "copilot".',
				'Only write the completion signal after both the task memory artifact and execution checkpoint exist and are complete.',
				'',
				'━━━ TASK COMPLETION SIGNAL (REQUIRED) ━━━',
				'When you have fully completed ALL work for this task, write the exact text `completed`',
				`(nothing else, no newline) to the file: ${context.completionSignalPath}`,
				'This is how RALPH knows the task is done and can move to the next step.',
				'Do NOT skip this step — without it RALPH will time out waiting.',
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