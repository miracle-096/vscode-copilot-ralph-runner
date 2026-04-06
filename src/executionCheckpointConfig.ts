import * as vscode from 'vscode';
import {
	normalizePolicyConfig,
	createDefaultPolicyConfig,
} from './policyGate';
import {
	HarnessLanguagePack,
} from './localization';

export interface PolicyRuleItem {
	id: string;
	label: string;
	description: string;
	enabled: boolean;
	phase: 'preflight' | 'completion';
}

export interface ExecutionCheckpointConfigState {
	enabled: boolean;
	rules: PolicyRuleItem[];
	approvalMode: 'default' | 'bypass' | 'autopilot';
	reviewerLoopEnabled: boolean;
	reviewerPassingScore: number;
	maxAutoRefactorRounds: number;
	policyGateAutoFixRounds: number;
	stories?: StoryCheckpointInfo[];
	constantParams?: ConstantParamInfo[];
}

export interface StoryCheckpointInfo {
	id: string;
	title: string;
	status: 'completed' | 'failed' | 'pendingReview' | 'pendingRelease' | 'inprogress' | 'none';
	priority: number;
	lastCheckpoint?: {
		status: string;
		updatedAt: string;
		summary: string;
	};
}

export interface ConstantParamInfo {
	key: string;
	label: string;
	value: string | number | boolean;
	description: string;
	category: 'execution' | 'review' | 'policy' | 'general';
}

