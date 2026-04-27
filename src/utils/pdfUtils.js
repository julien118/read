export async function generateCover(buffer) {
  const pdfjsLib = window['pdfjs-dist/build/pdf']
  let pdf = null
  try {
    pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise
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
