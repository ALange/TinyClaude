/**
 * Tests for the DatabaseOperations facade layer added for compression &
 * cache-alignment insights (Task 9):
 *   - `saveRequest()` passing alignmentScore/volatileFindingsCount through to
 *     RequestRepository.save() (persisted as alignment_score /
 *     volatile_findings_count).
 *   - `saveCompressionEvents(requestId, events)` fanning `requestId` out onto
 *     each event before delegating to RequestRepository.saveCompressionEvents.
 *
 * Follows the same construction/verification pattern as
 * integrity-storage-methods.test.ts and auto-vacuum-bootstrap.test.ts: a real
 * file-backed DatabaseOperations instance, verified via a second read-only
 * bun:sqlite connection to the same file (DatabaseOperations doesn't expose
 * its internal connection).
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseOperations } from "../database-operations";

function tempDbPath(): string {
	return join(
		tmpdir(),
		`test-compression-facade-${randomBytes(6).toString("hex")}.db`,
	);
}

function readRow(dbPath: string, sql: string, id: string): unknown {
	const db = new Database(dbPath, { readonly: true });
	try {
		return db.query(sql).get(id);
	} finally {
		db.close();
	}
}

function readAllRows(dbPath: string, sql: string, id: string): unknown[] {
	const db = new Database(dbPath, { readonly: true });
	try {
		return db.query(sql).all(id);
	} finally {
		db.close();
	}
}

describe("DatabaseOperations.saveRequest - alignmentScore/volatileFindingsCount", () => {
	let dbPath: string;
	let dbOps: DatabaseOperations;

	beforeEach(() => {
		dbPath = tempDbPath();
		dbOps = new DatabaseOperations(dbPath);
	});

	afterEach(() => {
		dbOps.dispose?.();
		fs.rmSync(dbPath, { force: true });
		fs.rmSync(`${dbPath}-wal`, { force: true });
		fs.rmSync(`${dbPath}-shm`, { force: true });
	});

	it("persists alignmentScore/volatileFindingsCount when passed as trailing args", async () => {
		await dbOps.saveRequest(
			"req-facade-1",
			"POST",
			"/v1/messages",
			null,
			200,
			true,
			null,
			100,
			0,
			undefined, // usage
			undefined, // agentUsed
			undefined, // apiKeyId
			undefined, // apiKeyName
			undefined, // project
			undefined, // billingType
			undefined, // comboName
			undefined, // originalModel
			undefined, // appliedModel
			87, // alignmentScore
			3, // volatileFindingsCount
		);

		const row = readRow(
			dbPath,
			"SELECT alignment_score, volatile_findings_count FROM requests WHERE id = ?",
			"req-facade-1",
		) as {
			alignment_score: number | null;
			volatile_findings_count: number | null;
		};

		expect(row.alignment_score).toBe(87);
		expect(row.volatile_findings_count).toBe(3);
	});

	it("leaves alignmentScore/volatileFindingsCount NULL when the trailing args are omitted", async () => {
		await dbOps.saveRequest(
			"req-facade-2",
			"POST",
			"/v1/messages",
			null,
			200,
			true,
			null,
			100,
			0,
		);

		const row = readRow(
			dbPath,
			"SELECT alignment_score, volatile_findings_count FROM requests WHERE id = ?",
			"req-facade-2",
		) as {
			alignment_score: number | null;
			volatile_findings_count: number | null;
		};

		expect(row.alignment_score).toBeNull();
		expect(row.volatile_findings_count).toBeNull();
	});
});

describe("DatabaseOperations.saveCompressionEvents", () => {
	let dbPath: string;
	let dbOps: DatabaseOperations;

	beforeEach(async () => {
		dbPath = tempDbPath();
		dbOps = new DatabaseOperations(dbPath);
		// compression_events has a NOT NULL request_id but no FK enforcement,
		// so a real requests row isn't strictly required — insert one anyway
		// to mirror realistic usage (mirrors compression-insights.test.ts).
		await dbOps.saveRequest(
			"req-ce-facade-1",
			"POST",
			"/v1/messages",
			null,
			200,
			true,
			null,
			100,
			0,
		);
	});

	afterEach(() => {
		dbOps.dispose?.();
		fs.rmSync(dbPath, { force: true });
		fs.rmSync(`${dbPath}-wal`, { force: true });
		fs.rmSync(`${dbPath}-shm`, { force: true });
	});

	it("fans the leading requestId out onto every event before delegating to the repository", async () => {
		await dbOps.saveCompressionEvents("req-ce-facade-1", [
			{
				id: "ce-facade-1",
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
				id: "ce-facade-2",
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

		const rows = readAllRows(
			dbPath,
			"SELECT id, request_id, cache_hit FROM compression_events WHERE request_id = ? ORDER BY timestamp ASC",
			"req-ce-facade-1",
		) as Array<{ id: string; request_id: string; cache_hit: number }>;

		expect(rows.length).toBe(2);
		expect(rows[0]).toMatchObject({
			id: "ce-facade-1",
			request_id: "req-ce-facade-1",
			cache_hit: 1,
		});
		expect(rows[1]).toMatchObject({
			id: "ce-facade-2",
			request_id: "req-ce-facade-1",
			cache_hit: 0,
		});
	});

	it("is a no-op for an empty events array", async () => {
		await expect(
			dbOps.saveCompressionEvents("req-ce-facade-1", []),
		).resolves.toBeUndefined();

		const rows = readAllRows(
			dbPath,
			"SELECT id FROM compression_events WHERE request_id = ?",
			"req-ce-facade-1",
		);
		expect(rows.length).toBe(0);
	});
});
