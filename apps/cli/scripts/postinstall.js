import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadBinary } from "./download-binary.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const isMonorepoCheckout = existsSync(join(scriptDir, "..", "src", "main.ts"));

if (isMonorepoCheckout) {
	console.log(
		"[postinstall] Running inside the tinyclaude monorepo (source checkout) — skipping binary download.",
	);
	process.exit(0);
}

downloadBinary({ scriptDir }).catch((error) => {
	console.error("[postinstall] Failed to download the tinyclaude binary.");
	console.error(error?.message ? error.message : error);
	process.exit(1);
});
