import type { Metadata, Viewport } from "next";
import { Fraunces, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { StudyProvider } from "@/components/study-provider";
import { API_VERSION_HEADER, isCompatibleHealth } from "@/lib/contract";
import type { Health } from "@/lib/types";
import "./globals.css";

// Self-hosted at build time by next/font: no runtime requests, no layout shift.
const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const display = Fraunces({
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
  variable: "--font-display",
  display: "swap",
});

// Capabilities come from the Python backend on each request; its model key
// never reaches the browser.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Study Companion",
  description:
    "Ask about your own notes and get an explanation, the exact sections behind it and the original text. Compare chunking strategies and practise with quizzes and flashcards.",
};

export const viewport: Viewport = {
  themeColor: "#f4f2fb",
};

async function backendHealth(): Promise<Health | null> {
  const apiUrl = (process.env.STUDY_API_URL || "http://127.0.0.1:8001").replace(
    /\/$/,
    "",
  );
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
      className={`${sans.variable} ${mono.variable} ${display.variable}`}
    >
      <body>
        <StudyProvider initialHealth={health}>
          <AppShell>{children}</AppShell>
        </StudyProvider>
      </body>
    </html>
  );
}
