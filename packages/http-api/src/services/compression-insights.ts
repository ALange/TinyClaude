import type {
	CompressionInsightsResponse,
	CompressionInsightsRow,
	CompressionInsightsTotals,
} from "@tinyclaude/types";

/**
 * Pure compression/cache-alignment insights math for the compression
 * insights endpoint.
 *
 * No DB access and no HTTP-layer code: this file only transforms
 * already-aggregated SQL rows into the response shape. SQL construction
 * belongs to the handler (packages/http-api/src/handlers/insights.ts).
 * The response shapes live in @tinyclaude/types and are re-exported
 * here for convenience.
 */

export type {
	CompressionInsightsMeta,
	CompressionInsightsResponse,
	CompressionInsightsRow,
	CompressionInsightsTotals,
} from "@tinyclaude/types";

/**
 * One pre-aggregated `compression_events` row, grouped by either
 * `content_type` or `compressor_used` (same shape serves both dimensions;
 * the caller decides the GROUP BY).
 *
 * CRITICAL aggregation-semantics contract (see module docs on
 * `aggregateCompressionRows` and `buildCompressionInsightsResponse` for
 * why): `compression_events` re-records a cache-hit row every time a
 * previously-compressed block reappears in a later turn, using raw
 * character-length token approximations rather than the original
 * one-time savings. Because there is no content-hash column to
 * deduplicate those repeats, `tokensSaved` and `sumRatio`/`ratioCount`
 * below MUST be computed by the caller's SQL from `cache_hit = 0` rows
 * ONLY. `cache_hit = 1` rows must feed `events` and `cacheHitEvents`
 * only, never the savings/ratio sums.
 */
export interface CompressionEventGroupRow {
	/** content_type or compressor_used value from the GROUP BY; null/empty becomes "Unknown". */
	key: string | null;
	/** COUNT(*) for this group, across both cache_hit=0 and cache_hit=1 rows. */
	events: number;
	/** COUNT(*) WHERE cache_hit = 1, within this group. */
	cacheHitEvents: number;
	/**
	 * SUM(tokens_before - tokens_after) over cache_hit = 0 rows ONLY.
	 * Never include cache_hit = 1 rows here — see the class-level doc.
	 */
	tokensSaved: number;
	/**
	 * SUM(compression_ratio) over cache_hit = 0 rows with a non-null ratio,
	 * for averaging. Never include cache_hit = 1 rows here.
	 */
	sumRatio: number;
	/** COUNT of cache_hit = 0 rows with a non-null compression_ratio (denominator for avgRatio). */
	ratioCount: number;
}

const UNKNOWN_KEY = "Unknown";

function normalizeKey(key: string | null | undefined): string {
	return key == null || key === "" ? UNKNOWN_KEY : key;
}

/**
 * Group-level cache hit rate: cacheHitEvents / events. Returns 0 when the
 * denominator is 0 (matches computeCacheHitRate's 0-denominator guard
 * pattern in cache-insights.ts).
 */
function computeGroupCacheHitRate(row: CompressionEventGroupRow): number {
	if (row.events === 0) return 0;
	return row.cacheHitEvents / row.events;
}

/** Sort by tokensSaved descending; ties broken by key ascending. */
function sortRows(rows: CompressionInsightsRow[]): CompressionInsightsRow[] {
	return rows.sort((a, b) => {
		if (a.tokensSaved !== b.tokensSaved) {
			return b.tokensSaved - a.tokensSaved;
		}
		return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
	});
}

/**
 * Map pre-aggregated group rows into CompressionInsightsRows.
 *
 * Trusts the input's fresh-only contract (see CompressionEventGroupRow docs):
 * `tokensSaved`/`sumRatio`/`ratioCount` are assumed to already exclude
 * cache_hit = 1 rows. This function does no cache-hit filtering itself —
 * it just maps and normalizes fields, then sorts.
 */
export function aggregateCompressionRows(
	rows: CompressionEventGroupRow[],
): CompressionInsightsRow[] {
	const result: CompressionInsightsRow[] = rows.map((row) => ({
		key: normalizeKey(row.key),
		events: row.events,
		avgRatio: row.ratioCount > 0 ? row.sumRatio / row.ratioCount : null,
		tokensSaved: row.tokensSaved,
		cacheHitRate: computeGroupCacheHitRate(row),
	}));
	return sortRows(result);
}

export interface BuildCompressionInsightsInput {
	range: string;
	requestCount: number;
	compressionEventsCount: number;
	/** Total cache_hit=1 events across ALL groups, for the top-level cacheHitRate. */
	cacheHitEventsCount: number;
	/** SUM(tokens_before - tokens_after) over cache_hit=0 rows, across ALL data (not just one group). */
	totalTokensSavedFreshOnly: number;
	/** SUM(compression_ratio) over cache_hit=0 rows with non-null ratio, across ALL data. */
	sumRatioFreshOnly: number;
	/** Denominator for sumRatioFreshOnly. */
	ratioCountFreshOnly: number;
	/** AVG(alignment_score) over requests in range, already computed by caller. */
	avgAlignmentScore: number | null;
	byContentType: CompressionEventGroupRow[];
	byCompressor: CompressionEventGroupRow[];
	liveCache: {
		entries: number;
		stableHashes: number;
		hits: number;
		misses: number;
		tokensSaved: number;
	} | null;
}

/**
 * Assemble the full compression insights response from pre-aggregated
 * group rows and fresh-only (cache_hit=0) top-level sums.
 *
 * `totalTokensSaved` and `avgCompressionRatio` are pass-through/derived
 * directly from the fresh-only inputs — this function never re-derives
 * them from `byContentType`/`byCompressor`, and never includes cache-hit
 * repeats. `cacheHitRate` is the only totals field driven by ALL events
 * (fresh + cache-hit), per the contract in CompressionEventGroupRow's docs.
 */
export function buildCompressionInsightsResponse(
	input: BuildCompressionInsightsInput,
): CompressionInsightsResponse {
	const totals: CompressionInsightsTotals = {
		requests: input.requestCount,
		compressionEventsCount: input.compressionEventsCount,
		cacheHitRate:
			input.compressionEventsCount > 0
				? input.cacheHitEventsCount / input.compressionEventsCount
				: 0,
		avgAlignmentScore: input.avgAlignmentScore,
		totalTokensSaved: input.totalTokensSavedFreshOnly,
		avgCompressionRatio:
			input.ratioCountFreshOnly > 0
				? input.sumRatioFreshOnly / input.ratioCountFreshOnly
				: null,
	};

	return {
		meta: { range: input.range },
		totals,
		byContentType: aggregateCompressionRows(input.byContentType),
		byCompressor: aggregateCompressionRows(input.byCompressor),
		liveCache: input.liveCache,
	};
}
