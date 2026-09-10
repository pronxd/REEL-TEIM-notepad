import { test, expect, type Page } from "@playwright/test";
import { zipSync } from "fflate";

const mainText =
  "Little things, big ideas\n\nA running list of things I don’t want to forget.\n\nTHIS WEEK\n→ Make space for a slower morning\n→ Take the camera on the next walk\n→ Finally start that side project\n\nA thought to come back to:\nGood ideas need a place to land. They don’t need to be perfect yet.\n\nINSPIRATION\nhttps://example.com/creative-notes\n\nKeep collecting. Keep creating.";
const originalDate = "2026-09-09T08:00:00.000Z";
type Record = { id: string; content: string; updated_at: string };

async function mockWorkspace(page: Page) {
  page.on("dialog", (dialog) => dialog.accept());
  const records: Record[] = [
    { id: "main", content: mainText, updated_at: originalDate },
    {
      id: "weekend",
      content:
        "Weekend wanderings\n\nA coffee, a camera, and no particular plans.\n\nCheck out the little bookshop on the corner.\nTake the long way home.",
      updated_at: originalDate,
    },
    {
      id: "ideas",
      content:
        "Ideas worth keeping\n\nA photo journal of ordinary days.\nA tiny herb garden by the kitchen window.\nMore handwritten letters.",
      updated_at: originalDate,
    },
  ];
  const files = [
    "Morning light.jpg",
    "A quieter corner.jpg",
    "Weekend walk.mp4",
    "Collected moments.jpg",
    "Afternoon notes.jpg",
    "A little inspiration.jpg",
  ].map((filename, index) => ({
    id: `media-${index}`,
    filename,
    url: `https://media.example.test/${index}.${filename.endsWith("mp4") ? "mp4" : "jpg"}`,
    created_at: originalDate,
  }));
  let failSave = false;
  let saveDelay = 0;
  const writes: Record[] = [];
  await page.addInitScript(() =>
    localStorage.setItem("notepad_authed", "true"),
  );
  await page.routeWebSocket(/realtime/, (socket) => socket.onMessage(() => {}));
  await page.route("**/rest/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/notes")) {
      if (route.request().method() === "GET")
        return route.fulfill({ json: records });
      if (failSave)
        return route.fulfill({
          status: 500,
          json: { message: "Offline", code: "test" },
        });
      const body = route.request().postDataJSON() as Record;
      writes.push(body);
      if (saveDelay)
        await new Promise((resolve) => setTimeout(resolve, saveDelay));
      const index = records.findIndex((record) => record.id === body.id);
      if (index >= 0) records[index] = { ...body };
      else records.push({ ...body });
      return route.fulfill({ status: 201, json: body });
    }
    if (url.pathname.endsWith("/images")) return route.fulfill({ json: files });
    return route.fulfill({ status: 404, json: {} });
  });
  const palettes = [
    ["#c6cbb3", "#82926a", "#eff0d7"],
    ["#d6c7ac", "#968363", "#efe2c7"],
    ["#b9c5b2", "#778873", "#e2e6d6"],
    ["#c5c1b7", "#8e927d", "#eeebdf"],
    ["#d3b697", "#a18169", "#e8d7b7"],
    ["#bfccbb", "#7e917a", "#e5eadb"],
  ];
  await page.route("https://media.example.test/**", async (route) => {
    const i = Number(
      new URL(route.request().url()).pathname.split(".")[0].slice(1),
    );
    const p = palettes[i] || palettes[0];
    if (route.request().url().includes("mp4"))
      return route.fulfill({ status: 404 });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="460"><defs><linearGradient id="g" x2=".8" y2="1"><stop stop-color="${p[0]}"/><stop offset="1" stop-color="${p[2]}"/></linearGradient></defs><rect width="600" height="460" fill="url(#g)"/><circle cx="440" cy="105" r="68" fill="${p[2]}"/><path d="M-40 350Q180 140 320 320T650 220V500H0Z" fill="${p[1]}"/><path d="M-40 450Q250 260 400 400T650 310V500H0Z" fill="${p[0]}"/><path d="M120 60V460M130 60V460" stroke="${p[2]}" stroke-width="8" opacity=".25"/></svg>`;
    return route.fulfill({ contentType: "image/svg+xml", body: svg });
  });
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Note text" })).toHaveValue(
    mainText,
  );
  return {
    records,
    files,
    writes,
    failSave: (value: boolean) => {
      failSave = value;
    },
    delay: (value: number) => {
      saveDelay = value;
    },
  };
}

test("notebook layout, tabs, search, and a new note persist separately", async ({
  page,
}, info) => {
  const mock = await mockWorkspace(page);
  await page.screenshot({
    path: `.test-artifacts/${info.project.name}-notes.png`,
    fullPage: true,
  });
  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.locator("body").evaluate((body) => body.clientWidth),
  );
  await page.getByRole("tab", { name: "Weekend wanderings" }).click();
  await expect(page.getByRole("textbox", { name: "Note text" })).toHaveValue(
    /A coffee, a camera/,
  );
  await page.getByRole("button", { name: "Create a new note tab" }).click();
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill("A fresh start\nMy new note.");
  await expect
    .poll(() =>
      mock.records.some(
        (record) => record.content === "A fresh start\nMy new note.",
      ),
    )
    .toBe(true);
  await page.getByRole("tab", { name: "Little things, big ideas" }).click();
  await expect(page.getByRole("textbox", { name: "Note text" })).toHaveValue(
    mainText,
  );
  await page.reload();
  await page.getByRole("tab", { name: "A fresh start" }).click();
  await expect(page.getByRole("textbox", { name: "Note text" })).toHaveValue(
    "A fresh start\nMy new note.",
  );
});

test("visible text and link reading do not use a transparent overlay", async ({
  page,
}) => {
  await mockWorkspace(page);
  const editor = page.getByRole("textbox", { name: "Note text" });
  const color = await editor.evaluate(
    (element) => getComputedStyle(element).color,
  );
  expect(color).not.toBe("rgba(0, 0, 0, 0)");
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await expect(
    page.getByRole("link", {
      name: "https://example.com/creative-notes",
      exact: true,
    }),
  ).toHaveAttribute("href", "https://example.com/creative-notes");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await editor.fill(
    "Links\nSee https://example.com/a_(b). And www.example.com!\nStill typing.",
  );
  await page.getByRole("button", { name: "2 links in this note" }).click();
  await expect(
    page.getByRole("link", { name: "https://example.com/a_(b)", exact: true }),
  ).toHaveAttribute("href", "https://example.com/a_(b)");
});

test("long-note caret survives delayed save echoes and deleting in the middle", async ({
  page,
}) => {
  const mock = await mockWorkspace(page);
  mock.delay(900);
  const editor = page.getByRole("textbox", { name: "Note text" });
  const long =
    "A long note\n" +
    Array.from(
      { length: 120 },
      (_, i) => `Line ${i}: thoughts and https://example.com/${i}`,
    ).join("\n");
  await editor.fill(long);
  await expect.poll(() => mock.writes.length).toBeGreaterThan(0);
  await editor.evaluate((element: HTMLTextAreaElement) => {
    element.focus();
    element.setSelectionRange(160, 160);
    element.scrollTop = 0;
  });
  await page.keyboard.press("Backspace");
  const changed = await editor.inputValue();
  // Simulate catching up with the server after the first, now stale, save completes.
  await expect
    .poll(() => mock.records.find((record) => record.id === "main")?.content)
    .toBe(long);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(editor).toHaveValue(changed);
  expect(
    await editor.evaluate(
      (element: HTMLTextAreaElement) => element.selectionStart,
    ),
  ).toBe(159);
  expect(
    await editor.evaluate((element: HTMLTextAreaElement) => element.scrollTop),
  ).toBeLessThan(300);
  await expect
    .poll(() => mock.records.find((record) => record.id === "main")?.content)
    .toBe(changed);
});

