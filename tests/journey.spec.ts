import { test, expect, type Page } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import {
  emptyState,
  completeSet,
  finishSession,
  type State,
  type Profile,
  type Session,
} from "../src/model";
import { makeExercise, catalog } from "../src/coach";
async function skipIntro(page: Page) {
  await page.getByRole("button", { name: "跳过新手引导", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "先了解一下你的训练习惯。" }),
  ).toBeVisible();
}
async function saved(page: Page) {
  await expect(
    page.getByRole("status").filter({ hasText: "正在保存" }),
  ).toHaveCount(0);
}
async function stateOf(page: Page) {
  return page.evaluate(
    () =>
      new Promise<any>((resolve, reject) => {
        const r = indexedDB.open("traintrace-v1", 1);
        r.onsuccess = () => {
          const q = r.result
            .transaction("state")
            .objectStore("state")
            .get("main");
          q.onsuccess = () => resolve(q.result);
          q.onerror = reject;
        };
      }),
  );
}
async function importFile(page: Page, content: string, name = "history.md") {
  await page.getByLabel("导入数据文件").setInputFiles({
    name,
    mimeType: name.endsWith(".json") ? "application/json" : "text/markdown",
    buffer: Buffer.from(content),
  });
  await page.getByRole("button", { name: "确认合并导入" }).click();
  await saved(page);
}
test("mobile gym journey: setup, history prefill, recovery, review, next workout, backup and offline", async ({
  page,
  context,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await skipIntro(page);
  await expect(
    page.getByRole("heading", { name: "先了解一下你的训练习惯。" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "准备好了，开始训练" }).click();
  await saved(page);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  // Synthetic historical facts are imported through the same reviewable UI users use.
  const markdown =
    "## 2026-10-01｜胸部\n### 实际完成\n- 杠铃卧推：60 kg × 8 / 8 / 7\n";
  await importFile(page, markdown);
  await page.getByRole("button", { name: "训练", exact: true }).click();
  // Choose the chest shortcut regardless of the dynamically recommended topic.
  if (await page.getByRole("button", { name: "胸部", exact: true }).count())
    await page.getByRole("button", { name: "胸部", exact: true }).click();
  else
    await page.getByRole("button", { name: "开始训练", exact: true }).click();
  // Long-gap recovery starts conservatively; user explicitly opts out for this test.
  const toggle = page.getByRole("checkbox", { name: "轻量恢复训练" });
  if (await toggle.isChecked()) await toggle.uncheck();
  await expect(page.getByLabel("杠铃卧推 第1组重量")).toHaveValue("60");
  await expect(page.getByLabel("杠铃卧推 第3组次数")).toHaveValue("7");
  await page.getByRole("button", { name: "开始记录" }).click();
  await saved(page);
  await expect(page.getByLabel("本组重量")).toHaveValue("60");
  // Regression: decimal loads and two-digit reps must fit without native input clipping.
  for (const width of [375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const sizes = await page
      .locator(".stepper input")
      .evaluateAll((xs) => xs.map((x) => x.getBoundingClientRect().width));
    expect(sizes.every((w) => w >= 85)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "完成第 1 组" }).click();
  await saved(page);
  const rest = page.getByRole("timer");
  await expect(rest).toBeVisible();
  const firstTimer = await rest.innerText();
  await page.waitForTimeout(1500);
  expect(await rest.innerText()).not.toBe(firstTimer);
  // Close the actual page, then reopen with the same browser storage.
  await page.close();
  page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "继续未完成训练" }).click();
  await expect(page.getByRole("button", { name: "完成第 2 组" })).toBeVisible();
  await expect(page.getByText("已完成", { exact: true })).toHaveCount(1);
  await page.getByLabel("本组次数").fill("10");
  await page.getByRole("button", { name: "完成第 2 组" }).click();
  await saved(page);
  await page.getByRole("button", { name: "跳过休息", exact: true }).click();
  await saved(page);
  await page.getByRole("button", { name: "完成第 3 组" }).click();
  await saved(page);
  await page.getByRole("button", { name: "刚刚好", exact: true }).click();
  await saved(page);
  await mkdir(".impeccable/review", { recursive: true });
  await page.screenshot({
    path: ".impeccable/review/mobile-workout.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "结束训练", exact: true }).click();
  await page.getByLabel("训练后感受").fill("测试记录：下次保持重量");
  await page
    .getByRole("button", { name: "结束并查看总结", exact: true })
    .click();
  await saved(page);
  await expect(page.getByRole("heading", { name: "训练已保存" })).toBeVisible();
  await expect(page.getByText(/相同组数与重量，多完成 2 次/)).toBeVisible();
  const data = await stateOf(page),
    actual = data.sessions.find((s: any) => s.source === "app");
  expect(actual.note).toBe("测试记录：下次保持重量");
  expect(actual.exercises[0].sets.map((s: any) => s.actual?.reps)).toEqual([
    8, 10, 7,
  ]);
  expect(
    actual.exercises
      .slice(1)
      .every((e: any) => e.sets.every((s: any) => s.actual === null)),
  ).toBe(true);
  await page.screenshot({
    path: ".impeccable/review/mobile-summary.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "查看训练历史" }).click();
  await expect(
    page.getByRole("img", { name: /杠铃卧推重量趋势/ }),
  ).toBeVisible();
  await page.screenshot({
    path: ".impeccable/review/mobile-history.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "训练", exact: true }).click();
  await page.screenshot({
    path: ".impeccable/review/mobile.png",
    fullPage: true,
  });
  if (await page.getByRole("button", { name: "胸部", exact: true }).count())
    await page.getByRole("button", { name: "胸部", exact: true }).click();
  else
    await page.getByRole("button", { name: "开始训练", exact: true }).click();
  await expect(page.getByLabel("杠铃卧推 第2组次数")).toHaveValue("10");
  await page.getByRole("button", { name: "开始记录" }).click();
  await saved(page);
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整备份" }).click();
  const file = await download,
    contents = await readFile((await file.path())!, "utf8");
  expect(JSON.parse(contents).sessions).toHaveLength(3);
  // Fresh browser: JSON import restores profile, facts, and active session.
  const fresh = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const restored = await fresh.newPage();
  await restored.goto("/");
  await skipIntro(restored);
  await restored.getByText("已经有训练数据？直接导入").click();
  await importFile(restored, contents, "backup.json");
  await expect(
    restored.getByRole("button", { name: "继续未完成训练" }),
  ).toBeVisible();
  await restored.getByRole("button", { name: "设置", exact: true }).click();
  await importFile(restored, contents, "backup.json");
  expect((await stateOf(restored)).sessions).toHaveLength(3);
  await restored.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await restored.reload();
  await restored.waitForFunction(() => !!navigator.serviceWorker.controller);
  await fresh.setOffline(true);
  expect(
    await restored.evaluate(() =>
      fetch("/network-only-proof-" + Date.now(), {
        method: "HEAD",
        cache: "no-store",
      })
        .then(() => false)
        .catch(() => true),
    ),
  ).toBe(true);
  await restored.reload();
  await expect(restored.getByText("离线可记录")).toBeVisible();
  await restored.getByRole("button", { name: "继续未完成训练" }).click();
  await restored.getByRole("button", { name: "完成第 1 组" }).click();
  await saved(restored);
  await restored.reload();
  await restored.getByRole("button", { name: "继续未完成训练" }).click();
  await expect(
    restored.getByRole("button", { name: "完成第 2 组" }),
  ).toBeVisible();
  expect(
    (await stateOf(restored)).sessions
      .find((s: any) => s.status === "active")
      .exercises[0].sets.filter((s: any) => s.actual).length,
  ).toBe(1);
  await fresh.close();
  // Responsive screenshots and no horizontal overflow at 320 / 390 / desktop.
  await page.getByRole("button", { name: "训练", exact: true }).click();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width === 1280)
      await page.screenshot({
        path: ".impeccable/review/desktop.png",
        fullPage: true,
      });
  }
  expect(errors).toEqual([]);
});
test("first record has no invented load, mobile controls can add/remove/skip and discard", async ({
  page,
}) => {
  // LAN HTTP does not expose the HTTPS-only randomUUID API.
  await page.addInitScript(() =>
    Object.defineProperty(crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/");
  await skipIntro(page);
  await page.getByRole("button", { name: "准备好了，开始训练" }).click();
  await saved(page);
  await page.getByRole("button", { name: "开始训练", exact: true }).click();
  await expect(page.getByLabel("杠铃卧推 第1组重量")).toHaveValue("");
  await page.getByLabel("杠铃卧推 第1组重量").fill("20");
  await page.getByRole("button", { name: "开始记录" }).click();
  await saved(page);
  await page.getByRole("button", { name: "新增一组" }).click();
  await saved(page);
  expect((await stateOf(page)).sessions[0].exercises[0].sets).toHaveLength(4);
  await page.getByRole("button", { name: "删除末尾待做组" }).click();
  await saved(page);
  await page.getByRole("button", { name: "完成第 1 组" }).click();
  await saved(page);
  await page.getByRole("button", { name: "结束训练", exact: true }).click();
  await page.getByText("放弃本节训练", { exact: true }).click();
  await page.getByRole("button", { name: "确认放弃本节" }).click();
  await saved(page);
  expect((await stateOf(page)).sessions[0].status).toBe("discarded");
  await expect(page.getByText("你的第一节训练，从这里开始。")).toBeVisible();
});

async function freshChestPlan(page: Page) {
  await page.goto("/");
  await skipIntro(page);
  await page.getByRole("button", { name: "准备好了，开始训练" }).click();
  await page.getByRole("button", { name: "开始训练", exact: true }).click();
}
async function twoSetWorkout(page: Page) {
  await freshChestPlan(page);
  await page.getByLabel("今天准备练多久？").selectOption("20");
  await page
    .locator(".plan-exercise")
    .nth(1)
    .getByRole("button", { name: "跳过", exact: true })
    .click();
  await page.getByLabel("杠铃卧推 第1组重量").fill("60");
  await page.getByLabel("杠铃卧推 第2组重量").fill("60");
  await page.getByRole("button", { name: "开始记录" }).click();
  await saved(page);
}
async function colors(page: Page, selectors: string[]) {
  for (const selector of selectors)
    await page.locator(selector).first().waitFor({ state: "attached" });
  return page.evaluate(
    (selectors) =>
      selectors.map((selector) => {
        const element = document.querySelector(selector)!;
        const style = getComputedStyle(element);
        return {
          selector,
          color: style.color,
          background: style.backgroundColor,
          border: style.borderColor,
          colorScheme: style.colorScheme,
        };
      }),
    selectors,
  );
}

test("light and dark preferences retain the same light app and form colors", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await skipIntro(page);
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute(
    "content",
    "light",
  );
  await page.getByText("动作偏好或限制（选填）", { exact: true }).click();
  const formSelectors = [
    "html",
    "body",
    "select",
    "textarea",
    ".choice-grid button.chosen",
  ];
  const formLight = await colors(page, formSelectors);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await colors(page, formSelectors)).toEqual(formLight);
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light only");
  await page.getByRole("button", { name: "准备好了，开始训练" }).click();
  const homeSelectors = [
    "body",
    ".shell",
    ".wordmark",
    ".greeting h1",
    ".training-hero",
    ".training-hero h2",
    ".training-hero .button",
    ".bottom-nav",
  ];
  const dark = await colors(page, homeSelectors);
  await mkdir(".impeccable/review/v11", { recursive: true });
  await page.screenshot({
    path: ".impeccable/review/v11/home-dark.png",
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "light" });
  expect(await colors(page, homeSelectors)).toEqual(dark);
  await page.screenshot({
    path: ".impeccable/review/v11/mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: ".impeccable/review/v11/desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "开始训练", exact: true }).click();
  const planLight = await colors(page, [
    "select",
    "input[type=checkbox]",
    ".plan-set input",
    ".action-dock .button",
  ]);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(
    await colors(page, [
      "select",
      "input[type=checkbox]",
      ".plan-set input",
      ".action-dock .button",
    ]),
  ).toEqual(planLight);
});

test("time budget, recovery mode, and explanations match the actual plan", async ({
  page,
}) => {
  await freshChestPlan(page);
  await expect(page.locator(".rule-note")).toContainText(
    "这是你的首次训练，完成后会根据实际表现调整下次计划。",
  );
  await expect(
    page.getByText("根据你的时间调整动作和组数。", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("今天准备练多久？").selectOption("20");
  await expect(page.locator(".plan-exercise")).toHaveCount(2);
  await expect(page.locator(".plan-set")).toHaveCount(4);
  await expect(page.locator(".action-dock")).toContainText("计划 2 个动作");
  await expect(page.locator(".action-dock")).not.toContainText("分钟");
  await page.getByLabel("今天准备练多久？").selectOption("60");
  await expect(page.locator(".plan-set")).toHaveCount(9);
  const recovery = page.getByRole("checkbox", { name: "轻量恢复训练" });
  await recovery.check();
  await expect(page.locator(".plan-set")).toHaveCount(6);
  await expect(page.locator(".rule-note")).toContainText(
    "本次会适当减少训练量，重量可在热身后重新选择。",
  );
  await expect(page.getByLabel("杠铃卧推 第1组重量")).toHaveValue("");
  await recovery.uncheck();
  await expect(page.locator(".plan-set")).toHaveCount(9);
  await expect(page.locator(".rule-note")).not.toContainText(
    "本次会适当减少训练量",
  );
  await page.screenshot({
    path: ".impeccable/review/v11/plan.png",
    fullPage: true,
  });
  // History exists, but none of today's movements has a comparable record.
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await importFile(
    page,
    "## 2026-10-01｜背部\n### 实际完成\n- 高位下拉：40 kg × 8 / 8\n",
  );
  await page.getByRole("button", { name: "训练", exact: true }).click();
  await page.getByRole("button", { name: "开始训练", exact: true }).click();
  await expect(page.locator(".rule-note")).not.toContainText(
    "这是你的首次训练",
  );
  await expect(page.locator(".rule-note")).toContainText(
    "这些动作还没有历史记录",
  );
});

test("timestamp rest, extension, skip, once-only vibration and final-set behavior", async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() => {
    (window as any).__vibrations = [];
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (pattern: number[]) => {
        (window as any).__vibrations.push(pattern);
        return true;
      },
    });
  });
  await twoSetWorkout(page);
  await page.getByRole("button", { name: "完成第 1 组" }).click();
  await saved(page);
  const first = (await stateOf(page)).sessions[0].restUntil;
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page.locator(".rest-dock strong")).toHaveCSS(
    "font-size",
    "56px",
  );
  await page.getByRole("button", { name: "+30 秒", exact: true }).click();
  await saved(page);
  expect((await stateOf(page)).sessions[0].restUntil).toBe(first + 30000);
  await page.clock.fastForward(60000);
  const progress = await page
    .getByRole("progressbar", { name: "休息剩余进度" })
    .getAttribute("value");
  expect(+progress!).toBeGreaterThan(50);
  expect(+progress!).toBeLessThan(65);
  await page.locator(".set-editor").scrollIntoViewIfNeeded();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator(".set-editor .button").scrollIntoViewIfNeeded();
    const button = await page.locator(".set-editor .button").boundingBox(),
      dock = await page.getByRole("timer").boundingBox();
    expect(button!.y + button!.height).toBeLessThanOrEqual(dock!.y);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({ path: ".impeccable/review/v11/rest.png" });
  // Moving the clock without firing interval callbacks models a suspended tab.
  await page.clock.setSystemTime(new Date(first + 30500));
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByText("休息结束，可以开始下一组", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).__vibrations)).toEqual([
    [200, 120, 200],
  ]);
  await page.clock.runFor(2000);
  await page.getByRole("button", { name: "调整当前动作" }).click();
  expect(await page.evaluate(() => (window as any).__vibrations)).toHaveLength(
    1,
  );
  await page.reload();
  await page.getByRole("button", { name: "继续未完成训练" }).click();
  await expect(
    page.getByText("休息结束，可以开始下一组", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).__vibrations)).toHaveLength(
    0,
  );
  await page.screenshot({ path: ".impeccable/review/v11/rest-ended.png" });
  await page.getByRole("button", { name: "完成第 2 组" }).click();
  await saved(page);
  expect((await stateOf(page)).sessions[0].restUntil).toBeNull();
  await expect(page.locator(".rest-dock")).toHaveCount(0);
});

