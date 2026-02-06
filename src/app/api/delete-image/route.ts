import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const BUNNY_STORAGE_KEY = process.env.BUNNY_STORAGE_KEY!;
const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE!;
const BUNNY_STORAGE_REGION = process.env.BUNNY_STORAGE_REGION || "";
const BUNNY_CDN_HOST = process.env.BUNNY_CDN_HOST!;

const BUNNY_STORAGE_HOST = BUNNY_STORAGE_REGION
  ? `${BUNNY_STORAGE_REGION}.storage.bunnycdn.com`
  : "storage.bunnycdn.com";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { id, url } = await req.json();

    if (!id || !url) {
      return NextResponse.json({ error: "Missing id or url" }, { status: 400 });
    }

    // Extract storage path from CDN URL
    const cdnPrefix = `https://${BUNNY_CDN_HOST}/`;
    const storagePath = url.replace(cdnPrefix, "");

    // Delete from Bunny.net Storage
    const bunnyRes = await fetch(
      `https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${storagePath}`,
      {
        method: "DELETE",
        headers: {
          AccessKey: BUNNY_STORAGE_KEY,
        },
      }
    );

    if (!bunnyRes.ok) {
      console.error("Bunny delete failed:", await bunnyRes.text());
    }

    // Remove from Supabase
    const { error } = await supabase.from("images").delete().eq("id", id);

    if (error) {
      console.error("Supabase delete failed:", error);
      return NextResponse.json({ error: "Failed to delete image record" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete error:", err);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
