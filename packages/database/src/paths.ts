import { join } from "node:path";
import { getPlatformConfigDir } from "@tinyclaude/config";

export function resolveDbPath(): string {
	// Check for explicit DB path from environment
	const explicitPath = process.env.TINYCLAUDE_DB_PATH;
	if (explicitPath) {
		return explicitPath;
	}

	const configDir = getPlatformConfigDir();

	// Always use the same database path for consistency
	// For development/testing, specify a different database using:
	// - Environment variable: TINYCLAUDE_DB_PATH=/path/to/dev.db
	// - Command line flag: --db-path /path/to/dev.db
	// - .env file: TINYCLAUDE_DB_PATH=/path/to/dev.db
	return join(configDir, "tinyclaude.db");
}
