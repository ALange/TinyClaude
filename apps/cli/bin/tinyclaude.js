#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadBinary } from "../scripts/download-binary.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === "win32";
const binPath = join(
	scriptDir,
	"..",
	"dist",
	isWindows ? "tinyclaude.exe" : "tinyclaude",
);

async function main() {
	if (!existsSync(binPath)) {
		// postinstall may not have run (e.g. `bun install -g` blocks lifecycle
		// scripts for untrusted packages by default) or may have failed. Fall
		// back to downloading the binary lazily so the CLI is self-sufficient.
		console.error(
			"tinyclaude: binary not found, downloading now (first run)...",
		);
		try {
			await downloadBinary({ scriptDir });
		} catch (error) {
			console.error("tinyclaude: failed to download the binary.");
			console.error(error?.message ? error.message : error);
			process.exit(1);
		}
	}

	const result = spawnSync(binPath, process.argv.slice(2), {
		stdio: "inherit",
	});

	if (result.error) {
		console.error(
			`tinyclaude: failed to launch binary: ${result.error.message}`,
		);
		process.exit(1);
	}

	process.exit(result.status ?? (result.signal ? 1 : 0));
}

main();
