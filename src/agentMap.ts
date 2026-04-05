import * as fs from 'fs';
import * as path from 'path';
import { loadMergedProjectConstraints, scanWorkspaceForProjectConstraints } from './projectConstraints';
import { getSourceContextIndex, refreshSourceContextIndex } from './sourceContext';
import {
	AgentKnowledgeCatalogArtifact,
	AgentKnowledgeItem,
	AgentKnowledgeSection,
	AgentMapGap,
	AgentMapOverviewArtifact,
	AgentMapRuleEntry,
	AgentMapRunbookStep,
	GeneratedProjectConstraints,
	PrdFile,
	SourceContextIndexArtifact,
} from './types';
import {
	ensureAgentMapDirectory,
	getAgentMapKnowledgeCatalogPath,
	getAgentMapOverviewPath,
	getDesignContextDirectoryPath,
	getEditableProjectConstraintsPath,
	getExecutionCheckpointDirectoryPath,
	getGeneratedProjectConstraintsPath,
	getProjectDesignContextPath,
	getPrdPath,
	getSourceContextIndexPath,
	getStoryEvidenceDirectoryPath,
	getStoryStatusRegistryPath,
	getTaskMemoryDirectoryPath,
} from './workspacePaths';

interface PackageJsonLike {
	name?: string;
	description?: string;
	main?: string;
	packageManager?: string;
	scripts?: Record<string, string>;
}

const MODULE_RESPONSIBILITY_HINTS: Readonly<Record<string, string[]>> = {
	agentMap: [
		'Generate lightweight Agent Map artifacts for repository navigation and knowledge freshness checks.',
	],
	designContext: [
		'Persist story-level and shared design context artifacts.',
		'Synthesize bounded design guidance for execution-time prompt injection.',
	],
	executionCheckpoint: [
		'Persist resumable execution checkpoints for story handoff and recovery.',
	],
	extension: [
		'Activate VS Code commands and orchestrate the autonomous story loop.',
		'Bridge persisted artifacts with Cline task execution.',
	],
	localization: [
		'Provide localized labels and messages for commands, prompts, and status UI.',
	],
	policyGate: [
		'Evaluate preflight and completion checks against artifacts, paths, and commands.',
	],
	projectConstraints: [
		'Scan and merge repository constraints for prompt injection and policy checks.',
	],
	promptContext: [
		'Compose bounded prompt sections in a deterministic order.',
	],
	sourceContext: [
		'Build and recall lightweight source-context signals for a story.',
	],
	storyEvidence: [
		'Persist auditable completion evidence, risk assessment, and approval history.',
	],
	taskMemory: [
		'Persist per-story task memory and recall related prior work.',
	],
	taskStatus: [
		'Normalize noisy task signal states such as completed and inprogress.',
	],
	types: [
		'Define shared story and artifact schemas used across the extension.',
	],
	workspacePaths: [
		'Centralize workspace artifact paths and directory scaffolding for Harness Runner.',
	],
};

export interface GenerateAgentMapResult {
	overviewPath: string;
	knowledgeCatalogPath: string;
	overview: AgentMapOverviewArtifact;
	knowledgeCatalog: AgentKnowledgeCatalogArtifact;
}

