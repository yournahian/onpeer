import { keccak256 } from 'viem'
import { timingSafeEqualBytes } from './auth'
import type { Env } from './env'

const ENVELOPE_VERSION_V1 = 1
const ENVELOPE_VERSION = 2
const CURRENT_KEY_ID = 1
const IV_LENGTH = 12
const DEK_LENGTH = 32
const MIN_CIPHERTEXT_BYTES_V1 = 1 + IV_LENGTH + 16 // version(1) + iv(12) + gcm_tag(16)
const MIN_CIPHERTEXT_BYTES_V2 = 2 + IV_LENGTH + 16 // version(1) + keyId(1) + iv(12) + gcm_tag(16)
const WRAPPED_KEY_BYTES_V1 = 1 + IV_LENGTH + DEK_LENGTH + 16 // version(1) + iv(12) + dek(32) + gcm_tag(16)
const WRAPPED_KEY_BYTES_V2 = 2 + IV_LENGTH + DEK_LENGTH + 16 // version(1) + keyId(1) + iv(12) + dek(32) + gcm_tag(16)

export class VaultConfigError extends Error {
  constructor() {
    super('vault_master_key_not_configured')
  }
}

export class CryptoTamperError extends Error {
  constructor() {
    super('ciphertext_invalid_or_tampered')
  }
}

export interface SealedBlob {
  ciphertext: Uint8Array
  wrappedKey: Uint8Array
  contentHash: `0x${string}`
  size: number
}

function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(clean)) return null
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0')
  }
  return out
}

function hexToBytesAny(hex: string): Uint8Array | null {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) return null
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength)
  copy.set(view)
  return copy.buffer
}

async function importMasterKey(env: Env): Promise<CryptoKey> {
  const raw = env.VAULT_MASTER_KEY?.trim()
  if (!raw) throw new VaultConfigError()
  const keyBytes = hexToBytes(raw)
  if (!keyBytes || keyBytes.length !== 32) {
    throw new VaultConfigError()
  }
  return crypto.subtle.importKey('raw', toArrayBuffer(keyBytes), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/** Compute lowercase `0x`-prefixed keccak256 commitment over exact ciphertext envelope bytes. */
export function hashCiphertext(ciphertext: Uint8Array): `0x${string}` {
  return keccak256(ciphertext).toLowerCase() as `0x${string}`
}

/**
 * Envelope-encrypt arbitrary bytes using a fresh 256-bit DEK and a fresh 96-bit random IV.
 * - `ciphertext` = `[version=2 (1B)] || [keyId (1B)] || [dataIv (12B)] || [AES-GCM(dek, plaintext, aad)]`
 * - `contentHash` = `keccak256(ciphertext)` (unpredictable because both DEK and 12B IV are random)
 * - `wrappedKey` = `[version=2 (1B)] || [keyId (1B)] || [wrapIv (12B)] || [AES-GCM(masterKey, dek, aad || contentHash || keyId)]`
 */
export async function sealBlob(
  env: Env,
  plaintext: Uint8Array,
  aadContext: string,
): Promise<SealedBlob> {
  const masterKey = await importMasterKey(env)

  const dekBytes = new Uint8Array(DEK_LENGTH)
  const dataIv = new Uint8Array(IV_LENGTH)
  const wrapIv = new Uint8Array(IV_LENGTH)
  crypto.getRandomValues(dekBytes)
  crypto.getRandomValues(dataIv)
  crypto.getRandomValues(wrapIv)

  const dek = await crypto.subtle.importKey('raw', toArrayBuffer(dekBytes), { name: 'AES-GCM' }, false, ['encrypt'])
  const aadBytes = new TextEncoder().encode(aadContext)

  const encryptedPayload = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(dataIv), additionalData: toArrayBuffer(aadBytes) },
      dek,
      toArrayBuffer(plaintext),
    ),
  )

  const ciphertext = new Uint8Array(2 + IV_LENGTH + encryptedPayload.byteLength)
  ciphertext[0] = ENVELOPE_VERSION
  ciphertext[1] = CURRENT_KEY_ID
  ciphertext.set(dataIv, 2)
  ciphertext.set(encryptedPayload, 2 + IV_LENGTH)

  const contentHash = hashCiphertext(ciphertext)
  const wrapAad = new TextEncoder().encode(`${aadContext}|${contentHash}|k${CURRENT_KEY_ID}`)

  const encryptedDek = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(wrapIv), additionalData: toArrayBuffer(wrapAad) },
      masterKey,
      toArrayBuffer(dekBytes),
    ),
  )
  // Zeroize raw DEK in memory after wrapping
  dekBytes.fill(0)

  const wrappedKey = new Uint8Array(2 + IV_LENGTH + encryptedDek.byteLength)
  wrappedKey[0] = ENVELOPE_VERSION
  wrappedKey[1] = CURRENT_KEY_ID
  wrappedKey.set(wrapIv, 2)
  wrappedKey.set(encryptedDek, 2 + IV_LENGTH)

  return {
    ciphertext,
    wrappedKey,
    contentHash,
    size: plaintext.byteLength,
  }
}

