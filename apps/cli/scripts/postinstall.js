import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadBinary } from "./download-binary.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));

downloadBinary({ scriptDir }).catch((error) => {
	console.error("[postinstall] Failed to download the tinyclaude binary.");
	console.error(error?.message ? error.message : error);
	process.exit(1);
});
