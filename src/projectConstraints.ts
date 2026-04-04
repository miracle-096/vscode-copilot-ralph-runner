import * as fs from 'fs';
import * as path from 'path';
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
import { getRalphLanguagePack } from './localization';

interface PackageJsonLike {
	name?: string;
	scripts?: Record<string, string>;
	devDependencies?: Record<string, string>;
	dependencies?: Record<string, string>;
	packageManager?: string;
}

interface TsConfigLike {
	compilerOptions?: {
		strict?: boolean;
		rootDir?: string;
		target?: string;
		module?: string;
	};
}

export interface ProjectConstraintScanOptions {
	language?: string;
}

export interface ProjectConstraintReferenceSource {
	label: string;
	content: string;
	note?: string;
}

export interface ProjectConstraintInitializationPromptInput {
	workspaceRoot: string;
	language?: string;
	generatedPath: string;
	editablePath: string;
	completionSignalPath: string;
	completionSignalKey: string;
	scanResult: {
		generatedConstraints: GeneratedProjectConstraints;
		editableConstraints: EditableProjectConstraints;
	};
	referenceSources?: ProjectConstraintReferenceSource[];
	additionalInstructions?: string;
}

export interface ProjectConstraintChatAdvicePromptInput {
	workspaceRoot: string;
	language?: string;
	userRequest: string;
	constraints: GeneratedProjectConstraints | null;
	generatedPath: string;
	editablePath: string;
	knowledgeReminderLines?: string[];
}

type GeneratedProjectConstraintListKey =
	| 'technologySummary'
	| 'buildCommands'
	| 'testCommands'
	| 'lintCommands'
	| 'styleRules'
	| 'gitRules'
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
	{ key: 'gitRules', heading: 'Git Rules' },
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
		gitRules: [],
		architectureRules: [],
		allowedPaths: [],
		forbiddenPaths: [],
		reuseHints: [],
		deliveryChecklist: [],
	};
}

