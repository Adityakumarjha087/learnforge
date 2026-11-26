"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import type { RouterOutputs } from "@/lib/trpc";
import { relativeDays } from "@/lib/utils";
import { Markdown } from "./markdown";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";

export type ReviewCardView = RouterOutputs["flashcard"]["queue"]["cards"][number];
export type Rating = 1 | 2 | 3 | 4;

const BUTTONS: { rating: Rating; label: string; key: "again" | "hard" | "good" | "easy"; variant: "danger" | "outline" | "default" | "success" }[] = [
  { rating: 1, label: "Again", key: "again", variant: "danger" },
  { rating: 2, label: "Hard", key: "hard", variant: "outline" },
  { rating: 3, label: "Good", key: "good", variant: "default" },
  { rating: 4, label: "Easy", key: "easy", variant: "success" },
];

/** One-card-at-a-time FSRS review. Keyboard: Space reveals, 1-4 rate. */
export function FlashcardReviewer({ card, onRate, busy }: { card: ReviewCardView; onRate: (rating: Rating) => void; busy?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    setRevealed(false);
  }, [card.id]);

  const rate = useCallback((r: Rating) => !busy && revealed && onRate(r), [busy, revealed, onRate]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA" || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.code === "Space") {
        e.preventDefault();
        setRevealed(true);
      } else if (["1", "2", "3", "4"].includes(e.key)) rate(Number(e.key) as Rating);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rate]);

  return (
    <AnimatePresence mode="wait">
      <motion.div key={card.id} initial={{ opacity: 0, rotateX: -8 }} animate={{ opacity: 1, rotateX: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
        <Card className="mx-auto max-w-2xl">
          <CardContent className="space-y-5 p-8">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{card.course.title}{card.concept ? ` · ${card.concept}` : ""}</span>
              <Badge tone="muted">{card.state.toLowerCase()}</Badge>
            </div>
            <div className="min-h-20 text-lg font-medium" data-testid="card-front"><Markdown>{card.front}</Markdown></div>
            {revealed ? (
              <div className="border-t pt-4 text-muted-foreground" data-testid="card-back"><Markdown>{card.back}</Markdown></div>
            ) : (
              <Button className="w-full" variant="secondary" onClick={() => setRevealed(true)}>
                Show answer <kbd className="ml-2 rounded border px-1 text-xs">Space</kbd>
              </Button>
            )}
            {revealed && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Rate your recall">
                {BUTTONS.map((b) => (
                  <Button key={b.rating} variant={b.variant} disabled={busy} onClick={() => rate(b.rating)} className="flex h-14 flex-col gap-0">
                    <span>{b.label}</span>
                    <span className="text-[10px] opacity-80">{relativeDays(card.intervals[b.key])} · {b.rating}</span>
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </AnimatePresence>
  );
}
