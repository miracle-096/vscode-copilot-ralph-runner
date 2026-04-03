import * as fs from 'fs';
import * as path from 'path';

export const RALPH_DIR = '.ralph';
export const PRD_DIR = '.prd';
export const DESIGN_CONTEXT_DIR = 'design-context';
export const DESIGN_CONTEXT_SHARED_DIR = 'shared';
export const GITHUB_DIR = '.github';
export const RALPH_CONFIG_DIR = 'ralph';
export const PRD_FILENAME = 'prd.json';
export const PROGRESS_FILENAME = 'progress.txt';
export const STORY_STATUS_FILENAME = 'story-status.json';
export const PROJECT_CONSTRAINTS_FILENAME = 'project-constraints.md';
export const GENERATED_PROJECT_CONSTRAINTS_FILENAME = 'project-constraints.generated.json';
export const DESIGN_CONTEXT_FILE_SUFFIX = '.design.json';
export const DESIGN_CONTEXT_SUGGESTION_DIR = 'design-context-suggestions';
export const TASK_MEMORY_DIR = 'memory';
export const TASK_MEMORY_INDEX_FILENAME = 'memory-index.json';
export const EXECUTION_CHECKPOINT_DIR = 'checkpoints';
export const EXECUTION_CHECKPOINT_FILE_SUFFIX = '.checkpoint.json';
export const STORY_EVIDENCE_DIR = 'evidence';
export const STORY_EVIDENCE_FILE_SUFFIX = '.evidence.json';
export const STORY_RUN_LOG_DIR = 'run-logs';
export const STORY_RUN_LOG_FILE_SUFFIX = '.run-log.json';
export const SOURCE_CONTEXT_INDEX_FILENAME = 'source-context-index.json';
export const POLICY_BASELINE_DIR = 'policy-baselines';
export const POLICY_BASELINE_FILE_SUFFIX = '.policy-baseline.json';
export const AGENT_MAP_DIR = 'agent-map';
export const AGENT_MAP_OVERVIEW_FILENAME = 'overview.json';
export const AGENT_MAP_KNOWLEDGE_CATALOG_FILENAME = 'knowledge-catalog.json';

export function ensureDirectoryExists(dirPath: string): string {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
	}
	return dirPath;
}

export function getRalphDir(workspaceRoot: string): string {
	return path.join(workspaceRoot, RALPH_DIR);
}

export function getTaskStatusPath(workspaceRoot: string, taskId: string): string {
	return path.join(getRalphDir(workspaceRoot), `task-${taskId}-status`);
}

export function getStoryStatusRegistryPath(workspaceRoot: string): string {
	return path.join(getRalphDir(workspaceRoot), STORY_STATUS_FILENAME);
}

export function getTaskMemoryDirectoryPath(workspaceRoot: string): string {
	return path.join(getRalphDir(workspaceRoot), TASK_MEMORY_DIR);
}

export function getTaskMemoryPath(workspaceRoot: string, storyId: string): string {
	return path.join(getTaskMemoryDirectoryPath(workspaceRoot), `${storyId}.json`);
}

export function getTaskMemoryIndexPath(workspaceRoot: string): string {
	return path.join(getRalphDir(workspaceRoot), TASK_MEMORY_INDEX_FILENAME);
}

export function getExecutionCheckpointDirectoryPath(workspaceRoot: string): string {
	return path.join(getRalphDir(workspaceRoot), EXECUTION_CHECKPOINT_DIR);
}

export function getExecutionCheckpointPath(workspaceRoot: string, storyId: string): string {
	return path.join(getExecutionCheckpointDirectoryPath(workspaceRoot), `${storyId}${EXECUTION_CHECKPOINT_FILE_SUFFIX}`);
}

export function getStoryEvidenceDirectoryPath(workspaceRoot: string): string {
	return path.join(getRalphDir(workspaceRoot), STORY_EVIDENCE_DIR);
}

export function getStoryEvidencePath(workspaceRoot: string, storyId: string): string {
	return path.join(getStoryEvidenceDirectoryPath(workspaceRoot), `${storyId}${STORY_EVIDENCE_FILE_SUFFIX}`);
}

export function getStoryRunLogDirectoryPath(workspaceRoot: string): string {
	return path.join(getRalphDir(workspaceRoot), STORY_RUN_LOG_DIR);
}

export function getStoryRunLogPath(workspaceRoot: string, runId: string): string {
	return path.join(getStoryRunLogDirectoryPath(workspaceRoot), `${runId}${STORY_RUN_LOG_FILE_SUFFIX}`);
}

export function getDesignContextSuggestionDirectoryPath(workspaceRoot: string): string {
	return path.join(getRalphDir(workspaceRoot), DESIGN_CONTEXT_SUGGESTION_DIR);
}

export function getDesignContextSuggestionPath(workspaceRoot: string, storyId: string): string {
	return path.join(getDesignContextSuggestionDirectoryPath(workspaceRoot), `${storyId}.suggestion.json`);
}

export function getPrdPath(workspaceRoot: string): string {
	return path.join(workspaceRoot, PRD_FILENAME);
}

export function getPrdDirectoryPath(workspaceRoot: string): string {
	return path.join(workspaceRoot, PRD_DIR);
}

export function getDesignContextDirectoryPath(workspaceRoot: string): string {
	return path.join(getPrdDirectoryPath(workspaceRoot), DESIGN_CONTEXT_DIR);
}

export function getSharedDesignContextDirectoryPath(workspaceRoot: string): string {
	return path.join(getDesignContextDirectoryPath(workspaceRoot), DESIGN_CONTEXT_SHARED_DIR);
}

