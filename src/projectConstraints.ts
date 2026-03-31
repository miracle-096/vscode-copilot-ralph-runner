import * as fs from 'fs';
import {
	EditableProjectConstraints,
	GeneratedProjectConstraints,
} from './types';
import {
	ensureProjectConstraintDirectories,
	getEditableProjectConstraintsPath,
	getGeneratedProjectConstraintsPath,
} from './workspacePaths';

export function createEmptyGeneratedProjectConstraints(): GeneratedProjectConstraints {
	return {
		version: 1,
		generatedAt: new Date().toISOString(),
		technologySummary: [],
		buildCommands: [],
		testCommands: [],
		lintCommands: [],
		styleRules: [],
		architectureRules: [],
		allowedPaths: [],
		forbiddenPaths: [],
		reuseHints: [],
		deliveryChecklist: [],
	};
}

export function createEditableProjectConstraintsTemplate(): EditableProjectConstraints {
	return {
		title: 'RALPH Project Constraints',
		lastUpdated: new Date().toISOString(),
		sections: [
			{ heading: 'Code Style Rules', items: [] },
			{ heading: 'Architecture Rules', items: [] },
			{ heading: 'Reuse Guidance', items: [] },
			{ heading: 'Delivery Checklist', items: [] },
		],
	};
}

export function ensureProjectConstraintsScaffold(workspaceRoot: string): {
	editablePath: string;
	generatedPath: string;
} {
	ensureProjectConstraintDirectories(workspaceRoot);
	const editablePath = getEditableProjectConstraintsPath(workspaceRoot);
	const generatedPath = getGeneratedProjectConstraintsPath(workspaceRoot);

	if (!fs.existsSync(editablePath)) {
		fs.writeFileSync(editablePath, serializeEditableProjectConstraints(createEditableProjectConstraintsTemplate()), 'utf-8');
	}

	if (!fs.existsSync(generatedPath)) {
		fs.writeFileSync(generatedPath, `${JSON.stringify(createEmptyGeneratedProjectConstraints(), null, 2)}\n`, 'utf-8');
	}

	return { editablePath, generatedPath };
}

export function serializeEditableProjectConstraints(constraints: EditableProjectConstraints): string {
	const lines: string[] = [`# ${constraints.title}`, ''];
	for (const section of constraints.sections) {
		lines.push(`## ${section.heading}`);
		if (section.items.length === 0) {
			lines.push('- TODO');
		} else {
			for (const item of section.items) {
				lines.push(`- ${item}`);
			}
		}
		lines.push('');
	}
	return `${lines.join('\n').trimEnd()}\n`;
}

export function readGeneratedProjectConstraints(workspaceRoot: string): GeneratedProjectConstraints | null {
	try {
		const content = fs.readFileSync(getGeneratedProjectConstraintsPath(workspaceRoot), 'utf-8');
		return normalizeGeneratedProjectConstraints(JSON.parse(content) as Partial<GeneratedProjectConstraints>);
	} catch {
		return null;
	}
}

export function normalizeGeneratedProjectConstraints(value: Partial<GeneratedProjectConstraints> | null | undefined): GeneratedProjectConstraints {
	const fallback = createEmptyGeneratedProjectConstraints();
	if (!value) {
		return fallback;
	}
	return {
		version: typeof value.version === 'number' ? value.version : fallback.version,
		generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : fallback.generatedAt,
		technologySummary: toStringArray(value.technologySummary),
		buildCommands: toStringArray(value.buildCommands),
		testCommands: toStringArray(value.testCommands),
		lintCommands: toStringArray(value.lintCommands),
		styleRules: toStringArray(value.styleRules),
		architectureRules: toStringArray(value.architectureRules),
		allowedPaths: toStringArray(value.allowedPaths),
		forbiddenPaths: toStringArray(value.forbiddenPaths),
		reuseHints: toStringArray(value.reuseHints),
		deliveryChecklist: toStringArray(value.deliveryChecklist),
		metadata: value.metadata && typeof value.metadata === 'object' ? value.metadata : undefined,
	};
}

export function summarizeProjectConstraintsForPrompt(constraints: GeneratedProjectConstraints | null): string[] {
	if (!constraints) {
		return [];
	}
	return [
		...prefixLines('Technology Summary', constraints.technologySummary),
		...prefixLines('Build Commands', constraints.buildCommands),
		...prefixLines('Test Commands', constraints.testCommands),
		...prefixLines('Lint Commands', constraints.lintCommands),
		...prefixLines('Style Rules', constraints.styleRules),
		...prefixLines('Architecture Rules', constraints.architectureRules),
		...prefixLines('Allowed Paths', constraints.allowedPaths),
		...prefixLines('Forbidden Paths', constraints.forbiddenPaths),
		...prefixLines('Reuse Hints', constraints.reuseHints),
		...prefixLines('Delivery Checklist', constraints.deliveryChecklist),
	];
}

function prefixLines(label: string, values: string[]): string[] {
	if (values.length === 0) {
		return [];
	}
	return [label, ...values.map(value => `- ${value}`), ''];
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}