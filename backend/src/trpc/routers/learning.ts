import { z } from "zod";
import { Rating } from "../../learning/fsrs";
import * as code from "../../services/code";
import * as flash from "../../services/flashcard";
import { courseMastery } from "../../services/mastery";
import * as quiz from "../../services/quiz";
import * as tutor from "../../services/tutor";
import { aiRateLimited, protectedProcedure, router } from "../trpc";

const id = z.string().min(1).max(64);

export const quizRouter = router({
  adaptive: aiRateLimited(20).input(z.object({ lessonId: id })).mutation(({ ctx, input }) => quiz.adaptiveQuiz(ctx.db, ctx.user, input.lessonId)),
  generate: aiRateLimited(20)
    .input(z.object({ lessonId: id, difficulty: z.number().int().min(1).max(5).optional(), count: z.number().int().min(3).max(10).optional() }))
    .mutation(({ ctx, input }) => quiz.generateQuiz(ctx.db, ctx.user, input.lessonId, input)),
  get: protectedProcedure.input(z.object({ id })).query(({ ctx, input }) => quiz.getQuiz(ctx.db, ctx.user, input.id)),
  submit: aiRateLimited(30)
    .input(z.object({ id, answers: z.array(z.object({ questionId: id, answer: z.string().max(20_000) })).max(30) }))
    .mutation(({ ctx, input }) => quiz.submitQuiz(ctx.db, ctx.user, input.id, input.answers)),
  forCourse: protectedProcedure.input(z.object({ courseId: id })).query(({ ctx, input }) => quiz.quizzesForCourse(ctx.db, ctx.user, input.courseId)),
  setStatus: protectedProcedure
    .input(z.object({ id, status: z.enum(["PUBLISHED", "REJECTED", "DRAFT"]) }))
    .mutation(({ ctx, input }) => quiz.setQuizStatus(ctx.db, ctx.user, input.id, input.status)),
  history: protectedProcedure.query(({ ctx }) => quiz.attemptHistory(ctx.db, ctx.user)),
});

export const flashcardRouter = router({
  queue: protectedProcedure
    .input(z.object({ courseId: id.optional(), limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(({ ctx, input }) => flash.dueQueue(ctx.db, ctx.user, input ?? {})),
  review: protectedProcedure
    .input(z.object({ flashcardId: id, rating: z.union([z.literal(Rating.Again), z.literal(Rating.Hard), z.literal(Rating.Good), z.literal(Rating.Easy)]) }))
    .mutation(({ ctx, input }) => flash.reviewCard(ctx.db, ctx.user, input.flashcardId, input.rating)),
  stats: protectedProcedure.query(({ ctx }) => flash.reviewStats(ctx.db, ctx.user)),
});

export const masteryRouter = router({
  course: protectedProcedure.input(z.object({ courseId: id })).query(({ ctx, input }) => courseMastery(ctx.db, ctx.user.id, input.courseId)),
});

export const tutorRouter = router({
  createSession: protectedProcedure
    .input(z.object({ courseId: id, lessonId: id.optional() }))
    .mutation(({ ctx, input }) => tutor.createSession(ctx.db, ctx.user, input.courseId, input.lessonId)),
  sessions: protectedProcedure.input(z.object({ courseId: id.optional() }).optional()).query(({ ctx, input }) => tutor.listSessions(ctx.db, ctx.user, input?.courseId)),
  messages: protectedProcedure.input(z.object({ sessionId: id })).query(({ ctx, input }) => tutor.sessionMessages(ctx.db, ctx.user, input.sessionId)),
});

export const codeRouter = router({
  get: protectedProcedure.input(z.object({ id })).query(({ ctx, input }) => code.getExercise(ctx.db, ctx.user, input.id)),
  list: protectedProcedure.input(z.object({ courseId: id })).query(({ ctx, input }) => code.listExercises(ctx.db, ctx.user, input.courseId)),
  run: aiRateLimited(30)
    .input(z.object({ id, code: z.string().min(1).max(20_000) }))
    .mutation(({ ctx, input }) => code.runExercise(ctx.db, ctx.user, input.id, input.code)),
});
