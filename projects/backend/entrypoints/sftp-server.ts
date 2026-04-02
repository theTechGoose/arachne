// deno-lint-ignore-file no-explicit-any
import { Server } from "#ssh2";
import type { UserManager } from "@domain/coordinators/user-manager/mod.ts";
import type { Auth } from "@domain/business/auth/mod.ts";

const STATUS = {
  OK: 0,
  EOF: 1,
  NO_SUCH_FILE: 2,
  PERMISSION_DENIED: 3,
  FAILURE: 4,
  OP_UNSUPPORTED: 8,
} as const;

const OPEN_FLAGS = {
  READ: 0x00000001,
  WRITE: 0x00000002,
  APPEND: 0x00000004,
  CREAT: 0x00000008,
  TRUNC: 0x00000010,
} as const;

const HOME = Deno.env.get("HOME") ?? "/tmp";
const HOST_KEY_PATH = Deno.env.get("SFTP_HOST_KEY_PATH") ??
  `${HOME}/arachne/host_key`;
const SFTP_BASE = Deno.env.get("SFTP_BASE_DIR") ??
  `${HOME}/arachne/sftp`;
const SFTP_PORT = Number(Deno.env.get("SFTP_PORT") ?? "2222");

type SftpServerDeps = {
  userManager: UserManager;
  auth: Auth;
};

export class SftpServer {
  #deps: SftpServerDeps;
  #server: any = null;

  constructor(deps: SftpServerDeps) {
    this.#deps = deps;
  }

