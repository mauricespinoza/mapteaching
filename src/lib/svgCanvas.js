// Un `CanvasRenderingContext2D` de mentira: en vez de pintar píxeles arma
// nodos SVG. Implementa sólo lo que `render()` (render2d.js) de verdad usa —se
// repasó llamada por llamada—, así que el mismo motor de dibujo del mapa sirve
// a la vez para la pantalla y para exportarlo como vector, y las dos salidas
// no se pueden desincronizar como pasaría si el SVG se armara aparte.
//
// Lo que simplifica todo: los arcos de esta app son siempre círculos completos
// (ningún sector), así que se emiten como `<circle>`; el texto es de una sola
// línea; y `ctx.transform` sólo se usa para colocar un raster ya calculado
// (relleno de unidades, sombreado, modelos), nunca anidado con trazos propios,
// así que basta con acumular una matriz y aplicarla a cada punto.

const NS = 'http://www.w3.org/2000/svg'

/** Compone `m` con `n`, con la misma convención que `ctx.transform(a,b,c,d,e,f)`. */
function multiply(m, n) {
  const [a1, b1, c1, d1, e1, f1] = m
  const [a2, b2, c2, d2, e2, f2] = n
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ]
}

const apply = ([a, b, c, d, e, f], x, y) => [a * x + c * y + e, b * x + d * y + f]
const fmt = (n) => (Math.round(n * 100) / 100).toString()

let measureCtx = null
/** Único <canvas> oculto para medir texto: es la única forma fiable de medir
 * una fuente sin reimplementar sus métricas. */
function measurer() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  return measureCtx
}

/** `ctx.font` ("600 11px ui-sans-serif, …") a los atributos que pide un `<text>`. */
function fontAttrs(font) {
  const m = /^\s*(?:(?:italic|normal)\s+)?(\d+|bold|normal)?\s*([\d.]+)px\s+(.+)$/.exec(font || '')
  if (!m) return { size: 11, weight: '400', family: 'sans-serif' }
  return { size: Number(m[2]), weight: m[1] || '400', family: m[3] }
}

/** Un `<canvas>` o una `<img>` a un data: URI, para que el SVG quede autónomo. */
function toDataUrl(source) {
  if (typeof source.toDataURL === 'function') return source.toDataURL('image/png')
  const c = document.createElement('canvas')
  c.width = source.naturalWidth || source.width
  c.height = source.naturalHeight || source.height
  c.getContext('2d').drawImage(source, 0, 0)
  return c.toDataURL('image/png')
}

export class SvgCanvasContext {
  constructor(width, height) {
    this.svg = document.createElementNS(NS, 'svg')
    this.svg.setAttribute('width', width)
    this.svg.setAttribute('height', height)
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    this.root = document.createElementNS(NS, 'g')
    this.svg.appendChild(this.root)

    this.fillStyle = '#000'
    this.strokeStyle = '#000'
    this.lineWidth = 1
    this.lineJoin = 'miter'
    this.lineCap = 'butt'
    this.font = '10px sans-serif'
    this.textAlign = 'start'
    this.textBaseline = 'alphabetic'
    this.globalAlpha = 1
    this._dash = []
    this._matrix = [1, 0, 0, 1, 0, 0]
    this._stack = []
    this._subpaths = []
    this._cur = null
  }

  // --- estado: lo mismo que guarda/repone un `save()`/`restore()` de verdad ---
  save() {
    this._stack.push({
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      lineJoin: this.lineJoin,
      lineCap: this.lineCap,
      font: this.font,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
      globalAlpha: this.globalAlpha,
      dash: this._dash,
      matrix: this._matrix,
    })
  }
  restore() {
    const s = this._stack.pop()
    if (!s) return
    this.fillStyle = s.fillStyle
    this.strokeStyle = s.strokeStyle
    this.lineWidth = s.lineWidth
    this.lineJoin = s.lineJoin
    this.lineCap = s.lineCap
    this.font = s.font
    this.textAlign = s.textAlign
    this.textBaseline = s.textBaseline
    this.globalAlpha = s.globalAlpha
    this._dash = s.dash
    this._matrix = s.matrix
  }
  setLineDash(d) {
    this._dash = d || []
  }
  // La densidad de píxeles de la pantalla no le importa a un vector: el SVG ya
  // sale a escala 1:1 en las mismas unidades que `view`.
  setTransform() {}
  transform(a, b, c, d, e, f) {
    this._matrix = multiply(this._matrix, [a, b, c, d, e, f])
  }
  set imageSmoothingEnabled(_v) {}
  set imageSmoothingQuality(_v) {}

