import { z } from "zod";
import { signSocketToken } from "../../auth/tokens";
import { battleHistory } from "../../battle/manager";
import { cancelSubscription, createCheckout, mockSignal, subscriptionState } from "../../billing/service";
import { env } from "../../config/env";
import { leaderboard, profile } from "../../gamification/service";
import { courseAnalytics, instructorOverview } from "../../services/analytics";
import { usageSummary } from "../../services/usage";
import { protectedProcedure, publicProcedure, roleProcedure, router } from "../trpc";
import { enabledProviders } from "../../auth/oauth";

export const meRouter = router({
  get: protectedProcedure.query(({ ctx }) => profile(ctx.db, ctx.user.id)),
  socketToken: protectedProcedure.query(async ({ ctx }) => ({ token: await signSocketToken(ctx.user) })),
  usage: protectedProcedure.query(({ ctx }) => usageSummary(ctx.db, ctx.user.id)),
  dashboard: protectedProcedure.query(async ({ ctx }) => {
    const [me, usage, dueCount] = await Promise.all([
      profile(ctx.db, ctx.user.id),
      usageSummary(ctx.db, ctx.user.id),
      ctx.db.reviewCard.count({ where: { userId: ctx.user.id, due: { lte: new Date() } } }),
    ]);
    return { me, usage, dueCount };
  }),
});

export const gamificationRouter = router({
  leaderboard: protectedProcedure
    .input(z.object({ period: z.enum(["week", "all"]).default("week") }).optional())
    .query(({ ctx, input }) => leaderboard(ctx.db, input?.period ?? "week")),
  battles: protectedProcedure.query(({ ctx }) => battleHistory(ctx.db, ctx.user.id)),
});

export const instructorRouter = router({
  overview: roleProcedure("INSTRUCTOR").query(({ ctx }) => instructorOverview(ctx.db, ctx.user)),
  analytics: roleProcedure("INSTRUCTOR")
    .input(z.object({ courseId: z.string().min(1) }))
    .query(({ ctx, input }) => courseAnalytics(ctx.db, ctx.user, input.courseId)),
});

export const billingRouter = router({
  status: protectedProcedure.query(({ ctx }) => subscriptionState(ctx.db, ctx.user.id)),
  checkout: protectedProcedure.mutation(({ ctx }) => createCheckout(ctx.db, ctx.user)),
  cancel: protectedProcedure.mutation(({ ctx }) => cancelSubscription(ctx.db, ctx.user.id)),
  mock: protectedProcedure
    .input(z.object({ action: z.enum(["checkout", "payment_failed", "payment_succeeded", "cancel", "resume", "delete"]) }))
    .mutation(({ ctx, input }) => mockSignal(ctx.db, ctx.user.id, input.action)),
});

export const systemRouter = router({
  config: publicProcedure.query(() => ({
    llmProvider: env().LLM_PROVIDER,
    billingMode: env().BILLING_MODE,
    sandbox: env().SANDBOX_PROVIDER,
    oauthProviders: enabledProviders(),
    devLogin: env().DEV_LOGIN_ENABLED,
  })),
});
