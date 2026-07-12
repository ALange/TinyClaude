// Color palette used across UI components
export const COLORS = {
	primary: "#e5e5e5",
	success: "#10b981",
	warning: "#f59e0b",
	error: "#ef4444",
	blue: "#3b82f6",
	purple: "#8b5cf6",
	pink: "#ec4899",
	indigo: "#6366f1",
	cyan: "#06b6d4",
} as const;

// Chart color sequence for multi-series charts (grayscale ramp, near-white to near-black)
export const CHART_COLORS = [
	COLORS.primary,
	"#b3b3b3",
	"#808080",
	"#4d4d4d",
	"#262626",
] as const;

// Time range options for analytics
export type TimeRange = "1h" | "6h" | "24h" | "7d" | "30d";

export const TIME_RANGES: Record<TimeRange, string> = {
	"1h": "Last Hour",
	"6h": "Last 6 Hours",
	"24h": "Last 24 Hours",
	"7d": "Last 7 Days",
	"30d": "Last 30 Days",
} as const;

// Chart dimensions
export const CHART_HEIGHTS = {
	small: 250,
	medium: 300,
	large: 400,
} as const;

// Common chart tooltip styles
export const CHART_TOOLTIP_STYLE = {
	default: {
		backgroundColor: "var(--background)",
		border: "1px solid var(--border)",
		borderRadius: "var(--radius)",
	},
	success: {
		backgroundColor: COLORS.success,
		border: `1px solid ${COLORS.success}`,
		borderRadius: "var(--radius)",
		color: "#fff",
	},
	dark: {
		backgroundColor: "rgba(0,0,0,0.8)",
		border: "1px solid rgba(255,255,255,0.2)",
		borderRadius: "0px",
		backdropFilter: "blur(8px)",
	},
} as const;

// Chart common properties
export const CHART_PROPS = {
	strokeDasharray: "0",
	gridClassName: "stroke-border/50",
} as const;

// API and data refresh intervals (in milliseconds)
export const REFRESH_INTERVALS = {
	default: 30000, // 30 seconds
	fast: 10000, // 10 seconds
	slow: 60000, // 1 minute
} as const;

// API timeout
export const API_TIMEOUT = 30000; // 30 seconds

// React Query configuration
export const QUERY_CONFIG = {
	staleTime: 10000, // Consider data stale after 10 seconds
} as const;

// API default limits
export const API_LIMITS = {
	requestsDetail: 50,
	requestsSummary: 50,
} as const;
