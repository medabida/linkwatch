import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const WORKER_ID = /^w[0-9a-f]{16}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

export const generateWorkerId = (): string => `w${randomBytes(8).toString("hex")}`;
/** 32 random bytes, base64url (43 chars). */
export const generateSecret = (): string => randomBytes(32).toString("base64url");
export const generateNonce = (): string => randomBytes(24).toString("base64url");

export const formatToken = (workerId: string, secret: string): string => `${workerId}.${secret}`;

export function parseToken(token: string): { workerId: string; secret: string } | null {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const workerId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  return WORKER_ID.test(workerId) && SECRET.test(secret) ? { workerId, secret } : null;
}

type Role = "master" | "worker";

/**
 * HMAC-SHA256 over role + both nonces. The role is part of the message, so a proof made
 * by one side can never be reflected back as the other side's proof.
 */
function proof(role: Role, secret: string, nonceWorker: string, nonceMaster: string): string {
  return createHmac("sha256", secret).update(`${role}|${nonceWorker}|${nonceMaster}`).digest("hex");
}

export const masterProof = (secret: string, nonceWorker: string, nonceMaster: string) => proof("master", secret, nonceWorker, nonceMaster);
export const workerProof = (secret: string, nonceWorker: string, nonceMaster: string) => proof("worker", secret, nonceWorker, nonceMaster);

/** Constant-time comparison of two hex proofs. */
export function proofsMatch(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
