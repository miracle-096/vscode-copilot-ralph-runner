import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { scanWorkspaceForProjectConstraints } from './projectConstraints';
import {
	SourceContextIndexArtifact,
	SourceContextRecallMatch,
	TaskMemoryArtifact,
	UserStory,
} from './types';
import { ensureDirectoryExists, getRalphDir, getSourceContextIndexPath } from './workspacePaths';

interface PackageJsonLike {
	main?: string;
	scripts?: Record<string, string>;
}

export function createEmptySourceContextIndex(workspaceRoot: string): SourceContextIndexArtifact {
	return {
		version: 1,
		generatedAt: new Date().toISOString(),
		workspaceRootName: path.basename(workspaceRoot),
		sourceDirectories: [],
		testDirectories: [],
		buildScripts: [],
		keyEntryFiles: [],
		reusableModuleHints: [],
		typeDefinitionHints: [],
		hotspotPaths: [],
	};
}

export function ensureSourceContextIndexScaffold(workspaceRoot: string): string {
	return ensureDirectoryExists(getRalphDir(workspaceRoot));
}

export function getSourceContextIndex(workspaceRoot: string): SourceContextIndexArtifact | null {
	try {
		const content = fs.readFileSync(getSourceContextIndexPath(workspaceRoot), 'utf-8');
		return normalizeSourceContextIndex(JSON.parse(content) as Partial<SourceContextIndexArtifact>, workspaceRoot);
	} catch {
		return null;
	}
}

export function writeSourceContextIndex(
	workspaceRoot: string,
	value: Partial<SourceContextIndexArtifact> | null | undefined,
): string {
	ensureSourceContextIndexScaffold(workspaceRoot);
	const filePath = getSourceContextIndexPath(workspaceRoot);
	const normalized = normalizeSourceContextIndex(value, workspaceRoot);
	fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf-8');
	return filePath;
}

export function refreshSourceContextIndex(workspaceRoot: string): SourceContextIndexArtifact {
	const nextIndex = scanWorkspaceForSourceContextIndex(workspaceRoot);
	writeSourceContextIndex(workspaceRoot, nextIndex);
	return nextIndex;
}

export function scanWorkspaceForSourceContextIndex(workspaceRoot: string): SourceContextIndexArtifact {
	const baseline = scanWorkspaceForProjectConstraints(workspaceRoot);
	const packageJson = readJsonFile<PackageJsonLike>(path.join(workspaceRoot, 'package.json'));
	const metadata = baseline.generatedConstraints.metadata ?? {};
	const topLevelDirectories = toStringArray(metadata.topLevelDirectories);
	const sourceDirectories = deriveSourceDirectories(toStringArray(metadata.sourceDirectories));
	const testDirectories = deriveTestDirectories(workspaceRoot, sourceDirectories, topLevelDirectories);
	const buildScripts = collectBuildScripts(packageJson);
	const keyEntryFiles = collectKeyEntryFiles(workspaceRoot, packageJson?.main);
	const reusableModuleHints = collectReusableModuleHints(workspaceRoot, sourceDirectories);
	const typeDefinitionHints = collectTypeDefinitionHints(workspaceRoot, sourceDirectories);
	const hotspotPaths = collectHotspotPaths(workspaceRoot);

	return normalizeSourceContextIndex({
		version: 1,
		generatedAt: new Date().toISOString(),
		workspaceRootName: path.basename(workspaceRoot),
		sourceDirectories,
		testDirectories,
		buildScripts,
		keyEntryFiles,
		reusableModuleHints,
		typeDefinitionHints,
		hotspotPaths,
		metadata: {
			packageJsonName: metadata.packageJsonName,
			eslintConfigPath: metadata.eslintConfigPath,
			topLevelDirectories,
			sourceDirectories,
			hasReadme: metadata.hasReadme,
			scanSource: 'project-constraints-baseline',
		},
	}, workspaceRoot);
}

export function summarizeSourceContextIndexForPrompt(index: SourceContextIndexArtifact | null): string[] {
	if (!index) {
		return [];
	}

	return [
		...prefixLines('Source Directories', index.sourceDirectories, 4),
		...prefixLines('Test Directories', index.testDirectories, 3),
		...prefixLines('Build Scripts', index.buildScripts, 4),
		...prefixLines('Key Entry Files', index.keyEntryFiles, 5),
		...prefixLines('Reusable Module Hints', index.reusableModuleHints, 4),
		...prefixLines('Type Definition Hints', index.typeDefinitionHints, 4),
		...prefixLines('Hotspot Paths', index.hotspotPaths, 4),
	];
}

