import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import { CompressionCache, ContentRouter } from "@tinyclaude/providers";
import type { Account, RequestMeta } from "@tinyclaude/types";
import { RequestBodyContext } from "../../request-body-context";
import * as usageCollectorModule from "../../usage-collector";
import { applyCompressionAndAlignment } from "../compression-step";
import { proxyWithAccount } from "../proxy-operations";
import type { ProxyContext } from "../proxy-types";

/**
 * Integration test for the body-threading seam between compression-step.ts
 * and proxy-operations.ts.
 *
 * applyCompressionAndAlignment (unit-tested in compression-step.test.ts) and
 * proxyWithAccount's failover/retry behaviour (unit-tested in
 * proxy-operations-failover.test.ts) are both well covered in isolation, but
 * nothing previously asserted that a compressed body actually reaches the
 * upstream fetch call. proxyWithAccount accepts both a `requestBodyBuffer`
 * (positional, possibly stale) and an optional `requestBodyContext` — per
 * proxy.ts's real call site, it always prefers `requestBodyContext` (the
 * same object compression-step.ts mutates in place) when present, and the
 * plain buffer param is dead in that case. This test proves that precedence
 * holds by deliberately passing a stale, uncompressed `requestBodyBuffer`
 * alongside a `requestBodyContext` that has already been compressed, and
 * asserting the *compressed* content is what reaches fetch.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function makeAccount(overrides: Partial<Account> = {}): Account {
	return {
		id: "acc-1",
		name: "anthropic-test",
		// Use the real "anthropic" provider (native format) so getProvider()
		// inside proxyWithAccount doesn't rewrite the message shape (e.g. into
		// OpenAI-compat tool_calls/role:"tool") — this test asserts on the
		// tool_result block shape directly, which only the native provider
		// leaves untouched.
		provider: "anthropic",
		api_key: "test-key",
		refresh_token: "",
		access_token: null,
		expires_at: null,
		request_count: 0,
		total_requests: 0,
		last_used: null,
		created_at: Date.now(),
		rate_limited_until: null,
		rate_limited_reason: null,
		rate_limited_at: null,
		session_start: null,
		session_request_count: 0,
		paused: false,
		rate_limit_reset: null,
		rate_limit_status: null,
		rate_limit_remaining: null,
		priority: 0,
		auto_fallback_enabled: false,
		auto_refresh_enabled: false,
		auto_pause_on_overage_enabled: false,
		peak_hours_pause_enabled: false,
		custom_endpoint: "https://openrouter.ai/api/v1",
		model_mappings: null,
		cross_region_mode: null,
		model_fallbacks: null,
		billing_type: null,
		pause_reason: null,
		refresh_token_issued_at: null,
		consecutive_rate_limits: 0,
		...overrides,
	};
}

function makeRequestMeta(): RequestMeta {
	return {
		id: "req-seam-1",
		method: "POST",
		path: "/v1/messages",
		timestamp: Date.now(),
		headers: new Headers(),
	};
}

function makeRequest(body: ArrayBuffer) {
	return new Request("https://proxy.local/v1/messages", {
		method: "POST",
		body,
		headers: { "Content-Type": "application/json" },
	});
}

/** A large-enough JSON blob that ContentRouter will actually compress. */
function makeCompressibleToolResult(): string {
	const obj = {
		items: Array.from({ length: 20 }, (_, i) => ({
			id: i,
			name: `item-${i}`,
			description: "a".repeat(50),
		})),
	};
	return JSON.stringify(obj, null, 2);
}

/** Multi-turn conversation with the tool_result at a non-trailing position. */
function makeRequestBody(toolResultContent: string) {
	return {
		model: "claude-sonnet-4-5",
		max_tokens: 10,
		messages: [
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
			// A later message makes the tool_result non-trailing and therefore
			// eligible for compression.
			{ role: "assistant", content: "here is the file content" },
		],
	};
}

