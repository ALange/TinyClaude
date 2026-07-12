import { cn } from "../../lib/utils";

/**
 * Renders the signature "+" panel-corner motif: four literal `+` glyphs,
 * one straddling each corner of the nearest `relative`-positioned ancestor.
 *
 * Usable standalone (e.g. composed onto `DialogContent`, `PopoverContent`,
 * or the sidebar `<aside>`), not only via `Card`.
 */
function PanelCorners({ className }: { className?: string }) {
	const glyphClassName = cn(
		"pointer-events-none select-none absolute z-10 font-mono text-[11px] leading-none text-border",
		className,
	);

	return (
		<>
			<span
				aria-hidden="true"
				className={cn(
					glyphClassName,
					"top-0 left-0 -translate-x-1/2 -translate-y-1/2",
				)}
			>
				+
			</span>
			<span
				aria-hidden="true"
				className={cn(
					glyphClassName,
					"top-0 right-0 translate-x-1/2 -translate-y-1/2",
				)}
			>
				+
			</span>
			<span
				aria-hidden="true"
				className={cn(
					glyphClassName,
					"bottom-0 left-0 -translate-x-1/2 translate-y-1/2",
				)}
			>
				+
			</span>
			<span
				aria-hidden="true"
				className={cn(
					glyphClassName,
					"bottom-0 right-0 translate-x-1/2 translate-y-1/2",
				)}
			>
				+
			</span>
		</>
	);
}

export { PanelCorners };
