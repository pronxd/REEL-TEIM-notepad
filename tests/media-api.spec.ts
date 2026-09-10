import { test, expect } from "@playwright/test";
import { NextRequest } from "next/server";
import { unzipSync } from "fflate";
import {
  POST as start,
  PUT as part,
  PATCH as complete,
} from "../src/app/api/upload/route";
import {
  GET as download,
  POST as downloadZip,
} from "../src/app/api/download/route";
import { POST as deleteMedia } from "../src/app/api/delete-image/route";
import { MAX_MEDIA_BYTES, UPLOAD_CHUNK_BYTES } from "../src/lib/media";

test.describe("media server routes", () => {
  let originalFetch: typeof fetch;
  let originalEnv: NodeJS.ProcessEnv;
  let stored: Map<string, Uint8Array>;
  let records: { id: string; url: string; filename: string }[];
  let requestedUrls: string[];
  let failStorageDelete: boolean;

  test.beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalEnv = { ...process.env };
    process.env.BUNNY_STORAGE_KEY = "test-only-key";
    process.env.BUNNY_STORAGE_ZONE = "test-zone";
    process.env.BUNNY_CDN_HOST = "cdn.example.test";
    process.env.BUNNY_STORAGE_REGION = "";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.example.test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only-anon";
    stored = new Map();
    records = [];
    requestedUrls = [];
    failStorageDelete = false;
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method || "GET";
      requestedUrls.push(url.toString());
      if (url.hostname === "storage.bunnycdn.com") {
        expect((init?.headers as { AccessKey: string }).AccessKey).toBe(
          "test-only-key",
        );
        const path = url.pathname.replace("/test-zone/", "");
        if (method === "PUT") {
          const body = new Uint8Array(
            await new Response(init?.body).arrayBuffer(),
          );
          const size = (init?.headers as { "Content-Length"?: string })[
            "Content-Length"
          ];
          if (size) expect(body.length).toBe(Number(size));
          stored.set(path, body);
          return new Response("", { status: 201 });
        }
        if (method === "DELETE") {
          if (failStorageDelete) return new Response("", { status: 500 });
          for (const key of stored.keys())
            if (key === path || (path.endsWith("/") && key.startsWith(path)))
              stored.delete(key);
          return new Response("", { status: 200 });
        }
        if (path === "notepad-upload-parts/") return Response.json([]);
        return stored.has(path)
          ? new Response(Buffer.from(stored.get(path)!))
          : new Response("", { status: 404 });
      }
      if (url.hostname === "database.example.test") {
        if (method === "POST") {
          const record = {
            id: `record-${records.length}`,
            ...JSON.parse(String(init?.body)),
          };
          records.push(record);
          return Response.json(record, { status: 201 });
        }
        if (method === "DELETE") {
          const id = url.searchParams.get("id")?.slice(3);
          records = records.filter((record) => record.id !== id);
          return new Response(null, { status: 204 });
        }
        if (url.searchParams.has("url"))
          return Response.json(
            records.find(
              (record) => record.url === url.searchParams.get("url")!.slice(3),
            ) || null,
          );
        const id = url.searchParams.get("id");
        if (id?.startsWith("eq."))
          return Response.json(
            records.find((record) => record.id === id.slice(3)) || null,
          );
        if (id?.startsWith("in."))
          return Response.json(
            records.filter((record) => id.includes(record.id)),
          );
        return Response.json(records);
      }
      throw new Error(`Unexpected external request: ${url.hostname}`);
    };
  });

  test.afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env))
      if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  });

  test("a 7 MB video is reconstructed byte-for-byte and parts are removed", async () => {
    const bytes = Buffer.alloc(7 * 1024 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    const response = await start(
      new NextRequest("http://localhost/api/upload", {
        method: "POST",
        body: JSON.stringify({
          filename: "Test video.mp4",
          size: bytes.length,
        }),
      }),
    );
    expect(response.status).toBe(200);
    const session = await response.json();
    expect(session.chunks).toBe(3);
    for (let i = 0; i < session.chunks; i++) {
      const response = await part(
        new NextRequest(`http://localhost/api/upload?index=${i}`, {
          method: "PUT",
          headers: { "X-Upload-Token": session.token },
          body: bytes.subarray(
            i * UPLOAD_CHUNK_BYTES,
            (i + 1) * UPLOAD_CHUNK_BYTES,
          ),
        }),
      );
      expect(response.status).toBe(200);
    }
    const finalized = await complete(
      new NextRequest("http://localhost/api/upload", {
        method: "PATCH",
        headers: { "X-Upload-Token": session.token },
      }),
    );
    expect(finalized.status).toBe(200);
    const { image } = await finalized.json();
    expect(image.filename).toBe("Test video.mp4");
    expect(stored.size).toBe(1);
    expect(Buffer.from([...stored.values()][0]).equals(bytes)).toBe(true);
    // Retrying a lost completion response must not duplicate the media record.
    const repeated = await complete(
      new NextRequest("http://localhost/api/upload", {
        method: "PATCH",
        headers: { "X-Upload-Token": session.token },
      }),
    );
    expect(repeated.status).toBe(200);
    expect(records).toHaveLength(1);
  });

  test("rejects oversized files, active documents, and modified upload tokens", async () => {
    for (const input of [
      { filename: "huge.mp4", size: MAX_MEDIA_BYTES + 1 },
      { filename: "active.svg", size: 10 },
      { filename: "empty.jpg", size: 0 },
    ]) {
      expect(
        (
          await start(
            new NextRequest("http://localhost/api/upload", {
              method: "POST",
              body: JSON.stringify(input),
            }),
          )
        ).status,
      ).toBe(400);
    }
    const session = await (
      await start(
        new NextRequest("http://localhost/api/upload", {
          method: "POST",
          body: JSON.stringify({ filename: "photo.jpg", size: 4 }),
        }),
      )
    ).json();
    expect(
      (
        await part(
          new NextRequest("http://localhost/api/upload?index=0", {
            method: "PUT",
            headers: { "X-Upload-Token": `${session.token}modified` },
            body: "test",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await part(
          new NextRequest("http://localhost/api/upload?index=0", {
            method: "PUT",
            headers: { "X-Upload-Token": session.token },
            body: "too long",
          }),
        )
      ).status,
    ).toBe(400);
    expect(stored.size).toBe(0);
  });

  test("ZIP preserves every file, Unicode names, and duplicate filenames", async () => {
    records.push(
      {
        id: "first",
        url: "https://cdn.example.test/notepad-images/a.jpg",
        filename: "Café.jpg",
      },
      {
        id: "second",
        url: "https://cdn.example.test/notepad-images/b.jpg",
        filename: "Café.jpg",
      },
    );
    stored.set("notepad-images/a.jpg", new Uint8Array([1, 2, 3]));
    stored.set("notepad-images/b.jpg", new Uint8Array([4, 5, 6]));
    const response = await downloadZip(
      new NextRequest("http://localhost/api/download", {
        method: "POST",
        body: JSON.stringify({ ids: ["first", "second"] }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(files)).toEqual(["Café.jpg", "Café (2).jpg"]);
    expect(Array.from(files["Café.jpg"])).toEqual([1, 2, 3]);
    expect(Array.from(files["Café (2).jpg"])).toEqual([4, 5, 6]);
  });

  test("downloads only stored media locations and reports missing selections", async () => {
    records.push({
      id: "bad",
      url: "https://untrusted.example.test/private.jpg",
      filename: "photo.jpg",
    });
    expect(
      (await download(new NextRequest("http://localhost/api/download?id=bad")))
        .status,
    ).toBe(502);
    expect(
      requestedUrls.every((url) => !url.includes("untrusted.example.test")),
    ).toBe(true);
    expect(
      (
        await downloadZip(
          new NextRequest("http://localhost/api/download", {
            method: "POST",
            body: JSON.stringify({ ids: ["missing"] }),
          }),
        )
      ).status,
    ).toBe(404);
  });

  test("does not remove a gallery record when storage deletion fails", async () => {
    records.push({
      id: "first",
      url: "https://cdn.example.test/notepad-images/a.jpg",
      filename: "photo.jpg",
    });
    failStorageDelete = true;
    expect(
      (
        await deleteMedia(
          new NextRequest("http://localhost/api/delete-image", {
            method: "POST",
            body: JSON.stringify({ id: "first" }),
          }),
        )
      ).status,
    ).toBe(500);
    expect(records).toHaveLength(1);
  });
});
