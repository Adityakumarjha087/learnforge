"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CheckCircle2, Code2, MessageCircleQuestion, PenLine } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/markdown";
import { celebrate } from "@/components/reward-toast";
import { TutorChat } from "@/components/tutor-chat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useTRPC } from "@/lib/trpc";
import { difficultyName, pct } from "@/lib/utils";

export default function LessonPage() {
  const { id } = useParams<{ id: string }>();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const router = useRouter();
  const lesson = useQuery(trpc.course.lesson.queryOptions({ id }));
  const [tutorSession, setTutorSession] = useState<string | null>(null);

  const complete = useMutation(
    trpc.course.completeLesson.mutationOptions({
      onSuccess: (r) => {
        celebrate(r.award);
        void qc.invalidateQueries();
      },
    }),
  );
  const quiz = useMutation(
    trpc.quiz.adaptive.mutationOptions({
      onSuccess: (r) => router.push(`/quizzes/${r.quizId}`),
      onError: (e) => toast.error(e.message),
    }),
  );
  const tutor = useMutation(trpc.tutor.createSession.mutationOptions({ onSuccess: (s) => setTutorSession(s.id), onError: (e) => toast.error(e.message) }));

  if (lesson.isLoading) return <LoadingState rows={6} />;
  if (lesson.error) return <ErrorState message={lesson.error.message} onRetry={() => lesson.refetch()} />;
  const l = lesson.data!;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
      <article className="min-w-0 space-y-6">
        <div className="space-y-2">
          <Link href={`/courses/${l.course.id}`} className="text-sm text-muted-foreground hover:underline">← {l.course.title}</Link>
          <h1 className="text-3xl font-bold">{l.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="primary">{difficultyName(l.difficulty)}</Badge>
            <span className="text-muted-foreground">{l.minutes} min · {l.module.title}</span>
            {l.mastery !== null && <Badge tone="muted">Mastery {pct(l.mastery)}</Badge>}
            {l.completed && <Badge tone="success"><CheckCircle2 className="h-3 w-3" /> Completed</Badge>}
          </div>
        </div>
        <Card><CardContent className="p-6 md:p-8"><Markdown>{l.content}</Markdown></CardContent></Card>
        <div className="flex flex-wrap gap-3">
          {!l.completed && <Button onClick={() => complete.mutate({ lessonId: l.id })} loading={complete.isPending}><CheckCircle2 className="h-4 w-4" /> Mark complete</Button>}
          <Button variant="secondary" onClick={() => quiz.mutate({ lessonId: l.id })} loading={quiz.isPending}><PenLine className="h-4 w-4" /> Take adaptive quiz</Button>
          {l.exercises.map((e) => <Button key={e.id} asChild variant="outline"><Link href={`/exercises/${e.id}`}><Code2 className="h-4 w-4" /> {e.title}</Link></Button>)}
          {l.course.canEdit && <Button asChild variant="ghost"><Link href={`/instructor/courses/${l.course.id}?lesson=${l.id}`}>Edit lesson</Link></Button>}
        </div>
        <nav className="flex justify-between border-t pt-4" aria-label="Lesson navigation">
          {l.prevLessonId ? <Button asChild variant="ghost"><Link href={`/lessons/${l.prevLessonId}`}><ArrowLeft className="h-4 w-4" /> Previous</Link></Button> : <span />}
          {l.nextLessonId && <Button asChild variant="ghost"><Link href={`/lessons/${l.nextLessonId}`}>Next <ArrowRight className="h-4 w-4" /></Link></Button>}
        </nav>
      </article>
      <aside className="xl:sticky xl:top-6 xl:self-start">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><MessageCircleQuestion className="h-4 w-4" /> Socratic tutor</CardTitle></CardHeader>
          <CardContent>
            {tutorSession ? (
              <TutorChat sessionId={tutorSession} history={[]} compact />
            ) : (
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>Stuck? The tutor knows this lesson and will guide you with questions and hints - not answers.</p>
                <Button className="w-full" onClick={() => tutor.mutate({ courseId: l.course.id, lessonId: l.id })} loading={tutor.isPending}>Start tutoring session</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
