/**
 * Content-addressed compression cache with LRU eviction.
 *
 * Ported from Headroom's compression_cache.py.
 *
 * Used to avoid re-compressing messages across turns. Maps original content
 * hashes to their compressed versions.
 */

// ── Types ────────────────────────────────────────────────────────────────────

interface CacheEntry {
	compressed: string;
	tokensSaved: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check if a message is a tool-result message (Anthropic or OpenAI format).
 */
function _isToolResultMessage(msg: Record<string, unknown>): boolean {
	if (msg.role === "tool") return true;
	const content = msg.content;
	if (Array.isArray(content)) {
		return content.some(
			(block: unknown) =>
				typeof block === "object" &&
				block !== null &&
				(block as Record<string, unknown>).type === "tool_result",
		);
	}
	return false;
}

/**
 * Extract text content from a tool-result message (both formats).
 */
function _extractToolResultContent(
	msg: Record<string, unknown>,
): string | null {
	// OpenAI format: role="tool", content is string
	if (msg.role === "tool") {
		const content = msg.content;
		return typeof content === "string" ? content : null;
	}
	// Anthropic format: role="user" with content blocks
	const content = msg.content;
	if (Array.isArray(content)) {
		for (const block of content) {
			if (
				typeof block === "object" &&
				block !== null &&
				(block as Record<string, unknown>).type === "tool_result"
			) {
				const inner = (block as Record<string, unknown>).content;
				return typeof inner === "string" ? inner : null;
			}
		}
	}
	return null;
}

/**
 * Deep-copy a message and replace its tool-result content.
 */
function _swapToolResultContent(
	msg: Record<string, unknown>,
	newContent: string,
): Record<string, unknown> {
	const newMsg = structuredClone(msg);
	// OpenAI format
	if (newMsg.role === "tool") {
		newMsg.content = newContent;
		return newMsg;
	}
	// Anthropic format
	const content = newMsg.content;
	if (Array.isArray(content)) {
		for (const block of content) {
			if (
				typeof block === "object" &&
				block !== null &&
				(block as Record<string, unknown>).type === "tool_result"
			) {
				(block as Record<string, unknown>).content = newContent;
				break;
			}
		}
	}
	return newMsg;
}

/**
 * Compute a short content hash (first 16 hex chars of MD5-style hash).
 */
function _contentHash(content: string | unknown[]): string {
	let raw: string;
	if (Array.isArray(content)) {
		raw = JSON.stringify(content, sortedStringifyReplacer);
	} else {
		raw = String(content);
	}
	return _md5Hex(raw).slice(0, 16);
}

function sortedStringifyReplacer(
	_key: string,
	value: unknown,
): unknown {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		const sorted: Record<string, unknown> = {};
		const obj = value as Record<string, unknown>;
		for (const k of Object.keys(obj).sort()) {
			sorted[k] = obj[k];
		}
		return sorted;
	}
	return value;
}

/** Simple MD5-style hash for content addressing (not cryptographic). */
function _md5Hex(input: string): string {
	let hash = 0;
	for (let i = 0; i < input.length; i++) {
		const chr = input.charCodeAt(i);
		hash = ((hash << 5) - hash + chr) | 0; // eslint-disable-line no-bitwise
	}
	// Generate 32 hex chars from the 32-bit hash (deterministic but not
	// collision-resistant; sufficient for cache keying).
	const bytes = new Uint8Array(4);
	bytes[0] = (hash >>> 24) & 0xff;
	bytes[1] = (hash >>> 16) & 0xff;
	bytes[2] = (hash >>> 8) & 0xff;
	bytes[3] = hash & 0xff;
	let hex = "";
	for (const b of bytes) {
		hex += b.toString(16).padStart(2, "0");
	}
	// Extend to 16 chars by mixing in more bits
	for (let i = 0; i < 12; i++) {
		const c = input.charCodeAt(i % input.length) || 0;
		hex += ((hash + c) & 0x0f).toString(16);
	}
	return hex.slice(0, 16);
}

// ── CompressionCache ─────────────────────────────────────────────────────────

export class CompressionCache {
	private _cache: Map<string, CacheEntry> = new Map();
	private _stableHashes: Set<string> = new Set();
	private _firstSeen: Map<string, number> = new Map();
	private _hits = 0;
	private _misses = 0;
	private _totalTokensSaved = 0;

	constructor(
		public maxEntries: number = 10000,
	) {}

	// ── Public API ────────────────────────────────────────────────────────

	/**
	 * Retrieve compressed content by hash, refreshing LRU position on hit.
	 */
	getCompressed(hash: string): string | null {
		const entry = this._cache.get(hash);
		if (entry === undefined) {
			this._misses++;
			return null;
		}
		this._hits++;
		// Refresh LRU position
		this._cache.delete(hash);
		this._cache.set(hash, entry);
		return entry.compressed;
	}

