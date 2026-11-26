/* eslint-disable no-console */
// Reproducible README screenshots against a running stack (docker compose up -d --wait).
// Usage: node scripts/screenshots.mjs [WEB_URL]   -> docs/screenshots/*.png (1440x900)
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const WEB = process.argv[2] ?? process.env.WEB_URL ?? "http://localhost:21000";
const OUT = new URL("../docs/screenshots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const HIDE_TOASTS = "[data-sonner-toaster], nextjs-portal { display: none !important; }";

async function session(browser, email, colorScheme = "light") {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme });
  const page = await context.newPage();
  await page.goto(`${WEB}/login`);
  await page.getByRole("button", { name: email }).click();
  await page.waitForURL(/\/dashboard/);
  return { context, page };
}

async function settle(page) {
  await page.addStyleTag({ content: HIDE_TOASTS });
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => !document.querySelector('[role="status"] .animate-pulse, [aria-busy="true"], .animate-pulse'), null, { timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
}

async function shot(page, name) {
  await settle(page);
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log(`  ✔ ${name}.png`);
}

const openCourse = async (page, title) => {
  await page.goto(`${WEB}/courses`);
  await page.getByRole("link", { name: new RegExp(title) }).first().click();
  await page.waitForURL(/\/courses\/[a-z0-9]+$/);
};
const openLesson = async (page, title) => {
  await page.getByRole("link", { name: new RegExp(title) }).first().click();
  await page.waitForURL(/\/lessons\//);
};

const browser = await chromium.launch();
try {
  const { page: alex } = await session(browser, "Learner (Alex)");

  // 1. Course page: syllabus, adaptive recommendation and BKT concept mastery.
  await openCourse(alex, "JavaScript Fundamentals");
  await shot(alex, "course");

  // 2. Lesson with KaTeX math + Socratic tutor conversation (streamed).
  await openCourse(alex, "Linear Algebra Essentials");
  await openLesson(alex, "Matrices and Transformations");
  await alex.getByRole("button", { name: /start tutoring session/i }).click();
  await alex.getByLabel("Message the tutor").fill("Can you just tell me what matrix multiplication computes?");
  await alex.getByRole("button", { name: "Send message" }).click();
  await alex.getByTestId("msg-assistant").last().getByText(/fills the blank/).waitFor({ timeout: 30_000 });
  await alex.locator(".katex").first().waitFor();
  await shot(alex, "lesson-tutor");

  // 3. Adaptive quiz with graded feedback and mastery change.
  await alex.getByRole("button", { name: /take adaptive quiz/i }).click();
  await alex.waitForURL(/\/quizzes\//, { timeout: 60_000 });
  await alex.getByRole("button", { name: /submit answers/i }).waitFor();
  const groups = await alex.locator("fieldset").all();
  for (const [i, g] of groups.entries()) await g.locator("input[type=radio]").nth(i % 2).check();
  for (const box of await alex.getByPlaceholder("Explain in your own words…").all()) await box.fill("Each entry is the dot product of a row of the first matrix with a column of the second matrix.");
  await alex.getByRole("button", { name: /submit answers/i }).click();
  await alex.getByTestId("quiz-score").waitFor({ timeout: 30_000 });
  await alex.evaluate(() => window.scrollTo(0, 0));
  await shot(alex, "quiz-feedback");

  // 4. FSRS flashcard review with the answer revealed and interval previews.
  await alex.goto(`${WEB}/review`);
  await alex.getByRole("button", { name: /show answer/i }).click();
  await alex.getByTestId("card-back").waitFor();
  await shot(alex, "flashcard-review");

  // 5. Coding exercise: failing attempt -> sandboxed test results + AI hint.
  await openCourse(alex, "JavaScript Fundamentals");
  await alex.getByRole("link", { name: "Factorial", exact: true }).first().click();
  await alex.waitForURL(/\/exercises\//);
  await alex.getByLabel("Solution code").fill("function factorial(n) {\n  let result = 1;\n  for (let i = 1; i < n; i++) result *= i;\n  return result;\n}\n");
  await alex.getByRole("button", { name: /run tests/i }).click();
  await alex.getByText("Hint", { exact: true }).waitFor({ timeout: 30_000 });
  await shot(alex, "coding-exercise");

  // 6. Instructor analytics.
  const { page: maya } = await session(browser, "Instructor (Dr. Maya)");
  await maya.goto(`${WEB}/instructor`);
  await maya.getByRole("row", { name: /JavaScript Fundamentals/ }).getByRole("link", { name: "Manage" }).click();
  await maya.getByText("Lesson completion").waitFor();
  await shot(maya, "instructor-analytics");

  // 7. Dark mode: learner dashboard.
  const { page: dark } = await session(browser, "Learner (Alex)", "dark");
  await dark.getByRole("heading", { name: /Welcome back/ }).waitFor();
  await shot(dark, "dashboard-dark");
} finally {
  await browser.close();
}
