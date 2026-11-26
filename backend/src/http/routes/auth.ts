import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authorizeUrl, enabledProviders, exchangeCode, type OAuthProvider } from "../../auth/oauth";
import { AuthService, normalizeEmail } from "../../auth/service";
import { env } from "../../config/env";
import { randomToken, safeEqual } from "../../lib/crypto";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { REFRESH_COOKIE, userFromRequest } from "../../trpc/trpc";
import { clearSessionCookies, sessionBody, setSessionCookies } from "../cookies";

const RegisterSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(100),
  role: z.enum(["LEARNER", "INSTRUCTOR"]).optional(),
});
const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });
const EmailSchema = z.object({ email: z.string().email().max(200) });
const TokenSchema = z.object({ token: z.string().min(10).max(200) });

export async function authRoutes(app: FastifyInstance) {
  const auth = new AuthService(prisma);
  const strict = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };

  app.post("/register", strict, async (req, reply) => {
    const session = await auth.register(RegisterSchema.parse(req.body));
    setSessionCookies(reply, session);
    return sessionBody(session);
  });

  app.post("/login", strict, async (req, reply) => {
    const { email, password } = LoginSchema.parse(req.body);
    const session = await auth.login(email, password);
    setSessionCookies(reply, session);
    return sessionBody(session);
  });

  app.post("/magic-link", strict, async (req) => {
    const { email } = EmailSchema.parse(req.body);
    await auth.requestMagicLink(email);
    return { sent: true, devMailbox: env().DEV_LOGIN_ENABLED };
  });

  app.post("/magic-link/verify", strict, async (req, reply) => {
    const { token } = TokenSchema.parse(req.body);
    const session = await auth.verifyMagicLink(token);
    setSessionCookies(reply, session);
    return sessionBody(session);
  });

  app.post("/refresh", async (req, reply) => {
    const bodyToken = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
    const token = bodyToken ?? req.cookies[REFRESH_COOKIE];
    if (!token) throw new AppError("UNAUTHORIZED", "No refresh token");
    try {
      const session = await auth.refresh(token);
      setSessionCookies(reply, session);
      return { ...sessionBody(session), refreshToken: bodyToken ? session.refreshToken : undefined };
    } catch (err) {
      clearSessionCookies(reply);
      throw err;
    }
  });

  app.post("/logout", async (req, reply) => {
    await auth.logout(req.cookies[REFRESH_COOKIE]);
    clearSessionCookies(reply);
    return { ok: true };
  });

  app.get("/session", async (req) => {
    const user = await userFromRequest(req);
    return { user };
  });

  app.get("/providers", async () => ({ oauth: enabledProviders(), magicLink: true, credentials: true, devLogin: env().DEV_LOGIN_ENABLED }));

  // --- Development conveniences (disabled with DEV_LOGIN_ENABLED=false) ---
  app.post("/dev/login", strict, async (req, reply) => {
    if (!env().DEV_LOGIN_ENABLED) throw new AppError("NOT_FOUND", "Not found");
    const { email } = EmailSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
    if (!user) throw new AppError("NOT_FOUND", "No demo user with that email");
    const { link } = await auth.requestMagicLink(user.email);
    const token = new URL(link).searchParams.get("token")!;
    const session = await auth.verifyMagicLink(token);
    setSessionCookies(reply, session);
    return sessionBody(session);
  });

  app.get("/dev/mailbox", async (req) => {
    if (!env().DEV_LOGIN_ENABLED) throw new AppError("NOT_FOUND", "Not found");
    const { email } = EmailSchema.parse(req.query);
    const messages = await prisma.devMail.findMany({ where: { to: normalizeEmail(email) }, orderBy: { createdAt: "desc" }, take: 5 });
    return { messages };
  });

  // --- OAuth (Google / GitHub) - enabled when client credentials are configured ---
  app.get<{ Params: { provider: string } }>("/oauth/:provider", async (req, reply) => {
    const provider = z.enum(["google", "github"]).parse(req.params.provider) as OAuthProvider;
    const state = randomToken(16);
    reply.setCookie("lf_oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600, secure: env().COOKIE_SECURE });
    return reply.redirect(authorizeUrl(provider, state));
  });

  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string } }>("/oauth/:provider/callback", async (req, reply) => {
    const provider = z.enum(["google", "github"]).parse(req.params.provider) as OAuthProvider;
    const expected = req.cookies.lf_oauth_state;
    if (!req.query.code || !req.query.state || !expected || !safeEqual(req.query.state, expected)) {
      return reply.redirect(`${env().APP_URL}/login?error=oauth_state`);
    }
    const profile = await exchangeCode(provider, req.query.code);
    const session = await auth.oauthLogin(provider, profile);
    reply.clearCookie("lf_oauth_state", { path: "/" });
    setSessionCookies(reply, session);
    return reply.redirect(`${env().APP_URL}/dashboard`);
  });
}
