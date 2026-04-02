import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { composeStoryExecutionPrompt } from '../promptContext';
import {
	buildProjectConstraintChatAdvicePrompt,
	extractRunnableProjectConstraintRequest,
	buildProjectConstraintsInitializationPrompt,
	createEditableProjectConstraintsTemplate,
	initializeProjectConstraintsArtifacts,
	loadMergedProjectConstraints,
	mergeProjectConstraints,
	normalizeGeneratedProjectConstraints,
	parseEditableProjectConstraints,
	readEditableProjectConstraints,
	readGeneratedProjectConstraints,
	scanWorkspaceForProjectConstraints,
	serializeEditableProjectConstraints,
	summarizeProjectConstraintsForPrompt,
} from '../projectConstraints';
import {
	buildStoryDesignContextBatchMatchPrompt,
	buildStoryDesignContextSuggestionPrompt,
	buildVisualDesignContextDraftPrompt,
	createReviewStoryDesignContextDraft,
	createStoryDesignContextOverride,
	hasDesignContextArtifact,
	hasAnyDesignContextForStory,
	hasStoryLevelDesignContext,
	listAvailableSharedDesignContextTargets,
	mergeSharedDesignContextTargets,
	normalizeStoryDesignContextBatchMatchResult,
	normalizeDesignContext,
	readDesignContext,
	readDesignContextForScope,
	readModuleDesignContext,
	readProjectDesignContext,
	readScreenDesignContext,
	resolveDesignContextForStory,
	synthesizeExecutionDesignContextPromptLines,
	summarizeDesignContextForPrompt,
	validateDesignContext,
	writeModuleDesignContext,
	writeProjectDesignContext,
	writeScreenDesignContext,
	writeDesignContext,
} from '../designContext';
import {
	createSynthesizedTaskMemory,
	hasTaskMemoryArtifact,
	recallRelatedTaskMemories,
	readTaskMemory,
	readTaskMemoryIndex,
	rebuildTaskMemoryIndex,
	summarizeRecalledTaskMemoriesForPrompt,
	summarizeTaskMemoryForPrompt,
	upsertTaskMemoryIndexEntry,
	validateTaskMemory,
	writeTaskMemory,
} from '../taskMemory';
import {
	createSynthesizedExecutionCheckpoint,
	getRecentExecutionCheckpoint,
	hasExecutionCheckpointArtifact,
	listValidExecutionCheckpoints,
	readExecutionCheckpoint,
	summarizeExecutionCheckpointForPrompt,
	validateExecutionCheckpoint,
	writeExecutionCheckpoint,
} from '../executionCheckpoint';
import { parseTaskSignalStatus } from '../taskStatus';
import { shouldAbortCopilotWait } from '../extension';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('Package exposes a single user-facing UI design command', () => {
		const packageJsonPath = path.resolve(__dirname, '../../package.json');
		const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
			contributes?: {
				commands?: Array<{ command: string; title: string; }>;
				chatParticipants?: Array<{
					id: string;
					name: string;
					description?: string;
					commands?: Array<{ name: string; description?: string; }>;
				}>;
			};
		};
		const contributedCommands = packageJson.contributes?.commands ?? [];
		const designCommands = contributedCommands.filter(command =>
			[
				'ralph-runner.recordDesignContext',
				'ralph-runner.generateDesignContextDraft',
				'ralph-runner.suggestStoryDesignContext',
			].includes(command.command)
		);

		assert.deepStrictEqual(designCommands.map(command => command.command), ['ralph-runner.recordDesignContext']);
		assert.strictEqual(designCommands[0]?.title, 'RALPH: 界面设计描述');
		assert.strictEqual(contributedCommands.some(command => command.command === 'ralph-runner.recallTaskMemory'), false);

		const contributedParticipants = packageJson.contributes?.chatParticipants ?? [];
		assert.strictEqual(contributedParticipants.some(participant => participant.id === 'recent-graduates.ralph-runner'), true);
		assert.strictEqual(contributedParticipants.some(participant => participant.name === 'ralph' && participant.commands?.some(command => command.name === 'ralph-spec')), true);
		assert.strictEqual(contributedParticipants.some(participant => participant.description?.includes('auto-send the final prompt to Copilot Chat')), true);
		assert.strictEqual(contributedParticipants.some(participant => participant.commands?.some(command => command.name === 'ralph-spec' && command.description?.includes('auto-send the ready-to-use final version to Copilot Chat'))), true);
	});

	test('Pending design-match stories should come from prd story status, not runtime progress files', () => {
		const prd = {
			project: 'Sample',
			branchName: 'main',
			description: 'Sample project',
			userStories: [
				{ id: 'US-001', title: 'Pending one', description: '...', acceptanceCriteria: ['a'], priority: 1 },
				{ id: 'US-002', title: 'Completed one', description: '...', acceptanceCriteria: ['b'], priority: 2, status: 'completed' },
				{ id: 'US-003', title: 'In progress one', description: '...', acceptanceCriteria: ['c'], priority: 3, status: 'inprogress' },
			],
		};

		const pendingStories = prd.userStories.filter(story => (story.status ?? '未开始') !== 'completed');

		assert.deepStrictEqual(pendingStories.map(story => story.id), ['US-001', 'US-003']);
	});

	test('Task status parser tolerates concatenated or noisy completion signals', () => {
		assert.strictEqual(parseTaskSignalStatus('completed'), 'completed');
		assert.strictEqual(parseTaskSignalStatus('inprogress'), 'inprogress');
		assert.strictEqual(parseTaskSignalStatus('completedinprogress'), 'completed');
		assert.strictEqual(parseTaskSignalStatus('inprogresscompleted'), 'completed');
		assert.strictEqual(parseTaskSignalStatus('completed in product'), 'completed');
		assert.strictEqual(parseTaskSignalStatus('---inprogress---'), 'inprogress');
		assert.strictEqual(parseTaskSignalStatus('unknown'), 'none');
	});

	test('Standalone Copilot waits do not abort just because the runner is idle', () => {
		assert.strictEqual(shouldAbortCopilotWait(false, true, false), true);
		assert.strictEqual(shouldAbortCopilotWait(false, false, false), false);
		assert.strictEqual(shouldAbortCopilotWait(true, false, true), true);
	});

	test('Editable project constraints round-trip preserves sections', () => {
		const template = createEditableProjectConstraintsTemplate();
		template.sections[0].items = ['Use TypeScript strict mode'];
		template.sections[5].items = ['Do not edit generated files'];

		const parsed = parseEditableProjectConstraints(serializeEditableProjectConstraints(template));

		assert.strictEqual(parsed.sections[0].items[0], 'Use TypeScript strict mode');
		assert.strictEqual(parsed.sections[5].items[0], 'Do not edit generated files');
	});

	test('Generated project constraints normalize invalid fields safely', () => {
		const normalized = normalizeGeneratedProjectConstraints({
			version: 2,
			technologySummary: ['TypeScript', '', 'TypeScript'],
			metadata: 'invalid' as unknown as Record<string, unknown>,
		});

		assert.strictEqual(normalized.version, 2);
		assert.deepStrictEqual(normalized.technologySummary, ['TypeScript']);
		assert.strictEqual(normalized.metadata, undefined);
		assert.deepStrictEqual(normalized.buildCommands, []);
	});

	test('Editable project constraints override generated fields deterministically', () => {
		const merged = mergeProjectConstraints(
			{
				technologySummary: ['Generated stack'],
				styleRules: ['Generated style rule'],
				deliveryChecklist: ['Run lint'],
			},
			{
				title: 'Manual overrides',
				sections: [
					{ heading: 'Technology Summary', items: ['Manual stack'] },
					{ heading: 'Delivery Checklist', items: ['Run compile', 'Run lint'] },
				],
			}
		);

		assert.deepStrictEqual(merged.technologySummary, ['Manual stack']);
		assert.deepStrictEqual(merged.styleRules, ['Generated style rule']);
		assert.deepStrictEqual(merged.deliveryChecklist, ['Run compile', 'Run lint']);
	});

	test('Workspace scan produces generated and editable project constraints', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-constraints-'));
		try {
			fs.mkdirSync(path.join(workspaceRoot, 'src', 'test'), { recursive: true });
			fs.writeFileSync(path.join(workspaceRoot, 'package.json'), JSON.stringify({
				name: 'sample-extension',
				scripts: {
					compile: 'tsc --noEmit',
					lint: 'eslint src',
					test: 'vscode-test'
				},
				devDependencies: {
					typescript: '^5.0.0'
				}
			}, null, 2));
			fs.writeFileSync(path.join(workspaceRoot, 'tsconfig.json'), JSON.stringify({
				compilerOptions: {
					strict: true,
					rootDir: 'src',
					target: 'ES2022',
					module: 'Node16'
				}
			}, null, 2));
			fs.writeFileSync(path.join(workspaceRoot, 'eslint.config.mjs'), 'export default [];\n');
			fs.writeFileSync(path.join(workspaceRoot, 'README.md'), '# Sample\n');

			const result = scanWorkspaceForProjectConstraints(workspaceRoot);

			assert.ok(result.generatedConstraints.technologySummary.some(item => item.includes('TypeScript')));
			assert.ok(result.generatedConstraints.technologySummary.some(item => item.includes('sample-extension')));
			assert.ok(result.generatedConstraints.buildCommands.includes('npm run compile'));
			assert.ok(result.generatedConstraints.lintCommands.includes('npm run lint'));
			assert.ok(result.generatedConstraints.gitRules.includes('完成用户故事并准备 Git 提交时，提交标题和描述必须使用中文。'));
			assert.ok(result.generatedConstraints.architectureRules.includes('Keep reusable logic in dedicated modules instead of duplicating it across the codebase'));
			assert.ok(result.generatedConstraints.allowedPaths.includes('src/**'));
			assert.ok(result.generatedConstraints.allowedPaths.includes('src/test/**'));
			assert.deepStrictEqual(result.generatedConstraints.forbiddenPaths, []);
			assert.strictEqual(result.editableConstraints.sections.length >= 11, true);
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Project constraint initialization writes readable artifacts for prompt injection', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-constraints-init-'));
		try {
			fs.mkdirSync(path.join(workspaceRoot, 'src', 'features'), { recursive: true });
			fs.writeFileSync(path.join(workspaceRoot, 'package.json'), JSON.stringify({
				name: 'context-aware-sample',
				scripts: {
					compile: 'tsc --noEmit',
					lint: 'eslint src',
					test: 'vscode-test'
				},
				devDependencies: {
					typescript: '^5.0.0'
				}
			}, null, 2));
			fs.writeFileSync(path.join(workspaceRoot, 'tsconfig.json'), JSON.stringify({
				compilerOptions: {
					strict: true,
					rootDir: 'src'
				}
			}, null, 2));
			fs.writeFileSync(path.join(workspaceRoot, 'eslint.config.mjs'), 'export default [];\n');
			fs.writeFileSync(path.join(workspaceRoot, 'README.md'), '# Sample\n');

			const initialized = initializeProjectConstraintsArtifacts(workspaceRoot);
			const generated = readGeneratedProjectConstraints(workspaceRoot);
			const editable = readEditableProjectConstraints(workspaceRoot);
			const merged = loadMergedProjectConstraints(workspaceRoot);
			const promptLines = summarizeProjectConstraintsForPrompt(merged);

			assert.ok(fs.existsSync(initialized.generatedPath));
			assert.ok(fs.existsSync(initialized.editablePath));
			assert.ok(generated);
			assert.ok(editable);
			assert.ok(generated?.buildCommands.includes('npm run compile'));
			assert.ok(editable?.sections.some(section => section.heading === 'Technology Summary'));
			assert.ok(editable?.sections.some(section => section.heading === 'Git Rules' && section.items.includes('完成用户故事并准备 Git 提交时，提交标题和描述必须使用中文。')));
			assert.strictEqual(editable?.title, 'RALPH 项目约束');
			assert.ok(promptLines.includes('Technology Summary'));
			assert.ok(promptLines.includes('Git Rules'));
			assert.ok(promptLines.some(line => line.includes('完成用户故事并准备 Git 提交时')));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Project constraints initialization prompt includes scan baseline, provided rules, and output targets', () => {
		const prompt = buildProjectConstraintsInitializationPrompt({
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			language: 'Chinese',
			generatedPath: 'd:/workspace/vscode-copilot-ralph-runner/.ralph/project-constraints.generated.json',
			editablePath: 'd:/workspace/vscode-copilot-ralph-runner/.github/ralph/project-constraints.md',
			completionSignalPath: 'd:/workspace/vscode-copilot-ralph-runner/.ralph/task-project-constraints-init-status',
			scanResult: {
				generatedConstraints: {
					version: 1,
					generatedAt: new Date().toISOString(),
					technologySummary: ['TypeScript', 'VS Code Extension'],
					buildCommands: ['npm run compile'],
					testCommands: ['npm test'],
					lintCommands: ['npm run lint'],
					styleRules: ['Use strict mode'],
					gitRules: ['提交标题必须使用中文'],
					architectureRules: ['Keep reusable logic in modules'],
					allowedPaths: ['src/**'],
					forbiddenPaths: [],
					reuseHints: ['Prefer shared utilities'],
					deliveryChecklist: ['Run lint'],
				},
				editableConstraints: {
					title: 'RALPH 项目约束',
					lastUpdated: new Date().toISOString(),
					sections: [
						{ heading: 'Technology Summary', items: ['TypeScript'] },
						{ heading: 'Build Commands', items: ['npm run compile'] },
					],
				},
			},
			referenceSources: [
				{ label: 'docs/team-rules.md', note: 'This file has higher priority than older README guidance.', content: 'All user-facing copy should remain bilingual.' },
			],
			additionalInstructions: '重点强调交付前的验证步骤。\n\n补充：不要覆盖团队现有术语。',
		});

		assert.ok(prompt.includes('Write the machine-readable generated constraints JSON directly to: d:/workspace/vscode-copilot-ralph-runner/.ralph/project-constraints.generated.json'));
		assert.ok(prompt.includes('Write the editable team-maintained markdown constraints directly to: d:/workspace/vscode-copilot-ralph-runner/.github/ralph/project-constraints.md'));
		assert.ok(prompt.includes('User-provided project rules and reference material:'));
		assert.ok(prompt.includes('### docs/team-rules.md'));
		assert.ok(prompt.includes('Note: This file has higher priority than older README guidance.'));
		assert.ok(prompt.includes('All user-facing copy should remain bilingual.'));
		assert.ok(prompt.includes('Additional user instructions:'));
		assert.ok(prompt.includes('补充：不要覆盖团队现有术语。'));
		assert.ok(prompt.includes('Keep the final files aligned with the selected plugin language.'));
	});

	test('Project constraint chat advice prompt produces a final copy-ready request format', () => {
		const prompt = buildProjectConstraintChatAdvicePrompt({
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			language: 'Chinese',
			userRequest: '请帮我补充一个新命令，并尽量不要改动现有目录结构。',
			generatedPath: 'd:/workspace/vscode-copilot-ralph-runner/.ralph/project-constraints.generated.json',
			editablePath: 'd:/workspace/vscode-copilot-ralph-runner/.github/ralph/project-constraints.md',
			constraints: {
				version: 1,
				generatedAt: new Date().toISOString(),
				technologySummary: ['TypeScript', 'VS Code extension'],
				buildCommands: ['npm run compile'],
				testCommands: ['npm test'],
				lintCommands: ['npm run lint'],
				styleRules: ['Keep changes TypeScript strict-mode compatible'],
				gitRules: ['提交标题必须使用中文'],
				architectureRules: ['Keep reusable logic in dedicated modules'],
				allowedPaths: ['src/**'],
				forbiddenPaths: ['dist/**'],
				reuseHints: ['Prefer reusing existing prompt builders'],
				deliveryChecklist: ['Run npm run compile'],
			},
		});

		assert.ok(prompt.includes('请帮我补充一个新命令'));
		assert.ok(prompt.includes('You are RALPH Spec Finalizer for the current workspace.'));
		assert.ok(prompt.includes('Merged project constraints'));
		assert.ok(prompt.includes('Build Commands'));
		assert.ok(prompt.includes('npm run compile'));
		assert.ok(prompt.includes('Do not stop at giving advice only.'));
		assert.ok(prompt.includes('1. Final request for the LLM'));
		assert.ok(prompt.includes('Provide a complete, polished request inside a fenced code block.'));
	});

	test('Project constraint chat response extraction prefers the final request code block', () => {
		const response = [
			'1. Final request for the LLM',
			'```text',
			'Implement the new command in src/extension.ts and add tests.',
			'Run npm run compile before finishing.',
			'```',
			'',
			'2. Constraint-driven adjustments',
			'- Keep changes scoped to src/**.',
		].join('\n');

		assert.strictEqual(
			extractRunnableProjectConstraintRequest(response),
			'Implement the new command in src/extension.ts and add tests.\nRun npm run compile before finishing.'
		);
		assert.strictEqual(extractRunnableProjectConstraintRequest('No code block here.'), null);
	});

	test('Workspace scan can generate git rules from configured language', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-constraints-git-language-'));
		try {
			fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
			fs.writeFileSync(path.join(workspaceRoot, 'package.json'), JSON.stringify({
				name: 'configurable-constraints',
				scripts: {
					compile: 'tsc --noEmit'
				},
				devDependencies: {
					typescript: '^5.0.0'
				}
			}, null, 2));

			const result = scanWorkspaceForProjectConstraints(workspaceRoot, {
				language: 'English',
			});

			assert.deepStrictEqual(result.generatedConstraints.gitRules, [
				'When completing a user story and preparing a Git commit, write the commit title and description in English.'
			]);
			assert.strictEqual(result.editableConstraints.title, 'RALPH Project Constraints');
			assert.ok(result.editableConstraints.sections.some(section =>
				section.heading === 'Git Rules'
				&& section.items.includes('When completing a user story and preparing a Git commit, write the commit title and description in English.')));

			const fallbackResult = scanWorkspaceForProjectConstraints(workspaceRoot, {
				language: 'Japanese',
			});

			assert.deepStrictEqual(fallbackResult.generatedConstraints.gitRules, [
				'完成用户故事并准备 Git 提交时，提交标题和描述必须使用中文。'
			]);
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Design context sidecar can be written and read per story', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-design-context-'));
		try {
			const storyId = 'US-101';
			const filePath = writeDesignContext(workspaceRoot, storyId, {
				sourceType: 'figma',
				figmaUrl: 'https://figma.com/design/file/example?node-id=1-2',
				screenshotPaths: ['images/mockup.png'],
				manualNotes: ['Preserve spacing scale', 'Reuse the existing button component'],
				referenceDocs: ['docs/design-guidelines.md'],
				summary: 'Landing page hero section',
				layoutConstraints: ['Keep two-column layout on desktop'],
				componentReuseTargets: ['Button', 'HeroCard'],
				tokenRules: ['Use semantic color tokens only'],
				responsiveRules: ['Collapse to one column below tablet breakpoint'],
				doNotChange: ['Header navigation'],
				acceptanceChecks: ['Matches hero layout hierarchy from design'],
			});

			assert.ok(fs.existsSync(filePath));
			assert.strictEqual(hasDesignContextArtifact(workspaceRoot, storyId), true);

			const designContext = readDesignContext(workspaceRoot, storyId);
			assert.ok(designContext);
			assert.strictEqual(designContext?.figmaUrl, 'https://figma.com/design/file/example?node-id=1-2');
			assert.deepStrictEqual(designContext?.manualNotes, ['Preserve spacing scale', 'Reuse the existing button component']);
			assert.deepStrictEqual(designContext?.componentReuseTargets, ['Button', 'HeroCard']);
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Design context normalization and validation handle invalid inputs safely', () => {
		const normalized = normalizeDesignContext({
			sourceType: 'invalid' as unknown as 'notes',
			figmaUrl: '   ',
			manualNotes: ['Keep spacing', '', 'Keep spacing'],
			screenshotPaths: ['screen.png', 'screen.png'],
		}, 'US-102');

		assert.strictEqual(normalized.sourceType, 'notes');
		assert.strictEqual(normalized.figmaUrl, undefined);
		assert.deepStrictEqual(normalized.manualNotes, ['Keep spacing']);
		assert.deepStrictEqual(normalized.screenshotPaths, ['screen.png']);

		const validation = validateDesignContext({ sourceType: 'screenshots', screenshotPaths: [] }, 'US-103');
		assert.strictEqual(validation.isValid, false);
		assert.ok(validation.errors[0].includes('screenshot'));
	});

	test('Design context prompt summary emphasizes implementation constraints', () => {
		const lines = summarizeDesignContextForPrompt({
			storyId: 'US-104',
			sourceType: 'figma',
			figmaUrl: 'https://figma.example/file?node-id=1-2',
			screenshotPaths: ['images/hero.png'],
			manualNotes: ['Match the card elevation token', 'Reuse the existing Button component'],
			referenceDocs: ['docs/ui.md'],
			summary: 'Marketing hero redesign',
			pageOrScreenName: 'Homepage Hero',
			layoutConstraints: ['Preserve two-column desktop layout'],
			componentReuseTargets: ['Button', 'HeroCard'],
			tokenRules: ['Use semantic spacing tokens'],
			responsiveRules: ['Stack content on mobile'],
			doNotChange: ['Global header'],
			acceptanceChecks: ['Hero hierarchy matches design'],
			updatedAt: new Date().toISOString(),
		});

		assert.ok(lines.includes('Layout Constraints:'));
		assert.ok(lines.includes('- Preserve two-column desktop layout'));
		assert.ok(lines.includes('Component Reuse Requirements:'));
		assert.ok(lines.includes('Token Usage Rules:'));
		assert.ok(lines.includes('Visual Acceptance Checks:'));
		assert.ok(lines.includes('Implementation Notes:'));
		assert.strictEqual(lines.includes('Manual Notes'), false);
	});

	test('Layered design context supports project, screen, module, and story overrides', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-design-context-layered-'));
		try {
			writeProjectDesignContext(workspaceRoot, {
				scope: 'project',
				scopeId: 'project',
				sourceType: 'notes',
				summary: 'Use the shared product shell and preserve global spacing rhythm.',
				tokenRules: ['Use semantic color tokens only'],
				doNotChange: ['Global header'],
				manualNotes: ['Keep the baseline spacing scale'],
			});

			writeScreenDesignContext(workspaceRoot, 'Dashboard', {
				scope: 'screen',
				scopeId: 'Dashboard',
				sourceType: 'figma',
				figmaUrl: 'https://figma.example/file/dashboard',
				pageOrScreenName: 'Dashboard',
				layoutConstraints: ['Keep summary cards in one row on desktop'],
				acceptanceChecks: ['Dashboard hierarchy matches approved mockup'],
			});

			writeModuleDesignContext(workspaceRoot, 'analytics', {
				scope: 'module',
				scopeId: 'analytics',
				sourceType: 'notes',
				componentReuseTargets: ['SummaryCard'],
				responsiveRules: ['Stack cards below tablet breakpoint'],
			});

			writeDesignContext(workspaceRoot, 'US-105', {
				sourceType: 'notes',
				summary: 'Refresh analytics summary cards without changing global navigation.',
				manualNotes: ['Reuse the existing SummaryCard component'],
				acceptanceChecks: ['Summary cards align visually with the existing dashboard grid'],
			});

			const resolved = resolveDesignContextForStory(workspaceRoot, {
				id: 'US-105',
				title: 'Refresh analytics summary cards',
				description: 'Update the analytics dashboard cards.',
				acceptanceCriteria: ['Keep dashboard alignment'],
				priority: 1,
				screenId: 'Dashboard',
				moduleHints: ['analytics'],
			});

			assert.ok(resolved);
			assert.deepStrictEqual(resolved?.inheritsFrom, ['project:project', 'screen:Dashboard', 'module:analytics', 'story:US-105']);
			assert.strictEqual(resolved?.figmaUrl, 'https://figma.example/file/dashboard');
			assert.strictEqual(resolved?.pageOrScreenName, 'Dashboard');
			assert.deepStrictEqual(resolved?.tokenRules, ['Use semantic color tokens only']);
			assert.deepStrictEqual(resolved?.componentReuseTargets, ['SummaryCard']);
			assert.ok(resolved?.manualNotes.includes('Reuse the existing SummaryCard component'));
			assert.ok(resolved?.acceptanceChecks.includes('Dashboard hierarchy matches approved mockup'));
			assert.ok(resolved?.acceptanceChecks.includes('Summary cards align visually with the existing dashboard grid'));
			assert.strictEqual(hasAnyDesignContextForStory(workspaceRoot, {
				id: 'US-105',
				title: 'Refresh analytics summary cards',
				description: 'Update the analytics dashboard cards.',
				acceptanceCriteria: ['Keep dashboard alignment'],
				priority: 1,
				screenId: 'Dashboard',
				moduleHints: ['analytics'],
			}), true);

			const lines = summarizeDesignContextForPrompt(resolved ?? null);
			assert.ok(lines.includes('Context Layers: project:project > screen:Dashboard > module:analytics > story:US-105'));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Shared design context artifacts can be written and read independently', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-design-context-shared-'));
		try {
			writeProjectDesignContext(workspaceRoot, {
				scope: 'project',
				scopeId: 'project',
				sourceType: 'notes',
				summary: 'Shared product shell',
			});
			writeScreenDesignContext(workspaceRoot, 'Settings', {
				scope: 'screen',
				scopeId: 'Settings',
				sourceType: 'screenshots',
				screenshotPaths: ['images/settings.png'],
			});
			writeModuleDesignContext(workspaceRoot, 'billing', {
				scope: 'module',
				scopeId: 'billing',
				sourceType: 'notes',
				manualNotes: ['Reuse BillingForm'],
			});

			assert.strictEqual(readProjectDesignContext(workspaceRoot)?.scope, 'project');
			assert.strictEqual(readScreenDesignContext(workspaceRoot, 'Settings')?.scope, 'screen');
			assert.strictEqual(readModuleDesignContext(workspaceRoot, 'billing')?.scope, 'module');
			assert.deepStrictEqual(readScreenDesignContext(workspaceRoot, 'Settings')?.screenshotPaths, ['images/settings.png']);
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Visual design draft prompt includes target artifact, visual inputs, and completion signal', () => {
		const prompt = buildVisualDesignContextDraftPrompt({
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			targetScope: 'screen',
			targetScopeId: 'Dashboard',
			targetFilePath: 'd:/workspace/vscode-copilot-ralph-runner/.prd/design-context/shared/screen-dashboard.design.json',
			completionSignalPath: 'd:/workspace/vscode-copilot-ralph-runner/.ralph/task-design-context-draft-us-200-screen-dashboard-status',
			story: {
				id: 'US-200',
				title: 'Refresh dashboard cards',
				description: 'Use screenshots and Figma references to refresh dashboard cards.',
				acceptanceCriteria: ['Keep alignment with the approved dashboard shell'],
				priority: 1,
			},
			figmaUrl: 'https://figma.example/file/dashboard',
			screenshotPaths: ['images/dashboard/cards.png'],
			referenceDocs: ['docs/ui/dashboard.md'],
			additionalInstructions: 'Focus on reusable dashboard shell constraints.',
			existingContextLines: ['Primary Source: notes', 'Design Intent: Keep the shared shell unchanged'],
		});

		assert.ok(prompt.includes('Target scope: screen'));
		assert.ok(prompt.includes('Write the JSON artifact directly to: d:/workspace/vscode-copilot-ralph-runner/.prd/design-context/shared/screen-dashboard.design.json'));
		assert.ok(prompt.includes('Figma URL: https://figma.example/file/dashboard'));
		assert.ok(prompt.includes('Screenshot files: images/dashboard/cards.png'));
		assert.ok(prompt.includes('Reference docs: docs/ui/dashboard.md'));
		assert.ok(prompt.includes('Existing applicable design context:'));
		assert.ok(prompt.includes('Additional instructions: Focus on reusable dashboard shell constraints.'));
		assert.ok(prompt.includes('write the exact text completed'));
	});

	test('Visual design draft prompt supports reusable draft creation without a story', () => {
		const prompt = buildVisualDesignContextDraftPrompt({
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			targetScope: 'module',
			targetScopeId: 'checkout-shell',
			targetFilePath: 'd:/workspace/vscode-copilot-ralph-runner/.prd/design-context/shared/module-checkout-shell.design.json',
			completionSignalPath: 'd:/workspace/vscode-copilot-ralph-runner/.ralph/task-design-context-draft-checkout-shell-module-checkout-shell-status',
			figmaUrl: 'https://figma.example/file/checkout-shell',
			screenshotPaths: ['images/checkout-shell.png'],
			referenceDocs: ['docs/ui/checkout.md'],
			additionalInstructions: 'Keep this reusable across checkout stories.',
		});

		assert.ok(prompt.includes('Current story context:'));
		assert.ok(prompt.includes('No user story is associated with this draft.'));
		assert.ok(prompt.includes('Create reusable module-level design context for module identifier "checkout-shell".'));
		assert.ok(prompt.includes('Write the JSON artifact directly to: d:/workspace/vscode-copilot-ralph-runner/.prd/design-context/shared/module-checkout-shell.design.json'));
	});

		test('Batch design matching prompt tells Copilot to omit unrelated stories', () => {
			const prompt = buildStoryDesignContextBatchMatchPrompt({
				workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
				targetFilePath: 'd:/workspace/vscode-copilot-ralph-runner/.ralph/design-context-suggestions/design-context-match.json',
				completionSignalPath: 'd:/workspace/vscode-copilot-ralph-runner/.ralph/task-design-context-match-status',
				candidateDrafts: [
					{
						reference: 'screen:Dashboard',
						summaryLines: ['Design Intent: Shared dashboard shell', '- Layout Constraints: Keep summary cards aligned'],
					},
					{
						reference: 'module:analytics',
						summaryLines: ['Design Intent: Analytics card module'],
					},
				],
				candidateStories: [
					{
						id: 'US-301',
						title: 'Refresh dashboard spacing',
						description: 'Adjust the dashboard shell spacing.',
						acceptanceCriteria: ['Preserve dashboard hierarchy'],
						priority: 1,
						status: 'inprogress',
					},
					{
						id: 'US-302',
						title: 'Fix login form validation',
						description: 'Update validation messaging on the auth form.',
						acceptanceCriteria: ['Validation copy is correct'],
						priority: 2,
					},
				],
			});

			assert.ok(prompt.includes('Only include a story in the output if at least one selected reusable design resource is clearly relevant to that story.'));
			assert.ok(prompt.includes('If a story is not meaningfully related, omit it from the matches array entirely.'));
			assert.ok(prompt.includes('Reference: screen:Dashboard'));
			assert.ok(prompt.includes('Story ID: US-302'));
		});

		test('Batch design matching result keeps only allowed story-reference pairs', () => {
			const normalized = normalizeStoryDesignContextBatchMatchResult({
				matches: [
					{
						storyId: 'US-301',
						linkedReferences: ['screen:Dashboard', 'module:analytics', 'screen:Dashboard'],
						reason: 'Dashboard story uses the shared shell and analytics cards.',
					},
					{
						storyId: 'US-302',
						linkedReferences: ['screen:Unknown'],
					},
					{
						storyId: 'US-999',
						linkedReferences: ['screen:Dashboard'],
					},
				],
			}, [
				{
					id: 'US-301',
					title: 'Refresh dashboard spacing',
					description: 'Adjust the dashboard shell spacing.',
					acceptanceCriteria: ['Preserve dashboard hierarchy'],
					priority: 1,
				},
				{
					id: 'US-302',
					title: 'Fix login form validation',
					description: 'Update validation messaging on the auth form.',
					acceptanceCriteria: ['Validation copy is correct'],
					priority: 2,
				},
			], ['screen:Dashboard', 'module:analytics']);

			assert.deepStrictEqual(normalized.matches, [{
				storyId: 'US-301',
				linkedReferences: ['screen:Dashboard', 'module:analytics'],
				reason: 'Dashboard story uses the shared shell and analytics cards.',
			}]);
		});

	test('Story design context suggestion prompt emphasizes shared context and delta-only output', () => {
		const prompt = buildStoryDesignContextSuggestionPrompt({
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			targetFilePath: 'd:/workspace/vscode-copilot-ralph-runner/.ralph/design-context-suggestions/US-201.suggestion.json',
			completionSignalPath: 'd:/workspace/vscode-copilot-ralph-runner/.ralph/task-design-context-suggest-us-201-status',
			story: {
				id: 'US-201',
				title: 'Refresh analytics card spacing',
				description: 'Adjust the analytics cards to match the shared dashboard shell.',
				acceptanceCriteria: ['Preserve the shared dashboard layout'],
				priority: 1,
			},
			sharedContextLines: [
				'Primary Source: figma',
				'Layout Constraints:',
				'- Keep summary cards in one row on desktop',
			],
			existingStoryContextLines: ['Primary Source: notes', 'Design Intent: Legacy story override'],
			additionalInstructions: 'Only suggest deltas for spacing and acceptance checks.',
		});

		assert.ok(prompt.includes('Inherited shared design context already available to this story:'));
		assert.ok(prompt.includes('Suggest only story-specific deltas.'));
		assert.ok(prompt.includes('If no extra override is needed for a field, leave it empty instead of copying inherited values.'));
		assert.ok(prompt.includes('Existing story-specific design context to refine if useful:'));
		assert.ok(prompt.includes('Additional instructions: Only suggest deltas for spacing and acceptance checks.'));
	});

	test('Story design context override keeps only deltas beyond shared context', () => {
		const override = createStoryDesignContextOverride('US-202', {
			storyId: 'US-202',
			scope: 'story',
			scopeId: 'US-202',
			sourceType: 'notes',
			summary: 'Tighten the card footer spacing for this story only.',
			manualNotes: ['Preserve the baseline spacing scale', 'Reduce footer padding on the final card row'],
			layoutConstraints: ['Keep summary cards in one row on desktop'],
			componentReuseTargets: ['SummaryCard'],
			tokenRules: ['Use semantic color tokens only', 'Use spacing token space-2 for the footer row'],
			acceptanceChecks: ['Dashboard hierarchy matches approved mockup', 'Footer padding matches the updated story-specific spacing'],
			updatedAt: new Date().toISOString(),
		}, {
			storyId: 'US-202',
			scope: 'story',
			scopeId: 'US-202',
			sourceType: 'figma',
			summary: 'Use the shared dashboard shell and preserve global spacing rhythm.',
			manualNotes: ['Preserve the baseline spacing scale'],
			layoutConstraints: ['Keep summary cards in one row on desktop'],
			componentReuseTargets: ['SummaryCard'],
			tokenRules: ['Use semantic color tokens only'],
			acceptanceChecks: ['Dashboard hierarchy matches approved mockup'],
			screenshotPaths: [],
			referenceDocs: [],
			responsiveRules: [],
			doNotChange: [],
			updatedAt: new Date().toISOString(),
		});

		assert.strictEqual(override.summary, 'Tighten the card footer spacing for this story only.');
		assert.deepStrictEqual(override.manualNotes, ['Reduce footer padding on the final card row']);
		assert.deepStrictEqual(override.layoutConstraints, []);
		assert.deepStrictEqual(override.componentReuseTargets, []);
		assert.deepStrictEqual(override.tokenRules, ['Use spacing token space-2 for the footer row']);
		assert.deepStrictEqual(override.acceptanceChecks, ['Footer padding matches the updated story-specific spacing']);
	});

	test('Execution-time design context synthesis uses shared visual context and story metadata', () => {
		const lines = synthesizeExecutionDesignContextPromptLines({
			id: 'US-203',
			title: 'Refresh dashboard spacing',
			description: 'Tighten the summary card spacing while keeping the shared dashboard shell.',
			acceptanceCriteria: ['Preserve dashboard alignment', 'Keep the approved summary-card hierarchy'],
			priority: 1,
		}, {
			storyId: 'US-203',
			scope: 'story',
			scopeId: 'US-203',
			inheritsFrom: ['project:project', 'screen:Dashboard'],
			sourceType: 'figma',
			figmaUrl: 'https://figma.example/file/dashboard',
			screenshotPaths: ['images/dashboard-1.png', 'images/dashboard-2.png', 'images/dashboard-3.png'],
			referenceDocs: ['docs/dashboard.md', 'docs/tokens.md', 'docs/extra.md'],
			summary: 'Use the shared dashboard shell and preserve the card rhythm.',
			pageOrScreenName: 'Dashboard',
			manualNotes: [],
			layoutConstraints: ['Keep summary cards in one row on desktop', 'Preserve the approved chart gutter'],
			componentReuseTargets: ['SummaryCard', 'ChartFrame'],
			tokenRules: ['Use semantic spacing tokens only', 'Keep spacing rhythm aligned to the dashboard scale'],
			responsiveRules: ['Stack cards below tablet breakpoint'],
			doNotChange: ['Global header'],
			acceptanceChecks: ['Dashboard hierarchy matches approved mockup'],
			updatedAt: new Date().toISOString(),
		});

		assert.ok(lines.includes('Synthesis Mode: execution-time fallback'));
		assert.ok(lines.some(line => line.includes('Story Focus: Refresh dashboard spacing')));
		assert.ok(lines.includes('Primary Source: figma'));
		assert.ok(lines.some(line => line.includes('Visual Inputs: Figma available')));
		assert.ok(lines.some(line => line.includes('Layout Focus: Keep summary cards in one row on desktop; Preserve the approved chart gutter')));
		assert.ok(lines.some(line => line.includes('Acceptance Focus: Dashboard hierarchy matches approved mockup; Preserve dashboard alignment')));
		assert.ok(lines.length <= 10);
	});

	test('Execution-time design context synthesis falls back to story metadata when shared context is missing', () => {
		const lines = synthesizeExecutionDesignContextPromptLines({
			id: 'US-203A',
			title: 'Tighten checkout spacing',
			description: 'Refine spacing around the checkout footer without changing the overall shell.',
			acceptanceCriteria: ['Preserve checkout shell alignment', 'Footer spacing matches the updated mock'],
			priority: 1,
		}, null);

		assert.ok(lines.includes('Synthesis Mode: execution-time fallback'));
		assert.ok(lines.includes('Primary Source: story metadata'));
		assert.ok(lines.some(line => line.includes('Acceptance Focus: Preserve checkout shell alignment; Footer spacing matches the updated mock')));
		assert.ok(lines.length <= 5);
	});

	test('Story-level design context detection excludes shared-only artifacts', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-design-context-story-level-'));
		try {
			writeProjectDesignContext(workspaceRoot, {
				scope: 'project',
				scopeId: 'project',
				sourceType: 'notes',
				summary: 'Shared shell defaults',
			});

			assert.strictEqual(hasStoryLevelDesignContext(workspaceRoot, 'US-204'), false);

			writeDesignContext(workspaceRoot, 'US-204', {
				sourceType: 'notes',
				summary: 'Story-specific footer alignment override',
			});

			assert.strictEqual(hasStoryLevelDesignContext(workspaceRoot, 'US-204'), true);
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Explicit story inheritsFrom references pull linked shared context into resolution', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-design-context-linked-shared-'));
		try {
			writeScreenDesignContext(workspaceRoot, 'Billing', {
				scope: 'screen',
				scopeId: 'Billing',
				sourceType: 'notes',
				summary: 'Billing screen defaults',
				layoutConstraints: ['Preserve the billing summary shell'],
			});

			writeDesignContext(workspaceRoot, 'US-205', {
				scope: 'story',
				scopeId: 'US-205',
				sourceType: 'notes',
				inheritsFrom: ['screen:Billing'],
				summary: 'Adjust the invoice CTA emphasis only.',
			});

			const resolved = resolveDesignContextForStory(workspaceRoot, {
				id: 'US-205',
				title: 'Refresh invoice CTA',
				description: 'Update the CTA inside billing invoice details.',
				acceptanceCriteria: ['Billing shell stays aligned'],
				priority: 1,
			});

			assert.ok(resolved);
			assert.ok(resolved?.inheritsFrom?.includes('screen:Billing'));
			assert.ok(resolved?.layoutConstraints.includes('Preserve the billing summary shell'));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Review draft prefers linked shared context and keeps story-specific checks compact', () => {
		const story = {
			id: 'US-206',
			title: 'Tune billing spacing',
			description: 'Adjust billing spacing without rewriting the shared shell.',
			acceptanceCriteria: ['Preserve billing shell alignment', 'Footer spacing matches the new mock'],
			priority: 1,
		};

		const shared = mergeSharedDesignContextTargets('US-206', [{
			scope: 'screen',
			scopeId: 'Billing',
			artifact: normalizeDesignContext({
				scope: 'screen',
				scopeId: 'Billing',
				storyId: 'screen:Billing',
				sourceType: 'notes',
				summary: 'Billing screen defaults',
				pageOrScreenName: 'Billing',
				acceptanceChecks: ['Preserve billing shell alignment'],
			}, 'US-206'),
		}]);

		const draft = createReviewStoryDesignContextDraft(story, {
			sharedContext: shared,
			linkedReferences: ['screen:Billing'],
		});

		assert.deepStrictEqual(draft.inheritsFrom, ['screen:Billing']);
		assert.strictEqual(draft.sourceType, 'notes');
		assert.strictEqual(draft.pageOrScreenName, 'Billing');
		assert.ok(draft.summary.includes('review inherited shared design context'));
		assert.deepStrictEqual(draft.acceptanceChecks, ['Footer spacing matches the new mock']);
	});

	test('Review draft without shared context seeds a lightweight story-specific summary', () => {
		const draft = createReviewStoryDesignContextDraft({
			id: 'US-206A',
			title: 'Polish empty state illustration',
			description: 'Adjust the empty state spacing and illustration alignment.',
			acceptanceCriteria: ['Illustration spacing matches the updated comp'],
			priority: 1,
		});

		assert.strictEqual(draft.scope, 'story');
		assert.strictEqual(draft.scopeId, 'US-206A');
		assert.strictEqual(draft.sourceType, 'notes');
		assert.ok(draft.summary.includes('capture only the visual constraints that are unique to this story'));
		assert.deepStrictEqual(draft.acceptanceChecks, ['Illustration spacing matches the updated comp']);
	});

	test('Prompt summary for linked shared context keeps inherited layers visible', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-design-context-summary-linked-'));
		try {
			writeProjectDesignContext(workspaceRoot, {
				scope: 'project',
				scopeId: 'project',
				sourceType: 'notes',
				summary: 'Shared shell defaults',
				tokenRules: ['Use semantic spacing tokens only'],
			});

			writeScreenDesignContext(workspaceRoot, 'Orders', {
				scope: 'screen',
				scopeId: 'Orders',
				sourceType: 'figma',
				figmaUrl: 'https://figma.example/file/orders',
				pageOrScreenName: 'Orders',
				layoutConstraints: ['Preserve the orders table shell'],
			});

			writeDesignContext(workspaceRoot, 'US-206B', {
				scope: 'story',
				scopeId: 'US-206B',
				sourceType: 'notes',
				inheritsFrom: ['project:project', 'screen:Orders'],
				summary: 'Only tighten header spacing for this story.',
				acceptanceChecks: ['Header spacing matches the revised comp'],
			});

			const resolved = resolveDesignContextForStory(workspaceRoot, {
				id: 'US-206B',
				title: 'Tighten orders header spacing',
				description: 'Adjust the orders header spacing.',
				acceptanceCriteria: ['Orders table shell stays intact'],
				priority: 1,
			});
			const lines = summarizeDesignContextForPrompt(resolved);

			assert.ok(lines.includes('Context Layers: project:project > screen:Orders > story:US-206B'));
			assert.ok(lines.includes('Figma URL: https://figma.example/file/orders'));
			assert.ok(lines.includes('Token Usage Rules:'));
			assert.ok(lines.includes('- Use semantic spacing tokens only'));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Available shared design context targets include explicit linked scopes', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-design-context-targets-'));
		try {
			writeModuleDesignContext(workspaceRoot, 'checkout', {
				scope: 'module',
				scopeId: 'checkout',
				sourceType: 'notes',
				summary: 'Checkout module defaults',
			});

			writeDesignContext(workspaceRoot, 'US-207', {
				scope: 'story',
				scopeId: 'US-207',
				sourceType: 'notes',
				inheritsFrom: ['module:checkout'],
				summary: 'Story override',
			});

			const targets = listAvailableSharedDesignContextTargets(workspaceRoot, {
				id: 'US-207',
				title: 'Polish checkout footer',
				description: 'Update footer spacing',
				acceptanceCriteria: ['Keep checkout shell stable'],
				priority: 1,
			});

			assert.deepStrictEqual(targets.map(target => `${target.scope}:${target.scopeId}`), ['module:checkout']);
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Scoped design context helper can write and read a shared screen draft', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-design-context-generic-scope-'));
		try {
			writeScreenDesignContext(workspaceRoot, 'Billing', {
				scope: 'screen',
				scopeId: 'Billing',
				sourceType: 'figma',
				figmaUrl: 'https://figma.example/file/billing',
				summary: 'Billing screen visual defaults',
				layoutConstraints: ['Preserve two-column invoice layout on desktop'],
			});

			const artifact = readDesignContextForScope(workspaceRoot, 'screen', 'Billing');
			assert.ok(artifact);
			assert.strictEqual(artifact?.scope, 'screen');
			assert.strictEqual(artifact?.scopeId, 'Billing');
			assert.strictEqual(artifact?.figmaUrl, 'https://figma.example/file/billing');
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Story prompt completion contract requires task memory and checkpoint before completed signal', () => {
		const prompt = composeStoryExecutionPrompt({
			story: {
				id: 'US-301',
				title: 'Persist task memory',
				description: 'Require a task memory artifact before completion.',
				acceptanceCriteria: ['Task memory is written first'],
				priority: 1,
			},
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			taskMemoryPath: 'd:/workspace/vscode-copilot-ralph-runner/.ralph/memory/US-301.json',
			executionCheckpointPath: 'd:/workspace/vscode-copilot-ralph-runner/.ralph/checkpoints/US-301.checkpoint.json',
			completionSignalPath: 'd:/workspace/vscode-copilot-ralph-runner/.ralph/task-US-301-status',
		});

		assert.ok(prompt.includes('Before writing the completion signal, write a structured task memory artifact as valid JSON to:'));
		assert.ok(prompt.includes('d:/workspace/vscode-copilot-ralph-runner/.ralph/memory/US-301.json'));
		assert.ok(prompt.includes('Also write a structured execution checkpoint artifact as valid JSON to:'));
		assert.ok(prompt.includes('d:/workspace/vscode-copilot-ralph-runner/.ralph/checkpoints/US-301.checkpoint.json'));
		assert.ok(prompt.includes('Only write the completion signal after both the task memory artifact and execution checkpoint exist and are complete.'));
	});

	test('Story prompt composition uses deterministic ordered sections and bounds long context', () => {
		const prompt = composeStoryExecutionPrompt({
			story: {
				id: 'US-302',
				title: 'Ordered prompt composition',
				description: 'Refactor prompt construction into clearly ordered context sections for Copilot execution.',
				acceptanceCriteria: Array.from({ length: 10 }, (_, index) => `Acceptance criterion ${index + 1}`),
				priority: 2,
			},
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			projectConstraintsLines: Array.from({ length: 15 }, (_, index) => `Project constraint ${index + 1}`),
			designContextLines: ['Design note 1', 'Design note 2'],
			priorWorkLines: Array.from({ length: 16 }, (_, index) => `Prior work ${index + 1}`),
			recentCheckpointLines: Array.from({ length: 15 }, (_, index) => `Recent checkpoint ${index + 1}`),
			taskMemoryPath: 'd:/workspace/vscode-copilot-ralph-runner/.ralph/memory/US-302.json',
			executionCheckpointPath: 'd:/workspace/vscode-copilot-ralph-runner/.ralph/checkpoints/US-302.checkpoint.json',
			completionSignalPath: 'd:/workspace/vscode-copilot-ralph-runner/.ralph/task-US-302-status',
			additionalExecutionRules: ['Do not ask questions.', 'Execute directly.'],
		});

		const systemIndex = prompt.indexOf('System Execution Rules:');
		const projectIndex = prompt.indexOf('Project Constraints:');
		const designIndex = prompt.indexOf('Design Context:');
		const priorWorkIndex = prompt.indexOf('Relevant Prior Work:');
		const checkpointIndex = prompt.indexOf('Recent Checkpoint:');
		const currentStoryIndex = prompt.indexOf('Current Story:');
		const completionIndex = prompt.indexOf('Completion Contract:');

		assert.ok(systemIndex >= 0);
		assert.ok(projectIndex > systemIndex);
		assert.ok(designIndex > projectIndex);
		assert.ok(priorWorkIndex > designIndex);
		assert.ok(checkpointIndex > priorWorkIndex);
		assert.ok(currentStoryIndex > checkpointIndex);
		assert.ok(completionIndex > currentStoryIndex);
		assert.ok(prompt.includes('... 3 more lines omitted for brevity.'));
		assert.ok(prompt.includes('... 2 more acceptance criteria omitted for brevity.'));
	});

	test('Prompt composition omits empty optional sections safely', () => {
		const prompt = composeStoryExecutionPrompt({
			story: {
				id: 'US-303',
				title: 'Minimal prompt composition',
				description: 'Keep prompt generation resilient when context is missing.',
				acceptanceCriteria: ['Prompt still renders'],
				priority: 3,
			},
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			taskMemoryPath: 'd:/workspace/vscode-copilot-ralph-runner/.ralph/memory/US-303.json',
			executionCheckpointPath: 'd:/workspace/vscode-copilot-ralph-runner/.ralph/checkpoints/US-303.checkpoint.json',
			completionSignalPath: 'd:/workspace/vscode-copilot-ralph-runner/.ralph/task-US-303-status',
		});

		assert.ok(prompt.includes('System Execution Rules:'));
		assert.ok(prompt.includes('Current Story:'));
		assert.ok(prompt.includes('Completion Contract:'));
		assert.strictEqual(prompt.includes('Project Constraints:'), false);
		assert.strictEqual(prompt.includes('Design Context:'), false);
		assert.strictEqual(prompt.includes('Relevant Prior Work:'), false);
		assert.strictEqual(prompt.includes('Recent Checkpoint:'), false);
	});

	test('Task memory artifact can be written, read, and indexed per story', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-task-memory-'));
		try {
			const storyId = 'US-201';
			const memoryPath = writeTaskMemory(workspaceRoot, storyId, {
				title: 'Implement record design context command',
				summary: 'Added design context prompt injection and validation paths.',
				changedFiles: ['src/extension.ts', 'src/designContext.ts'],
				changedModules: ['extension', 'designContext'],
				keyDecisions: ['Summarize design data before prompt injection'],
				patternsUsed: ['Structured prompt sections'],
				constraintsConfirmed: ['Do not edit prd.json'],
				testsRun: ['npm run compile'],
				risks: ['Tagged-story heuristic may need refinement'],
				followUps: ['Add memory recall scoring'],
				searchKeywords: ['design context', 'prompt injection'],
				relatedStories: ['US-013'],
				source: 'copilot',
			});

			assert.ok(fs.existsSync(memoryPath));
			assert.strictEqual(hasTaskMemoryArtifact(workspaceRoot, storyId), true);

			const memory = readTaskMemory(workspaceRoot, storyId);
			assert.ok(memory);
			assert.strictEqual(memory?.summary, 'Added design context prompt injection and validation paths.');
			assert.deepStrictEqual(memory?.changedFiles, ['src/extension.ts', 'src/designContext.ts']);

			const index = upsertTaskMemoryIndexEntry(workspaceRoot, memory ?? {}, storyId);
			assert.strictEqual(index.entries.length, 1);
			assert.strictEqual(index.entries[0].storyId, storyId);
			assert.deepStrictEqual(index.entries[0].searchKeywords, ['design context', 'prompt injection']);

			const persistedIndex = readTaskMemoryIndex(workspaceRoot);
			assert.strictEqual(persistedIndex.entries.length, 1);
			assert.ok(persistedIndex.entries[0].memoryPath.endsWith(path.join('.ralph', 'memory', 'US-201.json')));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Task memory normalization, validation, and rebuild handle invalid input safely', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-task-memory-index-'));
		try {
			const validation = validateTaskMemory({
				summary: '   ',
				changedFiles: ['src/extension.ts', 'src/extension.ts', ''],
				keyDecisions: [],
				searchKeywords: ['memory recall', 'memory recall'],
			}, 'US-202');

			assert.strictEqual(validation.isValid, false);
			assert.deepStrictEqual(validation.artifact.changedFiles, ['src/extension.ts']);
			assert.deepStrictEqual(validation.artifact.searchKeywords, ['memory recall']);
			assert.ok(validation.errors.some(error => error.includes('summary')));

			writeTaskMemory(workspaceRoot, 'US-202', {
				title: 'Task memory model',
				summary: 'Persist task memory artifacts.',
				changedFiles: ['src/taskMemory.ts'],
				changedModules: ['taskMemory'],
				keyDecisions: ['Store one artifact per story'],
				constraintsConfirmed: ['Keep artifacts under .ralph'],
				testsRun: ['npm run compile'],
				searchKeywords: ['task memory'],
			});
			writeTaskMemory(workspaceRoot, 'US-203', {
				title: 'Memory index',
				summary: 'Rebuild a compact memory index.',
				changedFiles: ['src/taskMemory.ts', 'src/types.ts'],
				changedModules: ['taskMemory', 'types'],
				keyDecisions: ['Index entries should be sorted by recency'],
				constraintsConfirmed: ['Index should tolerate invalid files'],
				testsRun: ['npm run compile'],
				searchKeywords: ['memory index', 'recall'],
			});

			const rebuiltIndex = rebuildTaskMemoryIndex(workspaceRoot);
			assert.strictEqual(rebuiltIndex.entries.length, 2);
			assert.ok(rebuiltIndex.entries.some(entry => entry.storyId === 'US-202'));

			const promptLines = summarizeTaskMemoryForPrompt(readTaskMemory(workspaceRoot, 'US-202'));
			assert.ok(promptLines.includes('Changed Files'));
			assert.ok(promptLines.includes('Key Decisions'));
			assert.ok(promptLines.includes('Tests Run'));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Synthesized task memory produces a valid fallback artifact', () => {
		const memory = createSynthesizedTaskMemory(
			'US-204',
			'Fallback memory',
			'Fallback task memory synthesized for the story.',
			{
				changedFiles: ['src/extension.ts'],
				changedModules: ['src'],
				searchKeywords: ['fallback', 'memory'],
			}
		);

		const validation = validateTaskMemory(memory, 'US-204');
		assert.strictEqual(validation.isValid, true);
		assert.strictEqual(validation.artifact.source, 'synthesized');
		assert.deepStrictEqual(validation.artifact.changedFiles, ['src/extension.ts']);
	});

	test('Execution checkpoint artifact can be written, overwritten, and recovered per story', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-execution-checkpoint-'));
		try {
			const storyId = 'US-205';
			const firstPath = writeExecutionCheckpoint(workspaceRoot, storyId, {
				title: 'Persist checkpoint state',
				status: 'completed',
				stageGoal: 'Persist the latest execution handoff',
				summary: 'Stored a completion checkpoint after execution finished.',
				keyDecisions: ['Use one latest-only checkpoint path per story'],
				confirmedConstraints: ['Do not edit prd.json'],
				unresolvedRisks: ['None at handoff time'],
				nextStoryPrerequisites: ['Review the persisted checkpoint before starting the next related story'],
				resumeRecommendation: 'Continue with the next pending story.',
				source: 'copilot',
			}, 'completed');

			assert.strictEqual(hasExecutionCheckpointArtifact(workspaceRoot, storyId), true);
			assert.ok(fs.existsSync(firstPath));

			const overwrittenPath = writeExecutionCheckpoint(workspaceRoot, storyId, {
				title: 'Persist checkpoint state',
				status: 'failed',
				stageGoal: 'Recover after a failed rerun',
				summary: 'Stored the latest failed checkpoint for recovery.',
				keyDecisions: ['Overwrite the prior checkpoint instead of creating conflicting siblings'],
				confirmedConstraints: ['Keep checkpoint path deterministic'],
				unresolvedRisks: ['The rerun failure still needs investigation'],
				nextStoryPrerequisites: ['Resolve the blocking failure before rerunning the story'],
				resumeRecommendation: 'Inspect the workspace and retry once the failure is fixed.',
				source: 'copilot',
			}, 'failed');

			assert.strictEqual(overwrittenPath, firstPath);

			const checkpoint = readExecutionCheckpoint(workspaceRoot, storyId);
			assert.ok(checkpoint);
			assert.strictEqual(checkpoint?.status, 'failed');
			assert.strictEqual(checkpoint?.summary, 'Stored the latest failed checkpoint for recovery.');

			const damagedPath = path.join(workspaceRoot, '.ralph', 'checkpoints', 'US-206.checkpoint.json');
			fs.mkdirSync(path.dirname(damagedPath), { recursive: true });
			fs.writeFileSync(damagedPath, '{not-valid-json', 'utf-8');

			assert.strictEqual(readExecutionCheckpoint(workspaceRoot, 'US-206'), null);
			const fallback = createSynthesizedExecutionCheckpoint(
				'US-206',
				'Recover damaged checkpoint',
				'interrupted',
				'Synthesized a recoverable checkpoint after corrupted JSON was detected.',
				{
					stageGoal: 'Recover the interrupted story state',
					unresolvedRisks: ['The previous checkpoint artifact was corrupted and replaced.'],
				}
			);
			const validation = validateExecutionCheckpoint(fallback, 'US-206', 'interrupted');
			assert.strictEqual(validation.isValid, true);
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Recent checkpoint selection prefers the current story and otherwise falls back to the latest valid checkpoint', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-recent-checkpoint-'));
		try {
			writeExecutionCheckpoint(workspaceRoot, 'US-600', {
				title: 'Older checkpoint',
				status: 'completed',
				stageGoal: 'Older work',
				summary: 'Older checkpoint summary.',
				keyDecisions: ['Older checkpoint decision'],
				confirmedConstraints: ['Older checkpoint constraint'],
				unresolvedRisks: ['Older checkpoint risk'],
				nextStoryPrerequisites: ['Older prerequisite'],
				resumeRecommendation: 'Older resume recommendation.',
				updatedAt: '2026-04-02T12:00:00.000Z',
			}, 'completed');

			writeExecutionCheckpoint(workspaceRoot, 'US-601', {
				title: 'Latest other checkpoint',
				status: 'failed',
				stageGoal: 'Latest other work',
				summary: 'Latest other checkpoint summary.',
				keyDecisions: ['Latest other checkpoint decision'],
				confirmedConstraints: ['Latest other checkpoint constraint'],
				unresolvedRisks: ['Latest other checkpoint risk'],
				nextStoryPrerequisites: ['Latest other prerequisite'],
				resumeRecommendation: 'Latest other resume recommendation.',
				updatedAt: '2026-04-02T12:10:00.000Z',
			}, 'failed');

			writeExecutionCheckpoint(workspaceRoot, 'US-602', {
				title: 'Current story checkpoint',
				status: 'interrupted',
				stageGoal: 'Current story recovery',
				summary: 'Current story checkpoint summary.',
				keyDecisions: ['Current story checkpoint decision'],
				confirmedConstraints: ['Current story checkpoint constraint'],
				unresolvedRisks: ['Current story checkpoint risk'],
				nextStoryPrerequisites: ['Current story prerequisite'],
				resumeRecommendation: 'Current story resume recommendation.',
				updatedAt: '2026-04-02T12:05:00.000Z',
			}, 'interrupted');

			const validCheckpoints = listValidExecutionCheckpoints(workspaceRoot);
			assert.deepStrictEqual(validCheckpoints.map(checkpoint => checkpoint.storyId), ['US-601', 'US-602', 'US-600']);

			const preferredCheckpoint = getRecentExecutionCheckpoint(workspaceRoot, { preferredStoryId: 'US-602' });
			assert.strictEqual(preferredCheckpoint?.storyId, 'US-602');

			const fallbackCheckpoint = getRecentExecutionCheckpoint(workspaceRoot, { preferredStoryId: 'US-999' });
			assert.strictEqual(fallbackCheckpoint?.storyId, 'US-601');

			const promptLines = summarizeExecutionCheckpointForPrompt(fallbackCheckpoint);
			assert.ok(promptLines.some(line => line.includes('US-601')));
			assert.ok(promptLines.some(line => line.includes('Resume Recommendation: Latest other resume recommendation.')));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Task memory recall ranks related memories and summarizes bounded prior work', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-task-memory-recall-'));
		try {
			writeTaskMemory(workspaceRoot, 'US-401', {
				title: 'Design prompt injection',
				summary: 'Injected design context into prompts.',
				changedFiles: ['src/extension.ts', 'src/designContext.ts'],
				changedModules: ['src', 'designContext'],
				keyDecisions: ['Use structured sections for design guidance'],
				constraintsConfirmed: ['Keep prompts bounded'],
				testsRun: ['npm run compile'],
				searchKeywords: ['design', 'prompt', 'injection'],
				relatedStories: ['US-402'],
				createdAt: '2026-03-31T10:00:00.000Z',
			});
			upsertTaskMemoryIndexEntry(workspaceRoot, readTaskMemory(workspaceRoot, 'US-401') ?? {}, 'US-401');

			writeTaskMemory(workspaceRoot, 'US-402', {
				title: 'Memory recall scoring',
				summary: 'Added ranking and prior work summarization.',
				changedFiles: ['src/taskMemory.ts', 'src/extension.ts'],
				changedModules: ['taskMemory', 'src'],
				keyDecisions: ['Score by overlap and recency'],
				constraintsConfirmed: ['Prefer bounded prompt context'],
				testsRun: ['npm run compile'],
				searchKeywords: ['memory', 'recall', 'prompt'],
				relatedStories: ['US-401'],
				createdAt: '2026-03-31T10:05:00.000Z',
			});
			upsertTaskMemoryIndexEntry(workspaceRoot, readTaskMemory(workspaceRoot, 'US-402') ?? {}, 'US-402');

			writeTaskMemory(workspaceRoot, 'US-499', {
				title: 'Unrelated backend task',
				summary: 'Adjusted backend config.',
				changedFiles: ['server/config.ts'],
				changedModules: ['server'],
				keyDecisions: ['Use env defaults'],
				constraintsConfirmed: ['None'],
				testsRun: ['npm test'],
				searchKeywords: ['backend', 'config'],
				createdAt: '2026-03-31T09:00:00.000Z',
			});
			upsertTaskMemoryIndexEntry(workspaceRoot, readTaskMemory(workspaceRoot, 'US-499') ?? {}, 'US-499');

			const matches = recallRelatedTaskMemories(workspaceRoot, {
				id: 'US-500',
				title: 'Recall related prompt memory',
				description: 'Rank prompt and memory recall work for injection.',
				acceptanceCriteria: ['Prior work stays bounded'],
				priority: 1,
				dependsOn: ['US-402'],
				moduleHints: ['taskMemory'],
				fileHints: ['src/extension.ts'],
			}, { limit: 2 });

			assert.strictEqual(matches.length, 2);
			assert.strictEqual(matches[0].memory.storyId, 'US-402');
			assert.ok(matches[0].score > matches[1].score);
			assert.ok(matches[0].reasons.some(reason => reason.includes('direct story relationship')));

			const promptLines = summarizeRecalledTaskMemoriesForPrompt(matches, 2);
			assert.ok(promptLines.some(line => line.includes('US-402')));
			assert.ok(promptLines.some(line => line.includes('Why it matters:')));
			assert.ok(promptLines.some(line => line.includes('Decision:')));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Context-aware prompt composes persisted constraints, design context, and recalled prior work together', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-context-prompt-'));
		try {
			fs.mkdirSync(path.join(workspaceRoot, 'src', 'ui'), { recursive: true });
			fs.writeFileSync(path.join(workspaceRoot, 'package.json'), JSON.stringify({
				name: 'context-prompt-sample',
				scripts: {
					compile: 'tsc --noEmit',
					lint: 'eslint src',
					test: 'vscode-test'
				},
				devDependencies: {
					typescript: '^5.0.0'
				}
			}, null, 2));
			fs.writeFileSync(path.join(workspaceRoot, 'tsconfig.json'), JSON.stringify({
				compilerOptions: {
					strict: true,
					rootDir: 'src'
				}
			}, null, 2));
			fs.writeFileSync(path.join(workspaceRoot, 'eslint.config.mjs'), 'export default [];\n');
			fs.writeFileSync(path.join(workspaceRoot, 'README.md'), '# Sample\n');

			initializeProjectConstraintsArtifacts(workspaceRoot);
			writeDesignContext(workspaceRoot, 'US-501', {
				sourceType: 'figma',
				figmaUrl: 'https://figma.example/file?node-id=5-1',
				summary: 'Dashboard summary cards should stay visually aligned.',
				layoutConstraints: ['Keep cards in one row on desktop'],
				componentReuseTargets: ['SummaryCard'],
				tokenRules: ['Use semantic color tokens'],
				responsiveRules: ['Stack cards below tablet breakpoint'],
				acceptanceChecks: ['Card hierarchy matches approved design'],
				manualNotes: ['Reuse the shared SummaryCard component'],
			});

			writeTaskMemory(workspaceRoot, 'US-490', {
				title: 'Dashboard cards refactor',
				summary: 'Refactored dashboard card layout and prompt constraints.',
				changedFiles: ['src/ui/dashboard.tsx', 'src/promptContext.ts'],
				changedModules: ['ui', 'promptContext'],
				keyDecisions: ['Reuse SummaryCard instead of introducing a new widget'],
				constraintsConfirmed: ['Keep prompts bounded'],
				testsRun: ['npm run compile'],
				searchKeywords: ['dashboard', 'cards', 'prompt'],
				relatedStories: ['US-501'],
				createdAt: '2026-03-31T11:00:00.000Z',
			});
			upsertTaskMemoryIndexEntry(workspaceRoot, readTaskMemory(workspaceRoot, 'US-490') ?? {}, 'US-490');

			const projectConstraintsLines = summarizeProjectConstraintsForPrompt(loadMergedProjectConstraints(workspaceRoot));
			const designContextLines = summarizeDesignContextForPrompt(readDesignContext(workspaceRoot, 'US-501'));
			const matches = recallRelatedTaskMemories(workspaceRoot, {
				id: 'US-501',
				title: 'Refresh dashboard cards',
				description: 'Refresh dashboard summary cards while preserving prompt quality constraints.',
				acceptanceCriteria: ['Dashboard cards stay aligned'],
				priority: 1,
				dependsOn: ['US-490'],
				moduleHints: ['ui'],
				fileHints: ['src/promptContext.ts'],
			}, { limit: 2 });
			const priorWorkLines = summarizeRecalledTaskMemoriesForPrompt(matches, 2);
			writeExecutionCheckpoint(workspaceRoot, 'US-500', {
				title: 'Dashboard checkpoint',
				status: 'completed',
				stageGoal: 'Carry the latest dashboard layout decisions into the next story',
				summary: 'Checkpoint for the latest dashboard work.',
				keyDecisions: ['Preserve SummaryCard reuse during follow-up work'],
				confirmedConstraints: ['Keep prompts bounded'],
				unresolvedRisks: ['Validate card stacking below tablet breakpoint'],
				nextStoryPrerequisites: ['Review the saved dashboard checkpoint before continuing'],
				resumeRecommendation: 'Start from the checkpoint instead of reusing prior chat context.',
				updatedAt: '2026-04-02T12:20:00.000Z',
			}, 'completed');
			const recentCheckpointLines = summarizeExecutionCheckpointForPrompt(getRecentExecutionCheckpoint(workspaceRoot, { preferredStoryId: 'US-501' }));
			const prompt = composeStoryExecutionPrompt({
				story: {
					id: 'US-501',
					title: 'Refresh dashboard cards',
					description: 'Refresh dashboard summary cards while preserving prompt quality constraints.',
					acceptanceCriteria: ['Dashboard cards stay aligned', 'Reuse SummaryCard'],
					priority: 1,
				},
				workspaceRoot,
				projectConstraintsLines,
				designContextLines,
				priorWorkLines,
				recentCheckpointLines,
				taskMemoryPath: path.join(workspaceRoot, '.ralph', 'memory', 'US-501.json'),
				executionCheckpointPath: path.join(workspaceRoot, '.ralph', 'checkpoints', 'US-501.checkpoint.json'),
				completionSignalPath: path.join(workspaceRoot, '.ralph', 'task-US-501-status'),
			});

			assert.ok(prompt.includes('Project Constraints:'));
			assert.ok(prompt.includes('Design Context:'));
			assert.ok(prompt.includes('Relevant Prior Work:'));
			assert.ok(prompt.includes('Recent Checkpoint:'));
			assert.ok(prompt.includes('Technology Summary'));
			assert.ok(prompt.includes('Build Commands'));
			assert.ok(prompt.includes('Component Reuse Requirements:'));
			assert.ok(prompt.includes('US-490 — Dashboard cards refactor'));
			assert.ok(prompt.includes('US-500 — Dashboard checkpoint [completed]'));
			assert.ok(prompt.indexOf('Project Constraints:') < prompt.indexOf('Design Context:'));
			assert.ok(prompt.indexOf('Design Context:') < prompt.indexOf('Relevant Prior Work:'));
			assert.ok(prompt.indexOf('Relevant Prior Work:') < prompt.indexOf('Recent Checkpoint:'));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});
});
