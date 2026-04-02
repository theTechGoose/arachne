import { S3Client, PutObjectCommand } from "#aws-sdk/s3";

const HOME = Deno.env.get("HOME") ?? "/tmp";
const SFTP_BASE = Deno.env.get("SFTP_BASE_DIR") ?? `${HOME}/arachne/sftp`;
const S3_BUCKET = Deno.env.get("S3_BUCKET") ?? "";
const AWS_REGION = Deno.env.get("AWS_REGION") ?? "us-east-1";

export class SftpWatcher {
  #s3: S3Client;
  #uploading = new Set<string>();

  constructor() {
    this.#s3 = new S3Client({ region: AWS_REGION });
  }

  async start(): Promise<void> {
    await Deno.mkdir(SFTP_BASE, { recursive: true });
    console.log(`SFTP watcher watching ${SFTP_BASE}`);

    const watcher = Deno.watchFs(SFTP_BASE, { recursive: true });
    for await (const event of watcher) {
      if (event.kind !== "create" && event.kind !== "modify") continue;
      for (const path of event.paths) {
        this.#handlePath(path);
      }
    }
  }

  #handlePath(path: string): void {
    if (this.#uploading.has(path)) return;
    this.#uploading.add(path);
    this.#uploadAndDelete(path).finally(() => this.#uploading.delete(path));
  }

  async #uploadAndDelete(path: string): Promise<void> {
    try {
      let stat: Deno.FileInfo;
      try {
        stat = await Deno.stat(path);
      } catch {
        return; // file already gone
      }
      if (stat.isDirectory) return;

      // Wait briefly for write to finish
      await new Promise((r) => setTimeout(r, 500));

      const data = await Deno.readFile(path);
      const key = path.slice(SFTP_BASE.length).replace(/^\//, "");

      await this.#s3.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          Body: data,
        }),
      );

      await Deno.remove(path);
      await this.#pruneEmptyDirs(path);

      console.log(`Uploaded and removed: ${key}`);
    } catch (err) {
      console.error(`Failed to process ${path}:`, err);
    }
  }

  async #pruneEmptyDirs(filePath: string): Promise<void> {
    let dir = filePath.substring(0, filePath.lastIndexOf("/"));
    while (dir.length > SFTP_BASE.length) {
      try {
        const entries = [];
        for await (const _ of Deno.readDir(dir)) {
          entries.push(true);
          break;
        }
        if (entries.length > 0) break;
        await Deno.remove(dir);
        dir = dir.substring(0, dir.lastIndexOf("/"));
      } catch {
        break;
      }
    }
  }
}
