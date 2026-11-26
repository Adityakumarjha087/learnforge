"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useTRPC } from "@/lib/trpc";

export default function InstructorPage() {
  const trpc = useTRPC();
  const courses = useQuery(trpc.instructor.overview.queryOptions());
  return (
    <div>
      <PageHeader title="Instructor studio" description="Create, edit and publish courses; see how learners are doing." actions={<Button asChild><Link href="/courses/new">New course</Link></Button>} />
      {courses.isLoading ? <LoadingState /> : courses.error ? <ErrorState message={courses.error.message} /> : courses.data!.length === 0 ? <EmptyState title="No courses yet" /> : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground"><tr><th className="p-3">Course</th><th className="p-3">Status</th><th className="p-3">Lessons</th><th className="p-3">Learners</th><th className="p-3">Quizzes</th><th className="p-3" /></tr></thead>
              <tbody className="divide-y">
                {courses.data!.map((c) => (
                  <tr key={c.id}>
                    <td className="p-3 font-medium">{c.title}</td>
                    <td className="p-3"><Badge tone={c.status === "PUBLISHED" ? "success" : "muted"}>{c.status.toLowerCase()}</Badge></td>
                    <td className="p-3">{c.lessons}</td>
                    <td className="p-3">{c.enrollments}</td>
                    <td className="p-3">{c.quizzes}</td>
                    <td className="p-3 text-right"><Button asChild size="sm" variant="outline"><Link href={`/instructor/courses/${c.id}`}>Manage</Link></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