export function generateAgentMapArtifacts(workspaceRoot: string): GenerateAgentMapResult {
	ensureAgentMapDirectory(workspaceRoot);

	const generatedAt = new Date().toISOString();
	const packageJson = readJsonFile<PackageJsonLike>(path.join(workspaceRoot, 'package.json'));
	const prd = readJsonFile<PrdFile>(getPrdPath(workspaceRoot));
	const projectConstraints = loadProjectConstraintsSnapshot(workspaceRoot);
	const sourceContext = loadSourceContextSnapshot(workspaceRoot);
	const moduleMap = buildModuleMap(workspaceRoot, sourceContext);
	const ruleEntries = buildRuleEntries(workspaceRoot);
	const documentIndex = buildDocumentIndex(workspaceRoot);
	const gaps = collectGaps(workspaceRoot, {
		prd,
		projectConstraints,
		sourceContext,
		moduleMap,
		ruleEntries,
		documentIndex,
	});
	const runbook = buildRunbook(projectConstraints);

	const overview: AgentMapOverviewArtifact = {
		version: 1,
		generatedAt,
		workspaceRootName: path.basename(workspaceRoot),
		project: {
			name: packageJson?.name?.trim() || prd?.project?.trim() || path.basename(workspaceRoot),
			description: firstNonEmpty([
				prd?.description,
				packageJson?.description,
				readReadmeSummary(workspaceRoot),
			]) || 'Project overview is missing. See gaps for required context that should be added.',
			branchName: prd?.branchName?.trim() || 'Missing branchName in prd.json',
			packageManager: packageJson?.packageManager?.trim() || 'npm',
			primaryLanguage: inferPrimaryLanguage(projectConstraints),
			mainEntry: packageJson?.main?.trim() || 'dist/extension.js',
			storyCount: Array.isArray(prd?.userStories) ? prd.userStories.length : 0,
			sourceSignals: compact([
				relativePath(workspaceRoot, path.join(workspaceRoot, 'package.json')),
				pathExists(getPrdPath(workspaceRoot)) ? relativePath(workspaceRoot, getPrdPath(workspaceRoot)) : undefined,
				pathExists(path.join(workspaceRoot, 'README.md')) ? 'README.md' : undefined,
				pathExists(getGeneratedProjectConstraintsPath(workspaceRoot)) ? relativePath(workspaceRoot, getGeneratedProjectConstraintsPath(workspaceRoot)) : 'project-constraints scan fallback',
				pathExists(getSourceContextIndexPath(workspaceRoot)) ? relativePath(workspaceRoot, getSourceContextIndexPath(workspaceRoot)) : 'source-context refresh fallback',
			]),
		},
		moduleMap,
		ruleEntries,
		runbook,
		documentIndex,
		gaps,
		source: 'cline',
	};

	const knowledgeCatalog: AgentKnowledgeCatalogArtifact = {
		version: 1,
		generatedAt,
		workspaceRootName: path.basename(workspaceRoot),
		sections: buildKnowledgeSections(documentIndex),
		gaps,
		freshnessTargets: documentIndex.map(item => ({
			label: item.label,
			path: item.path,
			freshnessTarget: item.freshnessTarget,
			exists: item.exists,
		})),
		source: 'cline',
	};

	const overviewPath = getAgentMapOverviewPath(workspaceRoot);
	const knowledgeCatalogPath = getAgentMapKnowledgeCatalogPath(workspaceRoot);
	fs.writeFileSync(overviewPath, `${JSON.stringify(overview, null, 2)}\n`, 'utf-8');
	fs.writeFileSync(knowledgeCatalogPath, `${JSON.stringify(knowledgeCatalog, null, 2)}\n`, 'utf-8');

	return {
		overviewPath,
		knowledgeCatalogPath,
		overview,
		knowledgeCatalog,
	};
}

function loadProjectConstraintsSnapshot(workspaceRoot: string): GeneratedProjectConstraints {
	try {
		return loadMergedProjectConstraints(workspaceRoot);
	} catch {
		return scanWorkspaceForProjectConstraints(workspaceRoot).generatedConstraints;
	}
}

function loadSourceContextSnapshot(workspaceRoot: string): SourceContextIndexArtifact | null {
	const existing = getSourceContextIndex(workspaceRoot);
	if (existing) {
		return existing;
	}

	try {
		return refreshSourceContextIndex(workspaceRoot);
	} catch {
		return null;
	}
}