test("manual skip never vibrates and unsupported vibration retains visual completion", async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() => {
    (window as any).__vibrations = [];
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (pattern: number[]) => {
        (window as any).__vibrations.push(pattern);
        return true;
      },
    });
  });
  await twoSetWorkout(page);
  await page.getByRole("button", { name: "新增一组" }).click();
  await saved(page);
  await page.getByRole("button", { name: "完成第 1 组" }).click();
  await page.getByRole("button", { name: "跳过休息", exact: true }).click();
  await saved(page);
  expect((await stateOf(page)).sessions[0].restUntil).toBeNull();
  await page.clock.fastForward(125000);
  expect(await page.evaluate(() => (window as any).__vibrations)).toHaveLength(
    0,
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, "vibrate", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.getByRole("button", { name: "完成第 2 组" }).click();
  await saved(page);
  await page.clock.fastForward(125000);
  await expect(
    page.getByText("休息结束，可以开始下一组", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "完成第 3 组" }).click();
  await expect(page.locator(".rest-dock")).toHaveCount(0);
});

test("end confirmation scrolls into view, failed save stays put, summary starts at top", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await twoSetWorkout(page);
  await page.getByRole("button", { name: "完成第 1 组" }).click();
  await page.getByRole("button", { name: "跳过休息", exact: true }).click();
  await page.getByRole("button", { name: "完成第 2 组" }).click();
  await saved(page);
  const open = page.locator(".exercise-complete").getByRole("button", {
    name: "结束并查看总结",
    exact: true,
  });
  await open.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await open.click();
  const panel = page.getByRole("region", { name: "结束这节训练？" }),
    confirm = panel.getByRole("button", {
      name: "结束并查看总结",
      exact: true,
    });
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    // Reopening an already visible panel must also reveal its confirmation.
    await open.click();
    await expect(panel).toBeInViewport();
    const bounds = await confirm.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThan(
      await page.evaluate(() => innerHeight),
    );
  }
  await page.screenshot({
    path: ".impeccable/review/v11/end-confirmation.png",
  });
  await page.getByLabel("训练后感受").fill("下次保持重量");
  // Inject a failed IndexedDB commit; no successful-save navigation is allowed.
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).__failWrites = true;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if ((window as any).__failWrites)
        throw new DOMException("simulated quota failure", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await confirm.click();
  await expect(page.getByRole("alert")).toContainText("保存未成功");
  await expect(page.getByRole("heading", { name: "训练已保存" })).toHaveCount(
    0,
  );
  expect((await stateOf(page)).sessions[0].status).toBe("active");
  await page.evaluate(() => ((window as any).__failWrites = false));
  await confirm.click();
  await expect(page.getByRole("heading", { name: "训练已保存" })).toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  const actual = (await stateOf(page)).sessions[0];
  expect(actual.status).toBe("finished");
  expect(actual.note).toBe("下次保持重量");
  expect(
    actual.exercises.flatMap((e: any) => e.sets.filter((s: any) => s.actual)),
  ).toHaveLength(2);
  expect(actual.exercises[1].sets.every((s: any) => s.actual === null)).toBe(
    true,
  );
  await page.reload();
  await page.getByRole("button", { name: "记录", exact: true }).click();
  await page.locator(".history-row").click();
  await expect(page.getByRole("heading", { name: "训练已保存" })).toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

async function advanceGuide(page: Page) {
  const next = page.locator(".guide-next");
  await expect(next).toBeEnabled();
  await next.click();
}
async function openChest(page: Page) {
  if (await page.getByRole("button", { name: "胸部", exact: true }).count())
    await page.getByRole("button", { name: "胸部", exact: true }).click();
  else
    await page.getByRole("button", { name: "开始训练", exact: true }).click();
}
const existingProfile: Profile = {
  goal: "增肌",
  experience: "规律训练",
  frequency: 3,
  equipment: ["杠铃", "哑铃", "固定器械", "自重"],
  preference: "均衡",
  limits: "原有偏好",
};
function previousData(): State {
  const now = Date.now();
  function create(id: string, time: number, count: number): Session {
    const e = makeExercise(catalog[0], [], count);
    e.sets.forEach((s) => (s.weight = 60));
    return {
      id,
      theme: "胸部",
      startedAt: new Date(time).toISOString(),
      endedAt: null,
      status: "active",
      restUntil: null,
      note: id,
      recovery: false,
      source: "app",
      exercises: [e],
    };
  }
  let history = create("existing-history", now - 600000, 1);
  history = completeSet(
    history,
    history.exercises[0].id,
    history.exercises[0].sets[0].id,
    now - 500000,
  );
  history = finishSession(history, new Date(now - 400000).toISOString());
  let active = create("existing-active", now - 60000, 3);
  active = completeSet(
    active,
    active.exercises[0].id,
    active.exercises[0].sets[0].id,
    now - 10000,
  );
  return {
    ...emptyState(),
    revision: 14,
    profile: existingProfile,
    sessions: [history, active],
  };
}
async function installExistingData(page: Page, state: State) {
  await page.goto("/");
  await page.evaluate(
    (data) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("traintrace-v1", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("state");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("state", "readwrite");
          tx.objectStore("state").put(data, "main");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => reject(tx.error);
        };
      }),
    state,
  );
  await page.reload();
}

