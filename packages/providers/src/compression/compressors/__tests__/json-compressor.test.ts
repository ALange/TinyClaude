import { describe, expect, it } from "bun:test";
import { JSONCompressor } from "../json-compressor";

// ── Object key-count metrics (Fix 2) ────────────────────────────────────────

describe("JSONCompressor.compress — object key-count metrics", () => {
	it("reports real key counts for a plain object", () => {
		const compressor = new JSONCompressor();
		const result = compressor.compress(
			JSON.stringify({ a: 1, b: 2, c: 3, d: 4 }),
		);
		// _compressObject is structure-preserving: it never adds or drops keys,
		// only shrinks/truncates values in place — so compressedItems always
		// equals originalItems here. Don't "fix" this back to a ratio-derived
		// number; a mismatch would indicate a key got dropped, which is a bug.
		expect(result.originalItems).toBe(4);
		expect(result.compressedItems).toBe(4);
		expect(result.strategy).toBe("object_preserve_keys");
	});

	it("reports 0/0 for an empty object", () => {
		const compressor = new JSONCompressor();
		const result = compressor.compress("{}");
		expect(result.originalItems).toBe(0);
		expect(result.compressedItems).toBe(0);
	});

	it("regression: a bare JSON primitive still reports hardcoded 1/1 passthrough (not touched by Fix 2)", () => {
		const compressor = new JSONCompressor();
		const result = compressor.compress("42");
		expect(result.originalItems).toBe(1);
		expect(result.compressedItems).toBe(1);
		expect(result.strategy).toBe("passthrough");
	});
});

// ── Embedded-JSON guard (Fix 1) ──────────────────────────────────────────────

describe("JSONCompressor.compress — embedded-JSON guard", () => {
	it("does not corrupt a non-preserved string value that is itself valid JSON", () => {
		const compressor = new JSONCompressor();
		const nested = {
			nested: "object",
			withSome: "fields",
			that: "makes",
			it: "longer than fifty characters total",
		};
		const embedded = JSON.stringify(nested);
		expect(embedded.length).toBeGreaterThan(50);

		const outer = { payload: embedded };
		const result = compressor.compress(JSON.stringify(outer));
		const parsedOuter = JSON.parse(result.compressed) as {
			payload: string;
		};

		expect(parsedOuter.payload).toBe(embedded);
		expect(JSON.parse(parsedOuter.payload)).toEqual(nested);
	});

	it("negative control: an ordinary long non-JSON string under a non-preserved key still gets truncated", () => {
		const compressor = new JSONCompressor();
		const longString = "a".repeat(80);
		const outer = { payload: longString };
		const result = compressor.compress(JSON.stringify(outer));
		const parsedOuter = JSON.parse(result.compressed) as {
			payload: string;
		};

		expect(parsedOuter.payload).toContain("...[compressed]...");
		expect(parsedOuter.payload.length).toBeLessThan(longString.length);
	});

	it("edge case: a string that looks JSON-ish but fails to parse still gets truncated normally", () => {
		const compressor = new JSONCompressor();
		const fakeJson =
			"{not actually json, just text that happens to start with a brace and is over fifty characters long";
		expect(fakeJson.length).toBeGreaterThan(50);

		const outer = { payload: fakeJson };
		const result = compressor.compress(JSON.stringify(outer));
		const parsedOuter = JSON.parse(result.compressed) as {
			payload: string;
		};

		expect(parsedOuter.payload).toContain("...[compressed]...");
		expect(parsedOuter.payload.length).toBeLessThan(fakeJson.length);
	});

	it("edge case: a preserveFields key with a long embedded-JSON value is still returned verbatim", () => {
		const compressor = new JSONCompressor();
		const nested = {
			nested: "object",
			withSome: "fields",
			that: "makes",
			it: "longer than fifty characters total",
		};
		const embedded = JSON.stringify(nested);

		const outer = { id: embedded };
		const result = compressor.compress(JSON.stringify(outer));
		const parsedOuter = JSON.parse(result.compressed) as { id: string };

		expect(parsedOuter.id).toBe(embedded);
	});
});

// ── Nested-array unification (Fix 3) ────────────────────────────────────────

