import { assertEquals } from "jsr:@std/assert";
import { HealthController } from "./health-controller.ts";

Deno.test("HealthController returns 200 with ok status", async () => {
  const controller = new HealthController({
    check: () => Promise.resolve({ status: "ok" as const, redis: true, workers: 3 }),
  });

  const req = new Request("http://localhost/health");
  const res = await controller.handle(req);
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body, { status: "ok", redis: true, workers: 3 });
});

Deno.test("HealthController returns 503 with degraded status", async () => {
  const controller = new HealthController({
    check: () => Promise.resolve({ status: "degraded" as const, redis: false, workers: 0 }),
  });

  const req = new Request("http://localhost/health");
  const res = await controller.handle(req);
  const body = await res.json();

  assertEquals(res.status, 503);
  assertEquals(body, { status: "degraded", redis: false, workers: 0 });
});
