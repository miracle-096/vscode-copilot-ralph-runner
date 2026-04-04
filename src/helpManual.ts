import { SupportedHarnessLanguage } from './localization';

export type HarnessHelpDocumentKind = 'introduction' | 'manual';

export interface HarnessHelpDocument {
	title: string;
	html: string;
}

interface HarnessHelpSection {
	title: string;
	paragraphs: string[];
	bullets?: string[];
	steps?: string[];
}

interface HarnessHelpContent {
	title: string;
	summary: string;
	sections: HarnessHelpSection[];
}

export function buildHarnessHelpDocument(language: SupportedHarnessLanguage, kind: HarnessHelpDocumentKind): HarnessHelpDocument {
	const content = getHarnessHelpContent(language, kind);
	return {
		title: content.title,
		html: renderHelpHtml(content),
	};
}

export function getHarnessHelpContent(language: SupportedHarnessLanguage, kind: HarnessHelpDocumentKind): HarnessHelpContent {
	return language === 'English'
		? getEnglishHelpContent(kind)
		: getChineseHelpContent(kind);
}

function getChineseHelpContent(kind: HarnessHelpDocumentKind): HarnessHelpContent {
	if (kind === 'introduction') {
		return {
			title: 'Harness 插件介绍',
			summary: 'Harness Runner 会围绕 prd.json 中的用户故事组织执行循环，把项目约束、设计上下文、任务记忆、源码线索和证据工件一起注入到 Copilot 的执行链中。',
			sections: [
				{
					title: 'Harness 是什么',
					paragraphs: [
						'Harness Runner 不是单纯的命令集合，而是一套把用户故事拆分、执行、检查、证据沉淀和后续 handoff 串起来的 VS Code 扩展工作流。',
						'它的目标是让 Copilot 在多轮执行里仍然保留工程上下文，而不是每次都从零开始猜测仓库规则。'
					],
					bullets: [
						'以 prd.json 为故事入口，按优先级推进执行',
						'自动注入项目约束、设计上下文、任务记忆、源码上下文和最近检查点',
						'在完成前要求 task memory、checkpoint、evidence 等可审计工件',
						'支持 Reviewer pass、风险分级、审批流和结构化 run log'
					]
				},
				{
					title: '适合什么场景',
					paragraphs: [
						'适合已经在使用 GitHub Copilot Chat，希望把需求拆成用户故事并持续推进的项目。',
						'尤其适合需要保留上下文、需要多人接力、或需要严格沉淀执行证据的工程型仓库。'
					],
					bullets: [
						'从空项目开始搭建 PRD 和执行计划',
						'在已有项目中渐进引入项目约束、设计上下文和执行门禁',
						'对高风险改动保留审计痕迹、回滚线索和审批记录'
					]
				},
				{
					title: 'Harness 菜单里有什么',
					paragraphs: [
						'Harness 状态栏按钮和快捷键 Alt+R 都会打开命令菜单。菜单覆盖从生成 PRD、追加故事，到初始化项目约束、刷新源码上下文、录入设计描述、开始执行、审批和查看状态的一整条链路。'
					],
					steps: [
						'生成 PRD 或追加用户故事',
						'初始化项目约束、刷新源码上下文、按需生成 Agent Map',
						'对 UI 敏感故事补充设计描述',
						'开始执行，后续通过状态、审批和重置命令继续管理'
					]
				}
			]
		};
	}

	return {
		title: 'Harness 使用流程手册',
		summary: '下面按空项目和已存在项目两种起点说明推荐流程，帮助你决定先用哪些命令、哪些工件必须先准备、哪些步骤可以按需逐步引入。',
		sections: [
			{
				title: '空项目流程',
				paragraphs: [
					'如果当前工作区还没有 prd.json，建议先把 Harness 当作“计划和执行编排器”来使用。先让 Copilot 帮你生成 PRD，再逐步补足约束和上下文。'
				],
				steps: [
					'打开 Harness 菜单，先执行“生成 PRD”，描述项目目标或想完成的里程碑。',
					'确认 prd.json 生成后，如有需要执行“追加用户故事”，继续细化下一批故事。',
					'执行“初始化项目约束”，让 Harness 扫描脚本、目录、README 和配置文件，产出基础规则。',
					'执行“刷新源码上下文索引”，为后续故事提供入口文件、模块提示和热点路径。',
					'如果项目偏界面驱动，再执行“界面设计描述”，补充设计稿、截图、布局约束或复用目标。',
					'最后执行“开始执行”，让 Harness 按 PRD 的优先级逐个推进故事。'
				],
				bullets: [
					'最小起步只需要工作区和 prd.json',
					'项目约束、源码上下文和设计上下文可以逐步补，不必一次到位',
					'开始执行后要关注 .harness-runner 下的 memory、checkpoints、evidence 和 run-logs'
				]
			},
			{
				title: '已存在项目流程',
				paragraphs: [
					'如果仓库已经存在并且有真实代码、脚本和文档，推荐先把仓库规则和已有知识显式化，再开始执行故事。这样 Copilot 的实现会更稳定。'
				],
				steps: [
					'先确认工作区根目录已有或准备好 prd.json，必要时使用“追加用户故事”把当前需求并入现有 PRD。',
					'优先执行“初始化项目约束”，把已有脚本、目录规范、Git 规则和交付要求收进 Harness。',
					'执行“刷新源码上下文索引”，必要时再执行“生成 Agent Map”，让模块、规则入口和知识缺口可被后续故事引用。',
					'如果部分故事有 UI 或交互变化，再为这些故事执行“界面设计描述”。',
					'检查配置执行检查、审批模式和 Reviewer 评分设置是否符合团队要求，然后再执行“开始执行”。',
					'执行过程中结合“查看状态”“审批高风险故事”“重置故事”管理进度和风险。'
				],
				bullets: [
					'已有项目更适合先补项目约束与上下文，而不是直接开跑',
					'如果仓库改动面大，建议先让 Agent Map 和知识检查把规则入口暴露出来',
					'完成后的核心事实来源在 .harness-runner/story-status.json、memory、checkpoint 和 evidence'
				]
			},
			{
				title: '日常使用建议',
				paragraphs: [
					'Harness 最适合被当作“持续执行和治理层”。你可以把需求和故事管理交给 prd.json，把仓库规则和设计约束交给对应工件，把每次执行的结果沉淀到 .harness-runner 目录。'
				],
				bullets: [
					'每次新增大需求时先更新 PRD，而不是直接跳过故事层',
					'有设计要求的故事尽量先补设计描述，避免执行时偏航',
					'执行失败或结果不理想时，优先查看 checkpoint、evidence 和 run log 再决定是否重置',
					'高风险故事建议结合审批流和 release/rollback 线索一起使用'
				]
			}
		]
	};
}