test("immersive guide advances once per tap, resumes, and completes before the existing form", async ({
  page,
}) => {
  await mkdir(".impeccable/review/v112", { recursive: true });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const guide = page.getByRole("region", { name: "新手引导", exact: true });
  await expect(
    page.getByRole("heading", { name: "每一次训练， 都不该从零开始。" }),
  ).toBeVisible();
  await expect(
    page.locator(".shell,header,nav,.profile-form,.data-tools"),
  ).toHaveCount(0);
  await expect(guide).toHaveCSS("background-color", "rgb(32, 40, 34)");
  await expect(guide.locator("img,svg,canvas")).toHaveCount(0);
  await page.screenshot({ path: ".impeccable/review/v112/intro-01.png" });
  // Same-turn clicks exercise the synchronous lock before React disables the button.
  await page.evaluate(() => {
    const b = document.querySelector<HTMLButtonElement>(".guide-next")!;
    for (let i = 0; i < 8; i++) b.click();
  });
  await expect(guide).toHaveAttribute("data-transitioning", "true");
  await expect(page.locator(".guide-next")).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: "练完一组， 点一下就够。" }),
  ).toBeVisible();
  await expect(page.locator(".guide-next")).toBeEnabled();
  await expect(page.locator(".guide-copy")).toHaveCSS(
    "transition-duration",
    "0.24s, 0.24s",
  );
  await expect(page.getByText("02 / 03", { exact: true })).toBeVisible();
  await page.screenshot({ path: ".impeccable/review/v112/intro-02.png" });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "练完一组， 点一下就够。" }),
  ).toBeVisible();
  await page.locator(".guide-next").press("Enter");
  await page.locator(".guide-next").evaluate((button) => button.blur());
  await expect(
    page.getByRole("heading", { name: "下一次， 比上一次更懂你。" }),
  ).toBeVisible();
  await expect(page.locator(".guide-next")).toBeEnabled();
  await expect(guide).toHaveCSS("background-color", "rgb(183, 214, 155)");
  await page.waitForTimeout(500);
  await expect(page.getByText("03 / 03", { exact: true })).toBeVisible();
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const box = await guide.boundingBox(),
      title = await page.getByRole("heading").boundingBox();
    expect(box!.y).toBe(0);
    expect(box!.height).toBe(viewport.height);
    expect(title!.x).toBeGreaterThanOrEqual(0);
    expect(title!.x + title!.width).toBeLessThanOrEqual(viewport.width);
    expect(title!.y).toBeGreaterThan(0);
    expect(title!.y + title!.height).toBeLessThan(viewport.height - 60);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (viewport.width === 1280)
      await page.screenshot({ path: ".impeccable/review/v112/desktop.png" });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".impeccable/review/v112/mobile.png" });
  await advanceGuide(page);
  await expect(
    page.getByRole("heading", { name: "先了解一下你的训练习惯。" }),
  ).toBeVisible();
  await expect(
    page.getByText("这些设置以后都可以修改。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("花一点时间认识你。", { exact: false }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".immersive-guide")).toHaveCount(0);
  await expect(page.locator(".profile-form")).toBeVisible();
  await page.getByRole("button", { name: "准备好了，开始训练" }).click();
  await expect(
    page.getByRole("button", { name: "偏好设置", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".immersive-guide")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "偏好设置", exact: true }),
  ).toBeVisible();
});

