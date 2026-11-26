"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Lightbulb, Play, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CodeEditor } from "@/components/code-editor";
import { Markdown } from "@/components/markdown";
import { PageHeader } from "@/components/page-header";
import { celebrate } from "@/components/reward-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useTRPC } from "@/lib/trpc";

export default function ExercisePage() {
  const { id } = useParams<{ id: string }>();
  const trpc = useTRPC();
  const ex = useQuery(trpc.code.get.queryOptions({ id }));
  const [code, setCode] = useState("");
  useEffect(() => {
    if (ex.data) setCode(ex.data.lastCode ?? ex.data.starterCode);
  }, [ex.data]);
  const run = useMutation(trpc.code.run.mutationOptions({ onSuccess: (r) => celebrate(r.award), onError: (e) => toast.error(e.message) }));

  if (ex.isLoading) return <LoadingState rows={4} />;
  if (ex.error) return <ErrorState message={ex.error.message} onRetry={() => ex.refetch()} />;
  const e = ex.data!;
  const r = run.data;
  return (
    <div className="space-y-6">
      <PageHeader title={e.title} description={e.course.title} actions={e.solved ? <Badge tone="success"><CheckCircle2 className="h-3 w-3" /> Solved</Badge> : undefined} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Card><CardContent className="p-5"><Markdown>{e.prompt}</Markdown></CardContent></Card>
          <Card>
            <CardHeader><CardTitle>Test cases</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2 font-mono text-xs">
                {e.tests.map((t, i) => {
                  const res = r?.results[i];
                  return (
                    <li key={i} className="flex items-start gap-2 rounded-md bg-muted p-2">
                      {res ? (res.passed ? <CheckCircle2 className="h-4 w-4 text-success" aria-label="passed" /> : <XCircle className="h-4 w-4 text-danger" aria-label="failed" />) : <span className="h-4 w-4" />}
                      <span>{e.entrypoint}(…{t.args}) → {t.expected}{res && !res.passed && <span className="block text-danger">got {res.error ?? res.actual}</span>}</span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
          {r?.hint && (
            <Card className="border-warning/50">
              <CardContent className="flex gap-3 p-5"><Lightbulb className="h-5 w-5 shrink-0 text-warning" aria-hidden /><div><p className="text-sm font-medium">Hint</p><Markdown className="text-sm">{r.hint}</Markdown></div></CardContent>
            </Card>
          )}
        </div>
        <div className="space-y-3">
          <CodeEditor value={code} onChange={setCode} label="Solution code" className="min-h-80" />
          <div className="flex items-center gap-3">
            <Button onClick={() => run.mutate({ id: e.id, code })} loading={run.isPending}><Play className="h-4 w-4" /> Run tests</Button>
            {r && <span className="text-sm" role="status">{r.passed ? "✅ All tests passed" : `${r.results.filter((x) => x.passed).length}/${r.results.length} passed`} · {r.durationMs}ms · {r.runner}</span>}
          </div>
          {r?.stdout && <pre className="max-h-40 overflow-auto rounded-lg bg-muted p-3 text-xs">{r.stdout}</pre>}
          {e.lesson && <Link href={`/lessons/${e.lesson.id}`} className="text-sm text-primary underline">Back to {e.lesson.title}</Link>}
        </div>
      </div>
    </div>
  );
}
