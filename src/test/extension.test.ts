import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import {
	createEditableProjectConstraintsTemplate,
	mergeProjectConstraints,
	normalizeGeneratedProjectConstraints,
	parseEditableProjectConstraints,
	scanWorkspaceForProjectConstraints,
	serializeEditableProjectConstraints,
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
	hasTaskMemoryArtifact,
	readTaskMemory,
	readTaskMemoryIndex,
	rebuildTaskMemoryIndex,
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
});
