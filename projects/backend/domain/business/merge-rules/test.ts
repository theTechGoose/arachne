import { assertEquals, assertInstanceOf } from "jsr:@std/assert";
import { MergeRules } from "./mod.ts";
import type { Target } from "@dto/target.ts";
import type { IngestPayload } from "@dto/ingest.ts";

const rules = new MergeRules();

function makeTarget(overrides: Partial<Target> = {}): Target {
  return {
    host: "https://api.example.com",
    route: ["v1", "data"],
    method: "POST",
    headers: { "content-type": "application/json" },
    query: { format: "json" },
    concurrency: 5,
    timeoutMs: 10000,
    retries: 3,
    ...overrides,
  };
}

// --- mergePayload tests ---

Deno.test("mergePayload - route: concat target + payload", () => {
  const target = makeTarget({ route: ["v1"] });
  const payload: IngestPayload = { route: ["extra", "path"] };
  const result = rules.mergePayload(target, payload);
  assertEquals(result.route, ["v1", "extra", "path"]);
});

Deno.test("mergePayload - method: payload replaces target", () => {
  const target = makeTarget({ method: "POST" });
  const payload: IngestPayload = { method: "PUT" };
  const result = rules.mergePayload(target, payload);
  assertEquals(result.method, "PUT");
});

Deno.test("mergePayload - method: target default when payload omits", () => {
  const target = makeTarget({ method: "GET" });
  const result = rules.mergePayload(target);
  assertEquals(result.method, "GET");
});

Deno.test("mergePayload - headers: spread merge, payload overrides", () => {
  const target = makeTarget({ headers: { "x-a": "1", "x-b": "2" } });
  const payload: IngestPayload = { headers: { "x-b": "override", "x-c": "3" } };
  const result = rules.mergePayload(target, payload);
  assertEquals(result.headers, { "x-a": "1", "x-b": "override", "x-c": "3" });
});

Deno.test("mergePayload - query: spread merge, payload overrides", () => {
  const target = makeTarget({ query: { page: "1", limit: "10" } });
  const payload: IngestPayload = { limit: "20", search: "test" } as IngestPayload;
  // Actually query must be via payload.query
  const payloadCorrect: IngestPayload = { query: { limit: "20", search: "test" } };
  const result = rules.mergePayload(target, payloadCorrect);
  assertEquals(result.query, { page: "1", limit: "20", search: "test" });
});

Deno.test("mergePayload - body: replace from payload", () => {
  const target = makeTarget();
  const payload: IngestPayload = { body: { data: "hello" } };
  const result = rules.mergePayload(target, payload);
  assertEquals(result.body, { data: "hello" });
});

Deno.test("mergePayload - body: undefined when payload has no body", () => {
  const target = makeTarget();
  const result = rules.mergePayload(target);
  assertEquals(result.body, undefined);
});

Deno.test("mergePayload - empty payload uses all target defaults", () => {
  const target = makeTarget({
    route: ["api"],
    method: "DELETE",
    headers: { auth: "token" },
    query: { v: "2" },
  });
  const result = rules.mergePayload(target);
  assertEquals(result.route, ["api"]);
  assertEquals(result.method, "DELETE");
  assertEquals(result.headers, { auth: "token" });
  assertEquals(result.query, { v: "2" });
  assertEquals(result.body, undefined);
});

Deno.test("mergePayload - empty payload object uses target defaults", () => {
  const target = makeTarget({
    route: ["api"],
    method: "GET",
    headers: {},
    query: {},
  });
  const payload: IngestPayload = {};
  const result = rules.mergePayload(target, payload);
  assertEquals(result.route, ["api"]);
  assertEquals(result.method, "GET");
  assertEquals(result.headers, {});
  assertEquals(result.query, {});
});

// --- mergeStepData tests ---

Deno.test("mergeStepData - POST: previous response becomes body", () => {
  const result = rules.mergeStepData({ key: "value" }, "POST");
  assertEquals(result, { body: { key: "value" } });
});

Deno.test("mergeStepData - PUT: previous response becomes body", () => {
  const result = rules.mergeStepData({ key: "value" }, "PUT");
  assertEquals(result, { body: { key: "value" } });
});

Deno.test("mergeStepData - PATCH: previous response becomes body", () => {
  const result = rules.mergeStepData([1, 2, 3], "PATCH");
  assertEquals(result, { body: [1, 2, 3] });
});

Deno.test("mergeStepData - GET: previous flat object spread into query", () => {
  const result = rules.mergeStepData({ page: 1, name: "test" }, "GET");
  assertEquals(result, { query: { page: "1", name: "test" } });
});

Deno.test("mergeStepData - DELETE: previous flat object spread into query", () => {
  const result = rules.mergeStepData({ id: 42 }, "DELETE");
  assertEquals(result, { query: { id: "42" } });
});

Deno.test("mergeStepData - GET with nested object returns Error", () => {
  const result = rules.mergeStepData({ nested: { a: 1 } }, "GET");
  assertInstanceOf(result, Error);
});

Deno.test("mergeStepData - GET with array response returns Error", () => {
  const result = rules.mergeStepData([1, 2, 3], "GET");
  assertInstanceOf(result, Error);
});

Deno.test("mergeStepData - DELETE with string response returns Error", () => {
  const result = rules.mergeStepData("not an object", "DELETE");
  assertInstanceOf(result, Error);
});

Deno.test("mergeStepData - GET with array value in object returns Error", () => {
  const result = rules.mergeStepData({ tags: ["a", "b"] }, "GET");
  assertInstanceOf(result, Error);
});
