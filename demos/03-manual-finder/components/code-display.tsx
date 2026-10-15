import { flashPattern } from "@/lib/text";
import type { CodeScheme } from "@/lib/types";

/**
 * A code drawn like a device's own display: a dim LCD with a dot-matrix
 * face. An LED flash pattern is drawn as its blinks, long flashes as bars
 * and short ones as dots.
 */
export function CodeDisplay({
  code,
  display,
  scheme,
  size = "large",
  missing = false,
}: {
  code: string;
  display: string;
  scheme: CodeScheme;
  size?: "large" | "small";
  missing?: boolean;
}) {
  const flash = scheme === "flash" ? flashPattern(code) : null;
  const className = `lcd${size === "small" ? " small" : ""}${missing ? " missing" : ""}`;
  if (flash)
    return (
      <span className={className} aria-label={display} title={display}>
        <span className="blinks" aria-hidden>
          {Array.from({ length: flash.long }, (_, i) => (
            <i key={`l${i}`} className="long" />
          ))}
          {flash.long > 0 && flash.short > 0 && <i className="gap" />}
          {Array.from({ length: flash.short }, (_, i) => (
            <i key={`s${i}`} />
          ))}
        </span>
      </span>
    );
  return (
    <span className={className} title={display}>
      {display}
    </span>
  );
}
