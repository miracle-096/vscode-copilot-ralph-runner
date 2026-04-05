import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { generateAgentMapArtifacts } from '../agentMap';
import {
	createEmptyKnowledgeCheckReport,
	evaluateKnowledgeCoverage,
	summarizeKnowledgeCheckForPrompt,
} from '../knowledgeCheck';
import {
	composeStoryExecutionPrompt,
	composeStoryRefactorPrompt,
	composeStoryReviewerPrompt,
} from '../promptContext';
import {
	buildProjectConstraintChatAdvicePrompt,
	extractRunnableProjectConstraintRequest,
	buildProjectConstraintsInitializationPrompt,
	createEditableProjectConstraintsTemplate,
	initializeProjectConstraintsArtifacts,
	loadMergedProjectConstraints,
	mergeProjectConstraints,
	normalizeGeneratedProjectConstraints,
	parseEditableProjectConstraints,
	readEditableProjectConstraints,
	readGeneratedProjectConstraints,
	scanWorkspaceForProjectConstraints,
	serializeEditableProjectConstraints,
	summarizeProjectConstraintsForPrompt,
} from '../projectConstraints';
import {
	buildStoryDesignContextBatchMatchPrompt,
	buildStoryDesignContextSuggestionPrompt,
	buildVisualDesignContextDraftPrompt,
	createReviewStoryDesignContextDraft,
	createStoryDesignContextOverride,
	hasDesignContextArtifact,
	hasAnyDesignContextForStory,
	hasStoryLevelDesignContext,
	listAvailableSharedDesignContextTargets,
	mergeSharedDesignContextTargets,
	normalizeStoryDesignContextBatchMatchResult,
	normalizeDesignContext,
	readDesignContext,
	readDesignContextForScope,
	readModuleDesignContext,
	readProjectDesignContext,
	readScreenDesignContext,
	resolveDesignContextForStory,
	synthesizeExecutionDesignContextPromptLines,
	summarizeDesignContextForPrompt,
	validateDesignContext,
	writeModuleDesignContext,
	writeProjectDesignContext,
	writeScreenDesignContext,
	writeDesignContext,
} from '../designContext';
import {
	createSynthesizedTaskMemory,
	hasTaskMemoryArtifact,
	recallRelatedTaskMemories,
	readTaskMemory,
	readTaskMemoryIndex,
	rebuildTaskMemoryIndex,
	summarizeRecalledTaskMemoriesForPrompt,
	summarizeTaskMemoryForPrompt,
	upsertTaskMemoryIndexEntry,
	validateTaskMemory,
	writeTaskMemory,
} from '../taskMemory';
import {
	createSynthesizedExecutionCheckpoint,
	getRecentExecutionCheckpoint,
	hasExecutionCheckpointArtifact,
	listValidExecutionCheckpoints,
	readExecutionCheckpoint,
	summarizeExecutionCheckpointForPrompt,
	validateExecutionCheckpoint,
	writeExecutionCheckpoint,
} from '../executionCheckpoint';
import {
	applyStoryApprovalDecision,
	createSynthesizedStoryEvidence,
	validateStoryEvidence,
	writeStoryEvidence,
	readStoryEvidence,
} from '../storyEvidence';
import {
	buildStoryReviewLoopState,
	createSynthesizedStoryReview,
	DEFAULT_STORY_AUTO_REFACTOR_LIMIT,
	deriveMaxReviewerPasses,
	validateStoryReviewResult,
} from '../storyReview';
import {
	getSourceContextIndex,
	recallRelevantSourceContext,
	refreshSourceContextIndex,
	scanWorkspaceForSourceContextIndex,
	summarizeRecalledSourceContextForPrompt,
	summarizeSourceContextIndexForPrompt,
} from '../sourceContext';
import {
	buildEffectivePolicyConfig,
	decodePolicyCommandOutput,
	deriveStoryChangedFiles,
	evaluatePolicyGates,
} from '../policyGate';
import { PrdFile } from '../types';
import {
	classifyOutputMessage,
	createStoryRunLogRecorder,
	readStoryRunLog,
	summarizeCommandOutput,
} from '../runLog';
import { buildHarnessHelpDocument, getHarnessHelpContent } from '../helpManual';
import { getHarnessLanguagePack } from '../localization';
import {
	buildHarnessMenuOrderEditorHtml,
	normalizeHarnessMenuOrderEditorPayload,
} from '../menuOrderEditor';
import { parseTaskSignalStatus } from '../taskStatus';
import {
	buildHarnessMenuQuickPickItems,
	getReplayStoryRange,
	normalizeHarnessRootMenuOrder,
	persistWorkspacePinnedRootMenuOrderFile,
	resolveHarnessMenuSelection,
	normalizeReviewerAutoRefactorLimit,
	normalizeReviewerLoopEnabled,
	normalizeReviewerPassingScore,
	resolveWorkspaceApprovalPromptMode,
	persistWorkspacePinnedRunnerSettingsFile,
	isHarnessRunnerActive,
	resolveWorkspaceReviewerAutoRefactorLimit,
	resolveWorkspaceReviewerLoopEnabled,
	resolveWorkspaceReviewerPassingScore,
	shouldAbortCopilotWait,
} from '../extension';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('Package exposes a single user-facing UI design command', () => {
		const packageJsonPath = path.resolve(__dirname, '../../package.json');
		const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
				name?: string;
				displayName?: string;
			contributes?: {
				commands?: Array<{ command: string; title: string; }>;
				keybindings?: Array<{ command: string; key?: string; }>;
				configuration?: {
					properties?: Record<string, unknown>;
				};
				chatParticipants?: Array<{
					id: string;
					name: string;
					description?: string;
					commands?: Array<{ name: string; description?: string; }>;
				}>;
			};
		};
		const contributedCommands = packageJson.contributes?.commands ?? [];
		const designCommands = contributedCommands.filter(command =>
			[
					'harness-runner.recordDesignContext',
					'harness-runner.generateDesignContextDraft',
					'harness-runner.suggestStoryDesignContext',
			].includes(command.command)
		);

			assert.strictEqual(packageJson.name, 'harness-runner');
			assert.strictEqual(packageJson.displayName, 'Harness Runner');
			assert.deepStrictEqual(designCommands.map(command => command.command), ['harness-runner.recordDesignContext']);
			assert.strictEqual(designCommands[0]?.title, 'HARNESS: 界面设计描述');
			assert.strictEqual(contributedCommands.some(command => command.command === 'harness-runner.recallTaskMemory'), false);
			assert.strictEqual(contributedCommands.some(command => command.command === 'harness-runner.showIntroduction'), true);
			assert.strictEqual(contributedCommands.some(command => command.command === 'harness-runner.showUsageGuide'), true);
			assert.strictEqual(contributedCommands.some(command => command.command === 'harness-runner.previewSourceContextRecall'), true);
			assert.strictEqual(contributedCommands.some(command => command.command === 'harness-runner.generateAgentMap'), true);
			assert.strictEqual(contributedCommands.some(command => command.command === 'harness-runner.customizeMenuOrder'), true);
			assert.strictEqual(contributedCommands.some(command => command.command === 'harness-runner.rerunFailedStory'), true);
			assert.strictEqual(contributedCommands.find(command => command.command === 'harness-runner.previewSourceContextRecall')?.title, 'HARNESS: 为故事添加上下文');
			assert.strictEqual(contributedCommands.find(command => command.command === 'harness-runner.customizeMenuOrder')?.title, 'HARNESS: 自定义菜单排序');
			assert.strictEqual(contributedCommands.find(command => command.command === 'harness-runner.rerunFailedStory')?.title, 'HARNESS: 重新执行失败故事');
			assert.strictEqual(contributedCommands.find(command => command.command === 'harness-runner.generateAgentMap')?.title, 'HARNESS: 生成 Agent Map');
			assert.strictEqual(contributedCommands.find(command => command.command === 'harness-runner.showIntroduction')?.title, 'HARNESS: 插件介绍');
			assert.strictEqual(contributedCommands.find(command => command.command === 'harness-runner.showUsageGuide')?.title, 'HARNESS: 使用流程手册');
			assert.strictEqual(contributedCommands.some(command => command.command === 'harness-runner.reviewStoryApproval'), true);
			assert.strictEqual(contributedCommands.some(command => command.command === 'harness-runner.configurePolicyGates'), true);
			assert.strictEqual(contributedCommands.find(command => command.command === 'harness-runner.configurePolicyGates')?.title, 'HARNESS: 配置执行检查');
			assert.strictEqual(packageJson.contributes?.keybindings?.some(binding => binding.command === 'harness-runner.showMenu' && binding.key === 'alt+r'), true);
			assert.strictEqual(typeof packageJson.contributes?.configuration?.properties?.['harness-runner.policyGates'], 'object');
			assert.strictEqual(typeof packageJson.contributes?.configuration?.properties?.['harness-runner.approvalPromptMode'], 'object');
			assert.strictEqual(typeof packageJson.contributes?.configuration?.properties?.['harness-runner.enableReviewerLoop'], 'object');
			assert.strictEqual(typeof packageJson.contributes?.configuration?.properties?.['harness-runner.reviewPassingScore'], 'object');
			assert.strictEqual(typeof packageJson.contributes?.configuration?.properties?.['harness-runner.maxAutoRefactorRounds'], 'object');
			assert.strictEqual(typeof packageJson.contributes?.configuration?.properties?.['harness-runner.rootMenuOrder'], 'object');
			assert.strictEqual('harness-runner.requireProjectConstraintsBeforeRun' in (packageJson.contributes?.configuration?.properties ?? {}), false);
			assert.strictEqual('harness-runner.requireDesignContextForTaggedStories' in (packageJson.contributes?.configuration?.properties ?? {}), false);
			const policyGateDefault = packageJson.contributes?.configuration?.properties?.['harness-runner.policyGates'] as {
			default?: { completionRules?: Array<{ id?: string; }>; };
		};
		assert.strictEqual(policyGateDefault.default?.completionRules?.some(rule => rule.id === 'require-fresh-knowledge'), true);
		assert.strictEqual(policyGateDefault.default?.completionRules?.some(rule => rule.id === 'require-story-evidence-artifact'), true);

		const contributedParticipants = packageJson.contributes?.chatParticipants ?? [];
			assert.strictEqual(contributedParticipants.some(participant => participant.id === 'recent-graduates.harness-runner'), true);
			assert.strictEqual(contributedParticipants.some(participant => participant.name === 'harness' && participant.commands?.some(command => command.name === 'harness-spec')), true);
		assert.strictEqual(contributedParticipants.some(participant => participant.description?.includes('auto-send the final prompt to Copilot Chat')), true);
			assert.strictEqual(contributedParticipants.some(participant => participant.commands?.some(command => command.name === 'harness-spec' && command.description?.includes('auto-send the ready-to-use final version to Copilot Chat'))), true);
	});

		test('user-visible Harness entry labels keep command ids stable and avoid legacy Ralph titles', () => {
			const packageJsonPath = path.resolve(__dirname, '../../package.json');
			const readmePath = path.resolve(__dirname, '../../README.md');
			const agentMapPath = path.resolve(__dirname, '../../src/agentMap.ts');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
				contributes?: {
					commands?: Array<{ command: string; title: string; }>;
					chatParticipants?: Array<{
						id: string;
						name: string;
						fullName?: string;
						commands?: Array<{ name: string; description?: string; }>;
					}>;
				};
			};
			const commandTitleById = new Map((packageJson.contributes?.commands ?? []).map(command => [command.command, command.title]));
			const expectedCommandTitles = new Map<string, string>([
				['harness-runner.start', 'HARNESS: 开始执行'],
				['harness-runner.stop', 'HARNESS: 停止执行'],
				['harness-runner.status', 'HARNESS: 查看状态'],
				['harness-runner.reviewStoryApproval', 'HARNESS: 审批故事'],
				['harness-runner.resetStep', 'HARNESS: 重置故事'],
				['harness-runner.initProjectConstraints', 'HARNESS: 初始化项目约束'],
				['harness-runner.refreshSourceContextIndex', 'HARNESS: 刷新源码上下文索引'],
				['harness-runner.previewSourceContextRecall', 'HARNESS: 为故事添加上下文'],
				['harness-runner.generateAgentMap', 'HARNESS: 生成 Agent Map'],
				['harness-runner.recordDesignContext', 'HARNESS: 界面设计描述'],
				['harness-runner.openSettings', 'HARNESS: 打开设置'],
				['harness-runner.showMenu', 'HARNESS: 显示菜单'],
				['harness-runner.quickStart', 'HARNESS: 生成 PRD'],
				['harness-runner.appendUserStories', 'HARNESS: 追加用户故事'],
			]);

			for (const [commandId, expectedTitle] of expectedCommandTitles) {
				assert.strictEqual(commandTitleById.get(commandId), expectedTitle);
			}

			const contributedParticipant = packageJson.contributes?.chatParticipants?.find(participant => participant.id === 'recent-graduates.harness-runner');
			assert.ok(contributedParticipant);
			assert.strictEqual(contributedParticipant?.name, 'harness');
			assert.strictEqual(contributedParticipant?.fullName, 'Harness Runner');
			assert.strictEqual(contributedParticipant?.commands?.some(command => command.name === 'harness-spec'), true);

			const chinesePack = getHarnessLanguagePack('Chinese');
			const constraintsItems = buildHarnessMenuQuickPickItems(chinesePack, 'constraints');
			assert.strictEqual(chinesePack.statusBar.idleText.includes('Harness Runner'), true);
			assert.strictEqual(chinesePack.statusBar.runningText.includes('Harness Runner'), true);
			assert.strictEqual(chinesePack.statusBar.pendingApprovalsText(2).includes('Harness Runner'), true);
			assert.strictEqual(constraintsItems.some(item => item.label.includes('RALPH')), false);
			assert.strictEqual(constraintsItems.some(item => item.label.includes('为故事添加上下文')), true);
			assert.strictEqual(chinesePack.chatSpec.missingConstraints.includes('@harness /harness-spec'), true);

			const readme = fs.readFileSync(readmePath, 'utf8');
			const agentMapSource = fs.readFileSync(agentMapPath, 'utf8');
			const legacyReadmeLabels = [
				'`RALPH: 开始执行`',
				'`RALPH: 停止执行`',
				'`RALPH: 查看状态`',
				'`RALPH: 审批高风险故事`',
				'`RALPH: 重置故事`',
				'`RALPH: 初始化项目约束`',
				'`RALPH: 刷新源码上下文索引`',
				'`RALPH: 界面设计描述`',
				'`RALPH: 生成 PRD`',
				'`RALPH: 追加用户故事`',
				'`RALPH: 打开设置`',
				'`RALPH: 显示菜单`',
			];
			for (const legacyLabel of legacyReadmeLabels) {
				assert.strictEqual(readme.includes(legacyLabel), false);
			}
			assert.strictEqual(readme.includes('`HARNESS: 为故事添加上下文`'), true);
			assert.strictEqual(readme.includes('`HARNESS: 审批故事`'), true);
			assert.strictEqual(readme.includes('`@harness /harness-spec <你的需求>`'), true);
			assert.strictEqual(agentMapSource.includes('HARNESS: 初始化项目约束'), true);
			assert.strictEqual(agentMapSource.includes('HARNESS: 为故事添加上下文'), true);
			assert.strictEqual(agentMapSource.includes('HARNESS: 刷新源码上下文索引'), true);
			assert.strictEqual(agentMapSource.includes('HARNESS: 生成 Agent Map'), true);
			assert.strictEqual(agentMapSource.includes('HARNESS: 重置故事'), true);
			assert.strictEqual(agentMapSource.includes('Harness Runner: 初始化项目约束'), false);
		});

	test('approval prompt mode resolves with workspace override first, then global fallback', () => {
		assert.strictEqual(resolveWorkspaceApprovalPromptMode(undefined), 'default');
		assert.strictEqual(resolveWorkspaceApprovalPromptMode({
			key: 'approvalPromptMode',
			defaultValue: 'default',
			globalValue: 'autopilot',
			workspaceValue: 'bypass',
		}), 'bypass');
		assert.strictEqual(resolveWorkspaceApprovalPromptMode({
			key: 'approvalPromptMode',
			defaultValue: 'default',
			globalValue: 'autopilot',
		}), 'autopilot');
		assert.strictEqual(resolveWorkspaceApprovalPromptMode({
			key: 'approvalPromptMode',
			defaultValue: 'default',
			globalValue: 'default',
			workspaceFolderValue: 'autopilot',
		}), 'autopilot');
	});

	test('runner active when persisted inprogress exists even if in-memory loop is not running', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-runner-status-'));
		const harnessDir = path.join(workspaceRoot, '.harness-runner');
		fs.mkdirSync(harnessDir, { recursive: true });
		fs.writeFileSync(path.join(harnessDir, 'story-status.json'), JSON.stringify({ 'US-008': 'inprogress' }, null, 2), 'utf8');

		assert.strictEqual(isHarnessRunnerActive(workspaceRoot, false), true);
		assert.strictEqual(isHarnessRunnerActive(workspaceRoot, true), true);
		assert.strictEqual(isHarnessRunnerActive(undefined, false), false);
	});

	test('reviewer settings resolve with workspace override first, then global fallback', () => {
		assert.strictEqual(resolveWorkspaceReviewerLoopEnabled(undefined), true);
		assert.strictEqual(resolveWorkspaceReviewerLoopEnabled({ globalValue: true, workspaceValue: false }), false);
		assert.strictEqual(resolveWorkspaceReviewerLoopEnabled({ globalValue: false }), false);

		assert.strictEqual(resolveWorkspaceReviewerPassingScore(undefined), 85);
		assert.strictEqual(resolveWorkspaceReviewerPassingScore({ globalValue: 91, workspaceValue: 70 }), 70);
		assert.strictEqual(resolveWorkspaceReviewerPassingScore({ globalValue: 91 }), 91);
		assert.strictEqual(resolveWorkspaceReviewerPassingScore({ workspaceFolderValue: 101 }), 100);

		assert.strictEqual(resolveWorkspaceReviewerAutoRefactorLimit(undefined), 2);
		assert.strictEqual(resolveWorkspaceReviewerAutoRefactorLimit({ globalValue: 4, workspaceValue: 1 }), 1);
		assert.strictEqual(resolveWorkspaceReviewerAutoRefactorLimit({ globalValue: 4 }), 4);
		assert.strictEqual(resolveWorkspaceReviewerAutoRefactorLimit({ workspaceFolderValue: -3 }), 0);
	});

	test('reviewer setting normalizers clamp invalid values safely', () => {
		assert.strictEqual(normalizeReviewerLoopEnabled(undefined), true);
		assert.strictEqual(normalizeReviewerLoopEnabled(false), false);
		assert.strictEqual(normalizeReviewerPassingScore(undefined), 85);
		assert.strictEqual(normalizeReviewerPassingScore(0), 1);
		assert.strictEqual(normalizeReviewerPassingScore(120), 100);
		assert.strictEqual(normalizeReviewerAutoRefactorLimit(undefined), 2);
		assert.strictEqual(normalizeReviewerAutoRefactorLimit(-1), 0);
		assert.strictEqual(normalizeReviewerAutoRefactorLimit(2.7), 3);
	});

	test('localized menus expose nested submenus with explicit back items', () => {
		const chinesePack = getHarnessLanguagePack('Chinese');
		const rootItems = buildHarnessMenuQuickPickItems(chinesePack, chinesePack.menu.rootId);
		const constraintsEntry = rootItems.find(item => item.menuItem.kind === 'submenu' && item.menuItem.target === 'constraints');
		const settingsEntry = rootItems.find(item => item.menuItem.kind === 'submenu' && item.menuItem.target === 'settings');
		assert.ok(settingsEntry);
		assert.strictEqual(rootItems.some(item => item.menuItem.kind === 'command' && item.menuItem.command === 'harness-runner.openSettings'), false);
		assert.ok(constraintsEntry);

		const constraintsItems = buildHarnessMenuQuickPickItems(chinesePack, 'constraints');
		assert.strictEqual(constraintsItems[0]?.menuItem.kind, 'back');
		assert.strictEqual(constraintsItems.some(item => item.menuItem.kind === 'command' && item.menuItem.command === 'harness-runner.configurePolicyGates'), true);
		assert.strictEqual(constraintsItems.some(item => item.menuItem.kind === 'command' && item.menuItem.command === 'harness-runner.initProjectConstraints'), true);
		assert.strictEqual(constraintsItems.some(item => item.menuItem.kind === 'command' && item.menuItem.command === 'harness-runner.recordDesignContext'), true);
		assert.strictEqual(constraintsItems.some(item => item.menuItem.kind === 'command' && item.menuItem.command === 'harness-runner.previewSourceContextRecall' && item.label.includes('为故事添加上下文')), true);
		assert.strictEqual(constraintsItems.some(item => item.menuItem.kind === 'command' && item.menuItem.command === 'harness-runner.refreshSourceContextIndex'), true);
		assert.strictEqual(constraintsItems.some(item => item.menuItem.kind === 'command' && item.menuItem.command === 'harness-runner.generateAgentMap'), true);

		const settingsItems = buildHarnessMenuQuickPickItems(chinesePack, 'settings');
		assert.strictEqual(settingsItems[0]?.menuItem.kind, 'back');
		assert.strictEqual(settingsItems.some(item => item.menuItem.kind === 'command' && item.menuItem.command === 'harness-runner.openSettings'), true);
		assert.strictEqual(settingsItems.some(item => item.menuItem.kind === 'command' && item.menuItem.command === 'harness-runner.customizeMenuOrder' && item.label.includes('自定义菜单排序')), true);

			const executionItems = buildHarnessMenuQuickPickItems(chinesePack, 'execution');
			assert.strictEqual(executionItems.some(item => item.menuItem.kind === 'command' && item.menuItem.command === 'harness-runner.rerunFailedStory' && item.label.includes('重新执行失败故事')), true);
	});

	test('menu tree keeps legacy commands reachable through layered branches', () => {
		const chinesePack = getHarnessLanguagePack('Chinese');
		const expectedCommandsByMenu = new Map<string, string[]>([
			['planning', ['harness-runner.quickStart', 'harness-runner.appendUserStories']],
			['guides', ['harness-runner.showIntroduction', 'harness-runner.showUsageGuide']],
			['constraints', [
				'harness-runner.configurePolicyGates',
				'harness-runner.initProjectConstraints',
				'harness-runner.recordDesignContext',
				'harness-runner.previewSourceContextRecall',
				'harness-runner.refreshSourceContextIndex',
				'harness-runner.generateAgentMap',
			]],
			['execution', [
				'harness-runner.start',
				'harness-runner.rerunFailedStory',
				'harness-runner.stop',
				'harness-runner.status',
				'harness-runner.reviewStoryApproval',
				'harness-runner.resetStep',
			]],
			['settings', ['harness-runner.openSettings', 'harness-runner.customizeMenuOrder']],
		]);

		for (const [menuId, expectedCommands] of expectedCommandsByMenu) {
			const commands = buildHarnessMenuQuickPickItems(chinesePack, menuId)
				.flatMap(item => item.menuItem.kind === 'command' ? [item.menuItem.command] : []);
			assert.deepStrictEqual(commands, expectedCommands);
		}

		const rootSubmenus = buildHarnessMenuQuickPickItems(chinesePack, chinesePack.menu.rootId)
			.flatMap(item => item.menuItem.kind === 'submenu' ? [item.menuItem.target] : []);
		assert.deepStrictEqual(rootSubmenus, ['planning', 'constraints', 'execution', 'settings']);
	});

		test('replay range starts from the selected failed story and keeps priority order', () => {
			const prd = {
				project: 'Harness Runner',
				userStories: [
					{ id: 'US-003', title: 'three', description: '', acceptanceCriteria: [], priority: 3 },
					{ id: 'US-001', title: 'one', description: '', acceptanceCriteria: [], priority: 1 },
					{ id: 'US-004', title: 'four', description: '', acceptanceCriteria: [], priority: 4 },
					{ id: 'US-002', title: 'two', description: '', acceptanceCriteria: [], priority: 2 },
				],
			} as unknown as PrdFile;

			assert.deepStrictEqual(getReplayStoryRange(prd, 'US-002').map(story => story.id), ['US-002', 'US-003', 'US-004']);
			assert.deepStrictEqual(getReplayStoryRange(prd, 'US-999').map(story => story.id), []);
		});

	test('root menu order normalization removes invalid entries and appends missing defaults', () => {
		assert.deepStrictEqual(
			normalizeHarnessRootMenuOrder(['settings', 'invalid', 'planning', 'settings'], ['planning', 'constraints', 'execution', 'settings']),
			['settings', 'planning', 'constraints', 'execution'],
		);
	});

	test('menu order editor payload requires the full unique submenu set', () => {
		assert.deepStrictEqual(
			normalizeHarnessMenuOrderEditorPayload(
				['settings', 'planning', 'constraints', 'execution'],
				['planning', 'constraints', 'execution', 'settings'],
			),
			['settings', 'planning', 'constraints', 'execution'],
		);
		assert.strictEqual(
			normalizeHarnessMenuOrderEditorPayload(
				['settings', 'planning', 'execution'],
				['planning', 'constraints', 'execution', 'settings'],
			),
			undefined,
		);
		assert.strictEqual(
			normalizeHarnessMenuOrderEditorPayload(
				['settings', 'planning', 'planning', 'execution'],
				['planning', 'constraints', 'execution', 'settings'],
			),
			undefined,
		);
	});

	test('menu order editor html includes drag-and-drop save controls', () => {
		const html = buildHarnessMenuOrderEditorHtml({
			cspSource: 'vscode-webview://test',
			items: [
				{ target: 'planning', label: '规划与入门', description: '规划入口' },
				{ target: 'settings', label: '设置', description: '设置入口' },
			],
			copy: {
				title: '自定义一级菜单排序',
				description: '拖拽卡片以调整顺序。',
				instructions: '拖拽后点击保存。',
				unsavedChanges: '有未保存变更。',
				save: '保存',
				cancel: '取消',
				reset: '恢复当前顺序',
				positionLabel: (current, total) => `第 ${current} 项，共 ${total} 项`,
			},
		});

		assert.strictEqual(html.includes('draggable = true'), true);
		assert.strictEqual(html.includes("type: 'save'"), true);
		assert.strictEqual(html.includes('orderList'), true);
		assert.strictEqual(html.includes('规划与入门'), true);
	});

	test('root menu order persistence writes workspace settings and clears legacy keys', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-root-menu-order-'));
		const vscodeDir = path.join(workspaceRoot, '.vscode');
		fs.mkdirSync(vscodeDir, { recursive: true });
		const settingsPath = path.join(vscodeDir, 'settings.json');
		fs.writeFileSync(settingsPath, JSON.stringify({
			'ralph-runner.rootMenuOrder': ['execution'],
			'harness-runner.language': 'Chinese',
		}, null, 2));

		const persistedPath = persistWorkspacePinnedRootMenuOrderFile(workspaceRoot, ['settings', 'planning', 'constraints', 'execution']);
		assert.strictEqual(persistedPath, settingsPath);

		const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
		assert.deepStrictEqual(persisted['harness-runner.rootMenuOrder'], ['settings', 'planning', 'constraints', 'execution']);
		assert.strictEqual('ralph-runner.rootMenuOrder' in persisted, false);
		assert.strictEqual(persisted['harness-runner.language'], 'Chinese');
	});

	test('root menu order restores persisted submenu sequence when configuration is reloaded', () => {
		const originalGetConfiguration = vscode.workspace.getConfiguration;
		(vscode.workspace as typeof vscode.workspace & {
			getConfiguration: typeof vscode.workspace.getConfiguration;
		}).getConfiguration = ((section?: string) => {
			if (section === 'harness-runner') {
				return {
					get: (key: string) => key === 'rootMenuOrder'
						? ['settings', 'planning', 'execution', 'constraints']
						: undefined,
				} as vscode.WorkspaceConfiguration;
			}
			return originalGetConfiguration(section);
		}) as typeof vscode.workspace.getConfiguration;

		try {
			const englishPack = getHarnessLanguagePack('English');
			const rootSubmenus = buildHarnessMenuQuickPickItems(englishPack, englishPack.menu.rootId)
				.flatMap(item => item.menuItem.kind === 'submenu' ? [item.menuItem.target] : []);
			assert.deepStrictEqual(rootSubmenus, ['settings', 'planning', 'execution', 'constraints']);
		} finally {
			(vscode.workspace as typeof vscode.workspace & {
				getConfiguration: typeof vscode.workspace.getConfiguration;
			}).getConfiguration = originalGetConfiguration;
		}
	});

	test('menu navigation resolves deeper submenu entry, back navigation, and commands', () => {
		const englishPack = getHarnessLanguagePack('English');
		const rootItems = buildHarnessMenuQuickPickItems(englishPack, englishPack.menu.rootId);
		const planningEntry = rootItems.find(item => item.menuItem.kind === 'submenu' && item.menuItem.target === 'planning');
		assert.ok(planningEntry);

		const planningResolution = resolveHarnessMenuSelection(englishPack, [englishPack.menu.rootId], planningEntry!.menuItem);
		assert.deepStrictEqual(planningResolution.nextMenuStack, ['root', 'planning']);

		const guidesEntry = buildHarnessMenuQuickPickItems(englishPack, 'planning').find(item => item.menuItem.kind === 'submenu' && item.menuItem.target === 'guides');
		assert.ok(guidesEntry);
		const guideResolution = resolveHarnessMenuSelection(englishPack, planningResolution.nextMenuStack, guidesEntry!.menuItem);
		assert.deepStrictEqual(guideResolution.nextMenuStack, ['root', 'planning', 'guides']);

		const backEntry = buildHarnessMenuQuickPickItems(englishPack, 'guides')[0];
		const backResolution = resolveHarnessMenuSelection(englishPack, guideResolution.nextMenuStack, backEntry.menuItem);
		assert.deepStrictEqual(backResolution.nextMenuStack, ['root', 'planning']);

		const introductionEntry = buildHarnessMenuQuickPickItems(englishPack, 'guides').find(item => item.menuItem.kind === 'command' && item.menuItem.command === 'harness-runner.showIntroduction');
		assert.ok(introductionEntry);
		const commandResolution = resolveHarnessMenuSelection(englishPack, guideResolution.nextMenuStack, introductionEntry!.menuItem);
		assert.strictEqual(commandResolution.command, 'harness-runner.showIntroduction');
		assert.deepStrictEqual(commandResolution.nextMenuStack, ['root', 'planning', 'guides']);
	});

	test('workspace-pinned reviewer settings are persisted into .vscode/settings.json', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-reviewer-settings-'));
		const vscodeDir = path.join(workspaceRoot, '.vscode');
		fs.mkdirSync(vscodeDir, { recursive: true });
		const settingsPath = path.join(vscodeDir, 'settings.json');
		fs.writeFileSync(settingsPath, JSON.stringify({
				'ralph-runner.approvalPromptMode': 'default',
				'ralph-runner.enableReviewerLoop': true,
				'ralph-runner.reviewPassingScore': 85,
			'files.trimTrailingWhitespace': true,
		}, null, 2));

		const persistedPath = persistWorkspacePinnedRunnerSettingsFile(workspaceRoot, {
			approvalPromptMode: 'autopilot',
			enableReviewerLoop: false,
			reviewPassingScore: 65,
			maxAutoRefactorRounds: 1,
		});

		assert.strictEqual(persistedPath, settingsPath);
		const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
		assert.strictEqual(persisted['files.trimTrailingWhitespace'], true);
			assert.strictEqual(persisted['harness-runner.approvalPromptMode'], 'autopilot');
			assert.strictEqual(persisted['harness-runner.enableReviewerLoop'], false);
			assert.strictEqual(persisted['harness-runner.reviewPassingScore'], 65);
			assert.strictEqual(persisted['harness-runner.maxAutoRefactorRounds'], 1);
			assert.strictEqual('ralph-runner.approvalPromptMode' in persisted, false);
			assert.strictEqual('ralph-runner.enableReviewerLoop' in persisted, false);
			assert.strictEqual('ralph-runner.reviewPassingScore' in persisted, false);
	});

	test('Harness help documents cover introduction and split manual flows', () => {
		const chineseIntro = getHarnessHelpContent('Chinese', 'introduction');
		const chineseManual = getHarnessHelpContent('Chinese', 'manual');
		const englishManualDocument = buildHarnessHelpDocument('English', 'manual');

		assert.strictEqual(chineseIntro.title, 'Harness 插件介绍');
		assert.ok(chineseIntro.sections.some(section => section.title === 'Harness 是什么'));
		assert.ok(chineseManual.sections.some(section => section.title === '空项目流程'));
		assert.ok(chineseManual.sections.some(section => section.title === '已存在项目流程'));
		assert.ok(englishManualDocument.html.includes('Empty Project Workflow'));
		assert.ok(englishManualDocument.html.includes('Existing Project Workflow'));
		assert.ok(englishManualDocument.html.includes('<ol>'));
	});

	test('Agent map generation writes overview and knowledge catalog with explicit gaps', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-agent-map-'));
		try {
			fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
			fs.writeFileSync(path.join(workspaceRoot, 'package.json'), JSON.stringify({
				name: 'agent-map-sample',
				description: 'Sample extension for agent map tests',
				main: './dist/extension.js',
				packageManager: 'npm@10.0.0',
				scripts: {
					compile: 'tsc --noEmit',
					test: 'npm test'
				},
				devDependencies: {
					typescript: '^5.0.0'
				}
			}, null, 2));
			fs.writeFileSync(path.join(workspaceRoot, 'README.md'), '# Sample\n\nAgent map sample workspace.\n');
			fs.writeFileSync(path.join(workspaceRoot, 'prd.json'), JSON.stringify({
				project: 'Agent Map Sample',
				branchName: 'feature/agent-map',
				description: 'Generate repository navigation artifacts.',
				userStories: [
					{
						id: 'US-001',
						title: 'Generate map',
						description: 'Produce an agent map',
						acceptanceCriteria: ['overview exists'],
						priority: 1
					}
				]
			}, null, 2));
			fs.writeFileSync(path.join(workspaceRoot, 'src', 'extension.ts'), 'export function activate() { return; }\n');
			fs.writeFileSync(path.join(workspaceRoot, 'src', 'projectConstraints.ts'), 'export const marker = true;\n');

			const result = generateAgentMapArtifacts(workspaceRoot);
			const overview = JSON.parse(fs.readFileSync(result.overviewPath, 'utf8')) as {
				runbook: Array<{ id: string; }>;
				moduleMap: Array<{ id: string; }>;
				ruleEntries: Array<{ id: string; }>;
				gaps: Array<{ id: string; }>;
			};
			const knowledgeCatalog = JSON.parse(fs.readFileSync(result.knowledgeCatalogPath, 'utf8')) as {
				sections: Array<{ id: string; items: Array<{ label: string; }>; }>;
			};

			assert.ok(fs.existsSync(result.overviewPath));
			assert.ok(fs.existsSync(result.knowledgeCatalogPath));
			assert.deepStrictEqual(overview.runbook.map(step => step.id), ['plan', 'execute', 'checkpoint', 'reset']);
			assert.ok(overview.moduleMap.some(moduleEntry => moduleEntry.id === 'extension'));
			assert.ok(overview.ruleEntries.some(ruleEntry => ruleEntry.id === 'generated-project-constraints'));
			assert.ok(overview.gaps.some(gap => gap.id === 'missing-editable-rules'));
			assert.ok(knowledgeCatalog.sections.some(section => section.id === 'project-entry'));
			assert.ok(knowledgeCatalog.sections.some(section => section.items.some(item => item.label === 'README')));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Pending design-match stories should come from prd story status, not runtime progress files', () => {
		const prd = {
			project: 'Sample',
			branchName: 'main',
			description: 'Sample project',
			userStories: [
				{ id: 'US-001', title: 'Pending one', description: '...', acceptanceCriteria: ['a'], priority: 1 },
				{ id: 'US-002', title: 'Completed one', description: '...', acceptanceCriteria: ['b'], priority: 2, status: 'completed' },
				{ id: 'US-003', title: 'In progress one', description: '...', acceptanceCriteria: ['c'], priority: 3, status: 'inprogress' },
			],
		};

		const pendingStories = prd.userStories.filter(story => (story.status ?? '未开始') !== 'completed');

		assert.deepStrictEqual(pendingStories.map(story => story.id), ['US-001', 'US-003']);
	});

	test('Task status parser tolerates concatenated or noisy completion signals', () => {
		assert.strictEqual(parseTaskSignalStatus('completed'), 'completed');
		assert.strictEqual(parseTaskSignalStatus('inprogress'), 'inprogress');
		assert.strictEqual(parseTaskSignalStatus('completedinprogress'), 'completed');
		assert.strictEqual(parseTaskSignalStatus('inprogresscompleted'), 'completed');
		assert.strictEqual(parseTaskSignalStatus('completed in product'), 'completed');
		assert.strictEqual(parseTaskSignalStatus('---inprogress---'), 'inprogress');
		assert.strictEqual(parseTaskSignalStatus('unknown'), 'none');
	});

	test('Standalone Copilot waits do not abort just because the runner is idle', () => {
		assert.strictEqual(shouldAbortCopilotWait(false, true, false), true);
		assert.strictEqual(shouldAbortCopilotWait(false, false, false), false);
		assert.strictEqual(shouldAbortCopilotWait(true, false, true), true);
	});

	test('Structured run log classifies polling output as noise and keeps actionable summaries', () => {
		assert.strictEqual(classifyOutputMessage('  … still waiting for Copilot to complete task US-042 (status: inprogress, elapsed 20s)').category, 'noise');
		assert.strictEqual(classifyOutputMessage('  WARNING: Task memory artifact missing for US-042; synthesizing fallback memory.').category, 'diagnostic');
		assert.strictEqual(classifyOutputMessage('  Reviewer Agent scored US-042 at 91/100.').category, 'signal');
		assert.ok(summarizeCommandOutput('line 1\n\nline 2\nline 3').includes('line 1 | line 2 | line 3'));
	});

	test('Run log persists key output summaries as plain text', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-run-log-'));
		try {
			const recorder = createStoryRunLogRecorder(workspaceRoot, {
				id: 'US-042',
				title: '文本运行日志',
				description: 'Persist key output summaries.',
				acceptanceCriteria: ['Run log artifact exists'],
				priority: 42,
			});

			recorder.transitionPhase('preflight', 'Running preflight checks.');
			recorder.recordOutput('  … still waiting for Copilot to complete task US-042 (status: inprogress, elapsed 20s)');
			recorder.recordOutput('  WARNING: Task memory artifact missing for US-042; synthesizing fallback memory.');
			recorder.recordOutput('  Reviewer Agent scored US-042 at 91/100.');
			recorder.finalize('failed', 'Story failed after completion gates blocked finalization.');

			const logText = readStoryRunLog(recorder.filePath);
			assert.ok(logText);
			assert.ok(recorder.filePath.endsWith('.run-log.txt'));
			assert.ok(logText?.includes('Story: US-042 - 文本运行日志'));
			assert.ok(logText?.includes('[preflight] [diagnostic] WARNING: Task memory artifact missing for US-042; synthesizing fallback memory.'));
			assert.ok(logText?.includes('[preflight] [signal] Reviewer Agent scored US-042 at 91/100.'));
			assert.ok(logText?.includes('Status: failed'));
			assert.ok(logText?.includes('SkippedNoise: 1'));
			assert.strictEqual(logText?.includes('still waiting for Copilot'), false);
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Editable project constraints round-trip preserves sections', () => {
		const template = createEditableProjectConstraintsTemplate();
		template.sections[0].items = ['Use TypeScript strict mode'];
		template.sections[5].items = ['Do not edit generated files'];

		const parsed = parseEditableProjectConstraints(serializeEditableProjectConstraints(template));

		assert.strictEqual(parsed.sections[0].items[0], 'Use TypeScript strict mode');
		assert.strictEqual(parsed.sections[5].items[0], 'Do not edit generated files');
	});

	test('Generated project constraints normalize invalid fields safely', () => {
		const normalized = normalizeGeneratedProjectConstraints({
			version: 2,
			technologySummary: ['TypeScript', '', 'TypeScript'],
			metadata: 'invalid' as unknown as Record<string, unknown>,
		});

		assert.strictEqual(normalized.version, 2);
		assert.deepStrictEqual(normalized.technologySummary, ['TypeScript']);
		assert.strictEqual(normalized.metadata, undefined);
		assert.deepStrictEqual(normalized.buildCommands, []);
	});

	test('Editable project constraints override generated fields deterministically', () => {
		const merged = mergeProjectConstraints(
			{
				technologySummary: ['Generated stack'],
				styleRules: ['Generated style rule'],
				deliveryChecklist: ['Run lint'],
			},
			{
				title: 'Manual overrides',
				sections: [
					{ heading: 'Technology Summary', items: ['Manual stack'] },
					{ heading: 'Delivery Checklist', items: ['Run compile', 'Run lint'] },
				],
			}
		);

		assert.deepStrictEqual(merged.technologySummary, ['Manual stack']);
		assert.deepStrictEqual(merged.styleRules, ['Generated style rule']);
		assert.deepStrictEqual(merged.deliveryChecklist, ['Run compile', 'Run lint']);
	});

	test('Workspace scan produces generated and editable project constraints', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-constraints-'));
		try {
			fs.mkdirSync(path.join(workspaceRoot, 'src', 'test'), { recursive: true });
			fs.writeFileSync(path.join(workspaceRoot, 'package.json'), JSON.stringify({
				name: 'sample-extension',
				scripts: {
					compile: 'tsc --noEmit',
					lint: 'eslint src',
					test: 'vscode-test'
				},
				devDependencies: {
					typescript: '^5.0.0'
				}
			}, null, 2));
			fs.writeFileSync(path.join(workspaceRoot, 'tsconfig.json'), JSON.stringify({
				compilerOptions: {
					strict: true,
					rootDir: 'src',
					target: 'ES2022',
					module: 'Node16'
				}
			}, null, 2));
			fs.writeFileSync(path.join(workspaceRoot, 'eslint.config.mjs'), 'export default [];\n');
			fs.writeFileSync(path.join(workspaceRoot, 'README.md'), '# Sample\n');

			const result = scanWorkspaceForProjectConstraints(workspaceRoot);

			assert.ok(result.generatedConstraints.technologySummary.some(item => item.includes('TypeScript')));
			assert.ok(result.generatedConstraints.technologySummary.some(item => item.includes('sample-extension')));
			assert.ok(result.generatedConstraints.buildCommands.includes('npm run compile'));
			assert.ok(result.generatedConstraints.lintCommands.includes('npm run lint'));
			assert.ok(result.generatedConstraints.gitRules.includes('完成用户故事并准备 Git 提交时，提交标题和描述必须使用中文。'));
			assert.ok(result.generatedConstraints.architectureRules.includes('Keep reusable logic in dedicated modules instead of duplicating it across the codebase'));
			assert.ok(result.generatedConstraints.allowedPaths.includes('src/**'));
			assert.ok(result.generatedConstraints.allowedPaths.includes('src/test/**'));
			assert.deepStrictEqual(result.generatedConstraints.forbiddenPaths, []);
			assert.strictEqual(result.editableConstraints.sections.length >= 11, true);
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Project constraint initialization writes readable artifacts for prompt injection', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-constraints-init-'));
		try {
			fs.mkdirSync(path.join(workspaceRoot, 'src', 'features'), { recursive: true });
			fs.writeFileSync(path.join(workspaceRoot, 'package.json'), JSON.stringify({
				name: 'context-aware-sample',
				scripts: {
					compile: 'tsc --noEmit',
					lint: 'eslint src',
					test: 'vscode-test'
				},
				devDependencies: {
					typescript: '^5.0.0'
				}
			}, null, 2));
			fs.writeFileSync(path.join(workspaceRoot, 'tsconfig.json'), JSON.stringify({
				compilerOptions: {
					strict: true,
					rootDir: 'src'
				}
			}, null, 2));
			fs.writeFileSync(path.join(workspaceRoot, 'eslint.config.mjs'), 'export default [];\n');
			fs.writeFileSync(path.join(workspaceRoot, 'README.md'), '# Sample\n');

			const initialized = initializeProjectConstraintsArtifacts(workspaceRoot);
			const generated = readGeneratedProjectConstraints(workspaceRoot);
			const editable = readEditableProjectConstraints(workspaceRoot);
			const merged = loadMergedProjectConstraints(workspaceRoot);
			const promptLines = summarizeProjectConstraintsForPrompt(merged);

			assert.ok(fs.existsSync(initialized.generatedPath));
			assert.ok(fs.existsSync(initialized.editablePath));
			assert.ok(generated);
			assert.ok(editable);
			assert.ok(generated?.buildCommands.includes('npm run compile'));
			assert.ok(editable?.sections.some(section => section.heading === 'Technology Summary'));
			assert.ok(editable?.sections.some(section => section.heading === 'Git Rules' && section.items.includes('完成用户故事并准备 Git 提交时，提交标题和描述必须使用中文。')));
			assert.strictEqual(editable?.title, 'Harness Project Constraints');
			assert.ok(promptLines.includes('Technology Summary'));
			assert.ok(promptLines.includes('Git Rules'));
			assert.ok(promptLines.some(line => line.includes('完成用户故事并准备 Git 提交时')));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Project constraints initialization prompt includes scan baseline, provided rules, and output targets', () => {
		const prompt = buildProjectConstraintsInitializationPrompt({
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			language: 'Chinese',
			generatedPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/project-constraints.generated.json',
			editablePath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/project-constraints.md',
			completionSignalPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/story-status.json',
			completionSignalKey: 'task-project-constraints-init',
			scanResult: {
				generatedConstraints: {
					version: 1,
					generatedAt: new Date().toISOString(),
					technologySummary: ['TypeScript', 'VS Code Extension'],
					buildCommands: ['npm run compile'],
					testCommands: ['npm test'],
					lintCommands: ['npm run lint'],
					styleRules: ['Use strict mode'],
					gitRules: ['提交标题必须使用中文'],
					architectureRules: ['Keep reusable logic in modules'],
					allowedPaths: ['src/**'],
					forbiddenPaths: [],
					reuseHints: ['Prefer shared utilities'],
					deliveryChecklist: ['Run lint'],
				},
				editableConstraints: {
					title: 'Harness Project Constraints',
					lastUpdated: new Date().toISOString(),
					sections: [
						{ heading: 'Technology Summary', items: ['TypeScript'] },
						{ heading: 'Build Commands', items: ['npm run compile'] },
					],
				},
			},
			referenceSources: [
				{ label: 'docs/team-rules.md', note: 'This file has higher priority than older README guidance.', content: 'All user-facing copy should remain bilingual.' },
			],
			additionalInstructions: '重点强调交付前的验证步骤。\n\n补充：不要覆盖团队现有术语。',
		});

		assert.ok(prompt.includes('Write the machine-readable generated constraints JSON directly to: d:/workspace/vscode-copilot-ralph-runner/.harness-runner/project-constraints.generated.json'));
		assert.ok(prompt.includes('Write the editable team-maintained markdown constraints directly to: d:/workspace/vscode-copilot-ralph-runner/.harness-runner/project-constraints.md'));
		assert.ok(prompt.includes('User-provided project rules and reference material:'));
		assert.ok(prompt.includes('### docs/team-rules.md'));
		assert.ok(prompt.includes('Note: This file has higher priority than older README guidance.'));
		assert.ok(prompt.includes('All user-facing copy should remain bilingual.'));
		assert.ok(prompt.includes('Additional user instructions:'));
		assert.ok(prompt.includes('补充：不要覆盖团队现有术语。'));
		assert.ok(prompt.includes('Keep the final files aligned with the selected plugin language.'));
	});

	test('Project constraint chat advice prompt produces a final copy-ready request format', () => {
		const prompt = buildProjectConstraintChatAdvicePrompt({
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			language: 'Chinese',
			userRequest: '请帮我补充一个新命令，并尽量不要改动现有目录结构。',
			generatedPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/project-constraints.generated.json',
			editablePath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/project-constraints.md',
			constraints: {
				version: 1,
				generatedAt: new Date().toISOString(),
				technologySummary: ['TypeScript', 'VS Code extension'],
				buildCommands: ['npm run compile'],
				testCommands: ['npm test'],
				lintCommands: ['npm run lint'],
				styleRules: ['Keep changes TypeScript strict-mode compatible'],
				gitRules: ['提交标题必须使用中文'],
				architectureRules: ['Keep reusable logic in dedicated modules'],
				allowedPaths: ['src/**'],
				forbiddenPaths: ['dist/**'],
				reuseHints: ['Prefer reusing existing prompt builders'],
				deliveryChecklist: ['Run npm run compile'],
			},
		});

		assert.ok(prompt.includes('请帮我补充一个新命令'));
		assert.ok(prompt.includes('You are Harness Runner Spec Finalizer for the current workspace.'));
		assert.ok(prompt.includes('Merged project constraints'));
		assert.ok(prompt.includes('Build Commands'));
		assert.ok(prompt.includes('npm run compile'));
		assert.ok(prompt.includes('Do not stop at giving advice only.'));
		assert.ok(prompt.includes('1. Final request for the LLM'));
		assert.ok(prompt.includes('Provide a complete, polished request inside a fenced code block.'));
	});

	test('Project constraint chat advice prompt can attach knowledge freshness reminders', () => {
		const prompt = buildProjectConstraintChatAdvicePrompt({
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			language: 'Chinese',
			userRequest: '请帮我完善 harness run 的执行说明。',
			generatedPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/project-constraints.generated.json',
			editablePath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/project-constraints.md',
			knowledgeReminderLines: ['- [stale-documentation] README may lag behind the current run flow.'],
			constraints: null,
		});

		assert.ok(prompt.includes('Knowledge freshness and coverage reminders:'));
		assert.ok(prompt.includes('[stale-documentation] README may lag behind the current run flow.'));
		assert.ok(prompt.includes('Carry the applicable reminders into the final request'));
	});

	test('Project constraint chat response extraction prefers the final request code block', () => {
		const response = [
			'1. Final request for the LLM',
			'```text',
			'Implement the new command in src/extension.ts and add tests.',
			'Run npm run compile before finishing.',
			'```',
			'',
			'2. Constraint-driven adjustments',
			'- Keep changes scoped to src/**.',
		].join('\n');

		assert.strictEqual(
			extractRunnableProjectConstraintRequest(response),
			'Implement the new command in src/extension.ts and add tests.\nRun npm run compile before finishing.'
		);
		assert.strictEqual(extractRunnableProjectConstraintRequest('No code block here.'), null);
	});

	test('Workspace scan can generate git rules from configured language', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-constraints-git-language-'));
		try {
			fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
			fs.writeFileSync(path.join(workspaceRoot, 'package.json'), JSON.stringify({
				name: 'configurable-constraints',
				scripts: {
					compile: 'tsc --noEmit'
				},
				devDependencies: {
					typescript: '^5.0.0'
				}
			}, null, 2));

			const result = scanWorkspaceForProjectConstraints(workspaceRoot, {
				language: 'English',
			});

			assert.deepStrictEqual(result.generatedConstraints.gitRules, [
				'When completing a user story and preparing a Git commit, write the commit title and description in English.'
			]);
			assert.strictEqual(result.editableConstraints.title, 'Harness Project Constraints');
			assert.ok(result.editableConstraints.sections.some(section =>
				section.heading === 'Git Rules'
				&& section.items.includes('When completing a user story and preparing a Git commit, write the commit title and description in English.')));

			const fallbackResult = scanWorkspaceForProjectConstraints(workspaceRoot, {
				language: 'Japanese',
			});

			assert.deepStrictEqual(fallbackResult.generatedConstraints.gitRules, [
				'完成用户故事并准备 Git 提交时，提交标题和描述必须使用中文。'
			]);
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Design context sidecar can be written and read per story', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-design-context-'));
		try {
			const storyId = 'US-101';
			const filePath = writeDesignContext(workspaceRoot, storyId, {
				sourceType: 'figma',
				figmaUrl: 'https://figma.com/design/file/example?node-id=1-2',
				screenshotPaths: ['images/mockup.png'],
				manualNotes: ['Preserve spacing scale', 'Reuse the existing button component'],
				referenceDocs: ['docs/design-guidelines.md'],
				summary: 'Landing page hero section',
				layoutConstraints: ['Keep two-column layout on desktop'],
				componentReuseTargets: ['Button', 'HeroCard'],
				tokenRules: ['Use semantic color tokens only'],
				responsiveRules: ['Collapse to one column below tablet breakpoint'],
				doNotChange: ['Header navigation'],
				acceptanceChecks: ['Matches hero layout hierarchy from design'],
			});

			assert.ok(fs.existsSync(filePath));
			assert.strictEqual(hasDesignContextArtifact(workspaceRoot, storyId), true);

			const designContext = readDesignContext(workspaceRoot, storyId);
			assert.ok(designContext);
			assert.strictEqual(designContext?.figmaUrl, 'https://figma.com/design/file/example?node-id=1-2');
			assert.deepStrictEqual(designContext?.manualNotes, ['Preserve spacing scale', 'Reuse the existing button component']);
			assert.deepStrictEqual(designContext?.componentReuseTargets, ['Button', 'HeroCard']);
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Design context normalization and validation handle invalid inputs safely', () => {
		const normalized = normalizeDesignContext({
			sourceType: 'invalid' as unknown as 'notes',
			figmaUrl: '   ',
			manualNotes: ['Keep spacing', '', 'Keep spacing'],
			screenshotPaths: ['screen.png', 'screen.png'],
		}, 'US-102');

		assert.strictEqual(normalized.sourceType, 'notes');
		assert.strictEqual(normalized.figmaUrl, undefined);
		assert.deepStrictEqual(normalized.manualNotes, ['Keep spacing']);
		assert.deepStrictEqual(normalized.screenshotPaths, ['screen.png']);

		const validation = validateDesignContext({ sourceType: 'screenshots', screenshotPaths: [] }, 'US-103');
		assert.strictEqual(validation.isValid, false);
		assert.ok(validation.errors[0].includes('screenshot'));
	});

	test('Design context prompt summary emphasizes implementation constraints', () => {
		const lines = summarizeDesignContextForPrompt({
			storyId: 'US-104',
			sourceType: 'figma',
			figmaUrl: 'https://figma.example/file?node-id=1-2',
			screenshotPaths: ['images/hero.png'],
			manualNotes: ['Match the card elevation token', 'Reuse the existing Button component'],
			referenceDocs: ['docs/ui.md'],
			summary: 'Marketing hero redesign',
			pageOrScreenName: 'Homepage Hero',
			layoutConstraints: ['Preserve two-column desktop layout'],
			componentReuseTargets: ['Button', 'HeroCard'],
			tokenRules: ['Use semantic spacing tokens'],
			responsiveRules: ['Stack content on mobile'],
			doNotChange: ['Global header'],
			acceptanceChecks: ['Hero hierarchy matches design'],
			updatedAt: new Date().toISOString(),
		});

		assert.ok(lines.includes('Layout Constraints:'));
		assert.ok(lines.includes('- Preserve two-column desktop layout'));
		assert.ok(lines.includes('Component Reuse Requirements:'));
		assert.ok(lines.includes('Token Usage Rules:'));
		assert.ok(lines.includes('Visual Acceptance Checks:'));
		assert.ok(lines.includes('Implementation Notes:'));
		assert.strictEqual(lines.includes('Manual Notes'), false);
	});

	test('Layered design context supports project, screen, module, and story overrides', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-design-context-layered-'));
		try {
			writeProjectDesignContext(workspaceRoot, {
				scope: 'project',
				scopeId: 'project',
				sourceType: 'notes',
				summary: 'Use the shared product shell and preserve global spacing rhythm.',
				tokenRules: ['Use semantic color tokens only'],
				doNotChange: ['Global header'],
				manualNotes: ['Keep the baseline spacing scale'],
			});

			writeScreenDesignContext(workspaceRoot, 'Dashboard', {
				scope: 'screen',
				scopeId: 'Dashboard',
				sourceType: 'figma',
				figmaUrl: 'https://figma.example/file/dashboard',
				pageOrScreenName: 'Dashboard',
				layoutConstraints: ['Keep summary cards in one row on desktop'],
				acceptanceChecks: ['Dashboard hierarchy matches approved mockup'],
			});

			writeModuleDesignContext(workspaceRoot, 'analytics', {
				scope: 'module',
				scopeId: 'analytics',
				sourceType: 'notes',
				componentReuseTargets: ['SummaryCard'],
				responsiveRules: ['Stack cards below tablet breakpoint'],
			});

			writeDesignContext(workspaceRoot, 'US-105', {
				sourceType: 'notes',
				summary: 'Refresh analytics summary cards without changing global navigation.',
				manualNotes: ['Reuse the existing SummaryCard component'],
				acceptanceChecks: ['Summary cards align visually with the existing dashboard grid'],
			});

			const resolved = resolveDesignContextForStory(workspaceRoot, {
				id: 'US-105',
				title: 'Refresh analytics summary cards',
				description: 'Update the analytics dashboard cards.',
				acceptanceCriteria: ['Keep dashboard alignment'],
				priority: 1,
				screenId: 'Dashboard',
				moduleHints: ['analytics'],
			});

			assert.ok(resolved);
			assert.deepStrictEqual(resolved?.inheritsFrom, ['project:project', 'screen:Dashboard', 'module:analytics', 'story:US-105']);
			assert.strictEqual(resolved?.figmaUrl, 'https://figma.example/file/dashboard');
			assert.strictEqual(resolved?.pageOrScreenName, 'Dashboard');
			assert.deepStrictEqual(resolved?.tokenRules, ['Use semantic color tokens only']);
			assert.deepStrictEqual(resolved?.componentReuseTargets, ['SummaryCard']);
			assert.ok(resolved?.manualNotes.includes('Reuse the existing SummaryCard component'));
			assert.ok(resolved?.acceptanceChecks.includes('Dashboard hierarchy matches approved mockup'));
			assert.ok(resolved?.acceptanceChecks.includes('Summary cards align visually with the existing dashboard grid'));
			assert.strictEqual(hasAnyDesignContextForStory(workspaceRoot, {
				id: 'US-105',
				title: 'Refresh analytics summary cards',
				description: 'Update the analytics dashboard cards.',
				acceptanceCriteria: ['Keep dashboard alignment'],
				priority: 1,
				screenId: 'Dashboard',
				moduleHints: ['analytics'],
			}), true);

			const lines = summarizeDesignContextForPrompt(resolved ?? null);
			assert.ok(lines.includes('Context Layers: project:project > screen:Dashboard > module:analytics > story:US-105'));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Shared design context artifacts can be written and read independently', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-design-context-shared-'));
		try {
			writeProjectDesignContext(workspaceRoot, {
				scope: 'project',
				scopeId: 'project',
				sourceType: 'notes',
				summary: 'Shared product shell',
			});
			writeScreenDesignContext(workspaceRoot, 'Settings', {
				scope: 'screen',
				scopeId: 'Settings',
				sourceType: 'screenshots',
				screenshotPaths: ['images/settings.png'],
			});
			writeModuleDesignContext(workspaceRoot, 'billing', {
				scope: 'module',
				scopeId: 'billing',
				sourceType: 'notes',
				manualNotes: ['Reuse BillingForm'],
			});

			assert.strictEqual(readProjectDesignContext(workspaceRoot)?.scope, 'project');
			assert.strictEqual(readScreenDesignContext(workspaceRoot, 'Settings')?.scope, 'screen');
			assert.strictEqual(readModuleDesignContext(workspaceRoot, 'billing')?.scope, 'module');
			assert.deepStrictEqual(readScreenDesignContext(workspaceRoot, 'Settings')?.screenshotPaths, ['images/settings.png']);
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Visual design draft prompt includes target artifact, visual inputs, and completion signal', () => {
		const prompt = buildVisualDesignContextDraftPrompt({
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			targetScope: 'screen',
			targetScopeId: 'Dashboard',
			targetFilePath: 'd:/workspace/vscode-copilot-ralph-runner/.prd/design-context/shared/screen-dashboard.design.json',
			completionSignalPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/story-status.json',
			completionSignalKey: 'task-design-context-draft-us-200-screen-dashboard',
			story: {
				id: 'US-200',
				title: 'Refresh dashboard cards',
				description: 'Use screenshots and Figma references to refresh dashboard cards.',
				acceptanceCriteria: ['Keep alignment with the approved dashboard shell'],
				priority: 1,
			},
			figmaUrl: 'https://figma.example/file/dashboard',
			screenshotPaths: ['images/dashboard/cards.png'],
			referenceDocs: ['docs/ui/dashboard.md'],
			additionalInstructions: 'Focus on reusable dashboard shell constraints.',
			existingContextLines: ['Primary Source: notes', 'Design Intent: Keep the shared shell unchanged'],
		});

		assert.ok(prompt.includes('Target scope: screen'));
		assert.ok(prompt.includes('Write the JSON artifact directly to: d:/workspace/vscode-copilot-ralph-runner/.prd/design-context/shared/screen-dashboard.design.json'));
		assert.ok(prompt.includes('Figma URL: https://figma.example/file/dashboard'));
		assert.ok(prompt.includes('Screenshot files: images/dashboard/cards.png'));
		assert.ok(prompt.includes('Reference docs: docs/ui/dashboard.md'));
		assert.ok(prompt.includes('Existing applicable design context:'));
		assert.ok(prompt.includes('Additional instructions: Focus on reusable dashboard shell constraints.'));
		assert.ok(prompt.includes('update the entry "task-design-context-draft-us-200-screen-dashboard" in d:/workspace/vscode-copilot-ralph-runner/.harness-runner/story-status.json to the exact text completed'));
	});

	test('Visual design draft prompt supports reusable draft creation without a story', () => {
		const prompt = buildVisualDesignContextDraftPrompt({
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			targetScope: 'module',
			targetScopeId: 'checkout-shell',
			targetFilePath: 'd:/workspace/vscode-copilot-ralph-runner/.prd/design-context/shared/module-checkout-shell.design.json',
			completionSignalPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/story-status.json',
			completionSignalKey: 'task-design-context-draft-checkout-shell-module-checkout-shell',
			figmaUrl: 'https://figma.example/file/checkout-shell',
			screenshotPaths: ['images/checkout-shell.png'],
			referenceDocs: ['docs/ui/checkout.md'],
			additionalInstructions: 'Keep this reusable across checkout stories.',
		});

		assert.ok(prompt.includes('Current story context:'));
		assert.ok(prompt.includes('No user story is associated with this draft.'));
		assert.ok(prompt.includes('Create reusable module-level design context for module identifier "checkout-shell".'));
		assert.ok(prompt.includes('Write the JSON artifact directly to: d:/workspace/vscode-copilot-ralph-runner/.prd/design-context/shared/module-checkout-shell.design.json'));
	});

		test('Batch design matching prompt tells Copilot to omit unrelated stories', () => {
			const prompt = buildStoryDesignContextBatchMatchPrompt({
				workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
				targetFilePath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/design-context-suggestions/design-context-match.json',
				completionSignalPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/story-status.json',
				completionSignalKey: 'task-design-context-match',
				candidateDrafts: [
					{
						reference: 'screen:Dashboard',
						summaryLines: ['Design Intent: Shared dashboard shell', '- Layout Constraints: Keep summary cards aligned'],
					},
					{
						reference: 'module:analytics',
						summaryLines: ['Design Intent: Analytics card module'],
					},
				],
				candidateStories: [
					{
						id: 'US-301',
						title: 'Refresh dashboard spacing',
						description: 'Adjust the dashboard shell spacing.',
						acceptanceCriteria: ['Preserve dashboard hierarchy'],
						priority: 1,
						status: 'inprogress',
					},
					{
						id: 'US-302',
						title: 'Fix login form validation',
						description: 'Update validation messaging on the auth form.',
						acceptanceCriteria: ['Validation copy is correct'],
						priority: 2,
					},
				],
			});

			assert.ok(prompt.includes('Only include a story in the output if at least one selected reusable design resource is clearly relevant to that story.'));
			assert.ok(prompt.includes('If a story is not meaningfully related, omit it from the matches array entirely.'));
			assert.ok(prompt.includes('Reference: screen:Dashboard'));
			assert.ok(prompt.includes('Story ID: US-302'));
		});

		test('Batch design matching result keeps only allowed story-reference pairs', () => {
			const normalized = normalizeStoryDesignContextBatchMatchResult({
				matches: [
					{
						storyId: 'US-301',
						linkedReferences: ['screen:Dashboard', 'module:analytics', 'screen:Dashboard'],
						reason: 'Dashboard story uses the shared shell and analytics cards.',
					},
					{
						storyId: 'US-302',
						linkedReferences: ['screen:Unknown'],
					},
					{
						storyId: 'US-999',
						linkedReferences: ['screen:Dashboard'],
					},
				],
			}, [
				{
					id: 'US-301',
					title: 'Refresh dashboard spacing',
					description: 'Adjust the dashboard shell spacing.',
					acceptanceCriteria: ['Preserve dashboard hierarchy'],
					priority: 1,
				},
				{
					id: 'US-302',
					title: 'Fix login form validation',
					description: 'Update validation messaging on the auth form.',
					acceptanceCriteria: ['Validation copy is correct'],
					priority: 2,
				},
			], ['screen:Dashboard', 'module:analytics']);

			assert.deepStrictEqual(normalized.matches, [{
				storyId: 'US-301',
				linkedReferences: ['screen:Dashboard', 'module:analytics'],
				reason: 'Dashboard story uses the shared shell and analytics cards.',
			}]);
		});

	test('Story design context suggestion prompt emphasizes shared context and delta-only output', () => {
		const prompt = buildStoryDesignContextSuggestionPrompt({
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			targetFilePath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/design-context-suggestions/US-201.suggestion.json',
			completionSignalPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/story-status.json',
			completionSignalKey: 'task-design-context-suggest-us-201',
			story: {
				id: 'US-201',
				title: 'Refresh analytics card spacing',
				description: 'Adjust the analytics cards to match the shared dashboard shell.',
				acceptanceCriteria: ['Preserve the shared dashboard layout'],
				priority: 1,
			},
			sharedContextLines: [
				'Primary Source: figma',
				'Layout Constraints:',
				'- Keep summary cards in one row on desktop',
			],
			existingStoryContextLines: ['Primary Source: notes', 'Design Intent: Legacy story override'],
			additionalInstructions: 'Only suggest deltas for spacing and acceptance checks.',
		});

		assert.ok(prompt.includes('Inherited shared design context already available to this story:'));
		assert.ok(prompt.includes('Suggest only story-specific deltas.'));
		assert.ok(prompt.includes('If no extra override is needed for a field, leave it empty instead of copying inherited values.'));
		assert.ok(prompt.includes('Existing story-specific design context to refine if useful:'));
		assert.ok(prompt.includes('Additional instructions: Only suggest deltas for spacing and acceptance checks.'));
	});

	test('Story design context override keeps only deltas beyond shared context', () => {
		const override = createStoryDesignContextOverride('US-202', {
			storyId: 'US-202',
			scope: 'story',
			scopeId: 'US-202',
			sourceType: 'notes',
			summary: 'Tighten the card footer spacing for this story only.',
			manualNotes: ['Preserve the baseline spacing scale', 'Reduce footer padding on the final card row'],
			layoutConstraints: ['Keep summary cards in one row on desktop'],
			componentReuseTargets: ['SummaryCard'],
			tokenRules: ['Use semantic color tokens only', 'Use spacing token space-2 for the footer row'],
			acceptanceChecks: ['Dashboard hierarchy matches approved mockup', 'Footer padding matches the updated story-specific spacing'],
			updatedAt: new Date().toISOString(),
		}, {
			storyId: 'US-202',
			scope: 'story',
			scopeId: 'US-202',
			sourceType: 'figma',
			summary: 'Use the shared dashboard shell and preserve global spacing rhythm.',
			manualNotes: ['Preserve the baseline spacing scale'],
			layoutConstraints: ['Keep summary cards in one row on desktop'],
			componentReuseTargets: ['SummaryCard'],
			tokenRules: ['Use semantic color tokens only'],
			acceptanceChecks: ['Dashboard hierarchy matches approved mockup'],
			screenshotPaths: [],
			referenceDocs: [],
			responsiveRules: [],
			doNotChange: [],
			updatedAt: new Date().toISOString(),
		});

		assert.strictEqual(override.summary, 'Tighten the card footer spacing for this story only.');
		assert.deepStrictEqual(override.manualNotes, ['Reduce footer padding on the final card row']);
		assert.deepStrictEqual(override.layoutConstraints, []);
		assert.deepStrictEqual(override.componentReuseTargets, []);
		assert.deepStrictEqual(override.tokenRules, ['Use spacing token space-2 for the footer row']);
		assert.deepStrictEqual(override.acceptanceChecks, ['Footer padding matches the updated story-specific spacing']);
	});

	test('Execution-time design context synthesis uses shared visual context and story metadata', () => {
		const lines = synthesizeExecutionDesignContextPromptLines({
			id: 'US-203',
			title: 'Refresh dashboard spacing',
			description: 'Tighten the summary card spacing while keeping the shared dashboard shell.',
			acceptanceCriteria: ['Preserve dashboard alignment', 'Keep the approved summary-card hierarchy'],
			priority: 1,
		}, {
			storyId: 'US-203',
			scope: 'story',
			scopeId: 'US-203',
			inheritsFrom: ['project:project', 'screen:Dashboard'],
			sourceType: 'figma',
			figmaUrl: 'https://figma.example/file/dashboard',
			screenshotPaths: ['images/dashboard-1.png', 'images/dashboard-2.png', 'images/dashboard-3.png'],
			referenceDocs: ['docs/dashboard.md', 'docs/tokens.md', 'docs/extra.md'],
			summary: 'Use the shared dashboard shell and preserve the card rhythm.',
			pageOrScreenName: 'Dashboard',
			manualNotes: [],
			layoutConstraints: ['Keep summary cards in one row on desktop', 'Preserve the approved chart gutter'],
			componentReuseTargets: ['SummaryCard', 'ChartFrame'],
			tokenRules: ['Use semantic spacing tokens only', 'Keep spacing rhythm aligned to the dashboard scale'],
			responsiveRules: ['Stack cards below tablet breakpoint'],
			doNotChange: ['Global header'],
			acceptanceChecks: ['Dashboard hierarchy matches approved mockup'],
			updatedAt: new Date().toISOString(),
		});

		assert.ok(lines.includes('Synthesis Mode: execution-time fallback'));
		assert.ok(lines.some(line => line.includes('Story Focus: Refresh dashboard spacing')));
		assert.ok(lines.includes('Primary Source: figma'));
		assert.ok(lines.some(line => line.includes('Visual Inputs: Figma available')));
		assert.ok(lines.some(line => line.includes('Layout Focus: Keep summary cards in one row on desktop; Preserve the approved chart gutter')));
		assert.ok(lines.some(line => line.includes('Acceptance Focus: Dashboard hierarchy matches approved mockup; Preserve dashboard alignment')));
		assert.ok(lines.length <= 10);
	});

	test('Execution-time design context synthesis falls back to story metadata when shared context is missing', () => {
		const lines = synthesizeExecutionDesignContextPromptLines({
			id: 'US-203A',
			title: 'Tighten checkout spacing',
			description: 'Refine spacing around the checkout footer without changing the overall shell.',
			acceptanceCriteria: ['Preserve checkout shell alignment', 'Footer spacing matches the updated mock'],
			priority: 1,
		}, null);

		assert.ok(lines.includes('Synthesis Mode: execution-time fallback'));
		assert.ok(lines.includes('Primary Source: story metadata'));
		assert.ok(lines.some(line => line.includes('Acceptance Focus: Preserve checkout shell alignment; Footer spacing matches the updated mock')));
		assert.ok(lines.length <= 5);
	});

	test('Story-level design context detection excludes shared-only artifacts', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-design-context-story-level-'));
		try {
			writeProjectDesignContext(workspaceRoot, {
				scope: 'project',
				scopeId: 'project',
				sourceType: 'notes',
				summary: 'Shared shell defaults',
			});

			assert.strictEqual(hasStoryLevelDesignContext(workspaceRoot, 'US-204'), false);

			writeDesignContext(workspaceRoot, 'US-204', {
				sourceType: 'notes',
				summary: 'Story-specific footer alignment override',
			});

			assert.strictEqual(hasStoryLevelDesignContext(workspaceRoot, 'US-204'), true);
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Explicit story inheritsFrom references pull linked shared context into resolution', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-design-context-linked-shared-'));
		try {
			writeScreenDesignContext(workspaceRoot, 'Billing', {
				scope: 'screen',
				scopeId: 'Billing',
				sourceType: 'notes',
				summary: 'Billing screen defaults',
				layoutConstraints: ['Preserve the billing summary shell'],
			});

			writeDesignContext(workspaceRoot, 'US-205', {
				scope: 'story',
				scopeId: 'US-205',
				sourceType: 'notes',
				inheritsFrom: ['screen:Billing'],
				summary: 'Adjust the invoice CTA emphasis only.',
			});

			const resolved = resolveDesignContextForStory(workspaceRoot, {
				id: 'US-205',
				title: 'Refresh invoice CTA',
				description: 'Update the CTA inside billing invoice details.',
				acceptanceCriteria: ['Billing shell stays aligned'],
				priority: 1,
			});

			assert.ok(resolved);
			assert.ok(resolved?.inheritsFrom?.includes('screen:Billing'));
			assert.ok(resolved?.layoutConstraints.includes('Preserve the billing summary shell'));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Review draft prefers linked shared context and keeps story-specific checks compact', () => {
		const story = {
			id: 'US-206',
			title: 'Tune billing spacing',
			description: 'Adjust billing spacing without rewriting the shared shell.',
			acceptanceCriteria: ['Preserve billing shell alignment', 'Footer spacing matches the new mock'],
			priority: 1,
		};

		const shared = mergeSharedDesignContextTargets('US-206', [{
			scope: 'screen',
			scopeId: 'Billing',
			artifact: normalizeDesignContext({
				scope: 'screen',
				scopeId: 'Billing',
				storyId: 'screen:Billing',
				sourceType: 'notes',
				summary: 'Billing screen defaults',
				pageOrScreenName: 'Billing',
				acceptanceChecks: ['Preserve billing shell alignment'],
			}, 'US-206'),
		}]);

		const draft = createReviewStoryDesignContextDraft(story, {
			sharedContext: shared,
			linkedReferences: ['screen:Billing'],
		});

		assert.deepStrictEqual(draft.inheritsFrom, ['screen:Billing']);
		assert.strictEqual(draft.sourceType, 'notes');
		assert.strictEqual(draft.pageOrScreenName, 'Billing');
		assert.ok(draft.summary.includes('review inherited shared design context'));
		assert.deepStrictEqual(draft.acceptanceChecks, ['Footer spacing matches the new mock']);
	});

	test('Review draft without shared context seeds a lightweight story-specific summary', () => {
		const draft = createReviewStoryDesignContextDraft({
			id: 'US-206A',
			title: 'Polish empty state illustration',
			description: 'Adjust the empty state spacing and illustration alignment.',
			acceptanceCriteria: ['Illustration spacing matches the updated comp'],
			priority: 1,
		});

		assert.strictEqual(draft.scope, 'story');
		assert.strictEqual(draft.scopeId, 'US-206A');
		assert.strictEqual(draft.sourceType, 'notes');
		assert.ok(draft.summary.includes('capture only the visual constraints that are unique to this story'));
		assert.deepStrictEqual(draft.acceptanceChecks, ['Illustration spacing matches the updated comp']);
	});

	test('Prompt summary for linked shared context keeps inherited layers visible', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-design-context-summary-linked-'));
		try {
			writeProjectDesignContext(workspaceRoot, {
				scope: 'project',
				scopeId: 'project',
				sourceType: 'notes',
				summary: 'Shared shell defaults',
				tokenRules: ['Use semantic spacing tokens only'],
			});

			writeScreenDesignContext(workspaceRoot, 'Orders', {
				scope: 'screen',
				scopeId: 'Orders',
				sourceType: 'figma',
				figmaUrl: 'https://figma.example/file/orders',
				pageOrScreenName: 'Orders',
				layoutConstraints: ['Preserve the orders table shell'],
			});

			writeDesignContext(workspaceRoot, 'US-206B', {
				scope: 'story',
				scopeId: 'US-206B',
				sourceType: 'notes',
				inheritsFrom: ['project:project', 'screen:Orders'],
				summary: 'Only tighten header spacing for this story.',
				acceptanceChecks: ['Header spacing matches the revised comp'],
			});

			const resolved = resolveDesignContextForStory(workspaceRoot, {
				id: 'US-206B',
				title: 'Tighten orders header spacing',
				description: 'Adjust the orders header spacing.',
				acceptanceCriteria: ['Orders table shell stays intact'],
				priority: 1,
			});
			const lines = summarizeDesignContextForPrompt(resolved);

			assert.ok(lines.includes('Context Layers: project:project > screen:Orders > story:US-206B'));
			assert.ok(lines.includes('Figma URL: https://figma.example/file/orders'));
			assert.ok(lines.includes('Token Usage Rules:'));
			assert.ok(lines.includes('- Use semantic spacing tokens only'));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Available shared design context targets include explicit linked scopes', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-design-context-targets-'));
		try {
			writeModuleDesignContext(workspaceRoot, 'checkout', {
				scope: 'module',
				scopeId: 'checkout',
				sourceType: 'notes',
				summary: 'Checkout module defaults',
			});

			writeDesignContext(workspaceRoot, 'US-207', {
				scope: 'story',
				scopeId: 'US-207',
				sourceType: 'notes',
				inheritsFrom: ['module:checkout'],
				summary: 'Story override',
			});

			const targets = listAvailableSharedDesignContextTargets(workspaceRoot, {
				id: 'US-207',
				title: 'Polish checkout footer',
				description: 'Update footer spacing',
				acceptanceCriteria: ['Keep checkout shell stable'],
				priority: 1,
			});

			assert.deepStrictEqual(targets.map(target => `${target.scope}:${target.scopeId}`), ['module:checkout']);
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Scoped design context helper can write and read a shared screen draft', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-design-context-generic-scope-'));
		try {
			writeScreenDesignContext(workspaceRoot, 'Billing', {
				scope: 'screen',
				scopeId: 'Billing',
				sourceType: 'figma',
				figmaUrl: 'https://figma.example/file/billing',
				summary: 'Billing screen visual defaults',
				layoutConstraints: ['Preserve two-column invoice layout on desktop'],
			});

			const artifact = readDesignContextForScope(workspaceRoot, 'screen', 'Billing');
			assert.ok(artifact);
			assert.strictEqual(artifact?.scope, 'screen');
			assert.strictEqual(artifact?.scopeId, 'Billing');
			assert.strictEqual(artifact?.figmaUrl, 'https://figma.example/file/billing');
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Story prompt completion contract requires task memory, checkpoint, and evidence before completed signal', () => {
		const prompt = composeStoryExecutionPrompt({
			story: {
				id: 'US-301',
				title: 'Persist task memory',
				description: 'Require a task memory artifact before completion.',
				acceptanceCriteria: ['Task memory is written first'],
				priority: 1,
			},
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			taskMemoryPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/memory/US-301.json',
			executionCheckpointPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/checkpoints/US-301.checkpoint.json',
			evidencePath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/evidence/US-301.evidence.json',
			completionSignalPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/story-status.json',
			completionSignalKey: 'US-301',
		});

		assert.ok(prompt.includes('Before writing the completion signal, write a structured task memory artifact as valid JSON to:'));
		assert.ok(prompt.includes('After completing this executor pass, confirm what was done.'));
		assert.ok(prompt.includes('HARNESS will launch a separate Reviewer Agent pass after this executor pass completes.'));
		assert.ok(prompt.includes('Apply architecture thinking during execution: keep module boundaries explicit'));
		assert.ok(prompt.includes('Do not reduce governance to language-specific lint or static complexity rules'));
		assert.ok(prompt.includes('persist reusable architecture conclusions in architectureNotes'));
		assert.ok(prompt.includes('d:/workspace/vscode-copilot-ralph-runner/.harness-runner/memory/US-301.json'));
		assert.ok(prompt.includes('Also write a structured execution checkpoint artifact as valid JSON to:'));
		assert.ok(prompt.includes('d:/workspace/vscode-copilot-ralph-runner/.harness-runner/checkpoints/US-301.checkpoint.json'));
		assert.ok(prompt.includes('Also write a structured evidence artifact as valid JSON to:'));
		assert.ok(prompt.includes('d:/workspace/vscode-copilot-ralph-runner/.harness-runner/evidence/US-301.evidence.json'));
		assert.ok(prompt.includes('Only write the completion signal after the task memory artifact, execution checkpoint, and evidence artifact all exist and are complete.'));
	});

	test('Reviewer and refactor prompts encode the bounded review loop contract', () => {
		const reviewerPrompt = composeStoryReviewerPrompt({
			story: {
				id: 'US-304',
				title: 'Reviewer loop',
				description: 'Run a reviewer pass after execution.',
				acceptanceCriteria: ['Score all four review dimensions'],
				priority: 4,
			},
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			reviewPass: 1,
			maxReviewerPasses: 3,
			maxAutoRefactorRounds: 2,
			passingScore: 85,
			taskMemoryPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/memory/US-304.json',
			executionCheckpointPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/checkpoints/US-304.checkpoint.json',
			evidencePath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/evidence/US-304.evidence.json',
			completionSignalPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/story-status.json',
			completionSignalKey: 'US-304',
			taskMemoryLines: ['Summary: Initial execution completed.'],
			checkpointLines: ['Stage Goal: Reviewer handoff'],
			evidenceLines: ['Status: completed'],
			reviewLoopLines: ['autoRefactors=0/2'],
		});

		const refactorPrompt = composeStoryRefactorPrompt({
			story: {
				id: 'US-304',
				title: 'Reviewer loop',
				description: 'Run a reviewer pass after execution.',
				acceptanceCriteria: ['Score all four review dimensions'],
				priority: 4,
			},
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			refactorRound: 1,
			maxAutoRefactorRounds: 2,
			reviewPass: 1,
			reviewSummaryLines: ['Score: 70/100', 'Finding: Missing tests', 'Recommendation: Add one relevant passing test'],
			taskMemoryPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/memory/US-304.json',
			executionCheckpointPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/checkpoints/US-304.checkpoint.json',
			evidencePath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/evidence/US-304.evidence.json',
			completionSignalPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/story-status.json',
			completionSignalKey: 'US-304',
		});

		assert.ok(reviewerPrompt.includes('Reviewer Agent Rules:'));
		assert.ok(reviewerPrompt.includes('Score the result across exactly four dimensions'));
		assert.ok(reviewerPrompt.includes('For architecture consistency, explicitly judge module boundaries, responsibility clarity, reuse opportunities, and rollback safety.'));
		assert.ok(reviewerPrompt.includes('Do not rely on language-specific static complexity metrics or lint-only signals'));
		assert.ok(reviewerPrompt.includes('If the story touches too many files or mixes responsibilities, require a focused split or refactor recommendation'));
		assert.ok(reviewerPrompt.includes('reviewSummary must include: totalScore, passingScore, passed, reviewPass'));
		assert.ok(reviewerPrompt.includes('Persist reusable architecture conclusions in architectureNotes'));
		assert.ok(reviewerPrompt.includes('reviewLoop must include: reviewerPasses, autoRefactorRounds, maxAutoRefactorRounds'));
		assert.ok(refactorPrompt.includes('Executor Refactor Rules:'));
		assert.ok(refactorPrompt.includes('Auto-Refactor Round: 1/2'));
		assert.ok(refactorPrompt.includes('Apply only the smallest set of code changes needed to resolve the reviewer findings.'));
	});

	test('Story prompt composition uses deterministic ordered sections and bounds long context', () => {
		const prompt = composeStoryExecutionPrompt({
			story: {
				id: 'US-302',
				title: 'Ordered prompt composition',
				description: 'Refactor prompt construction into clearly ordered context sections for Copilot execution.',
				acceptanceCriteria: Array.from({ length: 10 }, (_, index) => `Acceptance criterion ${index + 1}`),
				priority: 2,
			},
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			projectConstraintsLines: Array.from({ length: 15 }, (_, index) => `Project constraint ${index + 1}`),
			designContextLines: ['Design note 1', 'Design note 2'],
			priorWorkLines: Array.from({ length: 16 }, (_, index) => `Prior work ${index + 1}`),
			sourceContextLines: Array.from({ length: 15 }, (_, index) => `Source context ${index + 1}`),
			knowledgeLines: Array.from({ length: 16 }, (_, index) => `Knowledge check ${index + 1}`),
			recentCheckpointLines: Array.from({ length: 15 }, (_, index) => `Recent checkpoint ${index + 1}`),
			taskMemoryPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/memory/US-302.json',
			executionCheckpointPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/checkpoints/US-302.checkpoint.json',
			evidencePath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/evidence/US-302.evidence.json',
			completionSignalPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/story-status.json',
			completionSignalKey: 'US-302',
			additionalExecutionRules: ['Do not ask questions.', 'Execute directly.'],
		});

		const systemIndex = prompt.indexOf('System Execution Rules:');
		const projectIndex = prompt.indexOf('Project Constraints:');
		const designIndex = prompt.indexOf('Design Context:');
		const priorWorkIndex = prompt.indexOf('Relevant Prior Work:');
		const sourceContextIndex = prompt.indexOf('Relevant Source Context:');
		const knowledgeIndex = prompt.indexOf('Knowledge Freshness Checks:');
		const checkpointIndex = prompt.indexOf('Recent Checkpoint:');
		const currentStoryIndex = prompt.indexOf('Current Story:');
		const completionIndex = prompt.indexOf('Completion Contract:');

		assert.ok(systemIndex >= 0);
		assert.ok(projectIndex > systemIndex);
		assert.ok(designIndex > projectIndex);
		assert.ok(priorWorkIndex > designIndex);
		assert.ok(sourceContextIndex > priorWorkIndex);
		assert.ok(knowledgeIndex > sourceContextIndex);
		assert.ok(checkpointIndex > knowledgeIndex);
		assert.ok(currentStoryIndex > checkpointIndex);
		assert.ok(completionIndex > currentStoryIndex);
		assert.ok(prompt.includes('... 3 more lines omitted for brevity.'));
		assert.ok(prompt.includes('... 2 more acceptance criteria omitted for brevity.'));
	});

	test('Story prompt can include machine policy gates between checkpoint and current story', () => {
		const prompt = composeStoryExecutionPrompt({
			story: {
				id: 'US-302A',
				title: 'Policy-guarded prompt',
				description: 'Show machine policy requirements in a bounded prompt section.',
				acceptanceCriteria: ['Prompt shows policy gates'],
				priority: 2,
			},
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			recentCheckpointLines: ['Checkpoint line'],
			policyLines: ['Completion Gates', '- Block dangerous path edits'],
			taskMemoryPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/memory/US-302A.json',
			executionCheckpointPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/checkpoints/US-302A.checkpoint.json',
			evidencePath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/evidence/US-302A.evidence.json',
			completionSignalPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/story-status.json',
			completionSignalKey: 'US-302A',
		});

		assert.ok(prompt.includes('Machine Policy Gates:'));
		assert.ok(prompt.indexOf('Recent Checkpoint:') < prompt.indexOf('Machine Policy Gates:'));
		assert.ok(prompt.indexOf('Machine Policy Gates:') < prompt.indexOf('Current Story:'));
	});

	test('Story prompt can include knowledge freshness checks before checkpoint and policy gates', () => {
		const prompt = composeStoryExecutionPrompt({
			story: {
				id: 'US-302B',
				title: 'Knowledge-aware prompt',
				description: 'Show missing knowledge in the execution context.',
				acceptanceCriteria: ['Prompt shows knowledge freshness issues'],
				priority: 2,
			},
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			knowledgeLines: ['- [missing-module-knowledge] extension.ts has weak coverage.'],
			recentCheckpointLines: ['Checkpoint line'],
			policyLines: ['Completion Gates', '- Block dangerous path edits'],
			taskMemoryPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/memory/US-302B.json',
			executionCheckpointPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/checkpoints/US-302B.checkpoint.json',
			evidencePath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/evidence/US-302B.evidence.json',
			completionSignalPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/story-status.json',
			completionSignalKey: 'US-302B',
		});

		assert.ok(prompt.includes('Knowledge Freshness Checks:'));
		assert.ok(prompt.indexOf('Knowledge Freshness Checks:') < prompt.indexOf('Recent Checkpoint:'));
		assert.ok(prompt.indexOf('Recent Checkpoint:') < prompt.indexOf('Machine Policy Gates:'));
	});

	test('Prompt composition omits empty optional sections safely', () => {
		const prompt = composeStoryExecutionPrompt({
			story: {
				id: 'US-303',
				title: 'Minimal prompt composition',
				description: 'Keep prompt generation resilient when context is missing.',
				acceptanceCriteria: ['Prompt still renders'],
				priority: 3,
			},
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			taskMemoryPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/memory/US-303.json',
			executionCheckpointPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/checkpoints/US-303.checkpoint.json',
				evidencePath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/evidence/US-303.evidence.json',
			completionSignalPath: 'd:/workspace/vscode-copilot-ralph-runner/.harness-runner/story-status.json',
			completionSignalKey: 'US-303',
		});

		assert.ok(prompt.includes('System Execution Rules:'));
		assert.ok(prompt.includes('Current Story:'));
		assert.ok(prompt.includes('Completion Contract:'));
		assert.strictEqual(prompt.includes('Project Constraints:'), false);
		assert.strictEqual(prompt.includes('Design Context:'), false);
		assert.strictEqual(prompt.includes('Relevant Prior Work:'), false);
		assert.strictEqual(prompt.includes('Relevant Source Context:'), false);
		assert.strictEqual(prompt.includes('Recent Checkpoint:'), false);
		assert.strictEqual(prompt.includes('Machine Policy Gates:'), false);
	});

	test('Synthesized story review keeps scoring bounded and actionable', () => {
		const review = createSynthesizedStoryReview({
			id: 'US-305',
			title: 'Synthesized review',
			description: 'Generate fallback review data.',
			acceptanceCriteria: ['Fallback review is actionable'],
			priority: 5,
		}, {
			maxAutoRefactorRounds: DEFAULT_STORY_AUTO_REFACTOR_LIMIT,
			reviewPass: 2,
			refactorPerformed: true,
			changedFiles: ['src/extension.ts', 'src/promptContext.ts', 'src/taskMemory.ts', 'src/storyEvidence.ts', 'src/executionCheckpoint.ts', 'README.md'],
			evidence: createSynthesizedStoryEvidence({
				id: 'US-305',
				title: 'Synthesized review',
				description: 'Generate fallback review data.',
				acceptanceCriteria: ['Fallback review is actionable'],
				priority: 5,
			}, {
				changedFiles: ['src/extension.ts', 'src/promptContext.ts', 'src/taskMemory.ts', 'src/storyEvidence.ts', 'src/executionCheckpoint.ts', 'README.md'],
				changedModules: ['src/execution', 'src/review', 'docs'],
				tests: [],
			}),
			fallbackReason: 'Reviewer output was missing.',
		});
		const validation = validateStoryReviewResult(review, {
			reviewPass: 2,
			maxAutoRefactorRounds: DEFAULT_STORY_AUTO_REFACTOR_LIMIT,
		});
		const loop = buildStoryReviewLoopState(review, {
			reviewerPasses: review.reviewPass,
			autoRefactorRounds: 1,
			maxAutoRefactorRounds: DEFAULT_STORY_AUTO_REFACTOR_LIMIT,
		});

		assert.strictEqual(review.maxReviewerPasses, deriveMaxReviewerPasses(DEFAULT_STORY_AUTO_REFACTOR_LIMIT));
		assert.strictEqual(review.dimensions.length, 4);
		assert.strictEqual(validation.isValid, true);
		assert.strictEqual(loop.autoRefactorRounds, 1);
		assert.ok(review.findings.some(finding => finding.includes('Reviewer output was missing')));
		assert.ok(review.findings.some(finding => finding.includes('Architecture note:')));
		assert.ok(review.recommendations.some(recommendation => recommendation.includes('Split the next pass by module boundary') || recommendation.includes('Split follow-up work by module')));
		assert.ok(review.recommendations.length > 0);
	});

	test('Task memory, checkpoint, and evidence preserve review metadata on round-trip', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-review-roundtrip-'));
		try {
			const reviewSummary = createSynthesizedStoryReview({
				id: 'US-306',
				title: 'Review round-trip',
				description: 'Persist review metadata',
				acceptanceCriteria: ['Review fields survive normalization'],
				priority: 6,
			}, {
				reviewPass: 3,
				maxAutoRefactorRounds: 2,
				refactorPerformed: true,
				refactorSummary: 'Two targeted reviewer-driven cleanups executed.',
				changedFiles: ['src/extension.ts'],
				fallbackReason: 'Round-trip verification.',
			});
			const reviewLoop = buildStoryReviewLoopState(reviewSummary, {
				reviewerPasses: 3,
				autoRefactorRounds: 2,
				maxAutoRefactorRounds: 2,
			});

			writeTaskMemory(workspaceRoot, 'US-306', {
				title: 'Review round-trip',
				summary: 'Task memory review payload.',
				changedFiles: ['src/extension.ts'],
				changedModules: ['src'],
				architectureNotes: ['Keep prompt composition and review orchestration separate so rollback stays localized.'],
				keyDecisions: ['Persist structured review metadata.'],
				constraintsConfirmed: ['prd.json remained read-only during task execution.'],
				testsRun: ['npm run compile'],
				risks: ['Review metadata drift'],
				followUps: ['Keep reviewer loop auditable.'],
				searchKeywords: ['review', 'loop'],
				reviewSummary,
				reviewLoop,
				source: 'copilot',
			});
			writeExecutionCheckpoint(workspaceRoot, 'US-306', {
				title: 'Review round-trip',
				status: 'completed',
				stageGoal: 'Persist reviewer pass details.',
				summary: 'Checkpoint contains reviewer data.',
				architectureNotes: ['Checkpoint should preserve the current module-boundary judgment for the next fresh chat.'],
				keyDecisions: ['Carry reviewer score across resets.'],
				confirmedConstraints: ['prd.json remained read-only during task execution.'],
				unresolvedRisks: ['None'],
				nextStoryPrerequisites: ['Read the persisted review summary.'],
				resumeRecommendation: 'Resume from the latest reviewed state.',
				reviewSummary,
				reviewLoop,
				source: 'copilot',
			}, 'completed');
			writeStoryEvidence(workspaceRoot, 'US-306', {
				title: 'Review round-trip',
				status: 'pendingReview',
				summary: 'Evidence contains reviewer data.',
				changedFiles: ['src/extension.ts'],
				changedModules: ['src'],
				architectureNotes: ['Evidence should explain the rollback seam for the review metadata persistence change.'],
				tests: [{ command: 'npm run compile', success: true }],
				riskLevel: 'medium',
				riskReasons: ['Core execution surface changed.'],
				releaseNotes: ['Adds reviewer metadata persistence.'],
				rollbackHints: ['Revert the reviewer loop wiring if needed.'],
				followUps: ['Confirm reviewer score threshold with the team.'],
				recommendFeatureFlag: false,
				evidenceGaps: [],
				approvalState: 'pending',
				approvalHistory: [],
				reviewSummary,
				reviewLoop,
				source: 'copilot',
			});

			const taskMemory = readTaskMemory(workspaceRoot, 'US-306');
			const checkpoint = readExecutionCheckpoint(workspaceRoot, 'US-306');
			const evidence = readStoryEvidence(workspaceRoot, 'US-306');

			assert.strictEqual(taskMemory?.reviewSummary?.reviewPass, 3);
			assert.strictEqual(taskMemory?.architectureNotes[0], 'Keep prompt composition and review orchestration separate so rollback stays localized.');
			assert.strictEqual(checkpoint?.reviewLoop?.autoRefactorRounds, 2);
			assert.strictEqual(checkpoint?.architectureNotes[0], 'Checkpoint should preserve the current module-boundary judgment for the next fresh chat.');
			assert.strictEqual(evidence?.reviewSummary?.refactorPerformed, true);
			assert.strictEqual(evidence?.architectureNotes[0], 'Evidence should explain the rollback seam for the review metadata persistence change.');
			assert.strictEqual(evidence?.reviewLoop?.endedReason, 'max-rounds');
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Policy config merges legacy compatibility rules without overriding the schema', () => {
		const config = buildEffectivePolicyConfig({ enabled: true }, {
			requireProjectConstraintsBeforeRun: true,
			requireDesignContextForTaggedStories: true,
		});

		assert.strictEqual(config.enabled, true);
		assert.ok(config.preflightRules.some(rule => rule.id === 'legacy-require-project-constraints'));
		assert.ok(config.preflightRules.some(rule => rule.id === 'legacy-require-design-context'));
		assert.ok(config.completionRules.some(rule => rule.id === 'protect-dangerous-paths'));
	});

	test('Completion policy blocks dangerous story-specific path edits after baseline diffing', () => {
		const config = buildEffectivePolicyConfig({
			enabled: true,
			completionRules: [{
				id: 'protect-dangerous-paths',
				title: 'Block dangerous path edits',
				phase: 'completion',
				type: 'restricted-paths',
				paths: ['prd.json', 'dist/**'],
				enabled: true,
				when: 'always',
			}],
		}, {
			requireProjectConstraintsBeforeRun: false,
			requireDesignContextForTaggedStories: false,
		});
		const changedFiles = deriveStoryChangedFiles(['README.md', 'prd.json', 'src/extension.ts'], {
			storyId: 'US-401',
			capturedAt: new Date().toISOString(),
			changedFiles: ['README.md'],
		});

		const result = evaluatePolicyGates(config, {
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			story: {
				id: 'US-401',
				title: 'Protect critical paths',
				description: 'Do not allow dangerous path edits.',
				acceptanceCriteria: ['Blocked paths are rejected'],
				priority: 1,
			},
			phase: 'completion',
			changedFiles,
			projectConstraints: null,
			isDesignSensitiveStory: false,
			hasArtifact: () => true,
		});

		assert.deepStrictEqual(changedFiles, ['prd.json', 'src/extension.ts']);
		assert.strictEqual(result.ok, false);
		assert.ok(result.violations[0].details.some(detail => detail.includes('prd.json')));
	});

	test('Completion policy can require at least one relevant test command to pass', () => {
		const config = buildEffectivePolicyConfig({
			enabled: true,
			completionRules: [{
				id: 'require-relevant-tests',
				title: 'Require at least one relevant test command',
				phase: 'completion',
				type: 'require-command',
				commandsFrom: 'projectConstraints.testCommands',
				minSuccesses: 1,
				filePatterns: ['src/**'],
				enabled: true,
				when: 'always',
			}],
		}, {
			requireProjectConstraintsBeforeRun: false,
			requireDesignContextForTaggedStories: false,
		});

		const result = evaluatePolicyGates(config, {
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			story: {
				id: 'US-402',
				title: 'Run policy tests',
				description: 'Require test coverage before completion.',
				acceptanceCriteria: ['A test command passes'],
				priority: 1,
			},
			phase: 'completion',
			changedFiles: ['src/extension.ts'],
			projectConstraints: {
				version: 1,
				generatedAt: new Date().toISOString(),
				technologySummary: [],
				buildCommands: [],
				testCommands: ['npm test'],
				lintCommands: [],
				styleRules: [],
				gitRules: [],
				architectureRules: [],
				allowedPaths: [],
				forbiddenPaths: [],
				reuseHints: [],
				deliveryChecklist: [],
			},
			isDesignSensitiveStory: false,
			hasArtifact: () => true,
			commandRunner: command => ({ command, success: command === 'npm test', output: 'ok' }),
		});

		assert.strictEqual(result.ok, true);
		assert.deepStrictEqual(result.executedCommands.map(command => command.command), ['npm test']);
	});

	test('Knowledge checks distinguish stale docs, missing module knowledge, and runbook gaps', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-knowledge-check-'));
		try {
			fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
			fs.writeFileSync(path.join(workspaceRoot, 'package.json'), JSON.stringify({
				name: 'knowledge-check-sample',
				main: './dist/extension.js',
				packageManager: 'npm@10.0.0',
				scripts: { compile: 'tsc --noEmit' },
			}, null, 2));
			fs.writeFileSync(path.join(workspaceRoot, 'prd.json'), JSON.stringify({
				project: 'Knowledge Check Sample',
				branchName: 'feature/knowledge-check',
				description: 'Sample workspace',
				userStories: [],
			}, null, 2));
			fs.writeFileSync(path.join(workspaceRoot, 'README.md'), '# Sample\n\nGeneral notes only.\n');
			fs.writeFileSync(path.join(workspaceRoot, 'src', 'extension.ts'), 'export const flow = true;\n');
			fs.writeFileSync(path.join(workspaceRoot, 'src', 'agentMap.ts'), 'export const weakCoverage = true;\n');

			const generated = generateAgentMapArtifacts(workspaceRoot);
			fs.writeFileSync(path.join(workspaceRoot, 'src', 'customKnowledge.ts'), 'export const uncovered = true;\n');
			const staleFuture = new Date(Date.now() + 30_000);
			fs.utimesSync(path.join(workspaceRoot, 'src', 'customKnowledge.ts'), staleFuture, staleFuture);

			const report = evaluateKnowledgeCoverage(workspaceRoot, {
				scope: 'run-completion',
				promptText: 'Update /harness-spec and Agent Map guidance, plus the harness run workflow.',
				changedFiles: ['src/customKnowledge.ts'],
			});

			assert.ok(generated.overview.moduleMap.some(moduleEntry => moduleEntry.id === 'agentMap'));
			assert.ok(report.issues.some(issue => issue.type === 'stale-documentation'));
			assert.ok(report.issues.some(issue => issue.type === 'missing-module-knowledge'));
			assert.ok(report.issues.some(issue => issue.type === 'missing-runbook-coverage'));
			assert.ok(summarizeKnowledgeCheckForPrompt(report).some(line => line.includes('stale-documentation')));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Knowledge-check policy rule can block completion on warning findings', () => {
		const config = buildEffectivePolicyConfig({
			enabled: true,
			completionRules: [{
				id: 'require-fresh-knowledge',
				title: 'Require fresh knowledge coverage before completion',
				phase: 'completion',
				type: 'knowledge-check',
				failOnSeverities: ['warning'],
				enabled: true,
				when: 'always',
			}],
		}, {
			requireProjectConstraintsBeforeRun: false,
			requireDesignContextForTaggedStories: false,
		});

		const result = evaluatePolicyGates(config, {
			workspaceRoot: 'd:/workspace/vscode-copilot-ralph-runner',
			story: {
				id: 'US-403',
				title: 'Block stale knowledge',
				description: 'Stop completion when docs lag behind the code.',
				acceptanceCriteria: ['Knowledge issues can gate completion'],
				priority: 1,
			},
			phase: 'completion',
			changedFiles: ['src/extension.ts'],
			projectConstraints: null,
			isDesignSensitiveStory: false,
			hasArtifact: () => true,
			knowledgeCheckReport: {
				...createEmptyKnowledgeCheckReport('run-completion', 'US-403'),
				issues: [{
					id: 'stale-docs',
					type: 'stale-documentation',
					severity: 'warning',
					summary: 'README is stale.',
					details: ['README.md is older than src/extension.ts.'],
					suggestions: ['Update README.md.'],
					relatedPaths: ['README.md', 'src/extension.ts'],
				}],
			},
		});

		assert.strictEqual(result.ok, false);
		assert.ok(result.violations[0].details.some(detail => detail.includes('stale-documentation')));
	});

	test('Policy command output decoder recovers Chinese text from Windows shell bytes', () => {
		const decoded = decodePolicyCommandOutput(Buffer.from([0xb5, 0xb1, 0xc7, 0xb0]), 'gbk');

		assert.strictEqual(decoded, '当前');
	});

	test('Story evidence artifact can be synthesized, written, and validated for auditable completion', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-story-evidence-'));
		try {
			const evidence = createSynthesizedStoryEvidence({
				id: 'US-402A',
				title: 'Generate evidence bundle',
				description: 'Summarize the completion evidence for a story.',
				acceptanceCriteria: ['Evidence is auditable'],
				priority: 1,
			}, {
				changedFiles: ['src/extension.ts', 'package.json'],
				changedModules: ['extension'],
				tests: [{ command: 'npm test', success: true, outputSummary: '51 passing' }],
				taskMemory: {
					storyId: 'US-402A',
					title: 'Generate evidence bundle',
					summary: 'Added a structured evidence artifact to completion flow.',
					changedFiles: ['src/extension.ts', 'package.json'],
					changedModules: ['extension'],
					architectureNotes: ['Core execution and packaging changed together, so rollback should stay file-scoped.'],
					keyDecisions: ['Make completion auditable'],
					patternsUsed: [],
					constraintsConfirmed: ['Do not edit prd.json'],
					testsRun: ['npm test'],
					risks: [],
					followUps: ['Review risk classification'],
					searchKeywords: ['evidence', 'audit'],
					relatedStories: [],
					createdAt: new Date().toISOString(),
				},
				source: 'synthesized',
			});

			const validation = validateStoryEvidence(evidence, 'US-402A');
			assert.strictEqual(validation.isValid, true);
			assert.strictEqual(validation.artifact.status, 'pendingRelease');
			assert.strictEqual(validation.artifact.recommendFeatureFlag, true);

			const evidencePath = writeStoryEvidence(workspaceRoot, 'US-402A', evidence);
			assert.ok(fs.existsSync(evidencePath));
			assert.strictEqual(readStoryEvidence(workspaceRoot, 'US-402A')?.riskLevel, 'high');
			assert.deepStrictEqual(readStoryEvidence(workspaceRoot, 'US-402A')?.approvalHistory, []);
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Story evidence approval decisions persist review history and auditable status changes', () => {
		const baseEvidence = validateStoryEvidence({
			storyId: 'US-037',
			title: 'High risk approval flow',
			status: 'pendingReview',
			summary: 'High-risk story awaiting manual approval.',
			changedFiles: ['src/extension.ts'],
			changedModules: ['src'],
			tests: [{ command: 'npm test', success: true }],
			riskLevel: 'high',
			riskReasons: ['Touches core execution surfaces.'],
			releaseNotes: ['Add manual approval workflow for high-risk stories.'],
			rollbackHints: ['Revert the approval-flow changes as a single unit if needed.'],
			followUps: [],
			recommendFeatureFlag: true,
			evidenceGaps: ['Release should still be verified manually.'],
			approvalState: 'pending',
			approvalHistory: [],
		}, 'US-037').artifact;

		const afterReviewApproval = applyStoryApprovalDecision(baseEvidence, {
			action: 'approved',
			note: 'Reviewed with rollback plan confirmed.',
			createdAt: '2025-02-01T10:00:00.000Z',
		});
		assert.strictEqual(afterReviewApproval.status, 'completed');
		assert.strictEqual(afterReviewApproval.approvalState, 'approved');
		assert.strictEqual(afterReviewApproval.approvalHistory.length, 1);
		assert.strictEqual(afterReviewApproval.approvalHistory[0].toStatus, 'completed');

		const afterRejection = applyStoryApprovalDecision(afterReviewApproval, {
			action: 'rejected',
			note: 'Need more release validation evidence.',
			createdAt: '2025-02-01T12:00:00.000Z',
		});
		assert.strictEqual(afterRejection.status, 'pendingReview');
		assert.strictEqual(afterRejection.approvalState, 'rejected');

		const afterNote = applyStoryApprovalDecision(afterRejection, {
			action: 'note',
			note: 'Waiting for updated test report.',
			createdAt: '2025-02-01T12:30:00.000Z',
		});
		assert.strictEqual(afterNote.status, 'pendingReview');
		assert.strictEqual(afterNote.approvalState, 'rejected');
		assert.strictEqual(afterNote.approvalHistory.length, 3);
		assert.strictEqual(afterNote.approvalHistory[2].action, 'note');
	});

	test('Legacy evidence artifacts without approval fields remain compatible after normalization', () => {
		const completedValidation = validateStoryEvidence({
			storyId: 'US-038A',
			title: 'Legacy completed evidence',
			status: 'completed',
			summary: 'Old workspaces may have evidence without approval metadata.',
			changedFiles: ['src/storyEvidence.ts'],
			changedModules: ['src'],
			tests: [{ command: 'npm test', success: true }],
			riskLevel: 'medium',
			riskReasons: ['Migration should keep old evidence readable.'],
			releaseNotes: ['No new approval metadata was stored originally.'],
			rollbackHints: ['Revert the evidence migration change if necessary.'],
			followUps: [],
			recommendFeatureFlag: false,
			evidenceGaps: [],
		}, 'US-038A');

		assert.strictEqual(completedValidation.isValid, true);
		assert.strictEqual(completedValidation.artifact.approvalState, 'notRequired');
		assert.deepStrictEqual(completedValidation.artifact.approvalHistory, []);

		const pendingValidation = validateStoryEvidence({
			storyId: 'US-038B',
			title: 'Legacy pending evidence',
			status: 'pendingRelease',
			summary: 'Old high-risk evidence should fall into pending approval automatically.',
			changedFiles: ['src/extension.ts'],
			changedModules: ['src'],
			tests: [{ command: 'npm test', success: true }],
			riskLevel: 'high',
			riskReasons: ['Touches core execution surfaces.'],
			releaseNotes: ['Approval metadata was added later.'],
			rollbackHints: ['Revert the high-risk story if release is blocked.'],
			followUps: [],
			recommendFeatureFlag: true,
			evidenceGaps: ['Manual release review still required.'],
		}, 'US-038B');

		assert.strictEqual(pendingValidation.isValid, true);
		assert.strictEqual(pendingValidation.artifact.approvalState, 'pending');
		assert.deepStrictEqual(pendingValidation.artifact.approvalHistory, []);
	});

	test('Story evidence validation rejects unresolved approval state for completed stories', () => {
		const validation = validateStoryEvidence({
			storyId: 'US-038',
			title: 'Completed story with invalid approval state',
			status: 'completed',
			summary: 'Completed story should not keep pending approval.',
			changedFiles: ['src/storyEvidence.ts'],
			changedModules: ['src'],
			tests: [{ command: 'npm test', success: true }],
			riskLevel: 'medium',
			riskReasons: ['Touches approval persistence logic.'],
			releaseNotes: ['No-op test fixture.'],
			rollbackHints: ['Revert the fixture changes.'],
			followUps: [],
			recommendFeatureFlag: false,
			evidenceGaps: [],
			approvalState: 'pending',
			approvalHistory: [],
		}, 'US-038');

		assert.strictEqual(validation.isValid, false);
		assert.ok(validation.errors.includes('approvalState cannot remain pending after a story is completed'));
	});

	test('Story evidence validation rejects silent low-risk completion when tests or critical evidence are missing', () => {
		const validation = validateStoryEvidence({
			storyId: 'US-402B',
			title: 'Incomplete evidence',
			status: 'completed',
			summary: 'Evidence exists but is incomplete.',
			changedFiles: ['src/extension.ts'],
			changedModules: ['extension'],
			tests: [],
			riskLevel: 'low',
			riskReasons: ['A change was made.'],
			releaseNotes: ['Updated extension flow.'],
			rollbackHints: ['Revert the story commit.'],
			followUps: ['Add missing tests.'],
			recommendFeatureFlag: false,
			evidenceGaps: [],
			approvalHistory: [],
			generatedAt: new Date().toISOString(),
		}, 'US-402B');

		assert.strictEqual(validation.isValid, false);
		assert.ok(validation.errors.some(error => error.includes('evidenceGaps')));
		assert.ok(validation.errors.some(error => error.includes('riskLevel cannot stay low')));
	});

	test('Task memory artifact can be written, read, and indexed per story', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-task-memory-'));
		try {
			const storyId = 'US-201';
			const memoryPath = writeTaskMemory(workspaceRoot, storyId, {
				title: 'Implement record design context command',
				summary: 'Added design context prompt injection and validation paths.',
				changedFiles: ['src/extension.ts', 'src/designContext.ts'],
				changedModules: ['extension', 'designContext'],
				keyDecisions: ['Summarize design data before prompt injection'],
				patternsUsed: ['Structured prompt sections'],
				constraintsConfirmed: ['Do not edit prd.json'],
				testsRun: ['npm run compile'],
				risks: ['Tagged-story heuristic may need refinement'],
				followUps: ['Add memory recall scoring'],
				searchKeywords: ['design context', 'prompt injection'],
				relatedStories: ['US-013'],
				source: 'copilot',
			});

			assert.ok(fs.existsSync(memoryPath));
			assert.strictEqual(hasTaskMemoryArtifact(workspaceRoot, storyId), true);

			const memory = readTaskMemory(workspaceRoot, storyId);
			assert.ok(memory);
			assert.strictEqual(memory?.summary, 'Added design context prompt injection and validation paths.');
			assert.deepStrictEqual(memory?.changedFiles, ['src/extension.ts', 'src/designContext.ts']);

			const index = upsertTaskMemoryIndexEntry(workspaceRoot, memory ?? {}, storyId);
			assert.strictEqual(index.entries.length, 1);
			assert.strictEqual(index.entries[0].storyId, storyId);
			assert.deepStrictEqual(index.entries[0].searchKeywords, ['design context', 'prompt injection']);

			const persistedIndex = readTaskMemoryIndex(workspaceRoot);
			assert.strictEqual(persistedIndex.entries.length, 1);
			assert.ok(persistedIndex.entries[0].memoryPath.endsWith(path.join('.harness-runner', 'memory', 'US-201.json')));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Task memory normalization, validation, and rebuild handle invalid input safely', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-task-memory-index-'));
		try {
			const validation = validateTaskMemory({
				summary: '   ',
				changedFiles: ['src/extension.ts', 'src/extension.ts', ''],
				keyDecisions: [],
				searchKeywords: ['memory recall', 'memory recall'],
			}, 'US-202');

			assert.strictEqual(validation.isValid, false);
			assert.deepStrictEqual(validation.artifact.changedFiles, ['src/extension.ts']);
			assert.deepStrictEqual(validation.artifact.searchKeywords, ['memory recall']);
			assert.ok(validation.errors.some(error => error.includes('summary')));

			writeTaskMemory(workspaceRoot, 'US-202', {
				title: 'Task memory model',
				summary: 'Persist task memory artifacts.',
				changedFiles: ['src/taskMemory.ts'],
				changedModules: ['taskMemory'],
				keyDecisions: ['Store one artifact per story'],
				constraintsConfirmed: ['Keep artifacts under .harness-runner'],
				testsRun: ['npm run compile'],
				searchKeywords: ['task memory'],
			});
			writeTaskMemory(workspaceRoot, 'US-203', {
				title: 'Memory index',
				summary: 'Rebuild a compact memory index.',
				changedFiles: ['src/taskMemory.ts', 'src/types.ts'],
				changedModules: ['taskMemory', 'types'],
				keyDecisions: ['Index entries should be sorted by recency'],
				constraintsConfirmed: ['Index should tolerate invalid files'],
				testsRun: ['npm run compile'],
				searchKeywords: ['memory index', 'recall'],
			});

			const rebuiltIndex = rebuildTaskMemoryIndex(workspaceRoot);
			assert.strictEqual(rebuiltIndex.entries.length, 2);
			assert.ok(rebuiltIndex.entries.some(entry => entry.storyId === 'US-202'));

			const promptLines = summarizeTaskMemoryForPrompt(readTaskMemory(workspaceRoot, 'US-202'));
			assert.ok(promptLines.includes('Changed Files'));
			assert.ok(promptLines.includes('Key Decisions'));
			assert.ok(promptLines.includes('Tests Run'));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Synthesized task memory produces a valid fallback artifact', () => {
		const memory = createSynthesizedTaskMemory(
			'US-204',
			'Fallback memory',
			'Fallback task memory synthesized for the story.',
			{
				changedFiles: ['src/extension.ts'],
				changedModules: ['src'],
				searchKeywords: ['fallback', 'memory'],
			}
		);

		const validation = validateTaskMemory(memory, 'US-204');
		assert.strictEqual(validation.isValid, true);
		assert.strictEqual(validation.artifact.source, 'synthesized');
		assert.deepStrictEqual(validation.artifact.changedFiles, ['src/extension.ts']);
	});

	test('Execution checkpoint artifact can be written, overwritten, and recovered per story', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-execution-checkpoint-'));
		try {
			const storyId = 'US-205';
			const firstPath = writeExecutionCheckpoint(workspaceRoot, storyId, {
				title: 'Persist checkpoint state',
				status: 'completed',
				stageGoal: 'Persist the latest execution handoff',
				summary: 'Stored a completion checkpoint after execution finished.',
				keyDecisions: ['Use one latest-only checkpoint path per story'],
				confirmedConstraints: ['Do not edit prd.json'],
				unresolvedRisks: ['None at handoff time'],
				nextStoryPrerequisites: ['Review the persisted checkpoint before starting the next related story'],
				resumeRecommendation: 'Continue with the next pending story.',
				source: 'copilot',
			}, 'completed');

			assert.strictEqual(hasExecutionCheckpointArtifact(workspaceRoot, storyId), true);
			assert.ok(fs.existsSync(firstPath));

			const overwrittenPath = writeExecutionCheckpoint(workspaceRoot, storyId, {
				title: 'Persist checkpoint state',
				status: 'failed',
				stageGoal: 'Recover after a failed rerun',
				summary: 'Stored the latest failed checkpoint for recovery.',
				keyDecisions: ['Overwrite the prior checkpoint instead of creating conflicting siblings'],
				confirmedConstraints: ['Keep checkpoint path deterministic'],
				unresolvedRisks: ['The rerun failure still needs investigation'],
				nextStoryPrerequisites: ['Resolve the blocking failure before rerunning the story'],
				resumeRecommendation: 'Inspect the workspace and retry once the failure is fixed.',
				source: 'copilot',
			}, 'failed');

			assert.strictEqual(overwrittenPath, firstPath);

			const checkpoint = readExecutionCheckpoint(workspaceRoot, storyId);
			assert.ok(checkpoint);
			assert.strictEqual(checkpoint?.status, 'failed');
			assert.strictEqual(checkpoint?.summary, 'Stored the latest failed checkpoint for recovery.');

			const damagedPath = path.join(workspaceRoot, '.harness-runner', 'checkpoints', 'US-206.checkpoint.json');
			fs.mkdirSync(path.dirname(damagedPath), { recursive: true });
			fs.writeFileSync(damagedPath, '{not-valid-json', 'utf-8');

			assert.strictEqual(readExecutionCheckpoint(workspaceRoot, 'US-206'), null);
			const fallback = createSynthesizedExecutionCheckpoint(
				'US-206',
				'Recover damaged checkpoint',
				'interrupted',
				'Synthesized a recoverable checkpoint after corrupted JSON was detected.',
				{
					stageGoal: 'Recover the interrupted story state',
					unresolvedRisks: ['The previous checkpoint artifact was corrupted and replaced.'],
				}
			);
			const validation = validateExecutionCheckpoint(fallback, 'US-206', 'interrupted');
			assert.strictEqual(validation.isValid, true);
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Source context index reuses project scan signals and persists a lightweight artifact', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-source-context-'));
		try {
			fs.mkdirSync(path.join(workspaceRoot, 'src', 'test'), { recursive: true });
			fs.writeFileSync(path.join(workspaceRoot, 'package.json'), JSON.stringify({
				name: 'source-context-sample',
				main: 'dist/extension.js',
				scripts: {
					compile: 'tsc --noEmit',
					package: 'vsce package',
					'vscode:prepublish': 'npm run package',
					lint: 'eslint src',
					test: 'vscode-test'
				},
			}, null, 2));
			fs.writeFileSync(path.join(workspaceRoot, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, rootDir: 'src' } }, null, 2));
			fs.writeFileSync(path.join(workspaceRoot, 'eslint.config.mjs'), 'export default [];\n');
			fs.writeFileSync(path.join(workspaceRoot, 'README.md'), '# Sample\n');
			fs.writeFileSync(path.join(workspaceRoot, 'esbuild.js'), 'console.log("build");\n');
			fs.writeFileSync(path.join(workspaceRoot, 'src', 'extension.ts'), 'export function activate() {}\n');
			fs.writeFileSync(path.join(workspaceRoot, 'src', 'types.ts'), 'export interface SampleType { value: string; }\n');
			fs.writeFileSync(path.join(workspaceRoot, 'src', 'taskMemory.ts'), 'export type TaskMemoryKind = "story";\n');

			const scanned = scanWorkspaceForSourceContextIndex(workspaceRoot);
			assert.ok(scanned.sourceDirectories.includes('src'));
			assert.ok(scanned.testDirectories.includes('src/test'));
			assert.ok(scanned.buildScripts.includes('npm run compile'));
			assert.ok(scanned.keyEntryFiles.includes('src/extension.ts'));
			assert.ok(scanned.reusableModuleHints.some(item => item.includes('src/types.ts')));
			assert.ok(scanned.typeDefinitionHints.some(item => item.includes('src/types.ts#SampleType')));
			assert.strictEqual(scanned.metadata?.scanSource, 'project-constraints-baseline');

			refreshSourceContextIndex(workspaceRoot);
			const persisted = getSourceContextIndex(workspaceRoot);
			assert.ok(persisted);
			assert.strictEqual(persisted?.workspaceRootName, path.basename(workspaceRoot));

			const promptLines = summarizeSourceContextIndexForPrompt(persisted);
			assert.ok(promptLines.includes('Source Directories'));
			assert.ok(promptLines.includes('Key Entry Files'));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Source context index degrades safely when optional files or git history are missing', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-source-context-degraded-'));
		try {
			fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
			fs.writeFileSync(path.join(workspaceRoot, 'package.json'), JSON.stringify({
				name: 'degraded-source-context',
				scripts: {
					compile: 'tsc --noEmit'
				},
			}, null, 2));
			fs.writeFileSync(path.join(workspaceRoot, 'src', 'extension.ts'), 'export function activate() {}\n');

			const scanned = scanWorkspaceForSourceContextIndex(workspaceRoot);
			assert.deepStrictEqual(scanned.testDirectories, []);
			assert.ok(scanned.sourceDirectories.includes('src'));
			assert.ok(scanned.buildScripts.includes('npm run compile'));
			assert.ok(Array.isArray(scanned.hotspotPaths));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Source context recall scores keywords, modules, files, and task-memory hints together', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-source-context-recall-'));
		try {
			fs.mkdirSync(path.join(workspaceRoot, 'src', 'test'), { recursive: true });
			fs.writeFileSync(path.join(workspaceRoot, 'package.json'), JSON.stringify({
				name: 'source-context-recall',
				scripts: { compile: 'tsc --noEmit', test: 'vscode-test' },
			}, null, 2));
			fs.writeFileSync(path.join(workspaceRoot, 'src', 'extension.ts'), 'export function activate() {}\n');
			fs.writeFileSync(path.join(workspaceRoot, 'src', 'taskMemory.ts'), 'export interface StoryMemory {}\n');
			fs.writeFileSync(path.join(workspaceRoot, 'src', 'promptContext.ts'), 'export type PromptSection = { title: string; };\n');

			const index = scanWorkspaceForSourceContextIndex(workspaceRoot);
			const matches = recallRelevantSourceContext(index, {
				id: 'US-700',
				title: 'Refine prompt context recall',
				description: 'Improve source context recall for prompt building and task memory handoff.',
				acceptanceCriteria: ['Use promptContext.ts and taskMemory.ts hints'],
				priority: 1,
				moduleHints: ['promptContext'],
				fileHints: ['src/taskMemory.ts'],
			}, {
				limit: 3,
				memoryHints: [{
					storyId: 'US-650',
					title: 'Prior prompt memory',
					summary: 'Touched prompt context and task memory.',
					changedFiles: ['src/promptContext.ts', 'src/taskMemory.ts'],
					changedModules: ['promptContext', 'taskMemory'],
					architectureNotes: ['Keep prompt composition separate from task-memory persistence so recall changes remain reversible.'],
					keyDecisions: ['Keep source context bounded'],
					patternsUsed: [],
					constraintsConfirmed: ['Do not edit prd.json'],
					testsRun: ['npm run compile'],
					risks: [],
					followUps: [],
					searchKeywords: ['prompt', 'task', 'memory'],
					relatedStories: [],
					createdAt: '2026-04-02T12:00:00.000Z',
				}],
			});

			assert.strictEqual(matches.length > 0, true);
			assert.ok(matches.some(match => match.label.includes('src/taskMemory.ts')));
			assert.ok(matches[0].reasons.length > 0);

			const promptLines = summarizeRecalledSourceContextForPrompt(matches, 2);
			assert.ok(promptLines.some(line => line.includes('Why it matters:')));
			assert.ok(promptLines.some(line => line.includes('Category:')));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Recent checkpoint selection prefers the current story and otherwise falls back to the latest valid checkpoint', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-recent-checkpoint-'));
		try {
			writeExecutionCheckpoint(workspaceRoot, 'US-600', {
				title: 'Older checkpoint',
				status: 'completed',
				stageGoal: 'Older work',
				summary: 'Older checkpoint summary.',
				keyDecisions: ['Older checkpoint decision'],
				confirmedConstraints: ['Older checkpoint constraint'],
				unresolvedRisks: ['Older checkpoint risk'],
				nextStoryPrerequisites: ['Older prerequisite'],
				resumeRecommendation: 'Older resume recommendation.',
				updatedAt: '2026-04-02T12:00:00.000Z',
			}, 'completed');

			writeExecutionCheckpoint(workspaceRoot, 'US-601', {
				title: 'Latest other checkpoint',
				status: 'failed',
				stageGoal: 'Latest other work',
				summary: 'Latest other checkpoint summary.',
				keyDecisions: ['Latest other checkpoint decision'],
				confirmedConstraints: ['Latest other checkpoint constraint'],
				unresolvedRisks: ['Latest other checkpoint risk'],
				nextStoryPrerequisites: ['Latest other prerequisite'],
				resumeRecommendation: 'Latest other resume recommendation.',
				updatedAt: '2026-04-02T12:10:00.000Z',
			}, 'failed');

			writeExecutionCheckpoint(workspaceRoot, 'US-602', {
				title: 'Current story checkpoint',
				status: 'interrupted',
				stageGoal: 'Current story recovery',
				summary: 'Current story checkpoint summary.',
				keyDecisions: ['Current story checkpoint decision'],
				confirmedConstraints: ['Current story checkpoint constraint'],
				unresolvedRisks: ['Current story checkpoint risk'],
				nextStoryPrerequisites: ['Current story prerequisite'],
				resumeRecommendation: 'Current story resume recommendation.',
				updatedAt: '2026-04-02T12:05:00.000Z',
			}, 'interrupted');

			const validCheckpoints = listValidExecutionCheckpoints(workspaceRoot);
			assert.deepStrictEqual(validCheckpoints.map(checkpoint => checkpoint.storyId), ['US-601', 'US-602', 'US-600']);

			const preferredCheckpoint = getRecentExecutionCheckpoint(workspaceRoot, { preferredStoryId: 'US-602' });
			assert.strictEqual(preferredCheckpoint?.storyId, 'US-602');

			const fallbackCheckpoint = getRecentExecutionCheckpoint(workspaceRoot, { preferredStoryId: 'US-999' });
			assert.strictEqual(fallbackCheckpoint?.storyId, 'US-601');

			const promptLines = summarizeExecutionCheckpointForPrompt(fallbackCheckpoint);
			assert.ok(promptLines.some(line => line.includes('US-601')));
			assert.ok(promptLines.some(line => line.includes('Resume Recommendation: Latest other resume recommendation.')));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Task memory recall ranks related memories and summarizes bounded prior work', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-task-memory-recall-'));
		try {
			writeTaskMemory(workspaceRoot, 'US-401', {
				title: 'Design prompt injection',
				summary: 'Injected design context into prompts.',
				changedFiles: ['src/extension.ts', 'src/designContext.ts'],
				changedModules: ['src', 'designContext'],
				keyDecisions: ['Use structured sections for design guidance'],
				constraintsConfirmed: ['Keep prompts bounded'],
				testsRun: ['npm run compile'],
				searchKeywords: ['design', 'prompt', 'injection'],
				relatedStories: ['US-402'],
				createdAt: '2026-03-31T10:00:00.000Z',
			});
			upsertTaskMemoryIndexEntry(workspaceRoot, readTaskMemory(workspaceRoot, 'US-401') ?? {}, 'US-401');

			writeTaskMemory(workspaceRoot, 'US-402', {
				title: 'Memory recall scoring',
				summary: 'Added ranking and prior work summarization.',
				changedFiles: ['src/taskMemory.ts', 'src/extension.ts'],
				changedModules: ['taskMemory', 'src'],
				keyDecisions: ['Score by overlap and recency'],
				constraintsConfirmed: ['Prefer bounded prompt context'],
				testsRun: ['npm run compile'],
				searchKeywords: ['memory', 'recall', 'prompt'],
				relatedStories: ['US-401'],
				createdAt: '2026-03-31T10:05:00.000Z',
			});
			upsertTaskMemoryIndexEntry(workspaceRoot, readTaskMemory(workspaceRoot, 'US-402') ?? {}, 'US-402');

			writeTaskMemory(workspaceRoot, 'US-499', {
				title: 'Unrelated backend task',
				summary: 'Adjusted backend config.',
				changedFiles: ['server/config.ts'],
				changedModules: ['server'],
				keyDecisions: ['Use env defaults'],
				constraintsConfirmed: ['None'],
				testsRun: ['npm test'],
				searchKeywords: ['backend', 'config'],
				createdAt: '2026-03-31T09:00:00.000Z',
			});
			upsertTaskMemoryIndexEntry(workspaceRoot, readTaskMemory(workspaceRoot, 'US-499') ?? {}, 'US-499');

			const matches = recallRelatedTaskMemories(workspaceRoot, {
				id: 'US-500',
				title: 'Recall related prompt memory',
				description: 'Rank prompt and memory recall work for injection.',
				acceptanceCriteria: ['Prior work stays bounded'],
				priority: 1,
				dependsOn: ['US-402'],
				moduleHints: ['taskMemory'],
				fileHints: ['src/extension.ts'],
			}, { limit: 2 });

			assert.strictEqual(matches.length, 2);
			assert.strictEqual(matches[0].memory.storyId, 'US-402');
			assert.ok(matches[0].score > matches[1].score);
			assert.ok(matches[0].reasons.some(reason => reason.includes('direct story relationship')));

			const promptLines = summarizeRecalledTaskMemoriesForPrompt(matches, 2);
			assert.ok(promptLines.some(line => line.includes('US-402')));
			assert.ok(promptLines.some(line => line.includes('Why it matters:')));
			assert.ok(promptLines.some(line => line.includes('Decision:')));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('Context-aware prompt composes persisted constraints, design context, and recalled prior work together', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-context-prompt-'));
		try {
			fs.mkdirSync(path.join(workspaceRoot, 'src', 'ui'), { recursive: true });
			fs.writeFileSync(path.join(workspaceRoot, 'package.json'), JSON.stringify({
				name: 'context-prompt-sample',
				scripts: {
					compile: 'tsc --noEmit',
					lint: 'eslint src',
					test: 'vscode-test'
				},
				devDependencies: {
					typescript: '^5.0.0'
				}
			}, null, 2));
			fs.writeFileSync(path.join(workspaceRoot, 'tsconfig.json'), JSON.stringify({
				compilerOptions: {
					strict: true,
					rootDir: 'src'
				}
			}, null, 2));
			fs.writeFileSync(path.join(workspaceRoot, 'eslint.config.mjs'), 'export default [];\n');
			fs.writeFileSync(path.join(workspaceRoot, 'README.md'), '# Sample\n');

			initializeProjectConstraintsArtifacts(workspaceRoot);
			writeDesignContext(workspaceRoot, 'US-501', {
				sourceType: 'figma',
				figmaUrl: 'https://figma.example/file?node-id=5-1',
				summary: 'Dashboard summary cards should stay visually aligned.',
				layoutConstraints: ['Keep cards in one row on desktop'],
				componentReuseTargets: ['SummaryCard'],
				tokenRules: ['Use semantic color tokens'],
				responsiveRules: ['Stack cards below tablet breakpoint'],
				acceptanceChecks: ['Card hierarchy matches approved design'],
				manualNotes: ['Reuse the shared SummaryCard component'],
			});

			writeTaskMemory(workspaceRoot, 'US-490', {
				title: 'Dashboard cards refactor',
				summary: 'Refactored dashboard card layout and prompt constraints.',
				changedFiles: ['src/ui/dashboard.tsx', 'src/promptContext.ts'],
				changedModules: ['ui', 'promptContext'],
				keyDecisions: ['Reuse SummaryCard instead of introducing a new widget'],
				constraintsConfirmed: ['Keep prompts bounded'],
				testsRun: ['npm run compile'],
				searchKeywords: ['dashboard', 'cards', 'prompt'],
				relatedStories: ['US-501'],
				createdAt: '2026-03-31T11:00:00.000Z',
			});
			upsertTaskMemoryIndexEntry(workspaceRoot, readTaskMemory(workspaceRoot, 'US-490') ?? {}, 'US-490');

			const projectConstraintsLines = summarizeProjectConstraintsForPrompt(loadMergedProjectConstraints(workspaceRoot));
			const designContextLines = summarizeDesignContextForPrompt(readDesignContext(workspaceRoot, 'US-501'));
			const matches = recallRelatedTaskMemories(workspaceRoot, {
				id: 'US-501',
				title: 'Refresh dashboard cards',
				description: 'Refresh dashboard summary cards while preserving prompt quality constraints.',
				acceptanceCriteria: ['Dashboard cards stay aligned'],
				priority: 1,
				dependsOn: ['US-490'],
				moduleHints: ['ui'],
				fileHints: ['src/promptContext.ts'],
			}, { limit: 2 });
			const priorWorkLines = summarizeRecalledTaskMemoriesForPrompt(matches, 2);
			const sourceContextLines = summarizeRecalledSourceContextForPrompt(recallRelevantSourceContext(scanWorkspaceForSourceContextIndex(workspaceRoot), {
				id: 'US-501',
				title: 'Refresh dashboard cards',
				description: 'Refresh dashboard summary cards while preserving prompt quality constraints.',
				acceptanceCriteria: ['Dashboard cards stay aligned', 'Reuse SummaryCard'],
				priority: 1,
				moduleHints: ['promptContext'],
				fileHints: ['src/promptContext.ts'],
			}, {
				limit: 2,
				memoryHints: matches.map(match => match.memory),
			}), 2);
			writeExecutionCheckpoint(workspaceRoot, 'US-500', {
				title: 'Dashboard checkpoint',
				status: 'completed',
				stageGoal: 'Carry the latest dashboard layout decisions into the next story',
				summary: 'Checkpoint for the latest dashboard work.',
				keyDecisions: ['Preserve SummaryCard reuse during follow-up work'],
				confirmedConstraints: ['Keep prompts bounded'],
				unresolvedRisks: ['Validate card stacking below tablet breakpoint'],
				nextStoryPrerequisites: ['Review the saved dashboard checkpoint before continuing'],
				resumeRecommendation: 'Start from the checkpoint instead of reusing prior chat context.',
				updatedAt: '2026-04-02T12:20:00.000Z',
			}, 'completed');
			const recentCheckpointLines = summarizeExecutionCheckpointForPrompt(getRecentExecutionCheckpoint(workspaceRoot, { preferredStoryId: 'US-501' }));
			const prompt = composeStoryExecutionPrompt({
				story: {
					id: 'US-501',
					title: 'Refresh dashboard cards',
					description: 'Refresh dashboard summary cards while preserving prompt quality constraints.',
					acceptanceCriteria: ['Dashboard cards stay aligned', 'Reuse SummaryCard'],
					priority: 1,
				},
				workspaceRoot,
				projectConstraintsLines,
				designContextLines,
				priorWorkLines,
				sourceContextLines,
				recentCheckpointLines,
				evidencePath: path.join(workspaceRoot, '.harness-runner', 'evidence', 'US-501.evidence.json'),
				taskMemoryPath: path.join(workspaceRoot, '.harness-runner', 'memory', 'US-501.json'),
				executionCheckpointPath: path.join(workspaceRoot, '.harness-runner', 'checkpoints', 'US-501.checkpoint.json'),
				completionSignalPath: path.join(workspaceRoot, '.harness-runner', 'story-status.json'),
				completionSignalKey: 'US-501',
			});

			assert.ok(prompt.includes('Project Constraints:'));
			assert.ok(prompt.includes('Design Context:'));
			assert.ok(prompt.includes('Relevant Prior Work:'));
			assert.ok(prompt.includes('Relevant Source Context:'));
			assert.ok(prompt.includes('Recent Checkpoint:'));
			assert.ok(prompt.includes('Technology Summary'));
			assert.ok(prompt.includes('Build Commands'));
			assert.ok(prompt.includes('Component Reuse Requirements:'));
			assert.ok(prompt.includes('US-490 — Dashboard cards refactor'));
			assert.ok(prompt.includes('src/promptContext.ts'));
			assert.ok(prompt.includes('US-500 — Dashboard checkpoint [completed]'));
			assert.ok(prompt.indexOf('Project Constraints:') < prompt.indexOf('Design Context:'));
			assert.ok(prompt.indexOf('Design Context:') < prompt.indexOf('Relevant Prior Work:'));
			assert.ok(prompt.indexOf('Relevant Prior Work:') < prompt.indexOf('Relevant Source Context:'));
			assert.ok(prompt.indexOf('Relevant Source Context:') < prompt.indexOf('Recent Checkpoint:'));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});
});
