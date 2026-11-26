"use client";
import { useTheme } from "next-themes";
import { useEffect, useId, useState } from "react";

/** Renders a Mermaid diagram client-side (mermaid is loaded lazily to keep bundles small). */
export function Mermaid({ chart }: { chart: string }) {
  const id = useId().replace(/:/g, "");
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: resolvedTheme === "dark" ? "dark" : "default" });
        const { svg: out } = await mermaid.render(`m${id}`, chart);
        if (!cancelled) setSvg(out);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, id, resolvedTheme]);

  if (error) return <pre className="text-xs text-muted-foreground">{chart}</pre>;
  if (!svg) return <div className="h-24 animate-pulse rounded-lg bg-muted" aria-label="Rendering diagram" />;
  return <div className="my-4 flex justify-center overflow-x-auto" role="img" aria-label="Diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
}
