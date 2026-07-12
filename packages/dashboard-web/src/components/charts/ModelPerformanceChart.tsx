import { formatPercentage } from "@tinyclaude/ui-common";
import { COLORS } from "../../constants";
import { formatCompactNumber } from "../../lib/chart-utils";
import { BaseScatterChart } from "./BaseScatterChart";

interface ModelPerformanceChartProps {
	data: Array<{
		model: string;
		avgTime: number;
		errorRate: number;
		[key: string]: string | number;
	}>;
	loading?: boolean;
	height?: number;
}

export function ModelPerformanceChart({
	data,
	loading = false,
	height = 300,
}: ModelPerformanceChartProps) {
	return (
		<BaseScatterChart
			data={data}
			xKey="avgTime"
			yKey="errorRate"
			loading={loading}
			height={height}
			fill={COLORS.primary}
			xAxisLabel="Avg Response Time (ms)"
			xAxisTickFormatter={formatCompactNumber}
			yAxisLabel="Error Rate %"
			tooltipFormatter={(value, name) => {
				if (name === "avgTime") return [`${value}ms`, "Avg Time"];
				if (name === "errorRate")
					return [formatPercentage(Number(value)), "Error Rate"];
				return [`${value}`, name || ""];
			}}
			tooltipStyle="success"
			renderLabel={(entry) => entry.model}
		/>
	);
}
