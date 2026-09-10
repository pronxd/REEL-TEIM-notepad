import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import {
  MAX_MEDIA_BYTES,
  MEDIA_TYPES,
  mediaExtension,
  safeFilename,
  UPLOAD_CHUNK_BYTES,
} from "@/lib/media";
import {
  mediaDatabase,
  storageConfig,
  storageFetch,
} from "@/lib/storage-server";

export const runtime = "nodejs";
export const maxDuration = 300;

interface UploadSession {
  id: string;
  filename: string;
  size: number;
  chunks: number;
  expires: number;
  ext: string;
}
function signature(payload: string) {
  return createHmac("sha256", storageConfig().key)
    .update(`notepad-upload:${payload}`)
    .digest("base64url");
}
function sessionFrom(req: NextRequest): UploadSession {
  const [payload, sig] = (req.headers.get("X-Upload-Token") || "").split(".");
  if (!payload || !sig) throw new Error("Missing upload session.");
  const expected = Buffer.from(signature(payload));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new Error("Invalid upload session.");
  const session = JSON.parse(
    Buffer.from(payload, "base64url").toString(),
  ) as UploadSession;
  if (session.expires < Date.now())
    throw new Error("Upload expired. Please choose the file again.");
  return session;
}
function partPath(session: UploadSession, index: number) {
  return `notepad-upload-parts/${session.id}/${index}`;
}
async function cleanup(session: UploadSession) {
  // The signed, server-generated UUID confines cleanup to this upload's temporary parts.
  const result = await storageFetch(`notepad-upload-parts/${session.id}/`, {
    method: "DELETE",
  });
  if (!result.ok && result.status !== 404)
    console.error("Temporary upload cleanup failed", result.status);
}
async function cleanupExpiredParts() {
  const response = await storageFetch("notepad-upload-parts/");
  if (!response.ok) return;
  const entries: unknown = await response.json();
  if (!Array.isArray(entries)) return;
  const cutoff = Date.now() - 2 * 3600000;
  const expired = entries
    .filter(
      (entry) =>
        entry?.IsDirectory &&
        typeof entry.ObjectName === "string" &&
        /^\d{13}-[a-f0-9-]{36}$/.test(entry.ObjectName) &&
        Number(entry.ObjectName.slice(0, 13)) < cutoff,
    )
    .slice(0, 10);
  // Interrupted uploads are swept on later uploads, after their signed sessions expire.
  await Promise.allSettled(
    expired.map((entry) =>
      storageFetch(`notepad-upload-parts/${entry.ObjectName}/`, {
        method: "DELETE",
      }),
    ),
  );
}
function failure(error: unknown, status = 400) {
  return NextResponse.json(
    {
      error:
        error instanceof Error
          ? error.message
          : "Upload failed. Please try again.",
    },
    { status },
  );
}

// Only small JSON requests and <=3 MB chunks pass through the function body limit.
export async function POST(req: NextRequest) {
  try {
    storageConfig();
    const { filename, size } = await req.json();
    if (
      typeof filename !== "string" ||
      !filename.trim() ||
      filename.length > 500 ||
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size > MAX_MEDIA_BYTES
    ) {
      throw new Error("Choose a non-empty photo or video up to 100 MB.");
    }
    const ext = mediaExtension(filename);
    if (!MEDIA_TYPES[ext])
      throw new Error("This photo or video format is not supported.");
    await cleanupExpiredParts().catch(() => {});
    const session: UploadSession = {
      id: `${Date.now()}-${randomUUID()}`,
      filename: safeFilename(filename),
      ext,
      size,
      chunks: Math.ceil(size / UPLOAD_CHUNK_BYTES),
      expires: Date.now() + 3600000,
    };
    const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
    return NextResponse.json({
      token: `${payload}.${signature(payload)}`,
      chunks: session.chunks,
      chunkSize: UPLOAD_CHUNK_BYTES,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = sessionFrom(req);
    const index = Number(req.nextUrl.searchParams.get("index"));
    if (
      !req.nextUrl.searchParams.has("index") ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= session.chunks
    )
      throw new Error("Invalid upload chunk.");
    const expected = Math.min(
      UPLOAD_CHUNK_BYTES,
      session.size - index * UPLOAD_CHUNK_BYTES,
    );
    const reader = req.body?.getReader();
    if (!reader) throw new Error("Missing file content.");
    const buffers: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > expected) {
        await reader.cancel();
        throw new Error("Upload chunk is too large.");
      }
      buffers.push(value);
    }
    if (received !== expected)
      throw new Error("Incomplete upload chunk. Please try again.");
    const result = await storageFetch(partPath(session, index), {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: Buffer.concat(buffers),
    });
    if (!result.ok)
      throw new Error("Couldn’t upload this part. Please try again.");
    return NextResponse.json({ success: true });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(req: NextRequest) {
  let session: UploadSession;
  try {
    session = sessionFrom(req);
  } catch (error) {
    return failure(error);
  }
  const path = `notepad-images/${session.id}.${session.ext}`;
  try {
    const database = mediaDatabase();
    const url = `https://${storageConfig().cdn}/${path}`;
    const existing = await database
      .from("images")
      .select("*")
      .eq("url", url)
      .maybeSingle();
    if (existing.error)
      throw new Error("Couldn’t check the upload. Please try again.");
    if (existing.data) return NextResponse.json({ image: existing.data });

    async function* parts() {
      for (let index = 0; index < session.chunks; index++) {
        const response = await storageFetch(partPath(session, index));
        if (!response.ok || !response.body)
          throw new Error("A file part is missing. Please upload again.");
        const reader = response.body.getReader();
        let received = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            yield value;
          }
        } finally {
          await reader.cancel();
          reader.releaseLock();
        }
        if (
          received !==
          Math.min(
            UPLOAD_CHUNK_BYTES,
            session.size - index * UPLOAD_CHUNK_BYTES,
          )
        )
          throw new Error("Incomplete file part.");
      }
    }
    const stream = Readable.toWeb(
      Readable.from(parts()),
    ) as ReadableStream<Uint8Array>;
    const result = await storageFetch(path, {
      method: "PUT",
      headers: {
        "Content-Type": MEDIA_TYPES[session.ext],
        "Content-Length": String(session.size),
      },
      body: stream,
      duplex: "half",
    });
    if (!result.ok)
      throw new Error("Couldn’t finish the upload. Please try again.");
    const { data, error } = await database
      .from("images")
      .insert({ url, filename: session.filename })
      .select()
      .single();
    if (error)
      throw new Error("Couldn’t save the media record. Please try again.");
    await cleanup(session).catch(() => {});
    return NextResponse.json({ image: data });
  } catch (error) {
    console.error(
      "Upload completion failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    return failure(
      new Error(
        "Couldn’t finish the upload. Check your connection and try again.",
      ),
      500,
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await cleanup(sessionFrom(req));
    return NextResponse.json({ success: true });
  } catch (error) {
    return failure(error);
  }
}