function buildModuleMap(workspaceRoot: string, sourceContext: SourceContextIndexArtifact | null) {
	const srcDir = path.join(workspaceRoot, 'src');
	if (!pathExists(srcDir)) {
		return [];
	}

	return fs.readdirSync(srcDir, { withFileTypes: true })
		.filter(entry => entry.isFile() && entry.name.endsWith('.ts') && entry.name !== 'extension.test.ts')
		.filter(entry => !entry.name.endsWith('.d.ts'))
		.map(entry => {
			const moduleId = path.basename(entry.name, '.ts');
			const modulePath = relativePath(workspaceRoot, path.join(srcDir, entry.name));
			const sourceSignals = compact([
				findSourceContextSignal(sourceContext?.keyEntryFiles ?? [], modulePath),
				findSourceContextSignal(sourceContext?.reusableModuleHints ?? [], moduleId),
				findSourceContextSignal(sourceContext?.hotspotPaths ?? [], modulePath),
			]);

			return {
				id: moduleId,
				label: moduleId,
				path: modulePath,
				exists: true,
				responsibilities: MODULE_RESPONSIBILITY_HINTS[moduleId] ?? [
					`Provide the repository logic for ${humanizeIdentifier(moduleId)}.`,
				],
				sourceSignals,
				gaps: sourceSignals.length > 0 ? [] : ['No explicit source-context hint matched this module; responsibility is inferred from the file name.'],
			};
		})
		.sort((left, right) => left.label.localeCompare(right.label));
}

function buildRuleEntries(workspaceRoot: string): AgentMapRuleEntry[] {
	return [
		createRuleEntry(
			workspaceRoot,
			'generated-project-constraints',
			'Generated project constraints',
			getGeneratedProjectConstraintsPath(workspaceRoot),
			'generated',
			'Machine-readable baseline for commands, allowed paths, forbidden paths, and delivery rules.',
		),
		createRuleEntry(
			workspaceRoot,
			'editable-project-constraints',
			'Editable project constraints',
			getEditableProjectConstraintsPath(workspaceRoot),
			'editable',
			'Team-maintained rule layer that should override generated assumptions.',
		),
		createRuleEntry(
			workspaceRoot,
			'package-config',
			'Extension command and setting contributions',
			path.join(workspaceRoot, 'package.json'),
			'config',
			'Command IDs, settings, and contribution metadata exposed to VS Code.',
		),
		createRuleEntry(
			workspaceRoot,
			'source-context-index',
			'Source context index',
			getSourceContextIndexPath(workspaceRoot),
			'workflow',
			'Lightweight repository map used to recall relevant modules, entry files, and hotspots.',
		),
		createRuleEntry(
			workspaceRoot,
			'design-context-directory',
			'Design context directory',
			getDesignContextDirectoryPath(workspaceRoot),
			'workflow',
			'Shared and story-level design notes used when UI-sensitive stories need structured visual guidance.',
		),
	];
}

function buildRunbook(projectConstraints: GeneratedProjectConstraints): AgentMapRunbookStep[] {
	return [
		{
			id: 'plan',
			title: 'Plan',
			summary: 'Start every story by reading repository rules, story metadata, source context, and the latest persisted handoff artifacts instead of relying on prior chat state.',
			inputs: [
				'prd.json',
				'README.md',
				'.harness-runner/project-constraints.md',
				'.harness-runner/project-constraints.generated.json',
				'.harness-runner/source-context-index.json',
				'.harness-runner/memory/US-xxx.json',
				'.harness-runner/checkpoints/US-xxx.checkpoint.json',
			],
			commands: [
				'HARNESS: 初始化项目约束',
				'HARNESS: 为故事添加上下文',
				'HARNESS: 刷新源码上下文索引',
				'HARNESS: 生成 Agent Map',
			],
			outputs: ['Confirmed scope, reusable modules, allowed paths, and missing knowledge gaps.'],
		},
		{
			id: 'execute',
			title: 'Execute',
			summary: 'Apply focused changes in allowed paths and prefer existing artifact producers over bespoke scanning or one-off logic.',
			inputs: ['Module map', 'Rule entries', 'Acceptance criteria'],
			commands: compact([
				...projectConstraints.buildCommands,
				...projectConstraints.testCommands,
			]),
			outputs: ['Relevant source changes and any refreshed support artifacts needed by the story.'],
		},
		{
			id: 'checkpoint',
			title: 'Checkpoint',
			summary: 'Before handing off, persist structured task memory, execution checkpoint, and evidence so the next session can resume from files instead of conversation history.',
			inputs: ['Changed files', 'Tests run', 'Key decisions', 'Known risks'],
			commands: ['Write .harness-runner/memory/US-xxx.json', 'Write .harness-runner/checkpoints/US-xxx.checkpoint.json', 'Write .harness-runner/evidence/US-xxx.evidence.json'],
			outputs: ['Task memory artifact', 'Execution checkpoint artifact', 'Story evidence artifact'],
		},
		{
			id: 'reset',
			title: 'Reset',
			summary: 'End the story by clearing implicit session assumptions, relying on persisted artifacts, and using reset only for explicit recovery or reruns.',
			inputs: ['Latest structured artifacts', 'Completion signal expectations'],
			commands: ['HARNESS: 重置故事', 'Update the relevant entry in .harness-runner/story-status.json when the story is truly complete'],
			outputs: ['Fresh next-session handoff with no hidden state dependency.'],
		},
	];
}

