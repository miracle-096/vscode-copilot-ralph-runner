import { StoryExecutionStatus } from './types';

export const SUPPORTED_RALPH_LANGUAGES = ['Chinese', 'English'] as const;

export type SupportedRalphLanguage = typeof SUPPORTED_RALPH_LANGUAGES[number];

export interface RalphLanguagePack {
	language: SupportedRalphLanguage;
	projectConstraintsTitle: string;
	gitCommitRule: string;
	common: {
		noWorkspaceFolder: string;
		untitledStory: string;
		noDescription: string;
		statusPriority: (status: string, priority: number) => string;
		storyFormat: (storyId: string, title: string) => string;
	};
	statusBar: {
		idleText: string;
		idleTooltip: string;
		runningText: string;
		runningTooltip: string;
		pendingApprovalsText: (count: number) => string;
		pendingApprovalsTooltip: (count: number) => string;
	};
	runtime: {
		alreadyRunning: string;
		prdNotFoundRoot: string;
		stalledTaskWarning: (taskId: string) => string;
		clearAndRetry: string;
		cancel: string;
		projectConstraintsRequiredBeforeRun: string;
		policyBlockedBeforeStory: (storyId: string) => string;
		policyBlockedAfterStory: (storyId: string) => string;
		allStoriesCompleted: string;
		pausedAfterLoops: (count: number) => string;
		notRunning: string;
		stopped: string;
		designContextRequiredBeforeStory: (storyId: string) => string;
	};
	status: {
		title: (project: string) => string;
		completed: (completed: number, total: number) => string;
		failed: (failed: number) => string;
		awaitingReview: (count: number) => string;
		awaitingRelease: (count: number) => string;
		highRisk: (count: number) => string;
		pending: (pending: number) => string;
		inProgress: (storyId: string | null) => string;
		next: (nextLabel: string) => string;
		running: (running: boolean) => string;
		summary: (completed: number, total: number, nextId: string | null) => string;
		none: string;
		allDone: string;
		yes: string;
		no: string;
	};
	reset: {
		noTrackedStories: string;
		placeholder: string;
		storyReset: (storyId: string) => string;
	};
	approval: {
		noReviewableStories: string;
		storyPlaceholder: string;
		actionPlaceholder: (storyId: string) => string;
		approveReviewLabel: string;
		approveReleaseLabel: string;
		rejectLabel: string;
		addNoteLabel: string;
		approveReviewDescription: string;
		approveReleaseDescription: string;
		rejectDescription: string;
		addNoteDescription: string;
		noteTitle: (storyId: string) => string;
		notePrompt: (actionLabel: string) => string;
		notePlaceholder: string;
		rejectNoteRequired: string;
		updated: (storyId: string, status: string) => string;
		openEvidence: string;
		openFlow: string;
		required: (storyId: string, status: string) => string;
		historyHeading: string;
		noHistory: string;
		riskLabel: (risk: string) => string;
		approvalLabel: (approval: string) => string;
	};
	policyConfig: {
		title: string;
		scopePlaceholder: string;
		scopeUserLabel: string;
		scopeUserDescription: string;
		scopeWorkspaceLabel: string;
		scopeWorkspaceDescription: string;
		enablePlaceholder: string;
		enabledLabel: string;
		enabledDescription: string;
		disabledLabel: string;
		disabledDescription: string;
		rulesPlaceholder: string;
		rulesHint: string;
		approvalModePlaceholder: string;
		saved: string;
		openSettings: string;
		ruleLabels: {
			requireProjectConstraints: string;
			requireDesignContext: string;
			protectDangerousPaths: string;
			requireRelevantTests: string;
			requireTaskMemory: string;
			requireExecutionCheckpoint: string;
			requireStoryEvidence: string;
		};
		ruleDescriptions: {
			requireProjectConstraints: string;
			requireDesignContext: string;
			protectDangerousPaths: string;
			requireRelevantTests: string;
			requireTaskMemory: string;
			requireExecutionCheckpoint: string;
			requireStoryEvidence: string;
		};
		approvalModes: {
			default: { label: string; description: string; };
			bypass: { label: string; description: string; };
			autopilot: { label: string; description: string; };
		};
	};
	initProjectConstraints: {
		success: string;
		copiedPrompt: string;
		openEditableRules: string;
		openGeneratedSummary: string;
		failed: (message: string) => string;
		languageChanged: string;
		referenceSourcePlaceholder: string;
		referenceCollectionProgress: (fileCount: number, noteCount: number) => string;
		referenceSourceOptions: {
			files: { label: string; description: string; };
			notes: { label: string; description: string; };
			finish: { label: string; description: string; };
		};
		referenceFilesDialogTitle: string;
		referenceFilesOpenLabel: string;
		referenceFileNoteTitle: (fileLabel: string) => string;
		referenceFileNotePrompt: string;
		referenceFileNotePlaceholder: string;
		additionalNotesTitle: string;
		additionalNotesPrompt: string;
		started: string;
	};
	sourceContext: {
		success: (filePath: string) => string;
		openIndex: string;
		failed: (message: string) => string;
		previewPlaceholder: string;
		previewTitle: string;
		previewStory: (storyId: string, title: string) => string;
		previewScore: (score: number) => string;
		previewReasons: (reasons: string[]) => string;
		previewValue: (value: string) => string;
		previewReady: (storyId: string, matchCount: number) => string;
		noMatches: (storyId: string) => string;
	};
	agentMap: {
		success: (gapCount: number) => string;
		openOverview: string;
		openKnowledgeCatalog: string;
		failed: (message: string) => string;
	};
	chatSpec: {
		participantDescription: string;
		commandDescription: string;
		missingWorkspace: string;
		missingConstraints: string;
		emptyPrompt: string;
		thinking: string;
		tempFileSaved: (filePath: string) => string;
		tempFileSaveFailed: (message: string) => string;
		copiedPrompt: string;
		autoSent: string;
		openedWithClipboardFallback: string;
		autoSendSkipped: string;
		error: (message: string) => string;
	};
	designContext: {
		noStories: string;
			noExistingDrafts: string;
			noReusableDrafts: string;
			noPendingStories: string;
		saved: (storyId: string, hasWarnings: boolean) => string;
		open: string;
		selectStoryPlaceholder: string;
		entryPlaceholder: string;
		storyActionPlaceholder: string;
			managementPlaceholder: string;
			createFirstPlaceholder: string;
		actionPlaceholder: string;
		sourcePlaceholder: string;
			deletePlaceholder: string;
			matchDraftPlaceholder: string;
			matchStoryPlaceholder: string;
			deleteAction: string;
			deleteConfirm: (label: string) => string;
			deleted: (label: string) => string;
			matching: {
				copiedPrompt: string;
				started: (storyCount: number, draftCount: number) => string;
				failed: (message: string) => string;
				missingArtifact: string;
				noRelevantMatches: (storyCount: number) => string;
				completed: (matchedStoryCount: number, candidateStoryCount: number, draftCount: number) => string;
			};
		noSharedTargets: (storyId: string) => string;
		linkTargetPlaceholder: string;
		linkSaved: (storyId: string, count: number, hasWarnings: boolean) => string;
			matchAllPending: {
				label: string;
				description: (count: number) => string;
			};
			managementActions: {
				create: { label: string; description: string; };
				createFirst: { label: string; description: string; };
				delete: { label: string; description: string; };
				match: { label: string; description: string; };
			};
		entryModes: {
			single: { label: string; description: string; };
			batch: { label: string; description: string; };
		};
		storyActions: {
			review: { label: string; description: string; };
			visualDraft: { label: string; description: string; };
		};
		actions: {
			review: { label: string; description: string; };
			linkShared: { label: string; description: string; };
			advanced: { label: string; description: (hasExistingStoryContext: boolean) => string; };
		};
		draft: {
			scopePlaceholder: string;
			inputModePlaceholder: string;
			noVisualSources: string;
			copiedPrompt: string;
			started: (label: string) => string;
			saved: (label: string, hasWarnings: boolean) => string;
			failed: (message: string) => string;
			missingArtifact: (label: string) => string;
			screenIdTitle: string;
			screenIdPrompt: string;
			moduleIdTitle: string;
			moduleIdPrompt: string;
			figmaUrlTitle: string;
			figmaUrlPrompt: string;
			screenshotDialogTitle: string;
			screenshotOpenLabel: string;
			additionalInstructionsTitle: string;
			additionalInstructionsPrompt: string;
			scopeOptions: {
				story: { label: string; description: string; };
				screen: { label: string; description: string; };
				module: { label: string; description: string; };
				project: { label: string; description: string; };
			};
			inputModes: {
				figma: { label: string; description: string; };
				screenshots: { label: string; description: string; };
				both: { label: string; description: string; };
			};
		};
		suggestion: {
			noSharedContext: (storyId: string) => string;
			copiedPrompt: string;
			started: (storyId: string) => string;
			saved: (storyId: string, hasWarnings: boolean) => string;
			failed: (message: string) => string;
			missingArtifact: (storyId: string) => string;
			additionalInstructionsTitle: string;
			additionalInstructionsPrompt: string;
		};
		sources: {
			figma: { label: string; description: string; };
			screenshots: { label: string; description: string; };
			notes: { label: string; description: string; };
		};
		input: {
			figmaUrlTitle: string;
			figmaUrlPrompt: string;
			screenshotDialogTitle: string;
			screenshotOpenLabel: string;
			summaryTitle: string;
			summaryPrompt: string;
			screenNameTitle: string;
			screenNamePrompt: string;
			manualNotesTitle: string;
			manualNotesPrompt: string;
			referenceDocsTitle: string;
			referenceDocsPrompt: string;
			layoutConstraintsTitle: string;
			layoutConstraintsPrompt: string;
			componentReuseTitle: string;
			componentReusePrompt: string;
			tokenRulesTitle: string;
			tokenRulesPrompt: string;
			responsiveRulesTitle: string;
			responsiveRulesPrompt: string;
			doNotChangeTitle: string;
			doNotChangePrompt: string;
			acceptanceChecksTitle: string;
			acceptanceChecksPrompt: string;
		};
	};
	taskMemoryRecall: {
		noRelatedTaskMemories: (storyId: string) => string;
		chooseStoryPlaceholder: string;
		nextPendingStoryLabel: string;
		nextPendingStoryDescription: (storyId: string, title: string) => string;
		chooseStoryLabel: string;
		chooseStoryDescription: string;
		previewPlaceholder: string;
		previewTitle: string;
		previewStory: (storyId: string, title: string) => string;
		previewScore: (score: number) => string;
		previewReasons: (reasons: string[]) => string;
		previewSummary: (summary: string) => string;
		previewKeyDecisions: string;
		previewChangedFiles: string;
	};
	appendStories: {
		missingPrd: string;
		requestTitle: string;
		requestPrompt: string;
		requestPlaceholder: string;
		requestCancelled: string;
		copiedPrompt: string;
		started: string;
		prompt: {
			workspaceAnalysis: string;
			requestLine: (request: string) => string;
			workspaceRootLine: (workspaceRoot: string) => string;
			currentProjectLine: (project: string) => string;
			currentBranchLine: (branchName: string) => string;
			currentStoryCountLine: (count: number) => string;
			gitModeLine: (hasGitRepo: boolean, autoCommitEnabled: boolean) => string;
			readCurrentPrd: string;
			nextStoryLine: (nextStoryId: string, nextPriority: number) => string;
			existingStoriesHeading: string;
			noExistingStories: string;
			instructionsHeading: string;
			appendOnlyInstruction: string;
			preserveExisting: string;
			numberStories: string;
			sequentialPriority: string;
			noPassesOrNotes: string;
			noSeparateGitStories: string;
			storyLevelGitInstruction: string;
			directWriteInstruction: string;
		};
	};
	menu: {
		placeholder: string;
		items: Array<{ command: string; label: string; description: string; }>;
	};
	help: {
		introductionTitle: string;
		manualTitle: string;
	};
	quickStart: {
		existingPrd: string;
		start: string;
		openPrd: string;
		missingPrdPlaceholder: string;
		provideChoice: { label: string; description: string; };
		generateChoice: { label: string; description: string; };
		provideDialogTitle: string;
		provideDialogOpenLabel: string;
		provideCancelled: string;
		provideSuccess: string;
		goalTitle: string;
		goalPrompt: string;
		goalPlaceholder: string;
		goalCancelled: string;
		copiedPrompt: string;
		generationStarted: string;
		prompt: {
			workspaceAnalysis: string;
			goalLine: (goal: string) => string;
			workspaceRootLine: (workspaceRoot: string) => string;
			gitModeLine: (hasGitRepo: boolean, autoCommitEnabled: boolean) => string;
			generateFileInstruction: string;
			instructionsHeading: string;
			goalMandatory: string;
			logicalSequence: string;
			granularStories: string;
			numberStories: string;
			noPassesOrNotes: string;
			noSeparateGitStories: string;
			storyLevelGitInstruction: string;
			importantHeading: string;
			portablePaths: string[];
		};
	};
}