test("remote edits are offered without moving the cursor, and the next edit saves", async ({
  page,
}) => {
  const mock = await mockWorkspace(page);
  const editor = page.getByRole("textbox", { name: "Note text" });
  await editor.focus();
  await editor.evaluate((element: HTMLTextAreaElement) =>
    element.setSelectionRange(50, 50),
  );
  mock.records[0] = {
    id: "main",
    content: "An edit from my other device",
    updated_at: new Date(Date.now() + 1000).toISOString(),
  };
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("button", { name: "Load update" })).toBeVisible();
  await expect(editor).toHaveValue(mainText);
  expect(
    await editor.evaluate(
      (element: HTMLTextAreaElement) => element.selectionStart,
    ),
  ).toBe(50);
  await page.getByRole("button", { name: "Load update" }).click();
  await editor.fill("An edit from my other device\nAnd my first change.");
  await expect
    .poll(() => mock.records.find((record) => record.id === "main")?.content)
    .toBe("An edit from my other device\nAnd my first change.");
});

test("loading a remote conflict during a save preserves both versions", async ({
  page,
}) => {
  const mock = await mockWorkspace(page);
  mock.delay(1200);
  const editor = page.getByRole("textbox", { name: "Note text" });
  await editor.fill("My local draft during a save");
  await expect.poll(() => mock.writes.length).toBe(1);
  mock.records[0] = {
    id: "main",
    content: "The other device’s version",
    updated_at: new Date(Date.now() + 1000).toISOString(),
  };
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.getByRole("button", { name: "Load update" }).click();
  await expect(editor).toHaveValue("The other device’s version");
  await expect
    .poll(() => mock.records.find((record) => record.id === "main")?.content)
    .toBe("The other device’s version");
  await expect
    .poll(() =>
      mock.records.some(
        (record) =>
          record.id !== "main" &&
          record.content === "My local draft during a save",
      ),
    )
    .toBe(true);
});

