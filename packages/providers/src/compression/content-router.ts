/**
 * Content router — ported from Headroom's ContentRouter + UniversalCompressor.
 *
 * Analyzes content, detects its type, and routes to the appropriate
 * sub-compressor.  Handles mixed content by splitting into sections and
 * compressing each independently.
 */

// ── Imports (local — needed in this file body) ──────────────────────────────

import {
	ContentType,
	detectContentType,
} from "./content-detector";
import type { DetectionResult } from "./content-detector";

import { JSONCompressor } from "./compressors/json-compressor";
import type {
	JSONCompressorConfig,
	JSONCompressionResult,
} from "./compressors/json-compressor";

import { LogCompressor } from "./compressors/log-compressor";
import type {
	LogCompressorConfig,
	LogCompressionResult,
} from "./compressors/log-compressor";

import { SearchCompressor } from "./compressors/search-compressor";
import type {
	SearchCompressorConfig,
	SearchCompressionResult,
} from "./compressors/search-compressor";

import { SimpleCompressor } from "./compressors/simple-compressor";
import type {
	SimpleCompressorConfig,
	SimpleCompressionResult,
} from "./compressors/simple-compressor";

// ── Re-exports ───────────────────────────────────────────────────────────────

export { ContentType, detectContentType } from "./content-detector";
export type { DetectionResult } from "./content-detector";
export {
	StructureMask,
	maskToSpans,
	applyMaskToText,
	computeEntropyMask,
} from "./structure-mask";
export type { MaskSpan } from "./structure-mask";
export { JSONCompressor } from "./compressors/json-compressor";
export type {
	JSONCompressorConfig,
	JSONCompressionResult,
} from "./compressors/json-compressor";
export { LogCompressor } from "./compressors/log-compressor";
export type {
	LogCompressorConfig,
	LogCompressionResult,
} from "./compressors/log-compressor";
export { SearchCompressor } from "./compressors/search-compressor";
export type {
	SearchCompressorConfig,
	SearchCompressionResult,
} from "./compressors/search-compressor";
export { SimpleCompressor } from "./compressors/simple-compressor";
export type {
	SimpleCompressorConfig,
	SimpleCompressionResult,
} from "./compressors/simple-compressor";

// ── Config ───────────────────────────────────────────────────────────────────

export interface ContentRouterConfig {
	/** Enable JSON compression via JSONCompressor. */
	enableJSONCompressor: boolean;
	/** Enable log compression via LogCompressor. */
	enableLogCompressor: boolean;
	/** Enable search-result compression via SearchCompressor. */
	enableSearchCompressor: boolean;
	/** Enable simple truncation fallback. */
	enableSimpleCompressor: boolean;

	/** JSON compressor config. */
	jsonCompressor: Partial<JSONCompressorConfig>;
	/** Log compressor config. */
	logCompressor: Partial<LogCompressorConfig>;
	/** Search compressor config. */
	searchCompressor: Partial<SearchCompressorConfig>;
	/** Simple compressor config. */
	simpleCompressor: Partial<SimpleCompressorConfig>;

	/** Minimum content length (chars) before compression is attempted. */
	minContentChars: number;
	/** Whether to detect and split mixed content. */
	enableMixedContent: boolean;
	/** Fallback content type when detection is uncertain. */
	fallbackContentType: ContentType;
}

const DEFAULT_CONFIG: ContentRouterConfig = {
	enableJSONCompressor: true,
	enableLogCompressor: true,
	enableSearchCompressor: true,
	enableSimpleCompressor: true,

	jsonCompressor: {},
	logCompressor: {},
	searchCompressor: {},
	simpleCompressor: {},

	minContentChars: 100,
	enableMixedContent: true,
	fallbackContentType: ContentType.TEXT,
};

// ── Result ───────────────────────────────────────────────────────────────────

export interface ContentRouterResult {
	/** The (possibly compressed) content. */
	compressed: string;
	/** The original content. */
	original: string;
	/** Detected content type. */
	contentType: ContentType;
	/** Confidence of content type detection (0–1). */
	detectionConfidence: number;
	/** Name of the compressor that was used. */
	compressorUsed: string;
	/** Compression ratio (compressed_len / original_len). */
	compressionRatio: number;
	/** Estimated tokens before compression (chars / 4). */
	tokensBefore: number;
	/** Estimated tokens after compression. */
	tokensAfter: number;
	/** Whether content was identified as mixed and split. */
	wasMixed: boolean;
	/** Sub-results for mixed content sections. */
	subResults: Array<{
		contentType: ContentType;
		compressorUsed: string;
	}>;
	/** Compression strategy label. */
	strategy: string;
}

