"use client";
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport, type UIMessage } from "ai";
import { Bot, Send, Square, User } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { authFetch } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";
import { Button } from "./ui/button";
import { Textarea } from "./ui/input";

export interface TutorHistoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const STARTERS = ["Can you give me a hint about this lesson's key idea?", "I'm stuck - what should I think about first?", "Check my understanding: "];

/** Socratic tutor chat streaming via the Vercel AI SDK text transport. */
export function TutorChat({ sessionId, history, compact }: { sessionId: string; history: TutorHistoryMessage[]; compact?: boolean }) {
  const transport = useMemo(() => new TextStreamChatTransport<UIMessage>({ api: "/api/tutor/chat", body: { sessionId }, fetch: authFetch }), [sessionId]);
  const initial = useMemo<UIMessage[]>(() => history.map((m) => ({ id: m.id, role: m.role, parts: [{ type: "text", text: m.content }] })), [history]);
  const { messages, sendMessage, status, stop, error } = useChat({ id: sessionId, transport, messages: initial });
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [messages]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    void sendMessage({ text: t });
    setInput("");
  };

  return (
    <div className={cn("flex flex-col", compact ? "h-[32rem]" : "h-[calc(100vh-12rem)]")}>
      <div className="flex-1 space-y-4 overflow-y-auto p-1" aria-live="polite" aria-label="Tutor conversation">
        {messages.length === 0 && (
          <div className="space-y-3 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
            <p>👋 I&apos;m your Socratic tutor. I won&apos;t just give you answers - I&apos;ll ask questions and give hints grounded in this course.</p>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <Button key={s} size="sm" variant="outline" onClick={() => (s.endsWith(": ") ? setInput(s) : send(s))}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => {
          const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
          const mine = m.role === "user";
          return (
            <div key={m.id} className={cn("flex gap-3", mine && "flex-row-reverse")} data-testid={`msg-${m.role}`}>
              <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", mine ? "bg-primary text-primary-foreground" : "bg-accent")}>
                {mine ? <User className="h-4 w-4" aria-hidden /> : <Bot className="h-4 w-4" aria-hidden />}
              </div>
              <div className={cn("max-w-[85%] rounded-2xl px-4 py-2 text-sm", mine ? "bg-primary text-primary-foreground" : "bg-muted")}>
                {mine ? <p className="whitespace-pre-wrap">{text}</p> : <Markdown>{text || "…"}</Markdown>}
              </div>
            </div>
          );
        })}
        {status === "submitted" && <p className="text-sm text-muted-foreground">Tutor is thinking…</p>}
        {error && <p role="alert" className="text-sm text-danger">{error.message.includes("402") || /limit/i.test(error.message) ? "You've reached today's free tutor limit. Upgrade to Pro for unlimited tutoring." : `Tutor error: ${error.message}`}</p>}
        <div ref={endRef} />
      </div>
      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <Textarea
          aria-label="Message the tutor"
          rows={2}
          maxLength={4000}
          value={input}
          placeholder="Ask a question or explain your thinking… (math: $x^2$)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        {busy ? (
          <Button type="button" variant="outline" size="icon" onClick={() => stop()} aria-label="Stop generating">
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button type="submit" size="icon" aria-label="Send message" disabled={!input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        )}
      </form>
    </div>
  );
}
