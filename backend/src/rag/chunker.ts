/** Paragraph-aware chunker with overlap; keeps chunks under `maxChars` without splitting words. */
export function chunkText(text: string, maxChars = 900, overlapChars = 150): string[] {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const paragraphs = clean.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";
  const push = () => {
    if (current.trim()) chunks.push(current.trim());
  };
  for (const p of paragraphs) {
    if ((current + "\n\n" + p).length <= maxChars) {
      current = current ? `${current}\n\n${p}` : p;
      continue;
    }
    push();
    if (p.length <= maxChars) {
      const tail = current.slice(-overlapChars);
      current = tail && chunks.length ? `${tail.slice(tail.indexOf(" ") + 1)}\n\n${p}` : p;
      if (current.length > maxChars) current = p;
      continue;
    }
    // Long paragraph: sliding window on word boundaries.
    const words = p.split(" ");
    let win = "";
    for (const w of words) {
      if ((win + " " + w).length > maxChars) {
        chunks.push(win.trim());
        win = win.slice(-overlapChars);
        win = win.slice(win.indexOf(" ") + 1);
      }
      win = win ? `${win} ${w}` : w;
    }
    current = win;
  }
  push();
  return chunks;
}
