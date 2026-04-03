import * as fs from 'fs';
import { DesignContextArtifact, DesignContextScope, UserStory } from './types';
import {
	ensurePrdDirectories,
	getDesignContextPath,
	getModuleDesignContextPath,
	getProjectDesignContextPath,
	getScreenDesignContextPath,
} from './workspacePaths';

export interface DesignContextValidationResult {
	artifact: DesignContextArtifact;
	errors: string[];
	isValid: boolean;
}

export interface VisualDesignContextDraftPromptInput {
	workspaceRoot: string;
	targetScope: DesignContextScope;
	targetScopeId: string;
	targetFilePath: string;
	completionSignalPath: string;
	completionSignalKey: string;
	story?: UserStory;
	figmaUrl?: string;
	screenshotPaths: string[];
	referenceDocs: string[];
	additionalInstructions?: string;
	existingContextLines?: string[];
}

export interface StoryDesignContextSuggestionPromptInput {
	workspaceRoot: string;
	targetFilePath: string;
	completionSignalPath: string;
	completionSignalKey: string;
	story: UserStory;
	sharedContextLines: string[];
	existingStoryContextLines?: string[];
	additionalInstructions?: string;
}

export interface StoryDesignContextBatchMatchPromptInput {
	workspaceRoot: string;
	targetFilePath: string;
	completionSignalPath: string;
	completionSignalKey: string;
	candidateStories: UserStory[];
	candidateDrafts: Array<{
		reference: string;
		summaryLines: string[];
	}>;
}

export interface StoryDesignContextBatchMatchDecision {
	storyId: string;
	linkedReferences: string[];
	reason?: string;
}

export interface StoryDesignContextBatchMatchResult {
	matches: StoryDesignContextBatchMatchDecision[];
}

export interface ExecutionDesignContextSynthesisOptions {
	maxScreenshotPaths?: number;
	maxReferenceDocs?: number;
	maxAcceptanceChecks?: number;
}

export interface SharedDesignContextTarget {
	scope: Exclude<DesignContextScope, 'story'>;
	scopeId: string;
	artifact: DesignContextArtifact;
}

export interface ReviewStoryDesignContextDraftOptions {
	existingContext?: Partial<DesignContextArtifact> | null;
	sharedContext?: DesignContextArtifact | null;
	linkedReferences?: string[];
}

interface DesignContextLayer {
	scope: DesignContextScope;
	scopeId: string;
	artifact: DesignContextArtifact;
}

