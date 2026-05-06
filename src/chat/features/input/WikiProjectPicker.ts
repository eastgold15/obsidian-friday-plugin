import { setIcon } from 'obsidian';
import type FridayPlugin from '../../../main';

export interface WikiProject {
	/** Internal project name, e.g. "How-wiki" */
	name: string;
	/** Human-readable label, e.g. "How wiki" */
	displayName: string;
}

export interface WikiProjectPickerOptions {
	onSelect: (project: WikiProject) => void;
}

/**
 * Renders a compact picklist button in the input toolbar.
 *
 * Button:  [How wiki ▾]
 * Dropdown shows:
 *   Current Project
 *     ✓  How wiki
 *   Recent
 *     —  AI wiki
 *     —  Startup wiki
 */
export class WikiProjectPicker {
	private buttonEl:    HTMLElement | null = null;
	private labelEl:     HTMLElement | null = null;
	private dropdownEl:  HTMLElement | null = null;
	private currentProject: WikiProject | null = null;
	private allProjects:    WikiProject[] = [];

	constructor(
		private readonly containerEl: HTMLElement,
		private readonly plugin: FridayPlugin,
		private readonly options: WikiProjectPickerOptions,
	) {}

	// ─── Public API ──────────────────────────────────────────────────────────

	/** Mount the button and pre-select the given project (if any). */
	async render(activeProjectName?: string | null): Promise<void> {
		await this.loadProjects();

		if (activeProjectName) {
			this.currentProject =
				this.allProjects.find(p => p.name === activeProjectName) ?? null;
		}

		this.buildButton();
	}

	/** Re-read project list from disk (call after /wiki @folder ingest). */
	async refresh(activeProjectName?: string | null): Promise<void> {
		await this.loadProjects();

		if (activeProjectName) {
			this.currentProject =
				this.allProjects.find(p => p.name === activeProjectName) ?? null;
		} else if (
			this.currentProject &&
			!this.allProjects.find(p => p.name === this.currentProject?.name)
		) {
			// Current project was deleted
			this.currentProject = null;
		}

		this.updateButtonLabel();
	}

	/** Programmatically set the active project (called by ChatView). */
	setActiveProject(project: WikiProject | null): void {
		this.currentProject = project;
		this.updateButtonLabel();
	}

	getActiveProject(): WikiProject | null {
		return this.currentProject;
	}

	destroy(): void {
		this.closeDropdown();
		this.buttonEl?.remove();
		this.buttonEl = null;
	}

	// ─── Private: data ────────────────────────────────────────────────────────

	private async loadProjects(): Promise<void> {
		if (!this.plugin.foundryProjectService) return;

		try {
			const result = await this.plugin.foundryProjectService.listProjects(
				this.plugin.absWorkspacePath,
			);
			if (result.success && Array.isArray(result.data)) {
				this.allProjects = (result.data as any[])
					.filter(p => p.type === 'wiki')
					.map(p => ({
						name:        p.name as string,
						displayName: this.toDisplayName(p.name as string),
					}));
			}
		} catch {
			// Service not yet ready — silently ignore
		}
	}

	/** "How-wiki" → "How wiki",  "my-notes-wiki" → "my notes wiki" */
	private toDisplayName(projectName: string): string {
		return projectName
			.replace(/-wiki$/, ' wiki')
			.replace(/-/g, ' ');
	}

	// ─── Private: DOM ────────────────────────────────────────────────────────

	private buildButton(): void {
		this.buttonEl = this.containerEl.createDiv({ cls: 'friday-wiki-picker-btn' });
		this.labelEl  = this.buttonEl.createSpan({
			cls:  'friday-wiki-picker-label',
			text: this.currentProject?.displayName ?? this.plugin.i18n.t('chat.picker_no_project'),
		});
		const chevron = this.buttonEl.createSpan({ cls: 'friday-wiki-picker-chevron' });
		setIcon(chevron, 'chevron-down');

		this.buttonEl.addEventListener('click', e => {
			e.stopPropagation();
			if (this.dropdownEl) {
				this.closeDropdown();
			} else {
				this.openDropdown();
			}
		});
	}

