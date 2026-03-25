import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import type { SshConfig } from "../../../dto/transport.ts";
import { SshClient } from "./mod.ts";

const config: SshConfig = { user: "root", keyPath: "/tmp/test_key", connectTimeout: 5 };
const client = new SshClient(config);

Deno.test("SshClient stores config via constructor", () => {
  assertEquals(client.getConfig(), config);
});

Deno.test("SshClient exposes exec method", () => {
  assertEquals(typeof client.exec, "function");
});

Deno.test("SshClient exposes probe method", () => {
  assertEquals(typeof client.probe, "function");
});

Deno.test("SshClient exposes hasKey method", () => {
  assertEquals(typeof client.hasKey, "function");
});

Deno.test("SshClient exposes setupKey method", () => {
  assertEquals(typeof client.setupKey, "function");
});

Deno.test("SshClient exposes buildArgs method", () => {
  assertEquals(typeof client.buildArgs, "function");
});

Deno.test("SshClient.buildArgs produces correct arg array", () => {
  const conn = { host: "10.0.0.1", port: "22" };
  const args = client.buildArgs(conn);
  assertEquals(args.includes("-i"), true);
  assertEquals(args.includes("/tmp/test_key"), true);
  assertEquals(args.includes("root@10.0.0.1"), true);
});
