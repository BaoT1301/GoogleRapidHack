import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, getSecretValue } from "./vault";
import { secretsRouter } from "../routers/secrets";
import { connectDB, disconnectDB } from "../../db/client";
import { SecretModel } from "../../db/models/secret.model";

const ME = "test_user_p6_secrets";

beforeAll(async () => {
  process.env.VAULT_PASSPHRASE = "test-passphrase";
  await connectDB();
  await SecretModel.deleteMany({ ownerId: ME });
});

afterAll(async () => {
  await SecretModel.deleteMany({ ownerId: ME });
  await disconnectDB();
});

/** Produce a pre-SEC-1 legacy (unsalted sha256) ciphertext for the given passphrase. */
function legacyEncrypt(plaintext: string, passphrase: string): { ciphertext: string; nonce: string } {
  const key = createHash("sha256").update(passphrase).digest();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([enc, tag]).toString("base64"),
    nonce: nonce.toString("base64"),
  };
}

describe("vault crypto (SEC-1 scrypt)", () => {
  it("round-trips encrypt → decrypt under scrypt", () => {
    const enc = encryptSecret("sk-secret-123");
    expect(enc.kdf).toBe("scrypt");
    expect(enc.salt.length).toBeGreaterThan(0);
    expect(decryptSecret(enc)).toBe("sk-secret-123");
  });

  it("uses a fresh nonce AND a fresh salt per encryption (same plaintext → different ciphertext)", () => {
    const a = encryptSecret("x");
    const b = encryptSecret("x");
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.salt).not.toBe(b.salt);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("throws on tampered ciphertext (GCM auth)", () => {
    const enc = encryptSecret("hello");
    const buf = Buffer.from(enc.ciphertext, "base64");
    buf[0] ^= 0xff;
    expect(() => decryptSecret({ ...enc, ciphertext: buf.toString("base64") })).toThrow();
  });

  it("throws under a wrong passphrase", () => {
    const enc = encryptSecret("topsecret");
    const original = process.env.VAULT_PASSPHRASE;
    process.env.VAULT_PASSPHRASE = "the-wrong-passphrase";
    try {
      expect(() => decryptSecret(enc)).toThrow();
    } finally {
      process.env.VAULT_PASSPHRASE = original;
    }
  });

  it("still decrypts a LEGACY unsalted-sha256 ciphertext (back-compat)", () => {
    const legacy = legacyEncrypt("legacy-key", "test-passphrase");
    // No salt / kdf → the legacy path.
    expect(decryptSecret({ ciphertext: legacy.ciphertext, nonce: legacy.nonce })).toBe(
      "legacy-key",
    );
  });
});

describe("vault getSecretValue + idempotent migration (SEC-1)", () => {
  it("decrypts for the owner; null for others", async () => {
    const enc = encryptSecret("the-api-key");
    const s = await SecretModel.create({
      ownerId: ME,
      label: "Anthropic",
      ciphertext: enc.ciphertext,
      nonce: enc.nonce,
      salt: enc.salt,
      kdf: enc.kdf,
    });
    expect(await getSecretValue(ME, String(s._id))).toBe("the-api-key");
    expect(await getSecretValue("not-me", String(s._id))).toBeNull();
  });

  it("transparently re-encrypts a legacy secret under scrypt on read (migration)", async () => {
    const legacy = legacyEncrypt("migrate-me", "test-passphrase");
    const s = await SecretModel.create({
      ownerId: ME,
      label: "Legacy",
      ciphertext: legacy.ciphertext,
      nonce: legacy.nonce,
      // No salt/kdf → legacy doc.
    });

    // Read returns the correct plaintext...
    expect(await getSecretValue(ME, String(s._id))).toBe("migrate-me");

    // ...and the stored doc has been upgraded to scrypt+salt in place.
    const reloaded = await SecretModel.findById(s._id).lean();
    expect(reloaded?.kdf).toBe("scrypt");
    expect(reloaded?.salt && reloaded.salt.length).toBeGreaterThan(0);
    expect(reloaded?.ciphertext).not.toBe(legacy.ciphertext);

    // The upgraded doc still decrypts to the same value.
    expect(await getSecretValue(ME, String(s._id))).toBe("migrate-me");
  });
});

describe("secrets router safety", () => {
  it("does NOT expose a getValue procedure (no key exfiltration)", () => {
    const def = (secretsRouter as unknown as { _def: Record<string, unknown> })._def;
    const record = (def.record ?? def.procedures ?? {}) as Record<string, unknown>;
    const keys = Object.keys(record);
    expect(keys).toEqual(expect.arrayContaining(["list", "create", "delete"]));
    expect(keys).not.toContain("getValue");
  });
});
