import { test, expect } from "@playwright/test";

test("a keyboard-sized visual viewport leaves room to edit on a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() =>
    localStorage.setItem("notepad_authed", "true"),
  );
  await page.routeWebSocket(/realtime/, (socket) => socket.onMessage(() => {}));
  await page.route("**/rest/v1/**", (route) =>
    route.fulfill({
      json: route.request().url().includes("/notes")
        ? [
            {
              id: "main",
              content:
                "Phone editing\n\nA little room to think.\nhttps://example.com",
              updated_at: "2026-09-09T08:00:00Z",
            },
          ]
        : [],
    }),
  );
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Note text" });
  await expect(editor).toHaveValue(/Phone editing/);
  await editor.focus();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", {
      configurable: true,
      value: 360,
    });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator("html")).toHaveAttribute(
    "data-compact-viewport",
    "",
  );
  const box = await editor.boundingBox();
  expect(box!.height).toBeGreaterThan(130);
  expect(box!.y + box!.height).toBeLessThan(360);
  await page.screenshot({ path: ".test-artifacts/mobile-keyboard-layout.png" });
});
