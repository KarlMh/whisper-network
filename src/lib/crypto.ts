export async function encryptToBytes(
  message: string,
  password: string,
  keyfile?: Uint8Array,
  sharedSecret?: Uint8Array
): Promise<Uint8Array> {
  const encoded = await encrypt(message, password, keyfile, sharedSecret)
  return Uint8Array.from(atob(encoded), c => c.charCodeAt(0))
}

export async function decryptFromBytes(
  bytes: Uint8Array,
  password: string,
  keyfile?: Uint8Array,
  sharedSecret?: Uint8Array
): Promise<DecryptResult | null> {
  const encoded = btoa(String.fromCharCode(...bytes))
  return decrypt(encoded, password, keyfile, sharedSecret)
}

export async function decryptString(
  encoded: string,
  password: string,
  keyfile?: Uint8Array,
  sharedSecret?: Uint8Array
): Promise<DecryptResult | null> {
  return decrypt(encoded, password, keyfile, sharedSecret)
}
