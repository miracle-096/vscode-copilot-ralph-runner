import * as fs from 'fs';
import * as path from 'path';
import { generateAgentMapArtifacts } from './agentMap';
import {
	AgentKnowledgeCatalogArtifact,
	AgentMapOverviewArtifact,
	KnowledgeCheckIssue,
	KnowledgeCheckIssueType,
	KnowledgeCheckReport,
	KnowledgeCheckScope,
	UserStory,
} from './types';
import {
	getAgentMapKnowledgeCatalogPath,
	getAgentMapOverviewPath,
	getEditableProjectConstraintsPath,
} from './workspacePaths';

export interface KnowledgeCheckInput {
	scope: KnowledgeCheckScope;
	story?: UserStory;
	promptText?: string;
	changedFiles?: string[];
}

interface LoadedAgentMapArtifacts {
	overview: AgentMapOverviewArtifact;
	knowledgeCatalog: AgentKnowledgeCatalogArtifact;
	overviewPath: string;
	knowledgeCatalogPath: string;
}

interface CoverageHint {
	id: string;
	matchKeywords: string[];
	modules: string[];
	runbookKeywords: string[];
	label: string;
}

const COVERAGE_HINTS: ReadonlyArray<CoverageHint> = [
	{
		id: 'harness-run',
		matchKeywords: ['harness run', 'start execution', '开始执行', '自动执行', 'execution loop'],
		modules: ['extension'],
		runbookKeywords: ['harness: 开始执行', 'start execution', '自动执行', 'execution loop'],
		label: 'Harness run flow',
	},
	{
		id: 'cline-handoff',
		matchKeywords: ['cline handoff', 'prompt handoff', 'prompt injection', '提示词'],
		modules: ['extension', 'projectConstraints', 'promptContext'],
		runbookKeywords: ['cline', 'startnewtask', 'harness handoff'],
		label: 'Cline handoff flow',
	},
	{
		id: 'agent-map',
		matchKeywords: ['agent map', 'knowledge catalog', '知识目录', 'knowledge freshness'],
		modules: ['agentMap'],
		runbookKeywords: ['agent map', 'knowledge catalog', '知识目录'],
		label: 'Agent Map knowledge catalog',
	},
	{
		id: 'policy-gates',
		matchKeywords: ['policy', 'gate', 'advisory', '阻断', '执行检查'],
		modules: ['policyGate'],
		runbookKeywords: ['policy', 'gate', '执行检查', 'policygates'],
		label: 'Policy gate flow',
	},
	{
		id: 'prompt',
		matchKeywords: ['prompt', '提示词', 'context section', '上下文'],
		modules: ['promptContext', 'projectConstraints'],
		runbookKeywords: ['prompt', '提示词', 'cline'],
		label: 'Prompt composition flow',
	},
];

const WORKFLOW_MODULES = new Set(['extension', 'promptContext', 'projectConstraints', 'policyGate', 'agentMap', 'workspacePaths']);

export function createEmptyKnowledgeCheckReport(scope: KnowledgeCheckScope, storyId?: string): KnowledgeCheckReport {
	return {
		generatedAt: new Date().toISOString(),
		scope,
		storyId,
		issues: [],
		relevantModules: [],
		checkedArtifacts: [],
		source: 'cline',
	};
}

export function evaluateKnowledgeCoverage(workspaceRoot: string, input: KnowledgeCheckInput): KnowledgeCheckReport {
	const artifacts = loadAgentMapArtifacts(workspaceRoot);
	const relevantText = buildRelevantText(input);
	const changedFiles = normalizePaths(input.changedFiles ?? []);
	const relevantModules = resolveRelevantModules(workspaceRoot, artifacts.overview, relevantText, changedFiles);
	const issues = [
		...collectStaleDocumentationIssues(workspaceRoot, artifacts, relevantModules, changedFiles),
		...collectMissingModuleKnowledgeIssues(workspaceRoot, artifacts.overview, relevantModules, changedFiles),
		...collectRunbookCoverageIssues(workspaceRoot, artifacts.overview, relevantText, relevantModules),
	];

	return {
		generatedAt: new Date().toISOString(),
		scope: input.scope,
		storyId: input.story?.id,
		issues,
		relevantModules,
		checkedArtifacts: [
			relativePath(workspaceRoot, artifacts.overviewPath),
			relativePath(workspaceRoot, artifacts.knowledgeCatalogPath),
			'README.md',
			relativePath(workspaceRoot, getEditableProjectConstraintsPath(workspaceRoot)),
		],
		source: 'cline',
	};
}

