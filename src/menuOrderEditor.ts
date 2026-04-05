export interface HarnessMenuOrderEditorItem {
	target: string;
	label: string;
	description: string;
}

export interface HarnessMenuOrderEditorCopy {
	title: string;
	description: string;
	instructions: string;
	unsavedChanges: string;
	save: string;
	cancel: string;
	reset: string;
	positionLabel: (current: number, total: number) => string;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function createNonce(): string {
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeHarnessMenuOrderEditorPayload(
	value: unknown,
	validTargets: readonly string[],
): string[] | undefined {
	if (!Array.isArray(value) || value.length !== validTargets.length) {
		return undefined;
	}

	const expected = new Set(validTargets);
	const orderedTargets: string[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (typeof item !== 'string' || !expected.has(item) || seen.has(item)) {
			return undefined;
		}
		seen.add(item);
		orderedTargets.push(item);
	}

	return seen.size === expected.size ? orderedTargets : undefined;
}

export function buildHarnessMenuOrderEditorHtml(options: {
	cspSource: string;
	items: readonly HarnessMenuOrderEditorItem[];
	copy: HarnessMenuOrderEditorCopy;
}): string {
	const nonce = createNonce();
	const payload = JSON.stringify({
		items: options.items,
		copy: {
			...options.copy,
			positionLabels: options.items.map((_, index) => options.copy.positionLabel(index + 1, options.items.length)),
		},
	});
	const itemCount = options.items.length;

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${options.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>${escapeHtml(options.copy.title)}</title>
	<style>
		:root {
			color-scheme: light dark;
			font-family: var(--vscode-font-family);
		}
		body {
			margin: 0;
			padding: 24px;
			background:
				radial-gradient(circle at top left, color-mix(in srgb, var(--vscode-button-background) 14%, transparent) 0%, transparent 38%),
				linear-gradient(180deg, var(--vscode-editor-background) 0%, color-mix(in srgb, var(--vscode-sideBar-background) 55%, var(--vscode-editor-background)) 100%);
			color: var(--vscode-editor-foreground);
		}
		.shell {
			max-width: 880px;
			margin: 0 auto;
			padding: 24px;
			border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, transparent);
			border-radius: 20px;
			background: color-mix(in srgb, var(--vscode-editor-background) 92%, transparent);
			box-shadow: 0 18px 48px rgba(0, 0, 0, 0.18);
		}
		h1 {
			margin: 0;
			font-size: 28px;
			line-height: 1.2;
		}
		p.lead {
			margin: 10px 0 0;
			color: var(--vscode-descriptionForeground);
			font-size: 14px;
			line-height: 1.6;
		}
		.toolbar {
			display: flex;
			justify-content: space-between;
			gap: 16px;
			align-items: center;
			margin-top: 24px;
			padding: 14px 16px;
			border-radius: 16px;
			background: color-mix(in srgb, var(--vscode-sideBar-background) 78%, transparent);
			border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 60%, transparent);
		}
		.status {
			font-size: 13px;
			color: var(--vscode-descriptionForeground);
		}
		.status.dirty {
			color: var(--vscode-inputValidation-warningForeground);
		}
		.actions {
			display: flex;
			gap: 10px;
			flex-wrap: wrap;
		}
		button {
			border: none;
			border-radius: 999px;
			padding: 10px 18px;
			font: inherit;
			cursor: pointer;
			transition: transform 120ms ease, opacity 120ms ease, background 120ms ease;
		}
		button:hover {
			transform: translateY(-1px);
		}
		button:disabled {
			opacity: 0.5;
			cursor: default;
			transform: none;
		}
		button.primary {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}
		button.secondary {
			background: color-mix(in srgb, var(--vscode-button-secondaryBackground) 84%, transparent);
			color: var(--vscode-button-secondaryForeground);
		}
		ol.order-list {
			list-style: none;
			padding: 0;
			margin: 20px 0 0;
			display: grid;
			gap: 12px;
		}
		li.menu-card {
			display: grid;
			grid-template-columns: auto 1fr auto;
			gap: 14px;
			align-items: center;
			padding: 16px 18px;
			border-radius: 18px;
			border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, transparent);
			background: color-mix(in srgb, var(--vscode-editorWidget-background) 76%, transparent);
			cursor: grab;
			user-select: none;
		}
		li.menu-card.dragging {
			opacity: 0.45;
			transform: scale(0.985);
		}
		li.menu-card.drop-before {
			box-shadow: inset 0 4px 0 var(--vscode-focusBorder);
		}
		li.menu-card.drop-after {
			box-shadow: inset 0 -4px 0 var(--vscode-focusBorder);
		}
		.handle {
			font-size: 22px;
			letter-spacing: -3px;
			color: var(--vscode-descriptionForeground);
		}
		.card-copy {
			display: grid;
			gap: 4px;
		}
		.card-copy strong {
			font-size: 15px;
		}
		.card-copy span {
			font-size: 13px;
			line-height: 1.5;
			color: var(--vscode-descriptionForeground);
		}
		.position {
			padding: 6px 12px;
			border-radius: 999px;
			font-size: 12px;
			background: color-mix(in srgb, var(--vscode-badge-background) 72%, transparent);
			color: var(--vscode-badge-foreground);
		}
		.footer-note {
			margin-top: 18px;
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
		}
		@media (max-width: 720px) {
			body {
				padding: 12px;
			}
			.shell {
				padding: 18px;
			}
			.toolbar {
				flex-direction: column;
				align-items: stretch;
			}
			.actions {
				justify-content: stretch;
			}
			.actions button {
				flex: 1 1 0;
			}
			li.menu-card {
				grid-template-columns: auto 1fr;
			}
			.position {
				grid-column: 1 / -1;
				justify-self: start;
			}
		}
	</style>
</head>
<body>
	<div class="shell">
		<h1>${escapeHtml(options.copy.title)}</h1>
		<p class="lead">${escapeHtml(options.copy.description)}</p>
		<div class="toolbar">
			<div id="status" class="status">${escapeHtml(options.copy.instructions)}</div>
			<div class="actions">
				<button id="resetButton" class="secondary" disabled>${escapeHtml(options.copy.reset)}</button>
				<button id="cancelButton" class="secondary">${escapeHtml(options.copy.cancel)}</button>
				<button id="saveButton" class="primary" disabled>${escapeHtml(options.copy.save)}</button>
			</div>
		</div>
		<ol id="orderList" class="order-list" aria-label="menu order editor"></ol>
		<p class="footer-note">${escapeHtml(itemCount > 0 ? options.copy.positionLabel(1, itemCount) : options.copy.positionLabel(0, 0))}</p>
	</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const payload = ${payload};
		const initialItems = payload.items.map(item => ({ ...item }));
		let currentItems = payload.items.map(item => ({ ...item }));
		let draggedTarget = undefined;
		let dirty = false;

