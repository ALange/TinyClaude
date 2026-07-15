import { describe, expect, it, mock, spyOn } from "bun:test";
import {
	CompressionCache,
	ContentRouter,
	computeAlignmentScore,
	detectVolatileContent,
} from "@tinyclaude/providers";
import { RequestBodyContext } from "../../request-body-context";
import { applyCompressionAndAlignment } from "../compression-step";
import type { ProxyContext } from "../proxy-types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

/**
 * Build a RequestBodyContext from a real (encoded) buffer, rather than via
 * `RequestBodyContext.fromParsed` — `fromParsed` unconditionally calls
 * `markDirty()` on construction, which would make `isDirty` useless as a
 * "was this mutated by the function under test" signal in these tests.
 */
function makeRequestBodyContext(body: unknown): RequestBodyContext {
	const bytes = encoder.encode(JSON.stringify(body));
	const buffer = bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	);
	return new RequestBodyContext(buffer);
}

function makeCtx(
	overrides: Partial<{
		compressContext: boolean;
		compressionCache: CompressionCache;
		contentRouter: ContentRouter;
		saveCompressionEvents: ReturnType<typeof mock>;
	}> = {},
): ProxyContext {
	const compressionCache = overrides.compressionCache ?? new CompressionCache();
	const contentRouter = overrides.contentRouter ?? new ContentRouter();
	const saveCompressionEvents =
		overrides.saveCompressionEvents ??
		mock(async (_requestId: string, _events: unknown[]) => {});

	return {
		config: {
			getCompressContext: mock(() => overrides.compressContext ?? false),
		},
		dbOps: {
			saveCompressionEvents,
		},
		asyncWriter: {
			// Run enqueued jobs synchronously so tests can assert on their
			// effects (saveCompressionEvents calls) without waiting on a queue.
			enqueue: mock((job: () => void | Promise<void>) => {
				void job();
			}),
		},
		compressionCache,
		contentRouter,
	} as unknown as ProxyContext;
}

/** A large-enough JSON blob that ContentRouter will actually compress. */
function makeCompressibleToolResult(seed = 0): string {
	const obj = {
		items: Array.from({ length: 20 }, (_, i) => ({
			id: i + seed,
			name: `item-${i}`,
			description: "a".repeat(50),
		})),
	};
	return JSON.stringify(obj, null, 2);
}

function makeMultiTurnMessages(toolResultContent: string) {
	return [
		{ role: "user", content: "please read the config file" },
		{
			role: "assistant",
			content: [
				{ type: "tool_use", id: "call-1", name: "read_file", input: {} },
			],
		},
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "call-1",
					content: toolResultContent,
				},
			],
		},
		{ role: "assistant", content: "here is the file content" },
		{ role: "user", content: "thanks, what should I do next?" },
	];
}

// ── compress_context off ───────────────────────────────────────────────────────

describe("applyCompressionAndAlignment — compress_context disabled", () => {
	it("still computes alignment score/volatile count, never mutates the body, never enqueues", () => {
		const ctx = makeCtx({ compressContext: false });
		const toolResultContent = makeCompressibleToolResult();
		const messages = makeMultiTurnMessages(toolResultContent);
		const rbc = makeRequestBodyContext({ messages });

		const result = applyCompressionAndAlignment(rbc, ctx, "req-1");

		expect(result.alignmentScore).toBe(100);
		expect(result.volatileFindingsCount).toBe(0);
		expect(rbc.isDirty).toBe(false);
		expect(
			ctx.asyncWriter.enqueue as ReturnType<typeof mock>,
		).not.toHaveBeenCalled();
	});
});

// ── compress_context on, single-turn (no frozen prefix) ────────────────────────

