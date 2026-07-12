// ── Content Router ───────────────────────────────────────────────────────────
export { ContentRouter } from "./content-router";
export type { ContentRouterConfig, ContentRouterResult } from "./content-router";

// ── Content Detection ────────────────────────────────────────────────────────
export { ContentType, detectContentType, detectBatch } from "./content-detector";
export type { DetectionResult } from "./content-detector";

// ── Structure Masks ──────────────────────────────────────────────────────────
export {
	applyMaskToText,
	computeEntropy,
	computeEntropyMask,
	maskToSpans,
	StructureMask,
} from "./structure-mask";
export type { MaskSpan } from "./structure-mask";

// ── Compression Cache ────────────────────────────────────────────────────────
export { CompressionCache } from "./cache";

// ── Sub-Compressors ──────────────────────────────────────────────────────────
export { JSONCompressor } from "./compressors/json-compressor";
export type {
	JSONCompressionResult,
	JSONCompressorConfig,
} from "./compressors/json-compressor";

export { LogCompressor } from "./compressors/log-compressor";
export type {
	LogCompressionResult,
	LogCompressorConfig,
} from "./compressors/log-compressor";

export { SearchCompressor } from "./compressors/search-compressor";
export type {
	SearchCompressionResult,
	SearchCompressorConfig,
} from "./compressors/search-compressor";

export { SimpleCompressor } from "./compressors/simple-compressor";
export type {
	SimpleCompressionResult,
	SimpleCompressorConfig,
} from "./compressors/simple-compressor";