function makeProxyContext(
	overrides: Partial<{
		compressionCache: CompressionCache;
		contentRouter: ContentRouter;
	}> = {},
): ProxyContext {
	return {
		strategy: { getNextAccount: () => null } as never,
		dbOps: {
			markAccountRateLimited: mock(() => Promise.resolve(1)),
			saveRequest: mock((..._args: unknown[]) => Promise.resolve()),
			updateAccountUsage: mock(() => Promise.resolve()),
			updateAccountRateLimitMeta: mock((..._args: unknown[]) =>
				Promise.resolve(),
			),
			saveCompressionEvents: mock((..._args: unknown[]) => Promise.resolve()),
			getAdapter: mock(() => ({
				run: mock(() => Promise.resolve()),
				get: mock(() => Promise.resolve(null)),
			})),
		} as never,
		runtime: { port: 8080, clientId: "test" } as never,
		provider: {
			name: "openai-compatible",
			canHandle: () => true,
			buildUrl: (_path: string, _search: string) =>
				"https://openrouter.ai/api/v1/messages",
			prepareHeaders: (_headers: Headers) => new Headers(),
			transformRequestBody: null,
			processResponse: async (r: Response) => r,
			parseRateLimit: () => ({
				isRateLimited: false,
				resetTime: undefined,
				statusHeader: "allowed",
				remaining: undefined,
			}),
			isStreamingResponse: () => false,
		} as never,
		refreshInFlight: new Map(),
		asyncWriter: {
			enqueue: mock((job: () => void | Promise<void>) => {
				void job();
			}),
		} as never,
		config: {
			getStorePayloads: () => true,
			getCompressContext: () => true,
		} as never,
		compressionCache: overrides.compressionCache ?? new CompressionCache(),
		contentRouter: overrides.contentRouter ?? new ContentRouter(),
	};
}

describe("proxyWithAccount — compressed body reaches upstream fetch (body-threading seam)", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("sends the requestBodyContext's compressed content upstream, not a stale requestBodyBuffer snapshot", async () => {
		// UsageCollector is a module-level singleton normally initialized by
		// server startup; stub it here so this test doesn't depend on init
		// order relative to other test files in the same `bun test` run.
		const collector = {
			handleStart: mock(() => {}),
			handleChunk: mock(() => {}),
			handleEnd: mock(() => Promise.resolve()),
		};
		spyOn(usageCollectorModule, "getUsageCollector").mockReturnValue(
			collector as unknown as usageCollectorModule.UsageCollector,
		);

		const toolResultContent = makeCompressibleToolResult();
		const originalBody = makeRequestBody(toolResultContent);
		const originalBuffer = encoder.encode(JSON.stringify(originalBody))
			.buffer as ArrayBuffer;

		// Mirrors proxy.ts's real flow: a RequestBodyContext is built from the
		// raw request buffer, then applyCompressionAndAlignment mutates it
		// in place when compress_context is enabled.
		const ctx = makeProxyContext();
		const requestBodyContext = new RequestBodyContext(originalBuffer);
		const { alignmentScore } = applyCompressionAndAlignment(
			requestBodyContext,
			ctx,
			"req-seam-1",
		);
		expect(alignmentScore).not.toBeNull();
		expect(requestBodyContext.isDirty).toBe(true);

		const compressedBuffer = requestBodyContext.getBuffer();
		expect(compressedBuffer).not.toBeNull();
		expect(compressedBuffer).not.toBe(originalBuffer);

		let capturedBodyText: string | null = null;
		globalThis.fetch = mock(async (input: RequestInfo | URL) => {
			const req = input instanceof Request ? input : new Request(String(input));
			capturedBodyText = await req.text();
			return new Response(
				JSON.stringify({
					id: "msg_1",
					type: "message",
					role: "assistant",
					content: [{ type: "text", text: "hi" }],
					model: "claude-sonnet-4-5",
					stop_reason: "end_turn",
					usage: { input_tokens: 1, output_tokens: 1 },
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		// Deliberately pass the *original* (stale, uncompressed) buffer as the
		// positional requestBodyBuffer param, alongside the compressed
		// requestBodyContext — exactly like proxy.ts does when it threads both
		// finalBodyBuffer and requestBodyContext into proxyWithAccount. If the
		// buffer param were ever mistakenly preferred over requestBodyContext,
		// the assertions below would fail.
		const result = await proxyWithAccount(
			makeRequest(originalBuffer),
			new URL("https://proxy.local/v1/messages"),
			makeAccount(),
			makeRequestMeta(),
			originalBuffer,
			() => undefined,
			0,
			ctx,
			undefined,
			undefined,
			undefined,
			requestBodyContext,
		);

		expect(result).not.toBeNull();
		expect(result?.status).toBe(200);
		expect(capturedBodyText).not.toBeNull();

		const originalText = decoder.decode(originalBuffer);
		// The bytes that reached fetch must differ from the stale original
		// buffer that was passed as the requestBodyBuffer positional param.
		expect(capturedBodyText).not.toBe(originalText);

		const upstreamBody = JSON.parse(capturedBodyText as string);
		const toolResultBlock = upstreamBody.messages[2].content[0];
		// The upstream tool_result content must be the compressed version, not
		// byte-identical to the original tool_result content.
		expect(toolResultBlock.content).not.toBe(toolResultContent);
		expect(toolResultBlock.content.length).toBeLessThan(
			toolResultContent.length,
		);
	});
});
