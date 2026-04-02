import { execSync } from 'child_process';
import * as fs from 'fs';
import {
	GeneratedProjectConstraints,
	PolicyArtifactKind,
	PolicyBaselineArtifact,
	PolicyCommandExecutionResult,
	PolicyEvaluationResult,
	PolicyGatePhase,
	PolicyRule,
	PolicyRuleCondition,
	RalphPolicyConfig,
	UserStory,
} from './types';
import {
	ensurePolicyBaselineDirectory,
	getPolicyBaselinePath,
} from './workspacePaths';

export interface LegacyPolicyCompatibilityOptions {
	requireProjectConstraintsBeforeRun: boolean;
	requireDesignContextForTaggedStories: boolean;
}

export interface PolicyEvaluationContext {
	workspaceRoot: string;
	story: UserStory;
	phase: PolicyGatePhase;
	changedFiles?: string[];
	projectConstraints: GeneratedProjectConstraints | null;
	isDesignSensitiveStory: boolean;
	hasExecutionTimeDesignFallback?: boolean;
	hasArtifact: (artifact: PolicyArtifactKind) => boolean;
	commandTimeoutMs?: number;
	commandRunner?: (command: string, workspaceRoot: string, timeoutMs: number) => PolicyCommandExecutionResult;
	artifactPaths?: Partial<Record<PolicyArtifactKind, string>>;
}

const DEFAULT_POLICY_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_DANGEROUS_PATHS = [
	'prd.json',
	'.prd/**',
	'dist/**',
	'build/**',
	'out/**',
	'coverage/**',
	'node_modules/**',
	'.next/**',
	'.nuxt/**',
];

export function createDefaultPolicyConfig(): RalphPolicyConfig {
	return {
		enabled: false,
		preflightRules: [
			{
				id: 'require-project-constraints',
				title: 'Require project constraints before execution',
				phase: 'preflight',
				type: 'required-artifact',
				artifact: 'project-constraints',
				enabled: false,
				when: 'always',
			},
			{
				id: 'require-design-context',
				title: 'Require design context for design-sensitive stories',
				phase: 'preflight',
				type: 'required-artifact',
				artifact: 'design-context',
				enabled: false,
				when: 'story.designSensitive',
			},
		],
		completionRules: [
			{
				id: 'protect-dangerous-paths',
				title: 'Block dangerous path edits',
				phase: 'completion',
				type: 'restricted-paths',
				paths: DEFAULT_DANGEROUS_PATHS,
				enabled: true,
				when: 'always',
			},
			{
				id: 'require-relevant-tests',
				title: 'Require at least one relevant test command',
				phase: 'completion',
				type: 'require-command',
				commandsFrom: 'projectConstraints.testCommands',
				minSuccesses: 1,
				filePatterns: ['src/**', 'package.json', 'eslint.config.*', 'tsconfig.json'],
				enabled: false,
				when: 'always',
			},
			{
				id: 'require-task-memory-artifact',
				title: 'Require task memory artifact before completion',
				phase: 'completion',
				type: 'required-artifact',
				artifact: 'task-memory',
				enabled: true,
				when: 'always',
			},
			{
				id: 'require-execution-checkpoint-artifact',
				title: 'Require execution checkpoint before completion',
				phase: 'completion',
				type: 'required-artifact',
				artifact: 'execution-checkpoint',
				enabled: true,
				when: 'always',
			},
		],
	};
}

export function normalizePolicyConfig(value: unknown): RalphPolicyConfig {
	const fallback = createDefaultPolicyConfig();
	const input = isRecord(value) ? value : {};
	return {
		enabled: input.enabled === true,
		preflightRules: normalizePolicyRules(input.preflightRules, 'preflight', fallback.preflightRules),
		completionRules: normalizePolicyRules(input.completionRules, 'completion', fallback.completionRules),
	};
}

