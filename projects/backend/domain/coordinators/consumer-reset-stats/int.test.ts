import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resetConsumerStats } from "./mod.ts";

Deno.test("resetConsumerStats throws on empty name", async () => {
  const svc = { get: async () => null, clear: async () => {} } as any;
  await assertRejects(() => resetConsumerStats(svc, ""), Error, "name is required");
});

Deno.test("resetConsumerStats throws 404 when not found", async () => {
  const svc = { get: async () => null, clear: async () => {} } as any;
  try { await resetConsumerStats(svc, "missing"); } catch (e: any) { assertEquals(e.statusCode, 404); }
});
