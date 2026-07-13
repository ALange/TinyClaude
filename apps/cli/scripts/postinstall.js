import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RELEASES_BASE_URL = "https://github.com/ALange/TinyClaude/releases";
const RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 750;

const scriptDir = dirname(fileURLToPath(import.meta.url));

function readPackageVersion() {
	const packageJsonPath = join(scriptDir, "..", "package.json");
	const raw = readFileSync(packageJsonPath, "utf8");
	const pkg = JSON.parse(raw);
	return pkg.version;
}

function resolveAsset(platform, arch) {
	const table = {
		"linux-x64": "tinyclaude-linux-amd64",
		"linux-arm64": "tinyclaude-linux-arm64",
		"darwin-x64": "tinyclaude-macos-x86_64",
		"darwin-arm64": "tinyclaude-macos-arm64",
		"win32-x64": "tinyclaude-windows-x64.exe",
	};

	const asset = table[`${platform}-${arch}`];
	if (!asset) {
		throw new UnsupportedPlatformError(platform, arch);
	}
	return asset;
}

class UnsupportedPlatformError extends Error {
	constructor(platform, arch) {
		super(
			`Unsupported platform/arch combination: platform="${platform}", arch="${arch}". ` +
				"Only the following combinations are supported: " +
				"linux/x64, linux/arm64, darwin/x64, darwin/arm64, win32/x64. " +
				`Please download a binary manually from ${RELEASES_BASE_URL}/latest.`,
		);
		this.name = "UnsupportedPlatformError";
	}
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

class NotFoundError extends Error {
	constructor(url, version) {
		super(
			`Download failed with HTTP status 404 Not Found for ${url}. ` +
				`The release/asset for version ${version} may not exist yet. ` +
				`Check https://github.com/ALange/TinyClaude/releases for available releases.`,
		);
		this.name = "NotFoundError";
	}
}

async function downloadWithRetry(url, version) {
	let lastError;
	for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
		try {
			const response = await fetch(url);
			if (response.status === 404) {
				throw new NotFoundError(url, version);
			}
			if (!response.ok) {
				throw new Error(
					`Download failed with HTTP status ${response.status} ${response.statusText} for ${url}`,
				);
			}
			const arrayBuffer = await response.arrayBuffer();
			return Buffer.from(arrayBuffer);
		} catch (error) {
			lastError = error;
			if (error instanceof NotFoundError) {
				throw error;
			}
			if (attempt < RETRY_ATTEMPTS) {
				console.error(
					`[postinstall] Download attempt ${attempt + 1} failed: ${error.message}. Retrying...`,
				);
				await sleep(RETRY_DELAY_MS);
			}
		}
	}
	throw lastError;
}

async function main() {
	const version = readPackageVersion();
	const platform = process.platform;
	const arch = process.arch;

	const asset = resolveAsset(platform, arch);
	const url = `${RELEASES_BASE_URL}/download/v${version}/${asset}`;

	console.log(
		`[postinstall] Downloading tinyclaude v${version} for ${platform}-${arch}...`,
	);
	console.log(`[postinstall] ${url}`);

	const bytes = await downloadWithRetry(url, version);

	if (!bytes || bytes.length === 0) {
		throw new Error(`Downloaded file for ${url} is empty.`);
	}

	const distDir = join(scriptDir, "..", "dist");
	mkdirSync(distDir, { recursive: true });

	const isWindows = platform === "win32";
	const finalDest = join(distDir, isWindows ? "tinyclaude.exe" : "tinyclaude");
	const tempDest = join(distDir, "tinyclaude.download");

	writeFileSync(tempDest, bytes);

	const stat = statSync(tempDest);
	if (stat.size === 0) {
		unlinkSync(tempDest);
		throw new Error(`Written file ${tempDest} is empty.`);
	}

	renameSync(tempDest, finalDest);

	if (!isWindows) {
		chmodSync(finalDest, 0o755);
	}

	console.log(`Downloaded tinyclaude v${version} (${platform}-${arch})`);
}

main().catch((error) => {
	console.error("[postinstall] Failed to download the tinyclaude binary.");
	console.error(error?.message ? error.message : error);
	process.exit(1);
});
