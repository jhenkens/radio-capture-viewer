import crypto from "crypto";
import type { IncomingMessage } from "http";

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** True when the Authorization header carries HTTP Basic credentials with this password (username ignored). */
export function checkBasicAuth(header: string | undefined, password: string): boolean {
  if (!header?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  if (idx < 0) return false;
  return safeEqual(decoded.slice(idx + 1), password);
}

export function isAuthorizedRequest(req: IncomingMessage, password: string): boolean {
  return checkBasicAuth(req.headers["authorization"], password);
}
