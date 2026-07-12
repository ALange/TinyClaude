import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Logger } from "@tinyclaude/logger";
import type { AgentWorkspace } from "@tinyclaude/types";

const log = new Logger("WorkspacePersistence");

const WORKSPACES_FILE = join(homedir(), ".tinyclaude", "workspaces.json");

interface WorkspacesData {
	version: number;
	workspaces: AgentWorkspace[];
}

export class WorkspacePersistence {
	private readonly workspacesFile: string;

	/**
	 * @param options.workspacesFile Override for the persisted-workspaces
	 *   file path. Defaults to the real `~/.tinyclaude/workspaces.json`.
	 *   Tests MUST pass a tmp-dir path here (or via
	 *   `AgentRegistry.setWorkspacePersistenceForTests`) instead of relying
	 *   on the default — the default writes to the real file.
	 */
	constructor(options?: { workspacesFile?: string }) {
		this.workspacesFile = options?.workspacesFile ?? WORKSPACES_FILE;
	}

	async loadWorkspaces(): Promise<AgentWorkspace[]> {
		try {
			if (!existsSync(this.workspacesFile)) {
				log.debug("No workspaces file found");
				return [];
			}

			const content = await readFile(this.workspacesFile, "utf-8");
			const data: WorkspacesData = JSON.parse(content);

			if (data.version !== 1) {
				log.warn(`Unknown workspaces file version: ${data.version}`);
				return [];
			}

			log.info(`Loaded ${data.workspaces.length} workspaces from disk`);
			return data.workspaces;
		} catch (error) {
			log.error("Failed to load workspaces:", error);
			return [];
		}
	}

	async saveWorkspaces(workspaces: AgentWorkspace[]): Promise<void> {
		try {
			const data: WorkspacesData = {
				version: 1,
				workspaces,
			};

			const content = JSON.stringify(data, null, 2);

			// Ensure directory exists
			const dir = dirname(this.workspacesFile);
			if (!existsSync(dir)) {
				await mkdir(dir, { recursive: true });
			}

			await writeFile(this.workspacesFile, content, "utf-8");
			log.info(`Saved ${workspaces.length} workspaces to disk`);
		} catch (error) {
			log.error("Failed to save workspaces:", error);
		}
	}
}

export const workspacePersistence = new WorkspacePersistence();
