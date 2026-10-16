import { test, expect, type Page } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
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
  await expect(
    page.getByRole("heading", { name: "你的训练， 值得被记住。" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "准备好了，开始训练" }).click();
  await saved(page);
  await page.getByRole("button", { name: "我的", exact: true }).click();
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
  const toggle = page.getByRole("checkbox", { name: "保守复训" });
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
  await page.getByRole("button", { name: "我的", exact: true }).click();
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
  await restored.getByText("已经有训练数据？直接导入").click();
  await importFile(restored, contents, "backup.json");
  await expect(
    restored.getByRole("button", { name: "继续未完成训练" }),
  ).toBeVisible();
  await restored.getByRole("button", { name: "我的", exact: true }).click();
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
  await page.goto("/");
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
