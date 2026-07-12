/**
 * Content type detection — ported from Headroom's detector.py / universal.py.
 *
 * Detects the high-level category of a content block so the ContentRouter can
 * dispatch to the appropriate sub-compressor.
 *
 * This is a heuristic / structural detector (no ML).  It is fast (~0ms) and
 * requires no external dependencies.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export enum ContentType {
	JSON = "json",
	CODE = "code",
	LOG = "log",
	DIFF = "diff",
	MARKDOWN = "markdown",
	TEXT = "text",
	UNKNOWN = "unknown",
}

export interface DetectionResult {
	contentType: ContentType;
	confidence: number; // 0.0 – 1.0
	label: string; // raw label
	language: string | null; // for code: "python", "javascript", …
}

// ── Heuristic indicators ─────────────────────────────────────────────────────

const CODE_INDICATORS = [
	"def ",
	"class ",
	"function ",
	"import ",
	"const ",
	"let ",
	"var ",
	"func ",
	"fn ",
	"pub ",
	"package ",
	"impl ",
	"trait ",
	"enum ",
	"interface ",
	"extends ",
	"// ",
	"/*",
	"*/",
	"=>",
	"->",
	"```",
];

const LOG_INDICATORS = [
	"ERROR",
	"WARN",
	"INFO",
	"DEBUG",
	"FATAL",
	"TRACE",
	"error:",
	"warning:",
	"Error:",
	"Warning:",
	"^\u001b[", // ANSI escape
];

const DIFF_INDICATORS = [
	"diff --git",
	"--- ",
	"+++ ",
	"@@ -",
	"@@ +",
];

const SEARCH_RESULT_PATTERN = /^\S+:\d+:/m;

// ── Detection ────────────────────────────────────────────────────────────────

/**
 * Detect content type using structural heuristics.
 */
export function detectContentType(content: string): DetectionResult {
	if (!content || !content.trim()) {
		return {
			contentType: ContentType.UNKNOWN,
			confidence: 0,
			label: "empty",
			language: null,
		};
	}

	const trimmed = content.trim();

	// 1. JSON detection (try-parse)
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			JSON.parse(trimmed);
			return {
				contentType: ContentType.JSON,
				confidence: 1.0,
				label: "json",
				language: null,
			};
		} catch {
			// Not valid JSON, fall through
		}
	}

	// 2. Diff detection
	if (DIFF_INDICATORS.some((ind) => trimmed.includes(ind))) {
		return {
			contentType: ContentType.DIFF,
			confidence: 0.9,
			label: "diff",
			language: null,
		};
	}

	// 3. Search result detection (file:line: content)
	if (SEARCH_RESULT_PATTERN.test(trimmed)) {
		return {
			contentType: ContentType.CODE, // Search results are code-like
			confidence: 0.7,
			label: "search_result",
			language: null,
		};
	}

	// 4. Log detection
	// Check first 20 lines for log indicators
	const lines = trimmed.split("\n").slice(0, 20);
	const logLineCount = lines.filter((line) =>
		LOG_INDICATORS.some((ind) => line.includes(ind)),
	).length;
	if (logLineCount >= 3) {
		return {
			contentType: ContentType.LOG,
			confidence: 0.8,
			label: "log",
			language: null,
		};
	}

	// 5. Code detection
	if (CODE_INDICATORS.some((ind) => trimmed.includes(ind))) {
		// Try to guess language
		const language = _guessLanguage(trimmed);
		return {
			contentType: ContentType.CODE,
			confidence: 0.7,
			label: "code",
			language,
		};
	}

	// 6. Markdown detection
	if (trimmed.startsWith("#") || trimmed.includes("## ") || /\[.+\]\(.+\)/.test(trimmed)) {
		return {
			contentType: ContentType.MARKDOWN,
			confidence: 0.6,
			label: "markdown",
			language: null,
		};
	}

	// 7. Default to text
	return {
		contentType: ContentType.TEXT,
		confidence: 0.5,
		label: "text",
		language: null,
	};
}

// ── Language guesser (simple keyword-based) ─────────────────────────────────

const LANG_PATTERNS: Array<[string, RegExp]> = [
	["python", /\bdef \w+\s*\(|class \w+.*:|import \w+|from \w+ import/],
	["javascript", /\bconst |\blet |\bvar |\bfunction\b|=>|console\./],
	["typescript", /:\s*(string|number|boolean|any|void)\b|interface \w+|type \w+=/],
	["go", /\bfunc \w+|package \w+|import \(/],
	["rust", /\bfn \w+|let mut|use \w+::|impl \w+/],
	["java", /public class|private \w+|protected \w+|import java\./],
	["c", /#include <|int main\(|void \w+\(/],
	["cpp", /#include <|std::|template|class \w+ \{/],
	["ruby", /\bdef \w+|end\b|require '|attr_/],
	["shell", /#!/,],
];

function _guessLanguage(content: string): string | null {
	for (const [lang, pattern] of LANG_PATTERNS) {
		if (pattern.test(content)) return lang;
	}
	return null;
}

// ── Batch detection ──────────────────────────────────────────────────────────

/**
 * Detect content types for multiple contents.
 */
export function detectBatch(
	contents: string[],
): DetectionResult[] {
	return contents.map((c) => detectContentType(c));
}
