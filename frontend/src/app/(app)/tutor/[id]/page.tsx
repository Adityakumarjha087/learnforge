"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { TutorChat } from "@/components/tutor-chat";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useTRPC } from "@/lib/trpc";

export default function TutorSessionPage() {
  const { id } = useParams<{ id: string }>();
  const trpc = useTRPC();
  const data = useQuery(trpc.tutor.messages.queryOptions({ sessionId: id }, { staleTime: Infinity }));
  if (data.isLoading) return <LoadingState rows={3} />;
  if (data.error) return <ErrorState message={data.error.message} />;
  const { session, messages } = data.data!;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={session.title} description={session.course.title} actions={<Link href={`/courses/${session.courseId}`} className="text-sm text-primary underline">Back to course</Link>} />
      <TutorChat sessionId={session.id} history={messages} />
    </div>
  );
}
