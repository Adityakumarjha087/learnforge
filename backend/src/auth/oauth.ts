import { env } from "../config/env";
import { AppError } from "../lib/errors";

export type OAuthProvider = "google" | "github";

export interface OAuthProfile {
  id: string;
  email: string;
  name: string;
  image?: string;
}

interface ProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  clientId: () => string;
  clientSecret: () => string;
  profile: (accessToken: string, f: typeof fetch) => Promise<OAuthProfile>;
}

const PROVIDERS: Record<OAuthProvider, ProviderConfig> = {
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    clientId: () => env().GOOGLE_CLIENT_ID,
    clientSecret: () => env().GOOGLE_CLIENT_SECRET,
    profile: async (token, f) => {
      const r = await f("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${token}` } });
      const p = (await r.json()) as { sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
      if (!p.email || p.email_verified === false) throw new AppError("UNAUTHORIZED", "Google account has no verified email");
      return { id: p.sub, email: p.email, name: p.name ?? p.email, image: p.picture };
    },
  },
  github: {
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
    clientId: () => env().GITHUB_CLIENT_ID,
    clientSecret: () => env().GITHUB_CLIENT_SECRET,
    profile: async (token, f) => {
      const headers = { authorization: `Bearer ${token}`, "user-agent": "learnforge", accept: "application/vnd.github+json" };
      const u = (await (await f("https://api.github.com/user", { headers })).json()) as { id: number; login: string; name?: string; avatar_url?: string };
      const emails = (await (await f("https://api.github.com/user/emails", { headers })).json()) as { email: string; primary: boolean; verified: boolean }[];
      const email = emails.find((e) => e.primary && e.verified)?.email ?? emails.find((e) => e.verified)?.email;
      if (!email) throw new AppError("UNAUTHORIZED", "GitHub account has no verified email");
      return { id: String(u.id), email, name: u.name ?? u.login, image: u.avatar_url };
    },
  },
};

export const enabledProviders = (): OAuthProvider[] =>
  (Object.keys(PROVIDERS) as OAuthProvider[]).filter((p) => PROVIDERS[p].clientId() && PROVIDERS[p].clientSecret());

const redirectUri = (p: OAuthProvider) => `${env().APP_URL}/api/auth/oauth/${p}/callback`;

export function authorizeUrl(provider: OAuthProvider, state: string): string {
  const cfg = PROVIDERS[provider];
  if (!enabledProviders().includes(provider)) throw new AppError("NOT_FOUND", `${provider} sign-in is not configured`);
  const params = new URLSearchParams({ client_id: cfg.clientId(), redirect_uri: redirectUri(provider), response_type: "code", scope: cfg.scope, state });
  return `${cfg.authorizeUrl}?${params}`;
}

export async function exchangeCode(provider: OAuthProvider, code: string, f: typeof fetch = fetch): Promise<OAuthProfile> {
  const cfg = PROVIDERS[provider];
  const res = await f(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      client_id: cfg.clientId(),
      client_secret: cfg.clientSecret(),
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(provider),
    }),
  });
  const body = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !body.access_token) throw new AppError("UNAUTHORIZED", `OAuth exchange failed: ${body.error ?? res.status}`);
  return cfg.profile(body.access_token, f);
}
