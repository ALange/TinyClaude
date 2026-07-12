/**
 * Log compressor — ported from Headroom's LogCompressor pattern.
 *
 * Preserves timestamps, log levels, and error messages while compressing
 * repetitive log bodies.
 */

// ── Config ───────────────────────────────────────────────────────────────────

export interface LogCompressorConfig {
	/** Max lines to keep. */
	maxLines: number;
	/** Preserve lines matching these patterns (e.g., ERROR, FATAL). */
	preserveLevels: string[];
	/** Compress repeating identical lines into a count. */
	deduplicate: boolean;
}

const DEFAULT_CONFIG: LogCompressorConfig = {
	maxLines: 100,
	preserveLevels: ["ERROR", "FATAL", "WARN", "error", "Error"],
	deduplicate: true,
};

// ── Types ────────────────────────────────────────────────────────────────────

export interface LogCompressionResult {
	compressed: string;
	originalLines: number;
	compressedLines: number;
	strategy: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TIMESTAMP_PATTERN =
	/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/;
const LOG_LEVEL_PATTERN =
	/\b(TRACE|DEBUG|INFO|WARN|ERROR|FATAL|WARNING|CRITICAL)\b/;

// ── Compressor ───────────────────────────────────────────────────────────────

export class LogCompressor {
	private config: LogCompressorConfig;

	constructor(config: Partial<LogCompressorConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Compress log content.
	 */
	compress(content: string): LogCompressionResult {
		const lines = content.split("\n");
		const totalLines = lines.length;

		// Classify lines
		const priorityLines: string[] = [];
		const normalLines: string[] = [];

		for (const line of lines) {
			if (this._isPriorityLine(line)) {
				priorityLines.push(line);
			} else {
				normalLines.push(line);
			}
		}

		// Deduplicate normal lines if configured
		let compressedNormal: string[];
		if (this.config.deduplicate) {
			compressedNormal = this._deduplicateLines(normalLines);
		} else {
			compressedNormal = normalLines;
		}

		// Truncate normal lines to fit within maxLines (including priority lines)
		const budget = Math.max(
			10,
			this.config.maxLines - priorityLines.length,
		);

		let finalNormal: string[];
		if (compressedNormal.length <= budget) {
			finalNormal = compressedNormal;
		} else {
			// Keep first half + last half
			const half = Math.floor(budget / 2);
			finalNormal = [
				...compressedNormal.slice(0, half),
				`...[${compressedNormal.length - budget} log lines compressed]...`,
				...compressedNormal.slice(-(budget - half)),
			];
		}

		const result = [...priorityLines, ...finalNormal];
		return {
			compressed: result.join("\n"),
			originalLines: totalLines,
			compressedLines: result.length,
			strategy: "log_preserve_levels",
		};
	}

	private _isPriorityLine(line: string): boolean {
		return (
			this.config.preserveLevels.some((level) => line.includes(level)) ||
			TIMESTAMP_PATTERN.test(line)
		);
	}

	private _deduplicateLines(lines: string[]): string[] {
		const result: string[] = [];
		let count = 0;
		let prev = "";

		for (const line of lines) {
			if (line === prev) {
				count++;
				continue;
			}
			if (count > 1) {
				// Replace the previous line with a deduplicated version
				result.pop();
				result.push(`[${count}x] ${prev}`);
			} else if (count === 1) {
				result.push(prev);
			}
			prev = line;
			count = 1;
		}
		// Handle last group
		if (count > 1) {
			result.pop();
			result.push(`[${count}x] ${prev}`);
		} else if (count === 1) {
			result.push(prev);
		}

		return result;
	}
}
