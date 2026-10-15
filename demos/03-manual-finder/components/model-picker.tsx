"use client";

import {
  Check,
  ChevronDown,
  CircleHelp,
  Microchip,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LibraryModel } from "@/lib/types";
import { useFinder } from "./finder-provider";

function matches(model: LibraryModel, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [model.name, model.short, ...model.aliases].some((name) =>
    name.toLowerCase().includes(q),
  );
}

/**
 * "Working on": the model (and revision) every search is filtered to. It is
 * global, remembered per browser, and opened with the "m" key.
 */
export function ModelPicker() {
  const { selection, pickerOpen, setPickerOpen, modelById } = useFinder();
  const button = useRef<HTMLButtonElement>(null);
  const model = modelById(selection.model);
  const revision = model?.revisions.find((r) => r.id === selection.revision);

  return (
    <div className="picker">
      <button
        ref={button}
        type="button"
        className={`picker-button${model ? " chosen" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
        onClick={() => setPickerOpen(!pickerOpen)}
        title="Choose the model you are working on (m)"
      >
        <Microchip size={17} aria-hidden />
        <span className="picker-label">Working on</span>
        <span className="picker-value">
          {model ? model.name : "Choose a model"}
          {revision && <span className="picker-rev"> · {revision.label}</span>}
        </span>
        <ChevronDown size={16} aria-hidden />
      </button>
      {pickerOpen && <PickerPanel button={button} />}
    </div>
  );
}

function focusBack(opener: HTMLElement | null, fallback: HTMLElement | null) {
  (opener?.isConnected ? opener : fallback)?.focus();
}

/** The open picker. It mounts on each opening, so its filter starts empty. */
function PickerPanel({
  button,
}: {
  button: React.RefObject<HTMLButtonElement | null>;
}) {
  const { library, selection, setSelection, setPickerOpen } = useFinder();
  const [query, setQuery] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // Whatever opened the picker (the top bar, Search's "Change", Chat's model
  // button) gets focus back when it closes.
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const active = document.activeElement;
    opener.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
    input.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPickerOpen(false);
        focusBack(opener.current, button.current);
      }
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target))
        setPickerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [button, setPickerOpen]);

  const groups = useMemo(() => {
    if (!library) return [];
    const found = library.models.filter((m) => matches(m, query));
    const families = library.families
      .map((family) => ({
        id: family.id,
        name: family.name,
        models: found.filter((m) => m.family === family.id),
      }))
      .filter((g) => g.models.length);
    const loose = found.filter(
      (m) => !m.family || !library.families.some((f) => f.id === m.family),
    );
    return loose.length
      ? [...families, { id: "_other", name: "Other models", models: loose }]
      : families;
  }, [library, query]);

  const choose = (id: string | null, revisionId: string | null = null) => {
    setSelection({ model: id, revision: revisionId });
    setPickerOpen(false);
    focusBack(opener.current, button.current);
  };

  return (
    <div
      ref={panel}
      className="popover picker-panel"
      role="dialog"
      aria-label="Choose a model"
    >
      <label className="field picker-search">
        <Search size={16} aria-hidden />
        <input
          ref={input}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type a model name or short code"
          aria-label="Filter models"
        />
      </label>
      {!library || library.models.length === 0 ? (
        <p className="muted small picker-empty">
          No models yet. Add the sample library or a manual on the{" "}
          <Link href="/library" onClick={() => setPickerOpen(false)}>
            Library
          </Link>{" "}
          page.
        </p>
      ) : (
        <div className="picker-groups">
          {groups.map((group) => (
            <section key={group.id} aria-label={group.name}>
              <h3 className="eyebrow">{group.name}</h3>
              <ul>
                {group.models.map((m) => {
                  const current = m.id === selection.model;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        className="picker-model"
                        aria-pressed={current && !selection.revision}
                        onClick={() => choose(m.id)}
                      >
                        <span className="picker-short mono">{m.short}</span>
                        <span>
                          <strong>{m.name}</strong>
                          <small className="muted">
                            {m.units} passages · {m.codes} codes
                          </small>
                        </span>
                        {current && !selection.revision && (
                          <Check size={16} aria-hidden />
                        )}
                      </button>
                      {m.revisions.length > 0 && (
                        <div
                          className="picker-revisions"
                          role="group"
                          aria-label={`${m.name} revisions`}
                        >
                          <span className="faint small">Revision</span>
                          {m.revisions.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              className="chip tiny"
                              aria-pressed={
                                current && selection.revision === r.id
                              }
                              onClick={() => choose(m.id, r.id)}
                            >
                              {r.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {groups.length === 0 && (
            <p className="muted small picker-empty">
              No model matches “{query}”.
            </p>
          )}
        </div>
      )}
      <div className="picker-foot">
        <Link
          href="/models"
          className="btn quiet small"
          onClick={() => setPickerOpen(false)}
        >
          <CircleHelp size={15} aria-hidden /> Which model do I have?
        </Link>
        {selection.model && (
          <button
            type="button"
            className="btn quiet small"
            onClick={() => choose(null)}
          >
            <X size={15} aria-hidden /> Clear
          </button>
        )}
      </div>
    </div>
  );
}
