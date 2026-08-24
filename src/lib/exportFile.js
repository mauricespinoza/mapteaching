// Descargas: proyecto (.json), SVG y PNG de las vistas.

export function download(filename, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export const downloadText = (filename, text, type = 'application/json') =>
  download(filename, new Blob([text], { type }))

export function svgString(svgEl) {
  const clone = svgEl.cloneNode(true)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  return new XMLSerializer().serializeToString(clone)
}

export function downloadSvg(svgEl, filename) {
  downloadText(filename, svgString(svgEl), 'image/svg+xml')
}

export async function downloadSvgAsPng(svgEl, filename, scale = 2) {
  const str = svgString(svgEl)
  const box = svgEl.viewBox.baseVal
  const w = (box?.width || svgEl.clientWidth) * scale
  const h = (box?.height || svgEl.clientHeight) * scale
  const blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    await new Promise((resolve) => canvas.toBlob((b) => {
      if (b) download(filename, b)
      resolve()
    }, 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function downloadCanvasPng(canvas, filename) {
  canvas.toBlob((b) => b && download(filename, b), 'image/png')
}
