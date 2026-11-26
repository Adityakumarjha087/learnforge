"use client";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowRight, Brain, Flame, Plus, Sparkles, Star } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useTRPC } from "@/lib/trpc";
import { pct } from "@/lib/utils";

export default function DashboardPage() {
  const trpc = useTRPC();
  const dash = useQuery(trpc.me.dashboard.queryOptions());
  const mine = useQuery(trpc.course.mine.queryOptions());

  if (dash.isLoading) return <LoadingState rows={4} />;
  if (dash.error) return <ErrorState message={dash.error.message} onRetry={() => dash.refetch()} />;
  const { me, usage, dueCount } = dash.data!;

  const stats = [
    { label: "Level", value: me.level.level, icon: Star, extra: <Progress value={me.level.pct} label="Level progress" className="mt-2" /> },
    { label: "Total XP", value: me.xp.toLocaleString(), icon: Sparkles, extra: <p className="text-xs text-muted-foreground">+{me.weeklyXp} this week</p> },
    { label: "Streak", value: `${me.streakDays} days`, icon: Flame, extra: <p className="text-xs text-muted-foreground">Best: {me.longestStreak}</p> },
    { label: "Cards due", value: dueCount, icon: Brain, extra: <Link href="/review" className="text-xs text-primary underline">Review now</Link> },
  ];

  return (
    <div className="space-y-8">
      <PageHeader title={`Welcome back, ${me.name.split(" ")[0]}`} description="Here's where your learning stands today." actions={<Button asChild><Link href="/courses/new"><Plus className="h-4 w-4" /> New course</Link></Button>} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between text-sm text-muted-foreground">{s.label}<s.icon className="h-4 w-4" aria-hidden /></div>
                <p className="mt-1 text-2xl font-bold" data-testid={`stat-${s.label.toLowerCase().replace(/\s/g, "-")}`}>{s.value}</p>
                {s.extra}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2" aria-labelledby="continue">
          <h2 id="continue" className="text-lg font-semibold">Continue learning</h2>
          {mine.isLoading ? (
            <LoadingState rows={2} />
          ) : mine.data?.enrolled.length ? (
            mine.data.enrolled.slice(0, 5).map((c) => (
              <Card key={c.id}>
                <CardContent className="flex items-center gap-4 p-5">
                  <div className="min-w-0 flex-1">
                    <Link href={`/courses/${c.id}`} className="font-medium hover:underline">{c.title}</Link>
                    <p className="text-xs text-muted-foreground">{c.completedLessons}/{c.totalLessons} lessons · {pct(c.progress)}</p>
                    <Progress value={c.progress * 100} className="mt-2" label={`${c.title} progress`} />
                  </div>
                  <Button asChild variant="outline" size="sm"><Link href={`/courses/${c.id}`}>Open <ArrowRight className="h-4 w-4" /></Link></Button>
                </CardContent>
              </Card>
            ))
          ) : (
            <EmptyState title="No courses yet" description="Generate a course from any topic or your own notes." action={<Button asChild><Link href="/courses/new">Create a course</Link></Button>} />
          )}
        </section>
        <aside className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Plan</CardTitle><CardDescription>AI generations this month</CardDescription></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between"><Badge tone={usage.plan === "PRO" ? "primary" : "muted"}>{usage.plan}</Badge><span className="text-sm">{usage.generations.used}/{usage.generations.limit}</span></div>
              <Progress value={(usage.generations.used / Math.max(1, usage.generations.limit)) * 100} tone={usage.generations.remaining === 0 ? "danger" : "primary"} label="Generation usage" />
              {usage.plan === "FREE" && <Button asChild variant="outline" size="sm" className="w-full"><Link href="/billing">Upgrade to Pro</Link></Button>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Badges</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {me.badges.filter((b) => b.earned).map((b) => <span key={b.key} title={b.description} className="text-2xl" aria-label={b.name}>{b.icon}</span>)}
              {me.badges.every((b) => !b.earned) && <p className="text-sm text-muted-foreground">Complete a lesson to earn your first badge.</p>}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
