import { AlertTriangle } from "lucide-react";
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

export function CachingSection() {
	return (
		<Card className="card-hover">
			<CardHeader>
				<CardTitle>Caching flow — two distinct layers</CardTitle>
				<CardDescription>
					A passive analytics score, and the actual upstream prompt cache — easy
					to conflate, worth keeping separate.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4 text-sm">
				<div>
					<div className="flex items-center gap-2 mb-2">
						<Badge variant="outline">ANALYTICS ONLY</Badge>
						<p className="text-sm font-medium">Cache alignment scoring</p>
					</div>
					<p className="text-xs text-muted-foreground">
						<Ref>computeAlignmentScore()</Ref>,{" "}
						<Ref>cache-aligner/detector.ts:200</Ref>. Scans system messages for
						volatile tokens (UUIDs, timestamps, JWTs, hex hashes, API keys),
						deducting 10 points per finding from a starting score of 100. Purely
						a dashboard signal — it never rewrites or mutates anything.
					</p>
				</div>

				<div>
					<div className="flex items-center gap-2 mb-2">
						<Badge variant="outline">CACHE_CONTROL</Badge>
						<p className="text-sm font-medium">
							Actual Anthropic prompt caching
						</p>
					</div>
					<ul className="space-y-2 list-disc pl-5 text-muted-foreground text-xs">
						<li>
							<Ref>injectSystemCacheTtl()</Ref> (<Ref>proxy.ts:604</Ref>)
							optionally upgrades{" "}
							<Ref>{'cache_control: {type:"ephemeral"}'}</Ref> blocks to add{" "}
							<Ref>{'ttl:"1h"'}</Ref>.
						</li>
						<li>
							For OpenAI-compatible/DashScope providers,{" "}
							<Ref>injectAlibabaCaching()</Ref> injects <Ref>cache_control</Ref>{" "}
							onto the system message and the last user message.
						</li>
						<li>
							<Ref>cache-body-store.ts</Ref> detects <Ref>cache_control</Ref>{" "}
							via a byte-scan plus structural JSON verification, stages request
							bodies per in-flight request, and on completion promotes bodies
							with <Ref>cacheCreationInputTokens &gt; 0</Ref> into a per-account{" "}
							<Ref>lastCachedRequest</Ref> slot.
						</li>
						<li>
							<Ref>cache-keepalive-scheduler.ts</Ref> periodically replays that
							exact cached body upstream (with the keepalive header) to keep
							Anthropic's server-side prompt cache warm before TTL expiry;{" "}
							<Ref>evictStaleEntries()</Ref> drops candidates once they're past
							roughly 3x the TTL.
						</li>
					</ul>
				</div>

				<div className="relative border border-primary/40 bg-card/50 p-4">
					<PanelCorners />
					<div className="flex items-center gap-2 mb-1">
						<AlertTriangle className="h-4 w-4 text-primary" />
						<p className="text-sm font-medium">The key invariant</p>
					</div>
					<p className="text-xs text-muted-foreground">
						Any byte-level change to the cached prefix breaks the{" "}
						<Ref>cache_control</Ref> breakpoint. Compression is content-hash-
						cached and deterministic, so re-sending the same original bytes
						always compresses to the same output — compression itself does{" "}
						<strong>not</strong> invalidate the cache across turns. What{" "}
						<em>would</em> break it: re-compressing already-compressed content
						(exactly why keepalive replays skip the compression step), or any
						non-deterministic mutation of cached-prefix bytes.
					</p>
				</div>
			</CardContent>
		</Card>
	);
}
