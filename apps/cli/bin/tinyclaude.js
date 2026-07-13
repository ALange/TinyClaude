#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === "win32";
const binPath = join(
	scriptDir,
	"..",
	"dist",
	isWindows ? "tinyclaude.exe" : "tinyclaude",
);

if (!existsSync(binPath)) {
	console.error(
		"tinyclaude binary not found — postinstall may not have completed. " +
			"Try: npm rebuild @adamlangepl/tc-proxy, or reinstall the package.",
	);
	process.exit(1);
}

const result = spawnSync(binPath, process.argv.slice(2), { stdio: "inherit" });

process.exit(result.status ?? (result.signal ? 1 : 0));
