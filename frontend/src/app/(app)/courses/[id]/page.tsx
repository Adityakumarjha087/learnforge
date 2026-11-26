"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Code2, Lightbulb, MessageCircleQuestion, Settings } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useTRPC } from "@/lib/trpc";
import { difficultyName, masteryTone, pct } from "@/lib/utils";

const REASON = {
  "review-weak-concept": "Your mastery of this concept dropped - let's reinforce it.",
  "next-in-sequence": "Next up in your learning path.",
  "course-complete": "You've finished the course - review to keep it fresh.",
} as const;

export default function CoursePage() {
  const { id } = useParams<{ id: string }>();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const router = useRouter();
  const course = useQuery(trpc.course.get.queryOptions({ id }));
  const enroll = useMutation(trpc.course.enroll.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.course.get.queryKey({ id }) }) }));
  const tutor = useMutation(trpc.tutor.createSession.mutationOptions({ onSuccess: (s) => router.push(`/tutor/${s.id}`), onError: (e) => toast.error(e.message) }));

  if (course.isLoading) return <LoadingState rows={5} />;
  if (course.error) return <ErrorState message={course.error.message} onRetry={() => course.refetch()} />;
  const c = course.data!;
  const lessons = c.modules.flatMap((m) => m.lessons);
  const done = new Set(c.completedLessonIds);
  const rec = c.recommendation;
  const recLesson = lessons.find((l) => l.id === rec?.lessonId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={c.title}
        description={c.description}
        actions={
          <>
            {c.canEdit && <Button asChild variant="outline"><Link href={`/instructor/courses/${c.id}`}><Settings className="h-4 w-4" /> Manage</Link></Button>}
            <Button variant="outline" onClick={() => tutor.mutate({ courseId: c.id })} loading={tutor.isPending}><MessageCircleQuestion className="h-4 w-4" /> Ask tutor</Button>
            {!c.enrolled && <Button onClick={() => enroll.mutate({ id: c.id })} loading={enroll.isPending}>Enroll</Button>}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <Badge tone="primary">{difficultyName(c.level)}</Badge>
        <Badge tone={c.status === "PUBLISHED" ? "success" : "muted"}>{c.status.toLowerCase()}</Badge>
        <span>by {c.author.name}</span>
        <span>{done.size}/{lessons.length} lessons complete</span>
      </div>
      <Progress value={(done.size / Math.max(1, lessons.length)) * 100} label="Course progress" />

      {recLesson && rec && (
        <Card className="border-primary/40 bg-accent/40">
          <CardContent className="flex flex-wrap items-center gap-4 p-5">
            <Lightbulb className="h-6 w-6 text-primary" aria-hidden />
            <div className="flex-1">
              <p className="font-medium">Recommended: {recLesson.title}</p>
              <p className="text-sm text-muted-foreground">{REASON[rec.reason]} Target difficulty: {difficultyName(rec.targetDifficulty)}.</p>
            </div>
            <Button asChild><Link href={`/lessons/${recLesson.id}`}>Start</Link></Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {c.modules.map((m) => (
            <Card key={m.id}>
              <CardHeader><CardTitle>{m.title}</CardTitle><CardDescription>{m.summary}</CardDescription></CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {m.lessons.map((l) => (
                    <li key={l.id}>
                      <Link href={`/lessons/${l.id}`} className="flex items-center gap-3 py-3 hover:bg-muted/50">
                        {done.has(l.id) ? <CheckCircle2 className="h-5 w-5 text-success" aria-label="Completed" /> : <Circle className="h-5 w-5 text-muted-foreground" aria-label="Not completed" />}
                        <span className="flex-1 text-sm font-medium">{l.title}</span>
                        <Badge tone="muted">{difficultyName(l.difficulty)}</Badge>
                        <span className="text-xs text-muted-foreground">{l.minutes} min</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
        <aside className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Concept mastery</CardTitle><CardDescription>Bayesian Knowledge Tracing estimate</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {c.concepts.map((k) => {
                const p = c.mastery[k.id];
                return (
                  <div key={k.id}>
                    <div className="flex justify-between text-xs"><span>{k.name}</span><span>{pct(p ?? null)}</span></div>
                    <Progress value={(p ?? 0) * 100} tone={masteryTone(p)} label={`${k.name} mastery`} />
                  </div>
                );
              })}
            </CardContent>
          </Card>
          {c.exercises.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Coding exercises</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {c.exercises.map((e) => (
                  <Link key={e.id} href={`/exercises/${e.id}`} className="flex items-center gap-2 text-sm hover:underline"><Code2 className="h-4 w-4" aria-hidden />{e.title}</Link>
                ))}
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
