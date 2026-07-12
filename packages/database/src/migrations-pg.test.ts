/**
 * Tests for the PostgreSQL migration functions in `./migrations-pg`
 * (ensureSchemaPg / runMigrationsPg), covering the compression & cache-
 * alignment insights schema additions (see the SQLite equivalent in
 * `migrations.test.ts`).
 *
 * This repo has no real-or-containerized Postgres available to tests (no
 * testcontainers, no docker-compose Postgres service, no gated env var) —
 * the only existing Postgres-flavored test,
 * `adapters/__tests__/bun-sql-adapter-pg-integer-retry.test.ts`, follows the
 * same approach used here: stub a minimal fake standing in for Bun's SQL
 * client (reached via `(adapter as any).sql`) rather than connecting to a
 * real database. `ensureSchemaPg`/`runMigrationsPg` only ever call
 * `adapter.unsafe()`, `adapter.get()`, and `adapter.run()`, all of which
 * delegate to a single `sql.unsafe(query, params)` call under the hood — so
 * a fake that understands just the handful of DDL/DML shapes these two
 * functions emit is enough to exercise the real migration code end-to-end
 * and assert on the resulting schema, without needing a real Postgres.
 */
import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { BunSqlAdapter } from "./adapters/bun-sql-adapter";
import { ensureSchemaPg, runMigrationsPg } from "./migrations-pg";

/**
 * Minimal in-memory stand-in for Bun's SQL client, understanding only the
 * statement shapes that `ensureSchemaPg`/`runMigrationsPg` emit:
 *  - CREATE TABLE IF NOT EXISTS name (...)
 *  - CREATE [UNIQUE] INDEX IF NOT EXISTS name ON table(...)
 *  - ALTER TABLE table ADD COLUMN col ...
 *  - SELECT COUNT(*) as exists FROM information_schema.columns WHERE ...
 *  - SELECT COUNT(*) as exists FROM information_schema.tables WHERE ...
 * Anything else (UPDATE/INSERT/ALTER COLUMN .../seed data) is a harmless
 * no-op, matching how a real Postgres would respond to idempotent DML
 * against a schema that already satisfies it.
 */
class FakePgSql {
	/** table name -> set of column names */
	readonly tables = new Map<string, Set<string>>();
	/** table name -> set of index names */
	readonly indexes = new Map<string, Set<string>>();
	/** every raw SQL string passed to unsafe(), for text-level assertions */
	readonly calls: string[] = [];

	// biome-ignore lint/suspicious/noExplicitAny: fake SQL client stub for testing
	async unsafe(sqlStr: string, params: any[] = []): Promise<unknown> {
		this.calls.push(sqlStr);
		const trimmed = sqlStr.trim();

		const createTable = trimmed.match(
			/^CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*)\)\s*$/i,
		);
		if (createTable) {
			const [, table, body] = createTable;
			if (!this.tables.has(table)) {
				this.tables.set(table, new Set(this.parseColumnNames(body)));
			}
			return [];
		}

		const createIndex = trimmed.match(
			/^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+) ON (\w+)/i,
		);
		if (createIndex) {
			const [, indexName, table] = createIndex;
			if (!this.indexes.has(table)) this.indexes.set(table, new Set());
			this.indexes.get(table)?.add(indexName);
			return [];
		}

		const addColumn = trimmed.match(/^ALTER TABLE (\w+) ADD COLUMN (\w+)/i);
		if (addColumn) {
			const [, table, column] = addColumn;
			if (!this.tables.has(table)) this.tables.set(table, new Set());
			this.tables.get(table)?.add(column);
			return [];
		}

		if (/FROM information_schema\.columns/i.test(trimmed)) {
			const [table, column] = params as [string, string];
			const exists = this.tables.get(table)?.has(column) ? 1 : 0;
			return [{ exists }];
		}

		if (/FROM information_schema\.tables/i.test(trimmed)) {
			const [table] = params as [string];
			const exists = this.tables.has(table) ? 1 : 0;
			return [{ exists }];
		}

		// UPDATE/INSERT/ALTER COLUMN DROP NOT NULL/etc. — no-op.
		return [];
	}

	on(): void {
		// No-op — mirrors the existing bun-sql-adapter-pg-integer-retry fake.
	}

	private parseColumnNames(body: string): string[] {
		const parts: string[] = [];
		let depth = 0;
		let current = "";
		for (const ch of body) {
			if (ch === "(") depth++;
			if (ch === ")") depth--;
			if (ch === "," && depth === 0) {
				parts.push(current);
				current = "";
			} else {
				current += ch;
			}
		}
		if (current.trim()) parts.push(current);
		return parts
			.map((c) => c.trim())
			.filter((c) => c.length > 0)
			.filter((c) => !/^FOREIGN KEY\b/i.test(c))
			.filter((c) => !/^PRIMARY KEY\s*\(/i.test(c))
			.map((c) => c.split(/\s+/)[0]);
	}
}

