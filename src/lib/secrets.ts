import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Encryption at rest for secret settings (API keys, webhook URLs that carry
 * tokens, proxy credentials). AES-256-GCM with a random 12-byte IV per value.
 *
 * Master key, in order of preference:
 *   1. APP_SECRET_KEY env var (base64, 32 bytes) - for deployments that manage keys.
 *   2. A random key generated on first use and stored in <DB_DIR>/.secret-key
 *      (inside /data, which is gitignored). Owner-only permissions where supported.
 */

/**
 * Settings that are safe to store and show as plain text: preferences and timestamps only.
 * Everything else is treated as personal or secret (API keys, server URLs, tokens) and is
 * encrypted at rest. New settings are secure by default; add a key here only if it holds no personal data.
 */
export const PUBLIC_SETTING_KEYS = new Set([
  "recheckInterval",
  "alertEbook",
  "alertAudiobook",
  "alertScheduled",
  "lastAutoCheckAt",
]);

/** True for any setting that must be encrypted at rest and masked in the UI. */
export function isSecretSetting(key: string): boolean {
  return !PUBLIC_SETTING_KEYS.has(key);
}

const PREFIX = "enc:v1:";
let cachedKey: Buffer | null = null;

function loadMasterKey(dataDir: string): Buffer {
  if (cachedKey) return cachedKey;

  const fromEnv = process.env.APP_SECRET_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv, "base64");
    if (key.length !== 32) {
      throw new Error("APP_SECRET_KEY must be 32 bytes, base64-encoded");
    }
    cachedKey = key;
    return key;
  }

  const keyPath = path.join(dataDir, ".secret-key");
  if (fs.existsSync(keyPath)) {
    cachedKey = Buffer.from(fs.readFileSync(keyPath, "utf8").trim(), "base64");
  } else {
    const key = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, key.toString("base64"), { mode: 0o600, flag: "wx" });
    cachedKey = key;
  }
  return cachedKey;
}

export function encryptSecret(plain: string, dataDir: string): string {
  const key = loadMasterKey(dataDir);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Returns the plaintext, or null if the value is not in the encrypted format. */
export function decryptSecret(stored: string, dataDir: string): string | null {
  if (!stored.startsWith(PREFIX)) return null;
  const key = loadMasterKey(dataDir);
  const buf = Buffer.from(stored.slice(PREFIX.length), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** Safe-to-display form of a secret, e.g. "••••x7Qz". */
export function maskSecret(plain: string): string {
  return plain.length <= 8 ? "••••••••" : `••••${plain.slice(-4)}`;
}
