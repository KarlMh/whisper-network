const DELIMITER = '<<<END>>>'

function textToBits(text: string): number[] {
  return (text + DELIMITER).split('').flatMap(char => {
    const byte = char.charCodeAt(0)
    return Array.from({length: 8}, (_, i) => (byte >> (7 - i)) & 1)
  })
}

function bitsToText(bits: number[]): string {
  let text = ''
  for (let i = 0; i + 7 < bits.length; i += 8) {
    const byte = bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0)
    text += String.fromCharCode(byte)
    if (text.endsWith(DELIMITER)) {
      return text.slice(0, -DELIMITER.length)
    }
  }
  return text
}

export function encode(
  imageData: ImageData,
  realPayload: string,
  decoyPayload: string
): ImageData {
  const realBits = textToBits(realPayload)
  const decoyBits = textToBits(decoyPayload)
  const pixelCount = imageData.data.length / 4

  if (realBits.length > pixelCount) throw new Error('Real message too long. Use a larger image.')
  if (decoyBits.length > pixelCount) throw new Error('Decoy message too long. Use a larger image.')

  const result = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height
  )

  for (let i = 0; i < realBits.length; i++) {
    result.data[i * 4] = (result.data[i * 4] & 0xFE) | realBits[i]
  }

  for (let i = 0; i < decoyBits.length; i++) {
    result.data[i * 4 + 1] = (result.data[i * 4 + 1] & 0xFE) | decoyBits[i]
  }

  return result
}

export function decodeChannel(imageData: ImageData, channel: 0 | 1): string {
  const bits: number[] = []
  const pixels = imageData.data

  for (let i = 0; i < pixels.length / 4; i++) {
    bits.push(pixels[i * 4 + channel] & 1)
  }

  return bitsToText(bits)
}