		const orderList = document.getElementById('orderList');
		const statusNode = document.getElementById('status');
		const saveButton = document.getElementById('saveButton');
		const cancelButton = document.getElementById('cancelButton');
		const resetButton = document.getElementById('resetButton');

		function isSameOrder(left, right) {
			return left.length === right.length && left.every((item, index) => item.target === right[index].target);
		}

		function setDirty(nextDirty) {
			dirty = nextDirty;
			statusNode.textContent = dirty ? payload.copy.unsavedChanges : payload.copy.instructions;
			statusNode.classList.toggle('dirty', dirty);
			saveButton.disabled = !dirty;
			resetButton.disabled = !dirty;
		}

		function reorderItem(dragTarget, hoverTarget, placeAfter) {
			if (!dragTarget || dragTarget === hoverTarget) {
				return;
			}
			const nextItems = currentItems.slice();
			const fromIndex = nextItems.findIndex(item => item.target === dragTarget);
			const hoverIndex = nextItems.findIndex(item => item.target === hoverTarget);
			if (fromIndex < 0 || hoverIndex < 0) {
				return;
			}
			const [moved] = nextItems.splice(fromIndex, 1);
			const nextHoverIndex = nextItems.findIndex(item => item.target === hoverTarget);
			const insertIndex = placeAfter ? nextHoverIndex + 1 : nextHoverIndex;
			nextItems.splice(insertIndex, 0, moved);
			currentItems = nextItems;
			setDirty(!isSameOrder(currentItems, initialItems));
			render();
		}

		function clearDropMarkers() {
			for (const card of orderList.querySelectorAll('.menu-card')) {
				card.classList.remove('drop-before', 'drop-after');
			}
		}

		function createCard(item, index) {
			const card = document.createElement('li');
			card.className = 'menu-card';
			card.draggable = true;
			card.dataset.target = item.target;
			card.innerHTML = [
				'<div class="handle" aria-hidden="true">⋮⋮</div>',
				'<div class="card-copy">',
					'<strong>' + item.label + '</strong>',
					'<span>' + item.description + '</span>',
				'</div>',
				'<div class="position">' + payload.copy.positionLabels[index] + '</div>',
			].join('');

			card.addEventListener('dragstart', event => {
				draggedTarget = item.target;
				card.classList.add('dragging');
				event.dataTransfer.effectAllowed = 'move';
				event.dataTransfer.setData('text/plain', item.target);
			});

			card.addEventListener('dragend', () => {
				draggedTarget = undefined;
				card.classList.remove('dragging');
				clearDropMarkers();
			});

			card.addEventListener('dragover', event => {
				event.preventDefault();
				const bounds = card.getBoundingClientRect();
				const placeAfter = event.clientY >= bounds.top + bounds.height / 2;
				clearDropMarkers();
				card.classList.add(placeAfter ? 'drop-after' : 'drop-before');
			});

			card.addEventListener('dragleave', event => {
				if (event.relatedTarget instanceof HTMLElement && card.contains(event.relatedTarget)) {
					return;
				}
				card.classList.remove('drop-before', 'drop-after');
			});

			card.addEventListener('drop', event => {
				event.preventDefault();
				const bounds = card.getBoundingClientRect();
				const placeAfter = event.clientY >= bounds.top + bounds.height / 2;
				clearDropMarkers();
				reorderItem(draggedTarget, item.target, placeAfter);
			});

			return card;
		}

		function render() {
			orderList.innerHTML = '';
			currentItems.forEach((item, index) => {
				orderList.appendChild(createCard(item, index));
			});
		}

		orderList.addEventListener('dragover', event => {
			event.preventDefault();
			if (event.target === orderList && currentItems.length > 0) {
				clearDropMarkers();
				const lastCard = orderList.lastElementChild;
				if (lastCard) {
					lastCard.classList.add('drop-after');
				}
			}
		});

		orderList.addEventListener('drop', event => {
			if (event.target !== orderList || currentItems.length === 0) {
				return;
			}
			event.preventDefault();
			clearDropMarkers();
			const lastItem = currentItems[currentItems.length - 1];
			if (lastItem) {
				reorderItem(draggedTarget, lastItem.target, true);
			}
		});

		saveButton.addEventListener('click', () => {
			vscode.postMessage({
				type: 'save',
				order: currentItems.map(item => item.target),
			});
		});

		cancelButton.addEventListener('click', () => {
			vscode.postMessage({ type: 'cancel' });
		});

		resetButton.addEventListener('click', () => {
			currentItems = initialItems.map(item => ({ ...item }));
			setDirty(false);
			render();
		});

		setDirty(false);
		render();
	</script>
</body>
</html>`;
}
