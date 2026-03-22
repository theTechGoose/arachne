import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { Consumer } from "./mod.ts";

Deno.test("Consumer class is exported", () => {
  assertEquals(typeof Consumer, "function");
});

Deno.test("Consumer exposes toJSON", () => {
  assertEquals(typeof Consumer.prototype.toJSON, "function");
});
