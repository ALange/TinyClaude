import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../ui/card";

function Ref({ children }: { children: string }) {
	return (
		<code className="text-xs bg-background px-1 py-0.5 font-mono">
			{children}
		</code>
	);
}

const INVARIANTS = [
	<>
		<Ref>tool_result</Ref> block order/index is always preserved — blocks are
		swapped in place, never reordered.
	</>,
	"The trailing (most recent) message is always excluded from compression.",
	"Compression must be deterministic per content hash — the same input hash always yields the same compressed output.",
	<>
		Providers are shared singletons and must not carry per-request state as
		instance fields — a race condition here was fixed in <Ref>bb38263</Ref> by
		resolving endpoint/model locally per call instead of stashing them on{" "}
		<Ref>this</Ref>.
	</>,
];

export function InvariantsSection() {
	return (
		<Card className="card-hover">
			<CardHeader>
				<CardTitle>Gotchas & invariants</CardTitle>
				<CardDescription>
					Rules the compression/caching pipeline depends on holding true.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ul className="space-y-2 list-disc pl-5 text-sm text-muted-foreground">
					{INVARIANTS.map((item, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static content, order never changes
						<li key={i}>{item}</li>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}
