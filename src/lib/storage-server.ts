import { createClient } from "@supabase/supabase-js";

export function mediaDatabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export function storageConfig() {
  const key = process.env.BUNNY_STORAGE_KEY;
  const zone = process.env.BUNNY_STORAGE_ZONE;
  const cdn = process.env.BUNNY_CDN_HOST;
  const region = process.env.BUNNY_STORAGE_REGION || "";
  if (!key || !zone || !cdn)
    throw new Error("Media storage is not configured on the server.");
  return {
    key,
    cdn,
    origin: `https://${region ? `${region}.` : ""}storage.bunnycdn.com/${zone}`,
  };
}

export function storageFetch(
  path: string,
  init: RequestInit & { duplex?: "half" } = {},
) {
  const config = storageConfig();
  return fetch(`${config.origin}/${path}`, {
    ...init,
    cache: "no-store",
    headers: { ...init.headers, AccessKey: config.key },
  });
}

export function mediaPath(url: string) {
  const parsed = new URL(url);
  const { cdn } = storageConfig();
  if (
    parsed.origin !== `https://${cdn}` ||
    !/^\/notepad-images\/[a-zA-Z0-9._-]+$/.test(parsed.pathname)
  )
    throw new Error("Invalid media location.");
  return parsed.pathname.slice(1);
}
