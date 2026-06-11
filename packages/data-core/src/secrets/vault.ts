import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { connectDB } from "../db/client";
import { SecretModel } from "../db/models/secret.model";

// AES-256-GCM secrets vault (ADR AD-8).
// SEC-1 (Sprint 8): the key is derived from VAULT_PASSPHRASE via a SALTED,
// memory-hard **scrypt** KDF (built into node:crypto — no native dependency),
// VERSIONED per secret (`kdf`) so existing unsalted-sha256 secrets keep
// decrypting and are transparently re-encrypted under scrypt on the next read
// (idempotent migration). The passphrase comes from the OS keychain (Electron
// safeStorage, SEC-5); it is never logged and never leaves the server.

export type VaultKdf = "scrypt" | "sha256-legacy";

// scrypt cost parameters. N=2^14 (16384) ⇒ ~16 MiB working set, r=8, p=1 — the
// Node default cost, comfortably memory-hard for a desktop vault. maxmem is
// raised so the higher N is permitted.
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const KEY_LEN = 32; // AES-256
const SALT_LEN = 16;
const NONCE_LEN = 12; // GCM standard
const TAG_LEN = 16;

function getPassphrase(): string {
  const passphrase = process.env.VAULT_PASSPHRASE;
  if (!passphrase) {
    throw new Error(
      "Vault not initialized — set VAULT_PASSPHRASE (desktop: OS keychain).",
    );
  }
  return passphrase;
}

/** Derive the 32-byte AES key. scrypt (salted) for new secrets; unsalted sha256 for legacy. */
function deriveKey(kdf: VaultKdf, salt?: Buffer): Buffer {
  const passphrase = getPassphrase();
  if (kdf === "scrypt") {
    if (!salt || salt.length === 0) {
      throw new Error("scrypt KDF requires a salt");
    }
    return scryptSync(passphrase, salt, KEY_LEN, SCRYPT_PARAMS);
  }
  // Legacy (pre-SEC-1) unsalted sha256 — read-only back-compat path.
  return createHash("sha256").update(passphrase).digest();
}

export interface EncryptedSecret {
  ciphertext: string; // base64 (encrypted value + GCM auth tag)
  nonce: string; // base64 GCM nonce
  salt: string; // base64 scrypt salt
  kdf: VaultKdf; // "scrypt" for all new secrets
}

export interface DecryptSecretInput {
  ciphertext: string;
  nonce: string;
  /** Present for scrypt secrets; absent for legacy sha256 docs. */
  salt?: string;
  /** "scrypt" for new secrets; absent/anything else ⇒ the legacy sha256 path. */
  kdf?: VaultKdf | string;
}

/** Encrypt a plaintext under a freshly-salted scrypt key (AES-256-GCM). */
export function encryptSecret(plaintext: string): EncryptedSecret {
  const salt = randomBytes(SALT_LEN);
  const key = deriveKey("scrypt", salt);
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([enc, tag]).toString("base64"),
    nonce: nonce.toString("base64"),
    salt: salt.toString("base64"),
    kdf: "scrypt",
  };
}

/**
 * Decrypt a stored secret. Uses scrypt when `kdf === "scrypt"` (salt required);
 * otherwise falls back to the legacy unsalted sha256 path (existing docs).
 * Throws on a tampered tag / wrong passphrase (GCM auth).
 */
export function decryptSecret(input: DecryptSecretInput): string {
  const kdf: VaultKdf = input.kdf === "scrypt" ? "scrypt" : "sha256-legacy";
  const salt = input.salt ? Buffer.from(input.salt, "base64") : undefined;
  const key = deriveKey(kdf, salt);
  const nonceBuf = Buffer.from(input.nonce, "base64");
  const data = Buffer.from(input.ciphertext, "base64");
  const tag = data.subarray(data.length - TAG_LEN);
  const enc = data.subarray(0, data.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, nonceBuf);
  decipher.setAuthTag(tag); // throws on tamper / wrong key
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/**
 * SERVER-INTERNAL ONLY. Imported by the runtime (execute-runner) to inject a
 * decrypted key into a CLI subprocess env. Deliberately NOT a tRPC procedure —
 * decrypted values must never be reachable from the client (ADR AD-8 / Zero-Secret-Leakage).
 *
 * SEC-1 idempotent migration: when a LEGACY (unsalted sha256) secret is read, it
 * is transparently re-encrypted + persisted under scrypt on this read path. The
 * re-encryption is best-effort — a migration failure never breaks the read.
 */
export async function getSecretValue(
  ownerId: string,
  secretId: string,
): Promise<string | null> {
  await connectDB();
  const secret = await SecretModel.findOne({ _id: secretId, ownerId });
  if (!secret) return null;

  const plaintext = decryptSecret({
    ciphertext: secret.ciphertext,
    nonce: secret.nonce,
    salt: secret.salt,
    kdf: secret.kdf,
  });

  if (secret.kdf !== "scrypt") {
    try {
      const upgraded = encryptSecret(plaintext);
      secret.ciphertext = upgraded.ciphertext;
      secret.nonce = upgraded.nonce;
      secret.salt = upgraded.salt;
      secret.kdf = upgraded.kdf;
      await secret.save();
    } catch {
      // Migration is best-effort — never break a read because a re-encrypt failed.
    }
  }

  return plaintext;
}
