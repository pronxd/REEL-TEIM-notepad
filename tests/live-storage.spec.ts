import { test, expect } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { NextRequest } from "next/server";
import {
  POST as start,
  PUT as uploadPart,
  PATCH as complete,
  DELETE as cancel,
} from "../src/app/api/upload/route";
import { POST as deleteMedia } from "../src/app/api/delete-image/route";
import { storageFetch } from "../src/lib/storage-server";
import { UPLOAD_CHUNK_BYTES } from "../src/lib/media";

// Explicitly opt in: this verifies real Bunny I/O with disposable synthetic bytes.
// Database writes are mocked so nothing appears in the user's actual gallery.
test("live storage assembles a large file and cleans it up", async () => {
  test.skip(
    process.env.VERIFY_LIVE_STORAGE !== "1",
    "Opt-in integration test; normal tests never contact production services.",
  );
  test.setTimeout(180000);
  loadEnvConfig(process.cwd());
  const actualFetch = globalThis.fetch;
  const databaseOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
  const records: { id: string; url: string; filename: string }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== databaseOrigin) return actualFetch(input, init);
    // Read-only database connectivity check is made separately, before this mock.
    if (init?.method === "POST") {
      const record = {
        id: "disposable-test-record",
        ...JSON.parse(String(init.body)),
      };
      records.push(record);
      return Response.json(record, { status: 201 });
    }
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json(records[0] || null);
  };
  let token: string | undefined;
  let finalPath: string | undefined;
  try {
    const response = await start(
      new NextRequest("http://localhost/api/upload", {
        method: "POST",
        body: JSON.stringify({
          filename: "notepad-disposable-upload-check.mp4",
          size: 7 * 1024 * 1024,
        }),
      }),
    );
    expect(response.status).toBe(200);
    const session = await response.json();
    token = session.token;
    const payload = JSON.parse(
      Buffer.from(token!.split(".")[0], "base64url").toString(),
    );
    finalPath = `notepad-images/${payload.id}.mp4`;
    const bytes = Buffer.alloc(7 * 1024 * 1024, 0x5a);
    for (let index = 0; index < session.chunks; index++) {
      const part = await uploadPart(
        new NextRequest(`http://localhost/api/upload?index=${index}`, {
          method: "PUT",
          headers: { "X-Upload-Token": token! },
          body: bytes.subarray(
            index * UPLOAD_CHUNK_BYTES,
            (index + 1) * UPLOAD_CHUNK_BYTES,
          ),
        }),
      );
      expect(part.status).toBe(200);
    }
    const finished = await complete(
      new NextRequest("http://localhost/api/upload", {
        method: "PATCH",
        headers: { "X-Upload-Token": token! },
      }),
    );
    expect(finished.status).toBe(200);
    const saved = await storageFetch(finalPath);
    expect(saved.ok).toBe(true);
    expect(Buffer.from(await saved.arrayBuffer()).equals(bytes)).toBe(true);
    const deleted = await deleteMedia(
      new NextRequest("http://localhost/api/delete-image", {
        method: "POST",
        body: JSON.stringify({ id: "disposable-test-record" }),
      }),
    );
    expect(deleted.status).toBe(200);
    expect((await storageFetch(finalPath)).status).toBe(404);
    finalPath = undefined;
  } finally {
    if (finalPath) await storageFetch(finalPath, { method: "DELETE" });
    if (token)
      await cancel(
        new NextRequest("http://localhost/api/upload", {
          method: "DELETE",
          headers: { "X-Upload-Token": token },
        }),
      );
    globalThis.fetch = actualFetch;
  }
});
