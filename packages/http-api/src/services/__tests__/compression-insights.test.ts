import { describe, expect, test } from "bun:test";
import {
	aggregateCompressionRows,
	type BuildCompressionInsightsInput,
	buildCompressionInsightsResponse,
	type CompressionEventGroupRow,
} from "../compression-insights";

/**
 * Tests for the pure compression/cache-alignment insights math service.
 *
 * The central invariant under test throughout: cache-hit rows (repeat
 * appearances of an already-compressed block) must never inflate
 * tokensSaved or avgRatio/avgCompressionRatio. Only fresh (cache_hit=0)
 * compression events may feed those sums; cache-hit rows only count
 * toward event counts and cacheHitRate.
 */

function groupRow(
	partial: Partial<CompressionEventGroupRow> = {},
): CompressionEventGroupRow {
	return {
		key: null,
		events: 0,
		cacheHitEvents: 0,
		tokensSaved: 0,
		sumRatio: 0,
		ratioCount: 0,
		...partial,
	};
}

function buildInput(
	partial: Partial<BuildCompressionInsightsInput> = {},
): BuildCompressionInsightsInput {
	return {
		range: "7d",
		requestCount: 0,
		compressionEventsCount: 0,
		cacheHitEventsCount: 0,
		totalTokensSavedFreshOnly: 0,
		sumRatioFreshOnly: 0,
		ratioCountFreshOnly: 0,
		avgAlignmentScore: null,
		byContentType: [],
		byCompressor: [],
		liveCache: null,
		...partial,
	};
}

describe("aggregateCompressionRows", () => {
	test("empty input produces an empty array, no crashes", () => {
		expect(aggregateCompressionRows([])).toEqual([]);
	});

	test("100% cache-hit group: cacheHitRate=1, tokensSaved/avgRatio reflect only fresh data (0/null here)", () => {
		const rows = aggregateCompressionRows([
			groupRow({
				key: "json",
				events: 10,
				cacheHitEvents: 10,
				// Per the contract, the caller's SQL only sums cache_hit=0 rows.
				// With zero fresh rows in this all-hits group, these are 0/empty.
				tokensSaved: 0,
				sumRatio: 0,
				ratioCount: 0,
			}),
		]);
		expect(rows).toHaveLength(1);
		expect(rows[0].cacheHitRate).toBe(1);
		expect(rows[0].tokensSaved).toBe(0);
		expect(rows[0].avgRatio).toBeNull();
		expect(rows[0].events).toBe(10);
	});

	test("mixed group: tokensSaved/avgRatio reflect ONLY the fresh-only sums, not what 'all rows' would sum to", () => {
		// Simulate: 3 fresh (cache_hit=0) events with real savings of 100+200+300=600
		// tokens and ratios 0.5+0.4+0.3 (sum 1.2, count 3 -> avg 0.4), PLUS 7
		// cache-hit repeats of the same blocks that (if wrongly included) would
		// each re-report a raw character-length approximation, e.g. 50 tokens
		// each = 350 additional tokens, and no ratio contribution.
		//
		// A caller that incorrectly included the cache-hit rows would report
		// tokensSaved = 600 + 350 = 950. We assert the correct fresh-only
		// figure of 600 instead, so this test fails if cache-hit inflation
		// creeps back in.
		const freshOnlyTokensSaved = 600;
		const inflatedIfWronglyIncluded = 950;

		const rows = aggregateCompressionRows([
			groupRow({
				key: "logs",
				events: 10, // 3 fresh + 7 cache-hit
				cacheHitEvents: 7,
				tokensSaved: freshOnlyTokensSaved,
				sumRatio: 1.2,
				ratioCount: 3,
			}),
		]);

		expect(rows[0].tokensSaved).toBe(freshOnlyTokensSaved);
		expect(rows[0].tokensSaved).not.toBe(inflatedIfWronglyIncluded);
		expect(rows[0].avgRatio).toBeCloseTo(0.4, 10);
		expect(rows[0].cacheHitRate).toBeCloseTo(0.7, 10);
	});

	test("null/empty key normalizes to Unknown", () => {
		const rows = aggregateCompressionRows([
			groupRow({ key: null, events: 1 }),
			groupRow({ key: "", events: 1, tokensSaved: 5 }),
		]);
		// both normalize to "Unknown" but remain separate input rows (no merging
		// performed by this function -- merging, if any, is the caller's job)
		expect(rows.every((r) => r.key === "Unknown")).toBe(true);
	});

	test("sorts descending by tokensSaved, ties broken by key ascending", () => {
		const rows = aggregateCompressionRows([
			groupRow({ key: "b-tie", events: 1, tokensSaved: 100 }),
			groupRow({ key: "a-tie", events: 1, tokensSaved: 100 }),
			groupRow({ key: "biggest", events: 1, tokensSaved: 500 }),
			groupRow({ key: "smallest", events: 1, tokensSaved: 10 }),
			groupRow({ key: "zero", events: 1, tokensSaved: 0 }),
		]);
		expect(rows.map((r) => r.key)).toEqual([
			"biggest",
			"a-tie",
			"b-tie",
			"smallest",
			"zero",
		]);
	});

	test("avgRatio is null (not NaN or 0) when ratioCount is 0", () => {
		const rows = aggregateCompressionRows([
			groupRow({
				key: "no-ratio-data",
				events: 5,
				tokensSaved: 50,
				ratioCount: 0,
				sumRatio: 0,
			}),
		]);
		expect(rows[0].avgRatio).toBeNull();
	});

	test("cacheHitRate guards divide-by-zero when events is 0", () => {
		const rows = aggregateCompressionRows([
			groupRow({ key: "empty-group", events: 0, cacheHitEvents: 0 }),
		]);
		expect(rows[0].cacheHitRate).toBe(0);
	});
});

