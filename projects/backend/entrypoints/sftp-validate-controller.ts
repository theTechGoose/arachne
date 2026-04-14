import { PathValidatorCoordinator } from "../coordinators/mod.ts";

const coordinator = new PathValidatorCoordinator();

export class SftpValidateController {
  async handle(req: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return response(400, "Invalid JSON in request body");
    }

    if (typeof body !== "object" || body === null || !("file_path" in body)) {
      return response(400, "Missing required field: file_path");
    }

    const filePath = (body as Record<string, unknown>).file_path;
    if (typeof filePath !== "string") {
      return response(400, "file_path must be a string");
    }

    console.log("[sftp-validate] received file_path:", filePath);

    try {
      coordinator.validate(decodeURIComponent(filePath));
      return response(200, "OK");
    } catch (err) {
      return response(400, (err as Error).message);
    }
  }
}

function response(status: number, message: string): Response {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