export function recallRelevantSourceContext(
	index: SourceContextIndexArtifact | null,
	story: UserStory,
	options?: {
		limit?: number;
		memoryHints?: TaskMemoryArtifact[];
	},
): SourceContextRecallMatch[] {
	if (!index) {
		return [];
	}

	const limit = options?.limit ?? 4;
	const recallContext = buildSourceContextRecallContext(story, options?.memoryHints ?? []);
	const candidates = buildSourceContextCandidates(index);
	const matches: SourceContextRecallMatch[] = [];

	for (const candidate of candidates) {
		const match = scoreSourceContextCandidate(candidate, recallContext);
		if (match.score <= 0) {
			continue;
		}
		matches.push(match);
	}

	matches.sort((left, right) => {
		if (right.score !== left.score) {
			return right.score - left.score;
		}
		return left.label.localeCompare(right.label);
	});

	return matches.slice(0, limit);
}

export function summarizeRecalledSourceContextForPrompt(matches: SourceContextRecallMatch[], limit = 4): string[] {
	if (matches.length === 0) {
		return [];
	}

	const lines: string[] = [];
	for (const match of matches.slice(0, limit)) {
		lines.push(`${match.label} (score ${match.score})`);
		lines.push(`Why it matters: ${match.reasons.slice(0, 3).join('; ')}`);
		lines.push(`- Category: ${match.category}`);
		lines.push(`- Value: ${match.value}`);
		lines.push('');
	}

	return lines.slice(0, lines[lines.length - 1] === '' ? lines.length - 1 : lines.length);
}

export function normalizeSourceContextIndex(
	value: Partial<SourceContextIndexArtifact> | null | undefined,
	workspaceRoot: string,
): SourceContextIndexArtifact {
	const fallback = createEmptySourceContextIndex(workspaceRoot);
	if (!value) {
		return fallback;
	}

	return {
		version: typeof value.version === 'number' ? value.version : fallback.version,
		generatedAt: normalizeOptionalString(value.generatedAt) ?? fallback.generatedAt,
		workspaceRootName: normalizeOptionalString(value.workspaceRootName) ?? fallback.workspaceRootName,
		sourceDirectories: toStringArray(value.sourceDirectories),
		testDirectories: toStringArray(value.testDirectories),
		buildScripts: toStringArray(value.buildScripts),
		keyEntryFiles: toStringArray(value.keyEntryFiles),
		reusableModuleHints: toStringArray(value.reusableModuleHints),
		typeDefinitionHints: toStringArray(value.typeDefinitionHints),
		hotspotPaths: toStringArray(value.hotspotPaths),
		metadata: value.metadata && typeof value.metadata === 'object' ? value.metadata : undefined,
	};
}

function deriveSourceDirectories(rawSourceDirectories: string[]): string[] {
	const directories = rawSourceDirectories.map(dirName => `src/${dirName}`);
	if (!directories.includes('src')) {
		directories.unshift('src');
	}
	return Array.from(new Set(directories));
}

function deriveTestDirectories(workspaceRoot: string, sourceDirectories: string[], topLevelDirectories: string[]): string[] {
	const candidates = new Set<string>();
	for (const directory of sourceDirectories) {
		const testPath = path.join(workspaceRoot, directory, 'test');
		if (fs.existsSync(testPath) && fs.statSync(testPath).isDirectory()) {
			candidates.add(`${directory}/test`);
		}
	}

	for (const directory of topLevelDirectories) {
		if (directory.toLowerCase().includes('test')) {
			candidates.add(directory);
		}
	}

	return Array.from(candidates);
}

function collectBuildScripts(packageJson: PackageJsonLike | null): string[] {
	if (!packageJson?.scripts) {
		return [];
	}

	const orderedScripts = ['compile', 'package', 'vscode:prepublish', 'pretest', 'test', 'lint', 'check-types'];
	return orderedScripts.filter(scriptName => packageJson.scripts?.[scriptName]).map(scriptName => `npm run ${scriptName}`);
}

function collectKeyEntryFiles(workspaceRoot: string, packageMain: string | undefined): string[] {
	const candidates = [
		'src/extension.ts',
		'src/types.ts',
		'src/projectConstraints.ts',
		'src/promptContext.ts',
		'src/taskMemory.ts',
		'src/executionCheckpoint.ts',
		'src/sourceContext.ts',
		'esbuild.js',
		'package.json',
		'tsconfig.json',
		'eslint.config.mjs',
		'README.md',
		packageMain,
	].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

	return Array.from(new Set(candidates.filter(candidate => fs.existsSync(path.join(workspaceRoot, candidate)))));
}

