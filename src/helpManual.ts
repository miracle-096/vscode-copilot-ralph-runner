import { SupportedHarnessLanguage } from './localization';

export interface HarnessGuideDocument {
	title: string;
	html: string;
}

export interface HarnessGuideSection {
	title: string;
	paragraphs: string[];
	bullets?: string[];
	steps?: string[];
}

export interface HarnessGuideChapter {
	id: string;
	title: string;
	summary: string;
	sections: HarnessGuideSection[];
}

export interface HarnessGuideContent {
	title: string;
	summary: string;
	chapters: HarnessGuideChapter[];
}

export function buildHarnessGuideDocument(language: SupportedHarnessLanguage): HarnessGuideDocument {
	const content = getHarnessGuideContent(language);
	return {
		title: content.title,
		html: renderGuideHtml(content),
	};
}

export function getHarnessGuideContent(language: SupportedHarnessLanguage): HarnessGuideContent {
	return language === 'English'
		? getEnglishGuideContent()
		: getChineseGuideContent();
}

function getChineseGuideContent(): HarnessGuideContent {
	return {
		title: 'Harness-runner 指南',
		summary: '这个统一指南把插件介绍、推荐使用流程和 harness-engineering 中的定义、失败模式与工程实践收敛到同一份章节化体验里。',
		chapters: [
			{
				id: 'overview',
				title: '理解 Harness Runner',
				summary: '先明确 Harness Runner 做什么、适合什么工程环境，再决定是否进入执行循环。',
				sections: [
					{
						title: 'Harness 是什么',
						paragraphs: [
							'Harness Runner 不是零散命令的集合，而是一套围绕 prd.json 用户故事组织执行、检查、证据沉淀和 handoff 的 VS Code 扩展工作流。',
							'从 harness-engineering 的视角看，它不是去增强模型本身，而是去设计模型运行的环境，让 Copilot 在多轮执行里持续继承仓库规则、交付边界和最近决策。'
						],
						bullets: [
							'核心哲学是“人类掌舵，智能体执行”，由人定义目标、约束和验收，Harness 负责把这些约束稳定送到执行现场',
							'以 prd.json 为故事入口，按 priority 顺序推进执行',
							'自动注入项目约束、设计上下文、任务记忆、源码上下文和最近检查点',
							'在完成前要求 task memory、checkpoint、evidence 等可审计工件',
							'支持 Reviewer pass、审批流、风险分级和结构化 run log'
						]
					},
					{
						title: '适合什么场景',
						paragraphs: [
							'适合已经在使用 GitHub Copilot Chat，并且希望把需求拆成用户故事持续推进的项目。',
							'尤其适合需要保留上下文、多人接力、严格审计或显式回滚线索的工程型仓库。'
						],
						bullets: [
							'从空项目开始搭建 PRD 和执行计划',
							'在已有项目中渐进引入项目约束、设计上下文和执行门禁',
							'对高风险改动保留审批记录、证据和 rollback 线索'
						]
					}
				]
			},
			{
				id: 'harness-engineering',
				title: 'Harness 的工程化含义',
				summary: '把“为什么需要 harness”说清楚：它是约束、反馈、状态移交和持续改进的工程层。',
				sections: [
					{
						title: 'Harness Engineering 在解决什么',
						paragraphs: [
							'harness-engineering 关注的不是让模型单次回答更花哨，而是让智能体在长时间、多轮次、可交接的任务里稳定工作。',
							'它把约束机制、反馈回路、工作流控制和持续改进循环放在模型外侧，避免每次遇到相同错误都靠人重复提醒。'
						],
						bullets: [
							'优化对象是运行环境，而不是基础模型本身',
							'发现一个常见错误后，应把修复沉淀成规则、工件或检查，而不是期待下次聊天自动记住',
							'复杂任务要靠分块推进、显式 handoff 和外置状态，而不是把所有工作塞进一个会话'
						]
					},
					{
						title: '长任务为什么容易失控',
						paragraphs: [
							'长周期开发里，智能体常见的失败模式包括：试图一次做完所有事情、在上下文膨胀后失去连贯性、过早宣布完成，以及只看局部结果不做真实验证。',
							'Harness Runner 通过把状态写回 .harness-runner，并把最近检查点、任务记忆和证据包重新注入下一轮执行，降低这种“上下文断裂”带来的漂移。'
						],
						bullets: [
							'检查点和任务记忆承担结构化 handoff，而不是依赖聊天窗口残留历史',
							'证据包和 run log 让“是否完成”回到可验证事实，而不是智能体自评',
							'失败后优先沿着 artifacts 恢复，而不是重开会话后重新猜测现场'
						]
					},
					{
						title: '四类护栏如何映射到插件能力',
						paragraphs: [
							'harness-engineering 常把护栏归纳为上下文工程、架构与流程约束、反馈循环，以及熵管理。Harness Runner 的现有能力正好对应这四类控制点。'
						],
						bullets: [
							'上下文工程：项目约束、设计上下文、源码上下文、Agent Map 和最近检查点按需注入，而不是把巨量说明一次塞给模型',
							'架构与流程约束：policy gates、审批模式、Reviewer loop 和项目约束把“什么不能做、什么时候必须停”显式化',
							'反馈循环：相关测试、Reviewer pass、审批记录和知识检查帮助智能体面对外部评价，而不是只相信自评',
							'熵管理：memory、evidence、run-logs、Agent Map 与可回放工件一起承担长期维护、知识更新和回滚切口提示'
						]
					}
				]
			},
			{
				id: 'menu-and-artifacts',
				title: '菜单与核心工件',
				summary: '统一理解一级菜单分工，以及 .harness-runner 下哪些工件是执行闭环的事实来源。',
				sections: [
					{
						title: '一级菜单怎么分工',
						paragraphs: [
							'Harness 状态栏按钮和快捷键 Alt+R 都会打开主菜单。当前一级菜单按规划与入门、Harness 约束设置、执行与审批和设置分组，设置相关动作统一收纳到 settings 子菜单中。'
						],
						bullets: [
							'规划与入门：生成 PRD、追加用户故事',
							'Harness 约束设置：执行检查、项目约束、设计描述、故事上下文、源码上下文和 Agent Map',
							'执行与审批：开始、停止、状态、审批、重置和失败故事重跑',
							'设置：打开 VS Code 设置和自定义一级菜单排序'
						]
					},
					{
						title: '哪些工件最关键',
						paragraphs: [
							'真正的执行事实保存在 .harness-runner 目录，而不是零散停留在聊天上下文里。排查问题、做 handoff 或准备 reviewer pass 时，优先回到这些工件。'
						],
						bullets: [
							'.harness-runner/story-status.json：故事推进状态和 completion signal',
							'.harness-runner/memory：每个故事的任务记忆',
							'.harness-runner/checkpoints：每次执行的恢复点',
							'.harness-runner/evidence：风险、验证、发布说明和回滚线索',
							'.harness-runner/run-logs：执行日志和诊断线索'
						]
					}
				]
			},
			{
				id: 'recommended-workflows',
				title: '推荐使用流程',
				summary: '按空项目和已有仓库两种起点选择路径，避免在缺少上下文时直接开跑。',
				sections: [
					{
						title: '空项目流程',
						paragraphs: [
							'如果当前工作区还没有 prd.json，建议先把 Harness 当作“计划和执行编排器”来使用，先建立故事骨架，再逐步补齐约束和上下文。'
						],
						steps: [
							'打开规划与入门，执行“生成 PRD”，先让项目目标和里程碑结构化。',
							'如需补充计划，再执行“追加用户故事”。',
							'进入“Harness 约束设置”，执行“初始化项目约束”，让 Harness 扫描脚本、目录、README 和配置。',
							'必要时补“生成 Agent Map”或“配置执行检查”，先把护栏和知识目录搭好，再进入实现循环。',
							'继续执行“为故事添加上下文”或“刷新源码上下文索引”，让后续故事能复用入口文件、模块提示和热点路径。',
							'如果有 UI 变化，再补“界面设计描述”。',
							'最后执行“开始执行”，按优先级推进故事。'
						],
						bullets: [
							'最小起步只需要工作区和 prd.json',
							'项目约束、源码上下文和设计上下文可以逐步补，不必一次到位',
							'开始执行后重点关注 memory、checkpoints、evidence 和 run-logs'
						]
					},
					{
						title: '已存在项目流程',
						paragraphs: [
							'如果仓库已经存在并有真实代码、脚本和文档，建议先把规则和已有知识显式化，再开始执行故事，这样 Copilot 的实现会更稳定。'
						],
						steps: [
							'确认工作区根目录已有或准备好 prd.json，必要时通过“追加用户故事”并入当前需求。',
							'优先进入“Harness 约束设置”，执行“初始化项目约束”，把已有脚本、目录规范、Git 规则和交付要求纳入 Harness。',
							'继续执行“为故事添加上下文”或“刷新源码上下文索引”，必要时再执行“生成 Agent Map”，暴露模块、规则入口和知识缺口。',
							'对有 UI 变化的故事补充“界面设计描述”。',
							'需要调整当前工作区运行配置或一级菜单顺序时，进入“设置”，打开 VS Code 设置或通过拖拽方式自定义菜单排序。',
							'确认执行检查、审批模式和 Reviewer 评分设置符合团队要求。',
							'使用“开始执行”“查看状态”“审批故事”“重置故事”组成日常操作闭环。'
						],
						bullets: [
							'已有项目更适合先补项目约束和上下文，而不是直接开跑',
							'改动面大或链路长时，建议先让 Agent Map、知识检查和 Reviewer loop 暴露规则入口',
							'核心事实来源在 story-status、memory、checkpoint 和 evidence'
						]
					},
					{
						title: '日常使用建议',
						paragraphs: [
							'Harness 最适合被当作“持续执行和治理层”。让 prd.json 管理需求和故事，让对应工件承接规则、设计和执行证据。',
							'如果某类错误反复出现，优先把它固化进约束、检查、文档或模板，而不是继续依赖人工口头纠偏。'
						],
						bullets: [
							'新增大需求时先更新 PRD，不要跳过故事层',
							'有设计要求的故事尽量先补设计描述，避免执行偏航',
							'执行失败时优先查看 checkpoint、evidence 和 run log 再决定是否重置',
							'高风险故事建议结合审批流和 rollback 线索一起使用'
						]
					}
				]
			},
			{
				id: 'expansion-path',
				title: '资料吸收与后续扩展',
				summary: '先把外部资料压缩成与插件能力一致的叙事，再继续扩展章节，而不是复制原文或堆新入口。',
				sections: [
					{
						title: '为什么仍然保留章节模型',
						paragraphs: [
							'这份指南不再区分“插件介绍”和“使用流程手册”两套平行入口，而是改为章节模型。现在接入 harness-engineering 后，也仍然沿用这个模型，让概念、流程和插件能力放在同一叙事里。'
						],
						bullets: [
							'章节天然支持按主题拆分和排序',
							'渲染入口保持单一，避免命令面不断膨胀',
							'吸收外部资料时先做概念对齐和能力映射，避免把外部术语原样堆进产品文案'
						]
					},
					{
						title: '后续继续并入资料时的准则',
						paragraphs: [
							'仓库中的 harness-engineering 资料已经被压缩进当前指南，用来解释 Harness Runner 的定义、失败模式和护栏设计。后续若继续吸收新材料，应当保持“概念先对齐，再映射到插件能力”的写法。'
						],
						steps: [
							'先提炼资料里的定义、失败模式、护栏或流程，不直接复制原文。',
							'把提炼后的结论映射到现有 commands、artifacts、policy gates 或 reviewer 流程。',
							'只有在出现新的稳定主题时才新增 chapter，而不是为单篇参考资料单独增加命令。'
						]
					}
				]
			}
		]
	};
}