export function buildEffectivePolicyConfig(
	value: unknown,
	compatibility: LegacyPolicyCompatibilityOptions,
): RalphPolicyConfig {
	const normalized = normalizePolicyConfig(value);
	const preflightRules = [...normalized.preflightRules];

	if (compatibility.requireProjectConstraintsBeforeRun) {
		upsertPolicyRule(preflightRules, {
			id: 'legacy-require-project-constraints',
			title: 'Legacy project constraints requirement',
			phase: 'preflight',
			type: 'required-artifact',
			artifact: 'project-constraints',
			enabled: true,
			when: 'always',
		});
	}

	if (compatibility.requireDesignContextForTaggedStories) {
		upsertPolicyRule(preflightRules, {
			id: 'legacy-require-design-context',
			title: 'Legacy design-context requirement',
			phase: 'preflight',
			type: 'required-artifact',
			artifact: 'design-context',
			enabled: true,
			when: 'story.designSensitive',
		});
	}

	return {
		enabled: normalized.enabled,
		preflightRules,
		completionRules: normalized.completionRules,
	};
}

export function summarizePolicyConfigForPrompt(config: RalphPolicyConfig): string[] {
	if (!config.enabled) {
		return [];
	}

	const lines: string[] = [];
	for (const phase of ['preflight', 'completion'] as const) {
		const activeRules = (phase === 'preflight' ? config.preflightRules : config.completionRules)
			.filter(rule => rule.enabled !== false);
		if (activeRules.length === 0) {
			continue;
		}

		lines.push(phase === 'preflight' ? 'Preflight Gates' : 'Completion Gates');
		for (const rule of activeRules) {
			lines.push(`- ${describePolicyRule(rule)}`);
		}
		lines.push('');
	}

	return lines;
}

export function evaluatePolicyGates(config: RalphPolicyConfig, context: PolicyEvaluationContext): PolicyEvaluationResult {
	if (!config.enabled) {
		return { ok: true, violations: [], executedCommands: [] };
	}

	const rules = (context.phase === 'preflight' ? config.preflightRules : config.completionRules)
		.filter(rule => rule.enabled !== false)
		.filter(rule => matchesPolicyCondition(rule.when ?? 'always', context));

	const executedCommands: PolicyCommandExecutionResult[] = [];
	const violations = rules.flatMap(rule => evaluatePolicyRule(rule, context, executedCommands));

	return {
		ok: violations.length === 0,
		violations,
		executedCommands,
	};
}

export function summarizePolicyViolations(result: PolicyEvaluationResult): string[] {
	if (result.violations.length === 0) {
		return [];
	}

	const lines: string[] = [];
	for (const violation of result.violations) {
		lines.push(`- ${violation.summary}`);
		for (const detail of violation.details) {
			lines.push(`  detail: ${detail}`);
		}
		for (const nextStep of violation.nextSteps) {
			lines.push(`  next: ${nextStep}`);
		}
	}
	return lines;
}

