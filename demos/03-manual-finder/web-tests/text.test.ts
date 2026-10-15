import assert from "node:assert/strict";
import { test } from "node:test";
import { unitApplies } from "../lib/applies";
import { flashPattern, highlight, plural, stem, tableCells } from "../lib/text";

test("a table-row passage is read as its header and its rows", () => {
  const header = "Pin | RA4M1 | Timer";
  assert.deepEqual(tableCells(`${header}\nD13 | P102 | GTIOC2B`, header), {
    header: ["Pin", "RA4M1", "Timer"],
    rows: [["D13", "P102", "GTIOC2B"]],
  });
  // Rows that continue the one above (a spanned cell) stay rows of their own.
  assert.equal(
    tableCells(`${header}\nD5 | P102 | GTIOC2B\n |  | x`, header)?.rows.length,
    2,
  );
  assert.equal(tableCells("A paragraph.", null), null);
});

test("blank cells at either edge of a header survive and the header is not repeated", () => {
  // The Raspberry Pi power table has two unlabelled leading columns.
  const header = " |  | Raspberry Pi 2B | Raspberry Pi 3B";
  const table = tableCells(`${header}\nBoot | Max | 0.40 | 0.75`, header)!;
  assert.deepEqual(table.header, [
    "",
    "",
    "Raspberry Pi 2B",
    "Raspberry Pi 3B",
  ]);
  assert.deepEqual(table.rows, [["Boot", "Max", "0.40", "0.75"]]);
});

test("matched terms are marked as whole words, longest first", () => {
  const marked = highlight("Port P102 is D13 on this board.", ["p102", "d13"])
    .filter((s) => s.hit)
    .map((s) => s.text);
  assert.deepEqual(marked, ["P102", "D13"]);
  // A term inside another word is not a match.
  assert.deepEqual(
    highlight("supported", ["port"]).filter((s) => s.hit),
    [],
  );
  // Stemmed terms mark the word they came from.
  assert.deepEqual(
    highlight("It boots from USB", ["boot"])
      .filter((s) => s.hit)
      .map((s) => s.text),
    ["boots"],
  );
});

test("an LED flash code is read as its long and short blinks", () => {
  assert.deepEqual(flashPattern("FLASH:L4S4"), { long: 4, short: 4 });
  assert.deepEqual(flashPattern("FLASH:L0S3"), { long: 0, short: 3 });
  assert.equal(flashPattern("P102"), null);
  assert.equal(plural(1, "passage"), "1 passage");
  assert.equal(plural(1018, "passage"), "1,018 passages");
});

test("a passage applies to a model exactly as the backend decides", () => {
  const models = ["rpi-2b", "rpi-3b", "rpi-3b-plus"];
  const shared = { models: null, revisions: {} };
  const otp = {
    models: ["rpi-2b", "rpi-3b"],
    revisions: { "rpi-2b": ["v1-2"] },
  };
  // Shared: every model of the manual, no other.
  assert.equal(unitApplies(shared, models, "rpi-3b-plus"), true);
  assert.equal(unitApplies(shared, models, "uno-r3"), false);
  // A manual that lists no models applies to every model.
  assert.equal(unitApplies(shared, [], "uno-r3"), true);
  // Its own models only, and a revision narrows it where it lists revisions.
  assert.equal(unitApplies(otp, models, "rpi-3b-plus"), false);
  assert.equal(unitApplies(otp, models, "rpi-2b"), true);
  assert.equal(unitApplies(otp, models, "rpi-2b", "v1-2"), true);
  assert.equal(unitApplies(otp, models, "rpi-2b", "v1-1"), false);
  // A revision of a model the passage does not narrow changes nothing.
  assert.equal(unitApplies(otp, models, "rpi-3b", "bcm2837b0"), true);
});

test("highlighting follows the stems the keyword index matches", () => {
  const hits = (text: string, terms: string[]) =>
    highlight(text, terms)
      .filter((s) => s.hit)
      .map((s) => s.text);
  assert.deepEqual(
    hits("Four long flashes on the LED, then each flash repeats.", [
      "flashing",
      "leds",
    ]),
    ["flashes", "LED", "flash"],
  );
  assert.deepEqual(
    hits("Which power supplies? Any supply will do.", ["supply"]),
    ["supplies", "supply"],
  );
  // A short term is a whole word (or its plural), not a prefix.
  assert.deepEqual(hits("The Pi pinout: pick the Pis you need.", ["pi"]), [
    "Pi",
    "Pis",
  ]);
  assert.equal(stem("status"), "statu");
  assert.equal(stem("address"), "address");
});
