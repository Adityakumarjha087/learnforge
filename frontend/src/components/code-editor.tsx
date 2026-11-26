"use client";
import { cn } from "@/lib/utils";

/** Lightweight accessible code editor (textarea with tab indentation and line numbers). */
export function CodeEditor({ value, onChange, label, readOnly, className }: { value: string; onChange: (v: string) => void; label: string; readOnly?: boolean; className?: string }) {
  const lines = value.split("\n").length;
  return (
    <div className={cn("flex overflow-hidden rounded-lg border bg-muted font-mono text-sm", className)}>
      <div aria-hidden className="select-none border-r px-2 py-2 text-right text-muted-foreground">
        {Array.from({ length: Math.max(lines, 6) }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        aria-label={label}
        spellCheck={false}
        readOnly={readOnly}
        value={value}
        rows={Math.max(lines, 6)}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Tab" || readOnly) return;
          e.preventDefault();
          const el = e.currentTarget;
          const { selectionStart: s, selectionEnd: end } = el;
          const next = `${value.slice(0, s)}  ${value.slice(end)}`;
          onChange(next);
          requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
        }}
        className="w-full resize-y bg-transparent p-2 leading-6 outline-none"
        style={{ lineHeight: "1.5rem" }}
      />
    </div>
  );
}
