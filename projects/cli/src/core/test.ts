import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";

// cli.ts resolves paths relative to its own location via import.meta.url.
// These tests reconstruct the same resolution from this file (same directory)
// and verify the targets exist on disk.

const CLI_DIR = new URL("../../", import.meta.url).pathname;

// --- PROJECT_ROOT paths ---

Deno.test("backend directory resolves from project root", async () => {
  const backendDir = new URL("../../../backend", import.meta.url).pathname;
  const stat = await Deno.stat(backendDir);
  assertEquals(stat.isDirectory, true);
});

Deno.test("ui directory resolves from project root", async () => {
  const uiDir = new URL("../../../ui", import.meta.url).pathname;
  const stat = await Deno.stat(uiDir);
  assertEquals(stat.isDirectory, true);
});

// --- config directory structure ---
// Config files are now per-pi under CLI_DIR/config/<pi>/
// The config/ directory is gitignored (contains pi-specific data).
// cli.ts passes CONFIG_DIR = CLI_DIR + "config" to ConfigStore.

Deno.test("CONFIG_DIR is defined relative to CLI_DIR", async () => {
  const source = await Deno.readTextFile(
    new URL("./cli.ts", import.meta.url).pathname,
  );
  assertEquals(
    source.includes('CLI_DIR + "config"'),
    true,
    "Expected CONFIG_DIR to be defined as CLI_DIR + 'config'",
  );
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

Deno.test("deploy coordinator plist definitions reference main.ts", async () => {
  const source = await Deno.readTextFile(
    new URL("./domain/coordinators/deploy/mod.ts", import.meta.url).pathname,
  );
  assertEquals(
    source.includes("com.arachne.backend"),
    true,
    "Expected com.arachne.backend label in plist",
  );
  assertEquals(
    source.includes("com.arachne.ui"),
    true,
    "Expected com.arachne.ui label in plist",
  );
  // Both plists should reference main.ts in ProgramArguments
  const mainTsMatches = [...source.matchAll(/main\.ts/g)];
  assertEquals(
    mainTsMatches.length >= 2,
    true,
    `Expected at least 2 main.ts references (backend + ui) but found ${mainTsMatches.length}`,
  );
});

