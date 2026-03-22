import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { SshHelpers } from "./mod.ts";

const h = new SshHelpers();

// --- esc ---

Deno.test("esc wraps string in single quotes", () => {
  assertEquals(h.esc("hello"), "'hello'");
});

Deno.test("esc escapes embedded single quotes", () => {
  assertEquals(h.esc("it's"), "'it'\\''s'");
});

Deno.test("esc handles empty string", () => {
  assertEquals(h.esc(""), "''");
});

Deno.test("esc preserves backslashes inside single quotes", () => {
  assertEquals(h.esc("path\\to\\file"), "'path\\to\\file'");
});

Deno.test("esc preserves dollar signs inside single quotes", () => {
  assertEquals(h.esc("$HOME"), "'$HOME'");
});

// --- sshArgs ---

Deno.test("sshArgs builds basic args with key, port, timeout, user@host", () => {
  const conn = { transport: "usb" as const, host: "10.0.0.1", port: "22" };
  const config = { user: "root", keyPath: "/home/.ssh/key", connectTimeout: 5 };
  const args = h.sshArgs(conn, config);
  assertEquals(args, [
    "-i", "/home/.ssh/key",
    "-p", "22",
    "-o", "ConnectTimeout=5",
    "-o", "SetEnv=TERM=xterm-256color",
    "root@10.0.0.1",
  ]);
});

Deno.test("sshArgs adds BatchMode=yes when batch is true", () => {
  const conn = { transport: "wifi" as const, host: "example.com", port: "443" };
  const config = { user: "pi", keyPath: "/k", connectTimeout: 3 };
  const args = h.sshArgs(conn, config, { batch: true });
  assertEquals(args.includes("BatchMode=yes"), true);
  assertEquals(args[args.length - 1], "pi@example.com");
});

Deno.test("sshArgs appends command as last arg", () => {
  const conn = { transport: "usb" as const, host: "10.0.0.1", port: "22" };
  const config = { user: "root", keyPath: "/k", connectTimeout: 5 };
  const args = h.sshArgs(conn, config, { cmd: "echo hello" });
  assertEquals(args[args.length - 1], "echo hello");
});

Deno.test("sshArgs with batch and command puts command after user@host", () => {
  const conn = { transport: "usb" as const, host: "10.0.0.1", port: "22" };
  const config = { user: "root", keyPath: "/k", connectTimeout: 5 };
  const args = h.sshArgs(conn, config, { batch: true, cmd: "ls" });
  const userIdx = args.indexOf("root@10.0.0.1");
  assertEquals(args[userIdx + 1], "ls");
});

// --- wrapSshErr ---

Deno.test("wrapSshErr maps host key changed error", () => {
  const conn = { transport: "usb" as const, host: "10.0.0.1", port: "22" };
  const result = h.wrapSshErr("REMOTE HOST IDENTIFICATION HAS CHANGED", conn);
  assertEquals(result.includes("ssh-keygen -R 10.0.0.1"), true);
});

Deno.test("wrapSshErr maps connection refused for USB", () => {
  const conn = { transport: "usb" as const, host: "10.0.0.1", port: "22" };
  const result = h.wrapSshErr("Connection refused", conn);
  assertEquals(result.includes("USB cable"), true);
});

Deno.test("wrapSshErr maps connection refused for WiFi", () => {
  const conn = { transport: "wifi" as const, host: "example.com", port: "443" };
  const result = h.wrapSshErr("Connection refused", conn);
  assertEquals(result.includes("ngrok"), true);
});

Deno.test("wrapSshErr maps timeout for USB", () => {
  const conn = { transport: "usb" as const, host: "10.0.0.1", port: "22" };
  const result = h.wrapSshErr("Connection timed out", conn);
  assertEquals(result.includes("USB cable"), true);
});

Deno.test("wrapSshErr maps timeout for WiFi", () => {
  const conn = { transport: "wifi" as const, host: "example.com", port: "443" };
  const result = h.wrapSshErr("Connection timed out", conn);
  assertEquals(result.includes("ngrok tunnel"), true);
});

Deno.test("wrapSshErr maps permission denied", () => {
  const conn = { transport: "usb" as const, host: "10.0.0.1", port: "22" };
  const result = h.wrapSshErr("Permission denied", conn);
  assertEquals(result.includes("SSH key"), true);
});

Deno.test("wrapSshErr returns raw string for unknown errors", () => {
  const conn = { transport: "usb" as const, host: "10.0.0.1", port: "22" };
  assertEquals(h.wrapSshErr("some unknown error", conn), "some unknown error");
});
