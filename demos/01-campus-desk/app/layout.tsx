import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { RagProvider } from "@/components/rag-provider";
import { API_VERSION_HEADER, isCompatibleHealth } from "@/lib/contract";
import type { Health } from "@/lib/types";
import "./globals.css";

// Self-hosted at build time by next/font: no runtime requests, no layout shift.
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
  variable: "--font-display",
  display: "swap",
});

// Capabilities come from the Python backend on each request; its model key
// never reaches the browser.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Campus Guide",
  description:
    "Your school's documents, answered. Ask questions and get short, cited answers from the handbooks and guides your school provides.",
};

export const viewport: Viewport = {
  themeColor: "#f6f5ee",
};

async function backendHealth(): Promise<Health | null> {
  const apiUrl = (
    process.env.CAMPUS_API_URL || "http://127.0.0.1:8000"
  ).replace(/\/$/, "");
  // A hosted backend's edge sometimes answers 502 without reaching it; one
  // quick second attempt covers that. A timeout is not retried: the page
  // renders and the browser keeps checking.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${apiUrl}/api/status`, {
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) {
        if (response.headers.get(API_VERSION_HEADER) === null) continue;
        return null;
      }
      const health: unknown = await response.json();
      return isCompatibleHealth(health) ? health : null;
    } catch {
      return null;
    }
  }
  return null;
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const health = await backendHealth();
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable} ${bricolage.variable}`}
    >
      <body>
        <RagProvider initialHealth={health}>
          <AppShell>{children}</AppShell>
        </RagProvider>
      </body>
    </html>
  );
}
