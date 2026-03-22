import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resumeConsumer } from "./mod.ts";

Deno.test("resumeConsumer throws on empty name", async () => {
  const svc = { get: async () => null, resume: async () => {} } as any;
  await assertRejects(() => resumeConsumer(svc, ""), Error, "name is required");
});

Deno.test("resumeConsumer throws 404 when not found", async () => {
  const svc = { get: async () => null, resume: async () => {} } as any;
  try { await resumeConsumer(svc, "missing"); } catch (e: any) { assertEquals(e.statusCode, 404); }
});
