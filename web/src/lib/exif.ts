export function stripExif(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const clean = document.createElement('canvas')
    clean.width = canvas.width
    clean.height = canvas.height
    const ctx = clean.getContext('2d')
    if (!ctx) return reject(new Error('Canvas error'))
    ctx.drawImage(canvas, 0, 0)
    clean.toBlob(blob => {
      if (!blob) return reject(new Error('Failed to create blob'))
      resolve(blob)
    }, 'image/png')
  })
}