export function summarizeKnowledgeCheckForPrompt(report: KnowledgeCheckReport): string[] {
	if (report.issues.length === 0) {
		return [];
	}

	const lines = [
		`Scope: ${report.scope}`,
		`Checked artifacts: ${report.checkedArtifacts.join(', ')}`,
	];

	if (report.relevantModules.length > 0) {
		lines.push(`Relevant modules: ${report.relevantModules.join(', ')}`);
	}

	for (const issue of report.issues) {
		lines.push(`- [${issue.type}] ${issue.summary}`);
		for (const detail of issue.details) {
			lines.push(`  detail: ${detail}`);
		}
		for (const suggestion of issue.suggestions) {
			lines.push(`  suggest: ${suggestion}`);
		}
	}

	return lines;
}

function loadAgentMapArtifacts(workspaceRoot: string): LoadedAgentMapArtifacts {
	const overviewPath = getAgentMapOverviewPath(workspaceRoot);
	const knowledgeCatalogPath = getAgentMapKnowledgeCatalogPath(workspaceRoot);
	const existingOverview = readJsonFile<AgentMapOverviewArtifact>(overviewPath);
	const existingKnowledgeCatalog = readJsonFile<AgentKnowledgeCatalogArtifact>(knowledgeCatalogPath);

	if (existingOverview && existingKnowledgeCatalog) {
		return {
			overview: existingOverview,
			knowledgeCatalog: existingKnowledgeCatalog,
			overviewPath,
			knowledgeCatalogPath,
		};
	}

	const generated = generateAgentMapArtifacts(workspaceRoot);
	return {
		overview: generated.overview,
		knowledgeCatalog: generated.knowledgeCatalog,
		overviewPath: generated.overviewPath,
		knowledgeCatalogPath: generated.knowledgeCatalogPath,
	};
}

function buildRelevantText(input: KnowledgeCheckInput): string {
	const parts: string[] = [];
	if (input.story) {
		parts.push(input.story.title, input.story.description, ...(input.story.acceptanceCriteria ?? []));
	}
	if (input.promptText) {
		parts.push(input.promptText);
	}
	return parts.join('\n').toLowerCase();
}

function resolveRelevantModules(
	workspaceRoot: string,
	overview: AgentMapOverviewArtifact,
	relevantText: string,
	changedFiles: string[],
): string[] {
	const moduleIds = new Set<string>();

	for (const filePath of changedFiles) {
		const normalized = normalizePath(filePath);
		const moduleMatch = normalized.match(/^src\/([^/]+)\.ts$/i);
		if (moduleMatch) {
			moduleIds.add(moduleMatch[1]);
		}
	}

	for (const moduleEntry of overview.moduleMap) {
		const directSignals = [moduleEntry.id, moduleEntry.label.toLowerCase(), moduleEntry.path.toLowerCase()];
		if (directSignals.some(signal => relevantText.includes(signal.toLowerCase()))) {
			moduleIds.add(moduleEntry.id);
		}
	}

	for (const hint of COVERAGE_HINTS) {
		if (hint.matchKeywords.some(keyword => relevantText.includes(keyword.toLowerCase()))) {
			for (const moduleId of hint.modules) {
				moduleIds.add(moduleId);
			}
		}
	}

	return Array.from(moduleIds)
		.filter(moduleId => overview.moduleMap.some(entry => entry.id === moduleId) || pathExists(path.join(workspaceRoot, 'src', `${moduleId}.ts`)))
		.sort((left, right) => left.localeCompare(right));
}

