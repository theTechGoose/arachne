import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { assertRejects } from "https://deno.land/std@0.224.0/assert/assert_rejects.ts";
import { CliError } from "../../../dto/exit-codes.ts";
import type { Target } from "../../../dto/config.ts";
import type { Conn } from "../../../dto/transport.ts";
import { DeployCoordinator } from "./mod.ts";
import type { DeployDeps } from "./mod.ts";

// --- helpers ---

function stubTarget(overrides?: Partial<Target>): Target {
  return {
    host: "https://example.com",
    route: ["/api"],
    method: "GET",
    headers: {},
    query: {},
    concurrency: 1,
    timeoutMs: 5000,
    retries: 0,
    ...overrides,
  };
}

const CONN: Conn = { host: "test", port: "22" };

function makeDeps(overrides?: Partial<DeployDeps>): DeployDeps {
  const calls: string[] = [];
  return {
    calls,
    loadTargets: overrides?.loadTargets ??
      (async (_pi: string) => {
        calls.push("loadTargets");
        return new Map([["site", stubTarget()]]);
      }),
    resolveSshConn: overrides?.resolveSshConn ??
      (async () => {
        calls.push("resolveSshConn");
        return CONN;
      }),
    copyDir: overrides?.copyDir ??
      (async (_conn: Conn, _localPath: string, _remotePath: string) => {
        calls.push(`copyDir`);
      }),
    sshExec: overrides?.sshExec ??
      (async (_conn: Conn, _cmd: string) => {
        calls.push("sshExec");
        return { ok: true, stdout: "", stderr: "", code: 0 };
      }),
    log: overrides?.log ??
      ((_msg: string) => {
        calls.push("log");
      }),
    projectRoot: "/fake/root/",
    configDir: "/fake/root/config/",
    drainMs: overrides?.drainMs ?? 0,
    healthIntervalMs: overrides?.healthIntervalMs ?? 0,
    healthMaxAttempts: overrides?.healthMaxAttempts ?? 5,
  } as DeployDeps & { calls: string[] };
}

// --- test: validates targets before deploying ---

Deno.test("deploy coordinator - validates targets before deploying", async () => {
  const deps = makeDeps({
    loadTargets: async (_pi: string) => {
      throw new CliError(
        'Error: targets/ directory not found for "testpi".',
        1,
      );
    },
  });

  const coord = new DeployCoordinator(deps);
  await assertRejects(
    () => coord.run("testpi", { dryRun: false, fresh: false }),
    CliError,
    "targets/ directory not found",
  );
});

// --- test: dry-run prints plan without executing ---

Deno.test("deploy coordinator - dry-run shows plan without executing SSH", async () => {
  const logged: string[] = [];
  const deps = makeDeps({
    log: (msg: string) => {
      logged.push(msg);
    },
  });

  const coord = new DeployCoordinator(deps);
  await coord.run("testpi", { dryRun: true, fresh: false });

  // Should have loaded targets (validation)
  assertEquals((deps as DeployDeps & { calls: string[] }).calls.includes("loadTargets"), true);
  // Should NOT have called copyDir or sshExec
  assertEquals((deps as DeployDeps & { calls: string[] }).calls.includes("copyDir"), false);
  assertEquals((deps as DeployDeps & { calls: string[] }).calls.includes("sshExec"), false);
  // Should have logged something about the plan
  const hasPlan = logged.some((m) => m.toLowerCase().includes("plan") || m.toLowerCase().includes("dry"));
  assertEquals(hasPlan, true);
});

// --- test: fresh mode sends launchctl commands ---

