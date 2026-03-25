export interface InstallClientDeps {
  sshExec: (
    host: string,
    port: string,
    user: string,
    cmd: string,
  ) => Promise<{ ok: boolean; stdout: string }>;
  setupKey: (host: string, port: string, user: string) => Promise<void>;
  writeFile: (path: string, content: string) => Promise<void>;
  log: (msg: string) => void;
  configDir: string;
}

export class InstallClientCoordinator {
  constructor(private readonly deps: InstallClientDeps) {}

  async run(connectionString: string): Promise<void> {
    const parsed = this.parseConnectionString(connectionString);

    // Setup SSH key
    await this.deps.setupKey(parsed.host, parsed.port, parsed.user);
    this.deps.log("  ssh key       generated + copied");

    // Find config on remote
    const findRepo = await this.deps.sshExec(
      parsed.host,
      parsed.port,
      parsed.user,
      "find ~/Documents -name 'connectivity.json' -path '*/arachne/*/config/*' 2>/dev/null | head -1",
    );

    if (!findRepo.ok || !findRepo.stdout.trim()) {
      throw new Error(
        "Could not find arachne config on remote host. Make sure 'arachne install --host' was run first.",
      );
    }

    const remotePath = findRepo.stdout.trim().replace(/\/[^/]+\/connectivity\.json$/, "");
    const hostName = findRepo.stdout
      .trim()
      .replace(/\/connectivity\.json$/, "")
      .split("/")
      .pop()!;

    // Pull connectivity.json
    const connectivity = await this.deps.sshExec(
      parsed.host,
      parsed.port,
      parsed.user,
      `cat ${remotePath}/${hostName}/connectivity.json`,
    );

    const users = await this.deps.sshExec(
      parsed.host,
      parsed.port,
      parsed.user,
      `cat ${remotePath}/${hostName}/users.json`,
    );

    // Write locally
    const localPath = `${this.deps.configDir}/${hostName}`;
    await this.deps.writeFile(
      `${localPath}/connectivity.json`,
      connectivity.stdout,
    );
    await this.deps.writeFile(`${localPath}/users.json`, users.stdout);

    this.deps.log("  config/       pulled from host");
    this.deps.log(`\nReady. Try:\n  arachne ${hostName}`);
  }

  parseConnectionString(
    s: string,
  ): { user: string; host: string; port: string } {
    const atIdx = s.indexOf("@");
    if (atIdx < 0) {
      throw new Error(
        `Invalid connection string "${s}". Expected format: user@host:port`,
      );
    }
    const user = s.slice(0, atIdx);
    const rest = s.slice(atIdx + 1);
    const colonIdx = rest.lastIndexOf(":");
    if (colonIdx < 0) {
      throw new Error(
        `Invalid connection string "${s}". Expected format: user@host:port`,
      );
    }
    return {
      user,
      host: rest.slice(0, colonIdx),
      port: rest.slice(colonIdx + 1),
    };
  }
}
