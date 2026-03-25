import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { InstallClientCoordinator } from "./mod.ts";
import type { InstallClientDeps } from "./mod.ts";

// --- helpers ---

function makeMockDeps(overrides: Partial<InstallClientDeps> = {}): {
  deps: InstallClientDeps;
  logs: string[];
  sshCalls: string[];
  writtenFiles: Map<string, string>;
} {
  const logs: string[] = [];
  const sshCalls: string[] = [];
  const writtenFiles = new Map<string, string>();

  const deps: InstallClientDeps = {
    sshExec: async (_host: string, _port: string, _user: string, cmd: string) => {
      sshCalls.push(cmd);
      if (cmd.includes("find") && cmd.includes("connectivity.json")) {
        return {
          ok: true,
          stdout: "/Users/remote/Documents/programming/arachne/projects/cli/config/macmini1/connectivity.json\n",
        };
      }
      if (cmd.includes("cat") && cmd.includes("connectivity.json")) {
        return {
          ok: true,
          stdout: JSON.stringify({ tcp: "tcp://1.tcp.ngrok.io:12345", http: "myhost.ngrok.io" }),
        };
      }
      if (cmd.includes("cat") && cmd.includes("users.json")) {
        return {
          ok: true,
          stdout: JSON.stringify({ credentials: ["admin:secret"] }),
        };
      }
      return { ok: true, stdout: "" };
    },
    setupKey: async (_host: string, _port: string, _user: string) => {},
    writeFile: async (path: string, content: string) => {
      writtenFiles.set(path, content);
    },
    log: (msg: string) => logs.push(msg),
    configDir: "/tmp/test-client-config",
    ...overrides,
  };

  return { deps, logs, sshCalls, writtenFiles };
}

// --- parseConnectionString tests ---

Deno.test("parseConnectionString parses user@host:port", () => {
  const coordinator = new InstallClientCoordinator(makeMockDeps().deps);
  const result = coordinator.parseConnectionString("raphael@1.tcp.ngrok.io:12345");
  assertEquals(result, { user: "raphael", host: "1.tcp.ngrok.io", port: "12345" });
});

Deno.test("parseConnectionString throws for missing @", () => {
  const coordinator = new InstallClientCoordinator(makeMockDeps().deps);
  assertThrows(
    () => coordinator.parseConnectionString("host:port"),
    Error,
    "Invalid connection string",
  );
});

Deno.test("parseConnectionString throws for missing port", () => {
  const coordinator = new InstallClientCoordinator(makeMockDeps().deps);
  assertThrows(
    () => coordinator.parseConnectionString("user@host"),
    Error,
    "Invalid connection string",
  );
});

Deno.test("parseConnectionString handles IPv6-style host with port", () => {
  const coordinator = new InstallClientCoordinator(makeMockDeps().deps);
  const result = coordinator.parseConnectionString("user@some.host.with.dots:9999");
  assertEquals(result, { user: "user", host: "some.host.with.dots", port: "9999" });
});

// --- coordinator flow tests ---

Deno.test("install-client sets up SSH key", async () => {
  let keySetup = false;
  const { deps } = makeMockDeps({
    setupKey: async (_host: string, _port: string, _user: string) => {
      keySetup = true;
    },
  });
  const coordinator = new InstallClientCoordinator(deps);
  await coordinator.run("raphael@1.tcp.ngrok.io:12345");
  assertEquals(keySetup, true);
});

Deno.test("install-client pulls config from remote host", async () => {
  const { deps, writtenFiles } = makeMockDeps();
  const coordinator = new InstallClientCoordinator(deps);
  await coordinator.run("raphael@1.tcp.ngrok.io:12345");

  // Should write connectivity.json locally
  assertEquals(writtenFiles.has("/tmp/test-client-config/macmini1/connectivity.json"), true);
  const connectivity = JSON.parse(writtenFiles.get("/tmp/test-client-config/macmini1/connectivity.json")!);
  assertEquals(connectivity.tcp, "tcp://1.tcp.ngrok.io:12345");

  // Should write users.json locally
  assertEquals(writtenFiles.has("/tmp/test-client-config/macmini1/users.json"), true);
  const users = JSON.parse(writtenFiles.get("/tmp/test-client-config/macmini1/users.json")!);
  assertEquals(users.credentials, ["admin:secret"]);
});

Deno.test("install-client logs success with host name", async () => {
  const { deps, logs } = makeMockDeps();
  const coordinator = new InstallClientCoordinator(deps);
  await coordinator.run("raphael@1.tcp.ngrok.io:12345");

  assertEquals(logs.some((l) => l.includes("config/")), true);
  assertEquals(logs.some((l) => l.includes("macmini1")), true);
});

Deno.test("install-client throws when remote config not found", async () => {
  const { deps } = makeMockDeps({
    sshExec: async (_host: string, _port: string, _user: string, cmd: string) => {
      if (cmd.includes("find")) {
        return { ok: true, stdout: "" };
      }
      return { ok: true, stdout: "" };
    },
  });
  const coordinator = new InstallClientCoordinator(deps);
  await assertRejects(
    () => coordinator.run("raphael@1.tcp.ngrok.io:12345"),
    Error,
    "Could not find arachne config on remote host",
  );
});
