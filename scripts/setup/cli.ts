import { Command } from "https://deno.land/x/cliffy@v1.0.0-rc.4/command/mod.ts";

const SSH_HOST = "3.tcp.ngrok.io";
const SSH_PORT = "21045";
const SSH_USER = "root";
const KEY_PATH = `${Deno.env.get("HOME")}/.ssh/arachne_ed25519`;

async function run(cmd: string[]) {
  const proc = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await proc.spawn().status;
  if (!status.success) {
    throw new Error(`Command failed: ${cmd.join(" ")}`);
  }
}

await new Command()
  .name("setup")
  .description("SSH key setup for arachne deployment")
  .action(async () => {
    try {
      await Deno.stat(KEY_PATH);
      console.log(`Key already exists at ${KEY_PATH}, skipping generation.`);
    } catch {
      console.log("Generating SSH key...");
      await run([
        "ssh-keygen", "-t", "ed25519",
        "-f", KEY_PATH,
        "-N", "",
        "-C", "arachne-deploy",
      ]);
    }

    console.log(`\nCopying key to ${SSH_USER}@${SSH_HOST}:${SSH_PORT}...`);
    console.log("You will be prompted for the password.\n");

    await run([
      "ssh-copy-id",
      "-i", KEY_PATH,
      "-p", SSH_PORT,
      `${SSH_USER}@${SSH_HOST}`,
    ]);

    console.log("\nSetup complete. Testing connection...\n");

    await run([
      "ssh",
      "-i", KEY_PATH,
      "-p", SSH_PORT,
      "-o", "BatchMode=yes",
      `${SSH_USER}@${SSH_HOST}`,
      "echo 'Connection successful'",
    ]);
  })
  .parse(Deno.args);
