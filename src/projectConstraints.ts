import * as fs from 'fs';
import {
	EditableProjectConstraintSection,
	EditableProjectConstraints,
	GeneratedProjectConstraints,
} from './types';
import {
	ensureProjectConstraintDirectories,
	getEditableProjectConstraintsPath,
	getGeneratedProjectConstraintsPath,
} from './workspacePaths';

type GeneratedProjectConstraintListKey =
	| 'technologySummary'
	| 'buildCommands'
	| 'testCommands'
	| 'lintCommands'
	| 'styleRules'
	| 'architectureRules'
	| 'allowedPaths'
	| 'forbiddenPaths'
	| 'reuseHints'
	| 'deliveryChecklist';

const GENERATED_CONSTRAINT_SECTION_ORDER: Array<{
	key: GeneratedProjectConstraintListKey;
	heading: string;
}> = [
	{ key: 'technologySummary', heading: 'Technology Summary' },
	{ key: 'buildCommands', heading: 'Build Commands' },
	{ key: 'testCommands', heading: 'Test Commands' },
	{ key: 'lintCommands', heading: 'Lint Commands' },
	{ key: 'styleRules', heading: 'Style Rules' },
	{ key: 'architectureRules', heading: 'Architecture Rules' },
	{ key: 'allowedPaths', heading: 'Allowed Paths' },
	{ key: 'forbiddenPaths', heading: 'Forbidden Paths' },
	{ key: 'reuseHints', heading: 'Reuse Hints' },
	{ key: 'deliveryChecklist', heading: 'Delivery Checklist' },
];

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
		sections: GENERATED_CONSTRAINT_SECTION_ORDER.map(section => ({
			heading: section.heading,
			items: [],
		})),
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
		writeGeneratedProjectConstraints(workspaceRoot, createEmptyGeneratedProjectConstraints());
	}

	return { editablePath, generatedPath };
}

export function writeGeneratedProjectConstraints(workspaceRoot: string, constraints: Partial<GeneratedProjectConstraints>): string {
	ensureProjectConstraintDirectories(workspaceRoot);
	const filePath = getGeneratedProjectConstraintsPath(workspaceRoot);
	const normalized = normalizeGeneratedProjectConstraints(constraints);
	fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf-8');
	return filePath;
}

export function writeEditableProjectConstraints(workspaceRoot: string, constraints: EditableProjectConstraints): string {
	ensureProjectConstraintDirectories(workspaceRoot);
	const filePath = getEditableProjectConstraintsPath(workspaceRoot);
	fs.writeFileSync(filePath, serializeEditableProjectConstraints(normalizeEditableProjectConstraints(constraints)), 'utf-8');
	return filePath;
}

