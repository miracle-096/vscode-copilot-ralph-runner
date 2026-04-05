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

export type StoryExecutionStatus = '未开始' | 'inprogress' | 'pendingReview' | 'pendingRelease' | 'completed' | 'failed';

export const STORY_STATUSES: StoryExecutionStatus[] = ['未开始', 'inprogress', 'pendingReview', 'pendingRelease', 'completed', 'failed'];

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
	architectureNotes: string[];
	keyDecisions: string[];
	patternsUsed: string[];
	constraintsConfirmed: string[];
	testsRun: string[];
	risks: string[];
	followUps: string[];
	searchKeywords: string[];
	relatedStories: string[];
	reviewSummary?: StoryReviewResult;
	reviewLoop?: StoryReviewLoopState;
	createdAt: string;
	source?: 'cline' | 'synthesized';
}

export interface ExecutionCheckpointArtifact {
	storyId: string;
	title: string;
	status: ExecutionCheckpointStatus;
	stageGoal: string;
	summary: string;
	architectureNotes: string[];
	keyDecisions: string[];
	confirmedConstraints: string[];
	unresolvedRisks: string[];
	nextStoryPrerequisites: string[];
	resumeRecommendation: string;
	reviewSummary?: StoryReviewResult;
	reviewLoop?: StoryReviewLoopState;
	updatedAt: string;
	source?: 'cline' | 'synthesized';
}

export type StoryReviewDimensionId = 'architectureConsistency' | 'acceptanceCoverage' | 'changeScopeControl' | 'verifiability';

export interface StoryReviewDimensionScore {
	dimension: StoryReviewDimensionId;
	label: string;
	score: number;
	summary: string;
	issues: string[];
	recommendations: string[];
}

export type StoryReviewLoopEndedReason = 'passed' | 'max-rounds';

export interface StoryReviewResult {
	totalScore: number;
	maxScore: number;
	passingScore: number;
	passed: boolean;
	reviewPass: number;
	maxReviewerPasses: number;
	maxAutoRefactorRounds: number;
	dimensions: StoryReviewDimensionScore[];
	findings: string[];
	recommendations: string[];
	refactorPerformed: boolean;
	refactorSummary?: string;
	reviewedAt: string;
	source?: 'cline' | 'synthesized';
}

export interface StoryReviewLoopState {
	reviewerPasses: number;
	autoRefactorRounds: number;
	maxAutoRefactorRounds: number;
	endedReason?: StoryReviewLoopEndedReason;
	lastReviewedAt?: string;
}

export type StoryRiskLevel = 'low' | 'medium' | 'high';

export type StoryApprovalAction = 'approved' | 'rejected' | 'note';

export type StoryApprovalState = 'notRequired' | 'pending' | 'approved' | 'rejected';

export interface StoryApprovalRecord {
	action: StoryApprovalAction;
	createdAt: string;
	actor: 'user';
	note?: string;
	fromStatus?: Extract<StoryExecutionStatus, 'completed' | 'pendingReview' | 'pendingRelease'>;
	toStatus?: Extract<StoryExecutionStatus, 'completed' | 'pendingReview' | 'pendingRelease'>;
}

export interface StoryEvidenceTestResult {
	command: string;
	success: boolean;
	outputSummary?: string;
}

export interface StoryEvidenceArtifact {
	storyId: string;
	title: string;
	status: Extract<StoryExecutionStatus, 'completed' | 'pendingReview' | 'pendingRelease'>;
	summary: string;
	changedFiles: string[];
	changedModules: string[];
	architectureNotes: string[];
	tests: StoryEvidenceTestResult[];
	riskLevel: StoryRiskLevel;
	riskReasons: string[];
	releaseNotes: string[];
	rollbackHints: string[];
	followUps: string[];
	recommendFeatureFlag: boolean;
	evidenceGaps: string[];
	approvalState: StoryApprovalState;
	approvalUpdatedAt?: string;
	approvalSummary?: string;
	approvalHistory: StoryApprovalRecord[];
	reviewSummary?: StoryReviewResult;
	reviewLoop?: StoryReviewLoopState;
	generatedAt: string;
	source?: 'cline' | 'synthesized';
}

export type StoryRunLogStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'blocked';

