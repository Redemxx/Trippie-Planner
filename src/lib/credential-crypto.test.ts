import { describe, expect, it } from 'vitest'
import {
  decryptCredentialSecret,
  encryptCredentialSecret,
  isEncryptedCredential,
} from './credential-crypto'

describe('credential-crypto (AES-256-GCM)', () => {
  const masterKey = 'test-master-key-material-256bit'

  it('encrypts with unique IVs and round-trips with matching key & AAD', async () => {
    const secret = 'AIzaSyDemoSecretKeyValue123456'
    const c1 = await encryptCredentialSecret(secret, masterKey, 'user_1')
    const c2 = await encryptCredentialSecret(secret, masterKey, 'user_1')

    expect(isEncryptedCredential(c1)).toBe(true)
    expect(isEncryptedCredential(c2)).toBe(true)
    expect(c1).not.toBe(c2)
    expect(c1).not.toContain(secret)

    expect(await decryptCredentialSecret(c1, masterKey, 'user_1')).toBe(secret)
    expect(await decryptCredentialSecret(c2, masterKey, 'user_1')).toBe(secret)
  })

  it('rejects wrong encryption key, wrong user AAD, and tampered ciphertext', async () => {
    const encrypted = await encryptCredentialSecret('AIzaSySecret', masterKey, 'user_1')

    expect(await decryptCredentialSecret(encrypted, 'wrong-key', 'user_1')).toBeNull()
    expect(await decryptCredentialSecret(encrypted, masterKey, 'user_2')).toBeNull()

    const tampered = `${encrypted.slice(0, -2)}AA`
    expect(await decryptCredentialSecret(tampered, masterKey, 'user_1')).toBeNull()
  })
})