export function createEmptyDesignContext(storyId: string, options?: { scope?: DesignContextScope; scopeId?: string }): DesignContextArtifact {
	const scope = options?.scope ?? 'story';
	const scopeId = options?.scopeId ?? storyId;
	return {
		storyId,
		scope,
		scopeId,
		inheritsFrom: [],
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

export function writeProjectDesignContext(workspaceRoot: string, designContext: Partial<DesignContextArtifact>): string {
	return writeScopedDesignContext(workspaceRoot, 'project', 'project', designContext);
}

export function writeScreenDesignContext(workspaceRoot: string, screenId: string, designContext: Partial<DesignContextArtifact>): string {
	return writeScopedDesignContext(workspaceRoot, 'screen', screenId, designContext);
}

export function writeModuleDesignContext(workspaceRoot: string, moduleId: string, designContext: Partial<DesignContextArtifact>): string {
	return writeScopedDesignContext(workspaceRoot, 'module', moduleId, designContext);
}

export function writeDesignContextForScope(
	workspaceRoot: string,
	scope: DesignContextScope,
	scopeId: string,
	designContext: Partial<DesignContextArtifact>,
): string {
	if (scope === 'project') {
		return writeProjectDesignContext(workspaceRoot, designContext);
	}
	if (scope === 'screen') {
		return writeScreenDesignContext(workspaceRoot, scopeId, designContext);
	}
	if (scope === 'module') {
		return writeModuleDesignContext(workspaceRoot, scopeId, designContext);
	}
	return writeDesignContext(workspaceRoot, scopeId, designContext);
}

export function readDesignContext(workspaceRoot: string, storyId: string): DesignContextArtifact | null {
	return readDesignContextFile(getDesignContextPath(workspaceRoot, storyId), storyId);
}

export function readProjectDesignContext(workspaceRoot: string): DesignContextArtifact | null {
	return readDesignContextFile(getProjectDesignContextPath(workspaceRoot), '__project__');
}

export function readScreenDesignContext(workspaceRoot: string, screenId: string): DesignContextArtifact | null {
	return readDesignContextFile(getScreenDesignContextPath(workspaceRoot, screenId), `screen:${screenId}`);
}

export function readModuleDesignContext(workspaceRoot: string, moduleId: string): DesignContextArtifact | null {
	return readDesignContextFile(getModuleDesignContextPath(workspaceRoot, moduleId), `module:${moduleId}`);

}

export function readDesignContextForScope(workspaceRoot: string, scope: DesignContextScope, scopeId: string): DesignContextArtifact | null {
	if (scope === 'project') {
		return readProjectDesignContext(workspaceRoot);
	}
	if (scope === 'screen') {
		return readScreenDesignContext(workspaceRoot, scopeId);
	}
	if (scope === 'module') {
		return readModuleDesignContext(workspaceRoot, scopeId);
	}
	return readDesignContext(workspaceRoot, scopeId);
}

export function hasAnyDesignContextForStory(workspaceRoot: string, story: UserStory): boolean {
	return resolveDesignContextForStory(workspaceRoot, story) !== null;

}

export function hasStoryLevelDesignContext(workspaceRoot: string, storyId: string): boolean {
	return readDesignContext(workspaceRoot, storyId) !== null;
}

export function resolveSharedDesignContextForStory(workspaceRoot: string, story: UserStory): DesignContextArtifact | null {
	const layers = getDesignContextLayersForStory(workspaceRoot, story, { includeStoryLayer: false });
	if (layers.length === 0) {
		return null;
	}

	const mergedArtifact = mergeDesignContextLayers(story.id, layers);
	return hasMeaningfulDesignContext(mergedArtifact) ? mergedArtifact : null;
}

export function resolveDesignContextForStory(workspaceRoot: string, story: UserStory): DesignContextArtifact | null {
	const layers = getDesignContextLayersForStory(workspaceRoot, story);
	if (layers.length === 0) {
		return null;
	}

	const mergedArtifact = mergeDesignContextLayers(story.id, layers);
	return hasMeaningfulDesignContext(mergedArtifact) ? mergedArtifact : null;
}

export function listAvailableSharedDesignContextTargets(workspaceRoot: string, story: UserStory): SharedDesignContextTarget[] {
	const targets: SharedDesignContextTarget[] = [];
	const seen = new Set<string>();
	const storyContext = readDesignContext(workspaceRoot, story.id);
	const explicitRefs = parseInheritedDesignContextReferences(storyContext?.inheritsFrom);

	const projectContext = readProjectDesignContext(workspaceRoot);
	if (projectContext) {
		pushSharedTarget(targets, seen, 'project', 'project', projectContext);
	}

	for (const screenId of Array.from(new Set([...extractDesignContextCandidates(story, 'screen'), ...explicitRefs.screens]))) {
		const artifact = readScreenDesignContext(workspaceRoot, screenId);
		if (artifact) {
			pushSharedTarget(targets, seen, 'screen', screenId, artifact);
		}
	}

	for (const moduleId of Array.from(new Set([...extractDesignContextCandidates(story, 'module'), ...explicitRefs.modules]))) {
		const artifact = readModuleDesignContext(workspaceRoot, moduleId);
		if (artifact) {
			pushSharedTarget(targets, seen, 'module', moduleId, artifact);
		}
	}

	return targets;
}

export function mergeSharedDesignContextTargets(storyId: string, targets: SharedDesignContextTarget[]): DesignContextArtifact | null {
	if (targets.length === 0) {
		return null;
	}

	const merged = mergeDesignContextLayers(storyId, targets.map(target => ({
		scope: target.scope,
		scopeId: target.scopeId,
		artifact: target.artifact,
	})));

	return hasMeaningfulDesignContext(merged) ? merged : null;
}

export function createReviewStoryDesignContextDraft(
	story: UserStory,
	options?: ReviewStoryDesignContextDraftOptions,
): DesignContextArtifact {
	const existing = options?.existingContext
		? normalizeDesignContext({
			...options.existingContext,
			scope: 'story',
			scopeId: story.id,
		}, story.id)
		: null;
	const shared = options?.sharedContext ? normalizeDesignContext(options.sharedContext, story.id) : null;
	const linkedReferences = mergeStringLists(
		options?.linkedReferences ?? shared?.inheritsFrom ?? [],
		existing?.inheritsFrom ?? [],
	);
	const draft = existing ?? createEmptyDesignContext(story.id, { scope: 'story', scopeId: story.id });

	draft.scope = 'story';
	draft.scopeId = story.id;
	draft.storyId = story.id;
	draft.inheritsFrom = linkedReferences;

	if (!existing) {
		draft.sourceType = 'notes';
		draft.figmaUrl = undefined;
		draft.screenshotPaths = [];
		draft.referenceDocs = [];
		draft.manualNotes = [];
		draft.layoutConstraints = [];
		draft.componentReuseTargets = [];
		draft.tokenRules = [];
		draft.responsiveRules = [];
		draft.doNotChange = [];
	}

	if (!draft.summary) {
		draft.summary = buildReviewDraftSummary(story, shared);
	}

	if (!draft.pageOrScreenName) {
		draft.pageOrScreenName = shared?.pageOrScreenName ?? extractDesignContextCandidates(story, 'screen')[0];
	}

	if (draft.acceptanceChecks.length === 0) {
		draft.acceptanceChecks = deriveStorySpecificAcceptanceChecks(story, shared);
	}

	draft.updatedAt = new Date().toISOString();
	return normalizeDesignContext(draft, story.id);
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
	const fallbackScope = normalizeScope((value as Partial<DesignContextArtifact> | undefined)?.scope) ?? 'story';
	const fallbackScopeId = normalizeOptionalString((value as Partial<DesignContextArtifact> | undefined)?.scopeId) ?? storyId;
	const fallback = createEmptyDesignContext(storyId, {
		scope: fallbackScope,
		scopeId: fallbackScopeId,
	});
	if (!value) {
		return fallback;
	}
	return {
		storyId,
		scope: normalizeScope(value.scope) ?? fallback.scope,
		scopeId: normalizeOptionalString(value.scopeId) ?? fallback.scopeId,
		inheritsFrom: toStringArray(value.inheritsFrom),
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

	if (designContext.inheritsFrom && designContext.inheritsFrom.length > 0) {
		lines.push(`Context Layers: ${designContext.inheritsFrom.join(' > ')}`);
	}

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

export function buildVisualDesignContextDraftPrompt(input: VisualDesignContextDraftPromptInput): string {
	const visualSources: string[] = [];
	if (input.figmaUrl) {
		visualSources.push(`Figma URL: ${input.figmaUrl}`);
	}
	if (input.screenshotPaths.length > 0) {
		visualSources.push(`Screenshot files: ${input.screenshotPaths.join('; ')}`);
	}
	if (input.referenceDocs.length > 0) {
		visualSources.push(`Reference docs: ${input.referenceDocs.join('; ')}`);
	}

	const targetScopeLine = input.targetScope === 'project'
		? 'Create reusable project-level design defaults that can be inherited broadly.'
		: input.targetScope === 'screen'
			? `Create reusable screen-level design context for screen identifier "${input.targetScopeId}".`
			: input.targetScope === 'module'
				? `Create reusable module-level design context for module identifier "${input.targetScopeId}".`
				: `Create story-specific design context for story ${input.story?.id ?? input.targetScopeId}.`;

	const lines = [
		'Analyze the provided visual design references and generate a structured design-context draft as valid JSON.',
		`Workspace root: ${input.workspaceRoot}`,
		`Target scope: ${input.targetScope}`,
		`Target scope id: ${input.targetScopeId}`,
		`Write the JSON artifact directly to: ${input.targetFilePath}`,
		`After the artifact is fully written, update the entry "${input.completionSignalKey}" in ${input.completionSignalPath} to the exact text completed and preserve valid JSON for the whole file.`,
		'',
	];

	if (input.story) {
		lines.push(
			'Current story context:',
			`- Story ID: ${input.story.id}`,
			`- Title: ${input.story.title}`,
			`- Description: ${input.story.description}`,
			`- Acceptance Criteria: ${input.story.acceptanceCriteria.join(' | ')}`,
			'',
		);
	} else {
		lines.push(
			'Current story context:',
			'- No user story is associated with this draft. Build reusable UI guidance from the visual references only.',
			'',
		);
	}

	lines.push(
		'Visual inputs:',
		...(visualSources.length > 0 ? visualSources.map(source => `- ${source}`) : ['- No visual inputs provided.']),
		'',
		targetScopeLine,
		'Produce structured implementation constraints rather than raw observations or long freeform notes.',
		'Prioritize layout constraints, reusable components, token rules, responsive behavior, protected areas, and visual acceptance checks.',
		'Infer concise manualNotes only when they add implementation value beyond the structured fields.',
		'If both screenshots and a Figma URL are provided, reconcile them into one coherent draft instead of duplicating points.',
		'Preserve only the most reusable guidance for project, screen, or module scopes; avoid writing story-only details into shared artifacts.',
		'Do not modify prd.json.',
		'',
		'The JSON must match this schema exactly:',
		'{',
		'  "storyId": "string",',
		'  "scope": "project | screen | module | story",',
		'  "scopeId": "string",',
		'  "inheritsFrom": ["string"],',
		'  "sourceType": "figma | screenshots | notes",',
		'  "figmaUrl": "string optional",',
		'  "screenshotPaths": ["string"],',
		'  "manualNotes": ["string"],',
		'  "referenceDocs": ["string"],',
		'  "summary": "string",',
		'  "pageOrScreenName": "string optional",',
		'  "layoutConstraints": ["string"],',
		'  "componentReuseTargets": ["string"],',
		'  "tokenRules": ["string"],',
		'  "responsiveRules": ["string"],',
		'  "doNotChange": ["string"],',
		'  "acceptanceChecks": ["string"],',
		'  "updatedAt": "ISO timestamp string"',
		'}',
		'',
		`Set scope to "${input.targetScope}" and scopeId to "${input.targetScopeId}".`,
		`For shared scopes, keep storyId aligned with the shared artifact identity rather than forcing story-only ids.`,
		`Use sourceType "${input.figmaUrl ? 'figma' : input.screenshotPaths.length > 0 ? 'screenshots' : 'notes'}" unless the references clearly justify a different primary source.`,
	);

	if (input.existingContextLines && input.existingContextLines.length > 0) {
		lines.push('', 'Existing applicable design context:', ...input.existingContextLines.map(line => line.length > 0 ? line : ''));
	}

	if (input.additionalInstructions && input.additionalInstructions.trim().length > 0) {
		lines.push('', `Additional instructions: ${input.additionalInstructions.trim()}`);
	}

	return lines.join('\n');
}

export function buildStoryDesignContextSuggestionPrompt(input: StoryDesignContextSuggestionPromptInput): string {
	const lines = [
		'Use the current user story plus the inherited shared design context to generate a suggested story-level design-context override as valid JSON.',
		`Workspace root: ${input.workspaceRoot}`,
		`Write the suggested story-level artifact directly to: ${input.targetFilePath}`,
		`After the artifact is fully written, update the entry "${input.completionSignalKey}" in ${input.completionSignalPath} to the exact text completed and preserve valid JSON for the whole file.`,
		'Do not modify prd.json.',
		'',
		'Current story context:',
		`- Story ID: ${input.story.id}`,
		`- Title: ${input.story.title}`,
		`- Description: ${input.story.description}`,
		`- Acceptance Criteria: ${input.story.acceptanceCriteria.join(' | ')}`,
		'',
		'Inherited shared design context already available to this story:',
		...(input.sharedContextLines.length > 0 ? input.sharedContextLines : ['- No shared design context was provided.']),
		'',
		'Goal:',
		'Suggest only story-specific deltas. Do not repeat inherited project, screen, or module constraints unless the story needs to refine or override them.',
		'Focus on what is uniquely necessary for this story: additional layout constraints, component reuse requirements, token rules, responsive changes, protected areas, and visual acceptance checks.',
		'Keep the summary and manual notes concise and implementation-focused.',
		'Prefer additions over restating inherited context verbatim.',
		'',
		'The JSON must match this schema exactly:',
		'{',
		'  "storyId": "string",',
		'  "scope": "story",',
		'  "scopeId": "string",',
		'  "inheritsFrom": ["string"],',
		'  "sourceType": "figma | screenshots | notes",',
		'  "figmaUrl": "string optional",',
		'  "screenshotPaths": ["string"],',
		'  "manualNotes": ["string"],',
		'  "referenceDocs": ["string"],',
		'  "summary": "string",',
		'  "pageOrScreenName": "string optional",',
		'  "layoutConstraints": ["string"],',
		'  "componentReuseTargets": ["string"],',
		'  "tokenRules": ["string"],',
		'  "responsiveRules": ["string"],',
		'  "doNotChange": ["string"],',
		'  "acceptanceChecks": ["string"],',
		'  "updatedAt": "ISO timestamp string"',
		'}',
		'',
		`Set storyId to "${input.story.id}", scope to "story", and scopeId to "${input.story.id}".`,
		'If no extra override is needed for a field, leave it empty instead of copying inherited values.',
	];

	if (input.existingStoryContextLines && input.existingStoryContextLines.length > 0) {
		lines.push('', 'Existing story-specific design context to refine if useful:', ...input.existingStoryContextLines.map(line => line.length > 0 ? line : ''));
	}

	if (input.additionalInstructions && input.additionalInstructions.trim().length > 0) {
		lines.push('', `Additional instructions: ${input.additionalInstructions.trim()}`);
	}

	return lines.join('\n');
}

export function buildStoryDesignContextBatchMatchPrompt(input: StoryDesignContextBatchMatchPromptInput): string {
	const lines = [
		'Use the selected reusable design-context resources plus the candidate user stories to decide which stories should inherit which resources.',
		`Workspace root: ${input.workspaceRoot}`,
		`Write the JSON match result directly to: ${input.targetFilePath}`,
		`After the artifact is fully written, update the entry "${input.completionSignalKey}" in ${input.completionSignalPath} to the exact text completed and preserve valid JSON for the whole file.`,
		'Do not modify prd.json or any story design-context files directly.',
		'',
		'Goal:',
		'Determine which candidate stories are genuinely related to the selected reusable design resources.',
		'It is valid for zero, some, or all candidate stories to match.',
		'Only include a story in the output if at least one selected reusable design resource is clearly relevant to that story.',
		'If a story is not meaningfully related, omit it from the matches array entirely.',
		'Only use linkedReferences values from the selected candidate resources listed below.',
		'',
		'Selected reusable design resources:',
	];

	for (const draft of input.candidateDrafts) {
		lines.push(`- Reference: ${draft.reference}`);
		for (const summaryLine of draft.summaryLines.length > 0 ? draft.summaryLines : ['- No summary available.']) {
			lines.push(summaryLine.startsWith('- ') ? `  ${summaryLine}` : `  - ${summaryLine}`);
		}
	}

	lines.push('', 'Candidate stories:');
	for (const story of input.candidateStories) {
		lines.push(`- Story ID: ${story.id}`);
		lines.push(`  - Title: ${story.title}`);
		lines.push(`  - Description: ${story.description}`);
		lines.push(`  - Acceptance Criteria: ${story.acceptanceCriteria.join(' | ')}`);
		if (story.status) {
			lines.push(`  - PRD Status: ${story.status}`);
		}
	}

	lines.push(
		'',
		'The JSON must match this schema exactly:',
		'{',
		'  "matches": [',
		'    {',
		'      "storyId": "string",',
		'      "linkedReferences": ["project:project | screen:<id> | module:<id>"],',
		'      "reason": "string optional"',
		'    }',
		'  ]',
		'}',
		'',
		'Rules:',
		'- Do not include duplicate storyId entries.',
		'- Do not include duplicate linkedReferences entries.',
		'- Do not invent references outside the selected candidate resources.',
		'- Omit unrelated stories instead of forcing a weak match.',
	);

	return lines.join('\n');
}

export function normalizeStoryDesignContextBatchMatchResult(
	raw: unknown,
	candidateStories: UserStory[],
	allowedReferences: string[],
): StoryDesignContextBatchMatchResult {
	const allowedStoryIds = new Set(candidateStories.map(story => story.id));
	const allowedReferenceSet = new Set(toUniqueTrimmedStrings(allowedReferences));
	const rawMatches = isRecord(raw) && Array.isArray(raw.matches) ? raw.matches : [];
	const byStoryId = new Map<string, StoryDesignContextBatchMatchDecision>();

	for (const match of rawMatches) {
		if (!isRecord(match) || typeof match.storyId !== 'string') {
			continue;
		}

		const storyId = match.storyId.trim();
		if (storyId.length === 0 || !allowedStoryIds.has(storyId)) {
			continue;
		}

		const linkedReferences = toUniqueTrimmedStrings(Array.isArray(match.linkedReferences) ? match.linkedReferences : [])
			.filter(reference => allowedReferenceSet.has(reference));
		if (linkedReferences.length === 0) {
			continue;
		}

		const existing = byStoryId.get(storyId);
		const reason = typeof match.reason === 'string' && match.reason.trim().length > 0
			? match.reason.trim()
			: undefined;
		if (existing) {
			existing.linkedReferences = toUniqueTrimmedStrings([...existing.linkedReferences, ...linkedReferences]);
			existing.reason = existing.reason ?? reason;
			continue;
		}

		byStoryId.set(storyId, {
			storyId,
			linkedReferences,
			reason,
		});
	}

	return {
		matches: Array.from(byStoryId.values()),
	};
}

export function createStoryDesignContextOverride(
	storyId: string,
	suggestedContext: Partial<DesignContextArtifact> | null | undefined,
	sharedContext: DesignContextArtifact | null,
): DesignContextArtifact {
	const normalizedSuggestion = normalizeDesignContext({
		...suggestedContext,
		scope: 'story',
		scopeId: storyId,
	}, storyId);

	const shared = sharedContext ? normalizeDesignContext(sharedContext, storyId) : null;
	const override = createEmptyDesignContext(storyId, { scope: 'story', scopeId: storyId });
	override.inheritsFrom = shared?.inheritsFrom ?? [];
	override.sourceType = normalizedSuggestion.sourceType;
	override.figmaUrl = pickOverrideString(normalizedSuggestion.figmaUrl, shared?.figmaUrl);
	override.screenshotPaths = subtractStringLists(normalizedSuggestion.screenshotPaths, shared?.screenshotPaths ?? []);
	override.manualNotes = subtractStringLists(normalizedSuggestion.manualNotes, shared?.manualNotes ?? []);
	override.referenceDocs = subtractStringLists(normalizedSuggestion.referenceDocs, shared?.referenceDocs ?? []);
	override.summary = pickOverrideString(normalizedSuggestion.summary, shared?.summary) ?? '';
	override.pageOrScreenName = pickOverrideString(normalizedSuggestion.pageOrScreenName, shared?.pageOrScreenName);
	override.layoutConstraints = subtractStringLists(normalizedSuggestion.layoutConstraints, shared?.layoutConstraints ?? []);
	override.componentReuseTargets = subtractStringLists(normalizedSuggestion.componentReuseTargets, shared?.componentReuseTargets ?? []);
	override.tokenRules = subtractStringLists(normalizedSuggestion.tokenRules, shared?.tokenRules ?? []);
	override.responsiveRules = subtractStringLists(normalizedSuggestion.responsiveRules, shared?.responsiveRules ?? []);
	override.doNotChange = subtractStringLists(normalizedSuggestion.doNotChange, shared?.doNotChange ?? []);
	override.acceptanceChecks = subtractStringLists(normalizedSuggestion.acceptanceChecks, shared?.acceptanceChecks ?? []);
	override.updatedAt = normalizedSuggestion.updatedAt;

	if (!hasMeaningfulDesignContext(override)) {
		override.sourceType = 'notes';
		override.summary = 'No additional story-specific design overrides beyond inherited shared context.';
	}

	return override;
}

export function synthesizeExecutionDesignContextPromptLines(
	story: UserStory,
	sharedContext: DesignContextArtifact | null,
	options?: ExecutionDesignContextSynthesisOptions,
): string[] {
	const maxLines = 10;
	const screenshotLimit = options?.maxScreenshotPaths ?? 2;
	const referenceDocLimit = options?.maxReferenceDocs ?? 2;
	const acceptanceLimit = options?.maxAcceptanceChecks ?? 2;
	const storyFocus = buildStoryExecutionFocus(story);
	const lines: string[] = [
		'Synthesis Mode: execution-time fallback',
		`Story Focus: ${storyFocus}`,
	];
	const optionalLines: string[] = [];

	if (sharedContext) {
		const shared = normalizeDesignContext(sharedContext, story.id);
		lines.push(`Primary Source: ${shared.sourceType}`);

		if (shared.pageOrScreenName) {
			optionalLines.push(`Shared Screen: ${shared.pageOrScreenName}`);
		}

		if (shared.summary) {
			optionalLines.push(`Inherited Intent: ${shared.summary}`);
		}

		const visualInputs = summarizeAvailableVisualInputs(shared, screenshotLimit, referenceDocLimit);
		if (visualInputs) {
			optionalLines.push(`Visual Inputs: ${visualInputs}`);
		}

		const layoutFocus = summarizeListForExecution(shared.layoutConstraints, 2);
		if (layoutFocus) {
			optionalLines.push(`Layout Focus: ${layoutFocus}`);
		}

		const reuseFocus = summarizeListForExecution(shared.componentReuseTargets, 2);
		if (reuseFocus) {
			optionalLines.push(`Reuse Focus: ${reuseFocus}`);
		}

		const tokenFocus = summarizeListForExecution(shared.tokenRules, 2);
		if (tokenFocus) {
			optionalLines.push(`Token Focus: ${tokenFocus}`);
		}

		const acceptanceFocus = summarizeCombinedAcceptanceChecks(shared.acceptanceChecks, story.acceptanceCriteria, acceptanceLimit);
		if (acceptanceFocus) {
			optionalLines.push(`Acceptance Focus: ${acceptanceFocus}`);
		}

		const responsiveFocus = summarizeListForExecution(shared.responsiveRules, 2);
		if (responsiveFocus) {
			optionalLines.push(`Responsive Focus: ${responsiveFocus}`);
		}

		const protectedAreas = summarizeListForExecution(shared.doNotChange, 2);
		if (protectedAreas) {
			optionalLines.push(`Protected Areas: ${protectedAreas}`);
		}
	} else {
		lines.push('Primary Source: story metadata');
		const acceptanceFocus = summarizeListForExecution(story.acceptanceCriteria, acceptanceLimit);
		if (acceptanceFocus) {
			optionalLines.push(`Acceptance Focus: ${acceptanceFocus}`);
		}
	}

	for (const line of optionalLines) {
		if (lines.length >= maxLines) {
			break;
		}
		lines.push(line);
	}

	return lines;
}

function writeScopedDesignContext(
	workspaceRoot: string,
	scope: DesignContextScope,
	scopeId: string,
	designContext: Partial<DesignContextArtifact>,
): string {
	ensurePrdDirectories(workspaceRoot);
	const filePath = getScopedDesignContextPath(workspaceRoot, scope, scopeId);
	const validation = validateDesignContext({
		...designContext,
		scope,
		scopeId,
	}, scope === 'project' ? '__project__' : `${scope}:${scopeId}`);
	fs.writeFileSync(filePath, `${JSON.stringify(validation.artifact, null, 2)}\n`, 'utf-8');
	return filePath;
}

function readDesignContextFile(filePath: string, storyId: string): DesignContextArtifact | null {
	try {
		const content = fs.readFileSync(filePath, 'utf-8');
		return normalizeDesignContext(JSON.parse(content) as Partial<DesignContextArtifact>, storyId);
	} catch {
		return null;
	}
}

function getScopedDesignContextPath(workspaceRoot: string, scope: DesignContextScope, scopeId: string): string {
	if (scope === 'project') {
		return getProjectDesignContextPath(workspaceRoot);
	}
	if (scope === 'screen') {
		return getScreenDesignContextPath(workspaceRoot, scopeId);
	}
	if (scope === 'module') {
		return getModuleDesignContextPath(workspaceRoot, scopeId);
	}
	return getDesignContextPath(workspaceRoot, scopeId);
}

function getDesignContextLayersForStory(
	workspaceRoot: string,
	story: UserStory,
	options?: { includeStoryLayer?: boolean },
): DesignContextLayer[] {
	const layers: DesignContextLayer[] = [];
	const includeStoryLayer = options?.includeStoryLayer ?? true;
	const storyContext = readDesignContext(workspaceRoot, story.id);
	const explicitRefs = parseInheritedDesignContextReferences(storyContext?.inheritsFrom);

	const projectContext = readProjectDesignContext(workspaceRoot);
	if (projectContext) {
		layers.push({
			scope: 'project',
			scopeId: 'project',
			artifact: projectContext,
		});
	}

	for (const screenId of Array.from(new Set([...extractDesignContextCandidates(story, 'screen'), ...explicitRefs.screens]))) {
		const screenContext = readScreenDesignContext(workspaceRoot, screenId);
		if (screenContext) {
			layers.push({
				scope: 'screen',
				scopeId: screenId,
				artifact: screenContext,
			});
		}
	}

	for (const moduleId of Array.from(new Set([...extractDesignContextCandidates(story, 'module'), ...explicitRefs.modules]))) {
		const moduleContext = readModuleDesignContext(workspaceRoot, moduleId);
		if (moduleContext) {
			layers.push({
				scope: 'module',
				scopeId: moduleId,
				artifact: moduleContext,
			});
		}
	}

	if (includeStoryLayer) {
		if (storyContext) {
			layers.push({
				scope: 'story',
				scopeId: story.id,
				artifact: storyContext,
			});
		}
	}

	return layers;
}

function extractDesignContextCandidates(story: UserStory, target: 'screen' | 'module'): string[] {
	const keys = target === 'screen'
		? ['screenId', 'screenName', 'page', 'pageName', 'pageOrScreenName', 'screen']
		: ['module', 'moduleName'];
	const arrayKeys = target === 'screen'
		? ['screenIds', 'screens', 'pages']
		: ['moduleHints', 'modules', 'moduleNames'];

	const values: string[] = [];
	for (const key of keys) {
		const rawValue = story[key];
		if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
			values.push(rawValue.trim());
		}
	}

	for (const key of arrayKeys) {
		const rawValue = story[key];
		if (!Array.isArray(rawValue)) {
			continue;
		}
		for (const item of rawValue) {
			if (typeof item === 'string' && item.trim().length > 0) {
				values.push(item.trim());
			}
		}
	}

	return Array.from(new Set(values));
}

function parseInheritedDesignContextReferences(references: string[] | undefined): {
	project: boolean;
	screens: string[];
	modules: string[];
} {
	const screens: string[] = [];
	const modules: string[] = [];
	let project = false;

	for (const reference of references ?? []) {
		const separatorIndex = reference.indexOf(':');
		if (separatorIndex <= 0) {
			continue;
		}

		const scope = reference.slice(0, separatorIndex).trim();
		const scopeId = reference.slice(separatorIndex + 1).trim();
		if (!scopeId) {
			continue;
		}

		if (scope === 'project') {
			project = true;
			continue;
		}
		if (scope === 'screen') {
			screens.push(scopeId);
			continue;
		}
		if (scope === 'module') {
			modules.push(scopeId);
		}
	}

	return {
		project,
		screens: Array.from(new Set(screens)),
		modules: Array.from(new Set(modules)),
	};
}

function pushSharedTarget(
	targets: SharedDesignContextTarget[],
	seen: Set<string>,
	scope: SharedDesignContextTarget['scope'],
	scopeId: string,
	artifact: DesignContextArtifact,
): void {
	const key = `${scope}:${scopeId}`;
	if (seen.has(key)) {
		return;
	}
	seen.add(key);
	targets.push({ scope, scopeId, artifact });
}

function mergeDesignContextLayers(storyId: string, layers: DesignContextLayer[]): DesignContextArtifact {
	const merged = createEmptyDesignContext(storyId);
	merged.inheritsFrom = layers.map(layer => `${layer.scope}:${layer.scopeId}`);
	merged.scope = 'story';
	merged.scopeId = storyId;
	merged.storyId = storyId;

	let latestUpdatedAt = merged.updatedAt;

	for (const layer of layers) {
		const artifact = layer.artifact;
		merged.sourceType = artifact.sourceType || merged.sourceType;
		merged.figmaUrl = artifact.figmaUrl ?? merged.figmaUrl;
		merged.referenceDocs = mergeStringLists(merged.referenceDocs, artifact.referenceDocs);
		merged.screenshotPaths = mergeStringLists(merged.screenshotPaths, artifact.screenshotPaths);
		merged.manualNotes = mergeStringLists(merged.manualNotes, artifact.manualNotes);
		merged.layoutConstraints = mergeStringLists(merged.layoutConstraints, artifact.layoutConstraints);
		merged.componentReuseTargets = mergeStringLists(merged.componentReuseTargets, artifact.componentReuseTargets);
		merged.tokenRules = mergeStringLists(merged.tokenRules, artifact.tokenRules);
		merged.responsiveRules = mergeStringLists(merged.responsiveRules, artifact.responsiveRules);
		merged.doNotChange = mergeStringLists(merged.doNotChange, artifact.doNotChange);
		merged.acceptanceChecks = mergeStringLists(merged.acceptanceChecks, artifact.acceptanceChecks);
		merged.summary = artifact.summary || merged.summary;
		merged.pageOrScreenName = artifact.pageOrScreenName ?? merged.pageOrScreenName;
		if (isLaterTimestamp(artifact.updatedAt, latestUpdatedAt)) {
			latestUpdatedAt = artifact.updatedAt;
		}
	}

	merged.updatedAt = latestUpdatedAt;
	return merged;
}

function mergeStringLists(base: string[], addition: string[]): string[] {
	return Array.from(new Set([...base, ...addition]));
}

function subtractStringLists(base: string[], inherited: string[]): string[] {
	const inheritedValues = new Set(inherited.map(value => value.toLowerCase()));
	return base.filter(value => !inheritedValues.has(value.toLowerCase()));
}

function hasMeaningfulDesignContext(artifact: DesignContextArtifact): boolean {
	return Boolean(
		artifact.summary
		|| artifact.figmaUrl
		|| artifact.pageOrScreenName
		|| artifact.referenceDocs.length > 0
		|| artifact.screenshotPaths.length > 0
		|| artifact.manualNotes.length > 0
		|| artifact.layoutConstraints.length > 0
		|| artifact.componentReuseTargets.length > 0
		|| artifact.tokenRules.length > 0
		|| artifact.responsiveRules.length > 0
		|| artifact.doNotChange.length > 0
		|| artifact.acceptanceChecks.length > 0
	);
}

function normalizeScope(value: unknown): DesignContextScope | undefined {
	if (value === 'project' || value === 'screen' || value === 'module' || value === 'story') {
		return value;
	}
	return undefined;
}

function isLaterTimestamp(candidate: string | undefined, current: string | undefined): boolean {
	if (!candidate) {
		return false;
	}
	if (!current) {
		return true;
	}
	const candidateTime = Date.parse(candidate);
	const currentTime = Date.parse(current);
	if (Number.isNaN(candidateTime)) {
		return false;
	}
	if (Number.isNaN(currentTime)) {
		return true;
	}
	return candidateTime > currentTime;
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

function pickOverrideString(value: string | undefined, inherited: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	if (!inherited) {
		return value;
	}
	return value === inherited ? undefined : value;
}

function buildReviewDraftSummary(story: UserStory, shared: DesignContextArtifact | null): string {
	const title = normalizeOptionalString(story.title) ?? story.id;
	if (shared?.summary) {
		return `${title}: review inherited shared design context and record only story-specific visual deltas.`;
	}
	return `${title}: capture only the visual constraints that are unique to this story.`;
}

function deriveStorySpecificAcceptanceChecks(story: UserStory, shared: DesignContextArtifact | null): string[] {
	const inherited = new Set((shared?.acceptanceChecks ?? []).map(check => check.toLowerCase()));
	return story.acceptanceCriteria
		.map(check => check.trim())
		.filter(check => check.length > 0 && !inherited.has(check.toLowerCase()))
		.slice(0, 3);
}

function buildStoryExecutionFocus(story: UserStory): string {
	const focusParts = [story.title.trim()];
	const description = normalizeOptionalString(story.description);
	if (description) {
		focusParts.push(description);
	}
	return focusParts.join(' — ');
}

function summarizeAvailableVisualInputs(
	artifact: DesignContextArtifact,
	maxScreenshotPaths: number,
	maxReferenceDocs: number,
): string | null {
	const inputs: string[] = [];
	if (artifact.figmaUrl) {
		inputs.push('Figma available');
	}
	if (artifact.screenshotPaths.length > 0) {
		inputs.push(`Screenshots: ${artifact.screenshotPaths.slice(0, maxScreenshotPaths).join('; ')}`);
	}
	if (artifact.referenceDocs.length > 0) {
		inputs.push(`Docs: ${artifact.referenceDocs.slice(0, maxReferenceDocs).join('; ')}`);
	}
	return inputs.length > 0 ? inputs.join(' | ') : null;
}

function summarizeListForExecution(values: string[], limit: number): string | null {
	if (values.length === 0) {
		return null;
	}
	return values.slice(0, limit).join('; ');
}

function summarizeCombinedAcceptanceChecks(sharedChecks: string[], storyChecks: string[], limit: number): string | null {
	const values = Array.from(new Set([...sharedChecks, ...storyChecks].map(value => value.trim()).filter(value => value.length > 0)));
	if (values.length === 0) {
		return null;
	}
	return values.slice(0, limit).join('; ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function toUniqueTrimmedStrings(values: unknown[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		if (typeof value !== 'string') {
			continue;
		}
		const trimmed = value.trim();
		if (trimmed.length === 0 || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		result.push(trimmed);
	}
	return result;
}