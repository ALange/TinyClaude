/**
 * Simple compression fallback — truncation with indicator.
 *
 * Ported from Headroom's _simple_compress fallback.
 * Used when no specialised compressor matches.
 */

// ── Config ───────────────────────────────────────────────────────────────────

export interface SimpleCompressorConfig {
	/** Target compression ratio (0–1). 0.3 = compress to 30% of original. */
	compressionRatio: number;
	/** Minimum text length to compress. Shorter text passes through. */
	minChars: number;
}

const DEFAULT_CONFIG: SimpleCompressorConfig = {
	compressionRatio: 0.3,
	minChars: 100,
};

// ── Types ────────────────────────────────────────────────────────────────────

export interface SimpleCompressionResult {
	compressed: string;
	originalChars: number;
	compressedChars: number;
	strategy: string;
}

// ── Compressor ───────────────────────────────────────────────────────────────

export class SimpleCompressor {
	private config: SimpleCompressorConfig;

	constructor(config: Partial<SimpleCompressorConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Compress text by truncating with an indicator marker.
	 *
	 * Keeps the first ~2/3 of the target and the last ~1/3, joined by
	 * a "[compressed]" marker so the LLM sees context from both ends.
	 */
	compress(content: string): SimpleCompressionResult {
		const originalChars = content.length;

		if (
			!content ||
			originalChars < this.config.minChars
		) {
			return {
				compressed: content,
				originalChars,
				compressedChars: originalChars,
				strategy: "passthrough",
			};
		}

		const targetLen = Math.max(
			50,
			Math.floor(originalChars * this.config.compressionRatio),
		);

		if (originalChars <= targetLen) {
			return {
				compressed: content,
				originalChars,
				compressedChars: originalChars,
				strategy: "passthrough",
			};
		}

		const keepStart = Math.floor(targetLen * 0.66);
		const keepEnd = targetLen - keepStart;

		const compressed =
			content.slice(0, keepStart) +
			"\n...[compressed]...\n" +
			content.slice(-keepEnd);

		return {
			compressed,
			originalChars,
			compressedChars: compressed.length,
			strategy: "truncation",
		};
	}
}
