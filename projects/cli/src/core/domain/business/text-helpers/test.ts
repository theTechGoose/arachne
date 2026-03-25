import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { TextHelpers } from "./mod.ts";

const h = new TextHelpers();

Deno.test("stripCr removes carriage returns", () => {
  assertEquals(h.stripCr("hello\r\nworld\r\n"), "hello\nworld\n");
});

Deno.test("stripCr leaves clean strings unchanged", () => {
  assertEquals(h.stripCr("hello\nworld"), "hello\nworld");
});
