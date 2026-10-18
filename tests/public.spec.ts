import { test, expect } from "@playwright/test";

test("a new visitor starts empty and a separate browser does not inherit preferences", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "跳过新手引导", exact: true }),
  ).toBeVisible();
  const read = () =>
    page.evaluate(
      () =>
        new Promise<unknown>((resolve) => {
          const r = indexedDB.open("traintrace-v1", 1);
          r.onsuccess = () => {
            const q = r.result
              .transaction("state")
              .objectStore("state")
              .get("main");
            q.onsuccess = () => {
              resolve(q.result ?? null);
              r.result.close();
            };
          };
        }),
    );
  expect(await read()).toBeNull();
  await page.getByRole("button", { name: "跳过新手引导", exact: true }).click();
  const fresh = await browser.newContext();
  const friend = await fresh.newPage();
  await friend.goto(page.url());
  await expect(
    friend.getByRole("button", { name: "跳过新手引导", exact: true }),
  ).toBeVisible();
  await fresh.close();
});

test("public summary keeps rule feedback with no AI entry, localhost or model request", async ({
  page,
}) => {
  const forbidden: string[] = [];
  page.on("request", (r) => {
    if (/\/api\/|deepseek|localhost/.test(r.url())) forbidden.push(r.url());
  });
  await page.goto("/");
  // Explicitly synthetic single-set fixture, never bundled as initial data.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        localStorage.setItem(
          "traintrace-guidance",
          JSON.stringify({ introStep: 3 }),
        );
        const r = indexedDB.open("traintrace-v1", 1);
        r.onsuccess = () => {
          const tx = r.result.transaction("state", "readwrite");
          tx.objectStore("state").put(
            {
              schemaVersion: 1,
              revision: 1,
              profile: {
                goal: "建立习惯",
                experience: "刚开始",
                frequency: 3,
                equipment: ["杠铃"],
                preference: "保守",
                limits: "",
              },
              sessions: [
                {
                  id: "synthetic-public-check",
                  theme: "胸部",
                  status: "finished",
                  startedAt: "2025-01-01T10:00:00Z",
                  endedAt: "2025-01-01T10:01:00Z",
                  restUntil: null,
                  recovery: false,
                  source: "app",
                  note: "Synthetic test fixture",
                  exercises: [
                    {
                      id: "fixture-bench",
                      catalogId: "bench",
                      name: "杠铃卧推",
                      equipment: "杠铃",
                      basis: "总重量",
                      rest: 120,
                      main: true,
                      skipped: false,
                      sets: [
                        {
                          id: "fixture-set",
                          weight: 20,
                          reps: 5,
                          actual: {
                            weight: 20,
                            reps: 5,
                            completedAt: "2025-01-01T10:01:00Z",
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            "main",
          );
          tx.oncomplete = () => {
            r.result.close();
            resolve();
          };
        };
      }),
  );
  await page.reload();
  await page.getByRole("button", { name: "记录", exact: true }).click();
  await page.locator(".history-row").first().click();
  await expect(page.locator(".training-feedback")).toBeVisible();
  await expect(page.locator(".feedback-ai-button")).toHaveCount(0);
  await expect(page.locator(".feedback-analysis")).toHaveCount(0);
  expect(forbidden).toEqual([]);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByText("关于与隐私", { exact: true }).click();
  await expect(
    page.getByText("网页版使用本地规则反馈", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("不会同步到其他设备", { exact: false }),
  ).toBeVisible();
});

test("PWA manifest and install assets stay within the served site", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  const url = new URL(href!, page.url());
  const manifest = await (await request.get(url.href)).json();
  expect(manifest.display).toBe("standalone");
  expect(new URL(manifest.start_url, url).origin).toBe(url.origin);
  expect(new URL(manifest.scope, url).origin).toBe(url.origin);
  expect(manifest.icons.map((x: { sizes: string }) => x.sizes)).toEqual(
    expect.arrayContaining(["192x192", "512x512"]),
  );
  for (const icon of manifest.icons)
    expect((await request.get(new URL(icon.src, url).href)).ok()).toBe(true);
  await page.evaluate(() => navigator.serviceWorker.ready);
  const urls = await page.evaluate(async () =>
    (
      await Promise.all(
        (await caches.keys()).map(async (name) =>
          (await (await caches.open(name)).keys()).map((r) => r.url),
        ),
      )
    ).flat(),
  );
  expect(
    urls.some((u) =>
      /backup|training-history|analysis:|\.env|\.md$|dist-server/.test(u),
    ),
  ).toBe(false);
});
