import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { JobIdGenerator } from "./mod.ts";

const generator = new JobIdGenerator();

Deno.test("JobIdGenerator - deterministic output for same inputs", async () => {
  const hash1 = await generator.generate({ foo: "bar" }, "nonce1", "stepA");
  const hash2 = await generator.generate({ foo: "bar" }, "nonce1", "stepA");
  assertEquals(hash1, hash2);
});

Deno.test("JobIdGenerator - different body produces different hash", async () => {
  const hash1 = await generator.generate({ foo: "bar" }, "nonce1", "stepA");
  const hash2 = await generator.generate({ foo: "baz" }, "nonce1", "stepA");
  assertNotEquals(hash1, hash2);
});

Deno.test("JobIdGenerator - different nonce produces different hash", async () => {
  const hash1 = await generator.generate({ foo: "bar" }, "nonce1", "stepA");
  const hash2 = await generator.generate({ foo: "bar" }, "nonce2", "stepA");
  assertNotEquals(hash1, hash2);
});

Deno.test("JobIdGenerator - different stepName produces different hash", async () => {
  const hash1 = await generator.generate({ foo: "bar" }, "nonce1", "stepA");
  const hash2 = await generator.generate({ foo: "bar" }, "nonce1", "stepB");
  assertNotEquals(hash1, hash2);
});

Deno.test("JobIdGenerator - empty nonce works", async () => {
  const hash = await generator.generate({ foo: "bar" }, "", "stepA");
  assertEquals(typeof hash, "string");
  assertEquals(hash.length, 64); // SHA-256 hex = 64 chars
});

Deno.test("JobIdGenerator - null byte delimiter prevents collision", async () => {
  // Without null byte delimiters, "a" + "b\0c" + "step" would equal "a\0b" + "c" + "step"
  // Our delimiter scheme: canonicalize(body) + \0 + nonce + \0 + stepName
  // So: '\"a\"' + \0 + "b" + \0 + "cstep" vs '\"a\"' + \0 + "bc" + \0 + "step"
  const hash1 = await generator.generate("a", "b", "cstep");
  const hash2 = await generator.generate("a", "bc", "step");
  assertNotEquals(hash1, hash2);
});

Deno.test("JobIdGenerator - canonicalizes JSON key order", async () => {
  const hash1 = await generator.generate({ b: 2, a: 1 }, "n", "s");
  const hash2 = await generator.generate({ a: 1, b: 2 }, "n", "s");
  assertEquals(hash1, hash2);
});

Deno.test("JobIdGenerator - returns 64-char hex string", async () => {
  const hash = await generator.generate({ test: true }, "nonce", "step");
  assertEquals(hash.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(hash), true);
});
