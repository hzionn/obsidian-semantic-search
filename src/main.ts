import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	mySetting: string;
	maxNumberOfNotes: number;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: "default",
	maxNumberOfNotes: 5,
};

export default class SemanticSearchPlugin extends Plugin {
	settings: MyPluginSettings;

	// onload is called when your plugin is loaded (enabled)
	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon(
			"dice",
			"Sample Plugin",
			async (evt: MouseEvent) => {
				// Called when the user clicks the icon.
				const files = await this.traverseAndReadMarkdownFiles();
				const fileList = files.map(f => f.path).join("\n");
				new Notice(`Markdown files in vault:\n${fileList}`);
			}
		);

		// Perform additional things with the ribbon
		ribbonIconEl.addClass("my-plugin-ribbon-class");

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText("Status Bar Text");

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: "open-sample-modal-simple",
			name: "Open sample modal (simple)",
			callback: () => {
				new SampleModal(this.app).open();
			},
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: "sample-editor-command",
			name: "Sample editor command",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection("Sample Editor Command");
			},
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: "open-sample-modal-complex",
			name: "Open sample modal (complex)",
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, "click", (evt: MouseEvent) => {
			console.log("click", evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(
			window.setInterval(() => console.log("setInterval"), 5 * 60 * 1000)
		);
	}

	// onunload is called when your plugin is disabled
	// to clean up any used resources to avoid affecting the performance of Obsidian
	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * Traverses all markdown files in the vault and reads their contents.
	 * @returns Promise resolving to an array of objects with file path and content
	 */
	async traverseAndReadMarkdownFiles(): Promise<{ path: string; content: string }[]> {
		const markdownFiles = this.app.vault.getMarkdownFiles();
		const results: { path: string; content: string }[] = [];
		for (const file of markdownFiles) {
			const content = await this.app.vault.read(file);
			results.push({ path: file.path, content });
		}
		return results;
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText("Woah!");
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: SemanticSearchPlugin;

	constructor(app: App, plugin: SemanticSearchPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Setting #1")
			.setDesc("It's a secret")
			.addText((text) =>
				text
					.setPlaceholder("Enter your secret")
					.setValue(this.plugin.settings.mySetting)
					.onChange(async (value) => {
						this.plugin.settings.mySetting = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Max Number of Notes")
			.setDesc("Maximum number of notes to show in the search panel")
			.addText((text) =>
				text
					.setPlaceholder("e.g. 5")
					.setValue(this.plugin.settings.maxNumberOfNotes.toString())
					.onChange(async (value) => {
						const numValue = parseInt(value);
						if (!isNaN(numValue) && numValue > 0) {
							this.plugin.settings.maxNumberOfNotes = numValue;
							await this.plugin.saveSettings();
						} else {
							new Notice(
								"Please enter a valid number greater than 0"
							);
						}
					})
			);
	}
}
