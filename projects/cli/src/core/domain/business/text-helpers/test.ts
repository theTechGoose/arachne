import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { TextHelpers } from "./mod.ts";

const h = new TextHelpers();

Deno.test("tag formats usb transport", () => {
  assertEquals(h.tag("usb"), "[usb]");
});

Deno.test("tag formats wifi transport", () => {
  assertEquals(h.tag("wifi"), "[wifi]");
});

Deno.test("stripCr removes carriage returns", () => {
  assertEquals(h.stripCr("hello\r\nworld\r\n"), "hello\nworld\n");
});

Deno.test("stripCr leaves clean strings unchanged", () => {
  assertEquals(h.stripCr("hello\nworld"), "hello\nworld");
});

Deno.test("parseOverrides parses key=value lines", () => {
  const result = h.parseOverrides("FOO=bar\nBAZ=qux");
  assertEquals(result.get("FOO"), "bar");
  assertEquals(result.get("BAZ"), "qux");
});

Deno.test("parseOverrides skips comments and blank lines", () => {
  const result = h.parseOverrides("# comment\n\nKEY=val\n  \n# another");
  assertEquals(result.size, 1);
  assertEquals(result.get("KEY"), "val");
});

Deno.test("parseOverrides handles values with equals signs", () => {
  const result = h.parseOverrides("URL=http://example.com?a=1&b=2");
  assertEquals(result.get("URL"), "http://example.com?a=1&b=2");
});

Deno.test("parseOverrides returns empty map for empty input", () => {
  assertEquals(h.parseOverrides("").size, 0);
});

Deno.test("networkSummary returns (none) for empty list", () => {
  assertEquals(h.networkSummary([]), "(none)");
});

Deno.test("networkSummary formats single network", () => {
  assertEquals(h.networkSummary([{ id: "0", ssid: "HomeWifi", current: false }]), "HomeWifi");
});

Deno.test("networkSummary marks current network", () => {
  assertEquals(h.networkSummary([{ id: "0", ssid: "HomeWifi", current: true }]), "HomeWifi (current)");
});

Deno.test("networkSummary joins multiple networks with commas", () => {
  const nets = [
    { id: "0", ssid: "Home", current: true },
    { id: "1", ssid: "Office", current: false },
  ];
  assertEquals(h.networkSummary(nets), "Home (current), Office");
});
