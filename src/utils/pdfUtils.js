import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href

export async function generateCover(buffer) {
  let pdf = null
  try {
    pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise
    const page = await pdf.getPage(1)
    const vp = page.getViewport({ scale: 1 })
    const scale = Math.min(300 / vp.width, 400 / vp.height)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    return canvas.toDataURL('image/jpeg', 0.75)
  } catch {
    return null
  } finally {
    pdf?.destroy()
  }
}
