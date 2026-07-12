/**
 * Tests for the compression & cache-alignment insights write path added to
 * RequestRepository:
 *   - `save()` persisting `alignment_score` / `volatile_findings_count`,
 *     including the COALESCE sticky-update behavior already used for
 *     `original_model` / `applied_model` (see request-model-rewrite.test.ts).
 *   - `saveCompressionEvents()` batched insert into `compression_events`.
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
// Force @tinyclaude/core to initialise before @tinyclaude/types resolves its
// circular dependency. Same pattern as account-pause-reason.test.ts.
import "@tinyclaude/core";
import { BunSqlAdapter } from "../../adapters/bun-sql-adapter";
import { runMigrations } from "../../migrations";
import { RequestRepository } from "../request.repository";

function makeRepo(): { db: Database; repo: RequestRepository } {
	const db = new Database(":memory:");
	runMigrations(db);
	const adapter = new BunSqlAdapter(db);
	return { db, repo: new RequestRepository(adapter) };
}

describe("RequestRepository.save - alignment_score/volatile_findings_count", () => {
	let db: Database;
	let repo: RequestRepository;

	beforeEach(() => {
		({ db, repo } = makeRepo());
	});

	afterEach(() => {
		db.close();
	});

	it("persists both fields when set, including a zero value for each", async () => {
		await repo.save({
			id: "req-align-1",
			method: "POST",
			path: "/v1/messages",
			accountUsed: null,
			statusCode: 200,
			success: true,
			errorMessage: null,
			responseTime: 100,
			failoverAttempts: 0,
			alignmentScore: 0,
			volatileFindingsCount: 0,
		});

		const row = db
			.prepare(
				"SELECT alignment_score, volatile_findings_count FROM requests WHERE id = ?",
			)
			.get("req-align-1") as {
			alignment_score: number | null;
			volatile_findings_count: number | null;
		};

		// `0` is a semantically valid value and must not be coerced to null.
		expect(row.alignment_score).toBe(0);
		expect(row.volatile_findings_count).toBe(0);
	});

	it("persists non-zero values correctly", async () => {
		await repo.save({
			id: "req-align-2",
			method: "POST",
			path: "/v1/messages",
			accountUsed: null,
			statusCode: 200,
			success: true,
			errorMessage: null,
			responseTime: 100,
			failoverAttempts: 0,
			alignmentScore: 87,
			volatileFindingsCount: 3,
		});

		const row = db
			.prepare(
				"SELECT alignment_score, volatile_findings_count FROM requests WHERE id = ?",
			)
			.get("req-align-2") as {
			alignment_score: number | null;
			volatile_findings_count: number | null;
		};

		expect(row.alignment_score).toBe(87);
		expect(row.volatile_findings_count).toBe(3);
	});

	it("defaults both fields to NULL when omitted", async () => {
		await repo.save({
			id: "req-align-3",
			method: "POST",
			path: "/v1/messages",
			accountUsed: null,
			statusCode: 200,
			success: true,
			errorMessage: null,
			responseTime: 100,
			failoverAttempts: 0,
		});

		const row = db
			.prepare(
				"SELECT alignment_score, volatile_findings_count FROM requests WHERE id = ?",
			)
			.get("req-align-3") as {
			alignment_score: number | null;
			volatile_findings_count: number | null;
		};

		expect(row.alignment_score).toBeNull();
		expect(row.volatile_findings_count).toBeNull();
	});

	it("ON CONFLICT upsert preserves previously-set alignmentScore via COALESCE when a later write omits it", async () => {
		await repo.save({
			id: "req-align-upsert",
			method: "POST",
			path: "/v1/messages",
			accountUsed: null,
			statusCode: 200,
			success: true,
			errorMessage: null,
			responseTime: 100,
			failoverAttempts: 0,
			alignmentScore: 5,
			volatileFindingsCount: 2,
		});

		// Second write (e.g. a later usage update) omits the alignment fields —
		// COALESCE(EXCLUDED.x, requests.x) must keep the original values, not
		// overwrite them with null.
		await repo.save({
			id: "req-align-upsert",
			method: "POST",
			path: "/v1/messages",
			accountUsed: "acc-1",
			statusCode: 200,
			success: true,
			errorMessage: null,
			responseTime: 150,
			failoverAttempts: 0,
		});

		const row = db
			.prepare(
				"SELECT alignment_score, volatile_findings_count, account_used FROM requests WHERE id = ?",
			)
			.get("req-align-upsert") as {
			alignment_score: number | null;
			volatile_findings_count: number | null;
			account_used: string | null;
		};

		expect(row.alignment_score).toBe(5);
		expect(row.volatile_findings_count).toBe(2);
		expect(row.account_used).toBe("acc-1");
	});
});

describe("RequestRepository.saveCompressionEvents", () => {
	let db: Database;
	let repo: RequestRepository;

	beforeEach(async () => {
		({ db, repo } = makeRepo());
		// compression_events has a NOT NULL request_id but no FK enforcement in
		// this schema, so a real requests row isn't strictly required — insert
		// one anyway to mirror realistic usage.
		await repo.save({
			id: "req-ce-1",
			method: "POST",
			path: "/v1/messages",
			accountUsed: null,
			statusCode: 200,
			success: true,
			errorMessage: null,
			responseTime: 100,
			failoverAttempts: 0,
		});
	});

	afterEach(() => {
		db.close();
	});

	it("persists a batch of events with correct field mapping, including cacheHit boolean -> 0/1", async () => {
		await repo.saveCompressionEvents([
			{
				id: "ce-1",
				requestId: "req-ce-1",
				contentType: "text/plain",
				compressorUsed: "gzip",
				strategy: "aggressive",
				compressionRatio: 0.42,
				tokensBefore: 1000,
				tokensAfter: 420,
				charsBefore: 4000,
				charsAfter: 1680,
				cacheHit: true,
				timestamp: 1000,
			},
			{
				id: "ce-2",
				requestId: "req-ce-1",
				contentType: null,
				compressorUsed: "none",
				strategy: null,
				compressionRatio: null,
				tokensBefore: null,
				tokensAfter: null,
				charsBefore: null,
				charsAfter: null,
				cacheHit: false,
				timestamp: 2000,
			},
		]);

		const rows = db
			.prepare(
				"SELECT * FROM compression_events WHERE request_id = ? ORDER BY timestamp ASC",
			)
			.all("req-ce-1") as Array<{
			id: string;
			request_id: string;
			content_type: string | null;
			compressor_used: string;
			strategy: string | null;
			compression_ratio: number | null;
			tokens_before: number | null;
			tokens_after: number | null;
			chars_before: number | null;
			chars_after: number | null;
			cache_hit: number;
			timestamp: number;
		}>;

		expect(rows.length).toBe(2);

		expect(rows[0]).toMatchObject({
			id: "ce-1",
			request_id: "req-ce-1",
			content_type: "text/plain",
			compressor_used: "gzip",
			strategy: "aggressive",
			compression_ratio: 0.42,
			tokens_before: 1000,
			tokens_after: 420,
			chars_before: 4000,
			chars_after: 1680,
			cache_hit: 1,
			timestamp: 1000,
		});

		expect(rows[1]).toMatchObject({
			id: "ce-2",
			request_id: "req-ce-1",
			content_type: null,
			compressor_used: "none",
			strategy: null,
			compression_ratio: null,
			tokens_before: null,
			tokens_after: null,
			chars_before: null,
			chars_after: null,
			cache_hit: 0,
			timestamp: 2000,
		});
	});

	it("is a no-op for an empty array (no error, no rows inserted)", async () => {
		await expect(repo.saveCompressionEvents([])).resolves.toBeUndefined();

		const row = db
			.prepare("SELECT COUNT(*) as count FROM compression_events")
			.get() as { count: number };

		expect(row.count).toBe(0);
	});
});