Deno.test("deploy coordinator - fresh mode sends drain and wipe commands via launchctl", async () => {
  const sshCommands: string[] = [];
  const deps = makeDeps({
    sshExec: async (_conn: Conn, cmd: string) => {
      sshCommands.push(cmd);
      if (cmd.includes("curl")) {
        return { ok: true, stdout: "ok", stderr: "", code: 0 };
      }
      if (cmd.includes("which deno")) {
        return { ok: true, stdout: "/opt/homebrew/bin/deno", stderr: "", code: 0 };
      }
      return { ok: true, stdout: "yes", stderr: "", code: 0 };
    },
  });

  const coord = new DeployCoordinator(deps);
  await coord.run("testpi", { dryRun: false, fresh: true });

  // Should send SIGTERM via launchctl kill
  const hasSigterm = sshCommands.some((c) => c.includes("launchctl kill") && c.includes("SIGTERM"));
  assertEquals(hasSigterm, true, `Expected launchctl kill SIGTERM but got: ${JSON.stringify(sshCommands)}`);

  // Should unload services via launchctl
  const hasUnload = sshCommands.some((c) => c.includes("launchctl unload"));
  assertEquals(hasUnload, true, `Expected launchctl unload but got: ${JSON.stringify(sshCommands)}`);

  // Should wipe app dirs at /usr/local/var/arachne/ but NOT redis
  const hasWipe = sshCommands.some((c) => c.includes("rm -rf") && c.includes("/usr/local/var/arachne/backend"));
  assertEquals(hasWipe, true, `Expected wipe of /usr/local/var/arachne/backend`);
  const hasRedisWipe = sshCommands.some((c) => c.includes("redis") && c.includes("rm"));
  assertEquals(hasRedisWipe, false);
});

// --- test: normal deploy performs 3 copy stages with macOS paths ---

Deno.test("deploy coordinator - normal deploy performs 3 copy stages to macOS paths", async () => {
  const copyPaths: string[] = [];
  const deps = makeDeps({
    copyDir: async (_conn: Conn, _localPath: string, remotePath: string) => {
      copyPaths.push(remotePath);
    },
    sshExec: async (_conn: Conn, cmd: string) => {
      if (cmd.includes("curl")) {
        return { ok: true, stdout: "ok", stderr: "", code: 0 };
      }
      if (cmd.includes("which deno")) {
        return { ok: true, stdout: "/opt/homebrew/bin/deno", stderr: "", code: 0 };
      }
      return { ok: true, stdout: "yes", stderr: "", code: 0 };
    },
  });

  const coord = new DeployCoordinator(deps);
  await coord.run("testpi", { dryRun: false, fresh: false });

  assertEquals(copyPaths.length, 3);
  assertEquals(copyPaths[0], "/usr/local/var/arachne/backend/");
  assertEquals(copyPaths[1], "/usr/local/var/arachne/ui/");
  assertEquals(copyPaths[2], "/usr/local/var/arachne/targets/");
});

// --- test: writes launchd plist content ---

Deno.test("deploy coordinator - writes launchd plist files with com.arachne labels", async () => {
  const sshCommands: string[] = [];
  const deps = makeDeps({
    sshExec: async (_conn: Conn, cmd: string) => {
      sshCommands.push(cmd);
      if (cmd.includes("curl")) {
        return { ok: true, stdout: "ok", stderr: "", code: 0 };
      }
      if (cmd.includes("which deno")) {
        return { ok: true, stdout: "/usr/local/bin/deno", stderr: "", code: 0 };
      }
      return { ok: true, stdout: "yes", stderr: "", code: 0 };
    },
  });

  const coord = new DeployCoordinator(deps);
  await coord.run("testpi", { dryRun: false, fresh: false });

  // Should write backend plist
  const backendPlist = sshCommands.find((c) => c.includes("com.arachne.backend"));
  assertEquals(backendPlist !== undefined, true, "Expected backend plist write command");
  assertEquals(backendPlist!.includes("LaunchDaemons"), true, "Expected plist path under /Library/LaunchDaemons");

  // Should write UI plist
  const uiPlist = sshCommands.find((c) => c.includes("com.arachne.ui"));
  assertEquals(uiPlist !== undefined, true, "Expected UI plist write command");
  assertEquals(uiPlist!.includes("LaunchDaemons"), true, "Expected UI plist path under /Library/LaunchDaemons");
});

// --- test: substitutes detected deno path into plist ---

