import { jwtVerify, SignJWT } from "jose";
import { env } from "../config/env";

export type Role = "LEARNER" | "INSTRUCTOR" | "ADMIN";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

const secret = () => new TextEncoder().encode(env().JWT_SECRET);
const ISSUER = "learnforge";

export async function signAccessToken(user: AuthUser, ttlSec = env().ACCESS_TOKEN_TTL_SEC): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience("api")
    .setIssuedAt()
    .setExpirationTime(`${ttlSec}s`)
    .sign(secret());
}

export async function verifyAccessToken(token: string, audience = "api"): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER, audience });
    if (!payload.sub) return null;
    return { id: payload.sub, email: String(payload.email), name: String(payload.name), role: payload.role as Role };
  } catch {
    return null;
  }
}

/** Short-lived token for authenticating the Socket.IO handshake (works across origins). */
export async function signSocketToken(user: AuthUser): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience("socket")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret());
}

export const verifySocketToken = (token: string) => verifyAccessToken(token, "socket");

const RANK: Record<Role, number> = { LEARNER: 0, INSTRUCTOR: 1, ADMIN: 2 };
export const hasRole = (user: Pick<AuthUser, "role">, min: Role) => RANK[user.role] >= RANK[min];
