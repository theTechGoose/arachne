import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { InstallHostCoordinator } from "./mod.ts";
import type { InstallHostDeps } from "./mod.ts";

// --- helpers ---

function makeMockDeps(overrides: Partial<InstallHostDeps> = {}): {
  deps: InstallHostDeps;
  logs: string[];
  execCalls: string[];
  writtenFiles: Map<string, string>;
  promptResponses: string[];
} {
  const logs: string[] = [];
  const execCalls: string[] = [];
  const writtenFiles = new Map<string, string>();
  const promptResponses = [
    "macmini1",           // name
    "tcp://1.tcp.ngrok.io:12345", // tcpUrl
    "myhost.ngrok.io",    // httpUrl
    "admin:secret",       // authUser
    "ngrok_token_abc",    // authtoken
  ];

  const deps: InstallHostDeps = {
    prompt: (_msg: string) => {
      return promptResponses.shift() ?? null;
    },
    exec: async (cmd: string) => {
      execCalls.push(cmd);
      // Simulate "which" commands — brew exists, others need install
      if (cmd === "which brew") return { ok: true, stdout: "/opt/homebrew/bin/brew", stderr: "" };
      if (cmd === "which ngrok") return { ok: true, stdout: "/opt/homebrew/bin/ngrok", stderr: "" };
      if (cmd === "which redis-server") return { ok: true, stdout: "/opt/homebrew/bin/redis-server", stderr: "" };
      if (cmd === "which deno") return { ok: true, stdout: "/opt/homebrew/bin/deno", stderr: "" };
      // Simulate tunnel verification succeeding on first try
      if (cmd === "curl -s localhost:4040/api/tunnels") {
        return { ok: true, stdout: '{"tunnels":[{"public_url":"tcp://1.tcp.ngrok.io:12345"}]}', stderr: "" };
      }
      return { ok: true, stdout: "", stderr: "" };
    },
    writeFile: async (path: string, content: string) => {
      writtenFiles.set(path, content);
    },
    readFile: async (_path: string) => "",
    log: (msg: string) => logs.push(msg),
    configDir: "/tmp/test-config",
    ...overrides,
  };

  return { deps, logs, execCalls, writtenFiles, promptResponses };
}

// --- tests ---

Deno.test("install-host prompts for all required values", async () => {
  const { deps, writtenFiles } = makeMockDeps();
  const coordinator = new InstallHostCoordinator(deps);
  await coordinator.run();

  // Should have created connectivity.json with prompted values
  const connectivity = writtenFiles.get("/tmp/test-config/macmini1/connectivity.json");
  assertEquals(connectivity !== undefined, true);
  const parsed = JSON.parse(connectivity!);
  assertEquals(parsed.tcp, "tcp://1.tcp.ngrok.io:12345");
  assertEquals(parsed.http, "myhost.ngrok.io");
});

Deno.test("install-host creates config files in correct locations", async () => {
  const { deps, writtenFiles } = makeMockDeps();
  const coordinator = new InstallHostCoordinator(deps);
  await coordinator.run();

  // connectivity.json
  assertEquals(writtenFiles.has("/tmp/test-config/macmini1/connectivity.json"), true);
  // users.json
  assertEquals(writtenFiles.has("/tmp/test-config/macmini1/users.json"), true);
  const users = JSON.parse(writtenFiles.get("/tmp/test-config/macmini1/users.json")!);
  assertEquals(users.credentials, ["admin:secret"]);
  // .env
  assertEquals(writtenFiles.has("/tmp/test-config/.env"), true);
  assertEquals(writtenFiles.get("/tmp/test-config/.env"), "NGROK_AUTHTOKEN=ngrok_token_abc\n");
});

Deno.test("install-host runs mkdir for config path", async () => {
  const { deps, execCalls } = makeMockDeps();
  const coordinator = new InstallHostCoordinator(deps);
  await coordinator.run();

  assertEquals(execCalls.includes("mkdir -p /tmp/test-config/macmini1/targets"), true);
});

Deno.test("install-host checks for existing dependencies before installing", async () => {
  const { deps, execCalls } = makeMockDeps();
  const coordinator = new InstallHostCoordinator(deps);
  await coordinator.run();

  assertEquals(execCalls.includes("which brew"), true);
  assertEquals(execCalls.includes("which ngrok"), true);
  assertEquals(execCalls.includes("which redis-server"), true);
  assertEquals(execCalls.includes("which deno"), true);
});

