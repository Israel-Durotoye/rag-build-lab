import assert from "node:assert/strict";
import { test } from "node:test";
import { titleCase } from "../lib/text";

test("all-caps names become title case; mixed-case names are left alone", () => {
  assert.equal(
    titleCase("FEDERAL UNIVERSITY OF TECHNOLOGY, MINNA, NIGERIA"),
    "Federal University of Technology, Minna, Nigeria",
  );
  assert.equal(
    titleCase("Department of Mechatronics"),
    "Department of Mechatronics",
  );
  assert.equal(titleCase("FUT"), "FUT");
  assert.equal(titleCase("OF THE PEOPLE"), "Of the People");
});