test("failed saves report errors and recover a local draft after reload", async ({
  page,
}) => {
  const mock = await mockWorkspace(page);
  mock.failSave(true);
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill("A draft that must not be lost");
  await expect(page.getByRole("button", { name: "Retry save" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note text" })).toHaveValue(
    "A draft that must not be lost",
  );
  mock.failSave(false);
  await page.getByRole("button", { name: "Retry save" }).click();
  await expect
    .poll(() => mock.records[0].content)
    .toBe("A draft that must not be lost");
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
});

test("gallery filters, selection, ZIP download, and keyboard preview", async ({
  page,
}, info) => {
  await mockWorkspace(page);
  let requested: string[] = [];
  await page.route("**/api/download", async (route) => {
    requested = route.request().postDataJSON().ids;
    await route.fulfill({
      contentType: "application/zip",
      body: Buffer.from(
        zipSync({
          "one.jpg": new Uint8Array([1]),
          "two.jpg": new Uint8Array([2]),
        }),
      ),
    });
  });
  await page.getByRole("button", { name: /Media gallery/ }).click();
  await expect(
    page.getByRole("heading", { name: "Media gallery." }),
  ).toBeVisible();
  await page.screenshot({
    path: `.test-artifacts/${info.project.name}-gallery.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: /^Photos/ }).click();
  await expect(page.locator(".media-card")).toHaveCount(5);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Select Morning light.jpg", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Select A quieter corner.jpg", exact: true })
    .check();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download ZIP", exact: true }).click();
  expect((await downloaded).suggestedFilename()).toMatch(
    /notepad-media.*\.zip/,
  );
  expect(requested).toEqual(["media-0", "media-1"]);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("button", { name: "Preview Morning light.jpg", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Media preview" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("a video larger than the old limit uploads in small chunks", async ({
  page,
}) => {
  await mockWorkspace(page);
  const sizes: number[] = [];
  await page.route("**/api/upload**", async (route) => {
    const method = route.request().method();
    if (method === "POST")
      return route.fulfill({
        json: { token: "test-token", chunks: 3, chunkSize: 3 * 1024 * 1024 },
      });
    if (method === "PUT") {
      sizes.push(route.request().postDataBuffer()!.length);
      return route.fulfill({ json: { success: true } });
    }
    if (method === "PATCH")
      return route.fulfill({
        json: {
          image: {
            id: "uploaded-video",
            url: "https://media.example.test/uploaded.mp4",
            filename: "A new video.mp4",
            created_at: originalDate,
          },
        },
      });
    return route.fulfill({ json: { success: true } });
  });
  await page.getByRole("button", { name: /Media gallery/ }).click();
  await page.getByLabel("Upload photos or videos").setInputFiles({
    name: "A new video.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.alloc(7 * 1024 * 1024, 42),
  });
  await expect(
    page.getByRole("button", { name: "Preview A new video.mp4", exact: true }),
  ).toBeVisible();
  expect(sizes).toEqual([3 * 1024 * 1024, 3 * 1024 * 1024, 1024 * 1024]);
  await expect(page.getByText("Done", { exact: true })).toBeVisible();
});
