/**
 * Structure mask system for compression.
 *
 * Ported from Headroom's masks.py.
 *
 * A StructureMask identifies which parts of content are "structural" (should be
 * preserved) vs "compressible" (can be compressed).  This separates:
 * 1. Structure detection (handlers) — What tokens are navigational?
 * 2. Content compression — What tokens can be removed?
 *
 * The mask is content-agnostic — it is just a boolean array aligned to tokens.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface MaskSpan {
	start: number;
	end: number;
	isStructural: boolean;
	label?: string;
}

export class StructureMask {
	/** The tokenized content (array of strings). */
	readonly tokens: string[];
	/** Boolean array — true = preserve (structural), false = compressible. */
	readonly mask: boolean[];
	/** Optional handler-specific metadata. */
	readonly metadata: Record<string, unknown>;

	constructor(
		tokens: string[],
		mask: boolean[],
		metadata: Record<string, unknown> = {},
	) {
		if (tokens.length !== mask.length) {
			throw new Error(
				`Mask length (${mask.length}) must match tokens length (${tokens.length})`,
			);
		}
		this.tokens = tokens;
		this.mask = mask;
		this.metadata = metadata;
	}

	/** Fraction of tokens marked for preservation. */
	get preservationRatio(): number {
		if (this.mask.length === 0) return 0;
		return this.mask.filter(Boolean).length / this.mask.length;
	}

	/** Number of structural (preserved) tokens. */
	get structuralCount(): number {
		return this.mask.filter(Boolean).length;
	}

	/** Number of compressible tokens. */
	get compressibleCount(): number {
		return this.mask.length - this.structuralCount;
	}

	/** Get tokens marked as structural. */
	getStructuralTokens(): string[] {
		return this.tokens.filter((_, i) => this.mask[i]);
	}

	/** Get tokens marked as compressible. */
	getCompressibleTokens(): string[] {
		return this.tokens.filter((_, i) => !this.mask[i]);
	}

	/** Create a mask with no structural tokens (all compressible). */
	static empty(tokens: string[]): StructureMask {
		return new StructureMask(tokens, tokens.map(() => false));
	}

	/** Create a mask preserving all tokens (nothing compressible). */
	static full(tokens: string[]): StructureMask {
		return new StructureMask(tokens, tokens.map(() => true));
	}

	/** Combine masks — preserve if EITHER mask says preserve. */
	union(other: StructureMask): StructureMask {
		if (this.mask.length !== other.mask.length) {
			throw new Error("Cannot union masks of different lengths");
		}
		return new StructureMask(
			this.tokens,
			this.mask.map((b, i) => b || other.mask[i]),
			{ source: "union", ...this.metadata, ...other.metadata },
		);
	}

	/** Combine masks — preserve only if BOTH say preserve. */
	intersection(other: StructureMask): StructureMask {
		if (this.mask.length !== other.mask.length) {
			throw new Error("Cannot intersect masks of different lengths");
		}
		return new StructureMask(
			this.tokens,
			this.mask.map((b, i) => b && other.mask[i]),
			{ source: "intersection", ...this.metadata, ...other.metadata },
		);
	}
}

// ── Span conversion ──────────────────────────────────────────────────────────

/**
 * Convert a mask to a list of contiguous spans.
 *
 * Useful for processing structural and compressible regions separately.
 */
export function maskToSpans(mask: StructureMask): MaskSpan[] {
	if (mask.mask.length === 0) return [];

	const spans: MaskSpan[] = [];
	let currentStart = 0;
	let currentStructural = mask.mask[0];

	for (let i = 1; i < mask.mask.length; i++) {
		if (mask.mask[i] !== currentStructural) {
			spans.push({
				start: currentStart,
				end: i,
				isStructural: currentStructural,
			});
			currentStart = i;
			currentStructural = mask.mask[i];
		}
	}

	// Last span
	spans.push({
		start: currentStart,
		end: mask.mask.length,
		isStructural: currentStructural,
	});

	return spans;
}

// ── Apply compression with mask ──────────────────────────────────────────────

/**
 * Apply compression to non-structural regions of text.
 *
 * Structural regions are kept verbatim; non-structural regions are passed
 * to the compression function.
 *
 * @param text - Original text.
 * @param mask - Structure mask aligned to tokens (tokens are characters).
 * @param compressFn - Function to compress a text region.
 * @returns Text with non-structural regions compressed.
 */
export function applyMaskToText(
	text: string,
	mask: StructureMask,
	compressFn: (text: string) => string,
): string {
	const spans = maskToSpans(mask);
	const parts: string[] = [];

	for (const span of spans) {
		const spanText = text.slice(span.start, span.end);
		if (span.isStructural) {
			parts.push(spanText);
		} else {
			const compressed =
				spanText.length > 50 ? compressFn(spanText) : spanText;
			parts.push(compressed);
		}
	}

	return parts.join("");
}

// ── Entropy-based preservation ───────────────────────────────────────────────

/**
 * Compute Shannon entropy of a text.
 */
export function computeEntropy(text: string): number {
	if (!text) return 0;
	const freq = new Map<string, number>();
	for (const ch of text) {
		freq.set(ch, (freq.get(ch) || 0) + 1);
	}
	const total = text.length;
	let entropy = 0;
	for (const count of freq.values()) {
		if (count > 0) {
			const p = count / total;
			entropy -= p * Math.log2(p);
		}
	}
	// Normalise to 0–1
	const maxEntropy = freq.size > 1 ? Math.log2(freq.size) : 1;
	return maxEntropy > 0 ? entropy / maxEntropy : 0;
}

/**
 * Create a mask preserving high-entropy tokens (UUIDs, hashes, etc.).
 *
 * This is a self-signal that does not require content classification.
 * High-entropy tokens are marked for preservation.
 *
 * @param tokens - Array of string tokens.
 * @param threshold - Entropy threshold (0–1). Higher = more selective.
 * @param minTokenLength - Only check tokens this long or longer.
 */
export function computeEntropyMask(
	tokens: string[],
	threshold = 0.85,
	minTokenLength = 8,
): StructureMask {
	const mask = tokens.map((token) => {
		if (token.length < minTokenLength) return false;
		return computeEntropy(token) >= threshold;
	});
	return new StructureMask(tokens, mask, {
		source: "entropy",
		threshold,
	});
}