function collectStaleDocumentationIssues(
	workspaceRoot: string,
	artifacts: LoadedAgentMapArtifacts,
	relevantModules: string[],
	changedFiles: string[],
): KnowledgeCheckIssue[] {
	const knowledgeCatalogTimestamp = Date.parse(artifacts.knowledgeCatalog.generatedAt || '') || getTimestamp(artifacts.knowledgeCatalogPath) || 0;
	const readmePath = path.join(workspaceRoot, 'README.md');
	const readmeTimestamp = getTimestamp(readmePath) ?? 0;
	const relevantSourceFiles = changedFiles.length > 0
		? changedFiles.map(filePath => path.join(workspaceRoot, filePath))
		: relevantModules.map(moduleId => path.join(workspaceRoot, 'src', `${moduleId}.ts`));
	const fresherFiles = relevantSourceFiles
		.map(filePath => ({ filePath, timestamp: getTimestamp(filePath) ?? 0 }))
		.filter(entry => entry.timestamp > knowledgeCatalogTimestamp);

	if (fresherFiles.length === 0 && (!readmeTimestamp || relevantModules.every(moduleId => !WORKFLOW_MODULES.has(moduleId)))) {
		return [];
	}

	const staleDetails: string[] = [];
	if (fresherFiles.length > 0) {
		staleDetails.push(`Knowledge catalog was generated before these relevant files changed: ${fresherFiles.map(entry => relativePath(workspaceRoot, entry.filePath)).join(', ')}.`);
	}
	if (readmeTimestamp > 0 && fresherFiles.some(entry => entry.timestamp > readmeTimestamp) && relevantModules.some(moduleId => WORKFLOW_MODULES.has(moduleId))) {
		staleDetails.push('README.md is older than the relevant workflow modules, so operator-facing guidance may lag behind the implementation.');
	}

	if (staleDetails.length === 0) {
		return [];
	}

	return [createIssue(
		'stale-docs',
		'stale-documentation',
		'warning',
		'Knowledge catalog or runbook documentation looks stale for the current change surface.',
		staleDetails,
		[
			'Regenerate .harness-runner/agent-map/overview.json and knowledge-catalog.json after the workflow change settles.',
			'Update README.md or other operator-facing guidance if the run flow, Cline handoff flow, or delivery expectations changed.',
		],
		relevantSourceFiles.map(filePath => relativePath(workspaceRoot, filePath)),
	)];
}

function collectMissingModuleKnowledgeIssues(
	workspaceRoot: string,
	overview: AgentMapOverviewArtifact,
	relevantModules: string[],
	changedFiles: string[],
): KnowledgeCheckIssue[] {
	const details: string[] = [];
	const relatedPaths: string[] = [];

	for (const moduleId of relevantModules) {
		const moduleEntry = overview.moduleMap.find(entry => entry.id === moduleId);
		if (!moduleEntry) {
			details.push(`No Agent Map module entry exists yet for ${moduleId}.`);
			relatedPaths.push(`src/${moduleId}.ts`);
			continue;
		}

		if (moduleEntry.gaps.length > 0 || moduleEntry.sourceSignals.length === 0) {
			details.push(`${moduleEntry.path}: ${moduleEntry.gaps[0] ?? 'No supporting source signals were captured for this module.'}`);
			relatedPaths.push(moduleEntry.path);
		}
	}

	for (const filePath of changedFiles) {
		const normalized = normalizePath(filePath);
		const moduleMatch = normalized.match(/^src\/([^/]+)\.ts$/i);
		if (!moduleMatch) {
			continue;
		}
		if (!overview.moduleMap.some(entry => entry.id === moduleMatch[1])) {
			details.push(`Changed module ${normalized} is not represented in the current Agent Map module catalog.`);
			relatedPaths.push(normalized);
		}
	}

	if (details.length === 0) {
		return [];
	}

	return [createIssue(
		'missing-module-knowledge',
		'missing-module-knowledge',
		'warning',
		'Relevant modules do not have strong enough knowledge coverage in the current Agent Map.',
		details,
		[
			'Refresh the source context index and regenerate the Agent Map so the changed modules have explicit signals.',
			'If the module is new or materially repurposed, add a short README or rule note that explains its responsibility and workflow impact.',
		],
		relatedPaths,
	)];
}

