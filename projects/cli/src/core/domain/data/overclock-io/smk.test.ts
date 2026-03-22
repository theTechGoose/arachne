import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import type { SshConfig } from "../../../dto/transport.ts";
import { SshClient } from "../ssh/mod.ts";
import { OverclockManager } from "./mod.ts";

const config: SshConfig = { user: "root", keyPath: "/tmp/k", connectTimeout: 5 };
const ssh = new SshClient(config);
const oc = new OverclockManager(ssh);

Deno.test("OverclockManager constructed with SshClient", () => {
  assertEquals(typeof oc.loadProfiles, "function");
});

Deno.test("OverclockManager exposes detectModel", () => { assertEquals(typeof oc.detectModel, "function"); });
Deno.test("OverclockManager exposes setupWatchdog", () => { assertEquals(typeof oc.setupWatchdog, "function"); });
Deno.test("OverclockManager exposes installDeadManSwitch", () => { assertEquals(typeof oc.installDeadManSwitch, "function"); });
Deno.test("OverclockManager exposes cancelDeadManSwitch", () => { assertEquals(typeof oc.cancelDeadManSwitch, "function"); });
Deno.test("OverclockManager exposes waitForReboot", () => { assertEquals(typeof oc.waitForReboot, "function"); });
Deno.test("OverclockManager exposes readTemp", () => { assertEquals(typeof oc.readTemp, "function"); });
