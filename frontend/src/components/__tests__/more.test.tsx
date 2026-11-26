import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "next-themes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authApi } from "@/lib/auth";
import { connectBattle, wsUrl } from "@/lib/battle";
import { PageHeader } from "../page-header";
import { celebrate } from "../reward-toast";
import { ThemeToggle } from "../theme-toggle";
import { TutorChat } from "../tutor-chat";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input, Label, Select, Textarea } from "../ui/input";
import { Progress } from "../ui/progress";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("../mermaid", () => ({ Mermaid: () => null }));
vi.mock("socket.io-client", () => ({ io: vi.fn((url: string, opts: unknown) => ({ url, opts })) }));

afterEach(() => vi.unstubAllGlobals());

describe("TutorChat", () => {
  it("renders history and streams a reply from the text transport", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body.sessionId).toBe("s1");
        const stream = new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("Think about the **base case**"));
            c.close();
          },
        });
        return new Response(stream, { status: 200, headers: { "content-type": "text/plain" } });
      }),
    );
    render(<TutorChat sessionId="s1" history={[{ id: "m1", role: "assistant", content: "Earlier hint" }]} />);
    expect(screen.getByText("Earlier hint")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Message the tutor"), "Why recursion?{enter}");
    await waitFor(() => expect(screen.getAllByTestId("msg-assistant").at(-1)).toHaveTextContent("Think about the base case"));
    expect(screen.getByTestId("msg-user")).toHaveTextContent("Why recursion?");
  });

  it("offers starter prompts when empty", () => {
    render(<TutorChat sessionId="s2" history={[]} compact />);
    expect(screen.getByText(/Socratic tutor/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });
});

describe("authApi", () => {
  it("posts JSON and surfaces API error messages", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === "/api/auth/login" ? Response.json({ error: { message: "Invalid email or password" } }, { status: 401 }) : Response.json({ user: { id: "1" }, sent: true, oauth: ["github"], devLogin: true, messages: [{ id: "m" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(authApi.login("a@b.c", "x")).rejects.toThrow("Invalid email or password");
    expect((await authApi.register({ email: "a@b.c", password: "12345678", name: "A" })).user.id).toBe("1");
    expect((await authApi.magicLink("a@b.c")).sent).toBe(true);
    await authApi.verifyMagic("tok");
    await authApi.devLogin("a@b.c");
    await authApi.logout();
    expect((await authApi.providers()).oauth).toEqual(["github"]);
    expect(await authApi.mailbox("a@b.c")).toHaveLength(1);
    expect((await authApi.session())?.id).toBe("1");
  });

  it("session falls back to refresh when the access cookie expired", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url === "/api/auth/refresh" ? Response.json({ user: { id: "r" } }) : Response.json({ user: null }))),
    );
    expect((await authApi.session())?.id).toBe("r");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    expect(await authApi.session()).toBeNull();
    expect(await authApi.mailbox("x")).toEqual([]);
  });
});

describe("small components", () => {
  it("celebrates XP and badges with toasts", () => {
    celebrate({ xp: 30, newBadges: ["coder", "unknown"], streak: 3 });
    expect(toast.success).toHaveBeenCalledWith("+30 XP", expect.objectContaining({ description: expect.stringContaining("3-day") }));
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("Hello, World"));
    celebrate(null);
  });

  it("renders layout primitives accessibly", () => {
    render(
      <ThemeProvider attribute="class">
        <PageHeader title="Title" description="Desc" actions={<button>Act</button>} />
        <ThemeToggle />
        <Card><CardHeader><CardTitle>T</CardTitle><CardDescription>D</CardDescription></CardHeader><CardContent>C</CardContent></Card>
        <Badge tone="success">ok</Badge>
        <Progress value={150} label="p" />
        <Label htmlFor="i">L</Label>
        <Input id="i" />
        <Textarea aria-label="t" />
        <Select aria-label="s"><option>a</option></Select>
      </ThemeProvider>,
    );
    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "p" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /switch to/i })).toBeInTheDocument();
    expect(screen.getByLabelText("L")).toBeInTheDocument();
  });

  it("battle client connects to the websocket URL with a token", () => {
    expect(wsUrl()).toContain(":21001");
    const s = connectBattle("tok") as unknown as { opts: { auth: { token: string } } };
    expect(s.opts.auth.token).toBe("tok");
  });
});
