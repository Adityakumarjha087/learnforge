import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const pct = (v: number | null | undefined, digits = 0) => (v == null ? "—" : `${(v * 100).toFixed(digits)}%`);

export function relativeDays(days: number): string {
  if (days <= 0) return "<10m";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

export const difficultyName = (d: number) => ["", "Intro", "Easy", "Medium", "Hard", "Expert"][d] ?? "Medium";

export function masteryTone(p: number | null | undefined): "danger" | "warning" | "success" | "muted" {
  if (p == null) return "muted";
  if (p < 0.4) return "danger";
  if (p < 0.85) return "warning";
  return "success";
}

export function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return "Something went wrong";
}
