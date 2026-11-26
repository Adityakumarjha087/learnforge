import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("learner journey: sign in, generate a course, study, quiz, review and ask the tutor", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Learner (Alex)" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: /Welcome back, Alex/ })).toBeVisible();

  // Generate a course from a topic.
  await page.getByRole("link", { name: "New course" }).first().click();
  const topic = `Graph Theory ${Date.now() % 100000}`;
  await page.getByLabel("Topic").fill(topic);
  await page.getByRole("button", { name: /generate course/i }).click();
  await expect(page).toHaveURL(/\/courses\/[a-z0-9]+$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Graph Theory");

  // Open the recommended lesson and complete it.
  await page.getByRole("link", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/lessons\//);
  await page.getByRole("button", { name: /mark complete/i }).click();
  await expect(page.getByText(/\+20 XP/)).toBeVisible();

  // Ask the Socratic tutor (streams via the AI SDK text transport).
  await page.getByRole("button", { name: /start tutoring session/i }).click();
  await page.getByLabel("Message the tutor").fill("Just tell me the answer please");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByTestId("msg-assistant").last()).toContainText(/won't hand you the answer/i, { timeout: 30_000 });

  // Adaptive quiz: answer every question and submit.
  await page.getByRole("button", { name: /take adaptive quiz/i }).click();
  await expect(page).toHaveURL(/\/quizzes\//, { timeout: 60_000 });
  for (const group of await page.locator("fieldset").all()) await group.locator("input[type=radio]").first().check();
  for (const box of await page.getByPlaceholder("Explain in your own words…").all()) await box.fill("Graphs model relationships between vertices and edges.");
  await page.getByRole("button", { name: /submit answers/i }).click();
  await expect(page.getByTestId("quiz-score")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Next quiz will adapt to/)).toBeVisible();

  // Flashcard review with FSRS.
  await page.getByRole("link", { name: "Review", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Daily review" })).toBeVisible();
  await page.getByRole("button", { name: /show answer/i }).click();
  await expect(page.getByTestId("card-back")).toBeVisible();
  await page.getByRole("button", { name: /^Good/ }).click();
  await expect(page.getByText(/today/)).toBeVisible();
});

test("instructor sees analytics and the judge report; learners are kept out", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Instructor (Dr. Maya)" }).click();
  await page.getByRole("link", { name: "Instructor" }).click();
  await page.getByRole("row", { name: /JavaScript Fundamentals/ }).getByRole("link", { name: "Manage" }).click();
  await expect(page.getByText("Lesson completion")).toBeVisible();
  await page.getByRole("tab", { name: /Quizzes/ }).click();
  await expect(page.getByText(/LLM-as-judge/).first()).toBeVisible();
});

test("unauthenticated visitors are redirected to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
});