describe("JSONCompressor.compress — nested-array unification", () => {
	it("elements of a <=3-item object-nested array are recursively compressed even though no bounding is needed (Item 6 fix)", () => {
		const compressor = new JSONCompressor();
		const items = Array.from({ length: 3 }, (_, i) => ({
			description: "x".repeat(200),
			index: i,
		}));
		const outer = { items };
		const result = compressor.compress(JSON.stringify(outer));
		const parsedOuter = JSON.parse(result.compressed) as {
			items: Array<{ description: string }>;
		};

		expect(parsedOuter.items.length).toBe(3); // <= 3: no "..." marker inserted
		for (const el of parsedOuter.items) {
			expect(el.description.length).toBeLessThan(200);
		}
	});

	it("kept elements of a >3-item object-nested array are bounded (first 3 + last 2) AND recursively compressed", () => {
		const compressor = new JSONCompressor();
		const items = Array.from({ length: 8 }, (_, i) => ({
			description: "x".repeat(200),
			index: i,
		}));
		const outer = { items };
		const result = compressor.compress(JSON.stringify(outer));
		const parsedOuter = JSON.parse(result.compressed) as {
			items: Array<{ description: string; index: number } | string>;
		};

		expect(parsedOuter.items.length).toBe(6); // 3 kept + "..." + 2 kept
		expect(parsedOuter.items[3]).toBe("...");

		const first = parsedOuter.items[0] as { description: string };
		expect(first.description.length).toBeLessThan(200);
	});

	it("preserveFields keys inside a nested-array context are still preserved verbatim", () => {
		const compressor = new JSONCompressor();
		const longId = "id-".repeat(30); // > 50 chars
		const items = Array.from({ length: 8 }, (_, i) => ({
			id: longId,
			description: "x".repeat(200),
			index: i,
		}));
		const outer = { items };
		const result = compressor.compress(JSON.stringify(outer));
		const parsedOuter = JSON.parse(result.compressed) as {
			items: Array<{ id: string; description: string } | string>;
		};

		const kept = parsedOuter.items.filter(
			(el): el is { id: string; description: string } => typeof el !== "string",
		);
		for (const el of kept) {
			expect(el.id).toBe(longId);
		}
	});

	it("array-of-arrays: sampled outer elements' inner arrays are bounded to at most 6 entries", () => {
		const compressor = new JSONCompressor();
		const topLevel = Array.from({ length: 20 }, () =>
			Array.from({ length: 100 }, (_, i) => `item${i}`),
		);
		const result = compressor.compress(JSON.stringify(topLevel));
		expect(result.strategy).toBe("sampled_15");

		const parsed = JSON.parse(result.compressed) as unknown[];
		for (const el of parsed) {
			if (el === "...") continue;
			const innerArr = el as unknown[];
			expect(innerArr.length).toBeLessThanOrEqual(6);
		}
	});

	it("regression (Finding A): top-level array sampling still preserves an `id` field verbatim in kept items", () => {
		const compressor = new JSONCompressor();
		const longId = "id-".repeat(30); // > 50 chars
		const topLevel = Array.from({ length: 20 }, (_, i) => ({
			id: longId,
			index: i,
		}));
		const result = compressor.compress(JSON.stringify(topLevel));
		expect(result.strategy).toBe("sampled_15");

		const parsed = JSON.parse(result.compressed) as Array<
			{ id: string; index: number } | string
		>;
		for (const el of parsed) {
			if (el === "...") continue;
			expect((el as { id: string }).id).toBe(longId);
		}
	});
});

// ── _compressArray regression smoke tests (untouched by this task) ─────────

describe("JSONCompressor.compress — _compressArray regressions (no logic changed)", () => {
	it("array with <= maxItems (15) items is returned in full", () => {
		const compressor = new JSONCompressor();
		const arr = Array.from({ length: 15 }, (_, i) => i);
		const result = compressor.compress(JSON.stringify(arr));

		expect(result.strategy).toBe("full");
		expect(result.originalItems).toBe(15);
		expect(result.compressedItems).toBe(15);
		expect(JSON.parse(result.compressed)).toEqual(arr);
	});

	it("array with > 15 items is sampled with a '...' marker", () => {
		const compressor = new JSONCompressor();
		const arr = Array.from({ length: 20 }, (_, i) => i);
		const result = compressor.compress(JSON.stringify(arr));

		expect(result.strategy).toBe("sampled_15");
		const parsed = JSON.parse(result.compressed) as unknown[];
		expect(parsed).toContain("...");
		// half = floor(15/2) = 7 first items, then marker, then remaining 8 last items
		expect(parsed[7]).toBe("...");
	});
});
