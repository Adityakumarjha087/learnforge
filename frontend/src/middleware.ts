import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/dashboard", "/courses", "/lessons", "/quizzes", "/review", "/exercises", "/tutor", "/leaderboard", "/battle", "/instructor", "/billing", "/profile"];

/** Cheap edge guard: bounce visitors without any session cookie to the login page (real auth happens in the API). */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (!PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (req.cookies.has("lf_access") || req.cookies.has("lf_refresh")) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!api|_next|healthz|favicon.ico).*)"] };
