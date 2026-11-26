"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Bot, Swords, Timer, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { useSession } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { connectBattle, type BattleEnd, type BattleStart } from "@/lib/battle";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type Phase = "idle" | "waiting" | "playing" | "done";

export default function BattlePage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data: me } = useSession();
  const history = useQuery(trpc.gamification.battles.queryOptions());
  const socketRef = useRef<Socket | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [battle, setBattle] = useState<BattleStart | null>(null);
  const [index, setIndex] = useState(0);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState<{ correct: boolean; correctAnswer: string } | null>(null);
  const [end, setEnd] = useState<BattleEnd | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);

  useEffect(() => () => void socketRef.current?.disconnect(), []);
  useEffect(() => {
    if (phase !== "playing") return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [phase]);

  const join = useCallback(
    async (vsBot: boolean) => {
      setMessage(null);
      setEnd(null);
      const { token } = await qc.fetchQuery(trpc.me.socketToken.queryOptions(undefined, { staleTime: 0 }));
      socketRef.current?.disconnect();
      const s = connectBattle(token);
      socketRef.current = s;
      s.on("connect_error", () => setMessage("Could not connect to the battle server."));
      s.on("queue:waiting", () => setPhase("waiting"));
      s.on("queue:timeout", (m: { message: string }) => {
        setPhase("idle");
        setMessage(m.message);
      });
      s.on("battle:error", (m: { message: string }) => setMessage(m.message));
      s.on("battle:start", (b: BattleStart) => {
        setBattle(b);
        setIndex(0);
        setScores({});
        setProgress({});
        setFeedback(null);
        setPhase("playing");
        setStartedAt(Date.now());
      });
      s.on("battle:progress", (p: { userId: string; index: number; scores: Record<string, number> }) => {
        setScores(p.scores);
        setProgress((prev) => ({ ...prev, [p.userId]: p.index + 1 }));
      });
      s.on("battle:feedback", (f: { correct: boolean; correctAnswer: string }) => setFeedback(f));
      s.on("battle:end", (e: BattleEnd) => {
        setEnd(e);
        setPhase("done");
        void qc.invalidateQueries({ queryKey: trpc.gamification.battles.queryKey() });
      });
      s.emit("queue:join", { vsBot });
    },
    [qc, trpc],
  );

  const answer = (option: string) => {
    if (!battle || feedback) return;
    socketRef.current?.emit("battle:answer", { battleId: battle.battleId, index, answer: option });
  };
  const next = () => {
    setFeedback(null);
    setIndex((i) => i + 1);
    setStartedAt(Date.now());
  };

  const q = battle?.questions[index];
  const remaining = battle ? Math.max(0, battle.perQuestionMs - (now - startedAt)) : 0;
  const myScore = me ? (scores[me.id] ?? 0) : 0;
  const theirScore = battle ? (scores[battle.opponent.id] ?? 0) : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Quiz Battle" description="Real-time 1v1 quiz duels. Correct answers score 100 points plus a speed bonus." />
      {message && <p role="alert" className="rounded-lg bg-muted p-3 text-sm">{message}</p>}

      {(phase === "idle" || phase === "done") && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card><CardContent className="space-y-3 p-6"><Users className="h-6 w-6 text-primary" aria-hidden /><p className="font-medium">Find an opponent</p><p className="text-sm text-muted-foreground">Get matched with another learner online.</p><Button onClick={() => join(false)}>Join queue</Button></CardContent></Card>
          <Card><CardContent className="space-y-3 p-6"><Bot className="h-6 w-6 text-primary" aria-hidden /><p className="font-medium">Practice vs LearnBot</p><p className="text-sm text-muted-foreground">A bot that answers ~60% correctly.</p><Button variant="secondary" onClick={() => join(true)}>Play bot</Button></CardContent></Card>
        </div>
      )}

      {phase === "waiting" && (
        <Card><CardContent className="flex items-center justify-between p-6"><p className="animate-pulse">Searching for an opponent…</p><Button variant="ghost" onClick={() => { socketRef.current?.emit("queue:leave"); setPhase("idle"); }}>Cancel</Button></CardContent></Card>
      )}

      {phase === "playing" && battle && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">You</p><p className="text-2xl font-bold" data-testid="my-score">{myScore}</p><Progress value={((progress[me?.id ?? ""] ?? 0) / battle.questions.length) * 100} label="Your progress" /></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{battle.opponent.name}</p><p className="text-2xl font-bold">{theirScore}</p><Progress value={((progress[battle.opponent.id] ?? 0) / battle.questions.length) * 100} tone="warning" label="Opponent progress" /></CardContent></Card>
          </div>
          {q ? (
            <motion.div key={index} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between text-xs text-muted-foreground"><span>Question {index + 1}/{battle.questions.length}</span><span className="flex items-center gap-1"><Timer className="h-3 w-3" aria-hidden />{Math.ceil(remaining / 1000)}s</span></div>
                  <CardTitle className="font-medium">{q.prompt}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 sm:grid-cols-2">
                  {q.options.map((o) => (
                    <Button key={o} variant="outline" className={cn("h-auto justify-start whitespace-normal py-3 text-left capitalize", feedback && o === feedback.correctAnswer && "border-success bg-success/10")} disabled={!!feedback} onClick={() => answer(o)}>{o}</Button>
                  ))}
                  {feedback && (
                    <div className="flex items-center justify-between sm:col-span-2">
                      <p role="status" className={feedback.correct ? "text-success" : "text-danger"}>{feedback.correct ? "Correct!" : `Wrong - answer: ${feedback.correctAnswer}`}</p>
                      <Button onClick={next}>{index + 1 < battle.questions.length ? "Next question" : "Finish"}</Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            <Card><CardContent className="p-6 text-center text-muted-foreground">Waiting for {battle.opponent.name} to finish…</CardContent></Card>
          )}
        </div>
      )}

      {phase === "done" && end && battle && (
        <Card className="border-primary/40">
          <CardContent className="p-6 text-center">
            <Swords className="mx-auto h-8 w-8 text-primary" aria-hidden />
            <p className="mt-2 text-2xl font-bold" data-testid="battle-result">{end.winnerId === me?.id ? "You won! 🏆" : end.winnerId ? `${battle.opponent.name} won` : "It's a draw"}</p>
            <p className="text-muted-foreground">{end.scores[me?.id ?? ""] ?? 0} - {end.scores[battle.opponent.id] ?? 0} · +{end.xp[me?.id ?? ""] ?? 0} XP</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Recent battles</CardTitle></CardHeader>
        <CardContent>
          {history.data?.length ? (
            <ul className="divide-y text-sm">
              {history.data.map((h) => (
                <li key={h.id} className="flex items-center justify-between py-2"><span>vs {h.opponent}</span><span>{h.myScore} - {h.theirScore}</span><Badge tone={h.result === "win" ? "success" : h.result === "draw" ? "muted" : "danger"}>{h.result}</Badge></li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No battles yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
