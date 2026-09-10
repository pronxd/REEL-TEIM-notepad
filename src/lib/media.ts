export interface MediaRecord {
  id: string;
  url: string;
  filename: string;
  created_at: string;
}

export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
export const UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;
export const MEDIA_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  m4v: "video/x-m4v",
  ogv: "video/ogg",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  "3gp": "video/3gpp",
};

export function mediaExtension(name: string) {
  return name.split(".").pop()?.toLowerCase() || "";
}
export function isVideo(media: MediaRecord) {
  return (
    MEDIA_TYPES[mediaExtension(media.filename)] ||
    MEDIA_TYPES[mediaExtension(media.url.split("?")[0])] ||
    ""
  ).startsWith("video/");
}
export function safeFilename(name: string) {
  return (
    name
      .replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "_")
      .replace(/^\.+/, "")
      .trim()
      .slice(0, 180) || "download"
  );
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeFilename(filename);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function responseData(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || "The upload failed. Please try again.");
  return data;
}

export async function uploadMedia(
  file: File,
  onProgress: (value: number) => void,
): Promise<MediaRecord> {
  if (!MEDIA_TYPES[mediaExtension(file.name)])
    throw new Error("Choose a photo or video in a supported format.");
  if (file.size === 0) throw new Error("This file is empty.");
  if (file.size > MAX_MEDIA_BYTES)
    throw new Error("Files can be up to 100 MB each.");
  const session = await responseData(
    await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, size: file.size }),
    }),
  );
  let finalizing = false;
  try {
    for (let index = 0; index < session.chunks; index++) {
      const chunk = file.slice(
        index * session.chunkSize,
        (index + 1) * session.chunkSize,
      );
      for (let attempt = 0; ; attempt++) {
        try {
          await responseData(
            await fetch(`/api/upload?index=${index}`, {
              method: "PUT",
              headers: {
                "Content-Type": "application/octet-stream",
                "X-Upload-Token": session.token,
              },
              body: chunk,
            }),
          );
          break;
        } catch (error) {
          if (attempt === 2) throw error;
          await new Promise((resolve) =>
            setTimeout(resolve, (attempt + 1) * 1000),
          );
        }
      }
      onProgress(Math.round(((index + 1) / session.chunks) * 90));
    }
    finalizing = true;
    const result = await responseData(
      await fetch("/api/upload", {
        method: "PATCH",
        headers: { "X-Upload-Token": session.token },
      }),
    );
    onProgress(100);
    return result.image;
  } catch (error) {
    // A lost final response may still be saving on the server; do not erase its parts.
    if (!finalizing)
      await fetch("/api/upload", {
        method: "DELETE",
        headers: { "X-Upload-Token": session.token },
      }).catch(() => {});
    throw error;
  }
}