test("reduced motion switches directly; text and blank space both advance and skip opens setup", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const title = page.getByRole("heading", {
    name: "每一次训练， 都不该从零开始。",
  });
  await expect(title).toBeVisible();
  await expect(page.locator(".guide-copy")).toHaveCSS(
    "transition-duration",
    "0s",
  );
  const rect = await title.boundingBox();
  await page.mouse.click(rect!.x + rect!.width / 2, rect!.y + rect!.height / 2);
  await expect(
    page.getByRole("heading", { name: "练完一组， 点一下就够。" }),
  ).toBeVisible();
  await expect(page.locator(".guide-next")).toBeEnabled();
  await page.mouse.click(12, 150);
  await expect(
    page.getByRole("heading", { name: "下一次， 比上一次更懂你。" }),
  ).toBeVisible();
  await expect(page.locator(".guide-next")).toBeEnabled();
  await page.getByRole("button", { name: "跳过新手引导", exact: true }).click();
  await expect(page.locator(".profile-form")).toBeVisible();
  await page.reload();
  await expect(page.locator(".immersive-guide")).toHaveCount(0);
});

test("home and settings preferences persist while temporary plan choices stay temporary", async ({
  page,
}) => {
  await page.goto("/");
  await skipIntro(page);
  await page.getByRole("button", { name: "准备好了，开始训练" }).click();
  const entry = page.getByRole("button", { name: "偏好设置", exact: true });
  await expect(entry).toBeVisible();
  expect((await entry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await entry.click();
  await expect(
    page.getByRole("heading", { name: "训练偏好", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "力量提升", exact: true }).click();
  await page
    .getByRole("combobox", { name: "训练经验", exact: true })
    .selectOption("规律训练");
  await page
    .getByRole("combobox", { name: "每周训练", exact: true })
    .selectOption("4");
  await page.getByRole("button", { name: "杠铃", exact: true }).click();
  await page.getByRole("button", { name: "固定器械", exact: true }).click();
  await page
    .getByRole("combobox", { name: "训练节奏", exact: true })
    .selectOption("精简");
  await page.getByText("动作偏好或限制（选填）", { exact: true }).click();
  await page
    .getByLabel("动作偏好或限制", { exact: true })
    .fill("以哑铃动作为主");
  await page.getByRole("button", { name: "保存训练偏好", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "训练偏好已保存，下次制定计划时生效。" }),
  ).toBeVisible();
  const savedProfile = (await stateOf(page)).profile;
  expect(savedProfile).toEqual({
    goal: "力量提升",
    experience: "规律训练",
    frequency: 4,
    equipment: ["哑铃", "自重"],
    preference: "精简",
    limits: "以哑铃动作为主",
  });
  await page.reload();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "每周训练", exact: true }),
  ).toHaveValue("4");
  await expect(
    page.getByRole("combobox", { name: "训练经验", exact: true }),
  ).toHaveValue("规律训练");
  await expect(
    page.getByRole("combobox", { name: "训练节奏", exact: true }),
  ).toHaveValue("精简");
  await expect(
    page.getByRole("button", { name: "杠铃", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "训练", exact: true }).click();
  await openChest(page);
  await expect(
    page.getByLabel("哑铃卧推 第1组次数", { exact: true }),
  ).toHaveValue("5");
  await expect(
    page.locator(".plan-exercise").first().locator(".plan-set"),
  ).toHaveCount(2);
  await page.getByLabel("今天准备练多久？").selectOption("20");
  await page.getByRole("button", { name: "肩部", exact: true }).click();
  await page.getByRole("checkbox", { name: "轻量恢复训练" }).check();
  expect((await stateOf(page)).profile).toEqual(savedProfile);
  expect((await stateOf(page)).sessions).toEqual([]);
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.screenshot({
    path: ".impeccable/review/v112/settings.png",
    fullPage: true,
  });
});

