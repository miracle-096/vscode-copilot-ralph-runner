import { PromptSection, StoryPromptContext } from './types';

export function composePromptSections(sections: PromptSection[]): string {
	const renderedSections = sections
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
	const sections: PromptSection[] = [
		{
			title: `You are executing User Story ${context.story.id} of the current PRD.`,
			lines: [
				`Title: ${context.story.title}`,
				`Description: ${context.story.description}`,
				`Priority: ${context.story.priority}`,
				`Workspace root: ${context.workspaceRoot}`,
			],
		},
		{
			title: 'Acceptance Criteria:',
			lines: context.story.acceptanceCriteria.map((acceptanceCriteria, index) => `  ${index + 1}. ${acceptanceCriteria}`),
		},
		{
			title: 'Execution Rules:',
			lines: context.additionalExecutionRules ?? [],
			omitWhenEmpty: true,
		},
		{
			title: 'Project Constraints:',
			lines: context.projectConstraintsLines ?? [],
			omitWhenEmpty: true,
		},
		{
			title: 'Design Context:',
			lines: context.designContextLines ?? [],
			omitWhenEmpty: true,
		},
		{
			title: 'Relevant Prior Work:',
			lines: context.priorWorkLines ?? [],
			omitWhenEmpty: true,
		},
		{
			title: 'Execute the following task:',
			lines: [context.story.description],
		},
		{
			title: 'Completion Contract:',
			lines: [
				'After completing all changes, confirm what was done.',
				'',
				'⚠️ IMPORTANT: Do NOT modify prd.json. Never edit, overwrite, or update prd.json for any reason.',
				'Progress is tracked separately — your only responsibility is to execute the task and write the completion signal below.',
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