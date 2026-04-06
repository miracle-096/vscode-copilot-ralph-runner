import { SupportedHarnessLanguage } from './localization';

export interface HarnessGuideDocument {
	title: string;
	html: string;
}

export function buildHarnessGuideDocument(language: SupportedHarnessLanguage): HarnessGuideDocument {
	const content = getHarnessGuideContent(language);
	return {
		title: content.title,
		html: renderGuideHtml(content),
	};
}

function getHarnessGuideContent(language: SupportedHarnessLanguage): { title: string; sections: GuideSection[] } {
	return language === 'English'
		? getEnglishGuideContent()
		: getChineseGuideContent();
}

interface GuideSection {
	id: string;
	title: string;
	paragraphs: string[];
	bullets?: string[];
	steps?: string[];
	codeBlock?: string;
}

function getChineseGuideContent(): { title: string; sections: GuideSection[] } {
	return {
		title: 'Harness Runner 指南',
		sections: [
			{
				id: 'what-is-harness',
				title: '什么是 Harness，为什么需要它',
				paragraphs: [
					'Harness Runner 是一套围绕 prd.json 用户故事组织执行、检查、证据沉淀和交接的 VS Code 扩展工作流。',
					'它的核心哲学是"人类掌舵，智能体执行"——由人定义目标、约束和验收标准，Harness 负责把这些约束稳定送到执行现场。',
					'长周期开发中，智能体常见的失败模式包括：试图一次做完所有事情、在上下文膨胀后失去连贯性、过早宣布完成，以及只看局部结果不做真实验证。Harness 通过把状态写回 .harness-runner 目录，并把最近检查点、任务记忆和证据包重新注入下一轮执行，降低这种"上下文断裂"带来的漂移。'
				],
				bullets: [
					'以 prd.json 为故事入口，按优先级顺序推进执行',
					'自动注入项目约束、设计上下文、任务记忆、源码上下文和最近检查点',
					'在完成前要求 task memory、checkpoint、evidence 等可审计工件',
					'支持 Reviewer 评分、审批流、风险分级和结构化运行日志'
				]
			},
			{
				id: 'modules-and-flow',
				title: '插件包含哪些 Harness 模块，运行流程是怎样的',
				paragraphs: [
					'Harness Runner 把工程护栏归纳为四类控制点：上下文工程、架构与流程约束、反馈循环、熵管理。每个控制点对应插件中的具体能力。'
				],
				bullets: [
					'上下文工程：项目约束、设计上下文、源码上下文、Agent Map 和最近检查点按需注入',
					'架构与流程约束：Policy Gates、审批模式、Reviewer Loop 和项目约束把"什么不能做、什么时候必须停"显式化',
					'反馈循环：相关测试、Reviewer 评分、审批记录和知识检查帮助智能体面对外部评价',
					'熵管理：Memory、Evidence、Run Logs、Agent Map 与可回放工件一起承担长期维护和回滚线索提示'
				],
				steps: [
					'准备阶段：生成或确认 prd.json，初始化项目约束，刷新源码上下文索引',
					'执行阶段：按优先级选取下一个未开始的故事，注入上下文后委托 Cline 执行',
					'检查阶段：Policy Gates 检查完成条件，Reviewer 评分决定是否通过',
					'沉淀阶段：写入 task memory、execution checkpoint、story evidence 等工件',
					'循环阶段：回到执行阶段选取下一个故事，直到所有故事完成或达到循环上限'
				]
			},
			{
				id: 'getting-started',
				title: '如何开始使用',
				paragraphs: [],
				bullets: [
					'空项目：先生成 PRD 建立故事骨架，再逐步补齐约束和上下文，最后开始执行',
					'已有项目：先初始化项目约束和刷新源码上下文，确认执行检查和审批设置符合要求，再开始执行',
					'日常使用：新增需求先更新 PRD，有 UI 变化的故事先补设计描述，执行失败时优先查看 checkpoint 和 evidence 再决定是否重置'
				]
			},
			{
				id: 'gitignore',
				title: '推荐的 .gitignore 内容',
				paragraphs: [
					'建议在项目根目录的 .gitignore 中添加以下内容，避免将 Harness 的运行状态和工件提交到版本库：'
				],
				codeBlock: `.harness-runner/`
			}
		]
	};
}

