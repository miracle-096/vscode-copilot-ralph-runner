export interface PrdFile {
	project: string;
	branchName: string;
	description: string;
	userStories: UserStory[];
	[key: string]: unknown;
}

export interface UserStory {
	id: string;
	title: string;
	description: string;
	acceptanceCriteria: string[];
	priority: number;
	status?: string;
	[key: string]: unknown;
}

export type StoryExecutionStatus = '未开始' | 'inprogress' | 'completed' | 'failed';

export const STORY_STATUSES: StoryExecutionStatus[] = ['未开始', 'inprogress', 'completed', 'failed'];

export type ExecutionCheckpointStatus = 'completed' | 'failed' | 'interrupted';

export const EXECUTION_CHECKPOINT_STATUSES: ExecutionCheckpointStatus[] = ['completed', 'failed', 'interrupted'];

export interface GeneratedProjectConstraints {
	version: number;
	generatedAt: string;
	technologySummary: string[];
	buildCommands: string[];
	testCommands: string[];
	lintCommands: string[];
	styleRules: string[];
	gitRules: string[];
	architectureRules: string[];
	allowedPaths: string[];
	forbiddenPaths: string[];
	reuseHints: string[];
	deliveryChecklist: string[];
	metadata?: Record<string, unknown>;
}

export interface EditableProjectConstraints {
	title: string;
	lastUpdated?: string;
	sections: EditableProjectConstraintSection[];
}

export interface EditableProjectConstraintSection {
	heading: string;
	items: string[];
}

export type DesignContextScope = 'project' | 'screen' | 'module' | 'story';

export interface DesignContextArtifact {
	storyId: string;
	scope?: DesignContextScope;
	scopeId?: string;
	inheritsFrom?: string[];
	sourceType: 'figma' | 'screenshots' | 'notes';
	figmaUrl?: string;
	screenshotPaths: string[];
	manualNotes: string[];
	referenceDocs: string[];
	summary: string;
	pageOrScreenName?: string;
	layoutConstraints: string[];
	componentReuseTargets: string[];
	tokenRules: string[];
	responsiveRules: string[];
	doNotChange: string[];
	acceptanceChecks: string[];
	updatedAt: string;
}

export interface TaskMemoryArtifact {
	storyId: string;
	title: string;
	summary: string;
	changedFiles: string[];
	changedModules: string[];
	keyDecisions: string[];
	patternsUsed: string[];
	constraintsConfirmed: string[];
	testsRun: string[];
	risks: string[];
	followUps: string[];
	searchKeywords: string[];
	relatedStories: string[];
	createdAt: string;
	source?: 'copilot' | 'synthesized';
}

export interface ExecutionCheckpointArtifact {
	storyId: string;
	title: string;
	status: ExecutionCheckpointStatus;
	stageGoal: string;
	summary: string;
	keyDecisions: string[];
	confirmedConstraints: string[];
	unresolvedRisks: string[];
	nextStoryPrerequisites: string[];
	resumeRecommendation: string;
	updatedAt: string;
	source?: 'copilot' | 'synthesized';
}

export interface SourceContextIndexArtifact {
	version: number;
	generatedAt: string;
	workspaceRootName: string;
	sourceDirectories: string[];
	testDirectories: string[];
	buildScripts: string[];
	keyEntryFiles: string[];
	reusableModuleHints: string[];
	typeDefinitionHints: string[];
	hotspotPaths: string[];
	metadata?: Record<string, unknown>;
}

export interface SourceContextRecallMatch {
	label: string;
	category: 'source-directory' | 'test-directory' | 'build-script' | 'entry-file' | 'module-hint' | 'type-hint' | 'hotspot';
	value: string;
	score: number;
	reasons: string[];
	keywordOverlap: string[];
	moduleOverlap: string[];
	fileOverlap: string[];
}

export interface TaskMemoryIndexEntry {
	storyId: string;
	title: string;
	changedFiles: string[];
	changedModules: string[];
	searchKeywords: string[];
	relatedStories: string[];
	createdAt: string;
	memoryPath: string;
}

export interface TaskMemoryIndex {
	version: number;
	updatedAt: string;
	entries: TaskMemoryIndexEntry[];
}

export interface PromptSection {
	title: string;
	lines: string[];
	omitWhenEmpty?: boolean;
}

export interface StoryPromptContext {
	story: UserStory;
	workspaceRoot: string;
	projectConstraintsLines?: string[];
	designContextLines?: string[];
	priorWorkLines?: string[];
	sourceContextLines?: string[];
	recentCheckpointLines?: string[];
	policyLines?: string[];
	taskMemoryPath: string;
	executionCheckpointPath: string;
	completionSignalPath: string;
	additionalExecutionRules?: string[];
}

export type PolicyGatePhase = 'preflight' | 'completion';

export type PolicyArtifactKind =
	| 'project-constraints'
	| 'design-context'
	| 'task-memory'
	| 'execution-checkpoint'
	| 'source-context-index';

export type PolicyRuleCondition = 'always' | 'story.designSensitive';

export type PolicyCommandSource = 'projectConstraints.testCommands' | 'projectConstraints.buildCommands';

export interface PolicyRuleBase {
	id: string;
	title: string;
	phase: PolicyGatePhase;
	type: 'required-artifact' | 'restricted-paths' | 'require-command';
	enabled?: boolean;
	when?: PolicyRuleCondition;
}

export interface RequiredArtifactPolicyRule extends PolicyRuleBase {
	type: 'required-artifact';
	artifact: PolicyArtifactKind;
}

export interface RestrictedPathsPolicyRule extends PolicyRuleBase {
	type: 'restricted-paths';
	paths: string[];
}

export interface RequireCommandPolicyRule extends PolicyRuleBase {
	type: 'require-command';
	commands?: string[];
	commandsFrom?: PolicyCommandSource;
	minSuccesses?: number;
	filePatterns?: string[];
}

export type PolicyRule = RequiredArtifactPolicyRule | RestrictedPathsPolicyRule | RequireCommandPolicyRule;

export interface RalphPolicyConfig {
	enabled: boolean;
	preflightRules: PolicyRule[];
	completionRules: PolicyRule[];
}

export interface PolicyViolation {
	ruleId: string;
	title: string;
	phase: PolicyGatePhase;
	summary: string;
	details: string[];
	nextSteps: string[];
}

export interface PolicyCommandExecutionResult {
	command: string;
	success: boolean;
	output: string;
}

export interface PolicyEvaluationResult {
	ok: boolean;
	violations: PolicyViolation[];
	executedCommands: PolicyCommandExecutionResult[];
}

export interface PolicyBaselineArtifact {
	storyId: string;
	capturedAt: string;
	changedFiles: string[];
}

export function normalizeStoryExecutionStatus(value: unknown): StoryExecutionStatus | undefined {
	if (value === 'completed' || value === 'inprogress' || value === 'failed' || value === '未开始') {
		return value;
	}
	if (value === 'not-started') {
		return '未开始';
	}
	return undefined;
}