function buildDocumentIndex(workspaceRoot: string): AgentKnowledgeItem[] {
	const readmePath = path.join(workspaceRoot, 'README.md');
	const packageJsonPath = path.join(workspaceRoot, 'package.json');
	const progressPath = path.join(workspaceRoot, 'progress.txt');
	const prdPath = getPrdPath(workspaceRoot);
	const designContextDir = getDesignContextDirectoryPath(workspaceRoot);
	const memoryDir = getTaskMemoryDirectoryPath(workspaceRoot);
	const checkpointDir = getExecutionCheckpointDirectoryPath(workspaceRoot);
	const evidenceDir = getStoryEvidenceDirectoryPath(workspaceRoot);
	const storyStatusPath = getStoryStatusRegistryPath(workspaceRoot);

	return [
		createKnowledgeItem(workspaceRoot, 'readme', 'README', readmePath, 'document', 'Repository overview, workflow, and artifact descriptions.', ['project-overview', 'runbook'], 'manual'),
		createKnowledgeItem(workspaceRoot, 'package-json', 'package.json', packageJsonPath, 'document', 'Package metadata, scripts, commands, and extension contributions.', ['project-overview', 'rule-entries'], 'manual'),
		createKnowledgeItem(workspaceRoot, 'prd', 'PRD', prdPath, 'document', 'Source of truth for project intent, branch name, and user stories.', ['project-overview', 'story-execution'], 'manual'),
		createKnowledgeItem(workspaceRoot, 'editable-constraints', 'Editable project constraints', getEditableProjectConstraintsPath(workspaceRoot), 'document', 'Human-maintained repository rules that should override generated assumptions.', ['rule-entries', 'runbook'], 'manual'),
		createKnowledgeItem(workspaceRoot, 'generated-constraints', 'Generated project constraints', getGeneratedProjectConstraintsPath(workspaceRoot), 'artifact', 'Machine-readable constraints baseline for prompts and policy checks.', ['rule-entries', 'runbook'], 'on-demand'),
		createKnowledgeItem(workspaceRoot, 'source-context', 'Source context index', getSourceContextIndexPath(workspaceRoot), 'artifact', 'Lightweight module and hotspot map reused during story recall.', ['module-map', 'runbook'], 'on-demand'),
		createKnowledgeItem(workspaceRoot, 'design-context-dir', 'Design context directory', designContextDir, 'directory', 'Shared and story-level design notes.', ['rule-entries', 'story-execution'], 'per-story'),
		createKnowledgeItem(workspaceRoot, 'project-design-context', 'Project design context', getProjectDesignContextPath(workspaceRoot), 'artifact', 'Shared design context for project-wide UI constraints.', ['design-context'], 'per-story'),
		createKnowledgeItem(workspaceRoot, 'task-memory-dir', 'Task memory directory', memoryDir, 'directory', 'Per-story memory artifacts for prior work recall.', ['checkpoint'], 'per-story'),
		createKnowledgeItem(workspaceRoot, 'checkpoint-dir', 'Execution checkpoint directory', checkpointDir, 'directory', 'Per-story resume snapshots for interrupted or completed work.', ['checkpoint'], 'per-story'),
		createKnowledgeItem(workspaceRoot, 'evidence-dir', 'Story evidence directory', evidenceDir, 'directory', 'Per-story evidence packs for testing, risk, and approval history.', ['checkpoint', 'release'], 'per-story'),
		createKnowledgeItem(workspaceRoot, 'story-status', 'Story status registry', storyStatusPath, 'artifact', 'Durable story status table used instead of task lock files for completion truth.', ['runbook', 'release'], 'continuous'),
		createKnowledgeItem(workspaceRoot, 'progress-log', 'Progress log', progressPath, 'artifact', 'Append-only execution log that records story outcomes.', ['runbook', 'release'], 'continuous'),
	].sort((left, right) => left.label.localeCompare(right.label));
}

