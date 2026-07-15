import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "../ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../ui/card";
import { PanelCorners } from "../ui/panel-corners";

interface PipelineStep {
	label: string;
	description: string;
	source: string;
	badge?: "CACHE_CONTROL" | "COMPRESSION";
}

const STEPS: PipelineStep[] = [
	{
		label: "Buffer & TTL inject",
		description: "Optionally upgrades cache_control TTL to 1h.",
		source: "proxy.ts:180",
		badge: "CACHE_CONTROL",
	},
	{
		label: "Parse & model routing",
		description: "Body parsed once; model interception may rewrite the model.",
		source: "proxy.ts:230",
	},
	{
		label: "Compress + score",
		description:
			"applyCompressionAndAlignment() mutates messages[], populates the compression cache.",
		source: "compression-step.ts:47",
		badge: "COMPRESSION",
	},
	{
		label: "Send upstream",
		description:
			"proxyWithAccount() sends the body; provider hooks add cache_control breakpoints.",
		source: "proxy.ts:262",
		badge: "CACHE_CONTROL",
	},
	{
		label: "Post-response promote",
		description:
			"onSummary() checks cacheCreationInputTokens, may promote the body into the keepalive slot.",
		source: "cache-body-store.ts",
	},
];

function StepBox({ step }: { step: PipelineStep }) {
	return (
		<div className="relative flex-1 border border-border bg-card/50 p-4 min-w-0">
			<PanelCorners />
			{step.badge && (
				<Badge variant="outline" className="mb-2">
					{step.badge}
				</Badge>
			)}
			<p className="text-sm font-medium">{step.label}</p>
			<p className="text-xs text-muted-foreground mt-1">{step.description}</p>
			<code className="text-xs text-muted-foreground font-mono mt-2 block">
				{step.source}
			</code>
		</div>
	);
}

export function PipelineDiagram() {
	return (
		<Card className="card-hover">
			<CardHeader>
				<CardTitle>Request pipeline</CardTitle>
				<CardDescription>
					Every proxied request passes through these five stages. CACHE_CONTROL
					and COMPRESSION badges mark where each concern actually touches the
					request.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="flex flex-col md:flex-row md:items-stretch gap-3">
					{STEPS.map((step, i) => (
						<div
							key={step.label}
							className="flex flex-col md:flex-row md:items-center gap-2 flex-1"
						>
							<StepBox step={step} />
							{i < STEPS.length - 1 && (
								<div className="flex items-center justify-center text-muted-foreground shrink-0">
									<ChevronRight className="hidden md:block h-5 w-5" />
									<ChevronDown className="md:hidden h-5 w-5" />
								</div>
							)}
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	);
}