export function writePolicyBaseline(workspaceRoot: string, storyId: string, changedFiles: string[]): string {
	ensurePolicyBaselineDirectory(workspaceRoot);
	const filePath = getPolicyBaselinePath(workspaceRoot, storyId);
	const artifact: PolicyBaselineArtifact = {
		storyId,
		capturedAt: new Date().toISOString(),
		changedFiles: normalizeFileList(changedFiles),
	};
	fs.writeFileSync(filePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf-8');
	return filePath;
}

export function readPolicyBaseline(workspaceRoot: string, storyId: string): PolicyBaselineArtifact | null {
	try {
		const content = fs.readFileSync(getPolicyBaselinePath(workspaceRoot, storyId), 'utf-8');
		const parsed = JSON.parse(content) as Partial<PolicyBaselineArtifact>;
		return {
			storyId,
			capturedAt: typeof parsed.capturedAt === 'string' ? parsed.capturedAt : new Date(0).toISOString(),
			changedFiles: normalizeFileList(parsed.changedFiles),
		};
	} catch {
		return null;
	}
}

export function clearPolicyBaseline(workspaceRoot: string, storyId: string): void {
	try {
		const filePath = getPolicyBaselinePath(workspaceRoot, storyId);
		if (fs.existsSync(filePath)) {
			fs.unlinkSync(filePath);
		}
	} catch {
		// ignore cleanup failures
	}
}

export function deriveStoryChangedFiles(currentChangedFiles: string[], baseline: PolicyBaselineArtifact | null): string[] {
	const current = normalizeFileList(currentChangedFiles);
	if (!baseline) {
		return current;
	}

	const baselineSet = new Set(normalizeFileList(baseline.changedFiles));
	return current.filter(filePath => !baselineSet.has(filePath));
}

function normalizePolicyRules(value: unknown, phase: PolicyGatePhase, fallbackRules: PolicyRule[]): PolicyRule[] {
	if (!Array.isArray(value)) {
		return fallbackRules.map(rule => ({ ...rule }));
	}

	const rules = value
		.map(rule => normalizePolicyRule(rule, phase))
		.filter((rule): rule is PolicyRule => Boolean(rule));

	return rules.length > 0 ? rules : fallbackRules.map(rule => ({ ...rule }));
}

function normalizePolicyRule(value: unknown, phase: PolicyGatePhase): PolicyRule | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const id = typeof value.id === 'string' && value.id.trim().length > 0 ? value.id.trim() : undefined;
	const title = typeof value.title === 'string' && value.title.trim().length > 0 ? value.title.trim() : undefined;
	const when = normalizePolicyCondition(value.when);
	const enabled = value.enabled !== false;
	const type = value.type;

	if (!id || !title || (type !== 'required-artifact' && type !== 'restricted-paths' && type !== 'require-command')) {
		return undefined;
	}

	if (type === 'required-artifact') {
		const artifact = normalizePolicyArtifact(value.artifact);
		if (!artifact) {
			return undefined;
		}
		return { id, title, phase, type, artifact, enabled, when };
	}

	if (type === 'restricted-paths') {
		const paths = normalizeStringArray(value.paths);
		if (paths.length === 0) {
			return undefined;
		}
		return { id, title, phase, type, paths, enabled, when };
	}

	const commands = normalizeStringArray(value.commands);
	const commandsFrom = value.commandsFrom === 'projectConstraints.testCommands' || value.commandsFrom === 'projectConstraints.buildCommands'
		? value.commandsFrom
		: undefined;
	if (commands.length === 0 && !commandsFrom) {
		return undefined;
	}
	return {
		id,
		title,
		phase,
		type,
		commands,
		commandsFrom,
		minSuccesses: typeof value.minSuccesses === 'number' && value.minSuccesses > 0 ? Math.floor(value.minSuccesses) : 1,
		filePatterns: normalizeStringArray(value.filePatterns),
		enabled,
		when,
	};
}

function normalizePolicyCondition(value: unknown): PolicyRuleCondition {
	return value === 'story.designSensitive' ? 'story.designSensitive' : 'always';
}

function normalizePolicyArtifact(value: unknown): PolicyArtifactKind | undefined {
	if (
		value === 'project-constraints'
		|| value === 'design-context'
		|| value === 'task-memory'
		|| value === 'execution-checkpoint'
		|| value === 'source-context-index'
	) {
		return value;
	}
	return undefined;
}

function upsertPolicyRule(target: PolicyRule[], rule: PolicyRule): void {
	if (target.some(existing => existing.id === rule.id)) {
		return;
	}
	target.push(rule);
}

function evaluatePolicyRule(
	rule: PolicyRule,
	context: PolicyEvaluationContext,
	executedCommands: PolicyCommandExecutionResult[],
): ReturnType<typeof createViolation>[] {
	if (rule.type === 'required-artifact') {
		return evaluateRequiredArtifactRule(rule, context);
	}

	if (rule.type === 'restricted-paths') {
		return evaluateRestrictedPathsRule(rule, context);
	}

	return evaluateRequireCommandRule(rule, context, executedCommands);
}