function collectRunbookCoverageIssues(
	workspaceRoot: string,
	overview: AgentMapOverviewArtifact,
	relevantText: string,
	relevantModules: string[],
): KnowledgeCheckIssue[] {
	const readmePath = path.join(workspaceRoot, 'README.md');
	if (!pathExists(readmePath)) {
		return [createIssue(
			'missing-runbook-readme',
			'missing-runbook-coverage',
			'warning',
			'Runbook coverage is missing because README.md does not exist.',
			['README.md is missing, so there is no operator-facing place to explain how the current workflow should be used.'],
			['Add README guidance for the affected workflow, commands, and expected artifacts.'],
			['README.md'],
		)];
	}

	const readmeContent = fs.readFileSync(readmePath, 'utf-8').toLowerCase();
	const runbookCorpus = [
		readmeContent,
		...overview.runbook.flatMap(step => [step.title, step.summary, ...step.commands, ...step.outputs, ...step.inputs]),
	].join('\n').toLowerCase();
	const missingAreas: string[] = [];

	for (const hint of COVERAGE_HINTS) {
		const hintIsRelevant = hint.modules.some(moduleId => relevantModules.includes(moduleId))
			|| hint.matchKeywords.some(keyword => relevantText.includes(keyword.toLowerCase()));
		if (!hintIsRelevant) {
			continue;
		}

		const covered = hint.runbookKeywords.some(keyword => runbookCorpus.includes(keyword.toLowerCase()));
		if (!covered) {
			missingAreas.push(`${hint.label} is not clearly covered by README.md or the generated runbook keywords.`);
		}
	}

	if (missingAreas.length === 0) {
		return [];
	}

	return [createIssue(
		'missing-runbook-coverage',
		'missing-runbook-coverage',
		'warning',
		'Operator-facing runbook coverage does not fully describe the current change surface.',
		missingAreas,
		[
			'Extend README.md with the commands, artifacts, and expected advisory/gate behavior for this workflow area.',
			'Regenerate the Agent Map after updating the runbook so downstream checks see the refreshed coverage.',
		],
		['README.md', '.harness-runner/agent-map/overview.json'],
	)];
}

function createIssue(
	id: string,
	type: KnowledgeCheckIssueType,
	severity: KnowledgeCheckIssue['severity'],
	summary: string,
	details: string[],
	suggestions: string[],
	relatedPaths: string[],
): KnowledgeCheckIssue {
	return {
		id,
		type,
		severity,
		summary,
		details,
		suggestions,
		relatedPaths: Array.from(new Set(relatedPaths.map(normalizePath))).filter(item => item.length > 0),
	};
}

function readJsonFile<T>(filePath: string): T | null {
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
	} catch {
		return null;
	}
}

function normalizePaths(value: string[]): string[] {
	return Array.from(new Set(value.map(normalizePath).filter(item => item.length > 0)));
}

function normalizePath(value: string): string {
	return value.replace(/\\/g, '/').trim();
}

function pathExists(filePath: string): boolean {
	return fs.existsSync(filePath);
}

function getTimestamp(filePath: string): number | undefined {
	try {
		return fs.statSync(filePath).mtimeMs;
	} catch {
		return undefined;
	}
}

function relativePath(workspaceRoot: string, targetPath: string): string {
	const normalizedRoot = normalizePath(path.resolve(workspaceRoot));
	const normalizedTarget = normalizePath(path.resolve(targetPath));
	if (!normalizedTarget.startsWith(normalizedRoot)) {
		return normalizedTarget;
	}
	return normalizePath(path.relative(workspaceRoot, targetPath));
}