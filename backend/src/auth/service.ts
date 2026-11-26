import bcrypt from "bcryptjs";
import { env } from "../config/env";
import { AppError } from "../lib/errors";
import { randomToken, sha256 } from "../lib/crypto";
import type { Db } from "../lib/prisma";
import { signAccessToken, type AuthUser, type Role } from "./tokens";

export interface Session {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const toAuthUser = (u: { id: string; email: string; name: string; role: Role }): AuthUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
});

const DUMMY_HASH = bcrypt.hashSync("timing-equaliser", 10);

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export class AuthService {
  constructor(private readonly db: Db) {}

  async register(input: { email: string; password: string; name: string; role?: "LEARNER" | "INSTRUCTOR" }): Promise<Session> {
    const email = normalizeEmail(input.email);
    const existing = await this.db.user.findUnique({ where: { email } });
    if (existing) throw new AppError("CONFLICT", "An account with this email already exists");
    const user = await this.db.user.create({
      data: { email, name: input.name.trim(), passwordHash: await bcrypt.hash(input.password, 10), role: input.role ?? "LEARNER" },
    });
    return this.issue(toAuthUser(user));
  }

  async login(emailRaw: string, password: string): Promise<Session> {
    const user = await this.db.user.findUnique({ where: { email: normalizeEmail(emailRaw) } });
    // Compare against a dummy hash when the user is missing to keep timing uniform.
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.passwordHash || !ok) throw new AppError("UNAUTHORIZED", "Invalid email or password");
    return this.issue(toAuthUser(user));
  }

  /** Creates a single-use magic link (15 min). Without SMTP the message is written to the dev outbox. */
  async requestMagicLink(emailRaw: string): Promise<{ link: string }> {
    const email = normalizeEmail(emailRaw);
    const token = randomToken();
    await this.db.magicLinkToken.create({ data: { email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 15 * 60_000) } });
    const link = `${env().APP_URL}/auth/magic?token=${encodeURIComponent(token)}`;
    await this.db.devMail.create({
      data: { to: email, subject: "Your LearnForge sign-in link", body: `Click to sign in (valid for 15 minutes): ${link}`, link },
    });
    return { link };
  }

  async verifyMagicLink(token: string): Promise<Session> {
    const record = await this.db.magicLinkToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!record || record.usedAt || record.expiresAt < new Date()) throw new AppError("UNAUTHORIZED", "This sign-in link is invalid or has expired");
    await this.db.magicLinkToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    const user =
      (await this.db.user.findUnique({ where: { email: record.email } })) ??
      (await this.db.user.create({ data: { email: record.email, name: record.email.split("@")[0] ?? "Learner" } }));
    return this.issue(toAuthUser(user));
  }

  /** Upsert a user from a verified OAuth profile and link the provider account. */
  async oauthLogin(provider: string, profile: { id: string; email: string; name: string; image?: string }): Promise<Session> {
    const email = normalizeEmail(profile.email);
    const account = await this.db.account.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId: profile.id } },
      include: { user: true },
    });
    if (account) return this.issue(toAuthUser(account.user));
    const user =
      (await this.db.user.findUnique({ where: { email } })) ??
      (await this.db.user.create({ data: { email, name: profile.name || email, image: profile.image } }));
    await this.db.account.create({ data: { provider, providerAccountId: profile.id, userId: user.id } });
    return this.issue(toAuthUser(user));
  }

  /**
   * Rotating refresh tokens with reuse detection: presenting an already-rotated token revokes
   * the whole token family (likely theft).
   */
  async refresh(refreshToken: string): Promise<Session> {
    const record = await this.db.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) }, include: { user: true } });
    if (!record) throw new AppError("UNAUTHORIZED", "Invalid refresh token");
    if (record.revokedAt) {
      await this.db.refreshToken.updateMany({ where: { familyId: record.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new AppError("UNAUTHORIZED", "Refresh token reuse detected; please sign in again");
    }
    if (record.expiresAt < new Date()) throw new AppError("UNAUTHORIZED", "Refresh token expired");
    const session = await this.issue(toAuthUser(record.user), record.familyId);
    await this.db.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date(), replacedBy: sha256(session.refreshToken) },
    });
    return session;
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.db.refreshToken.updateMany({ where: { tokenHash: sha256(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async issue(user: AuthUser, familyId?: string): Promise<Session> {
    const refreshToken = randomToken(48);
    const refreshExpiresAt = new Date(Date.now() + env().REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    await this.db.refreshToken.create({
      data: { userId: user.id, tokenHash: sha256(refreshToken), familyId: familyId ?? randomToken(12), expiresAt: refreshExpiresAt },
    });
    return { user, accessToken: await signAccessToken(user), refreshToken, refreshExpiresAt };
  }
}
