import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { customAlphabet } from "npm:nanoid@5.0.9";

const ALPH = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const rand = customAlphabet(ALPH, 5);

export class AuthHmac {
  private getSecret(): Buffer {
    const secret = Deno.env.get("CODE_SECRET") ?? "replace-me-with-32B-secret";
    return Buffer.from(secret);
  }

  private tag(email: string, R: string, tagLen = 5): string {
    return createHmac("sha256", this.getSecret())
      .update(`${email}.${R}`)
      .digest("base64url")
      .slice(0, tagLen);
  }

  mint(email: string): string {
    const R = rand();
    const T = this.tag(email, R);
    return R + T;
  }

  verify(email: string, code: string): boolean {
    if (typeof code !== "string" || code.length !== 10) {
      return false;
    }

    const R = code.slice(0, 5);
    const T = code.slice(5);
    const expected = this.tag(email, R);

    try {
      return timingSafeEqual(Buffer.from(T), Buffer.from(expected));
    } catch {
      return false;
    }
  }
}
