import { describe, expect, it } from "bun:test";
import { CompressionCache } from "../cache";

// ── contentHash ──────────────────────────────────────────────────────────────

describe("CompressionCache.contentHash", () => {
	it("returns a 32-hex-char string (sha256 truncated to 32 chars), not the old 16-char format", () => {
		const hash = CompressionCache.contentHash("hello world");
		expect(hash).toMatch(/^[0-9a-f]{32}$/);
	});

	it("produces different hashes for clearly different inputs", () => {
		const a = CompressionCache.contentHash("hello world");
		const b = CompressionCache.contentHash("goodbye world");
		expect(a).not.toBe(b);
	});

	it("is deterministic/stable across repeated calls for the same input", () => {
		const first = CompressionCache.contentHash("some tool_result content here");
		const second = CompressionCache.contentHash(
			"some tool_result content here",
		);
		expect(first).toBe(second);
	});

	it("does not match what the old homemade rolling-hash algorithm would have produced", () => {
		const input = "some tool_result content here";

		// Reimplementation of the deleted `_md5Hex` for comparison purposes only —
		// proves the algorithm actually changed, not just the output length/format.
		function oldMd5Hex(str: string): string {
			let hash = 0;
			for (let i = 0; i < str.length; i++) {
				const chr = str.charCodeAt(i);
				hash = ((hash << 5) - hash + chr) | 0; // eslint-disable-line no-bitwise
			}
			const bytes = new Uint8Array(4);
			bytes[0] = (hash >>> 24) & 0xff;
			bytes[1] = (hash >>> 16) & 0xff;
			bytes[2] = (hash >>> 8) & 0xff;
			bytes[3] = hash & 0xff;
			let hex = "";
			for (const b of bytes) {
				hex += b.toString(16).padStart(2, "0");
			}
			for (let i = 0; i < 12; i++) {
				const c = str.charCodeAt(i % str.length) || 0;
				hex += ((hash + c) & 0x0f).toString(16);
			}
			return hex.slice(0, 16);
		}

		const oldStyleHash = oldMd5Hex(input);
		const newHash = CompressionCache.contentHash(input);
		expect(newHash).not.toBe(oldStyleHash);
		expect(newHash.startsWith(oldStyleHash)).toBe(false);
	});
});

// ── storeCompressed / getCompressed round-trip ─────────────────────────────────

describe("CompressionCache — storeCompressed/getCompressed round-trip", () => {
	it("stores and retrieves a compressed value by hash and length", () => {
		const cache = new CompressionCache();
		const hash = CompressionCache.contentHash("original content");

		cache.storeCompressed(hash, "compressed!", 10, "original content".length);
		const result = cache.getCompressed(hash, "original content".length);

		expect(result).toBe("compressed!");
	});

	it("getCompressed(hash) with no second argument still works exactly as before", () => {
		const cache = new CompressionCache();
		const hash = CompressionCache.contentHash("original content");

		cache.storeCompressed(hash, "compressed!", 10, "original content".length);
		const result = cache.getCompressed(hash);

		expect(result).toBe("compressed!");
	});

	it("returns null and increments misses for an unknown hash", () => {
		const cache = new CompressionCache();
		const result = cache.getCompressed("deadbeef");

		expect(result).toBeNull();
		expect(cache.getStats().misses).toBe(1);
	});
});

// ── Length guard ────────────────────────────────────────────────────────────

describe("CompressionCache — originalLength collision guard", () => {
	it("returns null (miss) on a length mismatch, without evicting the entry", () => {
		const cache = new CompressionCache();
		const hash = "guarded-hash";

		cache.storeCompressed(hash, "compressed-value", 5, 100);

		// Mismatched length — must be treated as a miss, not served.
		const mismatched = cache.getCompressed(hash, 999);
		expect(mismatched).toBeNull();
		expect(cache.getStats().misses).toBe(1);

		// The entry must still be present — a subsequent lookup with the
		// correct length must still succeed (not evicted/deleted).
		const correct = cache.getCompressed(hash, 100);
		expect(correct).toBe("compressed-value");
		expect(cache.getStats().hits).toBe(1);
	});

	it("does not increment hits on a length-mismatch miss", () => {
		const cache = new CompressionCache();
		const hash = "guarded-hash-2";
		cache.storeCompressed(hash, "compressed-value", 5, 50);

		cache.getCompressed(hash, 51);

		expect(cache.getStats().hits).toBe(0);
		expect(cache.getStats().misses).toBe(1);
	});

	it("never triggers the guard for entries stored without a length (sentinel -1)", () => {
		const cache = new CompressionCache();
		const hash = "unguarded-hash";

		// No fourth argument — stored with the sentinel -1 originalLength.
		cache.storeCompressed(hash, "compressed-value", 5);

		expect(cache.getCompressed(hash, 12345)).toBe("compressed-value");
		expect(cache.getCompressed(hash, 0)).toBe("compressed-value");
		expect(cache.getCompressed(hash)).toBe("compressed-value");
		expect(cache.getStats().misses).toBe(0);
	});
});
