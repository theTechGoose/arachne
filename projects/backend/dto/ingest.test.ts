import { assertEquals, assertThrows } from "jsr:@std/assert";
import { IngestRequestSchema, IngestPayloadSchema } from "./ingest.ts";

Deno.test("IngestRequestSchema - accepts valid request with all fields", () => {
  const result = IngestRequestSchema.parse({
    steps: ["fetch-audio", "transcribe"],
    payload: { body: { url: "https://example.com" } },
    nonce: "abc123",
    matureAt: "2030-01-01T00:00:00Z",
  });
  assertEquals(result.steps, ["fetch-audio", "transcribe"]);
  assertEquals(result.nonce, "abc123");
});

Deno.test("IngestRequestSchema - accepts minimal request (steps only)", () => {
  const result = IngestRequestSchema.parse({
    steps: ["fetch-audio"],
  });
  assertEquals(result.steps, ["fetch-audio"]);
  assertEquals(result.payload, undefined);
  assertEquals(result.nonce, undefined);
  assertEquals(result.matureAt, undefined);
});

Deno.test("IngestRequestSchema - rejects empty steps array", () => {
  assertThrows(() => {
    IngestRequestSchema.parse({ steps: [] });
  });
});

Deno.test("IngestRequestSchema - rejects missing steps", () => {
  assertThrows(() => {
    IngestRequestSchema.parse({});
  });
});

Deno.test("IngestRequestSchema - rejects non-string step names", () => {
  assertThrows(() => {
    IngestRequestSchema.parse({ steps: [123] });
  });
});

Deno.test("IngestRequestSchema - rejects invalid matureAt", () => {
  assertThrows(() => {
    IngestRequestSchema.parse({
      steps: ["fetch"],
      matureAt: "not-a-date",
    });
  });
});

Deno.test("IngestRequestSchema - accepts matureAt as ISO 8601", () => {
  const result = IngestRequestSchema.parse({
    steps: ["fetch"],
    matureAt: "2030-06-15T12:30:00Z",
  });
  assertEquals(result.matureAt, "2030-06-15T12:30:00Z");
});

Deno.test("IngestPayloadSchema - accepts valid payload", () => {
  const result = IngestPayloadSchema.parse({
    route: ["extra", "path"],
    method: "POST",
    headers: { "X-Custom": "value" },
    query: { key: "val" },
    body: { data: 42 },
  });
  assertEquals(result.route, ["extra", "path"]);
  assertEquals(result.method, "POST");
});

Deno.test("IngestPayloadSchema - accepts empty payload", () => {
  const result = IngestPayloadSchema.parse({});
  assertEquals(result.route, undefined);
  assertEquals(result.method, undefined);
});

Deno.test("IngestPayloadSchema - rejects disallowed fields (strict mode)", () => {
  assertThrows(() => {
    IngestPayloadSchema.parse({
      host: "https://evil.com",
    });
  });
});

Deno.test("IngestPayloadSchema - rejects concurrency override", () => {
  assertThrows(() => {
    IngestPayloadSchema.parse({
      concurrency: 10,
    });
  });
});

Deno.test("IngestPayloadSchema - rejects timeoutMs override", () => {
  assertThrows(() => {
    IngestPayloadSchema.parse({
      timeoutMs: 5000,
    });
  });
});

Deno.test("IngestPayloadSchema - rejects retries override", () => {
  assertThrows(() => {
    IngestPayloadSchema.parse({
      retries: 3,
    });
  });
});

Deno.test("IngestPayloadSchema - accepts unknown body type", () => {
  const result = IngestPayloadSchema.parse({
    body: "plain string body",
  });
  assertEquals(result.body, "plain string body");
});

Deno.test("IngestPayloadSchema - accepts array body", () => {
  const result = IngestPayloadSchema.parse({
    body: [1, 2, 3],
  });
  assertEquals(result.body, [1, 2, 3]);
});
