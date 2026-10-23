import { test, expect, type Page } from "@playwright/test";
import { emptyState } from "../src/model";
import { syntheticWorkout, syntheticProfile } from "./fixtures";
async function install(page: Page) {
  await page.goto("/");
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve) => {
        localStorage.setItem(
          "traintrace-guidance",
          JSON.stringify({ introStep: 3, workoutHintSeen: true }),
        );
        const r = indexedDB.open("traintrace-v1", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("state");
        r.onsuccess = () => {
          const tx = r.result.transaction("state", "readwrite");
          tx.objectStore("state").put(value, "main");
          tx.oncomplete = () => {
            r.result.close();
            resolve();
          };
        };
      }),
    {
      ...emptyState(),
      revision: 5,
      profile: syntheticProfile,
      sessions: [syntheticWorkout(18), syntheticWorkout(20, [8, 10, 8])],
    },
  );
  await page.reload();
}
async function connect(page: Page) {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.locator(".ai-settings > summary").click();
  await page
    .getByLabel("AI API Key", { exact: true })
    .fill("synthetic-browser-key-not-real");
  await page.getByRole("button", { name: "验证连接", exact: true }).click();
  await expect(page.locator(".ai-settings > summary")).toContainText("已连接");
}
async function latest(page: Page) {
  await page.getByRole("button", { name: "记录", exact: true }).click();
  await page.locator(".history-row").first().click();
}
test("HTTPS BYOK: opt-in, memory only, dimensions, failures, disconnect and refresh", async ({
  page,
}) => {
  const calls: any[] = [];
  await page.route("**/api/ai/connect", async (route) => {
    calls.push({ type: "connect", body: route.request().postDataJSON() });
    await route.fulfill({
      json: {
        provider: "deepseek",
        model: route.request().postDataJSON().model,
      },
    });
  });
  await page.route("**/api/training-analysis", async (route) => {
    const body = route.request().postDataJSON();
    calls.push({ type: "analysis", body });
    if (body.ai.dimensions.includes("volume"))
      return route.fulfill({
        status: 503,
        json: { code: "provider_unavailable" },
      });
    await route.fulfill({
      json: {
        summary: "这是模拟响应，用于浏览器交互验证。",
        progress: "",
        insight: "合成数据的对比解释。",
        nextAction: "保持记录。",
        meta: {
          provider: "deepseek",
          requestedModel: body.ai.model,
          model: body.ai.model,
          status: 200,
          elapsedMs: 5,
          generatedAt: new Date().toISOString(),
        },
      },
    });
  });
  await install(page);
  await latest(page);
  expect(calls).toEqual([]);
  await expect(
    page.getByRole("button", { name: "查看详细 AI 分析", exact: true }),
  ).toHaveCount(0);
  await connect(page);
  expect(calls).toHaveLength(1);
  await expect(page.locator(".ai-settings")).not.toHaveAttribute("open");
  await latest(page);
  await expect(
    page.getByRole("checkbox", { name: "进步分析", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "查看详细 AI 分析", exact: true })
    .click();
  await expect(
    page.getByText("这是模拟响应，用于浏览器交互验证。", { exact: true }),
  ).toBeVisible();
  expect(calls.filter((c) => c.type === "analysis")).toHaveLength(1);
  await page.getByRole("checkbox", { name: "训练量分析", exact: true }).check();
  await page
    .getByRole("button", { name: "查看详细 AI 分析", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator(".feedback-action")).toBeVisible();
  expect(calls.filter((c) => c.type === "analysis")).toHaveLength(2);
  const persisted = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const r = indexedDB.open("traintrace-v1", 1);
        r.onsuccess = () => {
          const q = r.result.transaction("state").objectStore("state").getAll();
          q.onsuccess = () =>
            resolve(
              JSON.stringify({
                db: q.result,
                local: { ...localStorage },
                session: { ...sessionStorage },
              }),
            );
        };
      }),
  );
  expect(persisted).not.toContain("synthetic-browser-key-not-real");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.locator(".ai-settings > summary").click();
  await page.getByRole("button", { name: "断开连接", exact: true }).click();
  await latest(page);
  await expect(
    page.getByRole("button", { name: "查看详细 AI 分析", exact: true }),
  ).toHaveCount(0);
  await connect(page);
  await page.reload();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.locator(".ai-settings > summary")).not.toContainText(
    "已连接",
  );
  expect(calls.filter((c) => c.type === "analysis")).toHaveLength(2);
});
test("HTTPS connection errors are clear and no model request occurs automatically", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/**", async (route) => {
    requests++;
    await route.fulfill({ status: 401, json: { code: "authentication" } });
  });
  await install(page);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  expect(requests).toBe(0);
  await page.locator(".ai-settings > summary").click();
  await page
    .getByLabel("AI API Key", { exact: true })
    .fill("synthetic-invalid-key");
  await page.getByRole("button", { name: "验证连接", exact: true }).click();
  await expect(
    page.getByText("API Key 验证失败，请检查后重试。", { exact: true }),
  ).toBeVisible();
  expect(requests).toBe(1);
});
