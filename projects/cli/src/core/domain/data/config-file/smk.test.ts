import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ConfigStore } from "./mod.ts";

// --- helpers ---

async function makeTempConfig(): Promise<{
  baseDir: string;
  cleanup: () => Promise<void>;
}> {
  const baseDir = await Deno.makeTempDir({ prefix: "arachne_cfg_test_" });
  return {
    baseDir,
    cleanup: async () => {
      await Deno.remove(baseDir, { recursive: true });
    },
  };
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await Deno.mkdir(path.substring(0, path.lastIndexOf("/")), {
    recursive: true,
  });
  await Deno.writeTextFile(path, JSON.stringify(data));
}

const VALID_TARGET = {
  host: "https://api.example.com",
  route: ["v1", "audio"],
  method: "POST" as const,
  headers: { "Content-Type": "application/json" },
  query: { format: "mp3" },
  concurrency: 3,
  timeoutMs: 30000,
  retries: 2,
};

// --- loadConnectivity ---

Deno.test("loadConnectivity - returns parsed connectivity.json", async () => {
  const { baseDir, cleanup } = await makeTempConfig();
  try {
    const data = { tcp: "1.tcp.ngrok.io:12345", http: "mypi.ngrok.io" };
    await writeJson(`${baseDir}/pi1/connectivity.json`, data);
    const store = new ConfigStore(baseDir);
    const result = await store.loadConnectivity("pi1");
    assertEquals(result.tcp, "1.tcp.ngrok.io:12345");
    assertEquals(result.http, "mypi.ngrok.io");
  } finally {
    await cleanup();
  }
});

Deno.test("loadConnectivity - throws for missing file", async () => {
  const { baseDir, cleanup } = await makeTempConfig();
  try {
    const store = new ConfigStore(baseDir);
    await assertRejects(() => store.loadConnectivity("nonexistent"));
  } finally {
    await cleanup();
  }
});

// --- loadUsers ---

Deno.test("loadUsers - returns parsed users.json", async () => {
  const { baseDir, cleanup } = await makeTempConfig();
  try {
    const data = { credentials: ["user1:pass1", "user2:pass2"] };
    await writeJson(`${baseDir}/pi1/users.json`, data);
    const store = new ConfigStore(baseDir);
    const result = await store.loadUsers("pi1");
    assertEquals(result.credentials, ["user1:pass1", "user2:pass2"]);
  } finally {
    await cleanup();
  }
});

Deno.test("loadUsers - throws for missing file", async () => {
  const { baseDir, cleanup } = await makeTempConfig();
  try {
    const store = new ConfigStore(baseDir);
    await assertRejects(() => store.loadUsers("nonexistent"));
  } finally {
    await cleanup();
  }
});

// --- loadTargets ---

Deno.test("loadTargets - returns map of validated targets", async () => {
  const { baseDir, cleanup } = await makeTempConfig();
  try {
    await writeJson(`${baseDir}/pi1/targets/tts.json`, VALID_TARGET);
    await writeJson(`${baseDir}/pi1/targets/stt.json`, {
      ...VALID_TARGET,
      host: "https://stt.example.com",
    });
    const store = new ConfigStore(baseDir);
    const targets = await store.loadTargets("pi1");
    assertEquals(targets.size, 2);
    assertEquals(targets.has("tts"), true);
    assertEquals(targets.has("stt"), true);
    assertEquals(targets.get("tts")!.host, "https://api.example.com");
    assertEquals(targets.get("stt")!.host, "https://stt.example.com");
  } finally {
    await cleanup();
  }
});

Deno.test("loadTargets - throws for invalid target JSON", async () => {
  const { baseDir, cleanup } = await makeTempConfig();
  try {
    await writeJson(`${baseDir}/pi1/targets/bad.json`, { host: "not-a-url" });
    const store = new ConfigStore(baseDir);
    await assertRejects(() => store.loadTargets("pi1"));
  } finally {
    await cleanup();
  }
});

Deno.test("loadTargets - throws for missing targets directory", async () => {
  const { baseDir, cleanup } = await makeTempConfig();
  try {
    await Deno.mkdir(`${baseDir}/pi1`, { recursive: true });
    const store = new ConfigStore(baseDir);
    await assertRejects(() => store.loadTargets("pi1"));
  } finally {
    await cleanup();
  }
});

// --- listHosts ---

Deno.test("listHosts - returns subdirectory names", async () => {
  const { baseDir, cleanup } = await makeTempConfig();
  try {
    await Deno.mkdir(`${baseDir}/pi1`, { recursive: true });
    await Deno.mkdir(`${baseDir}/pi2`, { recursive: true });
    const store = new ConfigStore(baseDir);
    const pis = await store.listHosts();
    assertEquals(pis.sort(), ["pi1", "pi2"]);
  } finally {
    await cleanup();
  }
});

Deno.test("listHosts - ignores files, only returns directories", async () => {
  const { baseDir, cleanup } = await makeTempConfig();
  try {
    await Deno.mkdir(`${baseDir}/pi1`, { recursive: true });
    await Deno.writeTextFile(`${baseDir}/README.md`, "ignore me");
    const store = new ConfigStore(baseDir);
    const pis = await store.listHosts();
    assertEquals(pis, ["pi1"]);
  } finally {
    await cleanup();
  }
});

Deno.test("listHosts - returns empty array for empty config dir", async () => {
  const { baseDir, cleanup } = await makeTempConfig();
  try {
    const store = new ConfigStore(baseDir);
    const pis = await store.listHosts();
    assertEquals(pis, []);
  } finally {
    await cleanup();
  }
});

// --- readDotEnv ---

Deno.test("readDotEnv - parses key=value pairs", async () => {
  const { baseDir, cleanup } = await makeTempConfig();
  try {
    await Deno.writeTextFile(
      `${baseDir}/.env`,
      "NGROK_AUTHTOKEN=abc123\nOTHER=val\n# comment\n\n",
    );
    const store = new ConfigStore(baseDir);
    const env = await store.readDotEnv();
    assertEquals(env.get("NGROK_AUTHTOKEN"), "abc123");
    assertEquals(env.get("OTHER"), "val");
    assertEquals(env.has("# comment"), false);
  } finally {
    await cleanup();
  }
});

Deno.test("readDotEnv - throws for missing .env file", async () => {
  const { baseDir, cleanup } = await makeTempConfig();
  try {
    const store = new ConfigStore(baseDir);
    await assertRejects(() => store.readDotEnv());
  } finally {
    await cleanup();
  }
});