describe("applyCompressionAndAlignment — compress_context enabled, single-turn conversation", () => {
	it("computes alignment but performs no compression when there is no non-trailing message", () => {
		const ctx = makeCtx({ compressContext: true });
		// Only the trailing live message exists — every message is excluded as
		// "trailing," so the compression loop never runs.
		const messages = [{ role: "user", content: "hello there" }];
		const rbc = makeRequestBodyContext({ messages });

		const result = applyCompressionAndAlignment(rbc, ctx, "req-2");

		expect(result.alignmentScore).toBe(100);
		expect(result.volatileFindingsCount).toBe(0);
		expect(rbc.isDirty).toBe(false);
		expect(
			ctx.asyncWriter.enqueue as ReturnType<typeof mock>,
		).not.toHaveBeenCalled();
	});
});

// ── compress_context on, multi-turn with a non-trailing tool_result ────────────

describe("applyCompressionAndAlignment — compress_context enabled, non-trailing tool_result", () => {
	it("cache miss: compresses via ContentRouter and enqueues a cache_hit:false event", async () => {
		const compressionCache = new CompressionCache();
		const contentRouter = new ContentRouter();
		const saveCompressionEvents = mock(
			async (_requestId: string, _events: unknown[]) => {},
		);
		const ctx = makeCtx({
			compressContext: true,
			compressionCache,
			contentRouter,
			saveCompressionEvents,
		});

		const toolResultContent = makeCompressibleToolResult();
		const hash = CompressionCache.contentHash(toolResultContent);

		const compressSpy = spyOn(contentRouter, "compress");

		const messages = makeMultiTurnMessages(toolResultContent);
		const rbc = makeRequestBodyContext({ messages });

		const result = applyCompressionAndAlignment(rbc, ctx, "req-3");

		expect(result.alignmentScore).toBe(100);
		expect(compressSpy).toHaveBeenCalledTimes(1);
		expect(compressSpy).toHaveBeenCalledWith(toolResultContent);

		// The body was mutated in place with the compressed tool_result content.
		expect(rbc.isDirty).toBe(true);
		const buffer = rbc.getBuffer();
		expect(buffer).not.toBeNull();
		const decoded = JSON.parse(new TextDecoder().decode(buffer as ArrayBuffer));
		const toolResultBlock = decoded.messages[2].content[0];
		expect(toolResultBlock.content).not.toBe(toolResultContent);
		expect(toolResultBlock.content.length).toBeLessThan(
			toolResultContent.length,
		);

		expect(saveCompressionEvents).toHaveBeenCalledTimes(1);
		const [requestId, events] = saveCompressionEvents.mock.calls[0] as [
			string,
			Array<Record<string, unknown>>,
		];
		expect(requestId).toBe("req-3");
		expect(events).toHaveLength(1);
		expect(events[0]?.cacheHit).toBe(false);
		expect(events[0]?.compressorUsed).toBe("JSONCompressor");
		expect(events[0]?.contentType).toBe("json");

		// The compressed value is now cached under the content hash.
		expect(compressionCache.getCompressed(hash)).not.toBeNull();
	});

	it("cache hit: reuses the cached compression and does not call ContentRouter.compress again", async () => {
		const compressionCache = new CompressionCache();
		const contentRouter = new ContentRouter();
		const saveCompressionEvents = mock(
			async (_requestId: string, _events: unknown[]) => {},
		);
		const ctx = makeCtx({
			compressContext: true,
			compressionCache,
			contentRouter,
			saveCompressionEvents,
		});

		const toolResultContent = makeCompressibleToolResult();
		const _hash = CompressionCache.contentHash(toolResultContent);

		const compressSpy = spyOn(contentRouter, "compress");

		const messages = makeMultiTurnMessages(toolResultContent);

		// First call — cache miss, populates compressionCache._cache.
		const rbc1 = makeRequestBodyContext({ messages });
		applyCompressionAndAlignment(rbc1, ctx, "req-4a");
		expect(compressSpy).toHaveBeenCalledTimes(1);
		saveCompressionEvents.mockClear();

		// Second call — same content, fresh RequestBodyContext (simulates the
		// next turn resending full history). The hash is now genuinely present
		// in `_cache` from the first call's storeCompressed, so the lookup is a
		// cache hit — no seeding required.
		const rbc2 = makeRequestBodyContext({ messages });
		const result = applyCompressionAndAlignment(rbc2, ctx, "req-4b");

		// ContentRouter.compress must NOT be called again — the cache hit path
		// short-circuits before reaching it.
		expect(compressSpy).toHaveBeenCalledTimes(1);

		expect(saveCompressionEvents).toHaveBeenCalledTimes(1);
		const [requestId, events] = saveCompressionEvents.mock.calls[0] as [
			string,
			Array<Record<string, unknown>>,
		];
		expect(requestId).toBe("req-4b");
		expect(events).toHaveLength(1);
		expect(events[0]?.cacheHit).toBe(true);
		expect(events[0]?.compressorUsed).toBe("cache_hit");
		expect(events[0]?.contentType).toBeNull();
		expect(events[0]?.strategy).toBeNull();

		expect(result.alignmentScore).toBe(100);
	});

	/**
	 * Regression test for the frozen-boundary lockout bug: eligibility used to
	 * be gated on `CompressionCache.computeFrozenCount`, which only extends
	 * past a tool_result once its hash is already known to the cache. A
	 * brand-new tool_result's hash never becomes known until it's compressed,
	 * so under the old gating a tool_result could never be compressed on its
	 * first non-trailing appearance — a permanent chicken-and-egg lockout.
	 * With eligibility based purely on "not the trailing message," a
	 * tool_result that arrives live (turn 1, correctly skipped) and then
	 * becomes non-trailing once a later message is appended (turn 2) must be
	 * compressed on turn 2.
	 */
	it("regression: a tool_result skipped as trailing on turn 1 is compressed on turn 2 once it's no longer trailing", () => {
		const compressionCache = new CompressionCache();
		const contentRouter = new ContentRouter();
		const saveCompressionEvents = mock(
			async (_requestId: string, _events: unknown[]) => {},
		);
		const ctx = makeCtx({
			compressContext: true,
			compressionCache,
			contentRouter,
			saveCompressionEvents,
		});

		const toolResultContent = makeCompressibleToolResult();
		const hash = CompressionCache.contentHash(toolResultContent);
		const compressSpy = spyOn(contentRouter, "compress");

		// Turn 1: the tool_result is the trailing (live) message — it must NOT
		// be compressed yet.
		const turn1Messages = [
			{ role: "user", content: "please read the config file" },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "call-1", name: "read_file", input: {} },
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call-1",
						content: toolResultContent,
					},
				],
			},
		];
		const rbc1 = makeRequestBodyContext({ messages: turn1Messages });
		applyCompressionAndAlignment(rbc1, ctx, "req-turn1");

		expect(compressSpy).not.toHaveBeenCalled();
		expect(rbc1.isDirty).toBe(false);
		expect(compressionCache.getCompressed(hash)).toBeNull();

		// Turn 2: a new message was appended after the tool_result, so it is no
		// longer trailing — it must now be compressed (cache miss → compress
		// called, event recorded, hash stored).
		const turn2Messages = [
			...turn1Messages,
			{ role: "assistant", content: "here is the file content" },
		];
		const rbc2 = makeRequestBodyContext({ messages: turn2Messages });
		const result = applyCompressionAndAlignment(rbc2, ctx, "req-turn2");

		expect(compressSpy).toHaveBeenCalledTimes(1);
		expect(compressSpy).toHaveBeenCalledWith(toolResultContent);
		expect(rbc2.isDirty).toBe(true);

		expect(saveCompressionEvents).toHaveBeenCalledTimes(1);
		const [requestId, events] = saveCompressionEvents.mock.calls[0] as [
			string,
			Array<Record<string, unknown>>,
		];
		expect(requestId).toBe("req-turn2");
		expect(events).toHaveLength(1);
		expect(events[0]?.cacheHit).toBe(false);

		expect(compressionCache.getCompressed(hash)).not.toBeNull();
		expect(result.alignmentScore).toBe(100);
	});
});

