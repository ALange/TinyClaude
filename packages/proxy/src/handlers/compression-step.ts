import {
	CompressionCache,
	computeAlignmentScore,
	detectVolatileContent,
	extractToolResultContent,
	isToolResultMessage,
	swapToolResultContent,
} from "@tinyclaude/providers";
import type { RequestBodyContext } from "../request-body-context";
import type { ProxyContext } from "./proxy-types";

export interface CompressionAndAlignmentResult {
	alignmentScore: number | null;
	volatileFindingsCount: number | null;
}

interface CompressionEventInput {
	id: string;
	contentType: string | null;
	compressorUsed: string;
	strategy: string | null;
	compressionRatio: number | null;
	tokensBefore: number | null;
	tokensAfter: number | null;
	charsBefore: number | null;
	charsAfter: number | null;
	cacheHit: boolean;
	timestamp: number;
}

/**
 * Always scores cache alignment (non-mutating). If `compress_context` is
 * enabled, also compresses every non-trailing tool_result block (the
 * trailing/live message is always excluded, since it just arrived and
 * hasn't been sent upstream yet), reusing prior compressions from
 * CompressionCache and persisting new ones via ctx.asyncWriter.
 *
 * Eligibility is intentionally NOT gated by `CompressionCache.computeFrozenCount`:
 * that method answers "how much of the prefix is already known-compressed and
 * safe to trust," and its walk stops at the first tool_result whose hash isn't
 * already cached. Gating compression on it would mean a brand-new tool_result
 * could never be compressed for the first time (its hash only becomes known
 * once it's actually compressed) — a permanent lockout. Instead, every
 * non-trailing message is eligible; the cache lookup below still makes
 * already-known content a cheap hit.
 */
export function applyCompressionAndAlignment(
	requestBodyContext: RequestBodyContext,
	ctx: ProxyContext,
	requestId: string,
): CompressionAndAlignmentResult {
	const body = requestBodyContext.getParsedJson();
	const messages = body?.messages;
	if (!Array.isArray(messages)) {
		return { alignmentScore: null, volatileFindingsCount: null };
	}
	const typedMessages = messages as Array<Record<string, unknown>>;

	const alignmentScore = computeAlignmentScore(typedMessages);
	let volatileFindingsCount = 0;
	// Only scans `role: "system"` messages. Anthropic-native requests carry
	// `system` as a top-level request field rather than a message, so this
	// always yields 0 for them — expected, not a detection bug.
	for (const msg of typedMessages) {
		if (msg.role === "system") {
			volatileFindingsCount += detectVolatileContent(
				String(msg.content ?? ""),
			).length;
		}
	}

	if (!ctx.config.getCompressContext()) {
		return { alignmentScore, volatileFindingsCount };
	}

	if (typedMessages.length <= 1) {
		// No non-trailing messages exist yet — nothing to compress.
		return { alignmentScore, volatileFindingsCount };
	}

	const events: CompressionEventInput[] = [];
	const newMessages = typedMessages.slice();
	let mutated = false;

	for (let i = 0; i < typedMessages.length - 1; i++) {
		const msg = typedMessages[i];
		if (!isToolResultMessage(msg)) continue;
		const content = extractToolResultContent(msg);
		if (content === null) continue;

		const hash = CompressionCache.contentHash(content);
		const cached = ctx.compressionCache.getCompressed(hash, content.length);
		const timestamp = Date.now();

		if (cached !== null) {
			if (cached !== content) {
				newMessages[i] = swapToolResultContent(msg, cached);
				mutated = true;
			}
			events.push({
				id: crypto.randomUUID(),
				contentType: null,
				compressorUsed: "cache_hit",
				strategy: null,
				compressionRatio:
					content.length > 0 ? cached.length / content.length : null,
				tokensBefore: Math.ceil(content.length / 4),
				tokensAfter: Math.ceil(cached.length / 4),
				charsBefore: content.length,
				charsAfter: cached.length,
				cacheHit: true,
				timestamp,
			});
			continue;
		}

		const result = ctx.contentRouter.compress(content);
		const tokensSaved = Math.max(0, result.tokensBefore - result.tokensAfter);
		ctx.compressionCache.storeCompressed(
			hash,
			result.compressed,
			tokensSaved,
			content.length,
		);

		if (result.compressed !== content) {
			newMessages[i] = swapToolResultContent(msg, result.compressed);
			mutated = true;
		}

		events.push({
			id: crypto.randomUUID(),
			contentType: result.contentType,
			compressorUsed: result.compressorUsed,
			strategy: result.strategy,
			compressionRatio: result.compressionRatio,
			tokensBefore: result.tokensBefore,
			tokensAfter: result.tokensAfter,
			charsBefore: content.length,
			charsAfter: result.compressed.length,
			cacheHit: false,
			timestamp,
		});
	}

	if (mutated) {
		requestBodyContext.mutateParsedJson((b) => {
			(b as Record<string, unknown>).messages = newMessages;
		});
	}

	if (events.length > 0) {
		ctx.asyncWriter.enqueue(() =>
			ctx.dbOps.saveCompressionEvents(requestId, events),
		);
	}

	return { alignmentScore, volatileFindingsCount };
}
