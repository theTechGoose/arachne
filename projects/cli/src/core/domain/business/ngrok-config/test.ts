import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { NgrokConfigBuilder } from "./mod.ts";

const builder = new NgrokConfigBuilder();

Deno.test("buildYaml generates basic ngrok config without auth", () => {
  const yaml = builder.buildYaml({
    authtoken: "tok_abc123",
    tcpUrl: "3.tcp.ngrok.io:21045",
    httpDomain: "deploy.ngrok.app",
  });
  assertEquals(yaml.includes("authtoken: tok_abc123"), true);
  assertEquals(yaml.includes("proto: tcp"), true);
  assertEquals(yaml.includes("addr: 22"), true);
  assertEquals(yaml.includes("url: 3.tcp.ngrok.io:21045"), true);
  assertEquals(yaml.includes("proto: http"), true);
  assertEquals(yaml.includes("addr: 80"), true);
  assertEquals(yaml.includes("domain: deploy.ngrok.app"), true);
  assertEquals(yaml.includes("basic_auth"), false);
});

Deno.test("buildYaml includes basic_auth when httpAuth has entries", () => {
  const yaml = builder.buildYaml({
    authtoken: "tok_abc123",
    tcpUrl: "3.tcp.ngrok.io:21045",
    httpDomain: "deploy.ngrok.app",
    httpAuth: ["testy:testy123"],
  });
  assertEquals(yaml.includes("basic_auth:"), true);
  assertEquals(yaml.includes("- \"testy:testy123\""), true);
});

Deno.test("buildYaml includes multiple basic_auth entries", () => {
  const yaml = builder.buildYaml({
    authtoken: "tok_abc123",
    tcpUrl: "3.tcp.ngrok.io:21045",
    httpDomain: "deploy.ngrok.app",
    httpAuth: ["user1:pass1", "user2:pass2"],
  });
  assertEquals(yaml.includes("- \"user1:pass1\""), true);
  assertEquals(yaml.includes("- \"user2:pass2\""), true);
});

Deno.test("buildYaml skips basic_auth for empty array", () => {
  const yaml = builder.buildYaml({
    authtoken: "tok_abc123",
    tcpUrl: "3.tcp.ngrok.io:21045",
    httpDomain: "deploy.ngrok.app",
    httpAuth: [],
  });
  assertEquals(yaml.includes("basic_auth"), false);
});
