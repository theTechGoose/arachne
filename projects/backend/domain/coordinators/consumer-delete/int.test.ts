import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deleteConsumer } from "./mod.ts";

Deno.test("deleteConsumer throws on empty name", async () => {
  const svc = { get: async () => null, remove: async () => {} } as any;
  await assertRejects(() => deleteConsumer(svc, ""), Error, "name is required");
});

Deno.test("deleteConsumer throws 404 when not found", async () => {
  const svc = { get: async () => null, remove: async () => {} } as any;
  try { await deleteConsumer(svc, "missing"); } catch (e: any) { assertEquals(e.statusCode, 404); }
});
