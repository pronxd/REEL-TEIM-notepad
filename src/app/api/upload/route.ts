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
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Generate unique filename
    const ext = file.name.split(".").pop() || "jpg";
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const storagePath = `notepad-images/${filename}`;

    // Upload to Bunny.net Storage
    const buffer = Buffer.from(await file.arrayBuffer());
    const bunnyRes = await fetch(
      `https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${storagePath}`,
      {
        method: "PUT",
        headers: {
          AccessKey: BUNNY_STORAGE_KEY,
          "Content-Type": "application/octet-stream",
        },
        body: buffer,
      }
    );

    if (!bunnyRes.ok) {
      const text = await bunnyRes.text();
      const bunnyUrl = `https://storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}/${storagePath}`;
      console.error("Bunny upload failed:", bunnyRes.status, text, "URL:", bunnyUrl);
      return NextResponse.json(
        { error: "Upload to CDN failed", status: bunnyRes.status, detail: text },
        { status: 500 }
      );
    }

    const cdnUrl = `https://${BUNNY_CDN_HOST}/${storagePath}`;

    // Save reference in Supabase for realtime sync
    const { data, error } = await supabase
      .from("images")
      .insert({ url: cdnUrl, filename: file.name })
      .select()
      .single();

    if (error) {
      console.error("Supabase insert failed:", error);
      return NextResponse.json({ error: "Failed to save image record" }, { status: 500 });
    }

    return NextResponse.json({ image: data });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
