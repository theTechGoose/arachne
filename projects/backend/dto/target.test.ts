import { assertEquals, assertThrows } from "jsr:@std/assert";
import { TargetSchema } from "./target.ts";

const VALID_TARGET = {
  host: "https://api.example.com",
  route: ["v1", "audio"],
  method: "POST" as const,
  headers: { "Content-Type": "application/json" },
  query: { format: "mp3" },
  concurrency: 3,
  timeoutMs: 30000,
  retries: 2,
};

Deno.test("TargetSchema - accepts valid target", () => {
  const result = TargetSchema.parse(VALID_TARGET);
  assertEquals(result.host, "https://api.example.com");
  assertEquals(result.method, "POST");
  assertEquals(result.concurrency, 3);
});

Deno.test("TargetSchema - accepts all HTTP methods", () => {
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
    const result = TargetSchema.parse({ ...VALID_TARGET, method });
    assertEquals(result.method, method);
  }
});

Deno.test("TargetSchema - rejects invalid host URL", () => {
  assertThrows(() => {
    TargetSchema.parse({ ...VALID_TARGET, host: "not-a-url" });
  });
});

Deno.test("TargetSchema - rejects invalid HTTP method", () => {
  assertThrows(() => {
    TargetSchema.parse({ ...VALID_TARGET, method: "INVALID" });
  });
});

Deno.test("TargetSchema - rejects negative concurrency", () => {
  assertThrows(() => {
    TargetSchema.parse({ ...VALID_TARGET, concurrency: -1 });
  });
});

Deno.test("TargetSchema - rejects zero concurrency", () => {
  assertThrows(() => {
    TargetSchema.parse({ ...VALID_TARGET, concurrency: 0 });
  });
});

Deno.test("TargetSchema - rejects negative retries", () => {
  assertThrows(() => {
    TargetSchema.parse({ ...VALID_TARGET, retries: -1 });
  });
});

Deno.test("TargetSchema - allows zero retries", () => {
  const result = TargetSchema.parse({ ...VALID_TARGET, retries: 0 });
  assertEquals(result.retries, 0);
});

Deno.test("TargetSchema - rejects non-integer timeoutMs", () => {
  assertThrows(() => {
    TargetSchema.parse({ ...VALID_TARGET, timeoutMs: 1.5 });
  });
});

Deno.test("TargetSchema - rejects missing required fields", () => {
  assertThrows(() => {
    TargetSchema.parse({ host: "https://api.example.com" });
  });
});

Deno.test("TargetSchema - accepts empty route array", () => {
  const result = TargetSchema.parse({ ...VALID_TARGET, route: [] });
  assertEquals(result.route, []);
});

Deno.test("TargetSchema - accepts empty headers", () => {
  const result = TargetSchema.parse({ ...VALID_TARGET, headers: {} });
  assertEquals(result.headers, {});
});

Deno.test("TargetSchema - accepts empty query", () => {
  const result = TargetSchema.parse({ ...VALID_TARGET, query: {} });
  assertEquals(result.query, {});
});
