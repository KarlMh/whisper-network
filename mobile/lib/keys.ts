import 'react-native-get-random-values'

export type KeyPair = {
  publicKey: CryptoKey
  privateKey: CryptoKey
  publicKeyRaw: string
}

export async function generateKeyPair(): Promise<KeyPair> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  )
  const publicKeyBuffer = await crypto.subtle.exportKey('raw', pair.publicKey)
  const publicKeyRaw = btoa(String.fromCharCode(...new Uint8Array(publicKeyBuffer)))
  return { publicKey: pair.publicKey, privateKey: pair.privateKey, publicKeyRaw }
}

export async function deriveSharedSecret(privateKey: CryptoKey, theirPublicKeyRaw: string): Promise<Uint8Array> {
  const theirPublicKeyBytes = Uint8Array.from(atob(theirPublicKeyRaw), c => c.charCodeAt(0))
  const theirPublicKey = await crypto.subtle.importKey(
    'raw', theirPublicKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' }, false, []
  )
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: theirPublicKey }, privateKey, 256
  )
  return new Uint8Array(sharedBits)
}

export async function exportPrivateKey(privateKey: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('pkcs8', privateKey)
  return btoa(String.fromCharCode(...new Uint8Array(exported)))
}

export async function importPrivateKey(raw: string): Promise<CryptoKey> {
  const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0))
  return crypto.subtle.importKey('pkcs8', bytes, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits'])
}

export async function generateSafetyNumber(myPublicKeyRaw: string, theirPublicKeyRaw: string): Promise<string> {
  const enc = new TextEncoder()
  const keys = [myPublicKeyRaw, theirPublicKeyRaw].sort()
  const combined = enc.encode(keys[0] + keys[1])
  const hashBuffer = await crypto.subtle.digest('SHA-256', combined)
  const hashArray = new Uint8Array(hashBuffer)
  let number = ''
  for (let i = 0; i < 5; i++) {
    const chunk = ((hashArray[i * 2] << 8) | hashArray[i * 2 + 1]) % 100000
    number += chunk.toString().padStart(5, '0')
    if (i < 4) number += ' '
  }
  return number
}
