import type { Metadata, Viewport } from "next";
import { Doto, IBM_Plex_Mono, Manrope } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { FinderProvider } from "@/components/finder-provider";
import { API_VERSION_HEADER, isCompatibleHealth } from "@/lib/contract";
import { THEME_SCRIPT } from "@/lib/theme";
import type { Health } from "@/lib/types";
import "./globals.css";

// Self-hosted at build time by next/font: no runtime requests, no layout shift.
const sans = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

// A dot-matrix face for fault codes, like a device's own display.
const dot = Doto({
  subsets: ["latin"],
  variable: "--font-dot",
  display: "swap",
});

// Capabilities come from the Python backend on each request; its model key
// never reaches the browser.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Finder",
  description:
    "The exact passage for the exact model. Search device manuals by fault code or symptom, filtered to the model in front of you, with every answer cited.",
};

export const viewport: Viewport = {
  themeColor: "#1f2228",
};

async function backendHealth(): Promise<Health | null> {
  const apiUrl = (
    process.env.MANUAL_API_URL || "http://127.0.0.1:8002"
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
      data-theme="dark"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable} ${dot.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <FinderProvider initialHealth={health}>
          <AppShell>{children}</AppShell>
        </FinderProvider>
      </body>
    </html>
  );
}