export function serializeEditableProjectConstraints(constraints: EditableProjectConstraints): string {
	const normalized = normalizeEditableProjectConstraints(constraints);
	const lines: string[] = [`# ${normalized.title}`, ''];
	if (normalized.lastUpdated) {
		lines.push(`> Last Updated: ${normalized.lastUpdated}`, '');
	}
	for (const section of normalized.sections) {
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

export function readEditableProjectConstraints(workspaceRoot: string): EditableProjectConstraints | null {
	try {
		const content = fs.readFileSync(getEditableProjectConstraintsPath(workspaceRoot), 'utf-8');
		return parseEditableProjectConstraints(content);
	} catch {
		return null;
	}
}

export function parseEditableProjectConstraints(markdown: string): EditableProjectConstraints {
	const fallback = createEditableProjectConstraintsTemplate();
	const lines = markdown.split(/\r?\n/);
	let title = fallback.title;
	let lastUpdated: string | undefined;
	const sections: EditableProjectConstraintSection[] = [];
	let currentSection: EditableProjectConstraintSection | null = null;

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (line.length === 0) {
			continue;
		}

		if (line.startsWith('# ')) {
			title = line.slice(2).trim() || fallback.title;
			continue;
		}

		if (line.startsWith('>')) {
			const match = line.match(/^>\s*Last Updated:\s*(.+)$/i);
			if (match) {
				lastUpdated = match[1].trim();
			}
			continue;
		}

		if (line.startsWith('## ')) {
			currentSection = {
				heading: line.slice(3).trim(),
				items: [],
			};
			sections.push(currentSection);
			continue;
		}

		if ((line.startsWith('- ') || line.startsWith('* ')) && currentSection) {
			const item = line.slice(2).trim();
			if (item.length > 0 && item.toUpperCase() !== 'TODO') {
				currentSection.items.push(item);
			}
		}
	}

	return normalizeEditableProjectConstraints({
		title,
		lastUpdated,
		sections,
	});
}

export function normalizeEditableProjectConstraints(value: Partial<EditableProjectConstraints> | null | undefined): EditableProjectConstraints {
	const fallback = createEditableProjectConstraintsTemplate();
	const inputSections = Array.isArray(value?.sections) ? value.sections : [];
	const seen = new Set<string>();
	const normalizedSections: EditableProjectConstraintSection[] = [];

	for (const section of inputSections) {
		if (!section || typeof section !== 'object') {
			continue;
		}
		const heading = typeof section.heading === 'string' ? section.heading.trim() : '';
		if (heading.length === 0) {
			continue;
		}
		const normalizedHeading = normalizeHeading(heading);
		if (seen.has(normalizedHeading)) {
			continue;
		}
		seen.add(normalizedHeading);
		normalizedSections.push({
			heading,
			items: toStringArray(section.items),
		});
	}

	for (const section of fallback.sections) {
		const normalizedHeading = normalizeHeading(section.heading);
		if (!seen.has(normalizedHeading)) {
			normalizedSections.push({
				heading: section.heading,
				items: [],
			});
		}
	}

	return {
		title: typeof value?.title === 'string' && value.title.trim().length > 0 ? value.title.trim() : fallback.title,
		lastUpdated: typeof value?.lastUpdated === 'string' && value.lastUpdated.trim().length > 0 ? value.lastUpdated.trim() : fallback.lastUpdated,
		sections: normalizedSections,
	};
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
		metadata: isRecord(value.metadata) ? value.metadata : undefined,
	};
}

export function mergeProjectConstraints(
	generated: Partial<GeneratedProjectConstraints> | null | undefined,
	editable: Partial<EditableProjectConstraints> | null | undefined,
): GeneratedProjectConstraints {
	const normalizedGenerated = normalizeGeneratedProjectConstraints(generated);
	const normalizedEditable = normalizeEditableProjectConstraints(editable);
	const merged = createEmptyGeneratedProjectConstraints();

	merged.version = normalizedGenerated.version;
	merged.generatedAt = normalizedGenerated.generatedAt;
	merged.metadata = normalizedGenerated.metadata;

	const editableSectionMap = new Map(
		normalizedEditable.sections.map(section => [normalizeHeading(section.heading), section.items])
	);

	for (const section of GENERATED_CONSTRAINT_SECTION_ORDER) {
		const editableItems = editableSectionMap.get(normalizeHeading(section.heading)) ?? [];
		const generatedItems = normalizedGenerated[section.key];
		merged[section.key] = editableItems.length > 0 ? editableItems : generatedItems;
	}

	return merged;
}

export function loadMergedProjectConstraints(workspaceRoot: string): GeneratedProjectConstraints {
	const generated = readGeneratedProjectConstraints(workspaceRoot);
	const editable = readEditableProjectConstraints(workspaceRoot);
	return mergeProjectConstraints(generated, editable);
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

function normalizeHeading(value: string): string {
	return value.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const normalizedItems = value
		.filter((item): item is string => typeof item === 'string')
		.map(item => item.trim())
		.filter(item => item.length > 0 && item.toUpperCase() !== 'TODO');

	return Array.from(new Set(normalizedItems));
}