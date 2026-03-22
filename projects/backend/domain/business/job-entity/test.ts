import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { Job } from "./mod.ts";

Deno.test("Job class is exported", () => {
  assertEquals(typeof Job, "function");
});

Deno.test("Job exposes toJSON", () => {
  assertEquals(typeof Job.prototype.toJSON, "function");
});