  // --- trazado ---
  beginPath() {
    this._subpaths = []
    this._cur = null
  }
  moveTo(x, y) {
    this._cur = { pts: [apply(this._matrix, x, y)], closed: false }
    this._subpaths.push(this._cur)
  }
  lineTo(x, y) {
    if (!this._cur) return this.moveTo(x, y)
    this._cur.pts.push(apply(this._matrix, x, y))
  }
  closePath() {
    if (this._cur) this._cur.closed = true
  }
  /** Sólo hacen falta círculos completos en esta app; ver la cabecera del archivo. */
  arc(cx, cy, r, a0, a1) {
    const full = Math.abs(Math.abs(a1 - a0) - Math.PI * 2) < 1e-6
    if (full) {
      this._cur = { circle: { c: apply(this._matrix, cx, cy), r }, pts: [] }
      this._subpaths.push(this._cur)
      return
    }
    // Un arco parcial no se usa hoy, pero por si acaso: se aproxima con
    // segmentos rectos, indistinguible de una curva a esta escala.
    const pts = []
    const steps = 48
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (a1 - a0) * (i / steps)
      pts.push(apply(this._matrix, cx + Math.cos(a) * r, cy + Math.sin(a) * r))
    }
    this._cur = { pts, closed: false }
    this._subpaths.push(this._cur)
  }
  rect(x, y, w, h) {
    this._cur = {
      pts: [
        apply(this._matrix, x, y),
        apply(this._matrix, x + w, y),
        apply(this._matrix, x + w, y + h),
        apply(this._matrix, x, y + h),
      ],
      closed: true,
    }
    this._subpaths.push(this._cur)
  }

  _pathData() {
    return this._subpaths
      .map((sp) => {
        if (sp.circle || !sp.pts.length) return ''
        const [p0, ...rest] = sp.pts
        let d = `M${fmt(p0[0])},${fmt(p0[1])}`
        for (const p of rest) d += `L${fmt(p[0])},${fmt(p[1])}`
        if (sp.closed) d += 'Z'
        return d
      })
      .filter(Boolean)
      .join(' ')
  }
  _strokeAttrs() {
    const a = {
      fill: 'none',
      stroke: this.strokeStyle,
      'stroke-width': fmt(this.lineWidth),
      'stroke-linejoin': this.lineJoin,
      'stroke-linecap': this.lineCap,
    }
    if (this._dash?.length) a['stroke-dasharray'] = this._dash.map(fmt).join(',')
    if (this.globalAlpha < 1) a['stroke-opacity'] = fmt(this.globalAlpha)
    return a
  }
  _fillAttrs() {
    const a = { fill: this.fillStyle, stroke: 'none' }
    if (this.globalAlpha < 1) a['fill-opacity'] = fmt(this.globalAlpha)
    return a
  }
  _emit(tag, attrs) {
    const el = document.createElementNS(NS, tag)
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    this.root.appendChild(el)
    return el
  }

  stroke() {
    for (const sp of this._subpaths) {
      if (sp.circle) this._emit('circle', { cx: fmt(sp.circle.c[0]), cy: fmt(sp.circle.c[1]), r: fmt(sp.circle.r), ...this._strokeAttrs() })
    }
    const d = this._pathData()
    if (d) this._emit('path', { d, ...this._strokeAttrs() })
  }
  fill() {
    for (const sp of this._subpaths) {
      if (sp.circle) this._emit('circle', { cx: fmt(sp.circle.c[0]), cy: fmt(sp.circle.c[1]), r: fmt(sp.circle.r), ...this._fillAttrs() })
    }
    const d = this._pathData()
    if (d) this._emit('path', { d, ...this._fillAttrs() })
  }
  clearRect() {}
  fillRect(x, y, w, h) {
    const [x0, y0] = apply(this._matrix, x, y)
    const [x1, y1] = apply(this._matrix, x + w, y + h)
    this._emit('rect', {
      x: fmt(Math.min(x0, x1)),
      y: fmt(Math.min(y0, y1)),
      width: fmt(Math.abs(x1 - x0)),
      height: fmt(Math.abs(y1 - y0)),
      ...this._fillAttrs(),
    })
  }
  strokeRect(x, y, w, h) {
    const [x0, y0] = apply(this._matrix, x, y)
    const [x1, y1] = apply(this._matrix, x + w, y + h)
    this._emit('rect', {
      x: fmt(Math.min(x0, x1)),
      y: fmt(Math.min(y0, y1)),
      width: fmt(Math.abs(x1 - x0)),
      height: fmt(Math.abs(y1 - y0)),
      ...this._strokeAttrs(),
    })
  }

  measureText(text) {
    const m = measurer()
    m.font = this.font
    return m.measureText(text)
  }
  fillText(text, x, y) {
    const { size, weight, family } = fontAttrs(this.font)
    const anchor = this.textAlign === 'center' ? 'middle' : this.textAlign === 'right' || this.textAlign === 'end' ? 'end' : 'start'
    const baseline =
      this.textBaseline === 'middle'
        ? 'central'
        : this.textBaseline === 'top' || this.textBaseline === 'hanging'
          ? 'hanging'
          : 'alphabetic'
    const [px, py] = apply(this._matrix, x, y)
    this._emit('text', {
      x: fmt(px),
      y: fmt(py),
      'font-size': fmt(size),
      'font-weight': weight,
      'font-family': family,
      'text-anchor': anchor,
      'dominant-baseline': baseline,
      fill: this.fillStyle,
    }).textContent = text
  }

  /** Las dos formas que usa `render()`: `(img, dx, dy)` y `(img, dx, dy, dw, dh)`. */
  drawImage(source, dx, dy, dw, dh) {
    let href
    try {
      href = toDataUrl(source)
    } catch {
      // Un lienzo manchado por CORS no se puede volcar a base64: se omite esa
      // imagen antes que reventar toda la exportación por ella.
      return
    }
    const natW = source.naturalWidth || source.width
    const natH = source.naturalHeight || source.height
    const w = dw ?? natW
    const h = dh ?? natH
    const scaleX = natW ? w / natW : 1
    const scaleY = natH ? h / natH : 1
    const local = multiply(this._matrix, [scaleX, 0, 0, scaleY, dx, dy])
    this._emit('image', {
      x: 0,
      y: 0,
      width: fmt(natW),
      height: fmt(natH),
      transform: `matrix(${local.map(fmt).join(',')})`,
      preserveAspectRatio: 'none',
      href,
    })
  }
}