function getEnglishHelpContent(kind: HarnessHelpDocumentKind): HarnessHelpContent {
	if (kind === 'introduction') {
		return {
			title: 'Harness Introduction',
			summary: 'Harness Runner organizes execution around prd.json user stories and keeps Copilot grounded with project constraints, design notes, task memory, source context, checkpoints, and evidence artifacts.',
			sections: [
				{
					title: 'What Harness Is',
					paragraphs: [
						'Harness Runner is a VS Code workflow layer that connects story planning, execution, review, evidence, and handoff instead of acting as a loose command list.',
						'Its main purpose is to keep Copilot aligned with repository-specific rules and prior decisions across multiple story executions.'
					],
					bullets: [
						'Uses prd.json as the story entry point',
						'Injects project constraints, design context, task memory, source context, and checkpoints into prompts',
						'Requires auditable task memory, checkpoint, and evidence artifacts before completion',
						'Supports reviewer passes, risk classification, approvals, and structured run logs'
					]
				},
				{
					title: 'Where It Fits',
					paragraphs: [
						'Harness is useful when you already work with GitHub Copilot Chat and want a repeatable story-driven execution loop inside a real repository.',
						'It is especially helpful when the work needs traceability, multiple handoffs, or stronger governance than one-off prompts.'
					]
				},
				{
					title: 'What You Get In The Menu',
					paragraphs: [
						'The status bar button and Alt+R open the Harness menu. From there you can generate or append PRD stories, initialize project constraints, refresh source context, manage design notes, start execution, review approvals, and inspect status.'
					]
				}
			]
		};
	}

	return {
		title: 'Harness Usage Guide',
		summary: 'This guide splits the recommended workflow into two starting points: a new empty project and an existing repository that already has code, scripts, and working conventions.',
		sections: [
			{
				title: 'Empty Project Workflow',
				paragraphs: [
					'When the workspace does not have prd.json yet, treat Harness as your planning and execution orchestrator. Start with story generation, then gradually add context and constraints.'
				],
				steps: [
					'Open the Harness menu and run Generate PRD.',
					'After prd.json exists, use Append User Stories whenever you need to expand the plan.',
					'Run Initialize Project Constraints to collect scripts, folders, README signals, and configuration rules.',
					'Run Refresh Source Context Index so later stories can reuse entry files, module hints, and hotspot paths.',
					'If UI work is involved, add UI Design Notes before execution.',
					'Run Start to let Harness execute the story queue in priority order.'
				]
			},
			{
				title: 'Existing Project Workflow',
				paragraphs: [
					'For an existing repository, first surface the repository rules and existing knowledge so Copilot does not improvise around unknown conventions.'
				],
				steps: [
					'Confirm prd.json exists or append the current requirement into the existing PRD.',
					'Initialize Project Constraints before large execution passes.',
					'Refresh Source Context Index and, when useful, Generate Agent Map for module and rule discovery.',
					'Add UI Design Notes only for stories that truly need design-sensitive guidance.',
					'Configure run checks, approval mode, and Reviewer scoring settings if your team wants stronger governance before execution.',
					'Use Start, Show Status, Review Approval, and Reset Story as the operational loop.'
				]
			},
			{
				title: 'Daily Operating Advice',
				paragraphs: [
					'Treat Harness as the execution and governance layer on top of your repository. Keep the PRD current, keep context artifacts fresh, and use the .harness-runner artifacts as the main audit trail.'
				]
			}
		]
	};
}

