const DELIMITER = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE, 0xBA, 0xBE])

function bytesToBits(bytes: Uint8Array): number[] {
  const bits: number[] = []
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1)
  }
  return bits
}

function xorshift32(seed: number): () => number {
  let s = seed >>> 0
  if (s === 0) s = 2463534242
  return () => {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5
    return s = s >>> 0
  }
}

function keyToSeed(key: Uint8Array): number {
  let seed = 0
  for (let i = 0; i < key.length; i++) seed = ((seed << 5) - seed + key[i]) >>> 0
  return seed === 0 ? 2463534242 : seed
}

function getScatterOrder(pixelCount: number, key: Uint8Array): Uint32Array {
  const prng = xorshift32(keyToSeed(key))
  const indices = new Uint32Array(pixelCount)
  for (let i = 0; i < pixelCount; i++) indices[i] = i
  for (let i = pixelCount - 1; i > 0; i--) {
    const j = prng() % (i + 1)
    const tmp = indices[i]; indices[i] = indices[j]; indices[j] = tmp
  }
  return indices
}

function fillNoise(data: Uint8Array, usedPixels: Set<number>, key: Uint8Array, channel: number): void {
  const prng = xorshift32(keyToSeed(key) ^ (channel * 0x9e3779b9))
  const pixelCount = data.length / 4
  for (let i = 0; i < pixelCount; i++) {
    if (!usedPixels.has(i)) {
      data[i * 4 + channel] = (data[i * 4 + channel] & 0xFE) | (prng() & 1)
    }
  }
}

export function encodePixels(
  pixels: Uint8Array,
  width: number,
  height: number,
  ciphertextBytes: Uint8Array,
  key: Uint8Array
): Uint8Array {
  const pixelCount = width * height
  const payload = new Uint8Array(ciphertextBytes.length + DELIMITER.length)
  payload.set(ciphertextBytes, 0)
  payload.set(DELIMITER, ciphertextBytes.length)

  const bits = bytesToBits(payload)
  if (bits.length > pixelCount) throw new Error('Message too long for this image.')

  const result = new Uint8Array(pixels)
  const scatterKey = new Uint8Array([...key, 0x52])
  const indices = getScatterOrder(pixelCount, scatterKey)
  const usedPixels = new Set<number>()

  for (let i = 0; i < bits.length; i++) {
    const px = indices[i]
    result[px * 4] = (result[px * 4] & 0xFE) | bits[i]
    usedPixels.add(px)
  }

  fillNoise(result, usedPixels, new Uint8Array([...key, 0x4E]), 0)
  fillNoise(result, new Set(), new Uint8Array([...key, 0x47]), 1)
  fillNoise(result, new Set(), new Uint8Array([...key, 0x42]), 2)

  return result
}

export function decodePixels(
  pixels: Uint8Array,
  width: number,
  height: number,
  key: Uint8Array
): Uint8Array | null {
  const pixelCount = width * height
  const scatterKey = new Uint8Array([...key, 0x52])
  const indices = getScatterOrder(pixelCount, scatterKey)

  const bytes: number[] = []
  let bits: number[] = []

  for (let i = 0; i < pixelCount; i++) {
    bits.push(pixels[indices[i] * 4] & 1)
    if (bits.length === 8) {
      let byte = 0
      for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[j]
      bytes.push(byte)
      bits = []

      if (bytes.length >= DELIMITER.length) {
        const tail = bytes.slice(bytes.length - DELIMITER.length)
        if (tail.every((b, i) => b === DELIMITER[i])) {
          return new Uint8Array(bytes.slice(0, bytes.length - DELIMITER.length))
        }
      }
    }
  }
  return null
}
