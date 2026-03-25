import { assertEquals } from "jsr:@std/assert";
import { HealthCheck } from "./mod.ts";

Deno.test("HealthCheck returns ok when ping succeeds", async () => {
  const checker = new HealthCheck({
    ping: () => Promise.resolve(true),
    workerCount: () => 3,
  });

  const result = await checker.check();

  assertEquals(result, { status: "ok", redis: true, workers: 3 });
});

Deno.test("HealthCheck returns degraded when ping returns false", async () => {
  const checker = new HealthCheck({
    ping: () => Promise.resolve(false),
    workerCount: () => 5,
  });

  const result = await checker.check();

  assertEquals(result, { status: "degraded", redis: false, workers: 0 });
});

Deno.test("HealthCheck returns degraded when ping throws", async () => {
  const checker = new HealthCheck({
    ping: () => Promise.reject(new Error("connection refused")),
    workerCount: () => 2,
  });

  const result = await checker.check();

  assertEquals(result, { status: "degraded", redis: false, workers: 0 });
});