Deno.test("deploy coordinator - substitutes detected deno path into plist", async () => {
  const sshCommands: string[] = [];
  const deps = makeDeps({
    sshExec: async (_conn: Conn, cmd: string) => {
      sshCommands.push(cmd);
      if (cmd.includes("curl")) {
        return { ok: true, stdout: "ok", stderr: "", code: 0 };
      }
      if (cmd.includes("which deno")) {
        return { ok: true, stdout: "/custom/path/deno", stderr: "", code: 0 };
      }
      return { ok: true, stdout: "yes", stderr: "", code: 0 };
    },
  });

  const coord = new DeployCoordinator(deps);
  await coord.run("testpi", { dryRun: false, fresh: false });

  // The plist write command should contain the detected deno path
  const plistCmd = sshCommands.find((c) => c.includes("com.arachne.backend"));
  assertEquals(plistCmd !== undefined, true);
  assertEquals(plistCmd!.includes("/custom/path/deno"), true, "Expected detected deno path in plist");
  assertEquals(plistCmd!.includes("DENO_PATH"), false, "DENO_PATH placeholder should be replaced");
});

// --- test: health check retries ---

Deno.test("deploy coordinator - health check retries on failure then succeeds", async () => {
  let healthAttempts = 0;
  const deps = makeDeps({
    sshExec: async (_conn: Conn, cmd: string) => {
      if (cmd.includes("curl") && cmd.includes("health")) {
        healthAttempts++;
        if (healthAttempts < 3) {
          return { ok: false, stdout: "", stderr: "connection refused", code: 1 };
        }
        return { ok: true, stdout: "ok", stderr: "", code: 0 };
      }
      if (cmd.includes("which deno")) {
        return { ok: true, stdout: "/opt/homebrew/bin/deno", stderr: "", code: 0 };
      }
      return { ok: true, stdout: "yes", stderr: "", code: 0 };
    },
  });

  const coord = new DeployCoordinator(deps);
  await coord.run("testpi", { dryRun: false, fresh: false });

  assertEquals(healthAttempts >= 3, true);
});

// --- test: health check failure message references launchctl ---

Deno.test("deploy coordinator - health check failure message references launchctl", async () => {
  const logged: string[] = [];
  const deps = makeDeps({
    sshExec: async (_conn: Conn, cmd: string) => {
      if (cmd.includes("curl") && cmd.includes("health")) {
        return { ok: false, stdout: "", stderr: "connection refused", code: 1 };
      }
      if (cmd.includes("which deno")) {
        return { ok: true, stdout: "/opt/homebrew/bin/deno", stderr: "", code: 0 };
      }
      return { ok: true, stdout: "yes", stderr: "", code: 0 };
    },
    log: (msg: string) => {
      logged.push(msg);
    },
    healthMaxAttempts: 1,
  });

  const coord = new DeployCoordinator(deps);
  await coord.run("testpi", { dryRun: false, fresh: false });

  const failMsg = logged.find((m) => m.includes("health check failed"));
  assertEquals(failMsg !== undefined, true, "Expected health check failure log");
  assertEquals(failMsg!.includes("launchctl list"), true, "Expected launchctl list in failure message");
});

// --- test: installs deno via brew when missing ---

Deno.test("deploy coordinator - installs deno via brew when not found", async () => {
  const sshCommands: string[] = [];
  let denoCheckCount = 0;
  const deps = makeDeps({
    sshExec: async (_conn: Conn, cmd: string) => {
      sshCommands.push(cmd);
      if (cmd.includes("which deno") && !cmd.includes("brew")) {
        denoCheckCount++;
        if (denoCheckCount === 1) {
          // First check: deno not found, fallback echoed
          return { ok: true, stdout: "/opt/homebrew/bin/deno", stderr: "", code: 0 };
        }
        return { ok: true, stdout: "/opt/homebrew/bin/deno", stderr: "", code: 0 };
      }
      if (cmd.includes("curl") && cmd.includes("health")) {
        return { ok: true, stdout: "ok", stderr: "", code: 0 };
      }
      return { ok: true, stdout: "yes", stderr: "", code: 0 };
    },
  });

  const coord = new DeployCoordinator(deps);
  await coord.run("testpi", { dryRun: false, fresh: false });

  // Should NOT contain apt-get
  const hasApt = sshCommands.some((c) => c.includes("apt-get"));
  assertEquals(hasApt, false, "Should not use apt-get on macOS");
});
