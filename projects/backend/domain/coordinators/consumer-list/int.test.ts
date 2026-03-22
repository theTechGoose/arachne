import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { listConsumers } from "./mod.ts";

Deno.test("listConsumers returns array from service", async () => {
  const svc = { getAll: async () => [{ name: "a" }, { name: "b" }] } as any;
  const result = await listConsumers(svc);
  assertEquals(result.length, 2);
});
