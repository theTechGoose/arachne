import { assertEquals } from "jsr:@std/assert";
import { IngestController } from "./ingest-controller.ts";
import { IngestError } from "@domain/coordinators/ingest/mod.ts";
import { ErrorCode } from "@dto/ingest.ts";
import type { IngestResponse } from "@dto/ingest.ts";

const MOCK_RESPONSE: IngestResponse = {
  flowId: "abc123",
  jobs: [
    { id: "abc123", step: "summarize", queue: "summarize" },
    { id: "def456", step: "fetch-audio", queue: "fetch-audio" },
  ],
  duplicate: false,
};

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("IngestController - valid request returns 200 with response body", async () => {
  const controller = new IngestController({
    ingest: async () => MOCK_RESPONSE,
  });

  const req = makeRequest({ steps: ["fetch-audio", "summarize"] });
  const res = await controller.handle(req);
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body, MOCK_RESPONSE);
});

Deno.test("IngestController - invalid JSON returns 400", async () => {
  const controller = new IngestController({
    ingest: async () => MOCK_RESPONSE,
  });

  const req = new Request("http://localhost/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not valid json{{{",
  });
  const res = await controller.handle(req);
  const body = await res.json();

  assertEquals(res.status, 400);
  assertEquals(body.error, ErrorCode.EMPTY_STEPS);
});

Deno.test("IngestController - empty steps returns 400 with EMPTY_STEPS", async () => {
  const controller = new IngestController({
    ingest: async () => MOCK_RESPONSE,
  });

  const req = makeRequest({ steps: [] });
  const res = await controller.handle(req);
  const body = await res.json();

  assertEquals(res.status, 400);
  assertEquals(body.error, ErrorCode.EMPTY_STEPS);
});

Deno.test("IngestController - missing steps returns 400 with EMPTY_STEPS", async () => {
  const controller = new IngestController({
    ingest: async () => MOCK_RESPONSE,
  });

  const req = makeRequest({});
  const res = await controller.handle(req);
  const body = await res.json();

  assertEquals(res.status, 400);
  assertEquals(body.error, ErrorCode.EMPTY_STEPS);
});

Deno.test("IngestController - invalid payload fields returns 422 with INVALID_PAYLOAD", async () => {
  const controller = new IngestController({
    ingest: async () => MOCK_RESPONSE,
  });

  const req = makeRequest({
    steps: ["fetch-audio"],
    payload: { host: "http://evil.com" },
  });
  const res = await controller.handle(req);
  const body = await res.json();

  assertEquals(res.status, 422);
  assertEquals(body.error, ErrorCode.INVALID_PAYLOAD);
});

Deno.test("IngestController - IngestError INVALID_STEP returns 400", async () => {
  const controller = new IngestController({
    ingest: async () => {
      throw new IngestError(ErrorCode.INVALID_STEP, "Unknown steps: bad-step", 400);
    },
  });

  const req = makeRequest({ steps: ["bad-step"] });
  const res = await controller.handle(req);
  const body = await res.json();

  assertEquals(res.status, 400);
  assertEquals(body.error, ErrorCode.INVALID_STEP);
  assertEquals(body.statusCode, 400);
});

Deno.test("IngestController - IngestError INVALID_DATE returns 422", async () => {
  const controller = new IngestController({
    ingest: async () => {
      throw new IngestError(ErrorCode.INVALID_DATE, "matureAt must not be in the past", 422);
    },
  });

  const req = makeRequest({
    steps: ["fetch-audio"],
    matureAt: "2020-01-01T00:00:00Z",
  });
  const res = await controller.handle(req);
  const body = await res.json();

  assertEquals(res.status, 422);
  assertEquals(body.error, ErrorCode.INVALID_DATE);
  assertEquals(body.statusCode, 422);
});

Deno.test("IngestController - unexpected error returns 500 with FLOW_CREATION_FAILED", async () => {
  const controller = new IngestController({
    ingest: async () => {
      throw new Error("something unexpected");
    },
  });

  const req = makeRequest({ steps: ["fetch-audio"] });
  const res = await controller.handle(req);
  const body = await res.json();

  assertEquals(res.status, 500);
  assertEquals(body.error, ErrorCode.FLOW_CREATION_FAILED);
  assertEquals(body.statusCode, 500);
});
