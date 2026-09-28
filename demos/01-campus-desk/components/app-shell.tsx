"use client";

import {
  BookOpen,
  GraduationCap,
  Home,
  MessageCircle,
  Settings,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useRag } from "./rag-provider";
import { titleCase } from "./ui";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/ask", label: "Ask", icon: MessageCircle },
  { href: "/library", label: "Library", icon: BookOpen },
  { href: "/how-it-works", label: "How it works", icon: Workflow },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

const PIPELINE_PATHS = [
  "/how-it-works",
  "/retrieval",
  "/augmentation",
  "/generation",
];

function StatusBadge() {
  const { health } = useRag();
  if (!health)
    return (
      <span
        className="status status-bad"
        title="The Python backend isn't reachable"
      >
        <i /> Offline
      </span>
    );
  if (!health.generation)
    return (
      <span className="status status-warn" title="No model key is configured">
        <i /> Search only
      </span>
    );
  return (
    <span className="status" title={`${health.model} via ${health.provider}`}>
      <i /> Ready
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { profile, streaming, upload } = useRag();
  const name = profile?.institution
    ? titleCase(profile.institution)
    : "Campus Guide";
  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="Campus Guide home">
          <span className="brand-mark" aria-hidden>
            <GraduationCap size={19} />
          </span>
          <span className="brand-text">
            <strong>Campus Guide</strong>
            {profile?.institution && <small>{name}</small>}
          </span>
        </Link>
        <nav className="nav" aria-label="Main">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/"
                ? pathname === "/"
                : href === "/how-it-works"
                  ? PIPELINE_PATHS.some((p) => pathname.startsWith(p))
                  : pathname.startsWith(href);
            const busy =
              (href === "/ask" && streaming) ||
              (href === "/library" && !!upload);
            return (
              <Link
                key={href}
                href={href}
                className="nav-link"
                aria-current={active ? "page" : undefined}
                data-busy={busy || undefined}
              >
                <Icon size={16} aria-hidden />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <StatusBadge />
      </header>
      <main className="page">{children}</main>
      <footer className="footer">
        <span className="footer-brand">
          <GraduationCap size={15} aria-hidden /> Campus Guide
          <span className="footer-by">Built by Israel Durotoye</span>
        </span>
        <span className="footer-contact">
          <a href="tel:+2349069080731">+234 906 908 0731</a>
          <span aria-hidden>·</span>
          <a href="mailto:durotoyeoluwaseunisreal@gmail.com">
            durotoyeoluwaseunisreal@gmail.com
          </a>
        </span>
      </footer>
    </div>
  );
}
