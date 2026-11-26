import { Brain, Code2, GraduationCap, MessageCircleQuestion, Sparkles, Swords } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

const FEATURES = [
  { icon: Sparkles, title: "Courses from any topic or PDF", body: "Generate a structured syllabus, modules and lessons with worked examples, math and diagrams." },
  { icon: Brain, title: "FSRS spaced repetition", body: "Flashcards scheduled by a modern memory model so you review right before you forget." },
  { icon: GraduationCap, title: "Adaptive mastery", body: "Bayesian Knowledge Tracing + Elo ratings pick the next lesson and quiz difficulty for you." },
  { icon: MessageCircleQuestion, title: "Socratic AI tutor", body: "A tutor grounded in your course that guides with questions and hints instead of answers." },
  { icon: Code2, title: "Sandboxed coding exercises", body: "Run code against tests in a secure sandbox and get targeted hints when something fails." },
  { icon: Swords, title: "Live quiz battles", body: "Earn XP, streaks and badges and challenge friends to real-time 1v1 quiz battles." },
];

export default function Landing() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between p-4">
        <span className="flex items-center gap-2 text-lg font-bold"><GraduationCap className="h-6 w-6 text-primary" aria-hidden /> LearnForge</span>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="outline"><Link href="/login">Sign in</Link></Button>
        </div>
      </header>
      <main>
        <section className="mx-auto max-w-4xl px-4 py-20 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight md:text-6xl">Learn anything, <span className="text-primary">adaptively</span>.</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">LearnForge turns a topic or your study notes into a full course with quizzes, flashcards and a personal tutor that adapts to what you actually know.</p>
          <div className="mt-8 flex justify-center gap-3">
            <Button asChild size="lg"><Link href="/login">Start learning free</Link></Button>
            <Button asChild size="lg" variant="outline"><Link href="/login?demo=1">Try the demo</Link></Button>
          </div>
        </section>
        <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-20 sm:grid-cols-2 lg:grid-cols-3" aria-label="Features">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border bg-card p-6">
              <f.icon className="h-6 w-6 text-primary" aria-hidden />
              <h2 className="mt-3 font-semibold">{f.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
