import { NextRequest, NextResponse } from "next/server";
import { mediaDatabase, mediaPath, storageFetch } from "@/lib/storage-server";

export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (typeof id !== "string" || !id)
      return NextResponse.json({ error: "Missing media ID." }, { status: 400 });
    const database = mediaDatabase();
    const { data, error } = await database
      .from("images")
      .select("url")
      .eq("id", id)
      .single();
    if (error || !data)
      return NextResponse.json({ error: "Media not found." }, { status: 404 });
    const result = await storageFetch(mediaPath(data.url), {
      method: "DELETE",
    });
    if (!result.ok && result.status !== 404)
      throw new Error("Storage deletion failed");
    const removed = await database.from("images").delete().eq("id", id);
    if (removed.error) throw removed.error;
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Couldn’t delete this file. Please try again." },
      { status: 500 },
    );
  }
}
