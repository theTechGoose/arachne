import { assertEquals } from "jsr:@std/assert";
import { PathValidatorCoordinator } from "./mod.ts";

import one from "../validator/examples/one.json" with { type: "json" };
import two from "../validator/examples/two.json" with { type: "json" };
import three from "../validator/examples/three.json" with { type: "json" };

function validate(path: string): boolean {
  try {
    new PathValidatorCoordinator().validate(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test("fails when recordingId is missing", () => {
  const result = validate(one.value);
  assertEquals(result, one.expected);
});

Deno.test("passes when type, provider, and recordingId are all present", () => {
  const result = validate(two.value);
  assertEquals(result, two.expected);
});

Deno.test("fails when provider is missing", () => {
  const result = validate(three.value);
  assertEquals(result, three.expected);
});
