import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { ThresholdChecker } from "./mod.ts";

const checker = new ThresholdChecker();

// --- checkThresholds ---

Deno.test("returns empty warnings when all metrics are within thresholds", () => {
  const warnings = checker.checkThresholds({ cpuTemp: 50, memPercent: 60, diskPercent: 70 });
  assertEquals(warnings, []);
});

Deno.test("warns when CPU temperature exceeds 70C", () => {
  const warnings = checker.checkThresholds({ cpuTemp: 71, memPercent: 60, diskPercent: 70 });
  assertEquals(warnings.length, 1);
  assertEquals(warnings[0].metric, "cpu_temp");
});

Deno.test("warns when memory usage exceeds 85%", () => {
  const warnings = checker.checkThresholds({ cpuTemp: 50, memPercent: 86, diskPercent: 70 });
  assertEquals(warnings.length, 1);
  assertEquals(warnings[0].metric, "memory");
});

Deno.test("warns when disk usage exceeds 85%", () => {
  const warnings = checker.checkThresholds({ cpuTemp: 50, memPercent: 60, diskPercent: 86 });
  assertEquals(warnings.length, 1);
  assertEquals(warnings[0].metric, "disk");
});

Deno.test("returns multiple warnings when multiple thresholds exceeded", () => {
  const warnings = checker.checkThresholds({ cpuTemp: 75, memPercent: 90, diskPercent: 95 });
  assertEquals(warnings.length, 3);
});

Deno.test("does not warn at exactly the threshold boundary", () => {
  const warnings = checker.checkThresholds({ cpuTemp: 70, memPercent: 85, diskPercent: 85 });
  assertEquals(warnings, []);
});

// --- levenshtein ---

Deno.test("levenshtein returns 0 for identical strings", () => {
  assertEquals(checker.levenshtein("status", "status"), 0);
});

Deno.test("levenshtein returns correct distance for single insertion", () => {
  assertEquals(checker.levenshtein("staus", "status"), 1);
});

Deno.test("levenshtein returns correct distance for single deletion", () => {
  assertEquals(checker.levenshtein("statuss", "status"), 1);
});

Deno.test("levenshtein returns correct distance for single substitution", () => {
  assertEquals(checker.levenshtein("stxtus", "status"), 1);
});

Deno.test("levenshtein returns length of b for empty a", () => {
  assertEquals(checker.levenshtein("", "status"), 6);
});

Deno.test("levenshtein returns length of a for empty b", () => {
  assertEquals(checker.levenshtein("status", ""), 6);
});

Deno.test("levenshtein computes distance between completely different strings", () => {
  assertEquals(checker.levenshtein("abc", "xyz"), 3);
});

// --- suggestCommand ---

Deno.test("suggestCommand returns closest match within threshold", () => {
  const known = ["setup", "init", "deploy", "status", "wifi", "overclock", "ui"];
  const result = checker.suggestCommand("statis", known);
  assertEquals(result, "status");
});

Deno.test("suggestCommand returns null when no command is close enough", () => {
  const known = ["setup", "init", "deploy", "status", "wifi", "overclock", "ui"];
  const result = checker.suggestCommand("xyzxyzxyz", known);
  assertEquals(result, null);
});

Deno.test("suggestCommand returns exact match as closest", () => {
  const known = ["setup", "init", "deploy", "status", "wifi", "overclock", "ui"];
  const result = checker.suggestCommand("deploy", known);
  assertEquals(result, "deploy");
});
