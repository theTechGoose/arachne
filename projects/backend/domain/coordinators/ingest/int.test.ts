import { assertEquals, assertRejects } from "jsr:@std/assert";
import { IngestCoordinator, IngestError } from "./mod.ts";
import { ErrorCode } from "@dto/ingest.ts";
import type { Target } from "@dto/target.ts";
import type { FlowNode } from "@domain/business/flow-builder/mod.ts";

const VALID_TARGET: Target = {
  host: "https://api.example.com",
  route: ["v1", "audio"],
  method: "POST",
  headers: { "Content-Type": "application/json" },
  query: {},
  concurrency: 2,
  timeoutMs: 30000,
  retries: 3,
};

function makeTargets(...names: string[]): Map<string, Target> {
  const map = new Map<string, Target>();
  for (const name of names) {
    map.set(name, { ...VALID_TARGET });
  }
  return map;
}

const MOCK_FLOW_TREE: FlowNode = {
  name: "summarize",
  queueName: "summarize",
  data: {},
  opts: { jobId: "abc123" },
  children: [{
    name: "fetch-audio",
    queueName: "fetch-audio",
    data: {},
    opts: { jobId: "def456" },
  }],
};

const MOCK_ADD_RESULT = {
  flowId: "abc123",
  jobs: [
    { id: "abc123", step: "summarize", queue: "summarize" },
    { id: "def456", step: "fetch-audio", queue: "fetch-audio" },
  ],
  duplicate: false,
};

Deno.test("IngestCoordinator - valid request calls flowBuilder.build and flowProducer.add", async () => {
  let buildCalled = false;
  let addCalled = false;

  const coordinator = new IngestCoordinator({
    targets: makeTargets("fetch-audio", "summarize"),
    flowBuilder: {
      build: async (_params) => {
        buildCalled = true;
        return MOCK_FLOW_TREE;
      },
    },
    flowProducer: {
      add: async (_flowTree) => {
        addCalled = true;
        return MOCK_ADD_RESULT;
      },
    },
  });

  const result = await coordinator.ingest({
    steps: ["fetch-audio", "summarize"],
  });

  assertEquals(buildCalled, true);
  assertEquals(addCalled, true);
  assertEquals(result, MOCK_ADD_RESULT);
});

Deno.test("IngestCoordinator - unknown step throws IngestError with INVALID_STEP", async () => {
  const coordinator = new IngestCoordinator({
    targets: makeTargets("fetch-audio"),
    flowBuilder: {
      build: async () => MOCK_FLOW_TREE,
    },
    flowProducer: {
      add: async () => MOCK_ADD_RESULT,
    },
  });

  const err = await assertRejects(
    () => coordinator.ingest({ steps: ["fetch-audio", "nonexistent"] }),
    IngestError,
  );
  assertEquals((err as IngestError).code, ErrorCode.INVALID_STEP);
  assertEquals((err as IngestError).statusCode, 400);
});

Deno.test("IngestCoordinator - matureAt in the past throws IngestError with INVALID_DATE", async () => {
  const coordinator = new IngestCoordinator({
    targets: makeTargets("fetch-audio"),
    flowBuilder: {
      build: async () => MOCK_FLOW_TREE,
    },
    flowProducer: {
      add: async () => MOCK_ADD_RESULT,
    },
  });

  const pastDate = new Date(Date.now() - 60_000).toISOString();
  const err = await assertRejects(
    () => coordinator.ingest({ steps: ["fetch-audio"], matureAt: pastDate }),
    IngestError,
  );
  assertEquals((err as IngestError).code, ErrorCode.INVALID_DATE);
  assertEquals((err as IngestError).statusCode, 422);
});

Deno.test("IngestCoordinator - flowProducer.add throws wraps as FLOW_CREATION_FAILED", async () => {
  const coordinator = new IngestCoordinator({
    targets: makeTargets("fetch-audio"),
    flowBuilder: {
      build: async () => MOCK_FLOW_TREE,
    },
    flowProducer: {
      add: async () => {
        throw new Error("Redis connection lost");
      },
    },
  });

  const err = await assertRejects(
    () => coordinator.ingest({ steps: ["fetch-audio"] }),
    IngestError,
  );
  assertEquals((err as IngestError).code, ErrorCode.FLOW_CREATION_FAILED);
  assertEquals((err as IngestError).statusCode, 500);
});