export function buildExecutionCheckpointConfigHtml(
	config: ExecutionCheckpointConfigState,
	languagePack: HarnessLanguagePack,
	cspSource: string,
): string {
	const rulesJson = JSON.stringify(config.rules).replace(/</g, '\\u003c');
	const configJson = JSON.stringify({
		enabled: config.enabled,
		approvalMode: config.approvalMode,
		reviewerLoopEnabled: config.reviewerLoopEnabled,
		reviewerPassingScore: config.reviewerPassingScore,
		maxAutoRefactorRounds: config.maxAutoRefactorRounds,
		policyGateAutoFixRounds: config.policyGateAutoFixRounds,
	}).replace(/</g, '\\u003c');
	const storiesJson = JSON.stringify(config.stories || []).replace(/</g, '\\u003c');
	const constantParamsJson = JSON.stringify(config.constantParams || []).replace(/</g, '\\u003c');

	const copy = languagePack.policyConfig;

	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'unsafe-inline'; font-src ${cspSource} https://cdn.jsdelivr.net;">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${copy.title}</title>
	<style>
		:root {
			--vscode-font-family: var(--vscode-font-family, system-ui, -apple-system, sans-serif);
			--vscode-font-size: var(--vscode-font-size, 13px);
			--vscode-foreground: var(--vscode-foreground, #cccccc);
			--vscode-editor-background: var(--vscode-editor-background, #1e1e1e);
			--vscode-editor-foreground: var(--vscode-editor-foreground, #cccccc);
			--vscode-button-background: var(--vscode-button-background, #0e639c);
			--vscode-button-foreground: var(--vscode-button-foreground, #ffffff);
			--vscode-button-hoverBackground: var(--vscode-button-hoverBackground, #1177bb);
			--vscode-input-background: var(--vscode-input-background, #3c3c3c);
			--vscode-input-foreground: var(--vscode-input-foreground, #cccccc);
			--vscode-input-border: var(--vscode-input-border, #555555);
			--vscode-dropdown-background: var(--vscode-dropdown-background, #3c3c3c);
			--vscode-dropdown-foreground: var(--vscode-dropdown-foreground, #cccccc);
			--vscode-dropdown-border: var(--vscode-dropdown-border, #555555);
			--vscode-list-hoverBackground: var(--vscode-list-hoverBackground, #2a2d2e);
			--vscode-list-activeSelectionBackground: var(--vscode-list-activeSelectionBackground, #094771);
			--vscode-list-activeSelectionForeground: var(--vscode-list-activeSelectionForeground, #ffffff);
			--vscode-badge-background: var(--vscode-badge-background, #4d78cc);
			--vscode-badge-foreground: var(--vscode-badge-foreground, #ffffff);
			--vscode-textLink-foreground: var(--vscode-textLink-foreground, #3794ff);
			--vscode-textSeparator-foreground: var(--vscode-textSeparator-foreground, #ffffff33);
			--vscode-focusBorder: var(--vscode-focusBorder, #007fd4);
			--vscode-checkbox-background: var(--vscode-checkbox-background, #3c3c3c);
			--vscode-checkbox-foreground: var(--vscode-checkbox-foreground, #cccccc);
			--vscode-checkbox-border: var(--vscode-checkbox-border, #555555);
			--vscode-descriptionForeground: var(--vscode-descriptionForeground, #cccccc99);
			--vscode-errorForeground: var(--vscode-errorForeground, #f48771);
			--vscode-successForeground: var(--vscode-successForeground, #89d185);
			--vscode-warningForeground: var(--vscode-warningForeground, #cca700);
			--rule-preflight-color: #4d78cc;
			--rule-completion-color: #89d185;
			--input-bg: #2d2d30;
			--input-border: #6e6e6e;
			--input-hover-border: #007fd4;
			--section-bg: #252526;
			--rule-bg: #2d2d30;
		}

		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}

		body {
			font-family: var(--vscode-font-family);
			font-size: 12px;
			color: var(--vscode-foreground);
			background-color: var(--vscode-editor-background);
			line-height: 1.4;
			padding: 12px;
		}

		.container {
			max-width: 720px;
			margin: 0 auto;
		}

		h1 {
			font-size: 1.2em;
			font-weight: 600;
			margin-bottom: 4px;
			color: var(--vscode-editor-foreground);
			display: flex;
			align-items: center;
			gap: 6px;
		}

		h1 .title-icon {
			font-size: 1.1em;
		}

		.description {
			color: var(--vscode-descriptionForeground);
			margin-bottom: 12px;
			font-size: 11px;
		}

		.section {
			margin-bottom: 10px;
			padding: 10px 12px;
			background: var(--section-bg);
			border-radius: 4px;
			border: 1px solid var(--vscode-input-border);
		}

		.section-title {
			font-size: 0.95em;
			font-weight: 600;
			margin-bottom: 8px;
			display: flex;
			align-items: center;
			gap: 6px;
		}

		.section-title .icon {
			font-size: 1em;
		}

		/* Toggle Switch */
		.toggle-container {
			display: flex;
			align-items: center;
			gap: 8px;
			margin-bottom: 6px;
		}

		.toggle {
			position: relative;
			width: 36px;
			height: 18px;
			flex-shrink: 0;
		}

		.toggle input {
			opacity: 0;
			width: 0;
			height: 0;
		}

		.toggle-slider {
			position: absolute;
			cursor: pointer;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			background-color: var(--input-border);
			transition: 0.2s;
			border-radius: 18px;
		}

		.toggle-slider:before {
			position: absolute;
			content: "";
			height: 14px;
			width: 14px;
			left: 2px;
			bottom: 2px;
			background-color: var(--vscode-checkbox-foreground);
			transition: 0.2s;
			border-radius: 50%;
		}

		.toggle input:checked + .toggle-slider {
			background-color: var(--vscode-button-background);
		}

		.toggle input:checked + .toggle-slider:before {
			transform: translateX(18px);
		}

		.toggle input:focus + .toggle-slider {
			box-shadow: 0 0 0 1px var(--vscode-focusBorder);
		}

		.toggle-label {
			font-weight: 500;
			font-size: 12px;
		}

		.toggle-description {
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
		}

		/* Rule List */
		.rule-list {
			display: flex;
			flex-direction: column;
			gap: 4px;
		}

		.rule-item {
			display: flex;
			align-items: flex-start;
			gap: 8px;
			padding: 6px 8px;
			background: var(--rule-bg);
			border-radius: 3px;
			border: 1px solid transparent;
			transition: border-color 0.15s, background-color 0.15s;
		}

		.rule-item:hover {
			border-color: var(--input-border);
			background: var(--input-bg);
		}

		.rule-item.disabled {
			opacity: 0.5;
		}

		.rule-checkbox {
			margin-top: 1px;
			width: 14px;
			height: 14px;
			cursor: pointer;
			accent-color: var(--vscode-button-background);
			flex-shrink: 0;
		}

		.rule-content {
			flex: 1;
			min-width: 0;
		}

		.rule-header {
			display: flex;
			align-items: center;
			gap: 6px;
			margin-bottom: 2px;
		}

		.rule-name {
			font-weight: 500;
			font-size: 12px;
		}

		.rule-phase {
			font-size: 10px;
			padding: 1px 5px;
			border-radius: 2px;
			color: white;
			flex-shrink: 0;
		}

		.rule-phase.preflight {
			background-color: var(--rule-preflight-color);
		}

		.rule-phase.completion {
			background-color: var(--rule-completion-color);
		}

		.rule-description {
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
			line-height: 1.3;
		}

		/* Select Dropdown */
		.select-wrapper {
			position: relative;
			margin-bottom: 8px;
		}

		select {
			width: 100%;
			padding: 5px 28px 5px 8px;
			background: var(--input-bg);
			color: var(--vscode-dropdown-foreground);
			border: 1px solid var(--input-border);
			border-radius: 3px;
			font-size: 12px;
			font-family: var(--vscode-font-family);
			cursor: pointer;
			appearance: none;
			-webkit-appearance: none;
			background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath fill='%23cccccc' d='M5 7L1 3h8z'/%3E%3C/svg%3E");
			background-repeat: no-repeat;
			background-position: right 8px center;
			transition: border-color 0.15s;
		}

		select:hover {
			border-color: var(--input-hover-border);
		}

		select:focus {
			outline: none;
			border-color: var(--input-hover-border);
			box-shadow: 0 0 0 1px var(--input-hover-border);
		}

		/* Number Input */
		.number-input-group {
			display: flex;
			align-items: center;
			gap: 8px;
			margin-bottom: 6px;
		}

		.number-input-group label {
			min-width: 160px;
			font-size: 12px;
		}

		.number-input {
			width: 70px;
			padding: 4px 6px;
			background: var(--input-bg);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--input-border);
			border-radius: 3px;
			font-size: 12px;
			font-family: var(--vscode-font-family);
			transition: border-color 0.15s;
		}

		.number-input:hover {
			border-color: var(--input-hover-border);
		}

		.number-input:focus {
			outline: none;
			border-color: var(--input-hover-border);
			box-shadow: 0 0 0 1px var(--input-hover-border);
		}

		/* Buttons */
		.button-group {
			display: flex;
			gap: 8px;
			margin-top: 12px;
			padding-top: 10px;
			border-top: 1px solid var(--vscode-textSeparator-foreground);
		}

		.button {
			padding: 5px 14px;
			border: none;
			border-radius: 3px;
			font-size: 12px;
			font-family: var(--vscode-font-family);
			cursor: pointer;
			transition: background-color 0.15s;
		}

		.button-primary {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}

		.button-primary:hover {
			background: var(--vscode-button-hoverBackground);
		}

		.button-secondary {
			background: transparent;
			color: var(--vscode-foreground);
			border: 1px solid var(--input-border);
		}

		.button-secondary:hover {
			background: var(--vscode-list-hoverBackground);
		}

		/* Status Message */
		.status-message {
			padding: 6px 10px;
			border-radius: 3px;
			margin-top: 8px;
			display: none;
			font-size: 11px;
		}

		.status-message.success {
			display: block;
			background: rgba(137, 209, 133, 0.1);
			border: 1px solid var(--vscode-successForeground);
			color: var(--vscode-successForeground);
		}

		.status-message.error {
			display: block;
			background: rgba(244, 135, 113, 0.1);
			border: 1px solid var(--vscode-errorForeground);
			color: var(--vscode-errorForeground);
		}

		/* Scope Selector */
		.scope-selector {
			display: flex;
			gap: 6px;
			margin-bottom: 10px;
		}

		.scope-option {
			flex: 1;
			padding: 8px;
			background: var(--rule-bg);
			border: 1px solid var(--input-border);
			border-radius: 3px;
			cursor: pointer;
			transition: all 0.15s;
			text-align: center;
		}

		.scope-option:hover {
			border-color: var(--input-hover-border);
		}

		.scope-option.selected {
			border-color: var(--vscode-button-background);
			background: rgba(14, 99, 156, 0.15);
		}

		.scope-option .scope-label {
			font-weight: 500;
			font-size: 12px;
			margin-bottom: 2px;
		}

		.scope-option .scope-desc {
			font-size: 10px;
			color: var(--vscode-descriptionForeground);
			line-height: 1.3;
		}

		/* Legend */
		.legend {
			display: flex;
			gap: 12px;
			margin-bottom: 8px;
			font-size: 11px;
		}

		.legend-item {
			display: flex;
			align-items: center;
			gap: 4px;
		}

		.legend-dot {
			width: 8px;
			height: 8px;
			border-radius: 50%;
		}

		.legend-dot.preflight {
			background: var(--rule-preflight-color);
		}

		.legend-dot.completion {
			background: var(--rule-completion-color);
		}

		/* Story Checkpoint List */
		.story-list {
			display: flex;
			flex-direction: column;
			gap: 4px;
		}

		.story-item {
			display: flex;
			align-items: flex-start;
			gap: 8px;
			padding: 8px;
			background: var(--rule-bg);
			border-radius: 3px;
			border: 1px solid transparent;
			transition: border-color 0.15s, background-color 0.15s;
		}

		.story-item:hover {
			border-color: var(--input-border);
			background: var(--input-bg);
		}

		.story-status {
			width: 10px;
			height: 10px;
			border-radius: 50%;
			margin-top: 3px;
			flex-shrink: 0;
		}

		.story-status.completed { background: #89d185; }
		.story-status.failed { background: #f48771; }
		.story-status.pendingReview { background: #cca700; }
		.story-status.pendingRelease { background: #4d78cc; }
		.story-status.inprogress { background: #007fd4; animation: pulse 1.5s infinite; }
		.story-status.none { background: #6e6e6e; }

		@keyframes pulse {
			0%, 100% { opacity: 1; }
			50% { opacity: 0.5; }
		}

		.story-content {
			flex: 1;
			min-width: 0;
		}

		.story-header {
			display: flex;
			align-items: center;
			gap: 6px;
			margin-bottom: 2px;
		}

		.story-id {
			font-weight: 600;
			font-size: 12px;
			color: var(--vscode-textLink-foreground);
		}

		.story-title-text {
			font-size: 12px;
			color: var(--vscode-foreground);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.story-priority {
			font-size: 10px;
			padding: 1px 5px;
			border-radius: 2px;
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
			flex-shrink: 0;
		}

		.story-status-label {
			font-size: 10px;
			padding: 1px 5px;
			border-radius: 2px;
			color: white;
			flex-shrink: 0;
		}

		.story-status-label.completed { background: #89d185; }
		.story-status-label.failed { background: #f48771; }
		.story-status-label.pendingReview { background: #cca700; }
		.story-status-label.pendingRelease { background: #4d78cc; }
		.story-status-label.inprogress { background: #007fd4; }
		.story-status-label.none { background: #6e6e6e; }

		.story-checkpoint {
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			margin-top: 4px;
			padding: 4px 6px;
			background: rgba(255,255,255,0.03);
			border-radius: 2px;
		}

		.story-checkpoint .checkpoint-status {
			font-weight: 500;
		}

		.story-checkpoint .checkpoint-time {
			color: var(--vscode-descriptionForeground);
			font-size: 10px;
		}

		/* Constant Parameters Table */
		.param-table {
			width: 100%;
			border-collapse: collapse;
			font-size: 11px;
		}

		.param-table th {
			text-align: left;
			padding: 4px 6px;
			background: var(--input-bg);
			border-bottom: 1px solid var(--input-border);
			font-weight: 600;
			color: var(--vscode-descriptionForeground);
			font-size: 10px;
			text-transform: uppercase;
		}

		.param-table td {
			padding: 4px 6px;
			border-bottom: 1px solid rgba(255,255,255,0.05);
			vertical-align: top;
		}

		.param-table tr:hover td {
			background: var(--input-bg);
		}

		.param-key {
			font-family: var(--vscode-editor-font-family, monospace);
			font-weight: 500;
			color: var(--vscode-textLink-foreground);
		}

		.param-value {
			font-family: var(--vscode-editor-font-family, monospace);
			background: var(--input-bg);
			padding: 1px 4px;
			border-radius: 2px;
			font-size: 11px;
		}

		.param-category {
			font-size: 10px;
			padding: 1px 4px;
			border-radius: 2px;
			color: white;
		}

		.param-category.execution { background: var(--rule-preflight-color); }
		.param-category.review { background: var(--rule-completion-color); }
		.param-category.policy { background: #cca700; }
		.param-category.general { background: #6e6e6e; }

		/* Tab Navigation */
		.tab-nav {
			display: flex;
			gap: 0;
			margin-bottom: 0;
			border-bottom: 1px solid var(--vscode-input-border);
		}

		.tab-btn {
			padding: 6px 12px;
			background: transparent;
			border: none;
			border-bottom: 2px solid transparent;
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
			font-family: var(--vscode-font-family);
			cursor: pointer;
			transition: all 0.15s;
		}

		.tab-btn:hover {
			color: var(--vscode-foreground);
			background: var(--vscode-list-hoverBackground);
		}

		.tab-btn.active {
			color: var(--vscode-foreground);
			border-bottom-color: var(--vscode-button-background);
		}

		.tab-content {
			display: none;
		}

		.tab-content.active {
			display: block;
		}

		/* Summary Stats */
		.summary-stats {
			display: flex;
			gap: 8px;
			margin-bottom: 8px;
		}

		.stat-card {
			flex: 1;
			padding: 6px 8px;
			background: var(--input-bg);
			border-radius: 3px;
			text-align: center;
		}

		.stat-value {
			font-size: 18px;
			font-weight: 600;
			color: var(--vscode-editor-foreground);
		}

		.stat-label {
			font-size: 10px;
			color: var(--vscode-descriptionForeground);
		}

		.stat-card.completed .stat-value { color: #89d185; }
		.stat-card.failed .stat-value { color: #f48771; }
		.stat-card.pending .stat-value { color: #cca700; }
		.stat-card.total .stat-value { color: var(--vscode-textLink-foreground); }
	</style>
</head>
<body>
	<div class="container">
		<h1><span class="title-icon">&#9881;</span> ${copy.title}</h1>
		<p class="description">通过可视化界面启用或关闭内置检查项和审批提示模式</p>

		<!-- Scope Selector -->
		<div class="section">
			<div class="section-title">
				<span class="icon">&#128193;</span>
				保存位置
			</div>
			<div class="scope-selector">
				<div class="scope-option" data-scope="Global" id="scopeGlobal">
					<div class="scope-label">User 全局设置</div>
					<div class="scope-desc">写入用户级 settings，对所有工作区生效</div>
				</div>
				<div class="scope-option" data-scope="Workspace" id="scopeWorkspace">
					<div class="scope-label">当前 Workspace</div>
					<div class="scope-desc">只对当前工作区生效</div>
				</div>
			</div>
		</div>

		<!-- Main Toggle -->
		<div class="section">
			<div class="section-title">
				<span class="icon">&#128737;</span>
				自动检查开关
			</div>
			<div class="toggle-container">
				<label class="toggle">
					<input type="checkbox" id="mainToggle" ${config.enabled ? 'checked' : ''}>
					<span class="toggle-slider"></span>
				</label>
				<div>
					<div class="toggle-label" id="mainToggleLabel">${config.enabled ? '启用自动检查' : '关闭自动检查'}</div>
					<div class="toggle-description" id="mainToggleDesc">${config.enabled ? '在故事开始前和完成前自动检查规则' : '保留当前规则配置，但暂时不执行检查'}</div>
				</div>
			</div>
		</div>

		<!-- Tab Navigation -->
		<div class="section" style="padding-bottom: 0;">
			<div class="tab-nav">
				<button class="tab-btn active" data-tab="rules">&#9745; 检查规则</button>
				<button class="tab-btn" data-tab="stories">&#128203; 执行检查</button>
				<button class="tab-btn" data-tab="params">&#128295; 常量参数</button>
			</div>
		</div>

		<!-- Tab Content: Rules -->
		<div class="tab-content active" id="tab-rules">
			<div class="section">
				<div class="section-title">
					<span class="icon">&#9745;</span>
					内置检查项
				</div>
				<div class="legend">
					<div class="legend-item">
						<div class="legend-dot preflight"></div>
						<span>故事开始前检查</span>
					</div>
					<div class="legend-item">
						<div class="legend-dot completion"></div>
						<span>故事完成后检查</span>
					</div>
				</div>
				<div class="rule-list" id="ruleList">
					<!-- Rules will be rendered by JS -->
				</div>
			</div>
		</div>

		<!-- Tab Content: Stories -->
		<div class="tab-content" id="tab-stories">
			<div class="section">
				<div class="section-title">
					<span class="icon">&#128203;</span>
					故事执行状态
				</div>
				<div class="summary-stats" id="storyStats">
					<!-- Stats will be rendered by JS -->
				</div>
				<div class="story-list" id="storyList">
					<!-- Stories will be rendered by JS -->
				</div>
			</div>
		</div>

		<!-- Tab Content: Constant Parameters -->
		<div class="tab-content" id="tab-params">
			<div class="section">
				<div class="section-title">
					<span class="icon">&#128295;</span>
					常量参数配置
				</div>
				<table class="param-table" id="paramTable">
					<thead>
						<tr>
							<th>参数名</th>
							<th>值</th>
							<th>分类</th>
							<th>说明</th>
						</tr>
					</thead>
					<tbody>
						<!-- Params will be rendered by JS -->
					</tbody>
				</table>
			</div>
		</div>

		<!-- Approval Mode -->
		<div class="section">
			<div class="section-title">
				<span class="icon">&#9989;</span>
				审批模式
			</div>
			<div class="select-wrapper">
				<select id="approvalMode">
					<option value="default" ${config.approvalMode === 'default' ? 'selected' : ''}>default：弹出审批提示</option>
					<option value="bypass" ${config.approvalMode === 'bypass' ? 'selected' : ''}>bypass：直接进入审批流</option>
					<option value="autopilot" ${config.approvalMode === 'autopilot' ? 'selected' : ''}>autopilot：仅落盘并挂到状态栏</option>
				</select>
			</div>
			<div class="toggle-description" id="approvalModeDesc">工作区有覆盖时优先使用工作区；否则回退到 User 全局设置</div>
		</div>

		<!-- Reviewer Loop -->
		<div class="section">
			<div class="section-title">
				<span class="icon">&#128260;</span>
				Reviewer 评分流程
			</div>
			<div class="toggle-container">
				<label class="toggle">
					<input type="checkbox" id="reviewerLoopToggle" ${config.reviewerLoopEnabled ? 'checked' : ''}>
					<span class="toggle-slider"></span>
				</label>
				<div>
					<div class="toggle-label" id="reviewerLoopLabel">${config.reviewerLoopEnabled ? '启用 Reviewer 评分流程' : '关闭 Reviewer 评分流程'}</div>
					<div class="toggle-description" id="reviewerLoopDesc">${config.reviewerLoopEnabled ? '执行后进入 Reviewer pass，并按评分阈值决定是否自动修复' : '执行完成后直接结束，不再进入评分和自动修复回路'}</div>
				</div>
			</div>
			<div class="number-input-group">
				<label for="reviewerPassingScore">通过分数 (1-100)：</label>
				<input type="number" id="reviewerPassingScore" class="number-input" value="${config.reviewerPassingScore}" min="1" max="100">
			</div>
			<div class="number-input-group">
				<label for="maxAutoRefactorRounds">自动修复轮数 (0+)：</label>
				<input type="number" id="maxAutoRefactorRounds" class="number-input" value="${config.maxAutoRefactorRounds}" min="0">
			</div>
			<div class="number-input-group">
				<label for="policyGateAutoFixRounds">策略门禁自动修复轮数 (0-5)：</label>
				<input type="number" id="policyGateAutoFixRounds" class="number-input" value="${config.policyGateAutoFixRounds}" min="0" max="5">
			</div>
		</div>

		<!-- Action Buttons -->
		<div class="button-group">
			<button class="button button-primary" id="saveBtn">&#10004; 保存配置</button>
			<button class="button button-secondary" id="resetBtn">&#8634; 恢复默认</button>
			<button class="button button-secondary" id="cancelBtn">&#10006; 取消</button>
		</div>

		<div class="status-message" id="statusMessage"></div>
	</div>

	<script>
		const vscode = acquireVsCodeApi();
		const rules = ${rulesJson};
		const initialConfig = ${configJson};
		const stories = ${storiesJson};
		const constantParams = ${constantParamsJson};
		let selectedScope = 'Global';

		// Tab switching
		document.querySelectorAll('.tab-btn').forEach(btn => {
			btn.addEventListener('click', function() {
				const tabId = this.dataset.tab;
				document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
				document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
				this.classList.add('active');
				document.getElementById('tab-' + tabId).classList.add('active');
			});
		});

		// Render rules
		function renderRules() {
			const ruleList = document.getElementById('ruleList');
			ruleList.innerHTML = rules.map((rule, index) => \`
				<div class="rule-item \${rule.enabled ? '' : 'disabled'}" data-index="\${index}">
					<input type="checkbox" class="rule-checkbox" \${rule.enabled ? 'checked' : ''} data-index="\${index}">
					<div class="rule-content">
						<div class="rule-header">
							<span class="rule-name">\${rule.label}</span>
							<span class="rule-phase \${rule.phase}">\${rule.phase === 'preflight' ? '开始前' : '完成后'}</span>
						</div>
						<div class="rule-description">\${rule.description}</div>
					</div>
				</div>
			\`).join('');
		}

		// Render story stats
		function renderStoryStats() {
			const stats = { completed: 0, failed: 0, pending: 0, total: stories.length };
			stories.forEach(s => {
				if (s.status === 'completed') stats.completed++;
				else if (s.status === 'failed') stats.failed++;
				else if (s.status === 'pendingReview' || s.status === 'pendingRelease' || s.status === 'inprogress' || s.status === 'none') stats.pending++;
			});

			document.getElementById('storyStats').innerHTML = \`
				<div class="stat-card completed">
					<div class="stat-value">\${stats.completed}</div>
					<div class="stat-label">已完成</div>
				</div>
				<div class="stat-card failed">
					<div class="stat-value">\${stats.failed}</div>
					<div class="stat-label">失败</div>
				</div>
				<div class="stat-card pending">
					<div class="stat-value">\${stats.pending}</div>
					<div class="stat-label">待执行/审核</div>
				</div>
				<div class="stat-card total">
					<div class="stat-value">\${stats.total}</div>
					<div class="stat-label">总计</div>
				</div>
			\`;
		}

		// Render story list
		function renderStoryList() {
			const storyList = document.getElementById('storyList');
			if (stories.length === 0) {
				storyList.innerHTML = '<div style="text-align:center;color:var(--vscode-descriptionForeground);padding:12px;">暂无故事执行数据</div>';
				return;
			}

			const statusLabels = {
				completed: '已完成',
				failed: '失败',
				pendingReview: '待审核',
				pendingRelease: '待发布',
				inprogress: '执行中',
				none: '未开始'
			};

			storyList.innerHTML = stories.map(story => \`
				<div class="story-item">
					<div class="story-status \${story.status}"></div>
					<div class="story-content">
						<div class="story-header">
							<span class="story-id">\${story.id}</span>
							<span class="story-title-text">\${story.title}</span>
							<span class="story-priority">P\${story.priority}</span>
							<span class="story-status-label \${story.status}">\${statusLabels[story.status] || story.status}</span>
						</div>
						\${story.lastCheckpoint ? \`
							<div class="story-checkpoint">
								<span class="checkpoint-status">检查点: \${story.lastCheckpoint.status}</span>
								<span class="checkpoint-time"> | \${story.lastCheckpoint.updatedAt}</span>
								<div>\${story.lastCheckpoint.summary}</div>
							</div>
						\` : ''}
					</div>
				</div>
			\`).join('');
		}

		// Render constant parameters table
		function renderConstantParams() {
			const tbody = document.querySelector('#paramTable tbody');
			if (constantParams.length === 0) {
				tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--vscode-descriptionForeground);padding:12px;">暂无常量参数配置</td></tr>';
				return;
			}

			const categoryLabels = {
				execution: '执行',
				review: '审核',
				policy: '策略',
				general: '通用'
			};

			tbody.innerHTML = constantParams.map(param => \`
				<tr>
					<td><span class="param-key">\${param.key}</span></td>
					<td><span class="param-value">\${param.value}</span></td>
					<td><span class="param-category \${param.category}">\${categoryLabels[param.category]}</span></td>
					<td>\${param.description}</td>
				</tr>
			\`).join('');
		}

		renderRules();
		renderStoryStats();
		renderStoryList();
		renderConstantParams();

		// Scope selection
		document.getElementById('scopeGlobal').addEventListener('click', function() {
			selectedScope = 'Global';
			document.getElementById('scopeGlobal').classList.add('selected');
			document.getElementById('scopeWorkspace').classList.remove('selected');
		});

		document.getElementById('scopeWorkspace').addEventListener('click', function() {
			selectedScope = 'Workspace';
			document.getElementById('scopeWorkspace').classList.add('selected');
			document.getElementById('scopeGlobal').classList.remove('selected');
		});

		// Default to Global
		document.getElementById('scopeGlobal').classList.add('selected');

		// Main toggle
		const mainToggle = document.getElementById('mainToggle');
		const mainToggleLabel = document.getElementById('mainToggleLabel');
		const mainToggleDesc = document.getElementById('mainToggleDesc');

		mainToggle.addEventListener('change', function() {
			if (this.checked) {
				mainToggleLabel.textContent = '启用自动检查';
				mainToggleDesc.textContent = '在故事开始前和完成前自动检查规则';
			} else {
				mainToggleLabel.textContent = '关闭自动检查';
				mainToggleDesc.textContent = '保留当前规则配置，但暂时不执行检查';
			}
		});

		// Reviewer loop toggle
		const reviewerLoopToggle = document.getElementById('reviewerLoopToggle');
		const reviewerLoopLabel = document.getElementById('reviewerLoopLabel');
		const reviewerLoopDesc = document.getElementById('reviewerLoopDesc');

		reviewerLoopToggle.addEventListener('change', function() {
			if (this.checked) {
				reviewerLoopLabel.textContent = '启用 Reviewer 评分流程';
				reviewerLoopDesc.textContent = '执行后进入 Reviewer pass，并按评分阈值决定是否自动修复';
			} else {
				reviewerLoopLabel.textContent = '关闭 Reviewer 评分流程';
				reviewerLoopDesc.textContent = '执行完成后直接结束，不再进入评分和自动修复回路';
			}
		});

		// Rule checkbox changes
		document.getElementById('ruleList').addEventListener('change', function(e) {
			if (e.target.classList.contains('rule-checkbox')) {
				const index = parseInt(e.target.dataset.index);
				rules[index].enabled = e.target.checked;
				const ruleItem = e.target.closest('.rule-item');
				if (e.target.checked) {
					ruleItem.classList.remove('disabled');
				} else {
					ruleItem.classList.add('disabled');
				}
			}
		});

		// Save button
		document.getElementById('saveBtn').addEventListener('click', function() {
			const enabledRuleIds = rules.filter(r => r.enabled).map(r => r.id);
			const config = {
				scope: selectedScope,
				enabled: mainToggle.checked,
				enabledRuleIds: enabledRuleIds,
				approvalMode: document.getElementById('approvalMode').value,
				reviewerLoopEnabled: reviewerLoopToggle.checked,
				reviewerPassingScore: parseInt(document.getElementById('reviewerPassingScore').value) || 85,
				maxAutoRefactorRounds: parseInt(document.getElementById('maxAutoRefactorRounds').value) || 0,
				policyGateAutoFixRounds: parseInt(document.getElementById('policyGateAutoFixRounds').value) ?? 1,
			};

			// Validate
			if (config.reviewerPassingScore < 1 || config.reviewerPassingScore > 100) {
				showStatus('请输入 1 到 100 之间的整数分数。', 'error');
				return;
			}
			if (config.maxAutoRefactorRounds < 0) {
				showStatus('请输入大于等于 0 的整数轮数。', 'error');
				return;
			}
			if (config.policyGateAutoFixRounds < 0 || config.policyGateAutoFixRounds > 5) {
				showStatus('请输入 0 到 5 之间的整数。', 'error');
				return;
			}

			vscode.postMessage({ type: 'save', config: config });
		});

		// Reset button
		document.getElementById('resetBtn').addEventListener('click', function() {
			mainToggle.checked = initialConfig.enabled;
			mainToggle.dispatchEvent(new Event('change'));
			reviewerLoopToggle.checked = initialConfig.reviewerLoopEnabled;
			reviewerLoopToggle.dispatchEvent(new Event('change'));
			document.getElementById('approvalMode').value = initialConfig.approvalMode;
			document.getElementById('reviewerPassingScore').value = initialConfig.reviewerPassingScore;
			document.getElementById('maxAutoRefactorRounds').value = initialConfig.maxAutoRefactorRounds;
			document.getElementById('policyGateAutoFixRounds').value = initialConfig.policyGateAutoFixRounds ?? 1;

			// Reset rules
			rules.forEach((rule, index) => {
				const checkbox = document.querySelector(\`.rule-checkbox[data-index="\${index}"]\`);
				if (checkbox) {
					checkbox.checked = rule.enabled;
					const ruleItem = checkbox.closest('.rule-item');
					if (rule.enabled) {
						ruleItem.classList.remove('disabled');
					} else {
						ruleItem.classList.add('disabled');
					}
				}
			});

			showStatus('已恢复为初始配置', 'success');
		});

		// Cancel button
		document.getElementById('cancelBtn').addEventListener('click', function() {
			vscode.postMessage({ type: 'cancel' });
		});

		// Status message
		function showStatus(message, type) {
			const statusEl = document.getElementById('statusMessage');
			statusEl.textContent = message;
			statusEl.className = 'status-message ' + type;
			setTimeout(() => {
				statusEl.className = 'status-message';
			}, 3000);
		}

		// Handle messages from extension
		window.addEventListener('message', event => {
			const message = event.data;
			if (message.type === 'success') {
				showStatus(message.text, 'success');
			} else if (message.type === 'error') {
				showStatus(message.text, 'error');
			}
		});
	</script>
</body>
</html>`;
}

export interface ExecutionCheckpointConfigWebviewOptions {
	cspSource: string;
	config: ExecutionCheckpointConfigState;
	copy: {
		title: string;
	};
}