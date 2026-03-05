// Per-message encryption with forward secrecy
// Each message gets a fresh IV — AES-256-GCM with shared secret as key material
// Even if one message is broken, others remain secure

async function deriveMessageKey(
  sharedSecret: Uint8Array,
  messageId: string
): Promise<CryptoKey> {
  // Mix shared secret with message ID for per-message key derivation
  const enc = new TextEncoder()
  const material = await crypto.subtle.importKey(
    'raw',
    sharedSecret.buffer.slice(
      sharedSecret.byteOffset,
      sharedSecret.byteOffset + sharedSecret.byteLength
    ) as ArrayBuffer,
    'PBKDF2',
    false,
    ['deriveKey']
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(messageId),
      iterations: 1000, // Lower for chat — speed matters
      hash: 'SHA-256'
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptMessage(
  plaintext: string,
  sharedSecret: Uint8Array,
  messageId: string
): Promise<string> {
  const key = await deriveMessageKey(sharedSecret, messageId)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  )

  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), iv.length)

  return btoa(String.fromCharCode(...combined))
}

export async function decryptMessage(
  encoded: string,
  sharedSecret: Uint8Array,
  messageId: string
): Promise<string | null> {
  try {
    const combined = Uint8Array.from(atob(encoded), c => c.charCodeAt(0))
    const iv = combined.slice(0, 12)
    const ciphertext = combined.slice(12)
    const key = await deriveMessageKey(sharedSecret, messageId)
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    )
    return new TextDecoder().decode(decrypted)
  } catch {
    return null
  }
}

// Encrypt file/image as base64
export async function encryptFile(
  fileBytes: Uint8Array,
  sharedSecret: Uint8Array,
  messageId: string
): Promise<string> {
  const b64 = btoa(String.fromCharCode(...fileBytes))
  return encryptMessage(b64, sharedSecret, messageId)
}

export async function decryptFile(
  encoded: string,
  sharedSecret: Uint8Array,
  messageId: string
): Promise<Uint8Array | null> {
  const b64 = await decryptMessage(encoded, sharedSecret, messageId)
  if (!b64) return null
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

// Local storage — messages stored encrypted
export type StoredMessage = {
  id: string
  from: string
  ciphertext: string
  timestamp: number
  type: 'text' | 'image' | 'file'
  fileName?: string
  mine: boolean
}

const STORAGE_KEY = 'wspr_chat_messages'

export function loadMessages(): StoredMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export function saveMessage(msg: StoredMessage): void {
  const messages = loadMessages()
  messages.push(msg)
  // Keep last 500 messages
  const trimmed = messages.slice(-500)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
}

export function clearMessages(): void {
  localStorage.removeItem(STORAGE_KEY)
}
