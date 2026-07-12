import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	BunSqlAdapter,
	ensureSchema,
	runMigrations,
} from "@tinyclaude/database";
import type { APIContext } from "../../types";
import { createCompressionInsightsHandler } from "../insights";

/**
 * Tests for the compression insights handler.
 *
 * The central invariant under test throughout: cache-hit compression_events
 * rows (cache_hit=1) must be excluded from tokens-saved/ratio sums but
 * included in event counts and cache-hit-rate. See
 * services/compression-insights.ts's module docs for the full contract.
 */

// ---------------------------------------------------------------------------
// Mock-adapter tests
// ---------------------------------------------------------------------------

type GroupSqlRow = {
	key: string | null;
	events: number;
	cache_hit_events: number;
	tokens_saved: number;
	sum_ratio: number;
	ratio_count: number;
};

type AlignmentSqlRow = {
	request_count: number;
	avg_alignment_score: number | null;
};

function createMockContext(opts: {
	byContentType: GroupSqlRow[];
	byCompressor: GroupSqlRow[];
	alignment: AlignmentSqlRow;
	getCompressionCacheStats?: APIContext["getCompressionCacheStats"];
}): APIContext {
	const mockDb = {
		query: async (sql: string) => {
			if (sql.includes("GROUP BY ce.content_type")) return opts.byContentType;
			if (sql.includes("GROUP BY ce.compressor_used")) return opts.byCompressor;
			if (sql.includes("FROM requests r")) return [opts.alignment];
			throw new Error(`unexpected query: ${sql}`);
		},
	};

	return {
		db: {} as APIContext["db"],
		config: {} as APIContext["config"],
		dbOps: {
			getAdapter: () => mockDb,
		} as unknown as APIContext["dbOps"],
		getCompressionCacheStats: opts.getCompressionCacheStats,
	} as unknown as APIContext;
}

describe("compression insights handler (mock adapter)", () => {
	it("returns a zeroed/null-safe response for an empty DB", async () => {
		const context = createMockContext({
			byContentType: [],
			byCompressor: [],
			alignment: { request_count: 0, avg_alignment_score: null },
		});
		const response = await createCompressionInsightsHandler(context)(
			new URLSearchParams(),
		);
		expect(response.status).toBe(200);
		const data = await response.json();

		expect(data.meta).toEqual({ range: "24h" });
		expect(data.totals).toEqual({
			requests: 0,
			compressionEventsCount: 0,
			cacheHitRate: 0,
			avgAlignmentScore: null,
			totalTokensSaved: 0,
			avgCompressionRatio: null,
		});
		expect(data.byContentType).toEqual([]);
		expect(data.byCompressor).toEqual([]);
		expect(data.liveCache).toBeNull();
	});

	it("excludes cache_hit=1 rows from tokens-saved/ratio sums but counts them in events/cacheHitRate", async () => {
		// Two compressor_used rows pre-aggregated as the handler's SQL would
		// produce them: one fresh (cache_hit=0) row contributing real savings,
		// one cache-hit row contributing only to the event/hit counts.
		const byCompressor: GroupSqlRow[] = [
			{
				key: "json",
				events: 1,
				cache_hit_events: 0,
				tokens_saved: 500,
				sum_ratio: 0.4,
				ratio_count: 1,
			},
			{
				key: "cache_hit",
				events: 1,
				cache_hit_events: 1,
				tokens_saved: 0,
				sum_ratio: 0,
				ratio_count: 0,
			},
		];
		const context = createMockContext({
			byContentType: [],
			byCompressor,
			alignment: { request_count: 2, avg_alignment_score: 0.75 },
		});
		const response = await createCompressionInsightsHandler(context)(
			new URLSearchParams(),
		);
		const data = await response.json();

		expect(data.totals.compressionEventsCount).toBe(2);
		expect(data.totals.cacheHitRate).toBeCloseTo(0.5, 10);
		expect(data.totals.totalTokensSaved).toBe(500);
		expect(data.totals.avgCompressionRatio).toBeCloseTo(0.4, 10);
		expect(data.totals.avgAlignmentScore).toBe(0.75);
		expect(data.totals.requests).toBe(2);
	});

	it("passes getCompressionCacheStats() through into liveCache when present", async () => {
		const context = createMockContext({
			byContentType: [],
			byCompressor: [],
			alignment: { request_count: 0, avg_alignment_score: null },
			getCompressionCacheStats: () => ({
				entries: 10,
				stableHashes: 5,
				hits: 8,
				misses: 2,
				tokensSaved: 999,
			}),
		});
		const response = await createCompressionInsightsHandler(context)(
			new URLSearchParams(),
		);
		const data = await response.json();
		expect(data.liveCache).toEqual({
			entries: 10,
			stableHashes: 5,
			hits: 8,
			misses: 2,
			tokensSaved: 999,
		});
	});

	it("reports liveCache as null when getCompressionCacheStats is absent or returns null", async () => {
		const contextAbsent = createMockContext({
			byContentType: [],
			byCompressor: [],
			alignment: { request_count: 0, avg_alignment_score: null },
		});
		const dataAbsent = await (
			await createCompressionInsightsHandler(contextAbsent)(
				new URLSearchParams(),
			)
		).json();
		expect(dataAbsent.liveCache).toBeNull();

		const contextNull = createMockContext({
			byContentType: [],
			byCompressor: [],
			alignment: { request_count: 0, avg_alignment_score: null },
			getCompressionCacheStats: () => null,
		});
		const dataNull = await (
			await createCompressionInsightsHandler(contextNull)(new URLSearchParams())
		).json();
		expect(dataNull.liveCache).toBeNull();
	});

	it("returns a 500 error response when the query fails", async () => {
		const context = {
			db: {} as APIContext["db"],
			config: {} as APIContext["config"],
			dbOps: {
				getAdapter: () => ({
					query: async () => {
						throw new Error("boom");
					},
				}),
			} as unknown as APIContext["dbOps"],
		} as unknown as APIContext;
		const response = await createCompressionInsightsHandler(context)(
			new URLSearchParams(),
		);
		expect(response.status).toBe(500);
	});
});

