import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { assertRejects } from "https://deno.land/std@0.224.0/assert/assert_rejects.ts";

// cli.ts resolves paths relative to its own location via import.meta.url.
// These tests reconstruct the same resolution from this file (same directory)
// and verify the targets exist on disk.

const CLI_DIR = new URL("../../", import.meta.url).pathname;

// --- IMAGE_DIR ---

Deno.test("IMAGE_DIR resolves to an existing directory", async () => {
  const imageDir = new URL("../../assets", import.meta.url).pathname;
  const stat = await Deno.stat(imageDir);
  assertEquals(stat.isDirectory, true);
});

Deno.test("IMAGE_DIR contains dietpi.env", async () => {
  const path = new URL("../../assets/dietpi.env", import.meta.url).pathname;
  const stat = await Deno.stat(path);
  assertEquals(stat.isFile, true);
});

Deno.test("IMAGE_DIR contains Automation_Custom_Script.sh", async () => {
  const path = new URL("../../assets/Automation_Custom_Script.sh", import.meta.url).pathname;
  const stat = await Deno.stat(path);
  assertEquals(stat.isFile, true);
});

// --- overclock.json (cli.ts:985) ---
// const path = new URL("../../assets/overclock.json", import.meta.url).pathname;

Deno.test("overclock.json exists and is valid JSON", async () => {
  const path = new URL("../../assets/overclock.json", import.meta.url).pathname;
  const text = await Deno.readTextFile(path);
  const data = JSON.parse(text);
  assertEquals(typeof data, "object");
});

// --- SRC_DIR (cli.ts:902) ---
// const SRC_DIR = new URL("../../../backend", import.meta.url).pathname;

Deno.test("SRC_DIR resolves to an existing directory", async () => {
  const srcDir = new URL("../../../backend", import.meta.url).pathname;
  const stat = await Deno.stat(srcDir);
  assertEquals(stat.isDirectory, true);
});

Deno.test("SRC_DIR contains bootstrap.ts", async () => {
  const path = new URL("../../../backend/bootstrap.ts", import.meta.url).pathname;
  const stat = await Deno.stat(path);
  assertEquals(stat.isFile, true);
});

// --- config.json (cli.ts:50) ---
// Loaded via CLI_DIR + "config.json" — relative to cli.ts location.

Deno.test("config.json exists in CLI directory and is valid JSON", async () => {
  const path = `${CLI_DIR}config.json`;
  const text = await Deno.readTextFile(path);
  const data = JSON.parse(text);
  assertEquals(typeof data, "object");
});

// --- .env (cli.ts:740) ---
// Loaded via CLI_DIR + ".env" — relative to cli.ts location.

Deno.test(".env exists in CLI directory", async () => {
  const path = `${CLI_DIR}.env`;
  const stat = await Deno.stat(path);
  assertEquals(stat.isFile, true);
});

// --- config.example.json exists (for new users) ---

Deno.test("config.example.json exists", async () => {
  const path = `${CLI_DIR}assets/config.example.json`;
  const stat = await Deno.stat(path);
  assertEquals(stat.isFile, true);
});

// --- .env.example exists (for new users) ---

Deno.test(".env.example exists", async () => {
  const path = `${CLI_DIR}assets/.env.example`;
  const stat = await Deno.stat(path);
  assertEquals(stat.isFile, true);
});

// --- cli.ts must use import.meta.url for config files, not CWD-relative paths ---
// Running from the project root (deno task pi) sets CWD to the repo root,
// but config.json / .env / .env.example live in src/cli/. CWD-relative reads break.

Deno.test("cli.ts does not use CWD-relative paths for config files", async () => {
  const source = await Deno.readTextFile(
    new URL("./cli.ts", import.meta.url).pathname,
  );
  const cwdRelative = [
    { pattern: /readTextFileSync\("config\.json"\)/, desc: 'readTextFileSync("config.json")' },
    { pattern: /readTextFileSync\("\.env"\)/, desc: 'readTextFileSync(".env")' },
    { pattern: /Deno\.stat\("\.env"\)/, desc: 'Deno.stat(".env")' },
    { pattern: /copyFile\("assets\/\.env\.example"/, desc: 'copyFile("assets/.env.example", ...)' },
  ];
  for (const { pattern, desc } of cwdRelative) {
    assertEquals(
      pattern.test(source),
      false,
      `Found CWD-relative path in cli.ts: ${desc} — use CLI_DIR + path instead`,
    );
  }
});

Deno.test("deploy service references bootstrap.ts, not main.ts", async () => {
  const source = await Deno.readTextFile(
    new URL("./cli.ts", import.meta.url).pathname,
  );
  const match = source.match(/ExecStart=.*?\.ts/);
  if (!match) throw new Error("No ExecStart with .ts found in cli.ts");
  assertEquals(
    match[0].includes("bootstrap.ts"),
    true,
    `Expected bootstrap.ts in ExecStart but found: ${match[0]}`,
  );
});

// --- Negative: old paths must NOT resolve ---

Deno.test("old IMAGE_DIR path (../../image) does NOT resolve", async () => {
  const oldPath = new URL("../../image", import.meta.url).pathname;
  await assertRejects(
    () => Deno.stat(oldPath),
    Deno.errors.NotFound,
  );
});
