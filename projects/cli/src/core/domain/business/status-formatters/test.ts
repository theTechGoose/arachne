import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { StatusFormatters } from "./mod.ts";

const f = new StatusFormatters();

Deno.test("fmtTemp converts millidegrees to degrees with one decimal", () => {
  assertEquals(f.fmtTemp("52000"), "52.0\u00B0C");
});

Deno.test("fmtTemp returns n/a for n/a input", () => {
  assertEquals(f.fmtTemp("n/a"), "n/a");
});

Deno.test("fmtFreq converts kHz to MHz", () => {
  assertEquals(f.fmtFreq("1800000"), "1800 MHz");
});

Deno.test("fmtFreq returns n/a for n/a input", () => {
  assertEquals(f.fmtFreq("n/a"), "n/a");
});

Deno.test("fmtThrottle maps 0x0 to none", () => {
  assertEquals(f.fmtThrottle("0x0"), "none");
});

Deno.test("fmtThrottle returns n/a for n/a input", () => {
  assertEquals(f.fmtThrottle("n/a"), "n/a");
});

Deno.test("fmtThrottle passes through non-zero throttle values", () => {
  assertEquals(f.fmtThrottle("0x50005"), "0x50005");
});
