import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { scanWorkspaceForProjectConstraints } from './projectConstraints';
import { SourceContextIndexArtifact } from './types';
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
			if (!line || line === 'prd.json' || line.startsWith('.ralph/') || line.startsWith('.prd/')) {
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