import { courseRouter } from "./routers/course";
import { codeRouter, flashcardRouter, masteryRouter, quizRouter, tutorRouter } from "./routers/learning";
import { billingRouter, gamificationRouter, instructorRouter, meRouter, systemRouter } from "./routers/platform";
import { createCallerFactory, router } from "./trpc";

export const appRouter = router({
  system: systemRouter,
  me: meRouter,
  course: courseRouter,
  quiz: quizRouter,
  flashcard: flashcardRouter,
  mastery: masteryRouter,
  tutor: tutorRouter,
  code: codeRouter,
  gamification: gamificationRouter,
  instructor: instructorRouter,
  billing: billingRouter,
});

export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);