const CHINESE_PACK: RalphLanguagePack = {
	language: 'Chinese',
	projectConstraintsTitle: 'RALPH 项目约束',
	gitCommitRule: '完成用户故事并准备 Git 提交时，提交标题和描述必须使用中文。',
	common: {
		noWorkspaceFolder: '当前未打开工作区文件夹。',
		untitledStory: '未命名故事',
		noDescription: '无描述。',
		statusPriority: (status, priority) => `[${status}] 优先级 ${priority}`,
		storyFormat: (storyId, title) => `${storyId} — ${title}`,
	},
	statusBar: {
		idleText: '$(rocket) Ralph Runner',
		idleTooltip: 'RALPH Runner：点击显示命令菜单',
		runningText: '$(sync~spin) Ralph Runner',
		runningTooltip: 'RALPH Runner：任务执行中，点击打开菜单',
		pendingApprovalsText: count => `$(pass-filled) Ralph Runner ${count}`,
		pendingApprovalsTooltip: count => `RALPH Runner：当前有 ${count} 个待审批故事，点击打开命令菜单或直接运行“RALPH: 审批高风险故事”`,
	},
	runtime: {
		alreadyRunning: 'RALPH 已在运行中。',
		prdNotFoundRoot: '工作区根目录中未找到 prd.json。',
		stalledTaskWarning: taskId => `RALPH：任务 ${taskId} 在上一次中断运行后仍保持为“inprogress”。`,
		clearAndRetry: '清理并重试',
		cancel: '取消',
		projectConstraintsRequiredBeforeRun: 'RALPH：执行前必须先初始化项目约束，请先运行“RALPH: 初始化项目约束”。',
		policyBlockedBeforeStory: storyId => `RALPH：机器策略门禁阻止了 ${storyId} 开始执行，请先根据输出面板中的缺失项完成处理。`,
		policyBlockedAfterStory: storyId => `RALPH：机器策略门禁阻止了 ${storyId} 完成，请先处理输出面板中列出的缺失项或失败命令。`,
		allStoriesCompleted: 'RALPH：所有用户故事均已完成！',
		pausedAfterLoops: count => `RALPH 已在执行 ${count} 个步骤后暂停。运行“RALPH: 开始执行”即可继续。`,
		notRunning: 'RALPH 当前未运行。',
		stopped: 'RALPH 已停止。',
		designContextRequiredBeforeStory: storyId => `RALPH：执行 ${storyId} 前必须先补充界面设计描述。请先运行“RALPH: 界面设计描述”。`,
	},
	status: {
		title: project => `RALPH 状态 — ${project}`,
		completed: (completed, total) => `已完成: ${completed}/${total}`,
		failed: failed => `失败: ${failed}`,
		awaitingReview: count => `待评审: ${count}`,
		awaitingRelease: count => `待发布: ${count}`,
		highRisk: count => `高风险: ${count}`,
		pending: pending => `待处理: ${pending}`,
		inProgress: storyId => `进行中: ${storyId || '无'}`,
		next: nextLabel => `下一个: ${nextLabel}`,
		running: running => `运行中: ${running ? '是' : '否'}`,
		summary: (completed, total, nextId) => `RALPH：已完成 ${completed}/${total} 个故事。下一个：${nextId || '全部完成！'}`,
		none: '无',
		allDone: '全部完成！',
		yes: '是',
		no: '否',
	},
	reset: {
		noTrackedStories: '没有可重置的已完成或失败故事。',
		placeholder: '选择要重置的用户故事',
		storyReset: storyId => `故事 ${storyId} 已重置。`,
	},
	approval: {
		noReviewableStories: '当前没有需要人工审批的高风险故事。',
		storyPlaceholder: '选择要审批的故事',
		actionPlaceholder: storyId => `选择对 ${storyId} 执行的审批操作`,
		approveReviewLabel: '批准评审',
		approveReleaseLabel: '批准发布',
		rejectLabel: '拒绝并退回评审',
		addNoteLabel: '补充审批说明',
		approveReviewDescription: '确认当前评审结果，并推进到下一审批阶段',
		approveReleaseDescription: '确认可以结束人工审批并完成故事',
		rejectDescription: '把故事退回待评审，并记录拒绝原因',
		addNoteDescription: '只补充审批备注，不改变当前状态',
		noteTitle: storyId => `审批说明 — ${storyId}`,
		notePrompt: actionLabel => `可选：输入“${actionLabel}”的审批说明；拒绝时建议写清原因`,
		notePlaceholder: '例如：已核对风险、需要补测试、允许灰度发布……',
		rejectNoteRequired: '拒绝时必须填写审批说明。',
		updated: (storyId, status) => `RALPH：${storyId} 的审批结果已更新，当前状态：${status}。`,
		openEvidence: '打开证据包',
		openFlow: '打开审批流',
		required: (storyId, status) => `RALPH：${storyId} 当前为“${status}”，需要人工审批。`,
		historyHeading: '审批记录：',
		noHistory: '暂无审批记录。',
		riskLabel: risk => `风险：${risk}`,
		approvalLabel: approval => `审批：${approval}`,
	},
	policyConfig: {
		title: 'RALPH：配置执行检查',
		scopePlaceholder: '选择保存位置',
		scopeUserLabel: '保存到 User 全局设置',
		scopeUserDescription: '写入用户级 settings，并清除当前 workspace 的同名覆盖',
		scopeWorkspaceLabel: '保存到当前 Workspace',
		scopeWorkspaceDescription: '只对当前工作区生效',
		enablePlaceholder: '选择是否启用这套自动检查',
		enabledLabel: '启用自动检查',
		enabledDescription: '在故事开始前和完成前自动检查规则',
		disabledLabel: '关闭自动检查',
		disabledDescription: '保留当前规则配置，但暂时不执行检查',
		rulesPlaceholder: '勾选需要启用的内置检查项',
		rulesHint: '未勾选的规则会写回为 disabled=false；高级自定义仍可在设置 JSON 中继续维护。',
		approvalModePlaceholder: '选择审批提示模式，使其与当前 chat 使用习惯保持一致',
		saved: 'RALPH：执行检查和审批提示模式已更新。',
		openSettings: '打开设置',
		ruleLabels: {
			requireProjectConstraints: '开始前先检查项目约束',
			requireDesignContext: 'UI 敏感故事先检查设计说明',
			protectDangerousPaths: '拦住高风险文件改动',
			requireRelevantTests: '完成前要求至少一个相关测试命令通过',
			requireTaskMemory: '完成前要有任务记忆',
			requireExecutionCheckpoint: '完成前要有执行检查点',
			requireStoryEvidence: '完成前要有故事证据',
		},
		ruleDescriptions: {
			requireProjectConstraints: '适合规则要求明确的仓库；还没准备好项目约束时就先别开始',
			requireDesignContext: '适合 UI/设计敏感项目；还没准备设计稿或设计说明时就先别开始',
			protectDangerousPaths: '避免误改 prd.json、构建产物、node_modules 等高风险路径',
			requireRelevantTests: '改动命中源码或配置时，要求至少一个相关测试命令成功',
			requireTaskMemory: '完成前要写入 .ralph/memory/US-xxx.json',
			requireExecutionCheckpoint: '完成前要写入 .ralph/checkpoints/US-xxx.checkpoint.json',
			requireStoryEvidence: '完成前要写入 .ralph/evidence/US-xxx.evidence.json',
		},
		approvalModes: {
			default: { label: 'default：弹出审批提示', description: '适合普通交互模式；故事结束后弹出提示，让你打开审批流或证据包' },
			bypass: { label: 'bypass：直接进入审批流', description: '适合希望跳过中间提示的人；高风险故事完成后直接进入审批界面' },
			autopilot: { label: 'autopilot：仅落盘并挂到状态栏', description: '适合 chat autopilot；不依赖弹窗，改为日志、状态栏和菜单持续提示待审批故事' },
		},
	},
	initProjectConstraints: {
		success: 'RALPH：项目约束已初始化。',
		copiedPrompt: 'RALPH：项目约束整理提示词已复制到剪贴板，请粘贴到 Copilot Chat。',
		openEditableRules: '打开可编辑规则',
		openGeneratedSummary: '打开生成摘要',
		failed: message => `RALPH：初始化项目约束失败：${message}`,
		languageChanged: 'RALPH 语言已切换。若要让项目约束中的语言相关规则同步更新，请重新初始化项目约束。',
		referenceSourcePlaceholder: '继续补充已有规范、说明，或选择完成提供',
		referenceCollectionProgress: (fileCount, noteCount) => `（已添加 ${fileCount} 个文件，${noteCount} 条补充说明）`,
		referenceSourceOptions: {
			files: { label: '$(folder-opened) 提供已有规范文件', description: '选择现有的规范、README、团队约定或其他项目规则文件，交给 Copilot 一起整理' },
			notes: { label: '$(note) 补充文字要求', description: '输入这次必须纳入项目约束的规则、禁区或交付要求' },
			finish: { label: '$(check) 完成提供并继续', description: '结束当前补充阶段，基于仓库扫描结果和你刚才提供的内容交给 Copilot 整理' },
		},
		referenceFilesDialogTitle: '选择已有项目规范或团队约定文件',
		referenceFilesOpenLabel: '使用这些规则文件',
		referenceFileNoteTitle: fileLabel => `文件备注 — ${fileLabel}`,
		referenceFileNotePrompt: '可选：说明这个文件为什么重要、哪些规则必须采纳，或哪些内容需要忽略',
		referenceFileNotePlaceholder: '留空表示不补充这个文件的备注',
		additionalNotesTitle: '初始化项目约束 — 补充说明',
		additionalNotesPrompt: '可选：输入这次必须体现的规范、禁区、交付标准或协作要求',
		started: 'RALPH：Copilot 正在结合仓库扫描结果和你补充的规范，整理项目约束。',
	},
	sourceContext: {
		success: filePath => `RALPH：源码上下文索引已刷新：${filePath}`,
		openIndex: '打开索引',
		failed: message => `RALPH：刷新源码上下文索引失败：${message}`,
		previewPlaceholder: '选择一个故事以预览相关仓库源上下文',
		previewTitle: '相关仓库源上下文预览',
		previewStory: (storyId, title) => `故事：${storyId} — ${title}`,
		previewScore: score => `分数：${score}`,
		previewReasons: reasons => `原因：${reasons.join('; ')}`,
		previewValue: value => `线索：${value}`,
		previewReady: (storyId, matchCount) => `RALPH：已为 ${storyId} 预览 ${matchCount} 条相关仓库源上下文。`,
		noMatches: storyId => `RALPH：${storyId} 当前没有命中足够的仓库源上下文，将回退到现有提示构建流程。`,
	},
	agentMap: {
		success: gapCount => `RALPH：Agent Map 已生成。总览页与知识目录页已写入 .ralph/agent-map/，当前显式记录 ${gapCount} 个知识缺口。`,
		openOverview: '打开总览页',
		openKnowledgeCatalog: '打开知识目录页',
		failed: message => `RALPH：生成 Agent Map 失败：${message}`,
	},
	chatSpec: {
		participantDescription: '根据 RALPH 合并后的项目规范，整理最终需求描述，并自动转交给 Copilot Chat 执行。',
		commandDescription: '按当前项目规范完善你的描述，产出最终版本后自动发送到 Copilot Chat。',
		missingWorkspace: 'RALPH Spec：当前未打开工作区，无法读取项目规范。',
		missingConstraints: 'RALPH Spec：还没有初始化项目规范。请先运行“RALPH: 初始化项目约束”，再使用 @ralph /ralph-spec。',
		emptyPrompt: 'RALPH Spec：请在 @ralph /ralph-spec 后面补充你的需求描述、修改想法或任务说明。',
		thinking: 'RALPH 正在根据已初始化的项目规范完善描述并整理最终版本...',
		tempFileSaved: filePath => `RALPH Spec：最终请求已写入临时文件：${filePath}`,
		tempFileSaveFailed: message => `RALPH Spec：写入临时文件失败：${message}`,
		copiedPrompt: 'RALPH Spec：最终请求已复制到剪贴板，请粘贴到新的 Copilot Chat。',
		autoSent: 'RALPH Spec：已将最终请求自动发送到新的 Copilot Chat。',
		openedWithClipboardFallback: 'RALPH Spec：无法直接自动发送，已复制最终请求并打开 Copilot Chat。',
		autoSendSkipped: 'RALPH Spec：未能从结果中提取可执行的最终请求，请直接使用上方代码块。',
		error: message => `RALPH Spec：生成约束对齐后的最终描述失败：${message}`,
	},
	designContext: {
		noStories: '未找到可用的用户故事，请先准备 prd.json。',
			noExistingDrafts: 'RALPH：当前还没有任何界面设计描述。',
			noReusableDrafts: 'RALPH：当前还没有可复用的界面设计描述，请先创建项目级、页面级或模块级描述。',
			noPendingStories: 'RALPH：当前没有可匹配的未完成用户故事。',
		saved: (storyId, hasWarnings) => hasWarnings ? `RALPH：已为 ${storyId} 保存界面设计描述，但存在警告。` : `RALPH：已为 ${storyId} 保存界面设计描述。`,
		open: '打开界面设计描述',
		selectStoryPlaceholder: '选择要补充界面设计描述的用户故事',
		entryPlaceholder: '选择处理方式：只处理当前故事，或先做一份可复用的界面设计描述',
		storyActionPlaceholder: '选择当前故事要怎么处理',
			managementPlaceholder: '已检测到界面设计描述，选择接下来要做什么',
			createFirstPlaceholder: '当前还没有界面设计描述，先创建一份',
		actionPlaceholder: '选择界面设计描述的处理方式',
		sourcePlaceholder: '选择界面设计描述的主要来源',
			deletePlaceholder: '选择要删除的界面设计描述',
			matchDraftPlaceholder: '选择候选界面设计描述，可多选，Copilot 会判断哪些故事真正相关',
			matchStoryPlaceholder: '顶部可评估全部未完成故事，下方可多选候选故事后让 Copilot 判断是否需要关联',
			deleteAction: '删除设计稿',
			deleteConfirm: label => `确定删除 ${label} 吗？该操作不会自动恢复。`,
			deleted: label => `RALPH：已删除 ${label}。`,
			matching: {
				copiedPrompt: 'RALPH：批量设计稿匹配提示词已复制到剪贴板，请粘贴到 Copilot Chat。',
				started: (storyCount, draftCount) => `RALPH：Copilot 正在从 ${storyCount} 个候选未完成故事中判断哪些应关联这 ${draftCount} 份界面设计描述。`,
				failed: message => `RALPH：批量匹配界面设计描述失败：${message}`,
				missingArtifact: 'RALPH：Copilot 已完成，但未找到批量设计稿匹配结果文件。',
				noRelevantMatches: storyCount => `RALPH：Copilot 已检查 ${storyCount} 个候选未完成故事，未发现需要关联当前设计稿的故事。`,
				completed: (matchedStoryCount, candidateStoryCount, draftCount) => `RALPH：Copilot 已在 ${candidateStoryCount} 个候选未完成故事中，实际关联 ${matchedStoryCount} 个故事到 ${draftCount} 份界面设计描述；其余故事未关联。`,
			},
		noSharedTargets: storyId => `RALPH：${storyId} 还没有可复用的界面设计描述。先做项目级、页面级或模块级描述，再回来匹配会更省事。`,
		linkTargetPlaceholder: '勾选这次要匹配到当前故事的可复用界面设计描述',
		linkSaved: (storyId, count, hasWarnings) => hasWarnings ? `RALPH：已为 ${storyId} 匹配 ${count} 份可复用界面设计描述，但存在警告。` : `RALPH：已为 ${storyId} 匹配 ${count} 份可复用界面设计描述。`,
			matchAllPending: {
				label: '$(rocket) 一键全匹配未完成故事',
				description: count => `把当前选中的设计稿作为候选资源，让 Copilot 在全部 ${count} 个未完成故事中判断真正相关的故事`,
			},
			managementActions: {
				create: { label: '$(add) 新增设计稿', description: '创建新的界面设计描述，可用于单个故事，也可用于后续批量复用' },
				createFirst: { label: '$(add) 创建设计稿', description: '当前还没有界面设计描述，先创建第一份' },
				delete: { label: '$(trash) 删除设计稿', description: '删除某一份现有界面设计描述' },
				match: { label: '$(link) 设计稿匹配用户故事', description: '选择候选设计稿和故事，让 Copilot 判断哪些故事真正需要关联这些资源' },
			},
		entryModes: {
			single: { label: '$(symbol-field) 单独匹配当前故事', description: '整理当前故事的界面设计描述，可勾选要复用的项目、页面或模块描述' },
			batch: { label: '$(layers) 批量匹配多个故事', description: '先做一份可复用的界面设计描述，后面多个故事都可以直接套用' },
		},
		storyActions: {
			review: { label: '$(eye) 自动整理当前故事', description: '基于已有描述快速生成一份可直接查看的当前故事说明' },
			visualDraft: { label: '$(device-camera-video) 导入当前故事设计图', description: '用 Figma 或截图为当前故事生成界面设计描述' },
		},
		actions: {
			review: { label: '$(eye) 整理当前故事', description: '快速整理一份当前故事可直接使用的界面设计描述' },
			linkShared: { label: '$(link) 匹配可复用描述', description: '把已有的项目、页面或模块界面设计描述匹配到当前故事' },
			advanced: { label: '$(edit) 补充细节', description: hasExistingStoryContext => hasExistingStoryContext ? '补充当前故事的界面设计描述细节' : '补充一份新的当前故事界面设计描述' },
		},
			draft: {
				scopePlaceholder: '这份可复用的界面设计描述要保存到哪一层',
				inputModePlaceholder: '选择要导入的视觉参考类型',
				noVisualSources: 'RALPH：至少要提供一个 Figma 链接或一张截图，才能生成界面设计描述。',
				copiedPrompt: 'RALPH：界面设计描述提示词已复制到剪贴板，请粘贴到 Copilot Chat。',
				started: label => `RALPH：Copilot 正在为 ${label} 生成界面设计描述。`,
				saved: (label, hasWarnings) => hasWarnings ? `RALPH：已为 ${label} 保存界面设计描述，但存在警告。` : `RALPH：已为 ${label} 保存界面设计描述。`,
				failed: message => `RALPH：生成界面设计描述失败：${message}`,
				missingArtifact: label => `RALPH：Copilot 已完成，但未找到 ${label} 的界面设计描述文件。`,
				screenIdTitle: '界面设计描述 — 页面或屏幕标识',
				screenIdPrompt: '输入这份可复用界面设计描述对应的页面或屏幕标识',
				moduleIdTitle: '界面设计描述 — 模块标识',
				moduleIdPrompt: '输入这份可复用界面设计描述对应的模块标识',
				figmaUrlTitle: '界面设计描述 — Figma 链接',
				figmaUrlPrompt: '粘贴这次要参考的 Figma 链接',
				screenshotDialogTitle: '选择这次要参考的截图文件',
				screenshotOpenLabel: '使用这些截图',
				additionalInstructionsTitle: '界面设计描述 — 补充说明',
				additionalInstructionsPrompt: '可选：补充告诉模型这次特别要看什么，或者哪些地方不能跑偏',
				scopeOptions: {
					story: { label: '$(symbol-field) 当前故事', description: '只给当前故事生成一份界面设计描述' },
					screen: { label: '$(browser) 页面 / 屏幕', description: '生成可复用的页面或屏幕级界面设计描述' },
					module: { label: '$(symbol-module) 模块', description: '生成可复用的模块级界面设计描述' },
					project: { label: '$(layers) 整个项目', description: '生成全项目通用的界面设计描述' },
				},
				inputModes: {
					figma: { label: '$(figma) 仅 Figma', description: '只根据 Figma 生成界面设计描述' },
					screenshots: { label: '$(device-camera) 仅截图', description: '只根据截图生成界面设计描述' },
					both: { label: '$(combine) Figma + 截图', description: '同时参考 Figma 和截图，生成更完整的界面设计描述' },
				},
			},
			suggestion: {
				noSharedContext: storyId => `RALPH：${storyId} 还没有可复用的界面设计描述，暂时没法自动补故事差异。请先准备项目级、页面级或模块级描述。`,
				copiedPrompt: 'RALPH：当前故事的界面设计描述提示词已复制到剪贴板，请粘贴到 Copilot Chat。',
				started: storyId => `RALPH：Copilot 正在为 ${storyId} 生成当前故事的界面设计描述。`,
				saved: (storyId, hasWarnings) => hasWarnings ? `RALPH：已为 ${storyId} 保存当前故事的界面设计描述，但存在警告。` : `RALPH：已为 ${storyId} 保存当前故事的界面设计描述。`,
				failed: message => `RALPH：生成当前故事的界面设计描述失败：${message}`,
				missingArtifact: storyId => `RALPH：Copilot 已完成，但未找到 ${storyId} 的界面设计描述文件。`,
				additionalInstructionsTitle: '当前故事界面设计描述 — 补充说明',
				additionalInstructionsPrompt: '可选：告诉模型这个故事这次只需要补哪些差异或重点',
			},
		sources: {
			figma: { label: '$(figma) Figma 链接', description: '记录 Figma 链接以及补充说明' },
			screenshots: { label: '$(device-camera) 截图', description: '记录本地截图路径以及补充说明' },
			notes: { label: '$(note) 文字说明', description: '仅用文字补充界面设计描述' },
		},
		input: {
			figmaUrlTitle: '界面设计描述 — Figma 链接',
			figmaUrlPrompt: '粘贴该故事对应的 Figma 链接',
			screenshotDialogTitle: '为该故事选择截图文件',
			screenshotOpenLabel: '使用这些截图',
			summaryTitle: '界面设计描述 — 摘要',
			summaryPrompt: '概述该故事的设计意图',
			screenNameTitle: '界面设计描述 — 页面名称',
			screenNamePrompt: '可选：页面或屏幕名称',
			manualNotesTitle: '界面设计描述 — 文字备注',
			manualNotesPrompt: '可选：使用逗号或换行分隔多条备注',
			referenceDocsTitle: '界面设计描述 — 参考文档',
			referenceDocsPrompt: '可选：相对路径文档或 URL',
			layoutConstraintsTitle: '界面设计描述 — 布局约束',
			layoutConstraintsPrompt: '列出该故事的关键布局约束',
			componentReuseTitle: '界面设计描述 — 组件复用',
			componentReusePrompt: '列出应复用的组件',
			tokenRulesTitle: '界面设计描述 — Token 规则',
			tokenRulesPrompt: '列出颜色、间距或排版 Token 规则',
			responsiveRulesTitle: '界面设计描述 — 响应式规则',
			responsiveRulesPrompt: '列出响应式行为要求',
			doNotChangeTitle: '界面设计描述 — 禁止修改区域',
			doNotChangePrompt: '列出必须保持不变的区域',
			acceptanceChecksTitle: '界面设计描述 — 验收检查',
			acceptanceChecksPrompt: '列出实现后的视觉验收检查项',
		},
	},
	taskMemoryRecall: {
		noRelatedTaskMemories: storyId => `RALPH：未找到与 ${storyId} 相关的任务记忆。`,
		chooseStoryPlaceholder: '选择用于回忆相关任务记忆的故事',
		nextPendingStoryLabel: '下一个待执行故事',
		nextPendingStoryDescription: (storyId, title) => `${storyId} — ${title}`,
		chooseStoryLabel: '选择故事',
		chooseStoryDescription: '选择任意用户故事以预览相关任务记忆',
		previewPlaceholder: '选择一个故事以预览相关任务记忆',
		previewTitle: '相关任务记忆预览',
		previewStory: (storyId, title) => `故事：${storyId} — ${title}`,
		previewScore: score => `分数：${score}`,
		previewReasons: reasons => `原因：${reasons.join('; ')}`,
		previewSummary: summary => `摘要：${summary}`,
		previewKeyDecisions: '关键决策：',
		previewChangedFiles: '变更文件：',
	},
	appendStories: {
		missingPrd: '未找到 prd.json。请先执行“生成 PRD”。',
		requestTitle: 'RALPH 追加用户故事：描述新增需求',
		requestPrompt: '描述你希望追加到当前 prd.json 的需求、范围或变更。',
		requestPlaceholder: '例如：补充管理后台审计日志相关的用户故事…',
		requestCancelled: 'RALPH：已取消，未提供新增需求描述。',
		copiedPrompt: 'RALPH：追加故事提示词已复制到剪贴板，请粘贴到 Copilot Chat。',
		started: 'RALPH：Copilot 正在更新 prd.json 以追加新的用户故事。',
		prompt: {
			workspaceAnalysis: '先阅读当前工作区，特别是工作区根目录中的 prd.json，并理解现有项目目标与用户故事。',
			requestLine: request => `用户希望在现有 PRD 基础上追加以下需求：${request}`,
			workspaceRootLine: workspaceRoot => `工作区根目录：${workspaceRoot}`,
			currentProjectLine: project => `当前项目名：${project}`,
			currentBranchLine: branchName => `当前建议分支：${branchName}`,
			currentStoryCountLine: count => `当前用户故事数量：${count}`,
			gitModeLine: (hasGitRepo, autoCommitEnabled) => `Git 仓库检测：${hasGitRepo ? '已检测到' : '未检测到'}；自动 Git 提交设置：${autoCommitEnabled ? '开启' : '关闭'}`,
			readCurrentPrd: '请直接读取并修改现有的 prd.json，而不是新建其他 PRD 文件。',
			nextStoryLine: (nextStoryId, nextPriority) => `新增故事编号从 ${nextStoryId} 开始，优先级建议从 ${nextPriority} 开始递增。`,
			existingStoriesHeading: '现有用户故事摘要：',
			noExistingStories: '- 当前还没有用户故事。',
			instructionsHeading: 'INSTRUCTIONS:',
			appendOnlyInstruction: '只追加新的用户故事；除非为保持 JSON 合法性或避免明显重复，否则不要删除或重写已有故事。',
			preserveExisting: '保留现有 project、branchName、description 和已有 userStories 的语义。',
			numberStories: '新增用户故事编号必须连续递增，并从给定的下一个编号开始。',
			sequentialPriority: '新增用户故事 priority 需要连续递增，并排在现有故事之后。',
			noPassesOrNotes: '不要在用户故事中加入 passes 或 notes 字段，进度会单独跟踪。',
			noSeparateGitStories: '不要新增单独的 Git 提交用户故事，只保留和功能需求直接相关的用户故事。',
			storyLevelGitInstruction: '如果已检测到 Git 仓库且自动 Git 提交设置开启，可以默认每个实现类故事在执行时自行完成提交；否则不要为 Git 提交单独生成故事。',
			directWriteInstruction: '请直接更新工作区根目录中的 prd.json 文件，而不是只展示建议内容。',
		},
	},
	menu: {
		placeholder: 'RALPH Runner：选择一个命令',
		items: [
			{ command: 'ralph-runner.showIntroduction', label: '$(hubot)  插件介绍', description: '查看 RALPH 的定位、能力边界和适用场景' },
			{ command: 'ralph-runner.showUsageGuide', label: '$(library)  使用流程手册', description: '查看空项目和已存在项目两种起点下的推荐流程' },
			{ command: 'ralph-runner.configurePolicyGates', label: '$(settings-gear)  配置执行检查', description: '通过可视化界面启用或关闭内置检查项和审批提示模式' },
			{ command: 'ralph-runner.initProjectConstraints', label: '$(symbol-key)  初始化项目约束', description: '扫描仓库并生成可编辑和机器可读的项目规则' },
			{ command: 'ralph-runner.refreshSourceContextIndex', label: '$(repo)  刷新源码上下文索引', description: '扫描仓库并更新轻量 source context 索引工件' },
			{ command: 'ralph-runner.previewSourceContextRecall', label: '$(search)  预览故事源上下文', description: '为选中的故事预览最相关的模块、文件和工程线索' },
			{ command: 'ralph-runner.generateAgentMap', label: '$(book)  生成 Agent Map', description: '生成轻量仓库总览页和知识目录页，供智能体导航规则、模块与执行 runbook' },
			{ command: 'ralph-runner.recordDesignContext', label: '$(device-camera-video)  界面设计描述', description: '一个入口处理当前故事和批量复用，支持自动整理、单独匹配和批量匹配' },
			{ command: 'ralph-runner.quickStart', label: '$(zap)  生成 PRD', description: '通过 Copilot 生成 prd.json' },
			{ command: 'ralph-runner.appendUserStories', label: '$(diff-added)  追加用户故事', description: '通过 Copilot 基于现有 prd.json 追加新的用户故事' },
			{ command: 'ralph-runner.start', label: '$(play)  开始执行', description: '开始或继续自动任务循环' },
			{ command: 'ralph-runner.stop', label: '$(debug-stop)  停止执行', description: '取消当前运行' },
			{ command: 'ralph-runner.status', label: '$(info)  查看状态', description: '显示用户故事进度摘要' },
			{ command: 'ralph-runner.reviewStoryApproval', label: '$(pass-filled)  审批高风险故事', description: '对待人工审批的高风险故事执行批准、拒绝或补充说明' },
			{ command: 'ralph-runner.resetStep', label: '$(debug-restart)  重置故事', description: '重置某个已完成的用户故事' },
			{ command: 'ralph-runner.openSettings', label: '$(gear)  打开设置', description: '配置 RALPH Runner 选项' },
		],
	},
	help: {
		introductionTitle: 'RALPH 插件介绍',
		manualTitle: 'RALPH 使用流程手册',
	},
	quickStart: {
		existingPrd: 'RALPH：工作区根目录中已存在 prd.json。',
		start: '开始执行',
		openPrd: '打开 PRD',
		missingPrdPlaceholder: '工作区根目录中未找到 prd.json，你希望如何继续？',
		provideChoice: { label: '$(file-directory) 我已有这个文件，手动提供路径', description: '选择一个已有的 prd.json 文件' },
		generateChoice: { label: '$(sparkle) 我还没有，让 Copilot 帮我生成', description: '描述你的目标，让 Copilot 生成 prd.json' },
		provideDialogTitle: '选择你的 prd.json 文件',
		provideDialogOpenLabel: '选择 prd.json',
		provideCancelled: 'RALPH：已取消，未选择 prd.json。',
		provideSuccess: 'RALPH：prd.json 已准备完成，现在可以执行“RALPH: 开始执行”。',
		goalTitle: 'RALPH 生成 PRD：描述你的目标',
		goalPrompt: '你想完成什么？例如“修复所有 TypeScript 错误”“给所有服务补充单元测试”“从 jQuery 迁移到 React”',
		goalPlaceholder: '请描述你想完成的目标…',
		goalCancelled: 'RALPH：已取消，未提供目标描述。',
		copiedPrompt: 'RALPH：提示词已复制到剪贴板，请粘贴到 Copilot Chat。',
		generationStarted: 'RALPH：Copilot 正在生成 prd.json。生成后出现在工作区根目录时，执行“RALPH: 开始执行”。',
		prompt: {
			workspaceAnalysis: '通读整个代码库并理解现有代码。',
			goalLine: goal => `用户希望实现以下目标：${goal}`,
			workspaceRootLine: workspaceRoot => `工作区根目录：${workspaceRoot}`,
			gitModeLine: (hasGitRepo, autoCommitEnabled) => `Git 仓库检测：${hasGitRepo ? '已检测到' : '未检测到'}；自动 Git 提交设置：${autoCommitEnabled ? '开启' : '关闭'}`,
			generateFileInstruction: '请分析工作区，并在工作区根目录生成一个名为 prd.json 的文件，格式必须符合下面的语法。',
			instructionsHeading: 'INSTRUCTIONS:',
			goalMandatory: '如果用户没有提供目标，请再次要求其提供，目标是必填项。如果目标过于泛化、只是占位文本或不够清晰，也要再次要求补充。',
			logicalSequence: 'json 中的用户故事应按逻辑阶段顺序组织。',
			granularStories: '每个用户故事都要足够细粒度，能够独立执行和验证。',
			numberStories: '用户故事编号从 US-001 开始连续递增。',
			noPassesOrNotes: '不要在用户故事中加入 passes 或 notes 字段，进度会单独跟踪。',
			noSeparateGitStories: '不要为 Git 提交生成单独的用户故事，只生成与实际需求相关的用户故事。',
			storyLevelGitInstruction: '如果已检测到 Git 仓库且自动 Git 提交设置开启，可以假设每个实现类故事在执行阶段自行提交改动；否则不要规划任何专门的 Git 提交故事。',
			importantHeading: 'IMPORTANT:',
			portablePaths: [
				'不要在任何命令或文件路径中使用绝对路径、用户私有路径、本地系统特有目录、命名空间或用户名。',
				'所有文件路径和命令都必须是相对且可移植的，保证任意用户、任意系统都能执行。',
				'避免引用工作区根目录以外的本地文件夹。',
			],
		},
	},
};

