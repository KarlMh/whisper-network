async function getKey(keyMaterial: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const raw = await crypto.subtle.importKey(
    'raw',
    keyMaterial.buffer.slice(keyMaterial.byteOffset, keyMaterial.byteOffset + keyMaterial.byteLength) as ArrayBuffer,
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer, iterations: 100000, hash: 'SHA-256' },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

function getHourStamp(offsetHours = 0): string {
  const now = new Date()
  const utc = new Date(now.getTime() + offsetHours * 60 * 60 * 1000)
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(utc.getUTCDate()).padStart(2, '0')}T${String(utc.getUTCHours()).padStart(2, '0')}`
}

async function buildKeyMaterial(
  password: string,
  keyfile?: Uint8Array,
  hourOffset = 0
): Promise<Uint8Array> {
  const hourStamp = getHourStamp(hourOffset)
  const enc = new TextEncoder()

  if (keyfile && keyfile.length > 0) {
    const stampBytes = enc.encode(hourStamp)
    const combined = new Uint8Array(keyfile.length + stampBytes.length)
    combined.set(keyfile, 0)
    combined.set(stampBytes, keyfile.length)
    const hash = await crypto.subtle.digest('SHA-256', combined)
    return new Uint8Array(hash)
  }

  const passwordBytes = enc.encode(password + hourStamp)
  const hash = await crypto.subtle.digest('SHA-256', passwordBytes)
  return new Uint8Array(hash)
}

// Compute SHA-256 hash of a string, return as hex
async function hashMessage(message: string): Promise<string> {
  const enc = new TextEncoder()
  const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(message))
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function encrypt(
  message: string,
  password: string,
  keyfile?: Uint8Array
): Promise<string> {
  const keyMaterial = await buildKeyMaterial(password, keyfile, 0)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await getKey(keyMaterial, salt)

  // Append hash to message before encrypting
  const hash = await hashMessage(message)
  const payload = JSON.stringify({ m: message, h: hash })

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(payload)
  )

  const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength)
  combined.set(salt, 0)
  combined.set(iv, salt.length)
  combined.set(new Uint8Array(ciphertext), salt.length + iv.length)

  return btoa(String.fromCharCode(...combined))
}

export type DecryptResult = {
  message: string
  intact: boolean
}

export async function decrypt(
  encoded: string,
  password: string,
  keyfile?: Uint8Array
): Promise<DecryptResult | null> {
  if (!encoded || encoded.trim().length === 0) return null

  let combined: Uint8Array
  try {
    combined = Uint8Array.from(atob(encoded.trim()), c => c.charCodeAt(0))
  } catch {
    return null
  }

  if (combined.length < 29) return null

  const salt = combined.slice(0, 16)
  const iv = combined.slice(16, 28)
  const ciphertext = combined.slice(28)

  for (const offset of [0, -1, -2]) {
    try {
      const keyMaterial = await buildKeyMaterial(password, keyfile, offset)
      const key = await getKey(keyMaterial, salt)
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
      )
      const raw = new TextDecoder().decode(decrypted)

      // Parse and verify integrity
      try {
        const parsed = JSON.parse(raw)
        if (parsed.m && parsed.h) {
          const expectedHash = await hashMessage(parsed.m)
          const intact = expectedHash === parsed.h
          return { message: parsed.m, intact }
        }
        // Legacy format — no hash
        return { message: raw, intact: false }
      } catch {
        return { message: raw, intact: false }
      }
    } catch {
      continue
    }
  }

  return null
}

export function getTimeWindow(): { current: string; expiresIn: number } {
  const now = new Date()
  const minutesLeft = 60 - now.getUTCMinutes()
  const current = getHourStamp(0)
  return { current, expiresIn: minutesLeft }
}
