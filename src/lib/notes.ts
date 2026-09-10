export interface NoteRecord {
  id: string;
  content: string;
  updated_at: string;
}

export type SyncState = "saved" | "typing" | "saving" | "error";
export interface Note extends NoteRecord {
  sync: SyncState;
}

export function noteTitle(content: string) {
  return (
    content
      .split("\n")
      .find((line) => line.trim())
      ?.trim()
      .slice(0, 70) || "Untitled note"
  );
}

export function noteExcerpt(content: string) {
  return (
    content.trim().split("\n").slice(1).join(" ").trim().slice(0, 100) ||
    "A little space for your next idea."
  );
}

export function extractLinks(text: string) {
  const links: { text: string; href: string; index: number }[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>]+|www\.[^\s<>]+/gi)) {
    let value = match[0];
    while (/[.,;:!?'"\])}]$/.test(value)) {
      const closing = value.at(-1)!;
      const opening = (
        { ")": "(", "]": "[", "}": "{" } as Record<string, string>
      )[closing];
      if (opening && value.split(opening).length >= value.split(closing).length)
        break;
      value = value.slice(0, -1);
    }
    const href = /^www\./i.test(value) ? `https://${value}` : value;
    try {
      const url = new URL(href);
      if (["http:", "https:"].includes(url.protocol))
        links.push({ text: value, href, index: match.index! });
    } catch {
      /* Incomplete URLs remain ordinary text. */
    }
  }
  return links;
}

export function displayDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Just now"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
