"use client";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Users } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTRPC } from "@/lib/trpc";
import { difficultyName } from "@/lib/utils";

export default function CoursesPage() {
  const trpc = useTRPC();
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search);
  const catalog = useQuery(trpc.course.catalog.queryOptions({ search: q || undefined }));
  const mine = useQuery(trpc.course.mine.queryOptions());

  return (
    <div>
      <PageHeader title="Courses" description="Browse the catalog or continue your own courses." actions={<Button asChild><Link href="/courses/new"><Plus className="h-4 w-4" /> New course</Link></Button>} />
      <Tabs defaultValue="catalog">
        <TabsList>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          <TabsTrigger value="mine">My courses</TabsTrigger>
        </TabsList>
        <TabsContent value="catalog" className="space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input aria-label="Search courses" placeholder="Search by title or topic" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {catalog.isLoading ? <LoadingState /> : catalog.error ? <ErrorState message={catalog.error.message} onRetry={() => catalog.refetch()} /> : catalog.data!.items.length === 0 ? (
            <EmptyState title="No courses found" description="Try a different search or create your own course." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {catalog.data!.items.map((c) => (
                <Link key={c.id} href={`/courses/${c.id}`} className="group">
                  <Card className="h-full transition-shadow group-hover:shadow-md">
                    <CardHeader>
                      <div className="flex gap-2"><Badge tone="primary">{difficultyName(c.level)}</Badge>{c.source === "UPLOAD" && <Badge tone="muted">From notes</Badge>}</div>
                      <CardTitle className="group-hover:underline">{c.title}</CardTitle>
                      <CardDescription className="line-clamp-3">{c.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>by {c.author.name}</span>
                      <span className="flex items-center gap-1"><Users className="h-3 w-3" aria-hidden /> {c._count.enrollments}</span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="mine" className="space-y-3">
          {mine.isLoading ? <LoadingState /> : (mine.data?.enrolled.length ?? 0) + (mine.data?.authored.length ?? 0) === 0 ? (
            <EmptyState title="You haven't started any courses" action={<Button asChild><Link href="/courses/new">Generate one</Link></Button>} />
          ) : (
            <>
              {mine.data!.enrolled.map((c) => (
                <Card key={c.id}><CardContent className="flex items-center gap-4 p-4">
                  <div className="flex-1"><Link className="font-medium hover:underline" href={`/courses/${c.id}`}>{c.title}</Link><Progress className="mt-2" value={c.progress * 100} label={`${c.title} progress`} /></div>
                  <Badge tone={c.status === "PUBLISHED" ? "success" : "muted"}>{c.status.toLowerCase()}</Badge>
                </CardContent></Card>
              ))}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