// ── Content Router ───────────────────────────────────────────────────────────

export class ContentRouter {
	private config: ContentRouterConfig;
	private jsonCompressor: JSONCompressor;
	private logCompressor: LogCompressor;
	private searchCompressor: SearchCompressor;
	private simpleCompressor: SimpleCompressor;

	constructor(config: Partial<ContentRouterConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.jsonCompressor = new JSONCompressor(this.config.jsonCompressor);
		this.logCompressor = new LogCompressor(this.config.logCompressor);
		this.searchCompressor = new SearchCompressor(
			this.config.searchCompressor,
		);
		this.simpleCompressor = new SimpleCompressor(
			this.config.simpleCompressor,
		);
	}

	// ── Main entry point ──────────────────────────────────────────────────

	/**
	 * Compress content by detecting its type and routing to the best compressor.
	 *
	 * @param content - The content to compress.
	 * @returns Compression result with routing metadata.
	 */
	compress(content: string): ContentRouterResult {
		const original = content;
		const tokensBefore = Math.ceil(content.length / 4);

		// Skip short content
		if (!content || content.length < this.config.minContentChars) {
			const minified = this._tryMinifyJSON(content);
			if (minified !== null && minified !== content) {
				return {
					compressed: minified,
					original: content,
					contentType: ContentType.JSON,
					detectionConfidence: 1.0,
					compressorUsed: "JSONMinifier",
					compressionRatio: minified.length / content.length,
					tokensBefore,
					tokensAfter: Math.ceil(minified.length / 4),
					wasMixed: false,
					subResults: [],
					strategy: "json_minify_short",
				};
			}
			return this._passthroughResult(
				content,
				ContentType.UNKNOWN,
				0,
				"too_short",
			);
		}

		// Check for mixed content
		if (this.config.enableMixedContent && this._isMixed(content)) {
			return this._compressMixed(content);
		}

		// Detect content type
		const detection = detectContentType(content);
		const result = this._routeToCompressor(content, detection);

		return {
			...result,
			original,
			detectionConfidence: detection.confidence,
			contentType: detection.contentType,
			tokensBefore,
			tokensAfter: Math.ceil(result.compressed.length / 4),
			wasMixed: false,
		};
	}

	// ── Routing ───────────────────────────────────────────────────────────

	private _routeToCompressor(
		content: string,
		detection: DetectionResult,
	): Omit<
		ContentRouterResult,
		"original" | "tokensBefore" | "tokensAfter" | "wasMixed"
	> {
		switch (detection.contentType) {
			case ContentType.JSON: {
				if (!this.config.enableJSONCompressor) break;
				const jr = this.jsonCompressor.compress(content);
				return {
					compressed: jr.compressed,
					compressionRatio: jr.compressed.length / content.length,
					contentType: ContentType.JSON,
					detectionConfidence: detection.confidence,
					compressorUsed: "JSONCompressor",
					subResults: [],
					strategy: jr.strategy,
				};
			}

			case ContentType.LOG: {
				if (!this.config.enableLogCompressor) break;
				const lr = this.logCompressor.compress(content);
				return {
					compressed: lr.compressed,
					compressionRatio: lr.compressed.length / content.length,
					contentType: ContentType.LOG,
					detectionConfidence: detection.confidence,
					compressorUsed: "LogCompressor",
					subResults: [],
					strategy: lr.strategy,
				};
			}

			case ContentType.CODE: {
				if (!this.config.enableSearchCompressor) break;
				const sr = this.searchCompressor.compress(content);
				if (sr.originalMatches > 0) {
					return {
						compressed: sr.compressed,
						compressionRatio: sr.compressed.length / content.length,
						contentType: ContentType.CODE,
						detectionConfidence: detection.confidence,
						compressorUsed: "SearchCompressor",
						subResults: [],
						strategy: sr.strategy,
					};
				}
				// Not actually search results — fall through
				break;
			}

			default:
				break;
		}

		// Fallback: simple truncation
		if (this.config.enableSimpleCompressor) {
			const scr = this.simpleCompressor.compress(content);
			return {
				compressed: scr.compressed,
				compressionRatio: scr.compressed.length / content.length,
				contentType: detection.contentType,
				detectionConfidence: detection.confidence,
				compressorUsed: "SimpleCompressor",
				subResults: [],
				strategy: scr.strategy,
			};
		}

		// No compressor — pass through
		return this._passthroughResult(
			content,
			detection.contentType,
			detection.confidence,
			"no_compressor_enabled",
		);
	}

