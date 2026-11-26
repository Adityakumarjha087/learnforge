"use client";
import { Markdown as MarkdownExt } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Code, Heading2, Italic, List, ListOrdered, Quote } from "lucide-react";
import { Button } from "./ui/button";

/** TipTap rich-text editor that reads and writes Markdown (KaTeX `$…$` and fenced code survive round-trips). */
export function LessonEditor({ initial, onSave, saving }: { initial: string; onSave: (markdown: string) => void; saving?: boolean }) {
  const editor = useEditor({
    extensions: [StarterKit, MarkdownExt],
    content: initial,
    contentType: "markdown",
    immediatelyRender: false,
    editorProps: { attributes: { class: "prose-lf tiptap p-4", "aria-label": "Lesson content editor" } },
  });
  if (!editor) return <div className="h-80 animate-pulse rounded-lg bg-muted" />;
  const tool = (label: string, Icon: typeof Bold, run: () => void, active: boolean) => (
    <Button type="button" size="icon" variant={active ? "secondary" : "ghost"} aria-label={label} aria-pressed={active} onClick={run}>
      <Icon className="h-4 w-4" />
    </Button>
  );
  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap gap-1 border-b p-2" role="toolbar" aria-label="Formatting">
        {tool("Heading", Heading2, () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }))}
        {tool("Bold", Bold, () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
        {tool("Italic", Italic, () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
        {tool("Bullet list", List, () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"))}
        {tool("Numbered list", ListOrdered, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"))}
        {tool("Quote", Quote, () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"))}
        {tool("Code block", Code, () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive("codeBlock"))}
        <div className="flex-1" />
        <Button size="sm" loading={saving} onClick={() => onSave(editor.getMarkdown())}>
          Save lesson
        </Button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
