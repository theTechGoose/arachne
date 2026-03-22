import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { AuthCodeGenerator } from "./mod.ts";

const gen = new AuthCodeGenerator();

Deno.test("generateAuthCode returns a 6-character string", () => {
  const code = gen.generateAuthCode();
  assertEquals(code.length, 6);
});

Deno.test("generateAuthCode returns only uppercase letters and digits", () => {
  const code = gen.generateAuthCode();
  assertEquals(/^[A-Z0-9]{6}$/.test(code), true);
});

Deno.test("isValidAuthCode accepts valid 6-char alphanumeric codes", () => {
  assertEquals(gen.isValidAuthCode("ABC123"), true);
  assertEquals(gen.isValidAuthCode("ZZZZZ9"), true);
});

Deno.test("isValidAuthCode rejects lowercase", () => {
  assertEquals(gen.isValidAuthCode("abc123"), false);
});

Deno.test("isValidAuthCode rejects wrong length", () => {
  assertEquals(gen.isValidAuthCode("AB12"), false);
  assertEquals(gen.isValidAuthCode("ABCDEFG"), false);
});

Deno.test("isValidAuthCode rejects empty string", () => {
  assertEquals(gen.isValidAuthCode(""), false);
});