export function toDesignContextKeySegment(value: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return normalized.length > 0 ? normalized : 'default';
}

export function getDesignContextPath(workspaceRoot: string, storyId: string): string {
	return path.join(getDesignContextDirectoryPath(workspaceRoot), `${storyId}${DESIGN_CONTEXT_FILE_SUFFIX}`);
}

export function getProjectDesignContextPath(workspaceRoot: string): string {
	return path.join(getSharedDesignContextDirectoryPath(workspaceRoot), `project${DESIGN_CONTEXT_FILE_SUFFIX}`);
}

export function getScreenDesignContextPath(workspaceRoot: string, screenId: string): string {
	return path.join(getSharedDesignContextDirectoryPath(workspaceRoot), `screen-${toDesignContextKeySegment(screenId)}${DESIGN_CONTEXT_FILE_SUFFIX}`);
}

export function getModuleDesignContextPath(workspaceRoot: string, moduleId: string): string {
	return path.join(getSharedDesignContextDirectoryPath(workspaceRoot), `module-${toDesignContextKeySegment(moduleId)}${DESIGN_CONTEXT_FILE_SUFFIX}`);
}

export function getGithubRalphDirectoryPath(workspaceRoot: string): string {
	return path.join(workspaceRoot, GITHUB_DIR, RALPH_CONFIG_DIR);
}

export function getEditableProjectConstraintsPath(workspaceRoot: string): string {
	return path.join(getGithubRalphDirectoryPath(workspaceRoot), PROJECT_CONSTRAINTS_FILENAME);
}

export function getGeneratedProjectConstraintsPath(workspaceRoot: string): string {
	return path.join(getRalphDir(workspaceRoot), GENERATED_PROJECT_CONSTRAINTS_FILENAME);
}

export function getSourceContextIndexPath(workspaceRoot: string): string {
	return path.join(getRalphDir(workspaceRoot), SOURCE_CONTEXT_INDEX_FILENAME);
}

export function getAgentMapDirectoryPath(workspaceRoot: string): string {
	return path.join(getRalphDir(workspaceRoot), AGENT_MAP_DIR);
}

export function getAgentMapOverviewPath(workspaceRoot: string): string {
	return path.join(getAgentMapDirectoryPath(workspaceRoot), AGENT_MAP_OVERVIEW_FILENAME);
}

export function getAgentMapKnowledgeCatalogPath(workspaceRoot: string): string {
	return path.join(getAgentMapDirectoryPath(workspaceRoot), AGENT_MAP_KNOWLEDGE_CATALOG_FILENAME);
}

export function getPolicyBaselineDirectoryPath(workspaceRoot: string): string {
	return path.join(getRalphDir(workspaceRoot), POLICY_BASELINE_DIR);
}

export function getPolicyBaselinePath(workspaceRoot: string, storyId: string): string {
	return path.join(getPolicyBaselineDirectoryPath(workspaceRoot), `${storyId}${POLICY_BASELINE_FILE_SUFFIX}`);
}

export function ensurePrdDirectories(workspaceRoot: string): { prdDir: string; designContextDir: string; sharedDesignContextDir: string } {
	const prdDir = ensureDirectoryExists(getPrdDirectoryPath(workspaceRoot));
	const designContextDir = ensureDirectoryExists(getDesignContextDirectoryPath(workspaceRoot));
	const sharedDesignContextDir = ensureDirectoryExists(getSharedDesignContextDirectoryPath(workspaceRoot));
	return { prdDir, designContextDir, sharedDesignContextDir };
}

export function ensureProjectConstraintDirectories(workspaceRoot: string): { githubRalphDir: string; ralphDir: string } {
	const githubRalphDir = ensureDirectoryExists(getGithubRalphDirectoryPath(workspaceRoot));
	const ralphDir = ensureDirectoryExists(getRalphDir(workspaceRoot));
	return { githubRalphDir, ralphDir };
}

export function ensureTaskMemoryDirectory(workspaceRoot: string): string {
	ensureDirectoryExists(getRalphDir(workspaceRoot));
	return ensureDirectoryExists(getTaskMemoryDirectoryPath(workspaceRoot));
}

export function ensureExecutionCheckpointDirectory(workspaceRoot: string): string {
	ensureDirectoryExists(getRalphDir(workspaceRoot));
	return ensureDirectoryExists(getExecutionCheckpointDirectoryPath(workspaceRoot));
}

export function ensureStoryEvidenceDirectory(workspaceRoot: string): string {
	ensureDirectoryExists(getRalphDir(workspaceRoot));
	return ensureDirectoryExists(getStoryEvidenceDirectoryPath(workspaceRoot));
}

export function ensureStoryRunLogDirectory(workspaceRoot: string): string {
	ensureDirectoryExists(getRalphDir(workspaceRoot));
	return ensureDirectoryExists(getStoryRunLogDirectoryPath(workspaceRoot));
}

export function ensurePolicyBaselineDirectory(workspaceRoot: string): string {
	ensureDirectoryExists(getRalphDir(workspaceRoot));
	return ensureDirectoryExists(getPolicyBaselineDirectoryPath(workspaceRoot));
}

export function ensureAgentMapDirectory(workspaceRoot: string): string {
	ensureDirectoryExists(getRalphDir(workspaceRoot));
	return ensureDirectoryExists(getAgentMapDirectoryPath(workspaceRoot));
}

export function ensureDesignContextSuggestionDirectory(workspaceRoot: string): string {
	ensureDirectoryExists(getRalphDir(workspaceRoot));
	return ensureDirectoryExists(getDesignContextSuggestionDirectoryPath(workspaceRoot));
}