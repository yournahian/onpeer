import { describe, expect, it } from 'vitest'
import {
  CryptoTamperError,
  VaultConfigError,
  canonicalizeDiditJson,
  computeHmacSha256Hex,
  hashCiphertext,
  openBlob,
  openText,
  sealBlob,
  sealText,
  verifyHmacSha256Hex,
} from '../crypto'
import type { Env } from '../env'

const MASTER_KEY_A = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const MASTER_KEY_B = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'

function makeEnv(masterKey?: string): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') },
    VAULT_MASTER_KEY: masterKey,
  }
}

describe('Step 4: AES-256-GCM Envelope Encryption, Random IV Commitments & Canonical HMAC', () => {
  it('round-trips binary blobs and produces unique random-IV ciphertexts and keccak256 hashes per call', async () => {
    const env = makeEnv(MASTER_KEY_A)
    const payload = new TextEncoder().encode(
      JSON.stringify({ holderName: 'Tariq Rahman', method: 'bKash', account: '01700000000' }),
    )

    const sealed1 = await sealBlob(env, payload, 'vault:ad_details')
    const sealed2 = await sealBlob(env, payload, 'vault:ad_details')

    // Random 12B IV + fresh 32B DEK guarantee identical plaintexts never collide on hash or ciphertext
    expect(sealed1.contentHash).not.toBe(sealed2.contentHash)
    expect(Buffer.from(sealed1.ciphertext).equals(Buffer.from(sealed2.ciphertext))).toBe(false)
    expect(Buffer.from(sealed1.wrappedKey).equals(Buffer.from(sealed2.wrappedKey))).toBe(false)
    expect(sealed1.contentHash).toBe(hashCiphertext(sealed1.ciphertext))
    expect(sealed1.size).toBe(payload.byteLength)

    const opened1 = await openBlob(env, sealed1.ciphertext, sealed1.wrappedKey, 'vault:ad_details', sealed1.contentHash)
    const opened2 = await openBlob(env, sealed2.ciphertext, sealed2.wrappedKey, 'vault:ad_details', sealed2.contentHash)
    expect(new TextDecoder().decode(opened1)).toEqual(new TextDecoder().decode(payload))
    expect(new TextDecoder().decode(opened2)).toEqual(new TextDecoder().decode(payload))
  })

  it('detects tampering in ciphertext, IV, GCM tag, wrappedKey, AAD context, expectedHash, or master key', async () => {
    const envA = makeEnv(MASTER_KEY_A)
    const envB = makeEnv(MASTER_KEY_B)
    const plaintext = new TextEncoder().encode('UPI: priya@okaxis')
    const sealed = await sealBlob(envA, plaintext, 'vault:order_details')

    // 1. Flipping 1 bit in ciphertext body throws CryptoTamperError
    const badCt = new Uint8Array(sealed.ciphertext)
    badCt[badCt.length - 5] ^= 0x01
    await expect(openBlob(envA, badCt, sealed.wrappedKey, 'vault:order_details')).rejects.toThrow(CryptoTamperError)

    // 2. Flipping 1 bit in the 12-byte random IV throws CryptoTamperError
    const badIv = new Uint8Array(sealed.ciphertext)
    badIv[2] ^= 0x80
    await expect(openBlob(envA, badIv, sealed.wrappedKey, 'vault:order_details')).rejects.toThrow(CryptoTamperError)

    // 3. Flipping 1 bit in wrappedKey throws CryptoTamperError
    const badWk = new Uint8Array(sealed.wrappedKey)
    badWk[badWk.length - 1] ^= 0x01
    await expect(openBlob(envA, sealed.ciphertext, badWk, 'vault:order_details')).rejects.toThrow(CryptoTamperError)

    // 4. Swapping wrappedKey from another valid encryption throws CryptoTamperError (hash-bound wrap AAD)
    const other = await sealBlob(envA, plaintext, 'vault:order_details')
    await expect(openBlob(envA, sealed.ciphertext, other.wrappedKey, 'vault:order_details')).rejects.toThrow(
      CryptoTamperError,
    )

    // 5. Wrong AAD context (cross-kind / cross-record transplant) throws CryptoTamperError
    await expect(openBlob(envA, sealed.ciphertext, sealed.wrappedKey, 'vault:payer')).rejects.toThrow(CryptoTamperError)

    // 6. Mismatched onchain commitment hash throws CryptoTamperError
    await expect(
      openBlob(envA, sealed.ciphertext, sealed.wrappedKey, 'vault:order_details', '0x' + '11'.repeat(32)),
    ).rejects.toThrow(CryptoTamperError)

    // 7. Wrong VAULT_MASTER_KEY throws CryptoTamperError
    await expect(openBlob(envB, sealed.ciphertext, sealed.wrappedKey, 'vault:order_details')).rejects.toThrow(
      CryptoTamperError,
    )

    // 8. Missing or malformed VAULT_MASTER_KEY throws VaultConfigError
    await expect(sealBlob(makeEnv(''), plaintext, 'vault:order_details')).rejects.toThrow(VaultConfigError)
    await expect(sealBlob(makeEnv('not-64-hex'), plaintext, 'vault:order_details')).rejects.toThrow(VaultConfigError)
  })

  it('round-trips UTF-8 text envelopes (including South Asian scripts) and blocks cross-wallet swaps', async () => {
    const env = makeEnv(MASTER_KEY_A)
    const original = 'মোঃ তারিক রহমান • Reference #99812'
    const enc = await sealText(env, original, 'account:kyc_name:0x1111111111111111111111111111111111111111')

    expect(enc).not.toContain('তারিক')
    expect(enc).not.toContain('99812')

    const dec = await openText(env, enc, 'account:kyc_name:0x1111111111111111111111111111111111111111')
    expect(dec).toBe(original)

    // Transplanting encrypted column value onto another wallet fails AAD verification
    await expect(
      openText(env, enc, 'account:kyc_name:0x2222222222222222222222222222222222222222'),
    ).rejects.toThrow(CryptoTamperError)
  })

  it('canonicalizes Didit JSON (sorted keys, compact separators, raw UTF-8, whole floats) and verifies HMAC in constant time', async () => {
    const rawJson = `{
      "webhook_type": "status.updated",
      "timestamp": 1792056078,
      "session_id": "22222222-3333-4444-5555-666666666666",
      "decision": {
        "score": 100.0,
        "ratio": 0.85,
        "full_name": "José রহিম"
      },
      "sandbox_scenario": null
    }`
    const parsed = JSON.parse(rawJson) as unknown
    const canonical = canonicalizeDiditJson(parsed)

    expect(canonical).toBe(
      '{"decision":{"full_name":"José রহিম","ratio":0.85,"score":100},"sandbox_scenario":null,"session_id":"22222222-3333-4444-5555-666666666666","timestamp":1792056078,"webhook_type":"status.updated"}',
    )

    const secret = 'didit_sandbox_webhook_secret_test_key'
    const sig = await computeHmacSha256Hex(secret, canonical)
    expect(await verifyHmacSha256Hex(secret, canonical, sig)).toBe(true)
    expect(await verifyHmacSha256Hex(secret, canonical, `sha256=${sig.toUpperCase()}`)).toBe(true)
    expect(await verifyHmacSha256Hex(secret, canonical + ' ', sig)).toBe(false)
    expect(await verifyHmacSha256Hex('wrong_secret', canonical, sig)).toBe(false)
  })
})
