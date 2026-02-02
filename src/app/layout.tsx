import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Realtime Notepad",
  description: "A real-time synced notepad across devices",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="h-full bg-black text-[#ededed]">{children}</body>
    </html>
  );
}
