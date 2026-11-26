"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PartyPopper } from "lucide-react";
import Link from "next/link";
import { FlashcardReviewer } from "@/components/flashcard-reviewer";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useTRPC } from "@/lib/trpc";
import { pct } from "@/lib/utils";

export default function ReviewPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const queue = useQuery(trpc.flashcard.queue.queryOptions());
  const stats = useQuery(trpc.flashcard.stats.queryOptions());
  const review = useMutation(
    trpc.flashcard.review.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: trpc.flashcard.queue.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.flashcard.stats.queryKey() });
      },
    }),
  );

  const card = queue.data?.cards[0];
  return (
    <div>
      <PageHeader title="Daily review" description={`Spaced repetition powered by ${queue.data?.algorithm === "sm2" ? "SM-2" : "FSRS"} - review just before you'd forget.`} />
      <div className="mb-6 flex flex-wrap gap-2 text-sm">
        <Badge tone="primary">{queue.data?.counts.new ?? 0} new</Badge>
        <Badge tone="warning">{queue.data?.counts.learning ?? 0} learning</Badge>
        <Badge tone="success">{queue.data?.counts.review ?? 0} review</Badge>
        {stats.data && <Badge tone="muted">Retention {pct(stats.data.retention)} · {stats.data.reviewedToday} today</Badge>}
      </div>
      {queue.isLoading ? (
        <LoadingState rows={2} />
      ) : queue.error ? (
        <ErrorState message={queue.error.message} onRetry={() => queue.refetch()} />
      ) : card ? (
        <FlashcardReviewer card={card} busy={review.isPending || queue.isFetching} onRate={(rating) => review.mutate({ flashcardId: card.id, rating })} />
      ) : (
        <EmptyState title="All caught up!" description="No cards are due right now. Come back later or enroll in more courses." action={<Button asChild variant="outline"><Link href="/courses">Browse courses</Link></Button>} />
      )}
      {!card && !queue.isLoading && <PartyPopper className="mx-auto mt-6 h-8 w-8 text-primary" aria-hidden />}
      {stats.data && (
        <Card className="mt-8">
          <CardContent className="p-5">
            <p className="mb-3 text-sm font-medium">Upcoming reviews (next 7 days)</p>
            <div className="flex h-24 items-end gap-2" role="img" aria-label="Review forecast">
              {stats.data.forecast.map((f) => {
                const max = Math.max(1, ...stats.data!.forecast.map((x) => x.count));
                return (
                  <div key={f.day} className="flex flex-1 flex-col items-center gap-1">
                    <div className="w-full rounded-t bg-primary/70" style={{ height: `${(f.count / max) * 72 + 2}px` }} title={`${f.count} cards`} />
                    <span className="text-[10px] text-muted-foreground">+{f.day}d</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