function getEnglishGuideContent(): HarnessGuideContent {
	return {
		title: 'Harness-runner Guide',
		summary: 'This unified guide merges the product introduction, recommended usage flow, and the harness-engineering definition and practices into one chapter-based reading experience.',
		chapters: [
			{
				id: 'overview',
				title: 'Understand Harness Runner',
				summary: 'Start with what Harness Runner does and where it fits before you enter the execution loop.',
				sections: [
					{
						title: 'What Harness Is',
						paragraphs: [
							'Harness Runner is a VS Code workflow layer that connects story execution, checks, evidence, and handoff around prd.json instead of acting like a loose command list.',
							'In harness-engineering terms, it improves the environment around the model so Copilot can keep repository-specific rules, boundaries, and recent decisions intact across repeated executions.'
						],
						bullets: [
							'The operating model is human steer, agent execute: people define goals, constraints, and acceptance, and the harness keeps them present during execution',
							'Uses prd.json as the story entry point and runs by priority',
							'Injects project constraints, design context, task memory, source context, and checkpoints into prompts',
							'Requires task memory, checkpoint, and evidence artifacts before completion',
							'Supports reviewer passes, approvals, risk classification, and structured run logs'
						]
					},
					{
						title: 'Where It Fits',
						paragraphs: [
							'Harness Runner is useful when you already work with GitHub Copilot Chat and want a repeatable story-driven execution loop inside a real repository.',
							'It is especially helpful when the work needs traceability, multiple handoffs, or stronger governance than one-off prompts.'
						]
					}
				]
			},
			{
				id: 'harness-engineering',
				title: 'What Harness Engineering Means Here',
				summary: 'Explain why the harness exists: it is the engineering layer for constraints, feedback, handoff, and continuous correction.',
				sections: [
					{
						title: 'What The Harness Is Solving',
						paragraphs: [
							'Harness engineering is not about making a single answer prettier. It is about making an agent stay reliable over long-running, multi-step, handoff-heavy work.',
							'That means moving constraints, feedback loops, workflow control, and continuous improvement into the environment around the model so repeated failures can be engineered away instead of re-explained by hand.'
						],
						bullets: [
							'The optimized surface is the runtime environment, not the foundation model itself',
							'When an agent repeats a mistake, the durable fix is a rule, artifact, prompt boundary, or check rather than another ad hoc reminder',
							'Long tasks need tractable chunks, explicit handoff, and external state instead of one oversized session'
						]
					},
					{
						title: 'Why Long Runs Drift',
						paragraphs: [
							'Long-running agents often lose coherence as context grows, declare victory too early, or trust superficial checks instead of real validation.',
							'Harness Runner counters that by persisting state under .harness-runner and replaying structured memory, checkpoint, and evidence artifacts into later runs.'
						],
						bullets: [
							'Checkpoints and task memory act as the structured handoff instead of relying on leftover chat history',
							'Evidence artifacts and run logs ground completion in verifiable facts rather than self-evaluation',
							'Recovery starts from artifacts and known state instead of re-guessing what the previous session meant'
						]
					},
					{
						title: 'How The Guardrails Map To This Extension',
						paragraphs: [
							'Harness-engineering practice often reduces the control layer to context engineering, constraints, feedback loops, and entropy management. The current extension already maps cleanly to those guardrails.'
						],
						bullets: [
							'Context engineering: project constraints, design context, source context, Agent Map, and recent checkpoints are injected on demand instead of dumped all at once',
							'Constraints and workflow control: policy gates, approval settings, reviewer loops, and project rules make boundaries explicit',
							'Feedback loops: relevant tests, reviewer passes, approval history, and knowledge checks introduce external evaluation pressure',
							'Entropy management: memory, evidence, run logs, Agent Map, and rollback hints preserve maintainable state over time'
						]
					}
				]
			},
			{
				id: 'menu-and-artifacts',
				title: 'Menu And Core Artifacts',
				summary: 'Understand the top-level menu split and the runtime artifacts that form the audit trail.',
				sections: [
					{
						title: 'How The Top-Level Menu Is Split',
						paragraphs: [
							'The status bar button and Alt+R open the main menu. Settings-related actions now live under a dedicated Settings submenu so opening VS Code settings and customizing the top-level menu order do not crowd the root menu.'
						],
						bullets: [
							'Planning & Onboarding: generate the PRD and append stories',
							'Harness Constraint Settings: run checks, constraints, design notes, story context, source context, and Agent Map',
							'Execution & Review: start, stop, inspect status, approve, reset, and rerun failed stories',
							'Settings: open VS Code settings and customize the top-level menu order'
						]
					},
					{
						title: 'Which Artifacts Matter Most',
						paragraphs: [
							'The real execution state lives under .harness-runner instead of being left inside chat context. Use these artifacts for debugging, handoff, and reviewer passes.'
						],
						bullets: [
							'.harness-runner/story-status.json: story status and completion signal',
							'.harness-runner/memory: per-story task memory',
							'.harness-runner/checkpoints: resumable execution checkpoints',
							'.harness-runner/evidence: risk, validation, release notes, and rollback hints',
							'.harness-runner/run-logs: execution diagnostics'
						]
					}
				]
			},
			{
				id: 'recommended-workflows',
				title: 'Recommended Workflows',
				summary: 'Choose the right path for a new workspace or an existing repository.',
				sections: [
					{
						title: 'Empty Project Workflow',
						paragraphs: [
							'When the workspace does not have prd.json yet, treat Harness Runner as your planning and execution orchestrator. Build the story skeleton first, then add constraints and context.'
						],
						steps: [
							'Open Planning & Onboarding and run Generate PRD.',
							'Use Append User Stories when you need to expand the plan.',
							'Open Harness Constraint Settings and initialize project constraints.',
							'Add Agent Map or run checks early when you want the guardrails and knowledge surface in place before implementation.',
							'Add story context or refresh the source-context index so future stories can reuse entry points and hotspot paths.',
							'Add UI Design Notes when UI work is involved.',
							'Run Start to execute the queue by priority.'
						]
					},
					{
						title: 'Existing Repository Workflow',
						paragraphs: [
							'For an existing repository, surface the repository rules and existing knowledge before large execution passes so Copilot does not improvise around unknown conventions.'
						],
						steps: [
							'Confirm prd.json exists or append the current requirement into the existing PRD.',
							'Initialize project constraints before major execution passes.',
							'Add story context or refresh the source-context index, then generate Agent Map when module and rule discovery matter.',
							'Add UI Design Notes only for design-sensitive stories.',
							'Confirm run checks, approval mode, and Reviewer scoring settings before execution.',
							'Use Start, Show Status, Review Approval, Reset Story, and Rerun Failed Story as the operating loop.'
						]
					},
					{
						title: 'Daily Operating Advice',
						paragraphs: [
							'Treat Harness Runner as the execution and governance layer on top of your repository. Keep the PRD current, keep context fresh, and use the runtime artifacts as the main audit trail.',
							'If a mistake repeats, move the fix into a durable guardrail such as a project rule, a gate, a template, or a reusable artifact instead of relying on memory alone.'
						]
					}
				]
			},
			{
				id: 'expansion-path',
				title: 'Absorb Sources Without Fragmenting The Guide',
				summary: 'Keep future source material aligned with product behavior and chapter structure instead of turning each reference into a new surface area.',
				sections: [
					{
						title: 'Why The Chapter Model Still Matters',
						paragraphs: [
							'The guide no longer splits the product introduction and usage manual into separate user-facing entries. Now that harness-engineering material is part of the story, the same model keeps concepts, workflows, and extension behavior in one narrative.'
						],
						bullets: [
							'Chapters are easier to group, reorder, and extend',
							'The rendering entry stays single and predictable',
							'External references should be translated into product-relevant guidance instead of copied into raw user-facing prose'
						]
					},
					{
						title: 'Rules For Future Source Integration',
						paragraphs: [
							'The harness-engineering material in this repository is already condensed into the guide to explain the definition, drift risks, and guardrails behind Harness Runner. Future additions should preserve that same concept-first, capability-mapped style.'
						],
						steps: [
							'Extract the definition, failure mode, guardrail, or workflow insight instead of copying the source literally.',
							'Map the extracted idea to existing commands, artifacts, policy gates, or reviewer behavior.',
							'Add a new chapter only when a stable new theme appears, not for every single reference.'
						]
					}
				]
			}
		]
	};
}

