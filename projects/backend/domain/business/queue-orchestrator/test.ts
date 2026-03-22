import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { QueueOrchestrator } from "./mod.ts";

Deno.test("QueueOrchestrator class is exported", () => {
  assertEquals(typeof QueueOrchestrator, "function");
});
