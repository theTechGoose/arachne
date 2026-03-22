import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import type { SshConfig } from "../../../dto/transport.ts";
import { SshClient } from "../ssh/mod.ts";
import { WifiManager } from "./mod.ts";

const config: SshConfig = { user: "root", keyPath: "/tmp/k", connectTimeout: 5 };
const ssh = new SshClient(config);
const wifi = new WifiManager(ssh);

Deno.test("WifiManager constructed with SshClient", () => {
  assertEquals(typeof wifi.list, "function");
});

Deno.test("WifiManager exposes add", () => { assertEquals(typeof wifi.add, "function"); });
Deno.test("WifiManager exposes remove", () => { assertEquals(typeof wifi.remove, "function"); });
Deno.test("WifiManager exposes reset", () => { assertEquals(typeof wifi.reset, "function"); });
Deno.test("WifiManager exposes formatSummary", () => { assertEquals(typeof wifi.formatSummary, "function"); });

Deno.test("WifiManager.formatSummary returns (none) for empty list", () => {
  assertEquals(wifi.formatSummary([]), "(none)");
});

Deno.test("WifiManager.formatSummary formats networks", () => {
  const nets = [
    { id: "0", ssid: "Home", current: true },
    { id: "1", ssid: "Office", current: false },
  ];
  assertEquals(wifi.formatSummary(nets), "Home (current), Office");
});
