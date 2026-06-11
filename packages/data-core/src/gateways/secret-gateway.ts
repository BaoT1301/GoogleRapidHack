// SecretGateway — persistence seam for the `secrets` vault (shared data-core).
//
// The Mongo + local-vault implementation lives here so both the orchestrator and the
// auth-bff service share it; the orchestrator adds the BFF-forwarding variant + selector.
import { connectDB } from "../db/client";
import { SecretModel } from "../db/models/secret.model";
import { encryptSecret, getSecretValue } from "../secrets/vault";

export interface SecretLabel {
  id: string;
  label: string;
  createdAt?: Date;
}

export interface SecretGateway {
  list(ownerId: string): Promise<SecretLabel[]>;
  create(ownerId: string, label: string, value: string): Promise<{ id: string; label: string }>;
  delete(ownerId: string, id: string): Promise<boolean>;
  /** SERVER-INTERNAL: decrypted plaintext for the runtime. Never a client procedure. */
  getValue(ownerId: string, secretId: string): Promise<string | null>;
}

/** Direct-Mongo + local vault — the shipped behavior. */
export class MongoSecretGateway implements SecretGateway {
  async list(ownerId: string): Promise<SecretLabel[]> {
    await connectDB();
    const secrets = await SecretModel.find({ ownerId })
      .select("label createdAt updatedAt")
      .lean();
    return secrets.map((s) => ({ id: String(s._id), label: s.label, createdAt: s.createdAt }));
  }

  async create(ownerId: string, label: string, value: string): Promise<{ id: string; label: string }> {
    await connectDB();
    const { ciphertext, nonce, salt, kdf } = encryptSecret(value);
    const secret = await SecretModel.create({ ownerId, label, ciphertext, nonce, salt, kdf });
    return { id: String(secret._id), label: secret.label };
  }

  async delete(ownerId: string, id: string): Promise<boolean> {
    await connectDB();
    const res = await SecretModel.deleteOne({ _id: id, ownerId });
    return res.deletedCount === 1;
  }

  getValue(ownerId: string, secretId: string): Promise<string | null> {
    // Existing server-internal decrypt (incl. the SEC-1 legacy→scrypt migration).
    return getSecretValue(ownerId, secretId);
  }
}

export const mongoSecretGateway = new MongoSecretGateway();