/**
 * Unwrap the per-record DEK with `VAULT_MASTER_KEY` and authenticate + decrypt `ciphertext`.
 * Supports v2 (with 1-byte keyId) and legacy v1 envelopes.
 * Any modification to `ciphertext`, `wrappedKey`, `keyId`, `aadContext`, or `expectedHash` throws `CryptoTamperError`.
 */
export async function openBlob(
  env: Env,
  ciphertext: Uint8Array,
  wrappedKey: Uint8Array,
  aadContext: string,
  expectedHash?: string,
): Promise<Uint8Array> {
  const masterKey = await importMasterKey(env)

  const ver = ciphertext[0]
  const isV2 = ver === ENVELOPE_VERSION && wrappedKey[0] === ENVELOPE_VERSION
  const isV1 = ver === ENVELOPE_VERSION_V1 && wrappedKey[0] === ENVELOPE_VERSION_V1
  if (!isV2 && !isV1) {
    throw new CryptoTamperError()
  }

  const headerLen = isV2 ? 2 : 1
  const minCtLen = isV2 ? MIN_CIPHERTEXT_BYTES_V2 : MIN_CIPHERTEXT_BYTES_V1
  const expectedWkLen = isV2 ? WRAPPED_KEY_BYTES_V2 : WRAPPED_KEY_BYTES_V1
  if (ciphertext.byteLength < minCtLen || wrappedKey.byteLength !== expectedWkLen) {
    throw new CryptoTamperError()
  }
  if (isV2 && (ciphertext[1] !== wrappedKey[1] || ciphertext[1] !== CURRENT_KEY_ID)) {
    throw new CryptoTamperError()
  }

  const actualHash = hashCiphertext(ciphertext)
  if (expectedHash && actualHash !== expectedHash.toLowerCase()) {
    throw new CryptoTamperError()
  }

  const wrapIv = wrappedKey.subarray(headerLen, headerLen + IV_LENGTH)
  const encryptedDek = wrappedKey.subarray(headerLen + IV_LENGTH)
  const wrapAadStr = isV2 ? `${aadContext}|${actualHash}|k${ciphertext[1]}` : `${aadContext}|${actualHash}`
  const wrapAad = new TextEncoder().encode(wrapAadStr)

  let dekBytes: Uint8Array
  try {
    dekBytes = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: toArrayBuffer(wrapIv), additionalData: toArrayBuffer(wrapAad) },
        masterKey,
        toArrayBuffer(encryptedDek),
      ),
    )
  } catch {
    throw new CryptoTamperError()
  }

  if (dekBytes.byteLength !== DEK_LENGTH) {
    dekBytes.fill(0)
    throw new CryptoTamperError()
  }

  try {
    const dek = await crypto.subtle.importKey('raw', toArrayBuffer(dekBytes), { name: 'AES-GCM' }, false, ['decrypt'])
    const dataIv = ciphertext.subarray(headerLen, headerLen + IV_LENGTH)
    const encryptedPayload = ciphertext.subarray(headerLen + IV_LENGTH)
    const aadBytes = new TextEncoder().encode(aadContext)

    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(dataIv), additionalData: toArrayBuffer(aadBytes) },
      dek,
      toArrayBuffer(encryptedPayload),
    )
    return new Uint8Array(plainBuf)
  } catch {
    throw new CryptoTamperError()
  } finally {
    dekBytes.fill(0)
  }
}