function collectReusableModuleHints(workspaceRoot: string, sourceDirectories: string[]): string[] {
	const hints = new Set<string>();
	for (const directory of sourceDirectories) {
		const absoluteDirectory = path.join(workspaceRoot, directory);
		if (!fs.existsSync(absoluteDirectory) || !fs.statSync(absoluteDirectory).isDirectory()) {
			continue;
		}

		for (const entry of safeReadDir(absoluteDirectory)) {
			if (entry.isDirectory()) {
				if (entry.name !== 'test') {
					hints.add(`${directory}/${entry.name}`.replace(/\\/g, '/'));
				}
				continue;
			}

			if (entry.name.endsWith('.ts') && entry.name !== 'extension.ts') {
				hints.add(`${directory}/${entry.name}`.replace(/\\/g, '/'));
			}
		}
	}

	return Array.from(hints).slice(0, 12);
}

function collectTypeDefinitionHints(workspaceRoot: string, sourceDirectories: string[]): string[] {
	const candidateFiles: string[] = [];
	for (const directory of sourceDirectories) {
		const absoluteDirectory = path.join(workspaceRoot, directory);
		if (!fs.existsSync(absoluteDirectory) || !fs.statSync(absoluteDirectory).isDirectory()) {
			continue;
		}

		for (const entry of safeReadDir(absoluteDirectory)) {
			if (!entry.isFile() || !entry.name.endsWith('.ts')) {
				continue;
			}
			candidateFiles.push(path.join(absoluteDirectory, entry.name));
		}
	}

	const hints = new Set<string>();
	for (const candidateFile of candidateFiles.slice(0, 12)) {
		try {
			const content = fs.readFileSync(candidateFile, 'utf-8');
			const matches = content.matchAll(/export\s+(?:interface|type|class|enum)\s+([A-Za-z0-9_]+)/g);
			for (const match of matches) {
				hints.add(`${path.relative(workspaceRoot, candidateFile).replace(/\\/g, '/')}#${match[1]}`);
				if (hints.size >= 12) {
					return Array.from(hints);
				}
			}
		} catch {
			continue;
		}
	}

	return Array.from(hints);
}

function collectHotspotPaths(workspaceRoot: string): string[] {
	try {
		const output = execSync('git log --name-only --pretty=format: -n 25', {
			cwd: workspaceRoot,
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});

		const counts = new Map<string, number>();
		for (const rawLine of output.split(/\r?\n/)) {
			const line = rawLine.trim().replace(/\\/g, '/');
			if (!line || line === 'prd.json' || line.startsWith('.harness-runner/') || line.startsWith('.prd/')) {
				continue;
			}
			counts.set(line, (counts.get(line) ?? 0) + 1);
		}

		return Array.from(counts.entries())
			.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
			.slice(0, 8)
			.map(([filePath]) => filePath);
	} catch {
		return [];
	}
}

function safeReadDir(directoryPath: string): fs.Dirent[] {
	try {
		return fs.readdirSync(directoryPath, { withFileTypes: true });
	} catch {
		return [];
	}
}

function readJsonFile<T>(filePath: string): T | null {
	try {
		const content = fs.readFileSync(filePath, 'utf-8');
		return JSON.parse(content) as T;
	} catch {
		return null;
	}
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const normalized = value
		.filter((item): item is string => typeof item === 'string')
		.map(item => item.trim())
		.filter(item => item.length > 0);

	return Array.from(new Set(normalized));
}

