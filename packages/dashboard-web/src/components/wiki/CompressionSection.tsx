import { Badge } from "../ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../ui/card";
import { PanelCorners } from "../ui/panel-corners";

function Ref({ children }: { children: string }) {
	return (
		<code className="text-xs bg-background px-1 py-0.5 font-mono">
			{children}
		</code>
	);
}

export function CompressionSection() {
	return (
		<Card className="card-hover">
			<CardHeader>
				<CardTitle>Compression flow</CardTitle>
				<CardDescription>
					Shrinks large tool_result payloads before they're resent — never
					touches user or assistant text.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3 text-sm">
				<ul className="space-y-2 list-disc pl-5 text-muted-foreground">
					<li>
						Entry point: <Ref>applyCompressionAndAlignment()</Ref>,{" "}
						<Ref>compression-step.ts:47</Ref>, called once per request from{" "}
						<Ref>handleProxy()</Ref> in <Ref>proxy.ts:262</Ref>.
					</li>
					<li>
						Gated by the <Ref>compress_context</Ref> config flag — disabled by
						default.
					</li>
					<li>
						Applies to every message except the last (the trailing message is
						never compressed). Only touches <Ref>tool_result</Ref> blocks
						(Anthropic) / <Ref>role:"tool"</Ref> messages (OpenAI) — user and
						assistant text is never touched.
					</li>
					<li>
						Per block: hash content (sha256, first 32 hex chars) → check the
						compression cache. A hit swaps in the cached compressed string. A
						miss runs <Ref>ContentRouter.compress()</Ref>, which detects content
						type (JSON / log / code-search / plain text) and routes to a
						specialized compressor — JSONCompressor, LogCompressor,
						SearchCompressor, or a SimpleCompressor truncation fallback —
						splitting "mixed" content on code-fence or paragraph boundaries.
					</li>
					<li>Content under 100 characters passes through unchanged.</li>
					<li>
						Skipped entirely on keepalive/auto-refresh replay requests (
						<Ref>x-tinyclaude-keepalive</Ref> /{" "}
						<Ref>x-tinyclaude-auto-refresh</Ref> headers) — this avoids
						double-compressing an already-compressed body.
					</li>
				</ul>
				<div className="relative border border-border bg-card/50 p-4">
					<PanelCorners />
					<div className="flex items-center gap-2 mb-1">
						<Badge variant="outline">FIXED IN bb38263</Badge>
					</div>
					<p className="text-xs text-muted-foreground">
						Earlier versions only compressed the <em>first</em> tool_result
						block in a message. Parallel tool calls pack multiple tool_result
						blocks into a single message, so all but the first silently stayed
						uncompressed forever. Fixed via index-aware{" "}
						<Ref>extractToolResultContents</Ref> /{" "}
						<Ref>swapToolResultContentAt</Ref> (plural) replacing the old
						singular first-only helpers.
					</p>
				</div>
			</CardContent>
		</Card>
	);
}
