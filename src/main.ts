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

interface MyPluginSettings {
	maxNumberOfNotes: number;
	chatModel: string;
	embeddingModel: string;
	availableModels?: string[]; // store available models for dropdown
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	maxNumberOfNotes: 5,
	chatModel: "",
	embeddingModel: "",
	availableModels: [],
};

export default class SemanticSearchPlugin extends Plugin {
	settings: MyPluginSettings;

	// onload is called when your plugin is loaded (enabled)
	async onload() {
		await this.loadSettings();

		let localModels: any = null;
		try {
			const response = await fetch("http://localhost:11434/api/tags");
			localModels = await response.json();
			if (Array.isArray(localModels.models)) {
				const modelNames = localModels.models.map(
					(model) => model.name
				);
				this.settings.availableModels = modelNames;
				await this.saveSettings();
				new Notice(`Available models: ${modelNames.join(", ")}`);
			} else {
				this.settings.availableModels = [];
				await this.saveSettings();
				new Notice("No models found from Ollama.");
			}
		} catch (error) {
			this.settings.availableModels = [];
			await this.saveSettings();
			new Notice("Failed to fetch from Ollama. Is the server running?");
		}

		let data: any = null;
		try {
			const response = await fetch("http://localhost:11434/api/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: this.settings.chatModel,
					messages: [
						{ role: "user", content: "Why is the sky blue?" },
					],
				}),
			});
			data = await response.json();
			if (data.error && data.error.includes("model")) {
				new Notice(
					`The requested model ${this.settings.chatModel} is not available in Ollama. Please pull or select a different model.`
				);
			} else if (data.message && data.message.content) {
				new Notice(data.message.content);
			} else {
				new Notice("Received an unexpected response from Ollama.");
			}
		} catch (error) {
			new Notice("Failed to fetch from Ollama. Is the server running?");
		}

		// This creates an icon in the left ribbon.
		// Called when the user clicks the icon.
		const ribbonIconEl = this.addRibbonIcon(
			"experiment",
			"play with new functionality",
			async (evt: MouseEvent) => {
				const files = await this.traverseAndReadMarkdownFiles();
				const fileNames = files.map((f) => f.path).join("\n");
				const fileContents = files.map((f) => f.content).join("\n");
				new Notice(`Markdown files in vault:\n${fileNames}`);
				new Notice(`Contents of files:\n${fileContents}`);
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
	async traverseAndReadMarkdownFiles(): Promise<
		{ path: string; content: string }[]
	> {
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
			.setName("Chat Model")
			.setDesc("Model to use for chat")
			.addDropdown((dropdown) => {
				const models = this.plugin.settings.availableModels || [];
				if (models.length === 0) {
					dropdown.addOption("", "No models found");
				} else {
					for (const model of models) {
						dropdown.addOption(model, model);
					}
				}
				dropdown.setValue(this.plugin.settings.chatModel);
				dropdown.onChange(async (value) => {
					this.plugin.settings.chatModel = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Embedding Model")
			.setDesc("Model to use for embedding")
			.addDropdown((dropdown) => {
				const models = this.plugin.settings.availableModels || [];
				if (models.length === 0) {
					dropdown.addOption("", "No models found");
				} else {
					for (const model of models) {
						dropdown.addOption(model, model);
					}
				}
				dropdown.setValue(this.plugin.settings.embeddingModel);
				dropdown.onChange(async (value) => {
					this.plugin.settings.embeddingModel = value;
					await this.plugin.saveSettings();
				});
			});
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
