import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

// Self-hosted at build time by next/font: no runtime requests, no layout shift.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Campus Desk — Your handbook, at hand",
  description:
    "Search the FUT Minna Mechatronics Engineering students' handbook — or add your own school's — with original passages and clear sources.",
};

export const viewport: Viewport = {
  themeColor: "#f7f6ef",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>{children}</body>
    </html>
  );
}
