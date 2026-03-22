import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pauseConsumer } from "./mod.ts";

Deno.test("pauseConsumer throws on empty name", async () => {
  const svc = { get: async () => null, pause: async () => {} } as any;
  await assertRejects(() => pauseConsumer(svc, ""), Error, "name is required");
});

Deno.test("pauseConsumer throws 404 when not found", async () => {
  const svc = { get: async () => null, pause: async () => {} } as any;
  try { await pauseConsumer(svc, "missing"); } catch (e: any) { assertEquals(e.statusCode, 404); }
});
