import { describe, expect, it } from "bun:test";
import { ContentRouter, ContentType } from "../content-router";

describe("ContentRouter", () => {
	describe("compress() with short content", () => {
		const router = new ContentRouter({ minContentChars: 100 });

		it("minifies short pretty-printed JSON", () => {
			const original = JSON.stringify({ a: 1, b: 2 }, null, 2);
			expect(original.length).toBeLessThan(100);

			const result = router.compress(original);

			// Should be minified
			expect(result.compressed.length).toBeLessThan(original.length);
			// Should use JSONMinifier
			expect(result.compressorUsed).toBe("JSONMinifier");
			// Should have correct strategy
			expect(result.strategy).toBe("json_minify_short");
			// Should preserve data
			expect(JSON.parse(result.compressed)).toEqual({ a: 1, b: 2 });
			// Should have correct content type
			expect(result.contentType).toBe(ContentType.JSON);
			// Should have confidence 1.0
			expect(result.detectionConfidence).toBe(1.0);
		});

		it("does not spuriously compress already-minified short JSON", () => {
			const original = JSON.stringify({ a: 1, b: 2 });
			expect(original.length).toBeLessThan(100);

			const result = router.compress(original);

			// Should stay on old path (passthrough, no savings)
			expect(result.strategy).toBe("passthrough(too_short)");
			expect(result.compressorUsed).toBe("passthrough");
			expect(result.compressed).toBe(original);
		});

		it("leaves short plain text unaffected", () => {
			const original = "hello there, short message";
			expect(original.length).toBeLessThan(100);

			const result = router.compress(original);

			// Should be passthrough
			expect(result.strategy).toBe("passthrough(too_short)");
			expect(result.compressorUsed).toBe("passthrough");
			expect(result.compressed).toBe(original);
			expect(result.contentType).toBe(ContentType.UNKNOWN);
		});

		it("leaves short bare JSON primitive unaffected", () => {
			// Test with "42" (a valid JSON number but doesn't start with { or [)
			const original = "42";
			expect(original.length).toBeLessThan(100);

			const result = router.compress(original);

			// Should be passthrough (not minified)
			expect(result.strategy).toBe("passthrough(too_short)");
			expect(result.compressorUsed).toBe("passthrough");
			expect(result.compressed).toBe(original);
		});

		it("leaves short bare JSON boolean unaffected", () => {
			// Test with "true" (a valid JSON boolean but doesn't start with { or [)
			const original = "true";
			expect(original.length).toBeLessThan(100);

			const result = router.compress(original);

			// Should be passthrough (not minified)
			expect(result.strategy).toBe("passthrough(too_short)");
			expect(result.compressorUsed).toBe("passthrough");
			expect(result.compressed).toBe(original);
		});
	});

	describe("compress() with ≥minContentChars content", () => {
		const router = new ContentRouter({ minContentChars: 100 });

		it("routes long JSON through normal path (not JSONMinifier)", () => {
			// Create JSON that's ≥100 chars but still pretty-printed
			const obj = {
				key1: "this is a reasonably long string value",
				key2: "another long value to make the object bigger",
				key3: 123,
				key4: true,
			};
			const original = JSON.stringify(obj, null, 2);
			expect(original.length).toBeGreaterThanOrEqual(100);

			const result = router.compress(original);

			// Should NOT use JSONMinifier (that's only for short content)
			expect(result.compressorUsed).not.toBe("JSONMinifier");
			// Should use one of the real compressors
			expect(
				["JSONCompressor", "SimpleCompressor", "passthrough"].includes(
					result.compressorUsed,
				),
			).toBe(true);
			// Should not claim it was minified
			expect(result.strategy).not.toBe("json_minify_short");
		});
	});
});
