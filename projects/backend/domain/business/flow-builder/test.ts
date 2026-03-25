import { assertEquals } from "jsr:@std/assert";
import { FlowBuilder } from "./mod.ts";
import type { FlowNode } from "./mod.ts";
import type { Target } from "@dto/target.ts";
import { MergeRules } from "../merge-rules/mod.ts";

const mergeRules = new MergeRules();

let idCounter = 0;
function fakeGenerateId(
  _body: unknown,
  _nonce: string,
  stepName: string,
): Promise<string> {
  idCounter++;
  return Promise.resolve(`hash-${stepName}-${idCounter}`);
}

function makeTarget(overrides: Partial<Target> = {}): Target {
  return {
    host: "https://api.example.com",
    route: ["v1", "data"],
    method: "POST",
    headers: { "content-type": "application/json" },
    query: {},
    concurrency: 5,
    timeoutMs: 10000,
    retries: 3,
    ...overrides,
  };
}

function setup() {
  idCounter = 0;
  return new FlowBuilder({ generateId: fakeGenerateId, mergeRules });
}

// --- Single step flow ---

Deno.test("FlowBuilder - single step flow: root with no children", async () => {
  const builder = setup();
  const targets = new Map<string, Target>([["stepA", makeTarget()]]);

  const tree = await builder.build({
    steps: ["stepA"],
    targets,
    nonce: "n1",
    body: { data: "test" },
  });

  assertEquals(tree.name, "stepA");
  assertEquals(tree.queueName, "stepA");
  assertEquals(tree.children, undefined);
});

Deno.test("FlowBuilder - single step flow: opts include jobId, attempts, backoff, retention", async () => {
  const builder = setup();
  const targets = new Map<string, Target>([["stepA", makeTarget({ retries: 2 })]]);

  const tree = await builder.build({
    steps: ["stepA"],
    targets,
    nonce: "n1",
    body: {},
  });

  assertEquals(tree.opts.jobId, "hash-stepA-1");
  assertEquals(tree.opts.attempts, 3); // retries + 1
  assertEquals(tree.opts.backoff, { type: "exponential", delay: 180_000 });
  assertEquals(tree.opts.removeOnComplete, { age: 86400 });
  assertEquals(tree.opts.removeOnFail, { age: 86400 });
});

Deno.test("FlowBuilder - single step flow: data includes merged payload", async () => {
  const builder = setup();
  const targets = new Map<string, Target>([
    ["stepA", makeTarget({ route: ["base"], headers: { "x-a": "1" }, query: { q: "default" } })],
  ]);

  const tree = await builder.build({
    steps: ["stepA"],
    targets,
    payload: { route: ["extra"], headers: { "x-b": "2" }, body: { msg: "hello" } },
  });

  assertEquals(tree.data.route, ["base", "extra"]);
  assertEquals(tree.data.method, "POST");
  assertEquals(tree.data.headers, { "x-a": "1", "x-b": "2" });
  assertEquals(tree.data.query, { q: "default" });
  assertEquals(tree.data.body, { msg: "hello" });
});

// --- Two-step flow ---

Deno.test("FlowBuilder - two-step flow: root has one child", async () => {
  const builder = setup();
  const targets = new Map<string, Target>([
    ["A", makeTarget()],
    ["B", makeTarget()],
  ]);

  const tree = await builder.build({
    steps: ["A", "B"],
    targets,
    nonce: "n",
  });

  // B is root (last step), A is child (first step = deepest leaf)
  assertEquals(tree.name, "B");
  assertEquals(tree.queueName, "B");
  assertEquals(tree.children?.length, 1);
  assertEquals(tree.children![0].name, "A");
  assertEquals(tree.children![0].queueName, "A");
  assertEquals(tree.children![0].children, undefined);
});

// --- Three-step flow ---

Deno.test("FlowBuilder - three-step flow: A is deepest leaf, C is root", async () => {
  const builder = setup();
  const targets = new Map<string, Target>([
    ["A", makeTarget()],
    ["B", makeTarget()],
    ["C", makeTarget()],
  ]);

  const tree = await builder.build({
    steps: ["A", "B", "C"],
    targets,
    nonce: "n",
  });

  // C is root
  assertEquals(tree.name, "C");
  // B is C's child
  assertEquals(tree.children?.length, 1);
  assertEquals(tree.children![0].name, "B");
  // A is B's child (deepest leaf)
  assertEquals(tree.children![0].children?.length, 1);
  assertEquals(tree.children![0].children![0].name, "A");
  assertEquals(tree.children![0].children![0].children, undefined);
});

// --- Step 0 data vs steps 1+ data ---

Deno.test("FlowBuilder - step 0 gets merged payload data, steps 1+ get empty object", async () => {
  const builder = setup();
  const targets = new Map<string, Target>([
    ["A", makeTarget()],
    ["B", makeTarget()],
    ["C", makeTarget()],
  ]);

  const tree = await builder.build({
    steps: ["A", "B", "C"],
    targets,
    payload: { body: { msg: "hello" } },
  });

  // C is root (step 2), B is middle (step 1), A is leaf (step 0)
  const stepC = tree;
  const stepB = tree.children![0];
  const stepA = tree.children![0].children![0];

  // Step 0 (A) has merged data
  assertEquals(stepA.data.body, { msg: "hello" });
  // Steps 1+ have empty data
  assertEquals(Object.keys(stepB.data).length, 0);
  assertEquals(Object.keys(stepC.data).length, 0);
});

// --- matureAt sets delay on deepest leaf ---

Deno.test("FlowBuilder - matureAt sets delay on deepest leaf only", async () => {
  const builder = setup();
  const targets = new Map<string, Target>([
    ["A", makeTarget()],
    ["B", makeTarget()],
  ]);

  // Set matureAt to 10 seconds from now
  const futureDate = new Date(Date.now() + 10_000).toISOString();

  const tree = await builder.build({
    steps: ["A", "B"],
    targets,
    matureAt: futureDate,
  });

  // B is root, A is leaf
  const stepA = tree.children![0];

  // Step A (deepest leaf) should have a delay > 0
  const delay = stepA.opts.delay as number;
  assertEquals(delay > 0, true);
  assertEquals(delay <= 10_000, true);

  // Root B should NOT have a delay
  assertEquals(tree.opts.delay, undefined);
});

Deno.test("FlowBuilder - matureAt in the past sets delay to 0", async () => {
  const builder = setup();
  const targets = new Map<string, Target>([
    ["A", makeTarget()],
  ]);

  const pastDate = new Date(Date.now() - 60_000).toISOString();

  const tree = await builder.build({
    steps: ["A"],
    targets,
    matureAt: pastDate,
  });

  assertEquals(tree.opts.delay, 0);
});

Deno.test("FlowBuilder - no matureAt means no delay property", async () => {
  const builder = setup();
  const targets = new Map<string, Target>([
    ["A", makeTarget()],
  ]);

  const tree = await builder.build({
    steps: ["A"],
    targets,
  });

  assertEquals(tree.opts.delay, undefined);
});

// --- Each node has correct opts ---

Deno.test("FlowBuilder - each node has correct attempts based on its target retries", async () => {
  const builder = setup();
  const targets = new Map<string, Target>([
    ["A", makeTarget({ retries: 1 })],
    ["B", makeTarget({ retries: 5 })],
  ]);

  const tree = await builder.build({
    steps: ["A", "B"],
    targets,
    nonce: "n",
  });

  // B is root (retries: 5), A is child (retries: 1)
  assertEquals(tree.opts.attempts, 6); // 5 + 1
  assertEquals(tree.children![0].opts.attempts, 2); // 1 + 1
});
