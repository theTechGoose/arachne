export interface InstallHostDeps {
  prompt: (message: string) => string | null;
  exec: (cmd: string) => Promise<{ ok: boolean; stdout: string; stderr: string }>;
  writeFile: (path: string, content: string) => Promise<void>;
  readFile: (path: string) => Promise<string>;
  log: (msg: string) => void;
  configDir: string;
}

export class InstallHostCoordinator {
  constructor(private readonly deps: InstallHostDeps) {}

  async run(): Promise<void> {
    // Phase 1: Interactive prompts
    const name = this.deps.prompt("Name for this host:");
    if (!name) throw new Error("Name is required");
    const tcpUrl = this.deps.prompt("TCP URL (ngrok fixed address):");
    if (!tcpUrl) throw new Error("TCP URL is required");
    const httpUrl = this.deps.prompt("HTTP URL (ngrok domain):");
    if (!httpUrl) throw new Error("HTTP URL is required");
    const authUser = this.deps.prompt("First basic auth user (user:pass):");
    if (!authUser) throw new Error("Basic auth user is required");
    const authtoken = this.deps.prompt("ngrok authtoken:");
    if (!authtoken) throw new Error("Authtoken is required");

    // Phase 2: Create config
    const configPath = `${this.deps.configDir}/${name}`;
    await this.deps.exec(`mkdir -p ${configPath}/targets`);
    await this.deps.writeFile(
      `${configPath}/connectivity.json`,
      JSON.stringify({ tcp: tcpUrl, http: httpUrl }, null, 2),
    );
    await this.deps.writeFile(
      `${configPath}/users.json`,
      JSON.stringify({ credentials: [authUser] }, null, 2),
    );
    await this.deps.writeFile(
      `${this.deps.configDir}/.env`,
      `NGROK_AUTHTOKEN=${authtoken}\n`,
    );
    this.deps.log("  config/       created");

    // Phase 3: Dependencies (idempotent)
    await this.installIfMissing(
      "brew",
      '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
    );
    const brewPath = await this.findBrew();
    await this.installIfMissing("ngrok", `${brewPath} install ngrok`);
    await this.installIfMissing("redis-server", `${brewPath} install redis`);
    await this.installIfMissing("deno", `${brewPath} install deno`);

    // Phase 4: Configure ngrok
    await this.deps.exec(`ngrok config add-authtoken ${authtoken}`);
    this.deps.log("  ngrok         configured");

    // Phase 5: System config
    await this.deps.exec("sudo systemsetup -setremotelogin on 2>/dev/null || true");
    this.deps.log("  ssh           Remote Login enabled");
    await this.deps.exec("sudo pmset -a disablesleep 1");
    this.deps.log("  sleep         disabled");
    await this.deps.exec("sudo mkdir -p /usr/local/var/arachne/{backend,ui,targets,logs}");
    await this.deps.exec("sudo chown -R $(whoami) /usr/local/var/arachne");
    this.deps.log("  app dirs      created");

    // Phase 6: Restart ngrok + redis
    await this.deps.exec(
      "sudo launchctl unload /Library/LaunchDaemons/com.ngrok.tunnel.plist 2>/dev/null || true",
    );
    await this.deps.exec(
      "sudo launchctl load -w /Library/LaunchDaemons/com.ngrok.tunnel.plist",
    );
    this.deps.log("  ngrok         restarted");
    await this.deps.exec(`${brewPath} services restart redis`);
    this.deps.log("  redis         restarted");

    // Phase 7: Verify tunnels
    let verified = false;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const tunnels = await this.deps.exec("curl -s localhost:4040/api/tunnels");
      if (tunnels.ok && tunnels.stdout.includes("tcp://")) {
        verified = true;
        break;
      }
    }

    if (verified) {
      const stripped = tcpUrl.replace(/^tcp:\/\//, "");
      this.deps.log(`\nDone. On your client machine run:\n`);
      this.deps.log(
        `  deno task install --client="$(whoami)@${stripped}"\n`,
      );
    } else {
      throw new Error("Tunnel verification failed. Check ngrok logs.");
    }
  }

  private async installIfMissing(
    bin: string,
    installCmd: string,
  ): Promise<void> {
    const check = await this.deps.exec(`which ${bin}`);
    if (check.ok) {
      this.deps.log(`  ${bin.padEnd(14)}already installed`);
      return;
    }
    this.deps.log(`  ${bin.padEnd(14)}installing...`);
    const result = await this.deps.exec(installCmd);
    if (!result.ok) {
      throw new Error(`Failed to install ${bin}: ${result.stderr}`);
    }
    this.deps.log(`  ${bin.padEnd(14)}installed`);
  }

  private async findBrew(): Promise<string> {
    const which = await this.deps.exec("which brew");
    if (which.ok) return which.stdout.trim();
    return "/opt/homebrew/bin/brew";
  }
}
