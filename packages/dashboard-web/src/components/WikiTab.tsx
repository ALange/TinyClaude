import React from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { CachingSection } from "./wiki/CachingSection";
import { CompressionSection } from "./wiki/CompressionSection";
import { InvariantsSection } from "./wiki/InvariantsSection";
import { PipelineDiagram } from "./wiki/PipelineDiagram";

export const WikiTab = React.memo(() => {
	return (
		<div className="space-y-6">
			<Card className="card-hover">
				<CardHeader>
					<CardTitle>What "compression" means here</CardTitle>
					<CardDescription>
						Compression in TinyClaude is lossless-ish shrinking of large{" "}
						<code className="text-xs bg-background px-1 py-0.5 font-mono">
							tool_result
						</code>{" "}
						payloads (JSON, logs, search results) — it is not conversation
						summarization, and there's no message-dropping or history-trimming
						logic. Caching is a separate concern: keeping Anthropic's
						server-side prompt cache warm across turns. This page shows how the
						two interact.
					</CardDescription>
				</CardHeader>
			</Card>

			<PipelineDiagram />
			<CompressionSection />
			<CachingSection />
			<InvariantsSection />
		</div>
	);
});
