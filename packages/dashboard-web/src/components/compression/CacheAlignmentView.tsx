import type { CompressionInsightsResponse } from "@tinyclaude/types";
import { formatNumber } from "@tinyclaude/ui-common";
import { Activity, ShieldCheck } from "lucide-react";
import type { TimeRange } from "../../constants";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../ui/card";

interface CacheAlignmentViewProps {
	data?: CompressionInsightsResponse;
	loading?: boolean;
	timeRange: TimeRange;
}

function alignmentColorClass(score: number): string {
	if (score >= 80) return "text-green-500";
	if (score >= 50) return "text-yellow-500";
	return "text-destructive";
}

export function CacheAlignmentView({
	data,
	loading: _loading = false,
	timeRange,
}: CacheAlignmentViewProps) {
	const totals = data?.totals;
	const score = totals?.avgAlignmentScore ?? null;

	return (
		<div className="space-y-6">
			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							Avg Cache Alignment Score
						</CardTitle>
						<ShieldCheck className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div
							className={`text-2xl font-bold ${score !== null ? alignmentColorClass(score) : ""}`}
						>
							{score !== null ? score.toFixed(0) : "—"}
							<span className="text-sm font-normal text-muted-foreground">
								{" "}
								/ 100
							</span>
						</div>
						<p className="text-xs text-muted-foreground">
							Higher means fewer volatile prefix breaks in the last {timeRange}
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							Requests Analyzed
						</CardTitle>
						<Activity className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{formatNumber(totals?.requests ?? 0)}
						</div>
						<p className="text-xs text-muted-foreground">
							Alignment scoring runs on every request, independent of the
							compression setting
						</p>
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>What is cache alignment?</CardTitle>
					<CardDescription>
						A 0–100 score of how much volatile content (timestamps, random IDs,
						and similar per-turn noise) appears in system-prompt-adjacent
						content, which can break Anthropic's prompt-prefix cache. Lower
						scores mean more volatile findings were detected.
					</CardDescription>
				</CardHeader>
			</Card>
		</div>
	);
}
