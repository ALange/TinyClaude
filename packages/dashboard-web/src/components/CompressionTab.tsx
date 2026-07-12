import { AlertTriangle } from "lucide-react";
import React, { useState } from "react";
import type { TimeRange } from "../constants";
import { useCompressionInsights } from "../hooks/queries";
import { CacheAlignmentView } from "./compression/CacheAlignmentView";
import { CompressionEfficiencyView } from "./compression/CompressionEfficiencyView";
import { CompressionSettingsCard } from "./compression/CompressionSettingsCard";
import { TimeRangeSelector } from "./overview/TimeRangeSelector";
import { Card, CardContent } from "./ui/card";

export const CompressionTab = React.memo(() => {
	const [timeRange, setTimeRange] = useState<TimeRange>("24h");

	const {
		data,
		isLoading: loading,
		isError,
	} = useCompressionInsights(timeRange);

	return (
		<div className="space-y-6">
			{/* Controls */}
			<div className="flex flex-col sm:flex-row gap-4 justify-between">
				<TimeRangeSelector
					value={timeRange}
					onChange={(value) => setTimeRange(value as TimeRange)}
				/>
			</div>

			<CompressionSettingsCard />

			{isError ? (
				<Card>
					<CardContent className="p-6">
						<div className="flex items-center gap-2 text-destructive">
							<AlertTriangle className="h-5 w-5" />
							<span>
								Failed to load compression insights. Please try again.
							</span>
						</div>
					</CardContent>
				</Card>
			) : (
				<CompressionEfficiencyView
					data={data}
					loading={loading}
					timeRange={timeRange}
				/>
			)}

			{isError ? (
				<Card>
					<CardContent className="p-6">
						<div className="flex items-center gap-2 text-destructive">
							<AlertTriangle className="h-5 w-5" />
							<span>
								Failed to load cache alignment data. Please try again.
							</span>
						</div>
					</CardContent>
				</Card>
			) : (
				<CacheAlignmentView
					data={data}
					loading={loading}
					timeRange={timeRange}
				/>
			)}
		</div>
	);
});

CompressionTab.displayName = "CompressionTab";
