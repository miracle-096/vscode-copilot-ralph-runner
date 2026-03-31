import * as fs from 'fs';
import { DesignContextArtifact } from './types';
import { getDesignContextPath } from './workspacePaths';

export function createEmptyDesignContext(storyId: string): DesignContextArtifact {
	return {
		storyId,
		sourceType: 'notes',
		screenshotPaths: [],
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

export function readDesignContext(workspaceRoot: string, storyId: string): DesignContextArtifact | null {
	try {
		const content = fs.readFileSync(getDesignContextPath(workspaceRoot, storyId), 'utf-8');
		return normalizeDesignContext(JSON.parse(content) as Partial<DesignContextArtifact>, storyId);
	} catch {
		return null;
	}
}

export function normalizeDesignContext(value: Partial<DesignContextArtifact> | null | undefined, storyId: string): DesignContextArtifact {
	const fallback = createEmptyDesignContext(storyId);
	if (!value) {
		return fallback;
	}
	return {
		storyId,
		sourceType: value.sourceType === 'figma' || value.sourceType === 'screenshots' || value.sourceType === 'notes' ? value.sourceType : fallback.sourceType,
		figmaUrl: typeof value.figmaUrl === 'string' ? value.figmaUrl : undefined,
		screenshotPaths: toStringArray(value.screenshotPaths),
		referenceDocs: toStringArray(value.referenceDocs),
		summary: typeof value.summary === 'string' ? value.summary : fallback.summary,
		pageOrScreenName: typeof value.pageOrScreenName === 'string' ? value.pageOrScreenName : undefined,
		layoutConstraints: toStringArray(value.layoutConstraints),
		componentReuseTargets: toStringArray(value.componentReuseTargets),
		tokenRules: toStringArray(value.tokenRules),
		responsiveRules: toStringArray(value.responsiveRules),
		doNotChange: toStringArray(value.doNotChange),
		acceptanceChecks: toStringArray(value.acceptanceChecks),
		updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : fallback.updatedAt,
	};
}

export function summarizeDesignContextForPrompt(designContext: DesignContextArtifact | null): string[] {
	if (!designContext) {
		return [];
	}
	return [
		...(designContext.summary ? [`Summary: ${designContext.summary}`, ''] : []),
		...prefixLines('Layout Constraints', designContext.layoutConstraints),
		...prefixLines('Component Reuse Targets', designContext.componentReuseTargets),
		...prefixLines('Token Rules', designContext.tokenRules),
		...prefixLines('Responsive Rules', designContext.responsiveRules),
		...prefixLines('Do Not Change', designContext.doNotChange),
		...prefixLines('Acceptance Checks', designContext.acceptanceChecks),
	];
}

function prefixLines(label: string, values: string[]): string[] {
	if (values.length === 0) {
		return [];
	}
	return [label, ...values.map(value => `- ${value}`), ''];
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}