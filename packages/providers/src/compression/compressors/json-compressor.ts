/**
 * JSON compressor — ported from Headroom's SmartCrusher pattern.
 *
 * Preserves JSON structure (keys, array brackets) while compressing values.
 * For arrays of objects, samples a subset of items.
 */

// ── Config ───────────────────────────────────────────────────────────────────

export interface JSONCompressorConfig {
	/** Max items to keep in arrays (0 = keep all). */
	maxItems: number;
	/** Preserve these field names exactly. */
	preserveFields: string[];
	/** Compression ratio target (0–1) for long string values. */
	compressionRatio: number;
	/** Whether to preserve field names (keys). */
	preserveKeys: boolean;
}

const DEFAULT_CONFIG: JSONCompressorConfig = {
	maxItems: 15,
	preserveFields: ["id", "name", "type", "status", "error", "message"],
	compressionRatio: 0.3,
	preserveKeys: true,
};

// ── Types ────────────────────────────────────────────────────────────────────

export interface JSONCompressionResult {
	compressed: string;
	originalItems: number;
	compressedItems: number;
	strategy: string;
}

// ── Compressor ───────────────────────────────────────────────────────────────

export class JSONCompressor {
	private config: JSONCompressorConfig;

	constructor(config: Partial<JSONCompressorConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Compress JSON content while preserving structure.
	 */
	compress(content: string): JSONCompressionResult {
		let parsed: unknown;
		try {
			parsed = JSON.parse(content);
		} catch {
			// Not valid JSON — pass through
			return {
				compressed: content,
				originalItems: 0,
				compressedItems: 0,
				strategy: "passthrough",
			};
		}

		if (Array.isArray(parsed)) {
			return this._compressArray(parsed, content);
		}

		if (typeof parsed === "object" && parsed !== null) {
			const compressed = this._compressObject(
				parsed as Record<string, unknown>,
			);
			return {
				compressed: JSON.stringify(compressed),
				originalItems: 1,
				compressedItems: 1,
				strategy: "object_preserve_keys",
			};
		}

		// Primitive JSON — just stringify
		return {
			compressed: JSON.stringify(parsed),
			originalItems: 1,
			compressedItems: 1,
			strategy: "passthrough",
		};
	}

	private _compressArray(
		arr: unknown[],
		originalContent: string,
	): JSONCompressionResult {
		const totalItems = arr.length;

		if (totalItems <= this.config.maxItems) {
			return {
				compressed: JSON.stringify(arr),
				originalItems: totalItems,
				compressedItems: totalItems,
				strategy: "full",
			};
		}

		// Sample items: keep first N/2 and last N/2
		const half = Math.floor(this.config.maxItems / 2);
		const firstHalf = arr.slice(0, half);
		const lastHalf = arr.slice(-(this.config.maxItems - half));

		// Compress each item
		const compressed = [
			...firstHalf.map((item) => this._compressValue(item)),
			"...", // compression marker
			...lastHalf.map((item) => this._compressValue(item)),
		];

		const resultContent = JSON.stringify(compressed);

		return {
			compressed: resultContent,
			originalItems: totalItems,
			compressedItems: compressed.length,
			strategy: `sampled_${this.config.maxItems}`,
		};
	}

	private _compressObject(
		obj: Record<string, unknown>,
	): Record<string, unknown> {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj)) {
			if (this.config.preserveKeys) {
				if (Array.isArray(value)) {
					result[key] = this._compressArrayValue(key, value);
				} else if (typeof value === "string") {
					result[key] = this._compressString(key, value);
				} else if (typeof value === "object" && value !== null) {
					result[key] = this._compressObject(
						value as Record<string, unknown>,
					);
				} else {
					result[key] = value;
				}
			} else {
				result[key] = value;
			}
		}
		return result;
	}

	private _compressValue(value: unknown): unknown {
		if (typeof value === "string") {
			return this._truncateString(value);
		}
		if (typeof value === "object" && value !== null) {
			if (Array.isArray(value)) {
				return value.map((v) => this._compressValue(v));
			}
			return this._compressObject(value as Record<string, unknown>);
		}
		return value;
	}

	private _compressArrayValue(
		key: string,
		arr: unknown[],
	): unknown[] {
		if (arr.length <= 3) return arr;
		// For arrays within objects, keep first 3 + last 2
		const keep = [...arr.slice(0, 3), "...", ...arr.slice(-2)];
		return keep;
	}

	private _compressString(key: string, value: string): string {
		// Preserve fields that are commonly queried
		if (this.config.preserveFields.includes(key)) {
			return value;
		}
		return this._truncateString(value);
	}

	private _truncateString(value: string): string {
		if (value.length <= 50) return value;
		const targetLen = Math.max(
			30,
			Math.floor(value.length * this.config.compressionRatio),
		);
		const keepStart = Math.floor(targetLen * 0.6);
		const keepEnd = targetLen - keepStart;
		return (
			value.slice(0, keepStart) +
			"\n...[compressed]...\n" +
			value.slice(-keepEnd)
		);
	}
}
