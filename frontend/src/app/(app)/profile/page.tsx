"use client";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useTRPC } from "@/lib/trpc";
import { cn, pct } from "@/lib/utils";

export default function ProfilePage() {
  const trpc = useTRPC();
  const me = useQuery(trpc.me.get.queryOptions());
  const history = useQuery(trpc.quiz.history.queryOptions());
  if (me.isLoading) return <LoadingState />;
  if (me.error) return <ErrorState message={me.error.message} />;
  const p = me.data!;
  return (
    <div className="space-y-6">
      <PageHeader title={p.name} description={`${p.email} · Level ${p.level.level} · ${p.xp.toLocaleString()} XP`} />
      <Card><CardContent className="p-5"><p className="mb-2 text-sm">{p.level.current}/{p.level.needed} XP to level {p.level.level + 1}</p><Progress value={p.level.pct} label="Level progress" /></CardContent></Card>
      <Card>
        <CardHeader><CardTitle>Badges</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {p.badges.map((b) => (
            <div key={b.key} className={cn("rounded-lg border p-4", !b.earned && "opacity-50 grayscale")}>
              <span className="text-3xl" aria-hidden>{b.icon}</span>
              <p className="mt-1 font-medium">{b.name}</p>
              <p className="text-xs text-muted-foreground">{b.description}</p>
              <p className="mt-1 text-xs">{b.earned ? `Earned ${new Date(b.awardedAt!).toLocaleDateString()}` : "Locked"}</p>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Recent quizzes</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {history.data?.map((a) => (
              <li key={a.id} className="flex justify-between py-2"><span>{a.quiz.title} <span className="text-muted-foreground">· {a.quiz.course.title}</span></span><span className="font-medium">{pct(a.score)}</span></li>
            ))}
            {history.data?.length === 0 && <li className="py-2 text-muted-foreground">No quizzes taken yet.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