// ---------------------------------------------------------------------------
// Integration test: real in-memory SQLite
// ---------------------------------------------------------------------------

describe("compression insights handler (SQLite integration)", () => {
	let db: Database;
	let context: APIContext;

	function insertRequest(opts: {
		id: string;
		timestamp: number;
		alignmentScore: number | null;
	}): void {
		db.run(
			`INSERT INTO requests
				(id, timestamp, method, path, status_code, success,
				 response_time_ms, failover_attempts, alignment_score)
			 VALUES (?, ?, 'POST', '/v1/messages', 200, 1, 100, 0, ?)`,
			[opts.id, opts.timestamp, opts.alignmentScore],
		);
	}

	function insertCompressionEvent(opts: {
		id: string;
		requestId: string;
		contentType: string | null;
		compressorUsed: string;
		compressionRatio: number | null;
		tokensBefore: number | null;
		tokensAfter: number | null;
		cacheHit: number;
		timestamp: number;
	}): void {
		db.run(
			`INSERT INTO compression_events
				(id, request_id, content_type, compressor_used, compression_ratio,
				 tokens_before, tokens_after, cache_hit, timestamp)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				opts.id,
				opts.requestId,
				opts.contentType,
				opts.compressorUsed,
				opts.compressionRatio,
				opts.tokensBefore,
				opts.tokensAfter,
				opts.cacheHit,
				opts.timestamp,
			],
		);
	}

	beforeEach(() => {
		db = new Database(":memory:");
		ensureSchema(db);
		runMigrations(db);

		const now = Date.now();

		insertRequest({ id: "r1", timestamp: now - 1000, alignmentScore: 80 });
		insertRequest({ id: "r2", timestamp: now - 1000, alignmentScore: 60 });
		// r3 is outside the default 24h range -> excluded from everything.
		insertRequest({
			id: "r3",
			timestamp: now - 2 * 24 * 60 * 60 * 1000,
			alignmentScore: 100,
		});

		// r1: one fresh compression event (real savings) + one cache-hit repeat
		// of the same block (must not inflate tokens-saved/ratio sums).
		insertCompressionEvent({
			id: "e1",
			requestId: "r1",
			contentType: "json",
			compressorUsed: "json",
			compressionRatio: 0.4,
			tokensBefore: 1000,
			tokensAfter: 500,
			cacheHit: 0,
			timestamp: now - 900,
		});
		insertCompressionEvent({
			id: "e2",
			requestId: "r1",
			contentType: "json",
			compressorUsed: "cache_hit",
			compressionRatio: null,
			tokensBefore: 1000,
			tokensAfter: 50,
			cacheHit: 1,
			timestamp: now - 800,
		});
		// r2: one fresh log-compression event.
		insertCompressionEvent({
			id: "e3",
			requestId: "r2",
			contentType: "logs",
			compressorUsed: "log",
			compressionRatio: 0.2,
			tokensBefore: 2000,
			tokensAfter: 400,
			cacheHit: 0,
			timestamp: now - 900,
		});
		// r3: outside the range window, must be excluded entirely.
		insertCompressionEvent({
			id: "e4",
			requestId: "r3",
			contentType: "json",
			compressorUsed: "json",
			compressionRatio: 0.9,
			tokensBefore: 10_000,
			tokensAfter: 9_000,
			cacheHit: 0,
			timestamp: now - 2 * 24 * 60 * 60 * 1000,
		});

		const adapter = new BunSqlAdapter(db);
		context = {
			db: adapter,
			config: {} as APIContext["config"],
			dbOps: {
				getAdapter: () => adapter,
			} as unknown as APIContext["dbOps"],
		} as unknown as APIContext;
	});

	afterEach(() => {
		db.close();
	});

	it("computes hand-computed totals, excludes cache-hit rows from savings/ratio, and honors the range window", async () => {
		const response = await createCompressionInsightsHandler(context)(
			new URLSearchParams(),
		);
		expect(response.status).toBe(200);
		const data = await response.json();

		// requests: r1 + r2 in range (r3 excluded by 24h window)
		expect(data.totals.requests).toBe(2);
		expect(data.totals.avgAlignmentScore).toBeCloseTo(70, 10); // (80+60)/2

		// compression events: e1, e2, e3 (e4 excluded by range) -> 3 total, 1 cache-hit
		expect(data.totals.compressionEventsCount).toBe(3);
		expect(data.totals.cacheHitRate).toBeCloseTo(1 / 3, 10);

		// tokens saved: only e1 (1000-500=500) and e3 (2000-400=1600); e2 excluded.
		expect(data.totals.totalTokensSaved).toBe(2100);
		// avg ratio: only e1 (0.4) and e3 (0.2) -> (0.4+0.2)/2 = 0.3; e2's null ratio excluded.
		expect(data.totals.avgCompressionRatio).toBeCloseTo(0.3, 10);

		// byContentType: json (e1 fresh + e2 cache-hit) and logs (e3)
		const jsonGroup = data.byContentType.find(
			(r: { key: string }) => r.key === "json",
		);
		expect(jsonGroup.events).toBe(2);
		expect(jsonGroup.cacheHitRate).toBeCloseTo(0.5, 10);
		expect(jsonGroup.tokensSaved).toBe(500);
		expect(jsonGroup.avgRatio).toBeCloseTo(0.4, 10);

		const logsGroup = data.byContentType.find(
			(r: { key: string }) => r.key === "logs",
		);
		expect(logsGroup.events).toBe(1);
		expect(logsGroup.tokensSaved).toBe(1600);

		// byCompressor: json, cache_hit, log as distinct compressor_used values
		const cacheHitGroup = data.byCompressor.find(
			(r: { key: string }) => r.key === "cache_hit",
		);
		expect(cacheHitGroup.events).toBe(1);
		expect(cacheHitGroup.cacheHitRate).toBe(1);
		expect(cacheHitGroup.tokensSaved).toBe(0);
		expect(cacheHitGroup.avgRatio).toBeNull();

		expect(data.liveCache).toBeNull();
	});

	it("liveCache reflects context.getCompressionCacheStats() when provided", async () => {
		const contextWithStats: APIContext = {
			...context,
			getCompressionCacheStats: () => ({
				entries: 3,
				stableHashes: 2,
				hits: 1,
				misses: 1,
				tokensSaved: 42,
			}),
		};
		const response = await createCompressionInsightsHandler(contextWithStats)(
			new URLSearchParams(),
		);
		const data = await response.json();
		expect(data.liveCache).toEqual({
			entries: 3,
			stableHashes: 2,
			hits: 1,
			misses: 1,
			tokensSaved: 42,
		});
	});
});
