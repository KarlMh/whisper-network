const DELIMITER = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE, 0xBA, 0xBE])

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a)
}

function grad(hash: number, x: number, y: number): number {
  const h = hash & 3
  const u = h < 2 ? x : y
  const v = h < 2 ? y : x
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v)
}

function buildPermTable(seed: Uint8Array): Uint8Array {
  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  let s = 0
  for (let i = 255; i > 0; i--) {
    s = (s + seed[i % seed.length] + i) & 0xFF
    const tmp = p[i]; p[i] = p[s]; p[s] = tmp
  }
  return p
}

function perlinNoise(x: number, y: number, perm: Uint8Array): number {
  const X = Math.floor(x) & 255
  const Y = Math.floor(y) & 255
  const xf = x - Math.floor(x)
  const yf = y - Math.floor(y)
  const u = fade(xf), v = fade(yf)
  const aa = perm[(perm[X] + Y) & 255]
  const ab = perm[(perm[X] + Y + 1) & 255]
  const ba = perm[(perm[X + 1] + Y) & 255]
  const bb = perm[(perm[X + 1] + Y + 1) & 255]
  return lerp(lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u), lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u), v)
}

function octavePerlin(x: number, y: number, perm: Uint8Array, octaves: number, persistence: number): number {
  let total = 0, frequency = 1, amplitude = 1, maxValue = 0
  for (let i = 0; i < octaves; i++) {
    total += perlinNoise(x * frequency, y * frequency, perm) * amplitude
    maxValue += amplitude
    amplitude *= persistence
    frequency *= 2
  }
  return total / maxValue
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

// Generate Perlin noise canvas as carrier
function generateNoiseCanvas(key: Uint8Array, width: number, height: number): Uint8ClampedArray {
  const baseSeed = new Uint8Array(256)
  for (let i = 0; i < 256; i++) baseSeed[i] = key[i % key.length] ^ (i * 0x9e & 0xFF)
  const perm = buildPermTable(baseSeed)
  const data = new Uint8ClampedArray(width * height * 4)
  const scale = 3.5, octaves = 6, persistence = 0.5

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x / width) * scale
      const ny = (y / height) * scale
      const r = octavePerlin(nx, ny, perm, octaves, persistence)
      const g = octavePerlin(nx + 100, ny + 100, perm, octaves, persistence)
      const b = octavePerlin(nx + 200, ny + 200, perm, octaves, persistence)
      const idx = (y * width + x) * 4
      data[idx] = Math.floor((r * 0.5 + 0.5) * 255)
      data[idx + 1] = Math.floor((g * 0.5 + 0.5) * 255)
      data[idx + 2] = Math.floor((b * 0.5 + 0.5) * 255)
      data[idx + 3] = 255
    }
  }
  return data
}

// Embed ciphertext into LSBs of generated noise image using scatter pattern
export function generateCarrier(
  ciphertextBytes: Uint8Array,
  key: Uint8Array,
  width = 512,
  height = 512
): ImageData {
  const data = generateNoiseCanvas(key, width, height)
  const pixelCount = width * height

  // Build payload: length prefix (4 bytes) + ciphertext + delimiter
  const payload = new Uint8Array(4 + ciphertextBytes.length + DELIMITER.length)
  const view = new DataView(payload.buffer)
  view.setUint32(0, ciphertextBytes.length, true)
  payload.set(ciphertextBytes, 4)
  payload.set(DELIMITER, 4 + ciphertextBytes.length)

  // Convert payload to bits
  const bits: number[] = []
  for (const byte of payload) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1)
  }

  if (bits.length > pixelCount) throw new Error('Message too long for generative carrier.')

  // Scatter embed into R channel
  const scatterKey = new Uint8Array([...key, 0x47, 0x43]) // GC marker
  const indices = getScatterOrder(pixelCount, scatterKey)

  for (let i = 0; i < bits.length; i++) {
    const px = indices[i]
    data[px * 4] = (data[px * 4] & 0xFE) | bits[i]
  }

  return new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer), width, height)
}

// Decode: regenerate the same noise canvas, extract LSBs in same scatter order
export function decodeCarrier(
  imageData: ImageData,
  key: Uint8Array
): Uint8Array | null {
  const { width, height, data } = imageData
  const pixelCount = width * height

  const scatterKey = new Uint8Array([...key, 0x47, 0x43])
  const indices = getScatterOrder(pixelCount, scatterKey)

  // Extract bits
  const bits: number[] = []
  for (let i = 0; i < pixelCount; i++) {
    bits.push(data[indices[i] * 4] & 1)
  }

  // Convert bits to bytes
  const bytes: number[] = []
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]
    bytes.push(byte)
  }

  if (bytes.length < 4) return null

  // Read length prefix
  const len = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)
  if (len <= 0 || len > 500000) return null

  // Extract ciphertext
  const ciphertext = new Uint8Array(bytes.slice(4, 4 + len))

  // Verify delimiter
  const tail = bytes.slice(4 + len, 4 + len + DELIMITER.length)
  const valid = tail.length === DELIMITER.length && tail.every((b, i) => b === DELIMITER[i])
  if (!valid) return null

  return ciphertext
}

export function getGenerativeCapacity(): number {
  return Math.floor((512 * 512) / 8) - 100
}