function evaluateRequiredArtifactRule(rule: Extract<PolicyRule, { type: 'required-artifact'; }>, context: PolicyEvaluationContext) {
	if (rule.artifact === 'design-context') {
		if (context.hasArtifact('design-context') || context.hasExecutionTimeDesignFallback) {
			return [];
		}
	} else if (context.hasArtifact(rule.artifact)) {
		return [];
	}

	const artifactPath = context.artifactPaths?.[rule.artifact];
	return [createViolation(
		rule,
		`${rule.title} blocked ${context.story.id}.`,
		[
			`Missing required artifact: ${formatArtifactName(rule.artifact)}.`,
			...(artifactPath ? [`Expected artifact path: ${artifactPath}`] : []),
		],
		getArtifactNextSteps(rule.artifact),
	)];
}

function evaluateRestrictedPathsRule(rule: Extract<PolicyRule, { type: 'restricted-paths'; }>, context: PolicyEvaluationContext) {
	const changedFiles = normalizeFileList(context.changedFiles);
	if (changedFiles.length === 0) {
		return [];
	}

	const blockedFiles = changedFiles.filter(filePath => rule.paths.some(pattern => matchesGlob(filePath, pattern)));
	if (blockedFiles.length === 0) {
		return [];
	}

	return [createViolation(
		rule,
		`${rule.title} blocked completion for ${context.story.id}.`,
		[
			`Blocked changed paths: ${blockedFiles.join(', ')}`,
			`Policy patterns: ${rule.paths.join(', ')}`,
		],
		[
			'Revert or relocate the blocked edits before marking the story complete.',
			'If the task genuinely requires touching these paths, update the policy config explicitly instead of relying on prompt-only guidance.',
		],
	)];
}

function evaluateRequireCommandRule(
	rule: Extract<PolicyRule, { type: 'require-command'; }>,
	context: PolicyEvaluationContext,
	executedCommands: PolicyCommandExecutionResult[],
) {
	const changedFiles = normalizeFileList(context.changedFiles);
	if (rule.filePatterns && rule.filePatterns.length > 0 && changedFiles.length > 0) {
		const matchesAnyPattern = changedFiles.some(filePath => rule.filePatterns?.some(pattern => matchesGlob(filePath, pattern)));
		if (!matchesAnyPattern) {
			return [];
		}
	}

	const commands = resolvePolicyCommands(rule, context.projectConstraints);
	if (commands.length === 0) {
		return [createViolation(
			rule,
			`${rule.title} could not run for ${context.story.id}.`,
			['No runnable commands were resolved for this policy.'],
			['Add explicit commands to the policy rule or initialize project constraints with test/build commands.'],
		)];
	}

	const minSuccesses = rule.minSuccesses ?? 1;
	let successCount = 0;
	for (const command of commands) {
		const result = runPolicyCommand(command, context);
		executedCommands.push(result);
		if (result.success) {
			successCount += 1;
			if (successCount >= minSuccesses) {
				return [];
			}
		}
	}

	return [createViolation(
		rule,
		`${rule.title} blocked completion for ${context.story.id}.`,
		[
			`Required command successes: ${minSuccesses}.`,
			`Resolved commands: ${commands.join(' | ')}`,
			...executedCommands.slice(-commands.length).map(result => `${result.success ? 'PASS' : 'FAIL'} ${result.command}${result.output ? ` -> ${truncateOutput(result.output)}` : ''}`),
		],
		[
			'Fix the failing test/build command output and rerun the story.',
			`At least ${minSuccesses} command(s) from this policy must pass before completion can be accepted.`,
		],
	)];
}

function resolvePolicyCommands(rule: Extract<PolicyRule, { type: 'require-command'; }>, constraints: GeneratedProjectConstraints | null): string[] {
	const commands = [...(rule.commands ?? [])];
	if (rule.commandsFrom === 'projectConstraints.testCommands') {
		commands.push(...(constraints?.testCommands ?? []));
	}
	if (rule.commandsFrom === 'projectConstraints.buildCommands') {
		commands.push(...(constraints?.buildCommands ?? []));
	}
	return Array.from(new Set(commands.map(command => command.trim()).filter(command => command.length > 0)));
}

