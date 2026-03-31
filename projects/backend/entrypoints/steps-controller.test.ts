import { assertEquals } from "jsr:@std/assert";
import { StepsController } from "./steps-controller.ts";
import type { Target } from "@dto/target.ts";

const makeTarget = (overrides: Partial<Target> = {}): Target => ({
  host: "http://example.com",
  route: [],
  method: "POST",
  headers: {},
  query: {},
  concurrency: 1,
  timeoutMs: 5000,
  retries: 3,
  ...overrides,
});

Deno.test("StepsController returns loaded target names", async () => {
  const targets = new Map([
    ["fetch-audio", makeTarget()],
    ["transcribe", makeTarget()],
    ["summarize", makeTarget()],
  ]);

  const controller = new StepsController({ targets });
  const req = new Request("http://localhost/steps");
  const res = controller.handle(req);
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body, { steps: ["fetch-audio", "transcribe", "summarize"] });
});

Deno.test("StepsController returns empty array when no targets", async () => {
  const controller = new StepsController({ targets: new Map() });
  const req = new Request("http://localhost/steps");
  const res = controller.handle(req);
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body, { steps: [] });
});
