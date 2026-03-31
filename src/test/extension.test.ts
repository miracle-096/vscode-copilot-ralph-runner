import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { composeStoryExecutionPrompt } from '../promptContext';
import {
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
	hasDesignContextArtifact,
	normalizeDesignContext,
	readDesignContext,
	summarizeDesignContextForPrompt,
	validateDesignContext,
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
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
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
			assert.ok(result.generatedConstraints.buildCommands.includes('npm run compile'));
			assert.ok(result.generatedConstraints.lintCommands.includes('npm run lint'));
			assert.ok(result.generatedConstraints.allowedPaths.includes('src/test/**'));
			assert.strictEqual(result.editableConstraints.sections.length >= 10, true);
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
			assert.ok(promptLines.includes('Technology Summary'));
			assert.ok(promptLines.some(line => line.includes('Do not edit prd.json during task execution')));
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

	test('Story prompt completion contract requires task memory before completed signal', () => {
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
			completionSignalPath: 'd:/workspace/vscode-copilot-ralph-runner/.ralph/task-US-301-status',
		});

		assert.ok(prompt.includes('Before writing the completion signal, write a structured task memory artifact as valid JSON to:'));
		assert.ok(prompt.includes('d:/workspace/vscode-copilot-ralph-runner/.ralph/memory/US-301.json'));
		assert.ok(prompt.includes('Only write the completion signal after the task memory artifact exists and is complete.'));
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
			taskMemoryPath: 'd:/workspace/vscode-copilot-ralph-runner/.ralph/memory/US-302.json',
			completionSignalPath: 'd:/workspace/vscode-copilot-ralph-runner/.ralph/task-US-302-status',
			additionalExecutionRules: ['Do not ask questions.', 'Execute directly.'],
		});

		const systemIndex = prompt.indexOf('System Execution Rules:');
		const projectIndex = prompt.indexOf('Project Constraints:');
		const designIndex = prompt.indexOf('Design Context:');
		const priorWorkIndex = prompt.indexOf('Relevant Prior Work:');
		const currentStoryIndex = prompt.indexOf('Current Story:');
		const completionIndex = prompt.indexOf('Completion Contract:');

		assert.ok(systemIndex >= 0);
		assert.ok(projectIndex > systemIndex);
		assert.ok(designIndex > projectIndex);
		assert.ok(priorWorkIndex > designIndex);
		assert.ok(currentStoryIndex > priorWorkIndex);
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
			completionSignalPath: 'd:/workspace/vscode-copilot-ralph-runner/.ralph/task-US-303-status',
		});

		assert.ok(prompt.includes('System Execution Rules:'));
		assert.ok(prompt.includes('Current Story:'));
		assert.ok(prompt.includes('Completion Contract:'));
		assert.strictEqual(prompt.includes('Project Constraints:'), false);
		assert.strictEqual(prompt.includes('Design Context:'), false);
		assert.strictEqual(prompt.includes('Relevant Prior Work:'), false);
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
				taskMemoryPath: path.join(workspaceRoot, '.ralph', 'memory', 'US-501.json'),
				completionSignalPath: path.join(workspaceRoot, '.ralph', 'task-US-501-status'),
			});

			assert.ok(prompt.includes('Project Constraints:'));
			assert.ok(prompt.includes('Design Context:'));
			assert.ok(prompt.includes('Relevant Prior Work:'));
			assert.ok(prompt.includes('Technology Summary'));
			assert.ok(prompt.includes('Build Commands'));
			assert.ok(prompt.includes('Component Reuse Requirements:'));
			assert.ok(prompt.includes('US-490 — Dashboard cards refactor'));
			assert.ok(prompt.indexOf('Project Constraints:') < prompt.indexOf('Design Context:'));
			assert.ok(prompt.indexOf('Design Context:') < prompt.indexOf('Relevant Prior Work:'));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});
});