function runPolicyCommand(command: string, context: PolicyEvaluationContext): PolicyCommandExecutionResult {
	const timeoutMs = context.commandTimeoutMs ?? DEFAULT_POLICY_COMMAND_TIMEOUT_MS;
	if (context.commandRunner) {
		return context.commandRunner(command, context.workspaceRoot, timeoutMs);
	}

	try {
		const output = execSync(command, {
			cwd: context.workspaceRoot,
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'pipe'],
			timeout: timeoutMs,
			windowsHide: true,
		});
		return {
			command,
			success: true,
			output: output.trim(),
		};
	} catch (error: unknown) {
		const output = extractCommandErrorOutput(error);
		return {
			command,
			success: false,
			output,
		};
	}
}

function createViolation(rule: PolicyRule, summary: string, details: string[], nextSteps: string[]) {
	return {
		ruleId: rule.id,
		title: rule.title,
		phase: rule.phase,
		summary,
		details,
		nextSteps,
	};
}

function matchesPolicyCondition(condition: PolicyRuleCondition, context: PolicyEvaluationContext): boolean {
	if (condition === 'story.designSensitive') {
		return context.isDesignSensitiveStory;
	}
	return true;
}

function describePolicyRule(rule: PolicyRule): string {
	if (rule.type === 'required-artifact') {
		return `${rule.title} (${formatArtifactName(rule.artifact)})`;
	}
	if (rule.type === 'restricted-paths') {
		return `${rule.title} (${rule.paths.join(', ')})`;
	}
	return `${rule.title} (${rule.commandsFrom ?? (rule.commands ?? []).join(', ')})`;
}

function formatArtifactName(artifact: PolicyArtifactKind): string {
	return artifact.replace(/-/g, ' ');
}

function getArtifactNextSteps(artifact: PolicyArtifactKind): string[] {
	if (artifact === 'project-constraints') {
		return ['Run the project-constraints initialization flow before starting the story.'];
	}
	if (artifact === 'design-context') {
		return ['Record or link UI design context for this design-sensitive story before execution.'];
	}
	if (artifact === 'task-memory') {
		return ['Persist a valid task memory artifact before writing the completion signal.'];
	}
	if (artifact === 'execution-checkpoint') {
		return ['Persist a valid execution checkpoint artifact before writing the completion signal.'];
	}
	return ['Generate the missing artifact before continuing.'];
}

function matchesGlob(filePath: string, pattern: string): boolean {
	const normalizedFile = normalizePath(filePath);
	const normalizedPattern = normalizePath(pattern);
	const regex = new RegExp(`^${globToRegexSource(normalizedPattern)}$`);
	return regex.test(normalizedFile);
}

function globToRegexSource(pattern: string): string {
	let source = '';
	for (let index = 0; index < pattern.length; index += 1) {
		const char = pattern[index];
		if (char === '*') {
			const nextChar = pattern[index + 1];
			if (nextChar === '*') {
				source += '.*';
				index += 1;
				continue;
			}
			source += '[^/]*';
			continue;
		}

		if ('\\^$+?.()|{}[]'.includes(char)) {
			source += `\\${char}`;
			continue;
		}

		source += char;
	}

	return source;
}

function normalizeFileList(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return Array.from(new Set(value
		.filter((item): item is string => typeof item === 'string')
		.map(item => normalizePath(item))
		.filter(item => item.length > 0)));
}

function normalizeStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return Array.from(new Set(value
		.filter((item): item is string => typeof item === 'string')
		.map(item => item.trim())
		.filter(item => item.length > 0)));
}

function normalizePath(value: string): string {
	return value.replace(/\\/g, '/').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractCommandErrorOutput(error: unknown): string {
	if (error && typeof error === 'object') {
		const stderr = 'stderr' in error ? String(error.stderr ?? '') : '';
		const stdout = 'stdout' in error ? String(error.stdout ?? '') : '';
		const message = 'message' in error ? String(error.message ?? '') : '';
		return [stderr, stdout, message].map(part => part.trim()).filter(part => part.length > 0).join('\n').trim();
	}
	return String(error ?? '').trim();
}

function truncateOutput(output: string): string {
	return output.length > 180 ? `${output.slice(0, 177)}...` : output;
}