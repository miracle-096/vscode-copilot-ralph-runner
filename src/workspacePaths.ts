import * as fs from 'fs';
import * as path from 'path';

export const RALPH_DIR = '.ralph';
export const PRD_DIR = '.prd';
export const USER_STORIES_DIR = 'user_stories';
export const GITHUB_DIR = '.github';
export const RALPH_CONFIG_DIR = 'ralph';
export const PRD_FILENAME = 'prd.json';
export const BASE_PRD_FILENAME = 'base_prd.json';
export const PROGRESS_FILENAME = 'progress.txt';
export const STORY_STATUS_FILENAME = 'story-status.json';
export const PROJECT_CONSTRAINTS_FILENAME = 'project-constraints.md';
export const GENERATED_PROJECT_CONSTRAINTS_FILENAME = 'project-constraints.generated.json';
export const DESIGN_CONTEXT_FILE_SUFFIX = '.design.json';
export const TASK_MEMORY_DIR = 'memory';
export const TASK_MEMORY_INDEX_FILENAME = 'memory-index.json';

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

export function getPrdPath(workspaceRoot: string): string {
	return path.join(workspaceRoot, PRD_FILENAME);
}

export function getPrdDirectoryPath(workspaceRoot: string): string {
	return path.join(workspaceRoot, PRD_DIR);
}

export function getUserStoriesDirectoryPath(workspaceRoot: string): string {
	return path.join(getPrdDirectoryPath(workspaceRoot), USER_STORIES_DIR);
}

export function getBasePrdPath(workspaceRoot: string): string {
	return path.join(getPrdDirectoryPath(workspaceRoot), BASE_PRD_FILENAME);
}

export function getUserStoryFilePath(workspaceRoot: string, storyId: string): string {
	return path.join(getUserStoriesDirectoryPath(workspaceRoot), `${storyId}.json`);
}

export function getDesignContextPath(workspaceRoot: string, storyId: string): string {
	return path.join(getUserStoriesDirectoryPath(workspaceRoot), `${storyId}${DESIGN_CONTEXT_FILE_SUFFIX}`);
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

export function ensurePrdDirectories(workspaceRoot: string): { prdDir: string; userStoriesDir: string } {
	const prdDir = ensureDirectoryExists(getPrdDirectoryPath(workspaceRoot));
	const userStoriesDir = ensureDirectoryExists(getUserStoriesDirectoryPath(workspaceRoot));
	return { prdDir, userStoriesDir };
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