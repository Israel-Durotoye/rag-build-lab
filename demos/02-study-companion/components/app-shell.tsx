"use client";

import {
  BookOpenText,
  FlaskConical,
  GraduationCap,
  House,
  Layers,
  MessagesSquare,
  NotebookPen,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useStudy } from "./study-provider";

const NAV = [
  { href: "/", label: "Home", icon: House },
  { href: "/ask", label: "Ask", icon: MessagesSquare },
  { href: "/compare", label: "Compare", icon: FlaskConical },
  { href: "/practice", label: "Practise", icon: GraduationCap },
  { href: "/notes", label: "Notes", icon: BookOpenText },
  { href: "/how-it-works", label: "How it works", icon: Layers },
  { href: "/settings", label: "Settings", icon: SlidersHorizontal },
] as const;

const PIPELINE_PATHS = [
  "/how-it-works",
  "/retrieval",
  "/context",
  "/generation",
];

function StatusBadge() {
  const { health } = useStudy();
  if (!health)
    return (
      <p
        className="status status-bad"
        title="The Python backend isn't reachable"
      >
        <i aria-hidden /> <span>Offline</span>
        <small>The backend isn&rsquo;t reachable</small>
      </p>
    );
  if (!health.generation)
    return (
      <p className="status status-warn" title="No model key is configured">
        <i aria-hidden /> <span>Search only</span>
        <small>Shows your notes&rsquo; own sentences</small>
      </p>
    );
  return (
    <p className="status" title={`${health.model} via ${health.provider}`}>
      <i aria-hidden /> <span>Ready</span>
      <small>{health.model}</small>
    </p>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { streaming, upload } = useStudy();
  return (
    <div className="shell">
      <aside className="side">
        <Link href="/" className="brand" aria-label="Study Companion home">
          <span className="brand-mark" aria-hidden>
            <NotebookPen size={19} />
          </span>
          <span className="brand-text">
            <strong>Study Companion</strong>
            <small>Your notes, explained</small>
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
              (href === "/ask" && streaming) || (href === "/notes" && !!upload);
            return (
              <Link
                key={href}
                href={href}
                className="nav-link"
                aria-current={active ? "page" : undefined}
                data-busy={busy || undefined}
              >
                <Icon size={17} aria-hidden />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="side-foot">
          <StatusBadge />
          <p className="credit">
            Built by Israel Durotoye
            <br />
            <a href="mailto:durotoyeoluwaseunisreal@gmail.com">
              durotoyeoluwaseunisreal@gmail.com
            </a>
          </p>
        </div>
      </aside>
      <main className="page">{children}</main>
    </div>
  );
}
