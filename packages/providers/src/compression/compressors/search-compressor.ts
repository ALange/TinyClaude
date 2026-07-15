/**
 * Search result compressor — ported from Headroom's SearchCompressor pattern.
 *
 * Preserves file paths, line numbers, and match snippets while compressing
 * search/grep results.
 */

// ── Config ───────────────────────────────────────────────────────────────────

export interface SearchCompressorConfig {
	/** Max results to keep. */
	maxResults: number;
	/** Max lines per file to keep. */
	maxLinesPerFile: number;
	/** Truncate snippet length. */
	maxSnippetChars: number;
}

const DEFAULT_CONFIG: SearchCompressorConfig = {
	maxResults: 30,
	maxLinesPerFile: 10,
	maxSnippetChars: 200,
};

// ── Types ────────────────────────────────────────────────────────────────────

export interface SearchCompressionResult {
	compressed: string;
	originalFiles: number;
	compressedFiles: number;
	originalMatches: number;
	compressedMatches: number;
	strategy: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Match a typical grep/ripgrep output line: "file:line:content" or "file:line:col:content". */
const GREP_LINE = /^(\S+?):(\d+)(?::(\d+))?:(.*)$/;

/** Common file extensions that appear in grep/ripgrep results. */
const COMMON_FILE_EXT = /\.(?:ts|js|tsx|jsx|mjs|cjs|mts|cts|py|rb|go|rs|java|kt|swift|c|cpp|h|hpp|cs|json|yaml|yml|toml|xml|html|css|scss|md|txt|log|sh|bash|sql|proto|gradle|dart|lua|php|r|scala|zig|nim|ex|exs)$/i;

/** Maximum plausible line number for grep results. */
const MAX_LINE_NUMBER = 100_000;

/** Validate a GREP_LINE match looks like a real grep/ripgrep result (not a URL, timestamp, etc.). */
function isPlausibleGrepMatch(m: RegExpExecArray): boolean {
	const lineNum = parseInt(m[2], 10);
	if (isNaN(lineNum) || lineNum < 1 || lineNum > MAX_LINE_NUMBER) return false;
	const path = m[1];
	// Accept file paths with directory separators or known file extensions
	return path.includes("/") || COMMON_FILE_EXT.test(path);
}

/** Match a file header like "path/to/file:" or "── file ──". */
const FILE_HEADER = /^──\s(.+)\s──$/;

// ── Compressor ───────────────────────────────────────────────────────────────

export class SearchCompressor {
	private config: SearchCompressorConfig;

	constructor(config: Partial<SearchCompressorConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Compress search/grep results.
	 */
	compress(content: string): SearchCompressionResult {
		const lines = content.split("\n");

		// Group lines by file
		const files = new Map<string, string[]>();
		let currentFile = "__stdin__";

		for (const line of lines) {
			const headerMatch = FILE_HEADER.exec(line);
			if (headerMatch) {
				currentFile = headerMatch[1];
				continue;
			}
			const grepMatch = GREP_LINE.exec(line);
			if (grepMatch && isPlausibleGrepMatch(grepMatch)) {
				currentFile = grepMatch[1];
			}
			if (!files.has(currentFile)) {
				files.set(currentFile, []);
			}
			files.get(currentFile)!.push(line);
		}

		const totalFiles = files.size;
		const totalMatches = lines.filter((l) => {
	const m = GREP_LINE.exec(l);
	return m !== null && isPlausibleGrepMatch(m);
}).length;

		// Truncate lines per file
		for (const [file, fileLines] of files) {
			if (fileLines.length > this.config.maxLinesPerFile) {
				const half = Math.floor(this.config.maxLinesPerFile / 2);
				files.set(file, [
					...fileLines.slice(0, half),
					`...[${fileLines.length - this.config.maxLinesPerFile} more matches]...`,
					...fileLines.slice(-(this.config.maxLinesPerFile - half)),
				]);
			}
		}

		// Truncate files
		let sortedFiles = [...files.entries()];
		let truncatedFiles: Array<[string, string[]]>;

		if (sortedFiles.length <= this.config.maxResults) {
			truncatedFiles = sortedFiles;
		} else {
			const half = Math.floor(this.config.maxResults / 2);
			truncatedFiles = [
				...sortedFiles.slice(0, half),
				[
					`...[${sortedFiles.length - this.config.maxResults} more files]...`,
					[],
				],
				...sortedFiles.slice(-(this.config.maxResults - half)),
			];
		}

		// Truncate individual snippets
		const resultLines: string[] = [];
		let compressedMatches = 0;
		for (const [file, fileLines] of truncatedFiles) {
			if (fileLines.length === 0) {
				resultLines.push(file);
				continue;
			}
			for (const line of fileLines) {
				const grepMatch = GREP_LINE.exec(line);
				if (grepMatch && isPlausibleGrepMatch(grepMatch)) {
					const snippet = grepMatch[4];
					if (snippet.length > this.config.maxSnippetChars) {
						compressedMatches++;
						resultLines.push(
							`${grepMatch[1]}:${grepMatch[2]}:${snippet.slice(0, this.config.maxSnippetChars)}...[truncated]`,
						);
					} else {
						resultLines.push(line);
					}
				} else {
					resultLines.push(line);
				}
			}
		}

		return {
			compressed: resultLines.join("\n"),
			originalFiles: totalFiles,
			compressedFiles: truncatedFiles.length,
			originalMatches: totalMatches,
			compressedMatches: totalMatches - compressedMatches,
			strategy: "search_preserve_paths",
		};
	}
}