  async start(): Promise<void> {
    const hostKey = await this.#ensureHostKey();

    this.#server = new Server({ hostKeys: [hostKey] }, (client: any) => {
      let authedUser = "";

      client.on("authentication", (ctx: any) => {
        if (ctx.method !== "password") {
          return ctx.reject(["password"]);
        }
        this.#deps.userManager
          .authenticate(ctx.username, ctx.password)
          .then((result) => {
            if (!result || !result.permission("sftp")) {
              return ctx.reject();
            }
            authedUser = ctx.username;
            ctx.accept();
          })
          .catch(() => ctx.reject());
      });

      client.on("ready", () => {
        client.on("session", (accept: any) => {
          const session = accept();
          session.on("sftp", (accept: any) => {
            const sftp = accept();
            this.#handleSftp(sftp, authedUser);
          });
        });
      });

      client.on("error", () => {});
    });

    this.#server.listen(SFTP_PORT, "0.0.0.0", () => {
      console.log(`SFTP server listening on port ${SFTP_PORT}`);
    });
  }

  async #ensureHostKey(): Promise<string> {
    const dir = HOST_KEY_PATH.substring(0, HOST_KEY_PATH.lastIndexOf("/"));
    await Deno.mkdir(dir, { recursive: true });

    try {
      const key = await Deno.readTextFile(HOST_KEY_PATH);
      if (key.trim()) return key;
    } catch { /* not found, generate below */ }

    const result = await new Deno.Command("ssh-keygen", {
      args: ["-t", "rsa", "-b", "4096", "-f", HOST_KEY_PATH, "-N", "", "-q"],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!result.success) {
      const err = new TextDecoder().decode(result.stderr);
      throw new Error(`Failed to generate SSH host key: ${err}`);
    }

    return await Deno.readTextFile(HOST_KEY_PATH);
  }

  #handleSftp(sftp: any, username: string): void {
    const userDir = `${SFTP_BASE}/${username}`;
    const handles = new Map<
      string,
      { path: string; file?: Deno.FsFile; isDir: boolean; entries?: string[] }
    >();
    let handleCounter = 0;

    const resolvePath = (reqPath: string): string => {
      const parts = reqPath.replace(/\\/g, "/").split("/").filter(Boolean);
      const safe: string[] = [];
      for (const part of parts) {
        if (part === "..") safe.pop();
        else if (part !== ".") safe.push(part);
      }
      return `${userDir}/${safe.join("/")}`;
    };

    const makeHandle = (): Buffer => {
      const h = Buffer.alloc(4);
      h.writeUInt32BE(handleCounter++, 0);
      return h;
    };

    const statToAttrs = (stat: Deno.FileInfo) => ({
      mode: stat.isDirectory ? 0o040755 : 0o100644,
      uid: 0,
      gid: 0,
      size: stat.size,
      atime: Math.floor((stat.atime?.getTime() ?? Date.now()) / 1000),
      mtime: Math.floor((stat.mtime?.getTime() ?? Date.now()) / 1000),
    });

    sftp.on("REALPATH", (reqid: number, reqPath: string) => {
      const resolved = resolvePath(reqPath);
      const relative = resolved.slice(userDir.length) || "/";
      sftp.name(reqid, [{ filename: relative, longname: relative, attrs: {} }]);
    });

    sftp.on("STAT", async (reqid: number, reqPath: string) => {
      try {
        sftp.attrs(reqid, statToAttrs(await Deno.stat(resolvePath(reqPath))));
      } catch {
        sftp.status(reqid, STATUS.NO_SUCH_FILE);
      }
    });

    sftp.on("LSTAT", async (reqid: number, reqPath: string) => {
      try {
        sftp.attrs(reqid, statToAttrs(await Deno.lstat(resolvePath(reqPath))));
      } catch {
        sftp.status(reqid, STATUS.NO_SUCH_FILE);
      }
    });

    sftp.on("FSTAT", (reqid: number, handle: Buffer) => {
      const entry = handles.get(handle.toString("hex"));
      if (!entry) return sftp.status(reqid, STATUS.FAILURE);
      Deno.stat(entry.path)
        .then((stat) => sftp.attrs(reqid, statToAttrs(stat)))
        .catch(() => sftp.status(reqid, STATUS.FAILURE));
    });

    sftp.on(
      "OPEN",
      async (reqid: number, filename: string, flags: number, _attrs: any) => {
        const path = resolvePath(filename);
        try {
          const dir = path.substring(0, path.lastIndexOf("/"));
          await Deno.mkdir(dir, { recursive: true });
          const file = await Deno.open(path, {
            read: !!(flags & OPEN_FLAGS.READ),
            write: !!(flags & OPEN_FLAGS.WRITE),
            create: !!(flags & OPEN_FLAGS.CREAT),
            truncate: !!(flags & OPEN_FLAGS.TRUNC),
            append: !!(flags & OPEN_FLAGS.APPEND),
          });
          const h = makeHandle();
          handles.set(h.toString("hex"), { path, file, isDir: false });
          sftp.handle(reqid, h);
        } catch {
          sftp.status(reqid, STATUS.FAILURE);
        }
      },
    );

    sftp.on(
      "READ",
      async (reqid: number, handle: Buffer, offset: number, length: number) => {
        const entry = handles.get(handle.toString("hex"));
        if (!entry?.file) return sftp.status(reqid, STATUS.FAILURE);
        try {
          const buf = new Uint8Array(length);
          await entry.file.seek(offset, Deno.SeekMode.Start);
          const n = await entry.file.read(buf);
          if (n === null || n === 0) return sftp.status(reqid, STATUS.EOF);
          sftp.data(reqid, Buffer.from(buf.subarray(0, n)));
        } catch {
          sftp.status(reqid, STATUS.FAILURE);
        }
      },
    );

    sftp.on(
      "WRITE",
      async (reqid: number, handle: Buffer, offset: number, data: Buffer) => {
        const entry = handles.get(handle.toString("hex"));
        if (!entry?.file) return sftp.status(reqid, STATUS.FAILURE);
        try {
          await entry.file.seek(offset, Deno.SeekMode.Start);
          await entry.file.write(data);
          sftp.status(reqid, STATUS.OK);
        } catch {
          sftp.status(reqid, STATUS.FAILURE);
        }
      },
    );

    sftp.on("CLOSE", (reqid: number, handle: Buffer) => {
      const key = handle.toString("hex");
      const entry = handles.get(key);
      if (entry?.file) try { entry.file.close(); } catch { /* ignore */ }
      handles.delete(key);
      sftp.status(reqid, STATUS.OK);
    });

    sftp.on("OPENDIR", async (reqid: number, reqPath: string) => {
      const path = resolvePath(reqPath);
      try {
        await Deno.stat(path);
        const entries: string[] = [];
        for await (const e of Deno.readDir(path)) entries.push(e.name);
        const h = makeHandle();
        handles.set(h.toString("hex"), { path, isDir: true, entries });
        sftp.handle(reqid, h);
      } catch {
        sftp.status(reqid, STATUS.NO_SUCH_FILE);
      }
    });

    sftp.on("READDIR", async (reqid: number, handle: Buffer) => {
      const entry = handles.get(handle.toString("hex"));
      if (!entry?.isDir) return sftp.status(reqid, STATUS.FAILURE);
      const entries = entry.entries ?? [];
      if (entries.length === 0) return sftp.status(reqid, STATUS.EOF);
      const batch = entries.splice(0, 32);
      const names = await Promise.all(
        batch.map(async (name) => {
          try {
            const stat = await Deno.stat(`${entry.path}/${name}`);
            return {
              filename: name,
              longname: `${stat.isDirectory ? "d" : "-"}rwxr-xr-x 1 0 0 ${stat.size} ${name}`,
              attrs: statToAttrs(stat),
            };
          } catch {
            return { filename: name, longname: name, attrs: {} };
          }
        }),
      );
      sftp.name(reqid, names);
    });

    sftp.on("MKDIR", async (reqid: number, reqPath: string) => {
      try {
        await Deno.mkdir(resolvePath(reqPath), { recursive: true });
        sftp.status(reqid, STATUS.OK);
      } catch {
        sftp.status(reqid, STATUS.FAILURE);
      }
    });

    sftp.on("REMOVE", async (reqid: number, reqPath: string) => {
      try {
        await Deno.remove(resolvePath(reqPath));
        sftp.status(reqid, STATUS.OK);
      } catch {
        sftp.status(reqid, STATUS.FAILURE);
      }
    });

    sftp.on("RMDIR", async (reqid: number, reqPath: string) => {
      try {
        await Deno.remove(resolvePath(reqPath), { recursive: true });
        sftp.status(reqid, STATUS.OK);
      } catch {
        sftp.status(reqid, STATUS.FAILURE);
      }
    });

    sftp.on("RENAME", async (reqid: number, oldPath: string, newPath: string) => {
      try {
        await Deno.rename(resolvePath(oldPath), resolvePath(newPath));
        sftp.status(reqid, STATUS.OK);
      } catch {
        sftp.status(reqid, STATUS.FAILURE);
      }
    });

    sftp.on("SETSTAT", (reqid: number) => sftp.status(reqid, STATUS.OK));
    sftp.on("FSETSTAT", (reqid: number) => sftp.status(reqid, STATUS.OK));
  }

  stop(): void {
    this.#server?.close();
  }
}
