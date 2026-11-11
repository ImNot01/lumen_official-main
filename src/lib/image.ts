export const MAX_INPUT_BYTES = 15 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/** Validates, center-crops to a square, shrinks to `size` px and compresses. */
export async function processAvatar(file: File, size = 512): Promise<Blob> {
  const isHeic = /\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type)
  if (!ALLOWED_TYPES.includes(file.type.toLowerCase()) && !isHeic) {
    throw new Error('Use a JPG, PNG, WEBP or GIF image.')
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('That image is over 15 MB. Choose a smaller one.')
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error(
      isHeic
        ? 'Your browser cannot open HEIC photos. Choose a JPG or PNG instead.'
        : 'This image could not be read. Try a different file.',
    )
  }

  const side = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - side) / 2
  const sy = (bitmap.height - side) / 2
  const out = Math.min(size, side)
  const canvas = document.createElement('canvas')
  canvas.width = out
  canvas.height = out
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('Your browser cannot process images.')
  }
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out)
  bitmap.close()

  const webp = await toBlob(canvas, 'image/webp', 0.85)
  if (webp && webp.type === 'image/webp') return webp
  const jpeg = await toBlob(canvas, 'image/jpeg', 0.88)
  if (!jpeg) throw new Error('Could not prepare the image. Try a different one.')
  return jpeg
}
