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
			if (grepMatch) {
				currentFile = grepMatch[1];
			}
			if (!files.has(currentFile)) {
				files.set(currentFile, []);
			}
			files.get(currentFile)!.push(line);
		}

		const totalFiles = files.size;
		const totalMatches = lines.filter((l) => GREP_LINE.test(l)).length;

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
				if (grepMatch) {
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
