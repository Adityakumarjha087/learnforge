"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { QuizPlayer } from "@/components/quiz-player";
import { celebrate } from "@/components/reward-toast";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useTRPC } from "@/lib/trpc";

export default function QuizPage() {
  const { id } = useParams<{ id: string }>();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const router = useRouter();
  const quiz = useQuery(trpc.quiz.get.queryOptions({ id }));
  const submit = useMutation(
    trpc.quiz.submit.mutationOptions({
      onSuccess: (r) => {
        celebrate(r.award);
        void qc.invalidateQueries({ queryKey: trpc.me.dashboard.queryKey() });
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const next = useMutation(trpc.quiz.adaptive.mutationOptions({ onSuccess: (r) => router.push(`/quizzes/${r.quizId}`), onError: (e) => toast.error(e.message) }));

  if (quiz.isLoading) return <LoadingState rows={5} />;
  if (quiz.error) return <ErrorState message={quiz.error.message} onRetry={() => quiz.refetch()} />;
  const q = quiz.data!;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={q.title} description={`${q.course.title}${q.lesson ? ` · ${q.lesson.title}` : ""}`} />
      <QuizPlayer key={q.id} quiz={q} result={submit.data} submitting={submit.isPending} onSubmit={(answers) => submit.mutate({ id: q.id, answers })} />
      {submit.data && (
        <div className="mt-6 flex flex-wrap gap-3">
          {q.lesson && <Button onClick={() => next.mutate({ lessonId: q.lesson!.id })} loading={next.isPending}>Next adaptive quiz</Button>}
          {q.lesson && <Button asChild variant="outline"><Link href={`/lessons/${q.lesson.id}`}>Back to lesson</Link></Button>}
          <Button asChild variant="ghost"><Link href="/review">Review flashcards</Link></Button>
        </div>
      )}
    </div>
  );
}
