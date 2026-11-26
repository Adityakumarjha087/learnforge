const STOPWORDS = new Set(
  (
    "a an and are as at be been but by can could did do does for from had has have how i if in into is it its " +
    "just may more most must no not of on one or other our out over own same should so some such than that the " +
    "their them then there these they this those through to too under up use used using very was we were what " +
    "when where which while who why will with would you your also each many much only both between about after " +
    "before during because any all new like make makes made way ways well get gets first second third example " +
    "examples lesson module course learn learning understand"
  ).split(" "),
);

export function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s+#.-]/g, " ").replace(/\s+/g, " ").trim();
}

export function tokenize(text: string): string[] {
  return normalize(text)
    .split(" ")
    .map((t) => t.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((t) => t.length > 1);
}

export function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => !STOPWORDS.has(t) && t.length > 2 && !/^\d+$/.test(t));
}

/** Marker for inline spans removed by stripMarkup; sentences containing it are not self-contained. */
const ELIDED = "\u2063";

/** Remove code, math and markdown syntax so only explanatory prose remains. */
export function stripMarkup(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "\n\n")
    .replace(/\$\$[\s\S]*?\$\$/g, "\n\n")
    .replace(/\$[^$\n]+\$/g, ` ${ELIDED} `)
    .replace(/`[^`\n]*`/g, ` ${ELIDED} `)
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, "")
    .replace(/^#+\s.*$/gm, "\n\n");
}

export function splitSentences(text: string): string[] {
  return stripMarkup(text)
    .replace(/[#>*_`|]/g, " ")
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 25 && s.split(" ").length >= 5 && !s.includes("?") && !s.includes(ELIDED));
}

/** Top-k keywords by term frequency (ties broken by first occurrence) - simple, deterministic. */
export function keywords(text: string, k = 10): string[] {
  const counts = new Map<string, { n: number; first: number }>();
  contentTokens(stripMarkup(text).replaceAll(ELIDED, " ")).forEach((t, i) => {
    const c = counts.get(t);
    if (c) c.n += 1;
    else counts.set(t, { n: 1, first: i });
  });
  return [...counts.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first)
    .slice(0, k)
    .map(([t]) => t);
}

export function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && w.length <= 3 && /^(and|of|the|in|to|for|vs)$/i.test(w) ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
}

export function slugify(text: string): string {
  return normalize(text).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "course";
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Jaccard overlap of content tokens; used for grading and judge checks. */
export function overlap(a: string, b: string): number {
  const A = new Set(contentTokens(a));
  const B = new Set(contentTokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