// ── compress_context on, multiple tool_result blocks in one message ───────────

describe("applyCompressionAndAlignment — multiple tool_result blocks in a single message", () => {
	/**
	 * Regression test: when Claude issues parallel tool calls, Anthropic packs
	 * every resulting tool_result into a SINGLE user message's content array.
	 * The old extractToolResultContent/swapToolResultContent helpers only ever
	 * acted on the first tool_result block found in a message, silently
	 * leaving every other block in that same message uncompressed forever.
	 * All blocks in the message must now be compressed independently.
	 */
	it("compresses every tool_result block in the message, not just the first", () => {
		const compressionCache = new CompressionCache();
		const contentRouter = new ContentRouter();
		const saveCompressionEvents = mock(
			async (_requestId: string, _events: unknown[]) => {},
		);
		const ctx = makeCtx({
			compressContext: true,
			compressionCache,
			contentRouter,
			saveCompressionEvents,
		});

		const firstContent = makeCompressibleToolResult(0);
		const secondContent = makeCompressibleToolResult(1000);
		const firstHash = CompressionCache.contentHash(firstContent);
		const secondHash = CompressionCache.contentHash(secondContent);

		const compressSpy = spyOn(contentRouter, "compress");

		const messages = [
			{ role: "user", content: "please read both config files" },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "call-1", name: "read_file", input: {} },
					{ type: "tool_use", id: "call-2", name: "read_file", input: {} },
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call-1",
						content: firstContent,
					},
					{
						type: "tool_result",
						tool_use_id: "call-2",
						content: secondContent,
					},
				],
			},
			{ role: "assistant", content: "here is both files' content" },
			{ role: "user", content: "thanks, what should I do next?" },
		];
		const rbc = makeRequestBodyContext({ messages });

		const result = applyCompressionAndAlignment(rbc, ctx, "req-parallel");

		expect(compressSpy).toHaveBeenCalledTimes(2);
		expect(compressSpy).toHaveBeenCalledWith(firstContent);
		expect(compressSpy).toHaveBeenCalledWith(secondContent);

		expect(rbc.isDirty).toBe(true);
		const buffer = rbc.getBuffer();
		expect(buffer).not.toBeNull();
		const decoded = JSON.parse(new TextDecoder().decode(buffer as ArrayBuffer));
		const [firstBlock, secondBlock] = decoded.messages[2].content;

		expect(firstBlock.content).not.toBe(firstContent);
		expect(firstBlock.content.length).toBeLessThan(firstContent.length);
		expect(secondBlock.content).not.toBe(secondContent);
		expect(secondBlock.content.length).toBeLessThan(secondContent.length);

		expect(saveCompressionEvents).toHaveBeenCalledTimes(1);
		const [, events] = saveCompressionEvents.mock.calls[0] as [
			string,
			Array<Record<string, unknown>>,
		];
		expect(events).toHaveLength(2);
		expect(events.every((e) => e.cacheHit === false)).toBe(true);

		expect(compressionCache.getCompressed(firstHash)).not.toBeNull();
		expect(compressionCache.getCompressed(secondHash)).not.toBeNull();
		expect(result.alignmentScore).toBe(100);
	});
});

// ── volatile content lowers the alignment score ────────────────────────────────

describe("applyCompressionAndAlignment — volatile content detection", () => {
	it("a UUID in a system message lowers alignmentScore and reports volatileFindingsCount", () => {
		const ctx = makeCtx({ compressContext: false });
		const systemContent =
			"session-id: 3fa85f64-5717-4562-b3fc-2c963f66afa6 please proceed";
		const messages = [
			{ role: "system", content: systemContent },
			{ role: "user", content: "hello" },
		];
		const rbc = makeRequestBodyContext({ messages });

		const result = applyCompressionAndAlignment(rbc, ctx, "req-5");

		const expectedFindings = detectVolatileContent(systemContent).length;
		const expectedScore = computeAlignmentScore(messages);

		expect(expectedFindings).toBeGreaterThan(0);
		expect(result.volatileFindingsCount).toBe(expectedFindings);
		expect(result.alignmentScore).toBe(expectedScore);
		expect(result.alignmentScore).toBeLessThan(100);
	});
});