	/**
	 * Store a compressed version keyed by content hash.
	 * Evicts oldest entries when over capacity.
	 */
	storeCompressed(
		hash: string,
		compressed: string,
		tokensSaved: number,
	): void {
		if (this._cache.has(hash)) {
			const old = this._cache.get(hash)!;
			this._totalTokensSaved -= old.tokensSaved;
			this._cache.delete(hash);
		}
		this._cache.set(hash, { compressed, tokensSaved });
		this._totalTokensSaved += tokensSaved;

		// Evict oldest entries (Map preserves insertion order)
		while (this._cache.size > this.maxEntries) {
			const firstKey = this._cache.keys().next().value;
			if (firstKey === undefined) break;
			const evicted = this._cache.get(firstKey)!;
			this._totalTokensSaved -= evicted.tokensSaved;
			this._cache.delete(firstKey);
		}
	}

	/**
	 * Mark a content hash as stable (unchanged, not compressed).
	 */
	markStable(contentHash: string): void {
		this._stableHashes.add(contentHash);
	}

	/**
	 * Mark all tool-result hashes in messages[:upTo] as stable.
	 */
	markStableFromMessages(
		messages: Array<Record<string, unknown>>,
		upTo: number,
	): void {
		for (const msg of messages.slice(0, upTo)) {
			if (_isToolResultMessage(msg)) {
				const content = _extractToolResultContent(msg);
				if (content !== null) {
					this._stableHashes.add(_contentHash(content));
				}
			}
		}
	}

	/**
	 * Whether to defer compressing this content to avoid mid-TTL busts.
	 *
	 * Returns True if we have evidence this content has been re-sent
	 * within the cache TTL window. Returns False for first sight or
	 * content near the TTL boundary.
	 */
	shouldDeferCompression(
		contentHash: string,
		ttlSeconds = 300,
		batchWindow = 30,
	): boolean {
		const now = Date.now() / 1000;
		const firstSeen = this._firstSeen.get(contentHash);
		if (firstSeen === undefined) {
			this._firstSeen.set(contentHash, now);
			return false; // First time — compress now
		}
		const age = now - firstSeen;
		if (age >= ttlSeconds - batchWindow) {
			return false; // Near TTL boundary — compress now
		}
		return true; // Seen recently — defer to preserve existing cache
	}

	/**
	 * Get cache statistics.
	 */
	getStats(): Record<string, number> {
		return {
			entries: this._cache.size,
			stableHashes: this._stableHashes.size,
			hits: this._hits,
			misses: this._misses,
			tokensSaved: this._totalTokensSaved,
		};
	}

	/**
	 * Compute a short hash for content (static utility).
	 */
	static contentHash(content: string | unknown[]): string {
		return _contentHash(content);
	}

	/**
	 * Count consecutive stable messages from the start.
	 *
	 * A message is stable if it is a plain user/assistant/system message,
	 * an assistant message with tool_use blocks, or a tool_result whose
	 * content hash is already in the cache. The first unstable tool_result
	 * stops the count.
	 *
	 * The trailing message is always excluded (the just-arrived turn has
	 * not yet been sent upstream).
	 */
	computeFrozenCount(messages: Array<Record<string, unknown>>): number {
		let count = 0;
		for (const msg of messages) {
			if (_isToolResultMessage(msg)) {
				const content = _extractToolResultContent(msg);
				if (content !== null) {
					const h = _contentHash(content);
					if (!this._cache.has(h) && !this._stableHashes.has(h)) {
						break;
					}
				} else {
					break; // tool_result with non-string content; treat as unstable
				}
			}
			count++;
		}
		// Reserve the trailing message as the live zone
		return Math.min(count, Math.max(0, messages.length - 1));
	}

	/**
	 * Return a new list with cached compressions swapped into tool results.
	 * Never mutates the input list or any message within it.
	 */
	applyCached(
		messages: Array<Record<string, unknown>>,
	): Array<Record<string, unknown>> {
		const result: Array<Record<string, unknown>> = [];
		for (const msg of messages) {
			if (_isToolResultMessage(msg)) {
				const content = _extractToolResultContent(msg);
				if (content !== null) {
					const h = _contentHash(content);
					const compressed = this.getCompressed(h);
					if (compressed !== null) {
						result.push(_swapToolResultContent(msg, compressed));
						continue;
					}
				}
			}
			result.push(msg);
		}
		return result;
	}

	/**
	 * Cache new compressions by comparing original and compressed messages.
	 * Index-aligned: for each position, if both are tool results and the
	 * content differs, store the mapping original_hash → compressed_content.
	 */
	updateFromResult(
		originals: Array<Record<string, unknown>>,
		compressed: Array<Record<string, unknown>>,
	): void {
		if (originals.length !== compressed.length) {
			console.warn(
				`CompressionCache.updateFromResult: length mismatch (originals=${originals.length}, compressed=${compressed.length}), skipping`,
			);
			return;
		}
		for (let i = 0; i < originals.length; i++) {
			const origContent = _extractToolResultContent(originals[i]);
			const compContent = _extractToolResultContent(compressed[i]);
			if (origContent === null || compContent === null) continue;
			if (origContent === compContent) {
				// Content unchanged — mark as stable
				this._stableHashes.add(_contentHash(origContent));
				continue;
			}
			const h = _contentHash(origContent);
			const tokensSaved = Math.max(
				0,
				Math.floor(origContent.length / 4) -
					Math.floor(compContent.length / 4),
			);
			this.storeCompressed(h, compContent, tokensSaved);
		}
	}
}
