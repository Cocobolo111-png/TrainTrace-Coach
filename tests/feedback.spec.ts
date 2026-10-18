import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { makeExercise, catalog } from "../src/coach";
import { emptyState, type State, type Session } from "../src/model";
function data(history = true): State {
  const now = Date.now() - 3600000;
  function session(id: string, start: number, reps: number[]): Session {
    const e = makeExercise(catalog[0], [], reps.length);
    e.sets.forEach((t, i) => {
      t.weight = 60;
      t.reps = reps[i];
      t.actual = {
        weight: 60,
        reps: reps[i],
        completedAt: new Date(start + (i + 1) * 60000).toISOString(),
      };
    });
    return {
      id,
      theme: "胸部",
      startedAt: new Date(start).toISOString(),
      endedAt: new Date(start + 1800000).toISOString(),
      status: "finished",
      restUntil: null,
      recovery: false,
      note: "V1.3 自动化验收用合成数据",
      source: "app",
      exercises: [e],
    };
  }
  return {
    ...emptyState(),
    revision: 8,
    profile: {
      goal: "增肌",
      experience: "有一定经验",
      frequency: 3,
      equipment: ["杠铃"],
      preference: "均衡",
      limits: "",
    },
    sessions: [
      ...(history ? [session("previous", now - 2 * 86400000, [8, 8, 8])] : []),
      session("current", now, [8, 10, 8]),
    ],
  };
}
async function install(page: Page, state: State, showSummary = true) {
  await page.goto("/");
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
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
          tx.onabort = () => reject(tx.error);
        };
        r.onerror = () => reject(r.error);
      }),
    state,
  );
  await page.reload();
  if (showSummary) await openLatest(page);
}
async function openLatest(page: Page) {
  await page.getByRole("button", { name: "记录", exact: true }).click();
  await page.locator(".history-row").first().click();
  await expect(page.getByRole("heading", { name: "训练已保存" })).toBeVisible();
}
async function facts(page: Page) {
  return page.evaluate(
    () =>
      new Promise<unknown>((resolve) => {
        const r = indexedDB.open("traintrace-v1", 1);
        r.onsuccess = () => {
          const q = r.result
            .transaction("state")
            .objectStore("state")
            .get("main");
          q.onsuccess = () => {
            resolve(q.result);
            r.result.close();
          };
        };
      }),
  );
}
test("first workout uses an immediate local baseline without calling AI", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/training-analysis", (route) => {
    requests++;
    return route.fulfill({ status: 503, body: "{}" });
  });
  await install(page, data(false));
  await expect(page.locator(".training-feedback h2")).toContainText(
    "建立训练基线",
  );
  await expect(page.locator(".feedback-evidence")).toContainText("26 次");
  await expect(
    page.getByRole("button", { name: "查看详细 AI 分析", exact: true }),
  ).toBeVisible();
  expect(requests).toBe(0);
  await page
    .getByRole("button", { name: "查看详细 AI 分析", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("暂未开通");
  expect(requests).toBe(1);
  await expect(page.locator(".training-feedback h2")).toContainText(
    "建立训练基线",
  );
});
test("AI is requested on click, reuses valid cache across reload, and never changes history", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/training-analysis", async (route) => {
    requests++;
    const body = route.request().postDataJSON();
    expect(body.current.id).toBe("current");
    expect(body.history).toHaveLength(1);
    expect(body.profile.goal).toBe("增肌");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        summary: "自动化测试模拟模型响应：次数增加。",
        progress: "杠铃卧推同重量多完成2次。",
        insight: "本次卧推总次数增加。",
        nextAction: "先稳定重复当前表现。",
        meta: {
          provider: "deepseek",
          requestedModel: "deepseek-flash",
          model: "deepseek-flash",
          status: 200,
          elapsedMs: 1200,
          generatedAt: new Date().toISOString(),
          usage: { total_tokens: 130 },
        },
      }),
    });
  });
  await install(page, data());
  const before = await facts(page);
  await expect(page.locator(".feedback-evidence")).toContainText("多完成 2 次");
  expect(requests).toBe(0);
  await page
    .getByRole("button", { name: "查看详细 AI 分析", exact: true })
    .click();
  await expect(
    page.getByText("自动化测试模拟模型响应：次数增加。", { exact: true }),
  ).toBeVisible();
  expect(requests).toBe(1);
  await page.getByRole("button", { name: "收起详细 AI 分析" }).click();
  await page
    .getByRole("button", { name: "查看详细 AI 分析", exact: true })
    .click();
  expect(requests).toBe(1);
  expect(await facts(page)).toEqual(before);
  await page.reload();
  await openLatest(page);
  await page
    .getByRole("button", { name: "查看详细 AI 分析", exact: true })
    .click();
  await expect(
    page.getByText("自动化测试模拟模型响应：次数增加。", { exact: true }),
  ).toBeVisible();
  expect(requests).toBe(1);
  expect(await facts(page)).toEqual(before);
});
test("analysis errors allow explicit retry; no repeated requests or fake success", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/training-analysis", (route) => {
    requests++;
    return route.fulfill({
      status: requests === 1 ? 502 : 200,
      contentType: "application/json",
      body:
        requests === 1
          ? "{}"
          : JSON.stringify({
              summary: "测试",
              progress: "测试",
              insight: "测试",
              nextAction: "测试",
              meta: {
                provider: "deepseek",
                requestedModel: "deepseek-flash",
                model: "deepseek-flash",
                status: 200,
                elapsedMs: 1200,
                generatedAt: new Date().toISOString(),
              },
            }),
    });
  });
  await install(page, data());
  await page
    .getByRole("button", { name: "查看详细 AI 分析", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("未能完成");
  expect(requests).toBe(1);
  await page.getByRole("button", { name: "重试详细 AI 分析" }).click();
  await expect(page.locator(".feedback-analysis h3")).toHaveCount(3);
  expect(requests).toBe(2);
});
test("feedback leads the saved workout at mobile and desktop sizes", async ({
  page,
}) => {
  await install(page, data());
  await mkdir(".impeccable/review/v13", { recursive: true });
  for (const [name, width, height] of [
    ["mobile", 390, 844],
    ["desktop", 1440, 1000],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    const box = await page.locator(".training-feedback").boundingBox(),
      records = await page.locator(".actual-records").boundingBox();
    expect(box!.y).toBeLessThan(records!.y);
    expect(box!.y).toBeLessThan(260);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (name === "mobile")
      await page
        .locator(".training-feedback")
        .screenshot({ path: ".impeccable/review/v13/mobile-feedback.png" });
    await page.screenshot({
      path: `.impeccable/review/v13/${name}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

function activeData(): State {
  const state = data(false),
    s = state.sessions[0];
  s.status = "active";
  s.endedAt = null;
  s.startedAt = new Date(Date.now() - 30000).toISOString();
  s.exercises[0].sets.forEach((t) => {
    t.actual = null;
    t.weight = 60;
    t.reps = 8;
  });
  return state;
}
const saved = (page: Page) =>
  expect(page.getByRole("status").filter({ hasText: "正在保存" })).toHaveCount(
    0,
  );
test("workout clock persists pause and resume across navigation, reload and suspended callbacks", async ({
  page,
}) => {
  const clockStart = Date.now();
  await page.clock.install({ time: clockStart });
  const state = activeData();
  state.sessions[0].startedAt = new Date(clockStart - 30000).toISOString();
  await install(page, state, false);
  await page
    .getByRole("button", { name: "继续未完成训练", exact: true })
    .click();
  const timer = page.getByRole("timer", { name: "训练用时" });
  await expect(timer).toContainText("00:30");
  await page.getByRole("button", { name: "完成第 1 组", exact: true }).click();
  await saved(page);
  await page.clock.fastForward(60000);
  await expect(timer).toContainText("01:30");
  await page.getByRole("button", { name: "暂停计时", exact: true }).click();
  await saved(page);
  await page.clock.fastForward(120000);
  await expect(timer).toContainText("01:30");
  await expect(
    page.getByRole("button", { name: "恢复计时后可记组", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("休息结束，可以开始下一组", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "继续未完成训练", exact: true })
    .click();
  await expect(timer).toContainText("01:30");
  await expect(
    page.getByRole("button", { name: "恢复计时", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "恢复计时", exact: true }).click();
  await saved(page);
  const currentTime = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(currentTime + 65000);
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(timer).toContainText("02:35");
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.clock.fastForward(10000);
  await page
    .getByRole("button", { name: "继续未完成训练", exact: true })
    .click();
  await expect(timer).toContainText("02:45");
  await page.getByRole("button", { name: "暂停计时", exact: true }).click();
  await saved(page);
  await page.getByRole("button", { name: "结束训练", exact: true }).click();
  await page
    .getByRole("button", { name: "结束并查看总结", exact: true })
    .click();
  await saved(page);
  await expect(page.getByRole("heading", { name: "训练已保存" })).toBeVisible();
  const result = (await facts(page)) as State;
  expect(result.sessions[0].timing?.pausedAt).toBeNull();
  expect(result.sessions[0].status).toBe("finished");
  expect(
    result.sessions[0].exercises[0].sets.filter((t) => t.actual),
  ).toHaveLength(1);
});
for (const width of [320, 390, 412])
  test(`phone ${width}px decimal entry, shortened keyboard viewport and persistent saving`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await install(page, activeData(), false);
    await page
      .getByRole("button", { name: "继续未完成训练", exact: true })
      .click();
    const weight = page.getByLabel("本组重量", { exact: true }),
      reps = page.getByLabel("本组次数", { exact: true });
    await expect(weight).toHaveAttribute("inputmode", "decimal");
    await expect(reps).toHaveAttribute("inputmode", "numeric");
    await weight.fill("62.5");
    await reps.fill("12");
    await reps.focus();
    await page.setViewportSize({ width, height: 420 });
    const button = page.getByRole("button", {
      name: "完成第 1 组",
      exact: true,
    });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport();
    await button.click();
    await saved(page);
    const before = (await facts(page)) as State;
    expect(before.sessions[0].exercises[0].sets[0].actual).toMatchObject({
      weight: 62.5,
      reps: 12,
    });
    expect(
      before.sessions[0].exercises[0].sets.filter((t) => t.actual),
    ).toHaveLength(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width, height: 844 });
    await page.reload();
    await page
      .getByRole("button", { name: "继续未完成训练", exact: true })
      .click();
    expect(((await facts(page)) as State).sessions[0].exercises).toEqual(
      before.sessions[0].exercises,
    );
  });
test("DeepSeek loading blocks duplicate clicks, remains readable in system dark mode and handles malformed output", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  let requests = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/training-analysis", async (route) => {
    requests++;
    if (requests === 1) {
      await gate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
    } else
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          summary: "自动化合成响应：基于记录观察。",
          progress: "同重量总次数增加2次。",
          insight: "本次保持了相同组数。",
          nextAction: "暂不加重，稳定重复。",
          meta: {
            provider: "deepseek",
            requestedModel: "deepseek-flash",
            model: "deepseek-flash",
            status: 200,
            elapsedMs: 1600,
            generatedAt: new Date().toISOString(),
            usage: { total_tokens: 150 },
          },
        }),
      });
  });
  await install(page, data());
  const before = await facts(page);
  await page
    .getByRole("button", { name: "查看详细 AI 分析", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "正在生成详细分析…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("status").filter({ hasText: "正在解释" }),
  ).toBeVisible();
  await expect.poll(() => requests).toBe(1);
  release!();
  await expect(page.getByRole("alert")).toContainText("不完整");
  await page
    .getByRole("button", { name: "重试详细 AI 分析", exact: true })
    .click();
  await expect(page.locator(".feedback-analysis h3")).toHaveCount(3);
  await expect(page.locator(".feedback-analysis")).not.toContainText(
    "deepseek-flash",
  );
  await expect(page.locator(".feedback-analysis")).not.toContainText("Tokens");
  await page.locator(".feedback-analysis").scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await facts(page)).toEqual(before);
  await page.setViewportSize({ width: 390, height: 844 });
  await mkdir(".impeccable/review/v13", { recursive: true });
  await page.screenshot({
    path: ".impeccable/review/v13/deepseek-mobile-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: ".impeccable/review/v13/deepseek-desktop.png",
    fullPage: true,
  });
});

test("baseline analysis is two concise sections when there is nothing useful to flag", async ({
  page,
}) => {
  await page.route("**/api/training-analysis", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        summary: "已记下杠铃卧推的3组26次，作为下次训练的起点。",
        progress: "",
        insight: "",
        nextAction: "下次先重复本次重量与组次。",
        meta: {
          provider: "deepseek",
          requestedModel: "deepseek-flash",
          model: "deepseek-flash",
          status: 200,
          elapsedMs: 1200,
          generatedAt: new Date().toISOString(),
          usage: { total_tokens: 150 },
        },
      }),
    }),
  );
  await install(page, data(false));
  const before = await facts(page);
  await page
    .getByRole("button", { name: "查看详细 AI 分析", exact: true })
    .click();
  await expect(page.locator(".feedback-analysis h3")).toHaveText([
    "今天做对了什么？",
    "下次怎么练？",
  ]);
  await expect(page.locator(".feedback-analysis")).not.toContainText(
    /RPE|动作质量|数据不足|Tokens|deepseek/i,
  );
  expect(await facts(page)).toEqual(before);
});
