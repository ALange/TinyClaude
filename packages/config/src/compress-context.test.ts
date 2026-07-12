import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Config } from "./index";

function makeConfig(): { config: Config; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), "tinyclaude-config-"));
	return {
		config: new Config(join(dir, "config.json")),
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

describe("getCompressContext", () => {
	const originalEnv = process.env.COMPRESS_CONTEXT;

	beforeEach(() => {
		delete process.env.COMPRESS_CONTEXT;
	});

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.COMPRESS_CONTEXT;
		} else {
			process.env.COMPRESS_CONTEXT = originalEnv;
		}
	});

	it("defaults to false when no env or file override", () => {
		const { config, cleanup } = makeConfig();
		try {
			expect(config.getCompressContext()).toBe(false);
		} finally {
			cleanup();
		}
	});

	it("honors a truthy env override", () => {
		process.env.COMPRESS_CONTEXT = "true";
		const { config, cleanup } = makeConfig();
		try {
			expect(config.getCompressContext()).toBe(true);
		} finally {
			cleanup();
		}
	});

	it("treats 'false' env value as false", () => {
		process.env.COMPRESS_CONTEXT = "false";
		const { config, cleanup } = makeConfig();
		try {
			expect(config.getCompressContext()).toBe(false);
		} finally {
			cleanup();
		}
	});

	it("treats '0' env value as false", () => {
		process.env.COMPRESS_CONTEXT = "0";
		const { config, cleanup } = makeConfig();
		try {
			expect(config.getCompressContext()).toBe(false);
		} finally {
			cleanup();
		}
	});

	it("treats other env values as truthy", () => {
		process.env.COMPRESS_CONTEXT = "yes";
		const { config, cleanup } = makeConfig();
		try {
			expect(config.getCompressContext()).toBe(true);
		} finally {
			cleanup();
		}
	});

	it("honors a config-file override when no env is set", () => {
		const { config, cleanup } = makeConfig();
		try {
			config.setCompressContext(true);
			expect(config.getCompressContext()).toBe(true);
		} finally {
			cleanup();
		}
	});

	it("prioritizes the env override over a config-file value", () => {
		process.env.COMPRESS_CONTEXT = "false";
		const { config, cleanup } = makeConfig();
		try {
			config.setCompressContext(true);
			expect(config.getCompressContext()).toBe(false);
		} finally {
			cleanup();
		}
	});

	it("is included in getAllSettings()", () => {
		const { config, cleanup } = makeConfig();
		try {
			expect(config.getAllSettings().compress_context).toBe(false);
		} finally {
			cleanup();
		}
	});
});
