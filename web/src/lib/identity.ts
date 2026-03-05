// Identity management — keypair encrypted with password, stored as .wspr file
// No server, no localStorage dependency for identity
// The private key never leaves the device unencrypted

export type Identity = {
  publicKey: string
  privateKeyRaw: string
  createdAt: number
}

const MAGIC = 'WSPR1' // File format identifier

// Encrypt identity with password → Uint8Array
export async function encryptIdentity(identity: Identity, password: string): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))

  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  )
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  )

  const payload = enc.encode(JSON.stringify(identity))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload)

  // Format: MAGIC(5) + salt(16) + iv(12) + ciphertext
  const magicBytes = enc.encode(MAGIC)
  const result = new Uint8Array(magicBytes.length + salt.length + iv.length + ciphertext.byteLength)
  let offset = 0
  result.set(magicBytes, offset); offset += magicBytes.length
  result.set(salt, offset); offset += salt.length
  result.set(iv, offset); offset += iv.length
  result.set(new Uint8Array(ciphertext), offset)
  return result
}

// Decrypt .wspr file bytes with password → Identity
export async function decryptIdentity(fileBytes: Uint8Array, password: string): Promise<Identity | null> {
  try {
    const enc = new TextEncoder()
    const dec = new TextDecoder()
    const magicBytes = enc.encode(MAGIC)

    // Verify magic
    const magic = dec.decode(fileBytes.slice(0, magicBytes.length))
    if (magic !== MAGIC) return null

    let offset = magicBytes.length
    const salt = fileBytes.slice(offset, offset + 16); offset += 16
    const iv = fileBytes.slice(offset, offset + 12); offset += 12
    const ciphertext = fileBytes.slice(offset)

    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
    )
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    )

    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
    return JSON.parse(dec.decode(decrypted)) as Identity
  } catch {
    return null
  }
}

// Download identity as .wspr file
export function downloadIdentityFile(encryptedBytes: Uint8Array, filename = 'identity.wspr'): void {
  const blob = new Blob([encryptedBytes.buffer as ArrayBuffer], { type: "application/octet-stream" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Read uploaded file as Uint8Array
export function readFileAsBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

// Session cache — keep decrypted identity in memory for the session only
// Cleared on page close, never written to localStorage
let sessionIdentity: Identity | null = null

export function setSessionIdentity(identity: Identity): void {
  sessionIdentity = identity
}

export function getSessionIdentity(): Identity | null {
  return sessionIdentity
}

export function clearSessionIdentity(): void {
  sessionIdentity = null
}