function buildKnowledgeSections(documentIndex: AgentKnowledgeItem[]): AgentKnowledgeSection[] {
	return [
		{
			id: 'project-entry',
			title: 'Project Entry Points',
			items: documentIndex.filter(item => ['README', 'package.json', 'PRD'].includes(item.label)),
		},
		{
			id: 'rules-and-context',
			title: 'Rules and Context Inputs',
			items: documentIndex.filter(item => ['Editable project constraints', 'Generated project constraints', 'Source context index', 'Design context directory', 'Project design context'].includes(item.label)),
		},
		{
			id: 'handoff-artifacts',
			title: 'Execution Handoff Artifacts',
			items: documentIndex.filter(item => ['Task memory directory', 'Execution checkpoint directory', 'Story evidence directory', 'Story status registry', 'Progress log'].includes(item.label)),
		},
	];
}

function collectGaps(
	workspaceRoot: string,
	context: {
		prd: PrdFile | null;
		projectConstraints: GeneratedProjectConstraints;
		sourceContext: SourceContextIndexArtifact | null;
		moduleMap: ReturnType<typeof buildModuleMap>;
		ruleEntries: AgentMapRuleEntry[];
		documentIndex: AgentKnowledgeItem[];
	},
): AgentMapGap[] {
	const gaps: AgentMapGap[] = [];

	if (!context.prd) {
		gaps.push(createGap('missing-prd', 'Missing PRD', 'prd.json is missing or unreadable, so story-level project goals cannot be confirmed from the repository.', 'warning', getPrdPath(workspaceRoot), ['story metadata']));
	}

	if (!pathExists(path.join(workspaceRoot, 'README.md'))) {
		gaps.push(createGap('missing-readme', 'Missing README', 'README.md is missing, so the high-level repository overview has to fall back to package metadata only.', 'warning', relativePath(workspaceRoot, path.join(workspaceRoot, 'README.md')), ['documentation']));
	}

	if (context.sourceContext === null) {
		gaps.push(createGap('missing-source-context', 'Missing source context index', 'No source-context index could be loaded or refreshed, so module and hotspot mapping may be incomplete.', 'warning', relativePath(workspaceRoot, getSourceContextIndexPath(workspaceRoot)), ['source context']));
	}

	if (!context.ruleEntries.some(entry => entry.id === 'editable-project-constraints' && entry.exists)) {
		gaps.push(createGap('missing-editable-rules', 'Missing editable rules', 'The team-maintained project constraints document is missing, so generated assumptions cannot be explicitly overridden.', 'warning', relativePath(workspaceRoot, getEditableProjectConstraintsPath(workspaceRoot)), ['project constraints']));
	}

	if (!context.documentIndex.some(item => item.id === 'project-design-context' && item.exists)) {
		gaps.push(createGap('missing-project-design-context', 'Missing shared project design context', 'No shared project-level design context exists yet. UI-sensitive stories may need to infer design guidance at execution time.', 'info', relativePath(workspaceRoot, getProjectDesignContextPath(workspaceRoot)), ['design context']));
	}

	if (context.moduleMap.length === 0) {
		gaps.push(createGap('missing-module-map', 'Missing module map', 'No source modules were discovered under src/, so the Agent Map cannot provide module responsibilities yet.', 'warning', 'src/', ['source layout']));
	}

	if (context.projectConstraints.testCommands.length === 0) {
		gaps.push(createGap('missing-test-commands', 'Missing test command coverage', 'Project constraints do not expose any test commands, so execute/checkpoint guidance cannot point to a preferred validation command.', 'info', relativePath(workspaceRoot, getGeneratedProjectConstraintsPath(workspaceRoot)), ['project constraints']));
	}

	return gaps;
}

