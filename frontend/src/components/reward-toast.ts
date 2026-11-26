import { toast } from "sonner";

const BADGE_NAMES: Record<string, string> = {
  "first-lesson": "First Steps 🎯",
  "quiz-ace": "Quiz Ace 🏆",
  "streak-3": "On a Roll 🔥",
  "streak-7": "Unstoppable ⚡",
  "reviewer-50": "Memory Palace 🧠",
  coder: "Hello, World 💻",
  "battle-winner": "Duelist ⚔️",
  "xp-1000": "Scholar 📚",
  creator: "Course Creator 🛠️",
};

export function celebrate(award: { xp: number; newBadges: string[]; streak?: number } | null | undefined) {
  if (!award) return;
  if (award.xp > 0) toast.success(`+${award.xp} XP`, { description: award.streak ? `🔥 ${award.streak}-day streak` : undefined });
  for (const b of award.newBadges) toast(`Badge unlocked: ${BADGE_NAMES[b] ?? b}`);
}
