"use client";
import { useQuery } from "@tanstack/react-query";
import { Flame, Medal } from "lucide-react";
import { useState } from "react";
import { useSession } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export default function LeaderboardPage() {
  const trpc = useTRPC();
  const { data: me } = useSession();
  const [period, setPeriod] = useState<"week" | "all">("week");
  const board = useQuery(trpc.gamification.leaderboard.queryOptions({ period }));
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Leaderboard" description="XP earned from lessons, quizzes, reviews, exercises and battles." />
      <Tabs value={period} onValueChange={(v) => setPeriod(v as "week" | "all")}>
        <TabsList><TabsTrigger value="week">This week</TabsTrigger><TabsTrigger value="all">All time</TabsTrigger></TabsList>
      </Tabs>
      <div className="mt-4">
        {board.isLoading ? <LoadingState /> : board.error ? <ErrorState message={board.error.message} /> : board.data!.length === 0 ? <EmptyState title="No activity yet this week" /> : (
          <Card>
            <CardContent className="p-0">
              <ol className="divide-y">
                {board.data!.map((r) => (
                  <li key={r.id} className={cn("flex items-center gap-4 px-5 py-3", r.id === me?.id && "bg-accent/50")}>
                    <span className="w-8 text-center font-bold">{r.rank <= 3 ? <Medal className={cn("mx-auto h-5 w-5", ["text-yellow-500", "text-gray-400", "text-amber-700"][r.rank - 1])} aria-label={`Rank ${r.rank}`} /> : r.rank}</span>
                    <span className="flex-1 font-medium">{r.name}{r.id === me?.id && " (you)"}</span>
                    <span className="flex items-center gap-1 text-sm text-muted-foreground"><Flame className="h-4 w-4 text-warning" aria-hidden />{r.streakDays}</span>
                    <span className="text-sm text-muted-foreground">Lv {r.level}</span>
                    <span className="w-20 text-right font-semibold">{r.score.toLocaleString()} XP</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
