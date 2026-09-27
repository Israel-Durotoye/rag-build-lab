import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Campus Desk — Your handbook, at hand",
  description:
    "Find your way through a fictional campus handbook, with original passages and clear sources.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
