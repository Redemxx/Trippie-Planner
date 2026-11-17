const CIPHER_PREFIX = 'enc:v1:'
const HKDF_SALT = new TextEncoder().encode('trippie-credential-salt-v1')
const HKDF_INFO = new TextEncoder().encode('trippie:user-ai-credentials:v1')

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(str.length + ((4 - (str.length % 4)) % 4), '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

async function deriveAesKey(secretMaterial: string): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(new TextEncoder().encode(secretMaterial)),
    'HKDF',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(HKDF_SALT),
      info: toArrayBuffer(HKDF_INFO),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * Encrypts a user secret with AES-256-GCM using a fresh random 12-byte IV
 * and binds `aad` (e.g., userId) so ciphertext cannot be transplanted across rows.
 */
export async function encryptCredentialSecret(
  plaintext: string,
  secretMaterial: string,
  aad?: string,
): Promise<string> {
  const key = await deriveAesKey(secretMaterial)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      ...(aad ? { additionalData: toArrayBuffer(new TextEncoder().encode(aad)) } : {}),
    },
    key,
    toArrayBuffer(encoded),
  )
  return `${CIPHER_PREFIX}${toBase64Url(iv)}:${toBase64Url(new Uint8Array(cipherBuffer))}`
}

/**
 * Decrypts a stored credential value. Returns null if decryption/authentication fails.
 */
export async function decryptCredentialSecret(
  stored: string,
  secretMaterial: string,
  aad?: string,
): Promise<string | null> {
  if (!stored) return null
  if (!stored.startsWith(CIPHER_PREFIX)) {
    // Legacy unencrypted row compatibility; callers re-encrypt on next write.
    return stored
  }
  const rest = stored.slice(CIPHER_PREFIX.length)
  const sep = rest.indexOf(':')
  if (sep <= 0) return null
  const ivB64 = rest.slice(0, sep)
  const cipherB64 = rest.slice(sep + 1)
  try {
    const key = await deriveAesKey(secretMaterial)
    const iv = fromBase64Url(ivB64)
    const cipherBytes = fromBase64Url(cipherB64)
    const plainBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(iv),
        ...(aad ? { additionalData: toArrayBuffer(new TextEncoder().encode(aad)) } : {}),
      },
      key,
      toArrayBuffer(cipherBytes),
    )
    return new TextDecoder().decode(plainBuffer)
  } catch {
    return null
  }
}

export function isEncryptedCredential(value: string | undefined): boolean {
  return typeof value === 'string' && value.startsWith(CIPHER_PREFIX)
}
