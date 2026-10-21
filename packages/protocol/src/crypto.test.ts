import { describe, expect, it } from "vitest";
import {
  formatToken,
  generateNonce,
  generateSecret,
  generateWorkerId,
  masterProof,
  parseToken,
  proofsMatch,
  workerProof,
} from "./crypto.js";

describe("tokens", () => {
  it("round-trips id and secret", () => {
    const id = generateWorkerId();
    const secret = generateSecret();
    expect(parseToken(formatToken(id, secret))).toEqual({ workerId: id, secret });
  });

  it("generates unique, well-formed values", () => {
    expect(generateWorkerId()).toMatch(/^w[0-9a-f]{16}$/);
    expect(generateSecret()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set(Array.from({ length: 50 }, generateNonce)).size).toBe(50);
    expect(generateSecret()).not.toBe(generateSecret());
  });

  it.each([
    "",
    "nodot",
    "w123.abc",
    `${generateWorkerId()}.short`,
    `x${generateWorkerId()}.${generateSecret()}`,
    `${generateWorkerId()}.${generateSecret()}!`,
  ])("rejects malformed token %j", (t) => {
    expect(parseToken(t)).toBeNull();
  });
});

describe("handshake proofs", () => {
  const secret = generateSecret();
  const nw = generateNonce();
  const nm = generateNonce();

  it("both sides compute the same proof from the same inputs", () => {
    expect(proofsMatch(masterProof(secret, nw, nm), masterProof(secret, nw, nm))).toBe(true);
    expect(proofsMatch(workerProof(secret, nw, nm), workerProof(secret, nw, nm))).toBe(true);
  });

  it("rejects a wrong secret", () => {
    expect(proofsMatch(masterProof(secret, nw, nm), masterProof(generateSecret(), nw, nm))).toBe(false);
    expect(proofsMatch(workerProof(secret, nw, nm), workerProof(generateSecret(), nw, nm))).toBe(false);
  });

  it("cannot reflect one side's proof as the other's", () => {
    expect(proofsMatch(masterProof(secret, nw, nm), workerProof(secret, nw, nm))).toBe(false);
  });

  it("binds to both nonces (replay with a fresh nonce fails)", () => {
    expect(proofsMatch(workerProof(secret, nw, nm), workerProof(secret, nw, generateNonce()))).toBe(false);
    expect(proofsMatch(workerProof(secret, nw, nm), workerProof(secret, generateNonce(), nm))).toBe(false);
    expect(proofsMatch(workerProof(secret, nw, nm), workerProof(secret, nm, nw))).toBe(false);
  });

  it("never throws on length mismatches", () => {
    expect(proofsMatch(masterProof(secret, nw, nm), "abc")).toBe(false);
    expect(proofsMatch(masterProof(secret, nw, nm), "")).toBe(false);
  });
});