function createRuleEntry(
	workspaceRoot: string,
	id: string,
	label: string,
	filePath: string,
	category: AgentMapRuleEntry['category'],
	summary: string,
): AgentMapRuleEntry {
	const exists = pathExists(filePath);
	return {
		id,
		label,
		path: relativePath(workspaceRoot, filePath),
		exists,
		category,
		summary,
		sourceSignals: compact([
			exists ? 'repository artifact present' : 'repository artifact missing',
			category,
		]),
	};
}

function createKnowledgeItem(
	workspaceRoot: string,
	id: string,
	label: string,
	filePath: string,
	kind: AgentKnowledgeItem['kind'],
	summary: string,
	requiredFor: string[],
	freshnessTarget: AgentKnowledgeItem['freshnessTarget'],
): AgentKnowledgeItem {
	const exists = pathExists(filePath);
	return {
		id,
		label,
		path: relativePath(workspaceRoot, filePath),
		kind,
		exists,
		summary,
		requiredFor,
		freshnessTarget,
		sourceSignals: compact([kind, freshnessTarget]),
		lastModified: exists ? fs.statSync(filePath).mtime.toISOString() : undefined,
		missingReason: exists ? undefined : `${label} does not exist yet.`,
	};
}

function createGap(
	id: string,
	label: string,
	detail: string,
	severity: AgentMapGap['severity'],
	expectedPath: string,
	sourceSignals: string[],
): AgentMapGap {
	return {
		id,
		label,
		detail,
		severity,
		expectedPath,
		sourceSignals,
	};
}

function readJsonFile<T>(filePath: string): T | null {
	try {
		const content = fs.readFileSync(filePath, 'utf-8');
		return JSON.parse(content) as T;
	} catch {
		return null;
	}
}

function pathExists(filePath: string): boolean {
	return fs.existsSync(filePath);
}

function relativePath(workspaceRoot: string, filePath: string): string {
	return path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
}

function compact(values: Array<string | undefined | null>): string[] {
	return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function firstNonEmpty(values: Array<string | undefined | null>): string | undefined {
	return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
}

function readReadmeSummary(workspaceRoot: string): string | undefined {
	try {
		const content = fs.readFileSync(path.join(workspaceRoot, 'README.md'), 'utf-8');
		return content
			.split(/\r?\n/)
			.map(line => line.trim())
			.find(line => line.length > 0 && !line.startsWith('#'));
	} catch {
		return undefined;
	}
}

function inferPrimaryLanguage(projectConstraints: GeneratedProjectConstraints): string {
	const technologyHint = projectConstraints.technologySummary.find(item => /typescript|javascript|python|go|rust|java/i.test(item));
	if (!technologyHint) {
		return 'Unknown';
	}

	if (/typescript/i.test(technologyHint)) {
		return 'TypeScript';
	}
	if (/javascript/i.test(technologyHint)) {
		return 'JavaScript';
	}
	if (/python/i.test(technologyHint)) {
		return 'Python';
	}
	if (/go/i.test(technologyHint)) {
		return 'Go';
	}
	if (/rust/i.test(technologyHint)) {
		return 'Rust';
	}
	if (/java/i.test(technologyHint)) {
		return 'Java';
	}
	return technologyHint;
}

function humanizeIdentifier(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[-_]+/g, ' ')
		.trim()
		.toLowerCase();
}

function findSourceContextSignal(candidates: string[], needle: string): string | undefined {
	const normalizedNeedle = needle.toLowerCase();
	return candidates.find(candidate => candidate.toLowerCase().includes(normalizedNeedle));
}