export function createEditableProjectConstraintsTemplate(): EditableProjectConstraints {
	const languagePack = getRalphLanguagePack(undefined);
	return {
		title: languagePack.projectConstraintsTitle,
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

export function hasProjectConstraintsArtifacts(workspaceRoot: string): boolean {
	return fs.existsSync(getEditableProjectConstraintsPath(workspaceRoot))
		&& fs.existsSync(getGeneratedProjectConstraintsPath(workspaceRoot));
}

export function initializeProjectConstraintsArtifacts(
	workspaceRoot: string,
	options?: ProjectConstraintScanOptions,
): {
	editablePath: string;
	generatedPath: string;
	generatedConstraints: GeneratedProjectConstraints;
	editableConstraints: EditableProjectConstraints;
} {
	const scanResult = scanWorkspaceForProjectConstraints(workspaceRoot, options);
	const generatedPath = writeGeneratedProjectConstraints(workspaceRoot, scanResult.generatedConstraints);
	const editablePath = writeEditableProjectConstraints(workspaceRoot, scanResult.editableConstraints);

	return {
		editablePath,
		generatedPath,
		generatedConstraints: scanResult.generatedConstraints,
		editableConstraints: scanResult.editableConstraints,
	};
}

export function scanWorkspaceForProjectConstraints(
	workspaceRoot: string,
	options?: ProjectConstraintScanOptions,
): {
	generatedConstraints: GeneratedProjectConstraints;
	editableConstraints: EditableProjectConstraints;
} {
	const generatedConstraints = createEmptyGeneratedProjectConstraints();
	generatedConstraints.generatedAt = new Date().toISOString();
	const languagePack = getRalphLanguagePack(options?.language);

	const packageJson = readJsonFile<PackageJsonLike>(path.join(workspaceRoot, 'package.json'));
	const tsconfig = readJsonFile<TsConfigLike>(path.join(workspaceRoot, 'tsconfig.json'));
	const readmeExists = fs.existsSync(path.join(workspaceRoot, 'README.md'));
	const eslintConfigPath = findFirstExistingPath(workspaceRoot, [
		'eslint.config.mjs',
		'eslint.config.js',
		'.eslintrc',
		'.eslintrc.json',
		'.eslintrc.js',
	]);
	const topLevelDirectories = listChildDirectories(workspaceRoot);
	const srcDirectories = listChildDirectories(path.join(workspaceRoot, 'src'));

	generatedConstraints.technologySummary = collectTechnologySummary(packageJson, tsconfig, eslintConfigPath);
	generatedConstraints.buildCommands = collectScriptCommands(packageJson, ['compile', 'package', 'vscode:prepublish']);
	generatedConstraints.testCommands = collectScriptCommands(packageJson, ['test', 'pretest', 'compile-tests']);
	generatedConstraints.lintCommands = collectScriptCommands(packageJson, ['lint', 'check-types']);
	generatedConstraints.styleRules = collectStyleRules(tsconfig, eslintConfigPath);
	generatedConstraints.gitRules = collectGitRules(options?.language);
	generatedConstraints.architectureRules = collectArchitectureRules(tsconfig, srcDirectories);
	generatedConstraints.allowedPaths = collectAllowedPaths(topLevelDirectories, srcDirectories);
	generatedConstraints.forbiddenPaths = collectForbiddenPaths(topLevelDirectories);
	generatedConstraints.reuseHints = collectReuseHints(topLevelDirectories, srcDirectories, readmeExists);
	generatedConstraints.deliveryChecklist = collectDeliveryChecklist(generatedConstraints);
	generatedConstraints.metadata = {
		packageJsonName: packageJson?.name,
		hasReadme: readmeExists,
		eslintConfigPath: eslintConfigPath ? path.basename(eslintConfigPath) : undefined,
		sourceDirectories: srcDirectories,
		topLevelDirectories,
		harnessLanguage: languagePack.language,
	};

	return {
		generatedConstraints,
		editableConstraints: createEditableProjectConstraintsFromGenerated(generatedConstraints),
	};
}

export function buildProjectConstraintsInitializationPrompt(input: ProjectConstraintInitializationPromptInput): string {
	const languagePack = getRalphLanguagePack(input.language);
	const generatedJson = JSON.stringify(normalizeGeneratedProjectConstraints(input.scanResult.generatedConstraints), null, 2);
	const editableMarkdown = serializeEditableProjectConstraints(normalizeEditableProjectConstraints(input.scanResult.editableConstraints));
	const referenceSources = input.referenceSources ?? [];
	const languageInstruction = languagePack.language === 'Chinese'
		? 'Use Chinese for human-facing project-constraint prose, especially the editable markdown rules and any language-sensitive generated rules.'
		: 'Use English for human-facing project-constraint prose, especially the editable markdown rules and any language-sensitive generated rules.';

	const lines = [
		'Read the current workspace and consolidate project constraints using the scanned baseline plus any user-provided project rules.',
		`Workspace root: ${input.workspaceRoot}`,
		`Write the machine-readable generated constraints JSON directly to: ${input.generatedPath}`,
		`Write the editable team-maintained markdown constraints directly to: ${input.editablePath}`,
		`After both files are fully written, update the entry "${input.completionSignalKey}" in ${input.completionSignalPath} to the exact text completed and preserve valid JSON for the whole file.`,
		'Do not create alternative constraint files or temporary summaries.',
		languageInstruction,
		'',
		'Scanned baseline generated constraints JSON:',
		'```json',
		generatedJson,
		'```',
		'',
		'Scanned baseline editable constraints markdown:',
		'```markdown',
		editableMarkdown.trim(),
		'```',
	];

	if (referenceSources.length > 0) {
		lines.push('', 'User-provided project rules and reference material:');
		for (const source of referenceSources) {
			lines.push(`### ${source.label}`);
			if (source.note && source.note.trim().length > 0) {
				lines.push(`Note: ${source.note.trim()}`);
			}
			lines.push(source.content.trim().length > 0 ? source.content.trim() : '(empty)');
			lines.push('');
		}
	}

	if (input.additionalInstructions && input.additionalInstructions.trim().length > 0) {
		lines.push('Additional user instructions:');
		lines.push(input.additionalInstructions.trim());
		lines.push('');
	}

	lines.push(
		'Instructions:',
		'- Merge the scanned baseline with the user-provided rules instead of discarding either side.',
		'- Preserve the generated JSON schema exactly.',
		'- Preserve the editable markdown structure with the project constraints title, optional last-updated line, and section headings.',
		'- Keep rules concrete, implementation-oriented, and repo-specific when evidence exists.',
		'- If a user-provided rule conflicts with a weak scan inference, prefer the explicit user-provided rule.',
		'- Do not include placeholder TODO bullets when you already have enough information to write a real rule.',
		'- Keep the final files aligned with the selected plugin language.',
	);

	return lines.join('\n');
}

export function buildProjectConstraintChatAdvicePrompt(input: ProjectConstraintChatAdvicePromptInput): string {
	const languagePack = getRalphLanguagePack(input.language);
	const constraintLines = summarizeProjectConstraintsForPrompt(input.constraints);
	const languageInstruction = languagePack.language === 'Chinese'
		? '用中文输出，先吸收并落实规范建议，再给出一份可直接提供给大模型使用的最终描述。'
		: 'Reply in English. Absorb the constraint-driven revisions first, then produce a final prompt the user can send directly to a large language model.';

	const lines = [
		'You are Harness Runner Spec Finalizer for the current workspace.',
		`Workspace root: ${input.workspaceRoot}`,
		`Merged project constraints are sourced from ${input.generatedPath} and ${input.editablePath}.`,
		languageInstruction,
		'Review the user request against the merged Harness Runner project constraints and internally improve it before answering.',
		'If the request is vague, rewrite it into a sharper implementation brief that better matches the constraints.',
		'If the request conflicts with the constraints, resolve the conflict in the final version and explain the adjustment briefly.',
		'If the request already fits the constraints, still tighten it into a clearer execution-ready description.',
		'Prefer concrete path, tooling, testing, artifact, and delivery guidance over generic best practices.',
		'Do not stop at giving advice only. Produce a final, self-contained request that the user can copy into another LLM conversation.',
		'The final request must explicitly follow the merged project constraints instead of merely referencing them abstractly.',
		'',
		'User request to revise:',
		input.userRequest.trim(),
		'',
		'Merged project constraints:',
		...(constraintLines.length > 0 ? constraintLines : ['- No project constraints are currently available.']),
	];

	const knowledgeReminderLines = input.knowledgeReminderLines ?? [];
	if (knowledgeReminderLines.length > 0) {
		lines.push(
			'',
			'Knowledge freshness and coverage reminders:',
			...knowledgeReminderLines,
			'Carry the applicable reminders into the final request when they affect the requested change surface.',
		);
	}

	lines.push(
		'',
		'Response format:',
		'1. Final request for the LLM',
		'   - Provide a complete, polished request inside a fenced code block.',
		'   - The request should be self-contained, implementation-ready, and aligned with the project constraints.',
		'   - Fold the useful suggestions into the final request instead of leaving them as separate todo items.',
		'2. Constraint-driven adjustments',
		'   - Briefly explain which important changes were made because of the project constraints.',
		'3. Risks or missing information',
		'   - Mention only the remaining gaps that still block a high-quality implementation request.',
	);

	return lines.join('\n');
}

export function extractRunnableProjectConstraintRequest(responseText: string): string | null {
	const trimmed = responseText.trim();
	if (trimmed.length === 0) {
		return null;
	}

	const finalSectionMatch = trimmed.match(/(?:^|\n)1\.\s*Final request for the LLM[\s\S]*?```(?:[\w-]+)?\r?\n([\s\S]*?)```/i);
	const finalSectionRequest = finalSectionMatch?.[1]?.trim();
	if (finalSectionRequest) {
		return finalSectionRequest;
	}

	const firstCodeBlockMatch = trimmed.match(/```(?:[\w-]+)?\r?\n([\s\S]*?)```/);
	const firstCodeBlockRequest = firstCodeBlockMatch?.[1]?.trim();
	if (firstCodeBlockRequest) {
		return firstCodeBlockRequest;
	}

	return null;
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
		gitRules: toStringArray(value.gitRules),
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
		...prefixLines('Git Rules', constraints.gitRules),
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

export function createEditableProjectConstraintsFromGenerated(constraints: Partial<GeneratedProjectConstraints>): EditableProjectConstraints {
	const normalizedGenerated = normalizeGeneratedProjectConstraints(constraints);
	return normalizeEditableProjectConstraints({
		title: normalizedGenerated.metadata?.ralphLanguage === 'Chinese' ? 'RALPH 项目约束' : 'RALPH Project Constraints',
		lastUpdated: normalizedGenerated.generatedAt,
		sections: GENERATED_CONSTRAINT_SECTION_ORDER.map(section => ({
			heading: section.heading,
			items: normalizedGenerated[section.key],
		})),
	});
}

function collectTechnologySummary(
	packageJson: PackageJsonLike | null,
	tsconfig: TsConfigLike | null,
	eslintConfigPath: string | null,
): string[] {
	const items: string[] = [];
	if (packageJson?.name) {
		items.push(`Package name: ${packageJson.name}`);
	}
	if (packageJson?.packageManager) {
		items.push(`Package manager: ${packageJson.packageManager}`);
	} else if (packageJson) {
		items.push('Package manager: npm');
	}
	if (packageJson?.devDependencies?.typescript || packageJson?.dependencies?.typescript) {
		items.push('Language: TypeScript');
	}
	if (tsconfig?.compilerOptions?.target) {
		items.push(`TypeScript target: ${tsconfig.compilerOptions.target}`);
	}
	if (tsconfig?.compilerOptions?.module) {
		items.push(`TypeScript module: ${tsconfig.compilerOptions.module}`);
	}
	if (eslintConfigPath) {
		items.push(`Linting is configured via ${path.basename(eslintConfigPath)}`);
	}
	return Array.from(new Set(items));
}

function collectStyleRules(tsconfig: TsConfigLike | null, eslintConfigPath: string | null): string[] {
	const items: string[] = [];
	if (tsconfig?.compilerOptions?.strict) {
		items.push('Keep TypeScript strict-mode compatible changes');
	}
	if (tsconfig?.compilerOptions?.rootDir) {
		items.push(`Keep source files under ${tsconfig.compilerOptions.rootDir}`);
	}
	if (eslintConfigPath) {
		items.push(`Preserve the linting conventions enforced by ${path.basename(eslintConfigPath)}`);
	}
	items.push('Prefer small, focused modules over expanding already-large files unnecessarily');
	return Array.from(new Set(items));
}

function collectGitRules(language?: string): string[] {
	return [getRalphLanguagePack(language).gitCommitRule];
}

function collectArchitectureRules(tsconfig: TsConfigLike | null, srcDirectories: string[]): string[] {
	const items: string[] = [
		'Keep reusable logic in dedicated modules instead of duplicating it across the codebase',
		'Prefer keeping entrypoints thin and moving reusable implementation details into focused modules',
	];
	if (tsconfig?.compilerOptions?.rootDir) {
		items.push(`Treat ${tsconfig.compilerOptions.rootDir} as a primary source root`);
	}
	if (srcDirectories.length > 0) {
		items.push(`Current source subdirectories: ${srcDirectories.join(', ')}`);
	}
	return Array.from(new Set(items));
}

function collectAllowedPaths(topLevelDirectories: string[], srcDirectories: string[]): string[] {
	const preferredRoots = ['src', 'app', 'lib', 'packages', 'test', 'tests', 'spec', 'specs', 'docs', 'scripts', 'config', 'public', 'assets'];
	const excludedRoots = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '.git', '.next', '.nuxt']);
	const items: string[] = [];

	for (const dir of preferredRoots) {
		if (topLevelDirectories.includes(dir)) {
			items.push(`${dir}/**`);
		}
	}

	if (topLevelDirectories.includes('src')) {
		for (const dir of srcDirectories) {
			items.push(`src/${dir}/**`);
		}
	}

	if (items.length === 0) {
		for (const dir of topLevelDirectories) {
			if (!excludedRoots.has(dir) && !dir.startsWith('.')) {
				items.push(`${dir}/**`);
			}
		}
	}

	return Array.from(new Set(items));
}

function collectForbiddenPaths(topLevelDirectories: string[]): string[] {
	const items: string[] = [];
	if (topLevelDirectories.includes('node_modules')) {
		items.push('Do not edit dependency code under node_modules/ directly');
	}
	for (const generatedDir of ['dist', 'build', 'out', 'coverage', '.next', '.nuxt']) {
		if (topLevelDirectories.includes(generatedDir)) {
			items.push(`Treat ${generatedDir}/ as generated or tool-managed output unless a task explicitly requires editing it`);
		}
	}
	return Array.from(new Set(items));
}

function collectReuseHints(topLevelDirectories: string[], srcDirectories: string[], readmeExists: boolean): string[] {
	const items = [
		'Reuse existing utilities, shared types, and configuration patterns before adding new abstractions',
		'Prefer extending modules that already own a concern instead of duplicating logic in parallel files',
	];
	if (readmeExists) {
		items.push('Check README.md for user-facing workflow expectations before changing behavior');
	}
	if (srcDirectories.includes('test') || ['test', 'tests', 'spec', 'specs', '__tests__'].some(dir => topLevelDirectories.includes(dir))) {
		items.push('Add or extend focused automated tests when introducing behavior changes');
	}
	return Array.from(new Set(items));
}

function collectDeliveryChecklist(constraints: GeneratedProjectConstraints): string[] {
	const items = [...constraints.lintCommands, ...constraints.buildCommands];
	if (items.length === 0) {
		items.push('Run the relevant typecheck, lint, and build steps before considering work complete');
	}
	return Array.from(new Set(items));
}

function collectScriptCommands(packageJson: PackageJsonLike | null, names: string[]): string[] {
	const scripts = packageJson?.scripts ?? {};
	return names
		.filter(name => typeof scripts[name] === 'string')
		.map(name => `npm run ${name}`);
}

function listChildDirectories(dirPath: string): string[] {
	if (!fs.existsSync(dirPath)) {
		return [];
	}
	try {
		return fs.readdirSync(dirPath, { withFileTypes: true })
			.filter(entry => entry.isDirectory())
			.map(entry => entry.name)
			.sort();
	} catch {
		return [];
	}
}

function findFirstExistingPath(workspaceRoot: string, relativePaths: string[]): string | null {
	for (const relativePath of relativePaths) {
		const fullPath = path.join(workspaceRoot, relativePath);
		if (fs.existsSync(fullPath)) {
			return fullPath;
		}
	}
	return null;
}

function readJsonFile<T>(filePath: string): T | null {
	try {
		const content = fs.readFileSync(filePath, 'utf-8');
		return JSON.parse(content) as T;
	} catch {
		return null;
	}
}