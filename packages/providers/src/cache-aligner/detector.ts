/**
 * Cache alignment detector — ported from Headroom's cache_aligner.py
 *
 * Detects volatile / dynamic content in system prompts that would prevent
 * prefix-cache hits across turns.  This is a **detector-only** module:
 * it NEVER rewrites messages.  It emits findings that callers can use for
 * logging, metrics, or warnings.
 *
 * Detected patterns (all structural — no regex):
 * - UUIDs (RFC 4122 canonical form, 36 chars with dashes)
 * - ISO 8601 datetimes (via Date.parse)
 * - JWTs (three base64url-encoded segments separated by dots)
 * - Hex hashes (MD5=32, SHA1=40, SHA256=64 hex chars)
 * - API keys / tokens (sk-... , api_key_... patterns)
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** Canonical UUID (RFC 4122) with dashes is 36 chars. */
const UUID_CANONICAL_LEN = 36;

/** JWT shape constraint: exactly three segments. */
const JWT_SEGMENT_COUNT = 3;
const JWT_MIN_SEGMENT_BYTES = 4;

/** Hex hash lengths for MD5, SHA1, SHA256. */
const HEX_HASH_LENGTHS = new Set([32, 40, 64]);

/** Minimum length for entropy scoring (skip short tokens). */
const MIN_ENTROPY_TOKEN_LENGTH = 8;

/** Token labels — kept stable so log consumers can filter. */
const LABEL_UUID = "uuid";
const LABEL_ISO8601 = "iso8601";
const LABEL_JWT = "jwt";
const LABEL_HEX_HASH = "hex_hash";
const LABEL_API_KEY = "api_key";

// ── Types ────────────────────────────────────────────────────────────────────

export interface VolatileFinding {
	/** Pattern label (e.g. "uuid", "iso8601", "jwt", "hex_hash", "api_key"). */
	label: string;
	/** Truncated sample of the matched content (never full secrets). */
	sample: string;
}

// ── Internal detection helpers ───────────────────────────────────────────────

function _isUuid(token: string): boolean {
	if (token.length !== UUID_CANONICAL_LEN) return false;
	if ((token.match(/-/g) || []).length !== 4) return false;
	// Attempt to parse as UUID hex groups: 8-4-4-4-12
	const parts = token.split("-");
	if (parts.length !== 5) return false;
	if (parts[0].length !== 8) return false;
	if (parts[1].length !== 4) return false;
	if (parts[2].length !== 4) return false;
	if (parts[3].length !== 4) return false;
	if (parts[4].length !== 12) return false;
	// Verify all hex
	return parts.every((p) => /^[0-9a-fA-F]+$/.test(p));
}

function _isIso8601(token: string): boolean {
	if (token.length < 8) return false;
	if (!token.includes("T") && !token.includes("-") && !token.includes(":")) {
		return false;
	}
	// Date.parse handles ISO 8601 in modern engines
	const ts = Date.parse(token);
	if (Number.isNaN(ts)) return false;
	// Round-trip to avoid false-positives on bare numbers like "2024" (which
	// Date.parse accepts but are not meaningful timestamps in our context).
	const roundTrip = new Date(ts).toISOString();
	// A meaningful ISO date should have at least a date component (YYYY-MM-DD)
	return roundTrip.length >= 10;
}

function _isJwtShape(token: string): boolean {
	const dotCount = (token.match(/\./g) || []).length;
	if (dotCount !== JWT_SEGMENT_COUNT - 1) return false;
	const segments = token.split(".");
	if (segments.length !== JWT_SEGMENT_COUNT) return false;
	for (const seg of segments) {
		if (seg.length < JWT_MIN_SEGMENT_BYTES) return false;
		// Try base64url decode
		try {
			const padded = seg + "=".repeat((-seg.length % 4 + 4) % 4);
			const decoded = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
			if (decoded.length === 0) return false;
		} catch {
			return false;
		}
	}
	return true;
}

function _isHexHash(token: string): boolean {
	if (!HEX_HASH_LENGTHS.has(token.length)) return false;
	return /^[0-9a-fA-F]+$/.test(token);
}

