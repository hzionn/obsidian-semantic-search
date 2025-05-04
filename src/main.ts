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
	embeddings: Map<string, number[]> = new Map(); // Store embeddings for each note

	// onload is called when your plugin is loaded (enabled)
	async onload() {
		await this.loadSettings();

		let localModels: any = null;
		try {
			const response = await fetch("http://localhost:11434/api/tags");
			localModels = await response.json();
			if (Array.isArray(localModels.models)) {
				const modelNames = localModels.models.map(
					(model: { name: string }) => model.name
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

		// Only check chat model if it is set and available
		if (
			this.settings.chatModel &&
			this.settings.availableModels?.includes(this.settings.chatModel)
		) {
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
				console.log("Ollama /api/chat response:", data);
				if (data.error && data.error.includes("model")) {
					new Notice(
						`The requested model ${this.settings.chatModel} is not available in Ollama. Please pull or select a different model.`
					);
				} else if (data.message && data.message.content) {
					new Notice(data.message.content);
				} else {
					new Notice(
						"Ollama did not return a chat response. Please check your model and Ollama server."
					);
				}
			} catch (error) {
				new Notice("Failed to fetch from Ollama. Is the server running?");
			}
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

		// Create embeddings for all notes in the vault
		await this.createEmbeddingsForAllNotes();

		// Add a command to trigger the semantic search and display the results
		this.addCommand({
			id: "perform-semantic-search",
			name: "Perform Semantic Search",
			callback: async () => {
				const query = await this.getUserQuery();
				const results = await this.performSemanticSearch(query);
				this.displaySearchResults(results);
			},
		});
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
			// Create embeddings for each note
			const embedding = await this.createEmbeddingForNote(content);
			this.embeddings.set(file.path, embedding);
		}
		return results;
	}

	/**
	 * Creates embeddings for all notes in the vault.
	 */
	async createEmbeddingsForAllNotes() {
		const files = await this.traverseAndReadMarkdownFiles();
		for (const file of files) {
			const embedding = await this.createEmbeddingForNote(file.content);
			this.embeddings.set(file.path, embedding);
		}
	}

	/**
	 * Creates an embedding for a given note using the selected embedding model.
	 * @param noteContent The content of the note
	 * @returns Promise resolving to the embedding vector
	 */
	async createEmbeddingForNote(noteContent: string): Promise<number[]> {
		try {
			const response = await fetch("http://localhost:11434/api/embeddings", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: this.settings.embeddingModel,
					prompt: noteContent,
				}),
			});
			const data = await response.json();
			console.log("Embedding API response:", data);
			if (Array.isArray(data.embedding) && data.embedding.length > 0) {
				return data.embedding;
			} else {
				new Notice("Failed to create embedding for the note. " + JSON.stringify(data));
				return [];
			}
		} catch (error) {
			new Notice("Failed to fetch from Ollama. Is the server running?");
			return [];
		}
	}

	/**
	 * Performs semantic search using the embeddings and the input query.
	 * @param query The input query
	 * @returns Promise resolving to an array of search results
	 */
	async performSemanticSearch(query: string): Promise<{ path: string; score: number }[]> {
		const queryEmbedding = await this.createEmbeddingForNote(query);
		const results: { path: string; score: number }[] = [];
		for (const [path, embedding] of this.embeddings) {
			const score = this.calculateCosineSimilarity(queryEmbedding, embedding);
			results.push({ path, score });
		}
		results.sort((a, b) => b.score - a.score); // Sort results by score in descending order
		return results.slice(0, this.settings.maxNumberOfNotes); // Return top N results
	}

	/**
	 * Calculates the cosine similarity between two vectors.
	 * @param vec1 The first vector
	 * @param vec2 The second vector
	 * @returns The cosine similarity score
	 */
	calculateCosineSimilarity(vec1: number[], vec2: number[]): number {
		if (
			!Array.isArray(vec1) ||
			!Array.isArray(vec2) ||
			vec1.length === 0 ||
			vec2.length === 0 ||
			vec1.length !== vec2.length
		) {
			return 0;
		}
		const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
		const magnitude1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
		const magnitude2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
		if (magnitude1 === 0 || magnitude2 === 0) {
			return 0;
		}
		return dotProduct / (magnitude1 * magnitude2);
	}

	/**
	 * Prompts the user to enter a query for semantic search.
	 * @returns Promise resolving to the user's query
	 */
	async getUserQuery(): Promise<string> {
		return new Promise((resolve) => {
			const modal = new QueryModal(this.app, resolve);
			modal.open();
		});
	}

	/**
	 * Displays the search results to the user.
	 * @param results The search results
	 */
	displaySearchResults(results: { path: string; score: number }[]) {
		const resultText = results.map((result) => `${result.path} (score: ${result.score.toFixed(2)})`).join("\n");
		new Notice(`Search results:\n${resultText}`);
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

class QueryModal extends Modal {
	private resolve: (query: string) => void;

	constructor(app: App, resolve: (query: string) => void) {
		super(app);
		this.resolve = resolve;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Enter your search query" });

		const inputEl = contentEl.createEl("input", { type: "text" });
		inputEl.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				this.resolve(inputEl.value);
				this.close();
			}
		});

		const submitButton = contentEl.createEl("button", { text: "Search" });
		submitButton.addEventListener("click", () => {
			this.resolve(inputEl.value);
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
