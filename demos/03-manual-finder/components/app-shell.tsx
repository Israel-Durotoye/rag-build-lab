"use client";

import {
  Ellipsis,
  FlaskConical,
  Hash,
  Library,
  ListChecks,
  MessagesSquare,
  Microchip,
  ScanEye,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { shortcutsStore } from "@/lib/shortcuts";
import { useFinder } from "./finder-provider";
import { ModelPicker } from "./model-picker";
import { ThemeToggle } from "./theme-toggle";

// On a phone the dock keeps the first four and puts the rest under "More".
const NAV = [
  { href: "/", label: "Search", icon: Search, more: false },
  { href: "/chat", label: "Chat", icon: MessagesSquare, more: false },
  { href: "/codes", label: "Codes", icon: Hash, more: false },
  { href: "/models", label: "Models", icon: Microchip, more: false },
  { href: "/lab", label: "Lab", icon: FlaskConical, more: true },
  { href: "/evaluate", label: "Evaluate", icon: ListChecks, more: true },
  { href: "/library", label: "Library", icon: Library, more: true },
  { href: "/inspect", label: "Inspect", icon: ScanEye, more: true },
  { href: "/settings", label: "Settings", icon: SlidersHorizontal, more: true },
] as const;

export const SEARCH_INPUT_ID = "finder-search";

function isCurrent(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** The phone dock's "More": the pages that don't fit, and the credit. */
function MoreMenu({ pathname, busy }: { pathname: string; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const sheetId = useId();
  const items = NAV.filter((item) => item.more);
  const current = items.some((item) => isCurrent(item.href, pathname));

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!sheet.current?.contains(target) && !button.current?.contains(target))
        setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div className="dock-more">
      <button
        ref={button}
        type="button"
        className="dock-link"
        aria-expanded={open}
        aria-controls={sheetId}
        data-current={current || undefined}
        data-busy={busy || undefined}
        onClick={() => setOpen(!open)}
      >
        <Ellipsis size={20} aria-hidden />
        <span>More</span>
      </button>
      <div
        ref={sheet}
        id={sheetId}
        className="popover dock-sheet"
        hidden={!open}
      >
        <ul>
          {items.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={isCurrent(href, pathname) ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                <Icon size={18} aria-hidden />
                {label}
              </Link>
            </li>
          ))}
        </ul>
        <p className="credit">Built by Israel Durotoye</p>
      </div>
    </div>
  );
}

function StatusPill() {
  const { health } = useFinder();
  if (!health)
    return (
      <p className="status bad" title="The Python backend isn't reachable">
        <i aria-hidden /> Offline
      </p>
    );
  if (!health.generation)
    return (
      <p
        className="status warn"
        title="No model key is configured: answers quote the manual's own sentences"
      >
        <i aria-hidden /> Search only
      </p>
    );
  return (
    <p className="status" title={`${health.model} via ${health.provider}`}>
      <i aria-hidden /> Ready
    </p>
  );
}

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { streaming, upload, setPickerOpen } = useFinder();
  const shortcuts = useSyncExternalStore(
    shortcutsStore.subscribe,
    shortcutsStore.get,
    shortcutsStore.getServer,
  );

  // "/" jumps to the search box, "m" opens the model picker (unless they
  // are turned off in Settings).
  useEffect(() => {
    if (!shortcuts) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        typing(event.target)
      )
        return;
      if (event.key === "/") {
        event.preventDefault();
        const input = document.getElementById(SEARCH_INPUT_ID);
        if (input) input.focus();
        else router.push("/?focus=1");
      } else if (event.key === "m") {
        event.preventDefault();
        setPickerOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, setPickerOpen, shortcuts]);

  return (
    <div className="shell">
      <Link href="/" className="brand" aria-label="Finder home">
        <span className="lens" aria-hidden />
      </Link>
      <header className="topbar">
        <Link href="/" className="wordmark" aria-label="Finder home">
          <span className="wordmark-text">Finder</span>
        </Link>
        <ModelPicker />
        <span className="topbar-spacer" />
        <StatusPill />
        <ThemeToggle />
      </header>
      <nav className="dock" aria-label="Main">
        {NAV.map(({ href, label, icon: Icon, more }) => {
          const busy =
            ((href === "/" || href === "/chat") && streaming) ||
            (href === "/library" && !!upload);
          return (
            <Link
              key={href}
              href={href}
              className="dock-link"
              aria-current={isCurrent(href, pathname) ? "page" : undefined}
              data-busy={busy || undefined}
              data-more={more || undefined}
            >
              <Icon size={20} aria-hidden />
              <span>{label}</span>
            </Link>
          );
        })}
        <MoreMenu pathname={pathname} busy={!!upload} />
        <div className="dock-foot">
          <p className="credit">
            Built by
            <br />
            Israel Durotoye
          </p>
        </div>
      </nav>
      <main className="main">
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
