"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTRPC } from "@/lib/trpc";
import { masteryTone, pct } from "@/lib/utils";

const LessonEditor = dynamic(() => import("@/components/lesson-editor").then((m) => m.LessonEditor), { ssr: false, loading: () => <div className="h-80 animate-pulse rounded-lg bg-muted" /> });

function Manage() {
  const { id } = useParams<{ id: string }>();
  const initialLesson = useSearchParams().get("lesson");
  const trpc = useTRPC();
  const qc = useQueryClient();
  const course = useQuery(trpc.course.get.queryOptions({ id }));
  const analytics = useQuery(trpc.instructor.analytics.queryOptions({ courseId: id }, { retry: false }));
  const quizzes = useQuery(trpc.quiz.forCourse.queryOptions({ courseId: id }));
  const [lessonId, setLessonId] = useState<string | null>(initialLesson);
  const lesson = useQuery(trpc.course.lesson.queryOptions({ id: lessonId ?? "" }, { enabled: !!lessonId }));
  const invalidate = () => qc.invalidateQueries();
  const publish = useMutation(trpc.course.publish.mutationOptions({ onSuccess: () => { toast.success("Updated"); void invalidate(); }, onError: (e) => toast.error(e.message) }));
  const save = useMutation(trpc.course.updateLesson.mutationOptions({ onSuccess: () => { toast.success("Lesson saved and re-indexed for the tutor"); void invalidate(); }, onError: (e) => toast.error(e.message) }));
  const setStatus = useMutation(trpc.quiz.setStatus.mutationOptions({ onSuccess: () => void invalidate() }));

  if (course.isLoading) return <LoadingState rows={5} />;
  if (course.error) return <ErrorState message={course.error.message} />;
  const c = course.data!;
  const published = c.status === "PUBLISHED";
  const a = analytics.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={c.title}
        description="Manage content, review AI-generated quizzes and track learners."
        actions={<><Button asChild variant="outline"><Link href={`/courses/${c.id}`}>View as learner</Link></Button><Button onClick={() => publish.mutate({ id: c.id, published: !published })} loading={publish.isPending} variant={published ? "outline" : "default"}>{published ? "Unpublish" : "Publish"}</Button></>}
      />
      <Tabs defaultValue={initialLesson ? "content" : "analytics"}>
        <TabsList><TabsTrigger value="analytics">Analytics</TabsTrigger><TabsTrigger value="content">Content</TabsTrigger><TabsTrigger value="quizzes">Quizzes & quality</TabsTrigger></TabsList>
        <TabsContent value="analytics" className="space-y-4">
          {analytics.isLoading ? <LoadingState /> : analytics.error ? <ErrorState message={analytics.error.message} /> : a && (
            <>
              <div className="grid gap-4 sm:grid-cols-4">
                {[["Learners", a.summary.learners], ["Completion", pct(a.summary.completionRate)], ["Avg progress", pct(a.summary.avgProgress)], ["Avg quiz score", pct(a.summary.avgQuizScore)]].map(([k, v]) => (
                  <Card key={k as string}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{k}</p><p className="text-2xl font-bold">{v}</p></CardContent></Card>
                ))}
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card><CardHeader><CardTitle>Lesson completion</CardTitle></CardHeader><CardContent className="space-y-3">{a.lessonCompletion.map((l) => <div key={l.lessonId}><div className="flex justify-between text-xs"><span>{l.title}</span><span>{l.completed} · {pct(l.rate)}</span></div><Progress value={l.rate * 100} label={l.title} /></div>)}</CardContent></Card>
                <Card><CardHeader><CardTitle>Weak concepts</CardTitle><CardDescription>Lowest average mastery across learners</CardDescription></CardHeader><CardContent className="space-y-3">{a.weakConcepts.length === 0 && <p className="text-sm text-muted-foreground">Not enough data yet.</p>}{a.weakConcepts.map((w) => <div key={w.conceptId}><div className="flex justify-between text-xs"><span>{w.name}</span><span>{pct(w.avgMastery)} · {pct(w.masteredPct)} mastered</span></div><Progress value={(w.avgMastery ?? 0) * 100} tone={masteryTone(w.avgMastery)} label={w.name} /></div>)}</CardContent></Card>
              </div>
              <Card><CardHeader><CardTitle>Hardest questions</CardTitle></CardHeader><CardContent><ul className="divide-y text-sm">{a.hardestItems.map((h) => <li key={h.questionId} className="flex gap-3 py-2"><Badge tone="danger">{pct(h.pCorrect)}</Badge><span className="flex-1 line-clamp-2">{h.prompt}</span><span className="text-xs text-muted-foreground">{h.n} answers</span></li>)}</ul></CardContent></Card>
              <Card><CardHeader><CardTitle>Learners</CardTitle></CardHeader><CardContent className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-muted-foreground"><tr><th className="py-2">Name</th><th>Progress</th><th>Quizzes</th><th>Avg score</th></tr></thead><tbody className="divide-y">{a.learners.map((l) => <tr key={l.userId}><td className="py-2">{l.name}</td><td>{pct(l.progress)}</td><td>{l.quizzes}</td><td>{pct(l.avgScore)}</td></tr>)}</tbody></table></CardContent></Card>
            </>
          )}
        </TabsContent>
        <TabsContent value="content" className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <Card><CardContent className="space-y-3 p-4">{c.modules.map((m) => <div key={m.id}><p className="text-xs font-semibold text-muted-foreground">{m.title}</p><ul>{m.lessons.map((l) => <li key={l.id}><button type="button" className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-muted ${lessonId === l.id ? "bg-accent" : ""}`} onClick={() => setLessonId(l.id)}>{l.title}</button></li>)}</ul></div>)}</CardContent></Card>
          <div>{!lessonId ? <p className="text-sm text-muted-foreground">Select a lesson to edit.</p> : lesson.isLoading || !lesson.data ? <LoadingState rows={2} /> : <LessonEditor key={lesson.data.id + lesson.data.updatedAt.toString()} initial={lesson.data.content} saving={save.isPending} onSave={(content) => save.mutate({ id: lesson.data!.id, content })} />}</div>
        </TabsContent>
        <TabsContent value="quizzes" className="space-y-3">
          {quizzes.data?.map((q) => (
            <Card key={q.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2"><CardTitle>{q.title}</CardTitle><Badge tone={q.status === "PUBLISHED" ? "success" : q.status === "REJECTED" ? "danger" : "muted"}>{q.status.toLowerCase()}</Badge></div>
                <CardDescription>{q._count.questions} questions · {q._count.attempts} attempts · LLM-as-judge: {q.judgeReport?.summary ?? "n/a"}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {q.judgeReport?.rejected.map((r, i) => <div key={i} className="rounded-md bg-danger/5 p-2 text-xs"><p className="font-medium">Rejected: {r.prompt}</p><p className="text-muted-foreground">{r.issues.join("; ")}</p></div>)}
                <div className="flex gap-2">
                  <Button asChild size="sm" variant="outline"><Link href={`/quizzes/${q.id}`}>Preview</Link></Button>
                  {q.status !== "PUBLISHED" ? <Button size="sm" onClick={() => setStatus.mutate({ id: q.id, status: "PUBLISHED" })}>Publish</Button> : <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: q.id, status: "REJECTED" })}>Reject</Button>}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ManageCoursePage() {
  return (
    <Suspense>
      <Manage />
    </Suspense>
  );
}
