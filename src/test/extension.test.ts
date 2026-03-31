import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import {
	createEditableProjectConstraintsTemplate,
	mergeProjectConstraints,
	normalizeGeneratedProjectConstraints,
	parseEditableProjectConstraints,
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
});
