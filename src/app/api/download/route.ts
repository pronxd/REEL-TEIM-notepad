import { Readable } from "node:stream";
import { Zip, ZipPassThrough } from "fflate";
import { NextRequest, NextResponse } from "next/server";
import { safeFilename, type MediaRecord } from "@/lib/media";
import { mediaDatabase, mediaPath, storageFetch } from "@/lib/storage-server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id)
      return NextResponse.json(
        { error: "Choose a file to download." },
        { status: 400 },
      );
    const { data, error } = await mediaDatabase()
      .from("images")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data)
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    const file = await storageFetch(mediaPath(data.url), {
      signal: req.signal,
    });
    if (!file.ok || !file.body) throw new Error("File unavailable");
    return new Response(file.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeFilename(data.filename))}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Couldn’t download this file. Please try again." },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { ids } = await req.json();
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 100 ||
      ids.some((id) => typeof id !== "string" || !id)
    ) {
      return NextResponse.json(
        { error: "Select between 1 and 100 files per download." },
        { status: 400 },
      );
    }
    const uniqueIds = [...new Set<string>(ids)];
    const { data, error } = await mediaDatabase()
      .from("images")
      .select("*")
      .in("id", uniqueIds);
    if (error || !data || data.length !== uniqueIds.length)
      return NextResponse.json(
        {
          error:
            "Some files are no longer available. Refresh the gallery and try again.",
        },
        { status: 404 },
      );
    const records = data as MediaRecord[];
    // Validate every location before starting the response; never fetch a caller-supplied URL.
    for (const record of records) mediaPath(record.url);

    async function* archive() {
      const pending: Uint8Array[] = [];
      const zip = new Zip((error, bytes) => {
        if (error) throw error;
        pending.push(bytes);
      });
      const used = new Set<string>();
      try {
        for (const record of records) {
          const original = safeFilename(record.filename);
          let filename = original;
          let suffix = 1;
          const dot = original.lastIndexOf(".");
          while (used.has(filename.toLowerCase())) {
            suffix++;
            filename =
              dot > 0
                ? `${original.slice(0, dot)} (${suffix})${original.slice(dot)}`
                : `${original} (${suffix})`;
          }
          used.add(filename.toLowerCase());
          const response = await storageFetch(mediaPath(record.url), {
            signal: req.signal,
          });
          if (!response.ok || !response.body)
            throw new Error(`Couldn’t download ${filename}`);
          const entry = new ZipPassThrough(filename);
          zip.add(entry);
          const reader = response.body.getReader();
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              entry.push(value, false);
              yield* pending.splice(0);
            }
            entry.push(new Uint8Array(0), true);
            yield* pending.splice(0);
          } finally {
            await reader.cancel();
            reader.releaseLock();
          }
        }
        zip.end();
        yield* pending.splice(0);
      } finally {
        zip.terminate();
      }
    }
    return new Response(
      Readable.toWeb(Readable.from(archive())) as ReadableStream<Uint8Array>,
      {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="notepad-media-${new Date().toISOString().slice(0, 10)}.zip"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "Couldn’t prepare the download. Please try again." },
      { status: 500 },
    );
  }
}
