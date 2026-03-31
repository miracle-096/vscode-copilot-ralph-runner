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

export type BasePrdFile = Omit<PrdFile, 'userStories'>;

export interface SplitUserStory extends UserStory {
	status: StoryExecutionStatus;
}

export interface GeneratedProjectConstraints {
	version: number;
	generatedAt: string;
	technologySummary: string[];
	buildCommands: string[];
	testCommands: string[];
	lintCommands: string[];
	styleRules: string[];
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

export interface DesignContextArtifact {
	storyId: string;
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
	completionSignalPath: string;
	additionalExecutionRules?: string[];
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