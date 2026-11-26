"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GraduationCap, KeyRound, Mail } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authApi } from "@/lib/auth";

const DEMO = [
  { email: "alex@learnforge.dev", label: "Learner (Alex)" },
  { email: "maya@learnforge.dev", label: "Instructor (Dr. Maya)" },
  { email: "admin@learnforge.dev", label: "Admin" },
];

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const qc = useQueryClient();
  const providers = useQuery({ queryKey: ["providers"], queryFn: authApi.providers });
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"LEARNER" | "INSTRUCTOR">("LEARNER");
  const [magicSent, setMagicSent] = useState<string | null>(null);

  const done = async () => {
    await qc.invalidateQueries({ queryKey: ["session"] });
    router.replace(next.startsWith("/") ? next : "/dashboard");
  };
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <GraduationCap className="h-10 w-10 text-primary" aria-hidden />
          <CardTitle className="text-2xl">Welcome to LearnForge</CardTitle>
          <CardDescription>Sign in to continue learning</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="register">Register</TabsTrigger>
              <TabsTrigger value="magic">Email link</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run("login", async () => { await authApi.login(email, password); await done(); }); }}>
                <div className="space-y-1"><Label htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                <div className="space-y-1"><Label htmlFor="password">Password</Label><Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
                <Button type="submit" className="w-full" loading={busy === "login"}>Sign in</Button>
              </form>
            </TabsContent>
            <TabsContent value="register">
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run("register", async () => { await authApi.register({ email, password, name, role }); await done(); }); }}>
                <div className="space-y-1"><Label htmlFor="r-name">Name</Label><Input id="r-name" required value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div className="space-y-1"><Label htmlFor="r-email">Email</Label><Input id="r-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                <div className="space-y-1"><Label htmlFor="r-password">Password (min 8)</Label><Input id="r-password" type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
                <div className="space-y-1"><Label htmlFor="r-role">I am a…</Label><Select id="r-role" value={role} onChange={(e) => setRole(e.target.value as "LEARNER" | "INSTRUCTOR")}><option value="LEARNER">Learner</option><option value="INSTRUCTOR">Instructor</option></Select></div>
                <Button type="submit" className="w-full" loading={busy === "register"}>Create account</Button>
              </form>
            </TabsContent>
            <TabsContent value="magic">
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run("magic", async () => { await authApi.magicLink(email); setMagicSent(email); }); }}>
                <div className="space-y-1"><Label htmlFor="m-email">Email</Label><Input id="m-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                <Button type="submit" className="w-full" loading={busy === "magic"}><Mail className="h-4 w-4" /> Email me a sign-in link</Button>
              </form>
              {magicSent && <MagicDevInbox email={magicSent} />}
            </TabsContent>
          </Tabs>

          {(providers.data?.oauth.length ?? 0) > 0 && (
            <div className="grid gap-2">
              {providers.data!.oauth.map((p) => (
                <Button key={p} asChild variant="outline"><a href={`/api/auth/oauth/${p}`}><KeyRound className="h-4 w-4" aria-hidden /> Continue with {p === "github" ? "GitHub" : "Google"}</a></Button>
              ))}
            </div>
          )}

          {providers.data?.devLogin && (
            <div className="space-y-2 rounded-lg border border-dashed p-3">
              <p className="text-xs font-medium text-muted-foreground">Demo accounts (dev mode) · password Password123!</p>
              <div className="grid gap-2">
                {DEMO.map((d) => (
                  <Button key={d.email} variant="secondary" size="sm" loading={busy === d.email} onClick={() => run(d.email, async () => { await authApi.devLogin(d.email); await done(); })}>
                    {d.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MagicDevInbox({ email }: { email: string }) {
  const mail = useQuery({ queryKey: ["mailbox", email], queryFn: () => authApi.mailbox(email) });
  const latest = mail.data?.[0];
  return (
    <div className="mt-3 rounded-lg bg-muted p-3 text-sm" role="status">
      <p>Check your inbox for a sign-in link.</p>
      {latest?.link && (
        <p className="mt-2 text-xs text-muted-foreground">
          Dev mailbox (no SMTP configured): <a className="text-primary underline" href={latest.link}>open the magic link</a>
        </p>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
