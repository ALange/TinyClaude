import type { ReactNode } from "react";
import {
	Cell,
	Legend,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
} from "recharts";
import {
	CHART_COLORS,
	type CHART_HEIGHTS,
	type CHART_TOOLTIP_STYLE,
} from "../../constants";
import { ChartContainer } from "./ChartContainer";
import { getChartHeight, getTooltipStyles } from "./chart-utils";
import type { ChartClickHandler, TooltipFormatterFunction } from "./types";

interface BasePieChartProps {
	data: Array<{ name: string; value: number; [key: string]: string | number }>;
	dataKey?: string;
	nameKey?: string;
	loading?: boolean;
	height?: keyof typeof CHART_HEIGHTS | number;
	innerRadius?: number;
	outerRadius?: number;
	paddingAngle?: number;
	cx?: string | number;
	cy?: string | number;
	colors?: string[];
	tooltipFormatter?: TooltipFormatterFunction;
	tooltipStyle?: keyof typeof CHART_TOOLTIP_STYLE | object;
	animationDuration?: number;
	showLegend?: boolean;
	legendLayout?: "horizontal" | "vertical";
	legendAlign?: "left" | "center" | "right";
	legendVerticalAlign?: "top" | "middle" | "bottom";
	renderLabel?: boolean;
	className?: string;
	error?: Error | null;
	emptyState?: ReactNode;
	onPieClick?: ChartClickHandler;
}

export function BasePieChart({
	data,
	dataKey = "value",
	nameKey = "name",
	loading = false,
	height = "medium",
	innerRadius = 0,
	outerRadius = 80,
	paddingAngle = 0,
	cx = "50%",
	cy = "50%",
	colors = [...CHART_COLORS],
	tooltipFormatter,
	tooltipStyle = "default",
	animationDuration = 1000,
	showLegend = false,
	legendLayout = "horizontal",
	legendAlign = "center",
	legendVerticalAlign = "bottom",
	renderLabel = true,
	className = "",
	error = null,
	emptyState,
	onPieClick,
}: BasePieChartProps) {
	const chartHeight = getChartHeight(height);
	const isEmpty = !data || data.length === 0;
	const tooltipStyles = getTooltipStyles(tooltipStyle);
	// Order slices largest-to-smallest so the grayscale ramp reads consistently
	// (darkest/lightest steps map to the same rank every render) and adjacent
	// slices stay visually distinguishable.
	const sortedData = data
		? [...data].sort((a, b) => Number(b[dataKey]) - Number(a[dataKey]))
		: [];
	// Reverse the ramp for slice assignment: the largest slice (index 0, sorted
	// above) gets the darkest step instead of the near-white lightest one, so it
	// never becomes low-contrast/near-invisible against a light background.
	const sliceColors = [...colors].reverse();
	// Bare recharts labels only show the raw value; render "name: NN%" so a
	// slice is identifiable without cross-referencing an (often hidden) legend.
	const pieLabel = renderLabel
		? // biome-ignore lint/suspicious/noExplicitAny: recharts label render props aren't fully typed for custom formatters
			(props: any) => {
				const percent = typeof props.percent === "number" ? props.percent : 0;
				return `${props.name}: ${(percent * 100).toFixed(0)}%`;
			}
		: false;

	return (
		<ChartContainer
			loading={loading}
			height={height}
			className={className}
			error={error}
			isEmpty={isEmpty}
			emptyState={emptyState}
		>
			<ResponsiveContainer width="100%" height={chartHeight}>
				<PieChart>
					<Pie
						data={sortedData}
						cx={cx}
						cy={cy}
						innerRadius={innerRadius}
						outerRadius={outerRadius}
						paddingAngle={paddingAngle}
						dataKey={dataKey}
						nameKey={nameKey}
						animationDuration={animationDuration}
						label={pieLabel}
						onClick={onPieClick}
					>
						{sortedData.map((entry, index) => (
							<Cell
								key={`cell-${entry[nameKey]}`}
								fill={sliceColors[index % sliceColors.length]}
							/>
						))}
					</Pie>
					{/* biome-ignore lint/suspicious/noExplicitAny: recharts v3.8 widened Formatter to include undefined */}
					<Tooltip
						contentStyle={tooltipStyles}
						formatter={tooltipFormatter as any}
					/>
					{showLegend && (
						<Legend
							layout={legendLayout}
							align={legendAlign}
							verticalAlign={legendVerticalAlign}
						/>
					)}
				</PieChart>
			</ResponsiveContainer>
		</ChartContainer>
	);
}
