import {
	useCompressionSettings,
	useSetCompressionSettings,
} from "../../hooks/queries";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../ui/card";
import { Switch } from "../ui/switch";

export function CompressionSettingsCard() {
	const { data, isLoading } = useCompressionSettings();
	const setCompressionSettings = useSetCompressionSettings();

	return (
		<Card className="card-hover">
			<CardHeader>
				<CardTitle>Context Compression</CardTitle>
				<CardDescription>
					Compress large tool-result payloads before sending them to the model,
					once they've fallen out of the live conversation turn. Alignment
					scoring always runs regardless of this setting.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="flex items-center justify-between">
					<div>
						<p className="text-sm font-medium">Compress tool results</p>
						<p className="text-xs text-muted-foreground">
							Reduces token usage on long agentic sessions. Off by default.
						</p>
					</div>
					<Switch
						checked={data?.compressContext ?? false}
						disabled={isLoading || setCompressionSettings.isPending}
						onCheckedChange={(checked) =>
							setCompressionSettings.mutate(checked)
						}
					/>
				</div>
			</CardContent>
		</Card>
	);
}
