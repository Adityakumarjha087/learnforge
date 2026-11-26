import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

const tones = { primary: "bg-primary", success: "bg-success", warning: "bg-warning", danger: "bg-danger", muted: "bg-muted-foreground" } as const;

export function Progress({ value, className, tone = "primary", label }: { value: number; className?: string; tone?: keyof typeof tones; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <ProgressPrimitive.Root value={v} aria-label={label} className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <ProgressPrimitive.Indicator className={cn("h-full transition-all", tones[tone])} style={{ width: `${v}%` }} />
    </ProgressPrimitive.Root>
  );
}
