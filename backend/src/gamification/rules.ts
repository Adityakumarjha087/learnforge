export const XP = {
  lessonComplete: 20,
  correctAnswer: 10,
  perfectQuiz: 25,
  flashcardReview: 2,
  exercisePassed: 30,
  battleWin: 50,
  battleLoss: 10,
  courseCreated: 15,
} as const;

export const levelForXp = (xp: number) => Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
export const xpForLevel = (level: number) => (level - 1) ** 2 * 100;

export function levelProgress(xp: number) {
  const level = levelForXp(xp);
  const floor = xpForLevel(level);
  const ceil = xpForLevel(level + 1);
  return { level, current: xp - floor, needed: ceil - floor, pct: Math.round(((xp - floor) / (ceil - floor)) * 100) };
}

const utcDay = (d: Date) => Math.floor(d.getTime() / 86_400_000);

/** Daily streak update: same day keeps it, consecutive day increments, a gap resets to 1. */
export function nextStreak(lastActiveAt: Date | null, streak: number, now: Date): number {
  if (!lastActiveAt) return 1;
  const gap = utcDay(now) - utcDay(lastActiveAt);
  if (gap <= 0) return Math.max(1, streak);
  if (gap === 1) return streak + 1;
  return 1;
}

export interface BadgeDef {
  key: string;
  name: string;
  description: string;
  icon: string;
}

export const BADGES: readonly BadgeDef[] = [
  { key: "first-lesson", name: "First Steps", description: "Complete your first lesson", icon: "🎯" },
  { key: "quiz-ace", name: "Quiz Ace", description: "Score 100% on a quiz", icon: "🏆" },
  { key: "streak-3", name: "On a Roll", description: "Keep a 3-day learning streak", icon: "🔥" },
  { key: "streak-7", name: "Unstoppable", description: "Keep a 7-day learning streak", icon: "⚡" },
  { key: "reviewer-50", name: "Memory Palace", description: "Review 50 flashcards", icon: "🧠" },
  { key: "coder", name: "Hello, World", description: "Pass your first coding exercise", icon: "💻" },
  { key: "battle-winner", name: "Duelist", description: "Win a quiz battle", icon: "⚔️" },
  { key: "xp-1000", name: "Scholar", description: "Earn 1,000 XP", icon: "📚" },
  { key: "creator", name: "Course Creator", description: "Create a course", icon: "🛠️" },
];

export interface BadgeStats {
  lessonsCompleted: number;
  perfectQuizzes: number;
  streak: number;
  reviews: number;
  exercisesPassed: number;
  battleWins: number;
  xp: number;
  coursesCreated: number;
}

export function earnedBadges(s: BadgeStats): string[] {
  const earned: string[] = [];
  if (s.lessonsCompleted >= 1) earned.push("first-lesson");
  if (s.perfectQuizzes >= 1) earned.push("quiz-ace");
  if (s.streak >= 3) earned.push("streak-3");
  if (s.streak >= 7) earned.push("streak-7");
  if (s.reviews >= 50) earned.push("reviewer-50");
  if (s.exercisesPassed >= 1) earned.push("coder");
  if (s.battleWins >= 1) earned.push("battle-winner");
  if (s.xp >= 1000) earned.push("xp-1000");
  if (s.coursesCreated >= 1) earned.push("creator");
  return earned;
}