function makeAdapter(): { adapter: BunSqlAdapter; fake: FakePgSql } {
	const fake = new FakePgSql();
	// biome-ignore lint/suspicious/noExplicitAny: constructing adapter with a fake SQL client for testing
	const adapter = new BunSqlAdapter(fake as any, false);
	return { adapter, fake };
}

const COMPRESSION_EVENTS_COLUMNS = [
	"id",
	"request_id",
	"content_type",
	"compressor_used",
	"strategy",
	"compression_ratio",
	"tokens_before",
	"tokens_after",
	"chars_before",
	"chars_after",
	"cache_hit",
	"timestamp",
];

describe("PostgreSQL Migrations - Compression & Cache-Alignment Insights", () => {
	let adapter: BunSqlAdapter | undefined;

	afterEach(() => {
		adapter = undefined;
	});

	describe("ensureSchemaPg (fresh install)", () => {
		it("creates alignment_score and volatile_findings_count INTEGER columns on requests", async () => {
			const made = makeAdapter();
			adapter = made.adapter;

			await ensureSchemaPg(adapter);

			const requestsColumns = made.fake.tables.get("requests");
			expect(requestsColumns?.has("alignment_score")).toBe(true);
			expect(requestsColumns?.has("volatile_findings_count")).toBe(true);

			// Confirm the emitted DDL text uses INTEGER (not e.g. BIGINT/REAL).
			const requestsCreate = made.fake.calls.find((sql) =>
				/CREATE TABLE IF NOT EXISTS requests/i.test(sql),
			);
			expect(requestsCreate).toContain("alignment_score INTEGER");
			expect(requestsCreate).toContain("volatile_findings_count INTEGER");
		});

		it("creates the compression_events table with its indexes", async () => {
			const made = makeAdapter();
			adapter = made.adapter;

			await ensureSchemaPg(adapter);

			const columns = made.fake.tables.get("compression_events");
			expect(columns).toBeDefined();
			for (const col of COMPRESSION_EVENTS_COLUMNS) {
				expect(columns?.has(col)).toBe(true);
			}

			const indexNames = made.fake.indexes.get("compression_events");
			expect(indexNames?.has("idx_compression_events_request_id")).toBe(true);
			expect(indexNames?.has("idx_compression_events_timestamp")).toBe(true);

			// Verify the Postgres-specific type mapping called out in the task
			// brief: REAL -> DOUBLE PRECISION, INTEGER timestamp -> BIGINT.
			const createSql = made.fake.calls.find((sql) =>
				/CREATE TABLE IF NOT EXISTS compression_events/i.test(sql),
			);
			expect(createSql).toContain("compression_ratio DOUBLE PRECISION");
			expect(createSql).toContain("timestamp BIGINT NOT NULL");
			expect(createSql).not.toContain("REFERENCES");
		});

		it("places the compression_events table after usage_snapshots and before the final log", () => {
			// Structural check against the source rather than runtime behavior:
			// the brief requires this ordering explicitly.
			const source = fs.readFileSync(
				path.join(__dirname, "migrations-pg.ts"),
				"utf-8",
			);
			const ensureSchemaBody = source.slice(
				source.indexOf("export async function ensureSchemaPg"),
				source.indexOf("export async function runMigrationsPg"),
			);
			const usageSnapshotsIdx = ensureSchemaBody.indexOf(
				"idx_usage_snapshots_ts",
			);
			const compressionEventsIdx = ensureSchemaBody.indexOf(
				"CREATE TABLE IF NOT EXISTS compression_events",
			);
			const logIdx = ensureSchemaBody.indexOf(
				'log.info("PostgreSQL schema ensured")',
			);
			expect(usageSnapshotsIdx).toBeGreaterThan(-1);
			expect(compressionEventsIdx).toBeGreaterThan(usageSnapshotsIdx);
			expect(logIdx).toBeGreaterThan(compressionEventsIdx);
		});
	});

	describe("runMigrationsPg (upgrade of a pre-existing install)", () => {
		it("adds alignment_score/volatile_findings_count columns idempotently to a pre-existing requests table", async () => {
			const made = makeAdapter();
			adapter = made.adapter;

			// Simulate a legacy Postgres install: requests table exists but
			// predates the new columns.
			made.fake.tables.set(
				"requests",
				new Set([
					"id",
					"timestamp",
					"method",
					"path",
					"account_used",
					"status_code",
				]),
			);

			await expect(runMigrationsPg(adapter)).resolves.toBeUndefined();

			const columns = made.fake.tables.get("requests");
			expect(columns?.has("alignment_score")).toBe(true);
			expect(columns?.has("volatile_findings_count")).toBe(true);

			// Re-running migrations must not throw or duplicate the column.
			await expect(runMigrationsPg(adapter)).resolves.toBeUndefined();
			expect(made.fake.tables.get("requests")?.has("alignment_score")).toBe(
				true,
			);
		});

		it("adds the compression_events table (with indexes) when upgrading from a pre-compression-insights install", async () => {
			const made = makeAdapter();
			adapter = made.adapter;

			// No compression_events table pre-seeded — simulates an install that
			// opened its DB before ensureSchemaPg ever created this table.
			expect(made.fake.tables.has("compression_events")).toBe(false);

			await runMigrationsPg(adapter);

			const columns = made.fake.tables.get("compression_events");
			expect(columns).toBeDefined();
			for (const col of COMPRESSION_EVENTS_COLUMNS) {
				expect(columns?.has(col)).toBe(true);
			}

			const indexNames = made.fake.indexes.get("compression_events");
			expect(indexNames?.has("idx_compression_events_request_id")).toBe(true);
			expect(indexNames?.has("idx_compression_events_timestamp")).toBe(true);
		});

		it("does not error when compression_events already exists (idempotent on repeat runs)", async () => {
			const made = makeAdapter();
			adapter = made.adapter;

			await runMigrationsPg(adapter);
			expect(made.fake.tables.has("compression_events")).toBe(true);

			await expect(runMigrationsPg(adapter)).resolves.toBeUndefined();
		});

		it("new alignment columns default to NULL semantics (column added without a DEFAULT clause)", async () => {
			const made = makeAdapter();
			adapter = made.adapter;

			made.fake.tables.set("requests", new Set(["id", "timestamp"]));
			await runMigrationsPg(adapter);

			const alterCalls = made.fake.calls.filter((sql) =>
				/ALTER TABLE requests ADD COLUMN (alignment_score|volatile_findings_count)/i.test(
					sql,
				),
			);
			expect(alterCalls).toHaveLength(2);
			for (const sql of alterCalls) {
				// No DEFAULT clause -> Postgres defaults new column values to NULL.
				expect(sql).not.toMatch(/DEFAULT/i);
			}
		});
	});
});