describe("buildCompressionInsightsResponse", () => {
	test("empty input -> zeroed/null response, no crashes, no division by zero", () => {
		const response = buildCompressionInsightsResponse(buildInput());
		expect(response.meta).toEqual({ range: "7d" });
		expect(response.totals).toEqual({
			requests: 0,
			compressionEventsCount: 0,
			cacheHitRate: 0,
			avgAlignmentScore: null,
			totalTokensSaved: 0,
			avgCompressionRatio: null,
		});
		expect(response.byContentType).toEqual([]);
		expect(response.byCompressor).toEqual([]);
		expect(response.liveCache).toBeNull();
	});

	test("top-level totals use fresh-only sums, not inflated by cache-hit repeats", () => {
		// 100 total compression events, 60 of them cache-hit repeats.
		// Fresh-only (cache_hit=0) sums: 400 tokens saved, ratio sum 16 over 40 rows -> avg 0.4.
		// An implementation that wrongly folded cache-hit rows into the sum
		// would report a larger totalTokensSaved than 400.
		const response = buildCompressionInsightsResponse(
			buildInput({
				requestCount: 50,
				compressionEventsCount: 100,
				cacheHitEventsCount: 60,
				totalTokensSavedFreshOnly: 400,
				sumRatioFreshOnly: 16,
				ratioCountFreshOnly: 40,
				avgAlignmentScore: 0.85,
			}),
		);
		expect(response.totals.requests).toBe(50);
		expect(response.totals.compressionEventsCount).toBe(100);
		expect(response.totals.cacheHitRate).toBeCloseTo(0.6, 10);
		expect(response.totals.avgAlignmentScore).toBe(0.85);
		expect(response.totals.totalTokensSaved).toBe(400);
		expect(response.totals.avgCompressionRatio).toBeCloseTo(0.4, 10);
	});

	test("avgCompressionRatio is null when ratioCountFreshOnly is 0", () => {
		const response = buildCompressionInsightsResponse(
			buildInput({
				compressionEventsCount: 10,
				cacheHitEventsCount: 10,
				totalTokensSavedFreshOnly: 0,
				sumRatioFreshOnly: 0,
				ratioCountFreshOnly: 0,
			}),
		);
		expect(response.totals.avgCompressionRatio).toBeNull();
	});

	test("cacheHitRate guards divide-by-zero when compressionEventsCount is 0", () => {
		const response = buildCompressionInsightsResponse(
			buildInput({ compressionEventsCount: 0, cacheHitEventsCount: 0 }),
		);
		expect(response.totals.cacheHitRate).toBe(0);
	});

	test("byContentType and byCompressor are independently aggregated and sorted", () => {
		const response = buildCompressionInsightsResponse(
			buildInput({
				byContentType: [
					groupRow({
						key: "json",
						events: 5,
						cacheHitEvents: 1,
						tokensSaved: 50,
						sumRatio: 2,
						ratioCount: 4,
					}),
					groupRow({
						key: "logs",
						events: 3,
						cacheHitEvents: 0,
						tokensSaved: 200,
						sumRatio: 1.5,
						ratioCount: 3,
					}),
				],
				byCompressor: [
					groupRow({
						key: "simple",
						events: 2,
						cacheHitEvents: 0,
						tokensSaved: 10,
						sumRatio: 0.5,
						ratioCount: 2,
					}),
				],
			}),
		);
		expect(response.byContentType.map((r) => r.key)).toEqual(["logs", "json"]);
		expect(response.byContentType[0].tokensSaved).toBe(200);
		expect(response.byCompressor).toHaveLength(1);
		expect(response.byCompressor[0].key).toBe("simple");
		expect(response.byCompressor[0].avgRatio).toBeCloseTo(0.25, 10);
	});

	test("liveCache: null passes through as null, not coerced to a zeroed object", () => {
		const response = buildCompressionInsightsResponse(
			buildInput({ liveCache: null }),
		);
		expect(response.liveCache).toBeNull();
	});

	test("liveCache: non-null object passes through unchanged", () => {
		const liveCache = {
			entries: 42,
			stableHashes: 10,
			hits: 30,
			misses: 12,
			tokensSaved: 1234,
		};
		const response = buildCompressionInsightsResponse(
			buildInput({ liveCache }),
		);
		expect(response.liveCache).toEqual(liveCache);
		expect(response.liveCache).not.toBeNull();
	});
});