function renderGuideHtml(content: HarnessGuideContent): string {
	const navigationHtml = content.chapters.map((chapter, index) => `
		<a href="#${chapter.id}" class="chapter-link">
			<span class="eyebrow">Chapter ${index + 1}</span>
			<strong>${escapeHtml(chapter.title)}</strong>
			<span>${escapeHtml(chapter.summary)}</span>
		</a>
	`).join('');

	const chapterHtml = content.chapters.map((chapter, index) => `
		<section id="${chapter.id}" class="chapter-shell">
			<div class="chapter-header">
				<p class="chapter-index">Chapter ${index + 1}</p>
				<h2>${escapeHtml(chapter.title)}</h2>
				<p class="chapter-summary">${escapeHtml(chapter.summary)}</p>
			</div>
			<div class="chapter-grid">
				${chapter.sections.map(section => `
					<section class="card">
						<h3>${escapeHtml(section.title)}</h3>
						${section.paragraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('')}
						${renderList(section.bullets, 'ul')}
						${renderList(section.steps, 'ol')}
					</section>
				`).join('')}
			</div>
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
				--accent-soft: color-mix(in srgb, var(--accent) 14%, transparent);
			}
			body {
				margin: 0;
				font-family: var(--vscode-font-family);
				background: radial-gradient(circle at top right, color-mix(in srgb, var(--accent) 18%, transparent), transparent 34%), var(--bg);
				color: var(--fg);
			}
			main {
				max-width: 1120px;
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
			.layout {
				display: grid;
				grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
				gap: 18px;
				align-items: start;
			}
			nav {
				position: sticky;
				top: 16px;
				padding: 18px;
				border: 1px solid var(--border);
				border-radius: 16px;
				background: color-mix(in srgb, var(--bg) 92%, var(--accent) 8%);
			}
			nav h2 {
				margin: 0 0 12px;
				font-size: 16px;
			}
			.chapter-link {
				display: grid;
				gap: 4px;
				padding: 12px 0;
				color: inherit;
				text-decoration: none;
				border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
			}
			.chapter-link:first-of-type {
				border-top: 0;
				padding-top: 0;
			}
			.eyebrow,
			.chapter-index {
				margin: 0;
				font-size: 12px;
				letter-spacing: 0.08em;
				text-transform: uppercase;
				color: var(--muted);
			}
			.content {
				display: grid;
				gap: 18px;
			}
			.chapter-shell {
				display: grid;
				gap: 14px;
			}
			.chapter-header {
				padding: 18px 20px;
				border-radius: 16px;
				border: 1px solid var(--border);
				background: linear-gradient(135deg, var(--accent-soft), transparent 70%);
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
			.chapter-summary {
				margin: 8px 0 0;
				color: var(--muted);
				line-height: 1.6;
			}
			.chapter-grid {
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
			h2,
			h3 {
				margin: 0 0 12px;
			}
			h2 {
				font-size: 22px;
			}
			h3 {
				font-size: 19px;
			}
			p, li {
				line-height: 1.7;
			}
			ul, ol {
				margin: 14px 0 0;
				padding-left: 22px;
			}
			@media (max-width: 900px) {
				.layout {
					grid-template-columns: 1fr;
				}
				nav {
					position: static;
				}
			}
			@media (max-width: 640px) {
				main {
					padding: 18px 14px 28px;
				}
				header,
				nav,
				.chapter-header,
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
			<div class="layout">
				<nav>
					<h2>Contents</h2>
					${navigationHtml}
				</nav>
				<div class="content">${chapterHtml}</div>
			</div>
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