function normalizeOptionalString(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function prefixLines(label: string, values: string[], limit: number): string[] {
	if (values.length === 0) {
		return [];
	}

	return [label, ...values.slice(0, limit).map(value => `- ${value}`), ''];
}

interface SourceContextCandidate {
	label: string;
	category: SourceContextRecallMatch['category'];
	value: string;
	tokens: string[];
	moduleTokens: string[];
	fileTokens: string[];
	weight: number;
}

interface SourceContextRecallContext {
	keywords: string[];
	moduleHints: string[];
	fileHints: string[];
}

function buildSourceContextRecallContext(story: UserStory, memoryHints: TaskMemoryArtifact[]): SourceContextRecallContext {
	const keywords = new Set(extractKeywords([
		story.id,
		story.title,
		story.description,
		...story.acceptanceCriteria,
	]));
	const moduleHints = new Set(extractPathLikeValues(story, ['moduleHints', 'changedModules', 'paths']));
	const fileHints = new Set(extractPathLikeValues(story, ['fileHints', 'changedFiles', 'paths']));

	for (const memory of memoryHints) {
		for (const keyword of memory.searchKeywords) {
			for (const token of extractKeywords([keyword])) {
				keywords.add(token);
			}
		}
		for (const moduleHint of memory.changedModules) {
			moduleHints.add(moduleHint);
		}
		for (const fileHint of memory.changedFiles) {
			fileHints.add(fileHint);
		}
	}

	return {
		keywords: Array.from(keywords),
		moduleHints: Array.from(moduleHints).map(value => value.toLowerCase()),
		fileHints: Array.from(fileHints).map(value => value.toLowerCase()),
	};
}

function buildSourceContextCandidates(index: SourceContextIndexArtifact): SourceContextCandidate[] {
	const candidates: SourceContextCandidate[] = [];
	appendSourceContextCandidates(candidates, index.sourceDirectories, 'source-directory', 8);
	appendSourceContextCandidates(candidates, index.testDirectories, 'test-directory', 6);
	appendSourceContextCandidates(candidates, index.buildScripts, 'build-script', 5);
	appendSourceContextCandidates(candidates, index.keyEntryFiles, 'entry-file', 10);
	appendSourceContextCandidates(candidates, index.reusableModuleHints, 'module-hint', 9);
	appendSourceContextCandidates(candidates, index.typeDefinitionHints, 'type-hint', 8);
	appendSourceContextCandidates(candidates, index.hotspotPaths, 'hotspot', 7);
	return candidates;
}

function appendSourceContextCandidates(
	collector: SourceContextCandidate[],
	values: string[],
	category: SourceContextRecallMatch['category'],
	weight: number,
): void {
	for (const value of values) {
		const normalizedValue = value.trim();
		if (normalizedValue.length === 0) {
			continue;
		}

		collector.push({
			label: normalizedValue,
			category,
			value: normalizedValue,
			tokens: extractKeywords([normalizedValue]),
			moduleTokens: extractPathTokens(normalizedValue),
			fileTokens: extractFileTokens(normalizedValue),
			weight,
		});
	}
}

function scoreSourceContextCandidate(candidate: SourceContextCandidate, context: SourceContextRecallContext): SourceContextRecallMatch {
	let score = candidate.weight;
	const reasons: string[] = [];
	const keywordOverlap = intersect(context.keywords, candidate.tokens);
	const moduleOverlap = intersect(context.moduleHints, candidate.moduleTokens);
	const fileOverlap = intersect(context.fileHints, candidate.fileTokens);

	if (keywordOverlap.length > 0) {
		score += Math.min(30, keywordOverlap.length * 10);
		reasons.push(`keyword overlap: ${keywordOverlap.slice(0, 4).join(', ')}`);
	}

	if (moduleOverlap.length > 0) {
		score += Math.min(28, moduleOverlap.length * 14);
		reasons.push(`module hint overlap: ${moduleOverlap.slice(0, 3).join(', ')}`);
	}

	if (fileOverlap.length > 0) {
		score += Math.min(36, fileOverlap.length * 18);
		reasons.push(`file hint overlap: ${fileOverlap.slice(0, 3).join(', ')}`);
	}

	if (candidate.category === 'entry-file') {
		score += 4;
		reasons.push('key entry file');
	}

	if (candidate.category === 'hotspot') {
		score += 2;
		reasons.push('recent hotspot');
	}

	return {
		label: candidate.label,
		category: candidate.category,
		value: candidate.value,
		score,
		reasons,
		keywordOverlap,
		moduleOverlap,
		fileOverlap,
	};
}

function extractKeywords(values: string[]): string[] {
	const keywords = new Set<string>();
	for (const value of values) {
		if (typeof value !== 'string') {
			continue;
		}

		for (const token of value.toLowerCase().split(/[^a-z0-9_./#-]+/)) {
			if (token.length >= 3) {
				keywords.add(token);
			}
		}
	}

	return Array.from(keywords);
}

function extractPathLikeValues(source: UserStory, keys: string[]): string[] {
	const values = new Set<string>();
	for (const key of keys) {
		const rawValue = source[key];
		if (!Array.isArray(rawValue)) {
			continue;
		}

		for (const item of rawValue) {
			if (typeof item === 'string' && item.trim().length > 0) {
				values.add(item.trim());
			}
		}
	}

	return Array.from(values);
}

function extractPathTokens(value: string): string[] {
	return Array.from(new Set(value.toLowerCase().split(/[\\/]+/).filter(token => token.length >= 2)));
}

function extractFileTokens(value: string): string[] {
	const normalized = value.toLowerCase();
	const fileName = path.basename(normalized.split('#')[0]);
	const baseName = fileName.replace(/\.[^.]+$/, '');
	const tokens = [normalized, fileName, baseName].filter(token => token.length >= 2);
	return Array.from(new Set(tokens));
}

function intersect(left: string[], right: string[]): string[] {
	const rightSet = new Set(right);
	return Array.from(new Set(left.filter(value => rightSet.has(value))));
}