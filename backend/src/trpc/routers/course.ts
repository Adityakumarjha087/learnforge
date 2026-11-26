import { z } from "zod";
import * as courses from "../../services/course";
import { aiRateLimited, protectedProcedure, roleProcedure, router } from "../trpc";

const id = z.string().min(1).max(64);

export const courseRouter = router({
  catalog: protectedProcedure
    .input(z.object({ search: z.string().max(100).optional(), cursor: z.string().optional(), take: z.number().int().min(1).max(50).optional() }).optional())
    .query(({ ctx, input }) => courses.listCatalog(ctx.db, input ?? {})),
  mine: protectedProcedure.query(({ ctx }) => courses.myCourses(ctx.db, ctx.user)),
  get: protectedProcedure.input(z.object({ id })).query(({ ctx, input }) => courses.getCourse(ctx.db, ctx.user, input.id)),
  lesson: protectedProcedure.input(z.object({ id })).query(({ ctx, input }) => courses.getLesson(ctx.db, ctx.user, input.id)),
  generate: aiRateLimited(10)
    .input(
      z.object({
        topic: z.string().trim().min(3).max(200),
        level: z.number().int().min(1).max(5).default(2),
        documentId: id.optional(),
        moduleCount: z.number().int().min(1).max(5).default(3),
      }),
    )
    .mutation(({ ctx, input }) => courses.generateCourse(ctx.db, ctx.user, input)),
  enroll: protectedProcedure.input(z.object({ id })).mutation(({ ctx, input }) => courses.enroll(ctx.db, ctx.user, input.id)),
  completeLesson: protectedProcedure.input(z.object({ lessonId: id })).mutation(({ ctx, input }) => courses.completeLesson(ctx.db, ctx.user, input.lessonId)),
  update: protectedProcedure
    .input(z.object({ id, title: z.string().min(3).max(160).optional(), description: z.string().min(10).max(1000).optional(), level: z.number().int().min(1).max(5).optional() }))
    .mutation(({ ctx, input }) => {
      const { id: courseId, ...data } = input;
      return courses.updateCourse(ctx.db, ctx.user, courseId, data);
    }),
  updateLesson: protectedProcedure
    .input(z.object({ id, title: z.string().min(1).max(160).optional(), content: z.string().min(1).max(100_000).optional(), difficulty: z.number().int().min(1).max(5).optional() }))
    .mutation(({ ctx, input }) => {
      const { id: lessonId, ...data } = input;
      return courses.updateLesson(ctx.db, ctx.user, lessonId, data);
    }),
  addLesson: protectedProcedure
    .input(z.object({ moduleId: id, title: z.string().min(1).max(160) }))
    .mutation(({ ctx, input }) => courses.addLesson(ctx.db, ctx.user, input.moduleId, input.title)),
  publish: roleProcedure("INSTRUCTOR")
    .input(z.object({ id, published: z.boolean() }))
    .mutation(({ ctx, input }) => courses.setPublished(ctx.db, ctx.user, input.id, input.published)),
  delete: protectedProcedure.input(z.object({ id })).mutation(({ ctx, input }) => courses.deleteCourse(ctx.db, ctx.user, input.id)),
});