function getEnglishGuideContent(): { title: string; sections: GuideSection[] } {
	return {
		title: 'Harness Runner Guide',
		sections: [
			{
				id: 'what-is-harness',
				title: 'What Is Harness and Why You Need It',
				paragraphs: [
					'Harness Runner is a VS Code extension workflow that orchestrates story execution, checks, evidence persistence, and handoff around prd.json.',
					'Its core philosophy is "human steers, agent executes" — people define goals, constraints, and acceptance criteria, while Harness ensures those constraints reach the execution context reliably.',
					'In long-running development, agents commonly fail by trying to do everything at once, losing coherence as context grows, declaring victory too early, or trusting superficial checks. Harness counters this by persisting state under .harness-runner and replaying structured memory, checkpoint, and evidence artifacts into later runs.'
				],
				bullets: [
					'Uses prd.json as the story entry point and runs by priority',
					'Injects project constraints, design context, task memory, source context, and checkpoints into prompts',
					'Requires task memory, checkpoint, and evidence artifacts before completion',
					'Supports reviewer scoring, approvals, risk classification, and structured run logs'
				]
			},
			{
				id: 'modules-and-flow',
				title: 'What Harness Modules Exist and How the Flow Works',
				paragraphs: [
					'Harness Runner maps engineering guardrails to four control points: context engineering, constraints, feedback loops, and entropy management. Each maps to concrete extension capabilities.'
				],
				bullets: [
					'Context engineering: project constraints, design context, source context, Agent Map, and recent checkpoints injected on demand',
					'Constraints and workflow control: policy gates, approval settings, reviewer loops, and project rules make boundaries explicit',
					'Feedback loops: relevant tests, reviewer scoring, approval history, and knowledge checks introduce external evaluation pressure',
					'Entropy management: memory, evidence, run logs, Agent Map, and rollback hints preserve maintainable state over time'
				],
				steps: [
					'Preparation: generate or confirm prd.json, initialize project constraints, refresh source context index',
					'Execution: select the next pending story by priority, inject context, and delegate to Cline',
					'Checks: policy gates verify completion conditions, reviewer scoring decides pass or fail',
					'Persistence: write task memory, execution checkpoint, and story evidence artifacts',
					'Loop: return to execution for the next story until all are done or the loop limit is reached'
				]
			},
			{
				id: 'getting-started',
				title: 'How to Get Started',
				paragraphs: [],
				bullets: [
					'Empty project: generate PRD first to build the story skeleton, then add constraints and context, then start execution',
					'Existing project: initialize project constraints and refresh source context first, confirm check and approval settings, then start execution',
					'Daily use: update PRD for new requirements, add design notes for UI stories, check checkpoint and evidence before resetting on failure'
				]
			},
			{
				id: 'gitignore',
				title: 'Recommended .gitignore Content',
				paragraphs: [
					'Add the following to your project root .gitignore to keep Harness runtime state and artifacts out of version control:'
				],
				codeBlock: `.harness-runner/`
			}
		]
	};
}

function renderGuideHtml(content: { title: string; sections: GuideSection[] }): string {
	const sectionsHtml = content.sections.map(section => `
		<section class="section" id="${section.id}">
			<h2>${escapeHtml(section.title)}</h2>
			${section.paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('')}
			${section.bullets && section.bullets.length > 0 ? `<ul>${section.bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>` : ''}
			${section.steps && section.steps.length > 0 ? `<ol>${section.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>` : ''}
			${section.codeBlock ? `<pre><code>${escapeHtml(section.codeBlock)}</code></pre>` : ''}
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
			--card: var(--vscode-editor-inactiveSelectionBackground);
			--border: var(--vscode-input-border);
			--accent: var(--vscode-textLink-foreground);
		}
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}
		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size, 13px);
			background: var(--bg);
			color: var(--fg);
			line-height: 1.6;
			padding: 24px;
		}
		main {
			max-width: 720px;
			margin: 0 auto;
		}
		h1 {
			font-size: 1.4em;
			font-weight: 600;
			margin-bottom: 20px;
			padding-bottom: 12px;
			border-bottom: 1px solid var(--border);
		}
		.section {
			margin-bottom: 24px;
			padding: 16px;
			background: var(--card);
			border-radius: 6px;
			border: 1px solid var(--border);
		}
		h2 {
			font-size: 1.1em;
			font-weight: 600;
			margin-bottom: 12px;
			color: var(--accent);
		}
		p {
			margin-bottom: 8px;
		}
		p:last-child {
			margin-bottom: 0;
		}
		ul, ol {
			margin: 8px 0 8px 20px;
		}
		li {
			margin-bottom: 4px;
		}
		pre {
			margin-top: 8px;
			padding: 10px 12px;
			background: var(--vscode-textCodeBlock-background);
			border-radius: 4px;
			overflow-x: auto;
		}
		code {
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: var(--vscode-editor-font-size, 13px);
		}
	</style>
</head>
<body>
	<main>
		<h1>${escapeHtml(content.title)}</h1>
		${sectionsHtml}
	</main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&')
		.replace(/</g, '<')
		.replace(/>/g, '>')
		.replace(/"/g, '"')
		.replace(/'/g, '&#39;');
}