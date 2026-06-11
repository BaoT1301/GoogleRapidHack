import { Schema, model, models, type Model } from "mongoose";

// Stores AES-256-GCM encrypted secrets (BYO API keys, etc.).
// Ciphertext/nonce only — plaintext never persisted, decryption is server-internal (P6).
export interface ISecret {
  ownerId: string;
  label: string; // display label, e.g. "Anthropic API Key"
  ciphertext: string; // base64 (encrypted value + GCM auth tag)
  nonce: string; // base64 GCM nonce
  // SEC-1 (additive, optional): scrypt salt (base64) + KDF discriminator. Absent
  // on pre-SEC-1 docs (decrypted via the "sha256-legacy" path, then transparently
  // re-encrypted under scrypt on the next read — see vault.getSecretValue).
  salt?: string;
  kdf?: "scrypt" | "sha256-legacy";
  createdAt: Date;
  updatedAt: Date;
}

const SecretSchema = new Schema<ISecret>(
  {
    ownerId: { type: String, required: true, index: true },
    label: { type: String, required: true },
    ciphertext: { type: String, required: true },
    nonce: { type: String, required: true },
    // Additive optional — no required field, so existing docs remain valid.
    salt: { type: String, required: false },
    kdf: { type: String, required: false, enum: ["scrypt", "sha256-legacy"] },
  },
  { timestamps: true },
);

SecretSchema.index({ ownerId: 1, label: 1 });

export const SecretModel: Model<ISecret> =
  (models.Secret as Model<ISecret>) ?? model<ISecret>("Secret", SecretSchema);
