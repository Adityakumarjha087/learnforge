import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      default: "bg-accent text-foreground",
      primary: "bg-primary text-primary-foreground",
      success: "bg-success/15 text-success",
      warning: "bg-warning/20 text-foreground",
      danger: "bg-danger/15 text-danger",
      muted: "bg-muted text-muted-foreground",
    },
  },
  defaultVariants: { tone: "default" },
});

export const Badge = ({ className, tone, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) => (
  <span className={cn(badgeVariants({ tone }), className)} {...p} />
);
