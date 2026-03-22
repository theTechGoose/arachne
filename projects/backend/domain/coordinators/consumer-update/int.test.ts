import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { updateConsumer } from "./mod.ts";

Deno.test("updateConsumer throws on empty name", async () => {
  const svc = { get: async () => null, update: async () => {} } as any;
  await assertRejects(() => updateConsumer(svc, "", {}), Error, "name is required");
});

Deno.test("updateConsumer throws 404 when not found", async () => {
  const svc = { get: async () => null, update: async () => {} } as any;
  try { await updateConsumer(svc, "missing", {}); } catch (e: any) { assertEquals(e.statusCode, 404); }
});

Deno.test("updateConsumer throws 400 when renaming", async () => {
  const existing = { name: "orig" };
  const svc = { get: async () => existing, update: async () => {} } as any;
  try { await updateConsumer(svc, "orig", { name: "renamed" }); } catch (e: any) { assertEquals(e.statusCode, 400); }
});
