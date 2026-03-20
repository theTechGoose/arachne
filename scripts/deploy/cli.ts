import { Command } from "https://deno.land/x/cliffy@v1.0.0-rc.4/command/mod.ts";

const SSH_HOST = "3.tcp.ngrok.io";
const SSH_PORT = "21045";
const SSH_USER = "root";
const KEY_PATH = `${Deno.env.get("HOME")}/.ssh/arachne_ed25519`;

async function needsSetup(): Promise<boolean> {
  try {
    await Deno.stat(KEY_PATH);
  } catch {
    return true;
  }

  const cmd = new Deno.Command("ssh", {
    args: [
      "-i", KEY_PATH,
      "-p", SSH_PORT,
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=5",
      `${SSH_USER}@${SSH_HOST}`,
      "echo ok",
    ],
    stdout: "piped",
    stderr: "piped",
  });

  const { success } = await cmd.spawn().status;
  return !success;
}

async function runSetup() {
  console.log("SSH not configured. Running setup first...\n");
  const setupScript = new URL("../setup/cli.ts", import.meta.url).pathname;
  const proc = new Deno.Command("deno", {
    args: ["run", "--allow-run", "--allow-env", "--allow-read", setupScript],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const { success } = await proc.spawn().status;
  if (!success) {
    console.error("Setup failed.");
    Deno.exit(1);
  }
  console.log("");
}

await new Command()
  .name("deploy")
  .description("Deploy arachne to Pi")
  .action(async () => {
    if (await needsSetup()) {
      await runSetup();
    }

    console.log("Deploying...");
    const proc = new Deno.Command("ssh", {
      args: [
        "-i", KEY_PATH,
        "-p", SSH_PORT,
        "-o", "BatchMode=yes",
        `${SSH_USER}@${SSH_HOST}`,
        "echo 'Connected successfully'",
      ],
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const status = await proc.spawn().status;
    Deno.exit(status.code);
  })
  .parse(Deno.args);
