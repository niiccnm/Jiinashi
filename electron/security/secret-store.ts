import { safeStorage } from "electron";

const ENC_PREFIX = "enc:v1:";

export function isSecretStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export function isStoredSecret(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.startsWith(ENC_PREFIX);
}

export function protectSecret(value: string | null | undefined): string | null {
  if (!value) return null;

  const raw = String(value);
  if (!raw) return null;
  if (isStoredSecret(raw)) return raw;

  if (!isSecretStorageAvailable()) {
    throw new Error("Secure storage is unavailable on this system");
  }

  try {
    const encrypted = safeStorage.encryptString(raw).toString("base64");
    return `${ENC_PREFIX}${encrypted}`;
  } catch (error) {
    console.error("[Security] Failed to encrypt secret:", error);
    throw new Error("Failed to encrypt secret");
  }
}

export function revealSecret(value: string | null | undefined): string {
  if (!value) return "";

  if (value.startsWith(ENC_PREFIX)) {
    const payload = value.slice(ENC_PREFIX.length);
    try {
      return safeStorage.decryptString(Buffer.from(payload, "base64"));
    } catch (error) {
      console.error("[Security] Failed to decrypt secret:", error);
      return "";
    }
  }

  // Reject legacy plaintext rows.
  return "";
}