const ENGLISH_PACK: RalphLanguagePack = {
	language: 'English',
	projectConstraintsTitle: 'RALPH Project Constraints',
	gitCommitRule: 'When completing a user story and preparing a Git commit, write the commit title and description in English.',
	common: {
		noWorkspaceFolder: 'No workspace folder open.',
		untitledStory: 'Untitled Story',
		noDescription: 'No description.',
		statusPriority: (status, priority) => `[${status}] Priority ${priority}`,
		storyFormat: (storyId, title) => `${storyId} — ${title}`,
	},
	statusBar: {
		idleText: '$(rocket) Ralph Runner',
		idleTooltip: 'RALPH Runner: click to show the command menu',
		runningText: '$(sync~spin) Ralph Runner',
		runningTooltip: 'RALPH Runner: tasks are running, click to open the menu',
		pendingApprovalsText: count => `$(pass-filled) Ralph Runner ${count}`,
		pendingApprovalsTooltip: count => `RALPH Runner: ${count} stories are waiting for approval. Click to open the menu or run "RALPH: Review Approval".`,
	},
	runtime: {
		alreadyRunning: 'RALPH is already running.',
		prdNotFoundRoot: 'prd.json not found in the workspace root.',
		stalledTaskWarning: taskId => `RALPH: Task ${taskId} was left as "inprogress" from a previous interrupted run.`,
		clearAndRetry: 'Clear and Retry',
		cancel: 'Cancel',
		projectConstraintsRequiredBeforeRun: 'RALPH: Project constraints are required before execution. Run "RALPH: Initialize Project Constraints" first.',
		policyBlockedBeforeStory: storyId => `RALPH: Machine policy gates blocked ${storyId} before execution. Review the missing items in the output panel first.`,
		policyBlockedAfterStory: storyId => `RALPH: Machine policy gates blocked completion for ${storyId}. Fix the listed missing artifacts or failing commands first.`,
		allStoriesCompleted: 'RALPH: All user stories completed!',
		pausedAfterLoops: count => `RALPH paused after ${count} steps. Run "RALPH: Start" to resume.`,
		notRunning: 'RALPH is not running.',
		stopped: 'RALPH stopped.',
		designContextRequiredBeforeStory: storyId => `RALPH: UI design notes are required before executing ${storyId}. Run "RALPH: UI Design Notes" first.`,
	},
	status: {
		title: project => `RALPH Status — ${project}`,
		completed: (completed, total) => `Completed: ${completed}/${total}`,
		failed: failed => `Failed: ${failed}`,
		awaitingReview: count => `Awaiting Review: ${count}`,
		awaitingRelease: count => `Awaiting Release: ${count}`,
		highRisk: count => `High Risk: ${count}`,
		pending: pending => `Pending: ${pending}`,
		inProgress: storyId => `In Progress: ${storyId || 'None'}`,
		next: nextLabel => `Next: ${nextLabel}`,
		running: running => `Running: ${running ? 'Yes' : 'No'}`,
		summary: (completed, total, nextId) => `RALPH: ${completed}/${total} stories done. Next: ${nextId || 'Complete!'}`,
		none: 'None',
		allDone: 'All done!',
		yes: 'Yes',
		no: 'No',
	},
	reset: {
		noTrackedStories: 'There are no completed or failed stories to reset.',
		placeholder: 'Select the user story to reset',
		storyReset: storyId => `Story ${storyId} has been reset.`,
	},
	approval: {
		noReviewableStories: 'There are currently no high-risk stories waiting for manual approval.',
		storyPlaceholder: 'Choose a story to review',
		actionPlaceholder: storyId => `Choose the approval action for ${storyId}`,
		approveReviewLabel: 'Approve Review',
		approveReleaseLabel: 'Approve Release',
		rejectLabel: 'Reject Back To Review',
		addNoteLabel: 'Add Approval Note',
		approveReviewDescription: 'Confirm the review outcome and advance to the next approval stage',
		approveReleaseDescription: 'Confirm the story can exit manual approval and be marked complete',
		rejectDescription: 'Send the story back to pending review and record why it was rejected',
		addNoteDescription: 'Record an approval note without changing the current status',
		noteTitle: storyId => `Approval Note — ${storyId}`,
		notePrompt: actionLabel => `Optional: add context for "${actionLabel}". Rejections should explain what blocked approval.`,
		notePlaceholder: 'For example: verified risk controls, need more tests, release behind a flag…',
		rejectNoteRequired: 'A rejection note is required.',
		updated: (storyId, status) => `RALPH: Updated approval for ${storyId}. Current status: ${status}.`,
		openEvidence: 'Open Evidence',
		openFlow: 'Open Approval Flow',
		required: (storyId, status) => `RALPH: ${storyId} is currently ${status} and requires manual approval.`,
		historyHeading: 'Approval history:',
		noHistory: 'No approval history yet.',
		riskLabel: risk => `Risk: ${risk}`,
		approvalLabel: approval => `Approval: ${approval}`,
	},
	policyConfig: {
		title: 'RALPH: Configure Run Checks',
		scopePlaceholder: 'Choose where to save these settings',
		scopeUserLabel: 'Save to User Settings',
		scopeUserDescription: 'Write to global user settings and remove current workspace overrides',
		scopeWorkspaceLabel: 'Save to This Workspace',
		scopeWorkspaceDescription: 'Only apply inside the current workspace',
		enablePlaceholder: 'Choose whether these automatic checks should run',
		enabledLabel: 'Enable Run Checks',
		enabledDescription: 'Run checks before a story starts and before completion is accepted',
		disabledLabel: 'Disable Run Checks',
		disabledDescription: 'Keep the saved rules, but do not run the checks',
		rulesPlaceholder: 'Select which built-in checks should stay enabled',
		rulesHint: 'Unchecked rules are written back as disabled; advanced custom schema edits can still live in settings JSON.',
		approvalModePlaceholder: 'Choose the approval prompt mode that best matches how you currently use chat execution',
		saved: 'RALPH: Run checks and approval prompt mode were updated.',
		openSettings: 'Open Settings',
		ruleLabels: {
			requireProjectConstraints: 'Check project rules before start',
			requireDesignContext: 'Check design notes for UI-sensitive stories',
			protectDangerousPaths: 'Block risky file changes',
			requireRelevantTests: 'Require at least one relevant test command',
			requireTaskMemory: 'Require task memory',
			requireExecutionCheckpoint: 'Require execution checkpoint',
			requireStoryEvidence: 'Require story evidence',
		},
		ruleDescriptions: {
			requireProjectConstraints: 'Use this when a run should not start until project rules are ready',
			requireDesignContext: 'Use this when UI-sensitive work should wait for design notes',
			protectDangerousPaths: 'Avoid edits to prd.json, generated outputs, node_modules, and other protected paths',
			requireRelevantTests: 'When source or config files change, require at least one relevant test command to pass',
			requireTaskMemory: 'Require .ralph/memory/US-xxx.json before completion',
			requireExecutionCheckpoint: 'Require .ralph/checkpoints/US-xxx.checkpoint.json before completion',
			requireStoryEvidence: 'Require .ralph/evidence/US-xxx.evidence.json before completion',
		},
		approvalModes: {
			default: { label: 'default: show an approval notification', description: 'Best for normal interactive work; prompt to open the approval flow or evidence after a high-risk story finishes' },
			bypass: { label: 'bypass: open the approval flow directly', description: 'Skip the intermediate prompt and jump straight into review when approval is needed' },
			autopilot: { label: 'autopilot: persist only and surface via status bar', description: 'Do not rely on popups; keep approval work visible through logs, the status bar, and the command menu' },
		},
	},
	initProjectConstraints: {
		success: 'RALPH: Project constraints initialized.',
		copiedPrompt: 'RALPH: The project-constraints prompt was copied to the clipboard. Paste it into Copilot Chat.',
		openEditableRules: 'Open Editable Rules',
		openGeneratedSummary: 'Open Generated Summary',
		failed: message => `RALPH: Failed to initialize project constraints: ${message}`,
		languageChanged: 'RALPH language changed. Reinitialize project constraints if you want language-dependent rules to refresh.',
		referenceSourcePlaceholder: 'Keep adding existing rules or notes, or choose to finish and continue',
		referenceCollectionProgress: (fileCount, noteCount) => `(${fileCount} files and ${noteCount} notes added)`,
		referenceSourceOptions: {
			files: { label: '$(folder-opened) Provide Existing Rule Files', description: 'Select current standards, README docs, team agreements, or other project-rule files for Copilot to consolidate' },
			notes: { label: '$(note) Add Written Requirements', description: 'Enter any must-include rules, forbidden areas, or delivery expectations for this initialization run' },
			finish: { label: '$(check) Finish Providing Input', description: 'Stop adding input and let Copilot consolidate the repository scan plus everything you supplied' },
		},
		referenceFilesDialogTitle: 'Select existing project-rule or team-standard files',
		referenceFilesOpenLabel: 'Use These Rule Files',
		referenceFileNoteTitle: fileLabel => `File Note — ${fileLabel}`,
		referenceFileNotePrompt: 'Optional: explain why this file matters, which rules must be kept, or which parts should be ignored',
		referenceFileNotePlaceholder: 'Leave empty to skip adding a note for this file',
		additionalNotesTitle: 'Initialize Project Constraints — Additional Notes',
		additionalNotesPrompt: 'Optional: enter must-have rules, forbidden areas, delivery standards, or collaboration expectations',
		started: 'RALPH: Copilot is consolidating project constraints from the repository scan plus your supplied rules.',
	},
	sourceContext: {
		success: filePath => `RALPH: Source context index refreshed at ${filePath}`,
		openIndex: 'Open Index',
		failed: message => `RALPH: Failed to refresh the source context index: ${message}`,
		previewPlaceholder: 'Choose a story to preview relevant repository source context',
		previewTitle: 'Relevant Source Context Preview',
		previewStory: (storyId, title) => `Story: ${storyId} — ${title}`,
		previewScore: score => `Score: ${score}`,
		previewReasons: reasons => `Reasons: ${reasons.join('; ')}`,
		previewValue: value => `Hint: ${value}`,
		previewReady: (storyId, matchCount) => `RALPH: Previewed ${matchCount} relevant source-context matches for ${storyId}.`,
		noMatches: storyId => `RALPH: No strong repository source-context matches were found for ${storyId}. Falling back to the existing prompt flow.`,
	},
	agentMap: {
		success: gapCount => `RALPH: Agent Map generated. The overview and knowledge catalog were written to .ralph/agent-map/ with ${gapCount} explicit knowledge gaps recorded.`,
		openOverview: 'Open Overview',
		openKnowledgeCatalog: 'Open Knowledge Catalog',
		failed: message => `RALPH: Failed to generate Agent Map: ${message}`,
	},
	chatSpec: {
		participantDescription: 'Refine a request with the merged RALPH project constraints, then auto-send the final version to Copilot Chat.',
		commandDescription: 'Polish your request against the current project constraints, then auto-send the ready-to-use final version to Copilot Chat.',
		missingWorkspace: 'RALPH Spec: No workspace folder is open, so project constraints cannot be loaded.',
		missingConstraints: 'RALPH Spec: Project constraints have not been initialized yet. Run "RALPH: Initialize Project Constraints" before using @ralph /ralph-spec.',
		emptyPrompt: 'RALPH Spec: Add the request, task description, or change idea you want revised after @ralph /ralph-spec.',
		thinking: 'RALPH is refining the request against the initialized project constraints and preparing a final version...',
		tempFileSaved: filePath => `RALPH Spec: The final request was written to a temporary file: ${filePath}`,
		tempFileSaveFailed: message => `RALPH Spec: Failed to write the temporary file: ${message}`,
		copiedPrompt: 'RALPH Spec: The final request was copied to the clipboard. Paste it into a new Copilot Chat.',
		autoSent: 'RALPH Spec: The final request was automatically sent to a new Copilot Chat.',
		openedWithClipboardFallback: 'RALPH Spec: Automatic sending fell back to copying the final request and opening Copilot Chat.',
		autoSendSkipped: 'RALPH Spec: No runnable final request could be extracted. Use the code block above directly.',
		error: message => `RALPH Spec: Failed to generate the final constraint-aligned request: ${message}`,
	},
	designContext: {
		noStories: 'No user stories were found. Prepare prd.json first.',
			noExistingDrafts: 'RALPH: No UI design notes exist yet.',
			noReusableDrafts: 'RALPH: There are no reusable UI design notes yet. Create project-, screen-, or module-level notes first.',
			noPendingStories: 'RALPH: There are no unfinished stories available for matching.',
		saved: (storyId, hasWarnings) => hasWarnings ? `RALPH: Saved UI design notes for ${storyId}, but warnings were found.` : `RALPH: Saved UI design notes for ${storyId}.`,
		open: 'Open UI Design Notes',
		selectStoryPlaceholder: 'Select the story that needs UI design notes',
		entryPlaceholder: 'Choose whether to handle this story only or prepare reusable notes for many stories',
		storyActionPlaceholder: 'Choose how to handle this story',
			managementPlaceholder: 'UI design notes already exist. Choose what to do next',
			createFirstPlaceholder: 'No UI design notes exist yet. Create the first one',
		actionPlaceholder: 'Choose how to handle UI design notes',
		sourcePlaceholder: 'Select the main source for the UI design notes',
			deletePlaceholder: 'Choose the UI design notes to delete',
			matchDraftPlaceholder: 'Choose one or more candidate UI design note sets; Copilot will decide which stories are genuinely related',
			matchStoryPlaceholder: 'Top item evaluates all unfinished stories; otherwise multi-select candidate stories and let Copilot decide whether they should inherit the selected notes',
			deleteAction: 'Delete Draft',
			deleteConfirm: label => `Delete ${label}? This cannot be undone automatically.`,
			deleted: label => `RALPH: Deleted ${label}.`,
			matching: {
				copiedPrompt: 'RALPH: The batch design-matching prompt was copied to the clipboard. Paste it into Copilot Chat.',
				started: (storyCount, draftCount) => `RALPH: Copilot is evaluating ${storyCount} candidate unfinished stor${storyCount === 1 ? 'y' : 'ies'} against ${draftCount} UI design note set(s).`,
				failed: message => `RALPH: Failed to batch-match UI design notes: ${message}`,
				missingArtifact: 'RALPH: Copilot completed, but no batch design-matching result file was found.',
				noRelevantMatches: storyCount => `RALPH: Copilot checked ${storyCount} candidate unfinished stor${storyCount === 1 ? 'y' : 'ies'} and did not find any that should inherit the selected UI design notes.`,
				completed: (matchedStoryCount, candidateStoryCount, draftCount) => `RALPH: Copilot linked ${matchedStoryCount} of ${candidateStoryCount} candidate unfinished stor${candidateStoryCount === 1 ? 'y' : 'ies'} to ${draftCount} UI design note set(s); the rest were left unlinked.`,
			},
		noSharedTargets: storyId => `RALPH: ${storyId} does not have reusable UI design notes yet. Create project, screen, or module notes first to make matching easier.`,
		linkTargetPlaceholder: 'Choose which reusable UI design notes should be matched to this story',
		linkSaved: (storyId, count, hasWarnings) => hasWarnings ? `RALPH: Matched ${count} reusable UI design note set(s) to ${storyId}, but warnings were found.` : `RALPH: Matched ${count} reusable UI design note set(s) to ${storyId}.`,
			matchAllPending: {
				label: '$(rocket) Match All Unfinished Stories',
				description: count => `Use the selected draft(s) as candidate resources and let Copilot decide which of the ${count} unfinished stories are truly related`,
			},
			managementActions: {
				create: { label: '$(add) Add Draft', description: 'Create new UI design notes for one story or for later reuse' },
				createFirst: { label: '$(add) Create Draft', description: 'Create the first UI design notes in this workspace' },
				delete: { label: '$(trash) Delete Draft', description: 'Delete an existing UI design note file' },
				match: { label: '$(link) Match Drafts To Stories', description: 'Choose candidate drafts and stories, then let Copilot decide which stories should inherit those resources' },
			},
		entryModes: {
			single: { label: '$(symbol-field) Match One Story', description: 'Prepare notes for the current story and optionally reuse project, screen, or module notes' },
			batch: { label: '$(layers) Prepare Reusable Notes', description: 'Create one reusable set of UI design notes that multiple stories can share' },
		},
		storyActions: {
			review: { label: '$(eye) Auto Prepare Story Notes', description: 'Quickly generate story notes from what already exists' },
			visualDraft: { label: '$(device-camera-video) Import Story Visuals', description: 'Use Figma or screenshots to generate story-specific UI design notes' },
		},
		actions: {
			review: { label: '$(eye) Prepare Story Notes', description: 'Quickly prepare UI design notes for the current story' },
			linkShared: { label: '$(link) Match Reusable Notes', description: 'Match existing project, screen, or module UI notes to the current story' },
			advanced: { label: '$(edit) Add Details', description: hasExistingStoryContext => hasExistingStoryContext ? 'Add more detail to the current story UI notes' : 'Add a new set of current-story UI notes' },
		},
			draft: {
				scopePlaceholder: 'Choose where the reusable UI design notes should be saved',
				inputModePlaceholder: 'Choose which visual references to import',
				noVisualSources: 'RALPH: Provide at least one Figma URL or screenshot to generate UI design notes.',
				copiedPrompt: 'RALPH: The UI design notes prompt was copied to the clipboard. Paste it into Copilot Chat.',
				started: label => `RALPH: Copilot is generating UI design notes for ${label}.`,
				saved: (label, hasWarnings) => hasWarnings ? `RALPH: Saved UI design notes for ${label}, but warnings were found.` : `RALPH: Saved UI design notes for ${label}.`,
				failed: message => `RALPH: Failed to generate UI design notes: ${message}`,
				missingArtifact: label => `RALPH: Copilot completed, but no UI design note file was found for ${label}.`,
				screenIdTitle: 'UI Design Notes — Screen Identifier',
				screenIdPrompt: 'Enter the page or screen identifier for these reusable notes',
				moduleIdTitle: 'UI Design Notes — Module Identifier',
				moduleIdPrompt: 'Enter the module identifier for these reusable notes',
				figmaUrlTitle: 'UI Design Notes — Figma URL',
				figmaUrlPrompt: 'Paste the Figma URL you want to use',
				screenshotDialogTitle: 'Select screenshot files to use',
				screenshotOpenLabel: 'Use Screenshots',
				additionalInstructionsTitle: 'UI Design Notes — Additional Instructions',
				additionalInstructionsPrompt: 'Optional: tell the model what matters most and what must not drift',
				scopeOptions: {
					story: { label: '$(symbol-field) Current Story', description: 'Generate UI design notes for this story only' },
					screen: { label: '$(browser) Screen', description: 'Generate reusable screen-level UI design notes' },
					module: { label: '$(symbol-module) Module', description: 'Generate reusable module-level UI design notes' },
					project: { label: '$(layers) Project', description: 'Generate UI design notes shared across the whole project' },
				},
				inputModes: {
					figma: { label: '$(figma) Figma Only', description: 'Generate UI design notes from Figma only' },
					screenshots: { label: '$(device-camera) Screenshots Only', description: 'Generate UI design notes from screenshots only' },
					both: { label: '$(combine) Figma + Screenshots', description: 'Generate UI design notes from both Figma and screenshots' },
				},
			},
			suggestion: {
				noSharedContext: storyId => `RALPH: ${storyId} does not inherit any reusable UI design notes yet, so story-only notes cannot be suggested. Create project, screen, or module notes first.`,
				copiedPrompt: 'RALPH: The current-story UI design notes prompt was copied to the clipboard. Paste it into Copilot Chat.',
				started: storyId => `RALPH: Copilot is generating current-story UI design notes for ${storyId}.`,
				saved: (storyId, hasWarnings) => hasWarnings ? `RALPH: Saved current-story UI design notes for ${storyId}, but warnings were found.` : `RALPH: Saved current-story UI design notes for ${storyId}.`,
				failed: message => `RALPH: Failed to generate current-story UI design notes: ${message}`,
				missingArtifact: storyId => `RALPH: Copilot completed, but no UI design note file was found for ${storyId}.`,
				additionalInstructionsTitle: 'Current-Story UI Design Notes — Additional Instructions',
				additionalInstructionsPrompt: 'Optional: tell the model which story-only differences or priorities to focus on',
			},
		sources: {
			figma: { label: '$(figma) Figma Link', description: 'Record the Figma link and supporting notes' },
			screenshots: { label: '$(device-camera) Screenshots', description: 'Record local screenshot paths and supporting notes' },
			notes: { label: '$(note) Written Notes', description: 'Record the UI design notes in plain text only' },
		},
		input: {
			figmaUrlTitle: 'UI Design Notes — Figma URL',
			figmaUrlPrompt: 'Paste the Figma link for this story',
			screenshotDialogTitle: 'Select screenshot files for this story',
			screenshotOpenLabel: 'Use Screenshots',
			summaryTitle: 'UI Design Notes — Summary',
			summaryPrompt: 'Summarize the design intent for this story',
			screenNameTitle: 'UI Design Notes — Screen Name',
			screenNamePrompt: 'Optional page or screen name',
			manualNotesTitle: 'UI Design Notes — Written Notes',
			manualNotesPrompt: 'Optional notes separated by commas or new lines',
			referenceDocsTitle: 'UI Design Notes — Reference Docs',
			referenceDocsPrompt: 'Optional relative document paths or URLs',
			layoutConstraintsTitle: 'UI Design Notes — Layout Constraints',
			layoutConstraintsPrompt: 'List key layout constraints for this story',
			componentReuseTitle: 'UI Design Notes — Component Reuse',
			componentReusePrompt: 'List components that should be reused',
			tokenRulesTitle: 'UI Design Notes — Token Rules',
			tokenRulesPrompt: 'List color, spacing, or typography token rules',
			responsiveRulesTitle: 'UI Design Notes — Responsive Rules',
			responsiveRulesPrompt: 'List responsive behavior requirements',
			doNotChangeTitle: 'UI Design Notes — Do Not Change',
			doNotChangePrompt: 'List areas that must stay untouched',
			acceptanceChecksTitle: 'UI Design Notes — Acceptance Checks',
			acceptanceChecksPrompt: 'List visual acceptance checks for implementation',
		},
	},
	taskMemoryRecall: {
		noRelatedTaskMemories: storyId => `RALPH: No related task memories found for ${storyId}.`,
		chooseStoryPlaceholder: 'Choose a story for task-memory recall',
		nextPendingStoryLabel: 'Next Pending Story',
		nextPendingStoryDescription: (storyId, title) => `${storyId} — ${title}`,
		chooseStoryLabel: 'Choose Story',
		chooseStoryDescription: 'Choose any user story to preview related task memories',
		previewPlaceholder: 'Choose a story to preview related task memories',
		previewTitle: 'Related Task Memory Preview',
		previewStory: (storyId, title) => `Story: ${storyId} — ${title}`,
		previewScore: score => `Score: ${score}`,
		previewReasons: reasons => `Reasons: ${reasons.join('; ')}`,
		previewSummary: summary => `Summary: ${summary}`,
		previewKeyDecisions: 'Key Decisions:',
		previewChangedFiles: 'Changed Files:',
	},
	appendStories: {
		missingPrd: 'prd.json not found. Run Generate PRD first.',
		requestTitle: 'RALPH Append User Stories: describe the new scope',
		requestPrompt: 'Describe the requirements or scope you want to add to the current prd.json.',
		requestPlaceholder: 'For example: add user stories for an admin audit log workflow…',
		requestCancelled: 'RALPH: Cancelled because no additional scope was provided.',
		copiedPrompt: 'RALPH: The append-story prompt was copied to the clipboard. Paste it into Copilot Chat.',
		started: 'RALPH: Copilot is updating prd.json with additional user stories.',
		prompt: {
			workspaceAnalysis: 'Read the current workspace, especially prd.json in the workspace root, and understand the existing project goal and user stories.',
			requestLine: request => `The user wants to append the following scope to the existing PRD: ${request}`,
			workspaceRootLine: workspaceRoot => `Workspace root: ${workspaceRoot}`,
			currentProjectLine: project => `Current project: ${project}`,
			currentBranchLine: branchName => `Current suggested branch: ${branchName}`,
			currentStoryCountLine: count => `Current user story count: ${count}`,
			gitModeLine: (hasGitRepo, autoCommitEnabled) => `Git repository detected: ${hasGitRepo ? 'yes' : 'no'}; automatic Git commit setting: ${autoCommitEnabled ? 'enabled' : 'disabled'}`,
			readCurrentPrd: 'Read and modify the existing prd.json directly instead of creating another PRD file.',
			nextStoryLine: (nextStoryId, nextPriority) => `New story ids should start from ${nextStoryId} and priorities should start from ${nextPriority}.`,
			existingStoriesHeading: 'Existing user story summary:',
			noExistingStories: '- There are currently no user stories.',
			instructionsHeading: 'INSTRUCTIONS:',
			appendOnlyInstruction: 'Append new user stories only. Do not delete or rewrite existing stories unless that is required to keep the JSON valid or avoid an obvious duplicate.',
			preserveExisting: 'Preserve the meaning of the current project, branchName, description, and existing user stories.',
			numberStories: 'New user story ids must be sequential and begin with the provided next id.',
			sequentialPriority: 'New user story priorities must be sequential and come after the existing stories.',
			noPassesOrNotes: 'Do not include passes or notes fields in the user stories. Progress is tracked separately.',
			noSeparateGitStories: 'Do not add standalone Git commit user stories. Keep the plan focused on requirement-related user stories only.',
			storyLevelGitInstruction: 'If a Git repository is detected and automatic Git commit is enabled, assume implementation stories may commit their own changes during execution. Otherwise, do not plan dedicated Git commit stories.',
			directWriteInstruction: 'Directly update the prd.json file in the workspace root instead of only showing suggested content.',
		},
	},
	menu: {
		placeholder: 'RALPH Runner: choose a command',
		items: [
			{ command: 'ralph-runner.showIntroduction', label: '$(hubot)  Introduction', description: 'Read what RALPH does, where it fits, and what the menu is for' },
			{ command: 'ralph-runner.showUsageGuide', label: '$(library)  Usage Guide', description: 'Read the recommended flow for empty projects and existing repositories' },
			{ command: 'ralph-runner.configurePolicyGates', label: '$(settings-gear)  Configure Run Checks', description: 'Use a visual flow to enable built-in checks and choose the approval prompt mode' },
			{ command: 'ralph-runner.initProjectConstraints', label: '$(symbol-key)  Initialize Project Constraints', description: 'Scan the repository and generate editable and machine-readable project rules' },
			{ command: 'ralph-runner.refreshSourceContextIndex', label: '$(repo)  Refresh Source Context Index', description: 'Scan the repository and update the lightweight source-context index artifact' },
			{ command: 'ralph-runner.previewSourceContextRecall', label: '$(search)  Preview Story Source Context', description: 'Preview the most relevant modules, files, and engineering hints for a selected story' },
			{ command: 'ralph-runner.generateAgentMap', label: '$(book)  Generate Agent Map', description: 'Generate a lightweight repository overview and knowledge catalog for agent navigation' },
			{ command: 'ralph-runner.recordDesignContext', label: '$(device-camera-video)  UI Design Notes', description: 'One entry for story-only work and reusable batch matching, with simpler plain-language prompts' },
			{ command: 'ralph-runner.quickStart', label: '$(zap)  Generate PRD', description: 'Use Copilot to generate prd.json' },
			{ command: 'ralph-runner.appendUserStories', label: '$(diff-added)  Append User Stories', description: 'Use Copilot to append new user stories to the existing prd.json' },
			{ command: 'ralph-runner.start', label: '$(play)  Start', description: 'Start or resume the automated task loop' },
			{ command: 'ralph-runner.stop', label: '$(debug-stop)  Stop', description: 'Cancel the current run' },
			{ command: 'ralph-runner.status', label: '$(info)  Show Status', description: 'Show a summary of user story progress' },
			{ command: 'ralph-runner.reviewStoryApproval', label: '$(pass-filled)  Review Approval', description: 'Approve, reject, or annotate high-risk stories waiting for manual review' },
			{ command: 'ralph-runner.resetStep', label: '$(debug-restart)  Reset Story', description: 'Reset a completed or failed user story' },
			{ command: 'ralph-runner.openSettings', label: '$(gear)  Open Settings', description: 'Configure Ralph Runner options' },
		],
	},
	help: {
		introductionTitle: 'RALPH Introduction',
		manualTitle: 'RALPH Usage Guide',
	},
	quickStart: {
		existingPrd: 'RALPH: prd.json already exists in the workspace root.',
		start: 'Start',
		openPrd: 'Open PRD',
		missingPrdPlaceholder: 'prd.json was not found in the workspace root. How do you want to continue?',
		provideChoice: { label: '$(file-directory) I already have this file', description: 'Select an existing prd.json file' },
		generateChoice: { label: '$(sparkle) I do not have one, let Copilot generate it', description: 'Describe your goal and let Copilot generate prd.json' },
		provideDialogTitle: 'Select your prd.json file',
		provideDialogOpenLabel: 'Use prd.json',
		provideCancelled: 'RALPH: Cancelled because no prd.json file was selected.',
		provideSuccess: 'RALPH: prd.json is ready. You can now run "RALPH: Start".',
		goalTitle: 'RALPH Generate PRD: describe your goal',
		goalPrompt: 'What do you want to accomplish? For example: "Fix all TypeScript errors", "Add unit tests to all services", or "Migrate from jQuery to React"',
		goalPlaceholder: 'Describe the goal you want to accomplish…',
		goalCancelled: 'RALPH: Cancelled because no goal description was provided.',
		copiedPrompt: 'RALPH: The prompt was copied to the clipboard. Paste it into Copilot Chat.',
		generationStarted: 'RALPH: Copilot is generating prd.json. Once it appears in the workspace root, run "RALPH: Start".',
		prompt: {
			workspaceAnalysis: 'Go through the entire codebase and understand the existing code.',
			goalLine: goal => `The user wants to accomplish the following goal: ${goal}`,
			workspaceRootLine: workspaceRoot => `Workspace root: ${workspaceRoot}`,
			gitModeLine: (hasGitRepo, autoCommitEnabled) => `Git repository detected: ${hasGitRepo ? 'yes' : 'no'}; automatic Git commit setting: ${autoCommitEnabled ? 'enabled' : 'disabled'}`,
			generateFileInstruction: 'Please analyze the workspace and generate one file in the workspace root called prd.json following the syntax below.',
			instructionsHeading: 'INSTRUCTIONS:',
			goalMandatory: 'If the user forgot to provide a goal, ask again. A goal is mandatory. If the goal is generic, placeholder text, or not clear enough, ask again.',
			logicalSequence: 'The JSON should contain a logical sequence of user stories organized into phases.',
			granularStories: 'Each user story should be granular enough to be independently executable and verifiable.',
			numberStories: 'Number user stories sequentially starting from "US-001".',
			noPassesOrNotes: 'Do not include passes or notes fields in the user stories. Progress is tracked separately.',
			noSeparateGitStories: 'Do not generate standalone Git commit user stories. Generate only user stories that are directly related to the product or engineering requirements.',
			storyLevelGitInstruction: 'If a Git repository is detected and automatic Git commit is enabled, assume implementation stories may commit their own changes during execution. Otherwise, do not plan any dedicated Git commit stories.',
			importantHeading: 'IMPORTANT:',
			portablePaths: [
				'Do not use any absolute, user-specific, or local system-specific paths, directories, namespaces, or usernames in any command or file path.',
				'All file paths and commands must be relative and portable so the plan works for any user on any system.',
				'Avoid referencing local folders outside the workspace root.',
			],
		},
	},
};

const LANGUAGE_PACKS: Record<SupportedRalphLanguage, RalphLanguagePack> = {
	Chinese: CHINESE_PACK,
	English: ENGLISH_PACK,
};

export function normalizeRalphLanguage(value: string | undefined): SupportedRalphLanguage {
	return value === 'English' ? 'English' : 'Chinese';
}

export function getRalphLanguagePack(value: string | undefined): RalphLanguagePack {
	return LANGUAGE_PACKS[normalizeRalphLanguage(value)];
}

export function getLocalizedStoryStatus(status: StoryExecutionStatus | 'none', language: string | undefined): string {
	const normalizedLanguage = normalizeRalphLanguage(language);
	if (normalizedLanguage === 'English') {
		switch (status) {
			case '未开始':
				return 'Not Started';
			case 'inprogress':
				return 'In Progress';
				case 'pendingReview':
					return 'Pending Review';
				case 'pendingRelease':
					return 'Pending Release';
			case 'completed':
				return 'Completed';
			case 'failed':
				return 'Failed';
			default:
				return 'None';
		}
	}

	if (status === 'none') {
		return '无';
	}
	if (status === 'pendingReview') {
		return '待评审';
	}
	if (status === 'pendingRelease') {
		return '待发布';
	}
	return status;
}