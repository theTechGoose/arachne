export class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
}

export function notFound(message: string): never {
  throw new HttpError(404, message);
}

export function badRequest(message: string): never {
  throw new HttpError(400, message);
}

export function conflict(message: string): never {
  throw new HttpError(409, message);
}

export function unauthorized(message: string): never {
  throw new HttpError(401, message);
}

export function internalError(message: string): never {
  throw new HttpError(500, message);
}