function _isApiKey(token: string): boolean {
	// Common API key patterns
	if (/^sk-[A-Za-z0-9_-]{12,}$/.test(token)) return true;
	if (/^api_key_[A-Za-z0-9]{8,}$/.test(token)) return true;
	if (/^[A-Za-z0-9_-]{20,}$/.test(token)) {
		// Long alphanumeric with mixed case — could be a key.
		// Only flag if it has high entropy (looks random).
		const upper = (token.match(/[A-Z]/g) || []).length;
		const lower = (token.match(/[a-z]/g) || []).length;
		const digits = (token.match(/[0-9]/g) || []).length;
		const total = token.length;
		// Keys typically have a good mix of at least 2 character classes
		const classes = [upper > 0, lower > 0, digits > 0].filter(Boolean).length;
		return classes >= 2 && total >= 24;
	}
	return false;
}

function _classifyToken(token: string): string | null {
	if (_isUuid(token)) return LABEL_UUID;
	if (token.includes(".") && _isJwtShape(token)) return LABEL_JWT;
	if (_isIso8601(token)) return LABEL_ISO8601;
	if (_isHexHash(token)) return LABEL_HEX_HASH;
	if (_isApiKey(token)) return LABEL_API_KEY;
	return null;
}

function _splitTokens(content: string): string[] {
	if (!content) return [];
	const tokens: string[] = [];
	for (const raw of content.split(/\s+/)) {
		const cleaned = raw.replace(
			/[.,;:!?@#$%^&*()\[\]{}<>"'`~]/g,
			(match, _offset, str) => {
				// Only strip if it's surrounding punctuation (first or last char)
				return "";
			},
		);
		if (cleaned) tokens.push(cleaned);
	}
	return tokens;
}

/**
 * Truncate a token for safe logging. Never log full secrets verbatim.
 */
function _truncateSample(token: string): string {
	if (token.length <= 16) return token;
	return token.slice(0, 8) + "..." + token.slice(-4);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect volatile / dynamic content in arbitrary text.
 *
 * Pure detection: no mutation. Returns one finding per token that matches
 * any structural pattern. Callers can decide whether to emit a warning,
 * alert, or ignore.
 */
export function detectVolatileContent(content: string): VolatileFinding[] {
	if (!content) return [];
	const findings: VolatileFinding[] = [];
	for (const token of _splitTokens(content)) {
		const label = _classifyToken(token);
		if (label === null) continue;
		findings.push({ label, sample: _truncateSample(token) });
	}
	return findings;
}

/**
 * Compute a label → count map from findings for concise reporting.
 */
export function summarizeFindings(
	findings: VolatileFinding[],
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const f of findings) {
		counts[f.label] = (counts[f.label] || 0) + 1;
	}
	return counts;
}

// ── Cache alignment score ────────────────────────────────────────────────────

/**
 * Compute a cache alignment score (0–100) for a set of messages.
 *
 * Higher = fewer volatile patterns detected.  Penalty is 10 points per
 * finding, clamped to [0, 100].  This is a coarse dashboard signal —
 * it does not change behaviour.
 *
 * @param messages - List of message dicts (Anthropic or OpenAI format).
 * @returns Score from 0 (very unstable) to 100 (perfectly stable).
 */
export function computeAlignmentScore(
	messages: Array<Record<string, unknown>>,
): number {
	let score = 100;
	for (const msg of messages) {
		if (msg.role !== "system") continue;
		const content = String(msg.content ?? "");
		if (!content) continue;
		const findings = detectVolatileContent(content);
		score -= findings.length * 10;
	}
	return Math.max(0, Math.min(100, score));
}

/**
 * Compute a short stable hash of system prompt content for cache-hit tracking.
 */
export function computeStablePrefixHash(
	messages: Array<Record<string, unknown>>,
): string {
	const parts: string[] = [];
	for (const msg of messages) {
		if (msg.role === "system") {
			parts.push(String(msg.content ?? ""));
		}
	}
	return _shortHash(parts.join("\n---\n"));
}

function _shortHash(content: string): string {
	let hash = 0;
	for (let i = 0; i < content.length; i++) {
		const chr = content.charCodeAt(i);
		hash = ((hash << 5) - hash + chr) | 0; // eslint-disable-line no-bitwise
	}
	// Convert to unsigned hex
	return (hash >>> 0).toString(16).padStart(8, "0");
}
