"use client";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { cn } from "@/lib/utils";
import { Mermaid } from "./mermaid";

/** Markdown renderer with GFM, KaTeX math, syntax-labelled code blocks and Mermaid diagrams. Raw HTML is not rendered. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("prose-lf", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ className: cls, children: code, ...props }) {
            const lang = /language-(\w+)/.exec(cls ?? "")?.[1];
            const text = String(code ?? "").replace(/\n$/, "");
            if (lang === "mermaid") return <Mermaid chart={text} />;
            return (
              <code className={cls} data-lang={lang} {...props}>
                {code}
              </code>
            );
          },
          pre({ children: pre }) {
            const child = Array.isArray(pre) ? pre[0] : pre;
            const isMermaid = (child as { props?: { className?: string } })?.props?.className?.includes("language-mermaid");
            return isMermaid ? <>{pre}</> : <pre>{pre}</pre>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