function renderHelpHtml(content: HarnessHelpContent): string {
	const sectionHtml = content.sections.map(section => `
		<section class="card">
			<h2>${escapeHtml(section.title)}</h2>
			${section.paragraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('')}
			${renderList(section.bullets, 'ul')}
			${renderList(section.steps, 'ol')}
		</section>
	`).join('');

	return `<!DOCTYPE html>
	<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>${escapeHtml(content.title)}</title>
		<style>
			:root {
				color-scheme: light dark;
				--bg: var(--vscode-editor-background);
				--fg: var(--vscode-editor-foreground);
				--muted: var(--vscode-descriptionForeground);
				--card: color-mix(in srgb, var(--bg) 88%, #2b6cb0 12%);
				--border: color-mix(in srgb, var(--fg) 18%, transparent);
				--accent: #2b6cb0;
			}
			body {
				margin: 0;
				font-family: var(--vscode-font-family);
				background: radial-gradient(circle at top right, color-mix(in srgb, var(--accent) 18%, transparent), transparent 34%), var(--bg);
				color: var(--fg);
			}
			main {
				max-width: 960px;
				margin: 0 auto;
				padding: 28px 24px 40px;
			}
			header {
				margin-bottom: 20px;
				padding: 22px 24px;
				border: 1px solid var(--border);
				border-radius: 18px;
				background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 15%, var(--bg)), color-mix(in srgb, var(--bg) 94%, white 6%));
			}
			h1 {
				margin: 0 0 10px;
				font-size: 28px;
			}
			.subtitle {
				margin: 0;
				color: var(--muted);
				line-height: 1.6;
			}
			.grid {
				display: grid;
				gap: 16px;
			}
			.card {
				padding: 20px 22px;
				border-radius: 16px;
				border: 1px solid var(--border);
				background: var(--card);
				box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
			}
			h2 {
				margin: 0 0 12px;
				font-size: 20px;
			}
			p, li {
				line-height: 1.7;
			}
			ul, ol {
				margin: 14px 0 0;
				padding-left: 22px;
			}
			@media (max-width: 640px) {
				main {
					padding: 18px 14px 28px;
				}
				header,
				.card {
					padding: 16px;
				}
				h1 {
					font-size: 24px;
				}
			}
		</style>
	</head>
	<body>
		<main>
			<header>
				<h1>${escapeHtml(content.title)}</h1>
				<p class="subtitle">${escapeHtml(content.summary)}</p>
			</header>
			<div class="grid">${sectionHtml}</div>
		</main>
	</body>
	</html>`;
}

function renderList(values: string[] | undefined, kind: 'ul' | 'ol'): string {
	if (!values || values.length === 0) {
		return '';
	}

	return `<${kind}>${values.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</${kind}>`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}