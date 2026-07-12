import type {
	CompressionInsightsResponse,
	CompressionInsightsRow,
} from "@tinyclaude/types";
import {
	formatNumber,
	formatPercentage,
	formatTokens,
} from "@tinyclaude/ui-common";
import { Layers, Minimize2, Percent, Zap } from "lucide-react";
import type { TimeRange } from "../../constants";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

interface CompressionEfficiencyViewProps {
	data?: CompressionInsightsResponse;
	loading?: boolean;
	timeRange: TimeRange;
}

interface BreakdownTableProps {
	rows: CompressionInsightsRow[];
	nameLabel: string;
}

function BreakdownTable({ rows, nameLabel }: BreakdownTableProps) {
	if (rows.length === 0) {
		return (
			<p className="text-sm text-muted-foreground py-4">
				No data for this period
			</p>
		);
	}

	return (
		<div className="overflow-x-auto">
			<table
				aria-label={`Compression efficiency by ${nameLabel.toLowerCase()}`}
				className="w-full text-sm"
			>
				<thead className="bg-muted/50">
					<tr>
						<th scope="col" className="text-left px-3 py-2">
							{nameLabel}
						</th>
						<th scope="col" className="text-right px-3 py-2">
							Events
						</th>
						<th scope="col" className="text-right px-3 py-2">
							Avg Ratio
						</th>
						<th scope="col" className="text-right px-3 py-2">
							Tokens Saved
						</th>
						<th scope="col" className="text-right px-3 py-2">
							Cache Hit Rate
						</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr key={row.key} className="border-t">
							<td className="px-3 py-2">
								<span className="text-muted-foreground break-all">
									{row.key}
								</span>
							</td>
							<td className="px-3 py-2 text-right">
								{formatNumber(row.events)}
							</td>
							<td className="px-3 py-2 text-right">
								{row.avgRatio !== null ? formatPercentage(row.avgRatio) : "—"}
							</td>
							<td className="px-3 py-2 text-right">
								{formatTokens(row.tokensSaved)}
							</td>
							<td className="px-3 py-2 text-right">
								{formatPercentage(row.cacheHitRate)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export function CompressionEfficiencyView({
	data,
	loading = false,
	timeRange,
}: CompressionEfficiencyViewProps) {
	const totals = data?.totals;
	const liveCache = data?.liveCache;

	return (
		<div className="space-y-6">
			{/* Summary Cards */}
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							Compression Events
						</CardTitle>
						<Layers className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{formatNumber(totals?.compressionEventsCount ?? 0)}
						</div>
						<p className="text-xs text-muted-foreground">
							Tool-result blocks processed in the last {timeRange}
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							Cache Hit Rate
						</CardTitle>
						<Percent className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{formatPercentage(totals?.cacheHitRate ?? 0)}
						</div>
						<p className="text-xs text-muted-foreground">
							Compressed blocks served from cache
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Tokens Saved</CardTitle>
						<Minimize2 className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{formatTokens(totals?.totalTokensSaved ?? 0)}
						</div>
						<p className="text-xs text-muted-foreground">
							Total tokens avoided via compression
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							Avg Compression Ratio
						</CardTitle>
						<Zap className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{totals?.avgCompressionRatio !== null &&
							totals?.avgCompressionRatio !== undefined
								? formatPercentage(totals.avgCompressionRatio)
								: "—"}
						</div>
						<p className="text-xs text-muted-foreground">
							Output size relative to original
						</p>
					</CardContent>
				</Card>
			</div>

			{/* Breakdown */}
			<Card>
				<CardHeader>
					<CardTitle>Compression Breakdown</CardTitle>
					<CardDescription>
						Events, ratio, and savings per dimension in the last {timeRange}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Tabs defaultValue="contentType" className="space-y-4">
						<TabsList className="grid w-full grid-cols-2">
							<TabsTrigger value="contentType">By Content Type</TabsTrigger>
							<TabsTrigger value="compressor">By Compressor</TabsTrigger>
						</TabsList>
						<TabsContent value="contentType">
							<BreakdownTable
								rows={data?.byContentType ?? []}
								nameLabel="Content Type"
							/>
						</TabsContent>
						<TabsContent value="compressor">
							<BreakdownTable
								rows={data?.byCompressor ?? []}
								nameLabel="Compressor"
							/>
						</TabsContent>
					</Tabs>
				</CardContent>
			</Card>

			{/* Footnotes */}
			{!loading && liveCache && (
				<p className="text-xs text-muted-foreground">
					Live cache: {formatNumber(liveCache.entries)} entries,{" "}
					{formatNumber(liveCache.stableHashes)} stable hashes,{" "}
					{formatNumber(liveCache.hits)} hits, {formatNumber(liveCache.misses)}{" "}
					misses since server start.
				</p>
			)}
		</div>
	);
}
