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
});