export type StoryRunLogPhase =
	| 'startup'
	| 'preflight'
	| 'execution'
	| 'completion-gates'
	| 'artifact-persistence'
	| 'review'
	| 'refactor'
	| 'finalization';

export type StoryRunLogCategory = 'signal' | 'diagnostic' | 'noise';

export type StoryRunLogEventKind =
	| 'stage-transition'
	| 'context-injection'
	| 'policy'
	| 'test'
	| 'artifact'
	| 'review'
	| 'refactor'
	| 'failure'
	| 'output'
	| 'summary';

export interface StoryRunLogPhaseEntry {
	phase: StoryRunLogPhase;
	enteredAt: string;
	exitedAt?: string;
	summary?: string;
	status?: StoryRunLogStatus;
}

export interface StoryRunLogEvent {
	id: string;
	timestamp: string;
	phase: StoryRunLogPhase;
	category: StoryRunLogCategory;
	kind: StoryRunLogEventKind;
	title: string;
	summary: string;
	details: string[];
	data?: Record<string, unknown>;
}

export interface StoryRunLogContextInjection {
	name: string;
	lineCount: number;
	injected: boolean;
	summary: string;
	details: string[];
}

export interface StoryRunLogPolicyHit {
	phase: PolicyGatePhase;
	ok: boolean;
	blocking: boolean;
	summary: string;
	ruleIds: string[];
	violations: string[];
	executedCommands: string[];
}

export interface StoryRunLogTestResult {
	command: string;
	success: boolean;
	summary: string;
	source: 'policy-gate' | 'artifact';
	phase: StoryRunLogPhase;
}