Deno.test("install-host installs missing dependencies", async () => {
  const { deps, execCalls } = makeMockDeps({
    exec: async (cmd: string) => {
      execCalls.push(cmd);
      if (cmd === "which brew") return { ok: true, stdout: "/opt/homebrew/bin/brew", stderr: "" };
      if (cmd === "which ngrok") return { ok: false, stdout: "", stderr: "" };
      if (cmd === "which redis-server") return { ok: true, stdout: "/opt/homebrew/bin/redis-server", stderr: "" };
      if (cmd === "which deno") return { ok: true, stdout: "/opt/homebrew/bin/deno", stderr: "" };
      if (cmd === "curl -s localhost:4040/api/tunnels") {
        return { ok: true, stdout: '{"tunnels":[{"public_url":"tcp://1.tcp.ngrok.io:12345"}]}', stderr: "" };
      }
      return { ok: true, stdout: "", stderr: "" };
    },
  });
  const coordinator = new InstallHostCoordinator(deps);
  await coordinator.run();

  assertEquals(execCalls.includes("/opt/homebrew/bin/brew install ngrok"), true);
});

Deno.test("install-host throws when name prompt is empty", async () => {
  const { deps } = makeMockDeps({
    prompt: (_msg: string) => null,
  });
  const coordinator = new InstallHostCoordinator(deps);
  await assertRejects(
    () => coordinator.run(),
    Error,
    "Name is required",
  );
});

Deno.test("install-host configures ngrok authtoken", async () => {
  const { deps, execCalls } = makeMockDeps();
  const coordinator = new InstallHostCoordinator(deps);
  await coordinator.run();

  assertEquals(execCalls.includes("ngrok config add-authtoken ngrok_token_abc"), true);
});

Deno.test("install-host enables remote login and disables sleep", async () => {
  const { deps, execCalls } = makeMockDeps();
  const coordinator = new InstallHostCoordinator(deps);
  await coordinator.run();

  assertEquals(execCalls.includes("sudo systemsetup -setremotelogin on 2>/dev/null || true"), true);
  assertEquals(execCalls.includes("sudo pmset -a disablesleep 1"), true);
});

Deno.test("install-host creates app directories", async () => {
  const { deps, execCalls } = makeMockDeps();
  const coordinator = new InstallHostCoordinator(deps);
  await coordinator.run();

  assertEquals(execCalls.includes("sudo mkdir -p /usr/local/var/arachne/{backend,ui,targets,logs}"), true);
  assertEquals(execCalls.some((c) => c.includes("sudo chown -R $(whoami) /usr/local/var/arachne")), true);
});

Deno.test("install-host writes ngrok LaunchDaemon plist", async () => {
  const { deps, writtenFiles, execCalls } = makeMockDeps();
  const coordinator = new InstallHostCoordinator(deps);
  await coordinator.run();

  assertEquals(writtenFiles.has("/tmp/com.ngrok.tunnel.plist"), true);
  const plist = writtenFiles.get("/tmp/com.ngrok.tunnel.plist")!;
  assertEquals(plist.includes("com.ngrok.tunnel"), true);
  assertEquals(plist.includes("/opt/homebrew/bin/ngrok"), true);
  assertEquals(plist.includes("/usr/local/var/arachne/logs/ngrok.log"), true);
  assertEquals(
    execCalls.includes(
      "sudo cp /tmp/com.ngrok.tunnel.plist /Library/LaunchDaemons/com.ngrok.tunnel.plist",
    ),
    true,
  );
});

Deno.test("install-host restarts ngrok and redis services", async () => {
  const { deps, execCalls } = makeMockDeps();
  const coordinator = new InstallHostCoordinator(deps);
  await coordinator.run();

  assertEquals(execCalls.includes("sudo launchctl unload /Library/LaunchDaemons/com.ngrok.tunnel.plist 2>/dev/null || true"), true);
  assertEquals(execCalls.includes("sudo launchctl load -w /Library/LaunchDaemons/com.ngrok.tunnel.plist"), true);
  assertEquals(execCalls.includes("/opt/homebrew/bin/brew services restart redis"), true);
});

Deno.test("install-host verifies tunnels and logs success message", async () => {
  const { deps, logs } = makeMockDeps();
  const coordinator = new InstallHostCoordinator(deps);
  await coordinator.run();

  const doneLog = logs.find((l) => l.includes("Done."));
  assertEquals(doneLog !== undefined, true);
});

Deno.test("install-host throws when tunnel verification fails", async () => {
  const { deps } = makeMockDeps({
    exec: async (cmd: string) => {
      if (cmd === "which brew") return { ok: true, stdout: "/opt/homebrew/bin/brew", stderr: "" };
      if (cmd.startsWith("which ")) return { ok: true, stdout: "/usr/bin/" + cmd.split(" ")[1], stderr: "" };
      if (cmd === "curl -s localhost:4040/api/tunnels") {
        return { ok: false, stdout: "", stderr: "connection refused" };
      }
      return { ok: true, stdout: "", stderr: "" };
    },
  });
  const coordinator = new InstallHostCoordinator(deps);
  await assertRejects(
    () => coordinator.run(),
    Error,
    "Tunnel verification failed",
  );
});