test("existing profile bypasses guidance; settings and guide replay preserve all session facts", async ({
  page,
}) => {
  const initial = previousData();
  await installExistingData(page, initial);
  await expect(
    page.getByRole("button", { name: "继续未完成训练", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".immersive-guide,.profile-form")).toHaveCount(0);
  expect(await stateOf(page)).toEqual(initial);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "每周训练", exact: true }),
  ).toHaveValue("3");
  await page
    .getByRole("combobox", { name: "每周训练", exact: true })
    .selectOption("4");
  await page.getByRole("button", { name: "保存训练偏好", exact: true }).click();
  await saved(page);
  expect((await stateOf(page)).sessions).toEqual(initial.sessions);
  await page.getByText("使用指南", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "如何调整长期训练偏好" }),
  ).toBeVisible();
  const before = await stateOf(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .getByRole("button", { name: "重新查看新手引导", exact: true })
    .click();
  await expect(
    page.locator("header,nav,.profile-form,.data-tools"),
  ).toHaveCount(0);
  await advanceGuide(page);
  await advanceGuide(page);
  await advanceGuide(page);
  await expect(
    page.getByRole("heading", { name: "训练偏好", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "每周训练", exact: true }),
  ).toHaveValue("4");
  expect(await stateOf(page)).toEqual(before);
  await page.getByText("使用指南", { exact: true }).click();
  await page
    .getByRole("button", { name: "重新查看新手引导", exact: true })
    .click();
  await page.getByRole("button", { name: "跳过新手引导", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "训练偏好", exact: true }),
  ).toBeVisible();
  expect(await stateOf(page)).toEqual(before);
  await page.reload();
  await expect(page.locator(".immersive-guide")).toHaveCount(0);
  await page
    .getByRole("button", { name: "继续未完成训练", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "如何记录一组训练？" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "完成第 2 组" })).toBeVisible();
  expect((await stateOf(page)).sessions).toEqual(initial.sessions);
});

