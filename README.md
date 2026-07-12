# tinyclaude

A load-balancing proxy for the Claude API — distributes requests across multiple accounts and providers to avoid rate limits, with request compression, prompt-cache keepalive, and full request-level analytics.

## Usage

```bash
# Install and start (Server + Dashboard on :8080)
bun install -g tinyclaude
tinyclaude

# Add an account
tinyclaude --add-account myaccount --mode claude-oauth --priority 0

# Point Claude Code at the proxy
export ANTHROPIC_BASE_URL=http://localhost:8080
claude
```

Dashboard: `http://localhost:8080/dashboard`

See [Getting Started](docs/index.md) for Docker, systemd, SSL/HTTPS, and Codex CLI setup.

## Functions

- **Load balancing** — session-based, least-used, and session-affinity strategies with automatic failover across account pools
- **Multi-provider support** — Claude OAuth, Claude Console API, AWS Bedrock, Vertex AI, OpenAI-compatible, z.ai, Minimax, OpenRouter, Kilo, Codex, xAI/Grok, Ollama, and more
- **Combos** — named cross-provider fallback chains, one per model family (Opus/Sonnet/Haiku)
- **Request compression** — automatically compresses large tool-result payloads to cut token usage
- **Prompt-cache keepalive** — replays cached requests on a schedule to keep Anthropic's server-side prompt cache warm
- **Auto-fallback / auto-refresh** — restores preferred accounts and starts new usage windows automatically as rate limits reset
- **Real-time analytics** — per-request token usage, latency, cost, and error tracking in the dashboard
- **CLI + REST API** — full account and configuration management from the command line or API
- **Optional API-key auth** — protect the proxy with its own API keys
- **Flexible deployment** — Docker, systemd, or a pre-compiled cross-platform binary (no runtime dependencies)

## Documentation

Full docs in [`docs/`](docs/) — [Getting Started](docs/index.md), [CLI Commands](docs/cli.md), [Architecture](docs/architecture.md), [Configuration](docs/configuration.md), [Load Balancing](docs/load-balancing.md), [Combos](docs/combos.md), [Troubleshooting](docs/troubleshooting.md).

## License

MIT — see [LICENSE](LICENSE).