	// ── Mixed content ─────────────────────────────────────────────────────

	/** Heuristic: does this content look like it contains multiple types? */
	private _isMixed(content: string): boolean {
		const indicators = {
			hasCodeFences: /^```/m.test(content),
			hasJSONBlocks: /^\s*[\[{]/m.test(content),
			hasSearchResults: /^\S+:\d+:/m.test(content),
		};
		return Object.values(indicators).filter(Boolean).length >= 2;
	}

	/** Split content on markdown code fences, compress each section. */
	private _compressMixed(content: string): ContentRouterResult {
		const sections = this._splitIntoSections(content);
		const subResults: Array<{
			contentType: ContentType;
			compressorUsed: string;
		}> = [];

		const compressedParts: string[] = [];
		for (const section of sections) {
			const detection = detectContentType(section);
			const result = this._routeToCompressor(section, detection);
			compressedParts.push(result.compressed);
			subResults.push({
				contentType: detection.contentType,
				compressorUsed: result.compressorUsed,
			});
		}

		const compressed = compressedParts.join("\n");
		return {
			compressed,
			original: content,
			contentType: ContentType.TEXT,
			detectionConfidence: 0.5,
			compressorUsed: "ContentRouter(mixed)",
			compressionRatio: compressed.length / content.length,
			tokensBefore: Math.ceil(content.length / 4),
			tokensAfter: Math.ceil(compressed.length / 4),
			wasMixed: true,
			subResults,
			strategy: "mixed_routing",
		};
	}

	/** Split content on markdown code fences, falling back to paragraph breaks. */
	private _splitIntoSections(content: string): string[] {
		const sections: string[] = [];
		const lines = content.split("\n");
		let current: string[] = [];
		let inFence = false;

		for (const line of lines) {
			if (/^```/.test(line)) {
				if (current.length > 0) {
					sections.push(current.join("\n"));
					current = [];
				}
				inFence = !inFence;
				current.push(line);
			} else {
				current.push(line);
			}
		}

		if (current.length > 0) {
			sections.push(current.join("\n"));
		}

		// If fence splitting didn't actually split anything, try paragraph breaks.
		// This handles mixed content where no code fences exist (e.g., JSON blocks
		// and search results), giving each section a fair shot at its own compressor.
		if (sections.length <= 1) {
			const paraSections: string[] = [];
			let para: string[] = [];
			for (const line of lines) {
				if (line.trim() === "") {
					if (para.length > 0) {
						paraSections.push(para.join("\n"));
						para = [];
					}
				} else {
					para.push(line);
				}
			}
			if (para.length > 0) {
				paraSections.push(para.join("\n"));
			}
			if (paraSections.length > 1) {
				return paraSections;
			}
		}

		return sections;
	}

	// ── Passthrough helper ────────────────────────────────────────────────

	private _passthroughResult(
		content: string,
		contentType: ContentType,
		confidence: number,
		reason: string,
	): ContentRouterResult {
		return {
			compressed: content,
			original: content,
			contentType,
			detectionConfidence: confidence,
			compressorUsed: "passthrough",
			compressionRatio: 1,
			tokensBefore: Math.ceil(content.length / 4),
			tokensAfter: Math.ceil(content.length / 4),
			wasMixed: false,
			subResults: [],
			strategy: `passthrough(${reason})`,
		};
	}

	// ── JSON minification helper ──────────────────────────────────────────

	/**
	 * Losslessly minify content that is itself valid top-level JSON. Mirrors
	 * detectContentType's own {/[ guard so plain text/number-like content is
	 * never misclassified. Returns null if content isn't parseable JSON.
	 */
	private _tryMinifyJSON(content: string): string | null {
		const trimmed = content.trim();
		if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;
		try {
			return JSON.stringify(JSON.parse(trimmed));
		} catch {
			return null;
		}
	}
}