test("first workout hint is dismissible, appears only once and never writes training facts", async ({
  page,
}) => {
  await page.goto("/");
  await skipIntro(page);
  await page
    .getByRole("combobox", { name: "训练经验", exact: true })
    .selectOption("刚开始");
  await page.getByRole("button", { name: "准备好了，开始训练" }).click();
  await page.getByRole("button", { name: "开始训练", exact: true }).click();
  await page.getByLabel("杠铃卧推 第1组重量").fill("20");
  await page.getByRole("button", { name: "开始记录" }).click();
  const hint = page.getByRole("region", { name: "如何记录一组训练？" });
  await expect(hint).toBeVisible();
  await expect(hint).toContainText("第一次训练，先选择能够稳定控制的重量。");
  const before = await stateOf(page);
  await page.getByRole("button", { name: "知道了", exact: true }).click();
  await expect(hint).toHaveCount(0);
  expect(await stateOf(page)).toEqual(before);
  await page.getByRole("button", { name: "完成第 1 组" }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page
    .getByRole("button", { name: "继续未完成训练", exact: true })
    .click();
  await expect(hint).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("button", { name: "继续未完成训练", exact: true })
    .click();
  await expect(hint).toHaveCount(0);
  await expect(page.getByRole("button", { name: "完成第 2 组" })).toBeVisible();
});
