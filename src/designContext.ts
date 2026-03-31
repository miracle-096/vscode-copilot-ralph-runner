import * as fs from 'fs';
import { DesignContextArtifact } from './types';
import { ensurePrdDirectories, getDesignContextPath } from './workspacePaths';

export interface DesignContextValidationResult {
	artifact: DesignContextArtifact;
	errors: string[];
	isValid: boolean;
}

export function createEmptyDesignContext(storyId: string): DesignContextArtifact {
	return {
		storyId,
		sourceType: 'notes',
		screenshotPaths: [],
		manualNotes: [],
		referenceDocs: [],
		summary: '',
		layoutConstraints: [],
		componentReuseTargets: [],
		tokenRules: [],
		responsiveRules: [],
		doNotChange: [],
		acceptanceChecks: [],
		updatedAt: new Date().toISOString(),
	};
}

export function hasDesignContextArtifact(workspaceRoot: string, storyId: string): boolean {
	return fs.existsSync(getDesignContextPath(workspaceRoot, storyId));
}

export function writeDesignContext(
	workspaceRoot: string,
	storyId: string,
	designContext: Partial<DesignContextArtifact>,
): string {
	ensurePrdDirectories(workspaceRoot);
	const filePath = getDesignContextPath(workspaceRoot, storyId);
	const validation = validateDesignContext(designContext, storyId);
	fs.writeFileSync(filePath, `${JSON.stringify(validation.artifact, null, 2)}\n`, 'utf-8');
	return filePath;
}

export function readDesignContext(workspaceRoot: string, storyId: string): DesignContextArtifact | null {
	try {
		const content = fs.readFileSync(getDesignContextPath(workspaceRoot, storyId), 'utf-8');
		return normalizeDesignContext(JSON.parse(content) as Partial<DesignContextArtifact>, storyId);
	} catch {
		return null;
	}
}

export function validateDesignContext(
	value: Partial<DesignContextArtifact> | null | undefined,
	storyId: string,
): DesignContextValidationResult {
	const artifact = normalizeDesignContext(value, storyId);
	const errors: string[] = [];

	if (artifact.sourceType === 'figma' && !artifact.figmaUrl) {
		errors.push('A Figma design context should include a figmaUrl.');
	}
	if (artifact.sourceType === 'screenshots' && artifact.screenshotPaths.length === 0) {
		errors.push('A screenshot-based design context should include at least one screenshot path.');
	}
	if (artifact.sourceType === 'notes' && artifact.manualNotes.length === 0 && artifact.summary.length === 0) {
		errors.push('A notes-based design context should include manualNotes or a summary.');
	}

	return {
		artifact,
		errors,
		isValid: errors.length === 0,
	};
}

export function normalizeDesignContext(value: Partial<DesignContextArtifact> | null | undefined, storyId: string): DesignContextArtifact {
	const fallback = createEmptyDesignContext(storyId);
	if (!value) {
		return fallback;
	}
	return {
		storyId,
		sourceType: value.sourceType === 'figma' || value.sourceType === 'screenshots' || value.sourceType === 'notes' ? value.sourceType : fallback.sourceType,
		figmaUrl: normalizeOptionalString(value.figmaUrl),
		screenshotPaths: toStringArray(value.screenshotPaths),
		manualNotes: toStringArray(value.manualNotes),
		referenceDocs: toStringArray(value.referenceDocs),
		summary: normalizeOptionalString(value.summary) ?? fallback.summary,
		pageOrScreenName: normalizeOptionalString(value.pageOrScreenName),
		layoutConstraints: toStringArray(value.layoutConstraints),
		componentReuseTargets: toStringArray(value.componentReuseTargets),
		tokenRules: toStringArray(value.tokenRules),
		responsiveRules: toStringArray(value.responsiveRules),
		doNotChange: toStringArray(value.doNotChange),
		acceptanceChecks: toStringArray(value.acceptanceChecks),
		updatedAt: normalizeOptionalString(value.updatedAt) ?? fallback.updatedAt,
	};
}

export function summarizeDesignContextForPrompt(designContext: DesignContextArtifact | null): string[] {
	if (!designContext) {
		return [];
	}
	const lines: string[] = [`Primary Source: ${designContext.sourceType}`];

	if (designContext.pageOrScreenName) {
		lines.push(`Screen: ${designContext.pageOrScreenName}`);
	}
	if (designContext.summary) {
		lines.push(`Design Intent: ${designContext.summary}`);
	}
	if (designContext.figmaUrl) {
		lines.push(`Figma URL: ${designContext.figmaUrl}`);
	}
	if (designContext.referenceDocs.length > 0) {
		lines.push(`Reference Docs: ${designContext.referenceDocs.join('; ')}`);
	}
	if (designContext.screenshotPaths.length > 0) {
		lines.push(`Screenshot Inputs: ${designContext.screenshotPaths.join('; ')}`);
	}

	appendConstraintBlock(lines, 'Layout Constraints', designContext.layoutConstraints);
	appendConstraintBlock(lines, 'Component Reuse Requirements', designContext.componentReuseTargets);
	appendConstraintBlock(lines, 'Token Usage Rules', designContext.tokenRules);
	appendConstraintBlock(lines, 'Responsive Rules', designContext.responsiveRules);
	appendConstraintBlock(lines, 'Protected Areas', designContext.doNotChange);
	appendConstraintBlock(lines, 'Visual Acceptance Checks', designContext.acceptanceChecks);
	appendConstraintBlock(lines, 'Implementation Notes', selectImplementationNotes(designContext.manualNotes));

	return lines;
}

function normalizeOptionalString(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const normalizedItems = value
		.filter((item): item is string => typeof item === 'string')
		.map(item => item.trim())
		.filter(item => item.length > 0);

	return Array.from(new Set(normalizedItems));
}

function appendConstraintBlock(lines: string[], label: string, values: string[]): void {
	if (values.length === 0) {
		return;
	}

	lines.push(`${label}:`);
	for (const value of values) {
		lines.push(`- ${value}`);
	}
}

function selectImplementationNotes(notes: string[]): string[] {
	if (notes.length === 0) {
		return [];
	}

	return notes
		.filter(note => !/^screenshot:|^image:|^mockup:/i.test(note))
		.slice(0, 4);
}