# Noted — Realtime Notepad

A responsive notebook with separate note tabs, a shared photo/video gallery, and realtime sync through Supabase.

## Run locally

```sh
npm install
npm run dev
```

The existing `.env.local` needs these variables (do not commit its values):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_NOTEPAD_PASSWORD` (existing client-side notebook gate)
- `BUNNY_STORAGE_KEY`
- `BUNNY_STORAGE_ZONE`
- `BUNNY_CDN_HOST`
- `BUNNY_STORAGE_REGION` (optional; empty for the default region)

## Notes and compatibility

No new database columns or storage provider are required. The existing `notes` table uses `id`, `content`, and `updated_at`; `images` continues storing both photos and videos using `id`, `url`, `filename`, and `created_at`. Supabase policies must allow reading and writing multiple note IDs, and both tables should be enabled in the realtime publication. The original note remains under `main`. New notes use UUIDs. The first non-empty line supplies each tab's title; the entire original note remains plain text.

The editor uses a native visible textarea. Clickable links are available in **Read** mode and in the expandable links list. Saves are serialized per note and own realtime echoes are ignored. Remote edits never replace a focused editor; a choice appears to load the update or keep the local version. Loading an update preserves an unsaved local version as a separate note. Pending drafts are recovered from local storage after reload. This is a shared notebook with conflict choices, not character-level collaborative editing.

## Media

- Upload multiple photos or videos, up to 100 MB per file, keeping the original bytes.
- Filter by photo/video, search by filename, preview, or download individual files.
- Use **Select**, choose files (or select all shown), then **Download ZIP** to download up to 100 items together. Duplicate filenames receive suffixes in the archive.
- MP4/WebM with a browser-supported codec are the most portable preview formats. Other video formats and HEIC/HEIF can be stored and downloaded; preview depends on the device's codec support. No transcoding is performed.

Uploads use signed sessions and 3 MB chunks, staged in the existing Bunny storage zone, then streamed into the final original file. This avoids putting an entire video through [Vercel's function request-body limit](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions). Storage requests follow the [Bunny Storage HTTP API](https://bunny.net/docs/storage/http). The storage key stays on the server. Successful uploads remove their temporary parts; failed uploads before finalization are cleaned up by the client when reachable. Abandoned parts older than two hours are swept in bounded batches when another upload starts. Upload and download functions allow up to 300 seconds, subject to the hosting plan's limits.

Downloads use a same-origin streaming route so cross-origin download/CORS behavior does not block saving. ZIP generation streams files from the configured storage zone and only accepts existing media IDs. The browser receives the finished download as a blob, so particularly large selections depend on available device memory; download smaller batches on constrained phones.

## Verification

```sh
npm run typecheck
npm run build
npm test
```

The browser suite uses installed Google Chrome, includes desktop and phone viewport tests, and intercepts database/media requests with fixtures. Server tests mock Bunny and Supabase and verify file bytes, ZIP contents, session validation, and failure handling. Normal tests do not change production notes or upload fixture files to your storage. They do not emulate a physical iPhone keyboard or verify live hosting credentials. The separately gated `live-storage.spec.ts` runs only with `VERIFY_LIVE_STORAGE=1`; it uploads disposable synthetic bytes to Bunny, verifies them, and removes them, while mocking database writes so they never appear in the gallery.

To test another installed browser, change `channel` in `playwright.config.ts`. Run `npm run format` to format source and tests.