/** Envelope-encrypt UTF-8 text into a compact JSON string for SQL `text` columns (`_enc`). */
export async function sealText(env: Env, plaintext: string, aadContext: string): Promise<string> {
  const sealed = await sealBlob(env, new TextEncoder().encode(plaintext), aadContext)
  return JSON.stringify({
    v: ENVELOPE_VERSION,
    k: CURRENT_KEY_ID,
    ct: bytesToBase64(sealed.ciphertext),
    wk: bytesToBase64(sealed.wrappedKey),
  })
}

/** Authenticate and decrypt UTF-8 text produced by `sealText`. */
export async function openText(env: Env, encoded: string, aadContext: string): Promise<string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(encoded)
  } catch {
    throw new CryptoTamperError()
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CryptoTamperError()
  }
  const rec = parsed as Record<string, unknown>
  const validVer = rec.v === ENVELOPE_VERSION || rec.v === ENVELOPE_VERSION_V1
  if (!validVer || typeof rec.ct !== 'string' || typeof rec.wk !== 'string') {
    throw new CryptoTamperError()
  }
  const ct = base64ToBytes(rec.ct)
  const wk = base64ToBytes(rec.wk)
  if (!ct || !wk) throw new CryptoTamperError()
  const plainBytes = await openBlob(env, ct, wk, aadContext)
  return new TextDecoder('utf-8', { fatal: true }).decode(plainBytes)
}

function compareByCodePoint(a: string, b: string): number {
  let ia = 0
  let ib = 0
  while (ia < a.length && ib < b.length) {
    const ca = a.codePointAt(ia)!
    const cb = b.codePointAt(ib)!
    if (ca !== cb) return ca - cb
    ia += ca > 0xffff ? 2 : 1
    ib += cb > 0xffff ? 2 : 1
  }
  return a.length - b.length
}

/**
 * Serialize a parsed JSON value into Didit's canonical JSON format for `X-Signature-V2`:
 * - Object keys sorted recursively by Unicode code point (`sort_keys=True`)
 * - Compact `,` and `:` separators with no extra whitespace (`separators=(',', ':')`)
 * - Non-ASCII Unicode characters preserved unescaped (`ensure_ascii=False`)
 * - Whole-valued floats normalized to integers (`1.0` -> `1`)
 */
export function canonicalizeDiditJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non_finite_json_number')
    return Number.isInteger(value) ? Math.trunc(value).toString() : String(value)
  }
  if (typeof value === 'string') {
    // JSON.stringify on a string escapes only quotes, backslashes, and control chars (leaving UTF-8 unescaped)
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeDiditJson(item)).join(',')}]`
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort(compareByCodePoint)
    const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalizeDiditJson(obj[k])}`)
    return `{${entries.join(',')}}`
  }
  throw new Error('unsupported_json_type')
}

export async function computeHmacSha256Hex(secret: string, message: string | Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const data = typeof message === 'string' ? new TextEncoder().encode(message) : message
  const sig = await crypto.subtle.sign('HMAC', key, toArrayBuffer(data))
  return bytesToHex(new Uint8Array(sig))
}

/** Verify a hex-encoded HMAC-SHA256 signature in constant time. */
export async function verifyHmacSha256Hex(
  secret: string,
  message: string | Uint8Array,
  providedSignatureHex: string,
): Promise<boolean> {
  if (!secret) return false
  const cleanSig = providedSignatureHex.trim().replace(/^sha256=/i, '')
  const providedBytes = hexToBytesAny(cleanSig)
  if (!providedBytes || providedBytes.byteLength !== 32) return false
  const expectedHex = await computeHmacSha256Hex(secret, message)
  const expectedBytes = hexToBytesAny(expectedHex)
  if (!expectedBytes) return false
  return timingSafeEqualBytes(providedBytes, expectedBytes)
}
