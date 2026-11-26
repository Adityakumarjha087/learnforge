"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { celebrate } from "@/components/reward-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { authFetch, useTRPC } from "@/lib/trpc";

interface UploadResult {
  documentId: string;
  filename: string;
  characters: number;
  preview: string;
}

export default function NewCoursePage() {
  const trpc = useTRPC();
  const router = useRouter();
  const qc = useQueryClient();
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState(2);
  const [modules, setModules] = useState(3);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);

  const generate = useMutation(
    trpc.course.generate.mutationOptions({
      onSuccess: async (res) => {
        celebrate(res.award);
        toast.success("Course generated!");
        await qc.invalidateQueries();
        router.push(`/courses/${res.courseId}`);
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const onFile = async (file: File) => {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await authFetch("/api/uploads", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Upload failed");
      setUpload(json);
      if (!topic) setTopic(file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Create a course" description="Describe a topic, or upload a PDF/notes file to ground the course in your own material." />
      <Card>
        <CardHeader>
          <CardTitle>Course details</CardTitle>
          <CardDescription>AI drafts a syllabus with modules, lessons, flashcards and a concept map. Quizzes are generated adaptively per lesson.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); generate.mutate({ topic, level, moduleCount: modules, documentId: upload?.documentId }); }}>
            <div className="space-y-1">
              <Label htmlFor="topic">Topic</Label>
              <Input id="topic" required minLength={3} maxLength={200} placeholder="e.g. Introduction to Probability" value={topic} onChange={(e) => setTopic(e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="level">Level</Label>
                <Select id="level" value={level} onChange={(e) => setLevel(Number(e.target.value))}>
                  {["Intro", "Beginner", "Intermediate", "Advanced", "Expert"].map((l, i) => <option key={l} value={i + 1}>{l}</option>)}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="modules">Modules</Label>
                <Select id="modules" value={modules} onChange={(e) => setModules(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </Select>
              </div>
            </div>
            <div className="space-y-2 rounded-lg border border-dashed p-4">
              <Label htmlFor="file" className="flex items-center gap-2"><FileUp className="h-4 w-4" /> Study material (optional)</Label>
              <input id="file" type="file" accept=".pdf,.md,.markdown,.txt,application/pdf,text/plain,text/markdown" className="block w-full text-sm" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} disabled={uploading} />
              {uploading && <p className="text-sm text-muted-foreground" role="status">Extracting text…</p>}
              {upload && (
                <div className="rounded-md bg-muted p-3 text-xs" data-testid="upload-preview">
                  <p className="font-medium">{upload.filename} · {upload.characters.toLocaleString()} characters</p>
                  <p className="mt-1 line-clamp-3 text-muted-foreground">{upload.preview}</p>
                </div>
              )}
            </div>
            <Button type="submit" size="lg" className="w-full" loading={generate.isPending} disabled={uploading}>
              <Sparkles className="h-4 w-4" /> {generate.isPending ? "Generating your course…" : "Generate course"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
