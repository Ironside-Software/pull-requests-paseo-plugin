import assert from "node:assert/strict";
import { test } from "node:test";
import { labelColors } from "../client/label-color";

test("GitHub label colors keep readable text on dark and light backgrounds", () => {
  assert.deepEqual(labelColors("b60205"), { backgroundColor: "#b60205", color: "#ffffff" });
  assert.deepEqual(labelColors("a2eeef"), { backgroundColor: "#a2eeef", color: "#000000" });
});
