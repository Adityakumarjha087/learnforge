import { afterEach, describe, expect, it, vi } from "vitest";
import { authFetch } from "../trpc";
import { difficultyName, errorMessage, masteryTone, pct, relativeDays } from "../utils";

describe("utils", () => {
  it("formats values", () => {
    expect(pct(0.456)).toBe("46%");
    expect(pct(null)).toBe("—");
    expect(relativeDays(0)).toBe("<10m");
    expect(relativeDays(12)).toBe("12d");
    expect(relativeDays(90)).toBe("3mo");
    expect(relativeDays(730)).toBe("2.0y");
    expect(difficultyName(4)).toBe("Hard");
    expect(difficultyName(9)).toBe("Medium");
    expect([null, 0.2, 0.6, 0.9].map(masteryTone)).toEqual(["muted", "danger", "warning", "success"]);
    expect(errorMessage(new Error("x"))).toBe("x");
    expect(errorMessage(42)).toBe("Something went wrong");
  });
});

describe("authFetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refreshes the session once on 401 and retries", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url === "/api/auth/refresh") return new Response("{}", { status: 200 });
        return new Response("{}", { status: calls.filter((c) => c === "/api/x").length === 1 ? 401 : 200 });
      }),
    );
    const res = await authFetch("/api/x");
    expect(res.status).toBe(200);
    expect(calls).toEqual(["/api/x", "/api/auth/refresh", "/api/x"]);
  });

  it("returns the 401 when refresh fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response("{}", { status: url === "/api/auth/refresh" ? 401 : 401 })));
    expect((await authFetch("/api/y")).status).toBe(401);
  });
});
