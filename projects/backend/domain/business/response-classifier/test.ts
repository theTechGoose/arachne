import { assertEquals } from "jsr:@std/assert";
import { ResponseClassifier } from "./mod.ts";

const classifier = new ResponseClassifier();

// --- 2xx -> pass ---

Deno.test("ResponseClassifier - 200 returns pass", () => {
  const result = classifier.classify(200, new Headers());
  assertEquals(result, { action: "pass" });
});

Deno.test("ResponseClassifier - 201 returns pass", () => {
  const result = classifier.classify(201, new Headers());
  assertEquals(result, { action: "pass" });
});

Deno.test("ResponseClassifier - 204 returns pass", () => {
  const result = classifier.classify(204, new Headers());
  assertEquals(result, { action: "pass" });
});

Deno.test("ResponseClassifier - 299 returns pass", () => {
  const result = classifier.classify(299, new Headers());
  assertEquals(result, { action: "pass" });
});

// --- non-2xx with retryable header -> retry ---

Deno.test("ResponseClassifier - 500 with x-arachne-retryable: true returns retry", () => {
  const headers = new Headers({ "x-arachne-retryable": "true" });
  const result = classifier.classify(500, headers);
  assertEquals(result, { action: "retry" });
});

Deno.test("ResponseClassifier - 429 with retryable header returns retry", () => {
  const headers = new Headers({ "x-arachne-retryable": "true" });
  const result = classifier.classify(429, headers);
  assertEquals(result, { action: "retry" });
});

Deno.test("ResponseClassifier - 503 with retryable header returns retry", () => {
  const headers = new Headers({ "x-arachne-retryable": "true" });
  const result = classifier.classify(503, headers);
  assertEquals(result, { action: "retry" });
});

// --- non-2xx without retryable header -> fail ---

Deno.test("ResponseClassifier - 400 without header returns fail", () => {
  const result = classifier.classify(400, new Headers());
  assertEquals(result, { action: "fail", status: 400 });
});

Deno.test("ResponseClassifier - 500 without header returns fail", () => {
  const result = classifier.classify(500, new Headers());
  assertEquals(result, { action: "fail", status: 500 });
});

Deno.test("ResponseClassifier - 503 without header returns fail", () => {
  const result = classifier.classify(503, new Headers());
  assertEquals(result, { action: "fail", status: 503 });
});

Deno.test("ResponseClassifier - 404 without header returns fail", () => {
  const result = classifier.classify(404, new Headers());
  assertEquals(result, { action: "fail", status: 404 });
});

// --- Edge cases ---

Deno.test("ResponseClassifier - 2xx with retryable header still returns pass", () => {
  const headers = new Headers({ "x-arachne-retryable": "true" });
  const result = classifier.classify(200, headers);
  assertEquals(result, { action: "pass" });
});

Deno.test("ResponseClassifier - retryable header with value 'false' returns fail", () => {
  const headers = new Headers({ "x-arachne-retryable": "false" });
  const result = classifier.classify(500, headers);
  assertEquals(result, { action: "fail", status: 500 });
});

Deno.test("ResponseClassifier - 199 is not 2xx, returns fail without header", () => {
  const result = classifier.classify(199, new Headers());
  assertEquals(result, { action: "fail", status: 199 });
});

Deno.test("ResponseClassifier - 300 is not 2xx, returns fail without header", () => {
  const result = classifier.classify(300, new Headers());
  assertEquals(result, { action: "fail", status: 300 });
});