	private updateButtonLabel(): void {
		if (this.labelEl) {
			this.labelEl.textContent =
				this.currentProject?.displayName ?? this.plugin.i18n.t('chat.picker_no_project');
		}
	}

	private openDropdown(): void {
		if (!this.buttonEl) return;

		this.dropdownEl = document.body.createDiv({ cls: 'friday-wiki-picker-dropdown' });

		if (this.allProjects.length === 0) {
			this.dropdownEl.createDiv({
				cls:  'friday-wiki-picker-empty',
				text: this.plugin.i18n.t('chat.picker_empty'),
			});
		} else {
			// ── Current project section ────────────────────────────────────
			if (this.currentProject) {
				this.buildSection(
					this.dropdownEl,
					this.plugin.i18n.t('chat.picker_current'),
					[this.currentProject],
					true,
				);
			}

			// ── Recent (all other wiki projects) ──────────────────────────
			const others = this.allProjects.filter(
				p => p.name !== this.currentProject?.name,
			);

			// Sort by most-recently-used using the saved recency list
			const recency = this.getRecencyList();
			others.sort((a, b) => {
				const ai = recency.indexOf(a.name);
				const bi = recency.indexOf(b.name);
				if (ai === -1 && bi === -1) return 0;
				if (ai === -1) return 1;
				if (bi === -1) return -1;
				return ai - bi;
			});

			if (others.length > 0) {
				this.buildSection(
					this.dropdownEl,
					this.plugin.i18n.t('chat.picker_recent'),
					others,
					false,
				);
			}
		}

		this.positionDropdown();

		// Close on any outside click (deferred so this click doesn't immediately close it)
		setTimeout(() => {
			document.addEventListener('click', this.onOutsideClick);
		}, 0);
	}

	private buildSection(
		parent: HTMLElement,
		label:    string,
		projects: WikiProject[],
		isActive: boolean,
	): void {
		const section = parent.createDiv({ cls: 'friday-wiki-picker-section' });
		section.createDiv({ cls: 'friday-wiki-picker-section-label', text: label });

		for (const project of projects) {
			const item = section.createDiv({
				cls: 'friday-wiki-picker-item' + (isActive ? ' friday-wiki-picker-item--active' : ''),
			});

			const iconEl = item.createSpan({ cls: 'friday-wiki-picker-item-icon' });
			if (isActive) {
				setIcon(iconEl, 'check');
			} else {
				iconEl.setText('–');
			}

			item.createSpan({ cls: 'friday-wiki-picker-item-name', text: project.displayName });

			if (!isActive) {
				item.addEventListener('click', () => {
					this.selectProject(project);
					this.closeDropdown();
				});
			}
		}
	}

	private positionDropdown(): void {
		if (!this.buttonEl || !this.dropdownEl) return;

		const rect = this.buttonEl.getBoundingClientRect();
		Object.assign(this.dropdownEl.style, {
			position:  'fixed',
			bottom:    `${window.innerHeight - rect.top + 6}px`,
			left:      `${rect.left}px`,
			minWidth:  `${Math.max(rect.width, 200)}px`,
			zIndex:    '9999',
		});
	}

	private readonly onOutsideClick = (): void => {
		this.closeDropdown();
	};

	private closeDropdown(): void {
		if (this.dropdownEl) {
			this.dropdownEl.remove();
			this.dropdownEl = null;
		}
		document.removeEventListener('click', this.onOutsideClick);
	}

	private selectProject(project: WikiProject): void {
		this.currentProject = project;
		this.updateButtonLabel();
		this.saveRecency(project.name);
		this.options.onSelect(project);
	}

	// ─── Private: persistence ─────────────────────────────────────────────────

	private getRecencyList(): string[] {
		return (this.plugin.settings as any).recentWikiProjects ?? [];
	}

	private saveRecency(projectName: string): void {
		const s = this.plugin.settings as any;
		const list: string[] = s.recentWikiProjects ?? [];
		const updated = [projectName, ...list.filter((n: string) => n !== projectName)].slice(0, 10);
		s.recentWikiProjects = updated;
		this.plugin.saveSettings().catch(() => {});
	}
}
