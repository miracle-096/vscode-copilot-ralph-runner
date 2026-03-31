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
});