export interface StoryRunLogArtifact {
	runId: string;
	storyId: string;
	title: string;
	status: StoryRunLogStatus;
	startedAt: string;
	endedAt?: string;
	durationMs?: number;
	currentPhase: StoryRunLogPhase;
	phaseHistory: StoryRunLogPhaseEntry[];
	events: StoryRunLogEvent[];
	persistedCounts: {
		signal: number;
		diagnostic: number;
		noise: number;
		skippedNoise: number;
	};
	contextInjections: StoryRunLogContextInjection[];
	policyHits: StoryRunLogPolicyHit[];
	tests: StoryRunLogTestResult[];
	keySignals: string[];
	source: 'system';
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

export type AgentMapGapSeverity = 'info' | 'warning';

export interface AgentMapGap {
	id: string;
	label: string;
	detail: string;
	severity: AgentMapGapSeverity;
	expectedPath?: string;
	sourceSignals: string[];
}

export interface AgentMapModuleEntry {
	id: string;
	label: string;
	path: string;
	exists: boolean;
	responsibilities: string[];
	sourceSignals: string[];
	gaps: string[];
}

export type AgentMapRuleCategory = 'generated' | 'editable' | 'config' | 'workflow';

export interface AgentMapRuleEntry {
	id: string;
	label: string;
	path: string;
	exists: boolean;
	category: AgentMapRuleCategory;
	summary: string;
	sourceSignals: string[];
}

export interface AgentMapRunbookStep {
	id: 'plan' | 'execute' | 'checkpoint' | 'reset';
	title: string;
	summary: string;
	inputs: string[];
	commands: string[];
	outputs: string[];
}

export type AgentKnowledgeItemKind = 'document' | 'artifact' | 'directory' | 'command';
export type AgentKnowledgeFreshnessTarget = 'manual' | 'on-demand' | 'per-story' | 'continuous';

export interface AgentKnowledgeItem {
	id: string;
	label: string;
	path: string;
	kind: AgentKnowledgeItemKind;
	exists: boolean;
	summary: string;
	requiredFor: string[];
	freshnessTarget: AgentKnowledgeFreshnessTarget;
	sourceSignals: string[];
	lastModified?: string;
	missingReason?: string;
}

export interface AgentKnowledgeSection {
	id: string;
	title: string;
	items: AgentKnowledgeItem[];
}

export interface AgentMapOverviewArtifact {
	version: number;
	generatedAt: string;
	workspaceRootName: string;
	project: {
		name: string;
		description: string;
		branchName: string;
		packageManager: string;
		primaryLanguage: string;
		mainEntry: string;
		storyCount: number;
		sourceSignals: string[];
	};
	moduleMap: AgentMapModuleEntry[];
	ruleEntries: AgentMapRuleEntry[];
	runbook: AgentMapRunbookStep[];
	documentIndex: AgentKnowledgeItem[];
	gaps: AgentMapGap[];
	source: 'cline';
}

export interface AgentKnowledgeCatalogArtifact {
	version: number;
	generatedAt: string;
	workspaceRootName: string;
	sections: AgentKnowledgeSection[];
	gaps: AgentMapGap[];
	freshnessTargets: Array<{
		label: string;
		path: string;
		freshnessTarget: AgentKnowledgeFreshnessTarget;
		exists: boolean;
	}>;
	source: 'cline';
}

export type KnowledgeCheckScope = 'run-preflight' | 'run-completion' | 'spec';
export type KnowledgeCheckIssueType = 'stale-documentation' | 'missing-module-knowledge' | 'missing-runbook-coverage';
export type KnowledgeCheckIssueSeverity = 'info' | 'warning';

export interface KnowledgeCheckIssue {
	id: string;
	type: KnowledgeCheckIssueType;
	severity: KnowledgeCheckIssueSeverity;
	summary: string;
	details: string[];
	suggestions: string[];
	relatedPaths: string[];
}

export interface KnowledgeCheckReport {
	generatedAt: string;
	scope: KnowledgeCheckScope;
	storyId?: string;
	issues: KnowledgeCheckIssue[];
	relevantModules: string[];
	checkedArtifacts: string[];
	source?: 'cline';
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
	knowledgeLines?: string[];
	recentCheckpointLines?: string[];
	policyLines?: string[];
	taskMemoryPath: string;
	executionCheckpointPath: string;
	evidencePath: string;
	completionSignalPath: string;
	completionSignalKey: string;
	additionalExecutionRules?: string[];
}

export interface StoryReviewerPromptContext {
	story: UserStory;
	workspaceRoot: string;
	reviewPass: number;
	maxReviewerPasses: number;
	maxAutoRefactorRounds: number;
	passingScore: number;
	taskMemoryPath: string;
	executionCheckpointPath: string;
	evidencePath: string;
	completionSignalPath: string;
	completionSignalKey: string;
	taskMemoryLines?: string[];
	checkpointLines?: string[];
	evidenceLines?: string[];
	reviewLoopLines?: string[];
}

export interface StoryRefactorPromptContext {
	story: UserStory;
	workspaceRoot: string;
	refactorRound: number;
	maxAutoRefactorRounds: number;
	reviewPass: number;
	reviewSummaryLines: string[];
	taskMemoryPath: string;
	executionCheckpointPath: string;
	evidencePath: string;
	completionSignalPath: string;
	completionSignalKey: string;
	taskMemoryLines?: string[];
	checkpointLines?: string[];
	evidenceLines?: string[];
}

export type PolicyGatePhase = 'preflight' | 'completion';

export type PolicyArtifactKind =
	| 'project-constraints'
	| 'design-context'
	| 'task-memory'
	| 'execution-checkpoint'
	| 'story-evidence'
	| 'source-context-index';

export type PolicyRuleCondition = 'always' | 'story.designSensitive';

export type PolicyCommandSource = 'projectConstraints.testCommands' | 'projectConstraints.buildCommands';

export interface PolicyRuleBase {
	id: string;
	title: string;
	phase: PolicyGatePhase;
	type: 'required-artifact' | 'restricted-paths' | 'require-command' | 'knowledge-check';
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

export interface KnowledgeCheckPolicyRule extends PolicyRuleBase {
	type: 'knowledge-check';
	failOnTypes?: KnowledgeCheckIssueType[];
	failOnSeverities?: KnowledgeCheckIssueSeverity[];
}

export type PolicyRule = RequiredArtifactPolicyRule | RestrictedPathsPolicyRule | RequireCommandPolicyRule | KnowledgeCheckPolicyRule;

export interface HarnessPolicyConfig {
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
	if (value === 'pendingReview' || value === 'pendingRelease') {
		return value;
	}
	if (value === 'not-started') {
		return '未开始';
	}
	return undefined;
}