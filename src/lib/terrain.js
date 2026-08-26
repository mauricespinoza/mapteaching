// Curvas de nivel a partir de un relieve: o de una topografía típica de las que
// se usan para enseñar a leer un mapa, o de un modelo de elevación importado.
//
// Un ejercicio necesita curvas de nivel antes que nada: sin ellas no hay cota
// del terreno, y sin cota no hay contornos estructurales, ni perfil, ni 3D.
// Digitalizarlas sobre una carta escaneada es lento, y para practicar la
// lectura del relieve —la regla de las uves, una cuenca cerrada, un escarpe—
// basta con un terreno de laboratorio del que se conoce la respuesta.
//
// El relieve se define como una función de la posición sobre el rectángulo de
// trabajo, en coordenadas normalizadas (u, v) que van de −1 a 1 desde el
// centro, y las curvas salen de esa función con el mismo trazador de isolíneas
// que usa el resto de la app. Así la curva de 300 es exactamente la isolínea de
// 300 del terreno, sin errores de digitalización, y el alumno puede comprobar
// su lectura contra la verdad.

import { contourLines } from './marching.js'
import { simplify } from './geom.js'

/**
 * Topografías típicas. Cada una devuelve un valor entre 0 y 1 —la altura
 * relativa— sobre el rectángulo de trabajo; la cota real la ponen la base y el
 * desnivel que elija quien monta el ejercicio.
 */
export const TERRAIN_PRESETS = [
  {
    id: 'domo',
    label: 'Cerro (domo)',
    hint: 'Curvas cerradas concéntricas: la cima queda entre la última curva y la siguiente.',
    f: (u, v) => Math.exp(-2.6 * (u * u + v * v)),
  },
  {
    id: 'cuenca',
    label: 'Cuenca cerrada',
    hint: 'Una depresión: curvas cerradas que se leen al revés que las de un cerro.',
    f: (u, v) => 0.92 - 0.85 * Math.exp(-3 * (u * u + v * v)) - 0.06 * u,
  },
  {
    id: 'valle',
    label: 'Valle en V',
    hint: 'Un valle encajado en una ladera: las curvas hacen uves que apuntan aguas arriba.',
    f: (u, v) => 0.86 - 0.3 * u - 0.5 * Math.exp(-((v / 0.22) ** 2)),
  },
  {
    id: 'meandro',
    label: 'Valle meandriforme',
    hint: 'El mismo valle, pero sinuoso: la uve gira con el cauce.',
    f: (u, v) => 0.88 - 0.26 * u - 0.5 * Math.exp(-(((v - 0.38 * Math.sin(2.6 * u)) / 0.18) ** 2)),
  },
  {
    id: 'cuchilla',
    label: 'Dos valles y una cuchilla',
    hint: 'Dos valles paralelos separados por una divisoria estrecha y afilada.',
    f: (u, v) =>
      0.5 -
      0.16 * u +
      0.5 * Math.exp(-Math.abs(v) / 0.13) -
      0.34 * (Math.exp(-(((v - 0.5) / 0.2) ** 2)) + Math.exp(-(((v + 0.5) / 0.2) ** 2))),
  },
  {
    id: 'escarpe',
    label: 'Meseta con escarpe',
    hint: 'Curvas muy separadas arriba y apretadas en el escarpe: pendiente de un vistazo.',
    f: (u, v) => 0.12 + 0.82 / (1 + Math.exp(9 * u)) + 0.06 * v * v,
  },
  {
    id: 'ladera',
    label: 'Ladera uniforme',
    hint: 'Curvas rectas y equiespaciadas: el caso de referencia para medir un manteo.',
    f: (u) => 0.5 + 0.47 * u,
  },
]

export const terrainPreset = (id) => TERRAIN_PRESETS.find((p) => p.id === id) || TERRAIN_PRESETS[0]

/**
 * Campo de cota sobre el rectángulo de la imagen, en píxeles.
 *
 * `azimuth` gira el relieve para que el mismo accidente se pueda plantear en
 * cualquier orientación. Las coordenadas se normalizan por el lado mayor, así
 * que el accidente no se deforma con la forma del rectángulo.
 */
export function terrainField(presetId, rect, { base = 0, relief = 500, azimuth = 0 } = {}) {
  const { f } = terrainPreset(presetId)
  const cx = rect.width / 2
  const cy = rect.height / 2
  const half = Math.max(rect.width, rect.height) / 2
  const a = (azimuth * Math.PI) / 180
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  return (px, py) => {
    // La imagen crece hacia abajo; se invierte para que «norte» sea arriba.
    const x = (px - cx) / half
    const y = (cy - py) / half
    return base + relief * f(x * ca + y * sa, -x * sa + y * ca)
  }
}

/**
 * Curvas de nivel de un campo de cota, listas para el proyecto: polilíneas en
 * píxeles de imagen, agrupadas por cota.
 *
 * Se descartan las curvas de dos o tres puntos, que sólo rozan una esquina y no
 * aportan nada al ejercicio, y se aligeran las demás: el trazador deja un
 * vértice por celda de la rejilla y en una curva suave eso son cientos de
 * puntos que pesan en el archivo y en cada dibujado sin cambiar el trazo.
 */
export function contoursFromField(field, rect, { interval = 100, resolution = 260, tol = 0.7 } = {}) {
  if (!(interval > 0)) return []
  const bbox = { minX: 0, minY: 0, maxX: rect.width, maxY: rect.height }
  const nx = Math.max(40, Math.round(resolution * Math.min(1, rect.width / Math.max(rect.width, rect.height))))
  const ny = Math.max(40, Math.round(resolution * Math.min(1, rect.height / Math.max(rect.width, rect.height))))

  let zmin = Infinity
  let zmax = -Infinity
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const z = field((rect.width * i) / nx, (rect.height * j) / ny)
      if (!Number.isFinite(z)) continue
      if (z < zmin) zmin = z
      if (z > zmax) zmax = z
    }
  }
  if (!Number.isFinite(zmin) || !Number.isFinite(zmax)) return []

  const out = []
  const first = Math.ceil(zmin / interval) * interval
  // Un tope generoso pero finito: un intervalo absurdo no debe colgar la app.
  for (let z = first, guard = 0; z <= zmax && guard < 400; z += interval, guard++) {
    for (const line of contourLines(field, bbox, nx, ny, z)) {
      if (line.length < 4) continue
      // Dos puntos bastan: una curva recta —la de una ladera uniforme— se
      // aligera hasta sus dos extremos y sigue siendo la curva correcta.
      const pts = simplify(line, tol)
      if (pts.length < 2) continue
      out.push({ elevation: Math.round(z * 100) / 100, pts })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Modelos de elevación importados
// ---------------------------------------------------------------------------

/**
 * Rejilla de cotas: `{ ncols, nrows, cellsize, z, zmin, zmax, nodata }`, con `z`
 * ordenada por filas de norte a sur, que es como la escriben los formatos de
 * malla. `cellsize` en metros de terreno por celda, o null si el formato no lo
 * dice.
 */
function makeGrid(ncols, nrows, cellsize, z) {
  let zmin = Infinity
  let zmax = -Infinity
  let n = 0
  for (const v of z) {
    if (!Number.isFinite(v)) continue
    n++
    if (v < zmin) zmin = v
    if (v > zmax) zmax = v
  }
  if (!n) return null
  return { ncols, nrows, cellsize, z, zmin, zmax, defined: n }
}

/**
 * Malla ASCII de ESRI (.asc), que es lo que exporta cualquier SIG: una cabecera
 * de pares «clave valor» y luego las filas de cotas, la primera al norte.
 */
export function parseAsciiGrid(text) {
  const head = {}
  const lines = text.split(/\r?\n/)
  let i = 0
  const KEYS = ['ncols', 'nrows', 'xllcorner', 'yllcorner', 'xllcenter', 'yllcenter', 'cellsize', 'nodata_value']
  for (; i < lines.length; i++) {
    const m = /^\s*([A-Za-z_]+)\s+(-?[\d.eE+]+)\s*$/.exec(lines[i])
    if (!m || !KEYS.includes(m[1].toLowerCase())) break
    head[m[1].toLowerCase()] = Number(m[2])
  }
  const ncols = head.ncols | 0
  const nrows = head.nrows | 0
  if (!(ncols > 1 && nrows > 1)) return null
  const nodata = Number.isFinite(head.nodata_value) ? head.nodata_value : -9999
  const z = new Float64Array(ncols * nrows).fill(NaN)
  let k = 0
  for (; i < lines.length && k < z.length; i++) {
    const row = lines[i].trim()
    if (!row) continue
    for (const tok of row.split(/\s+/)) {
      if (k >= z.length) break
      const v = Number(tok)
      z[k++] = Number.isFinite(v) && v !== nodata ? v : NaN
    }
  }
  if (k < z.length * 0.5) return null
  return makeGrid(ncols, nrows, head.cellsize > 0 ? head.cellsize : null, z)
}

/**
 * Nube de puntos x y z en filas (XYZ, CSV o separado por tabuladores). Se
 * reconstruye la malla a partir de los valores distintos de x y de y: es un
 * volcado de rejilla, no una nube dispersa, y así se recupera tal cual.
 */
export function parseXyz(text) {
  const xs = new Set()
  const ys = new Set()
  const pts = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || /[A-Za-z]/.test(t[0])) continue
    const parts = t.split(/[\s,;]+/).map(Number)
    if (parts.length < 3 || parts.slice(0, 3).some((v) => !Number.isFinite(v))) continue
    pts.push(parts)
    xs.add(parts[0])
    ys.add(parts[1])
    if (pts.length > 4e6) break
  }
  const ux = [...xs].sort((a, b) => a - b)
  const uy = [...ys].sort((a, b) => a - b)
  if (ux.length < 2 || uy.length < 2 || pts.length < ux.length * uy.length * 0.5) return null
  const ix = new Map(ux.map((v, i) => [v, i]))
  const iy = new Map(uy.map((v, i) => [v, i]))
  const z = new Float64Array(ux.length * uy.length).fill(NaN)
  for (const [x, y, v] of pts) {
    // Fila 0 al norte: la y mayor va arriba.
    const r = uy.length - 1 - iy.get(y)
    z[r * ux.length + ix.get(x)] = v
  }
  const dx = (ux[ux.length - 1] - ux[0]) / (ux.length - 1)
  return makeGrid(ux.length, uy.length, dx > 0 ? dx : null, z)
}

/** Elige el analizador según lo que traiga el texto. */
export function parseDemText(text) {
  return parseAsciiGrid(text) || parseXyz(text)
}

/**
 * Imagen en escala de grises como mapa de alturas: lo más claro, lo más alto.
 * No trae escala ni cotas —una imagen no sabe de metros—, así que el rango lo
 * pone quien importa. Va bien para practicar sobre un relieve cualquiera.
 */
export function gridFromImage(img, { maxSide = 400 } = {}) {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
  const ncols = Math.max(2, Math.round(img.width * scale))
  const nrows = Math.max(2, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = ncols
  canvas.height = nrows
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, ncols, nrows)
  const data = ctx.getImageData(0, 0, ncols, nrows).data
  const z = new Float64Array(ncols * nrows)
  for (let k = 0; k < z.length; k++) {
    const o = k * 4
    // Luminancia perceptual; un píxel transparente no es terreno.
    z[k] = data[o + 3] < 8 ? NaN : (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) / 255
  }
  return makeGrid(ncols, nrows, null, z)
}

/**
 * Campo de cota de una rejilla, colocada sobre el rectángulo de trabajo.
 *
 * Se encaja conservando la proporción y centrada: estirar un modelo de
 * elevación para que llene el rectángulo deformaría el relieve y con él los
 * manteos que se midan después. Fuera de la rejilla no hay dato y no hay curva.
 *
 * Con `range` se reescalan las cotas al intervalo pedido, que es lo que hace
 * falta cuando el relieve viene de una imagen y no de un modelo con metros.
 */
export function gridField(grid, rect, { range = null } = {}) {
  const scale = Math.min(rect.width / grid.ncols, rect.height / grid.nrows)
  const w = grid.ncols * scale
  const h = grid.nrows * scale
  const x0 = (rect.width - w) / 2
  const y0 = (rect.height - h) / 2
  const span = grid.zmax - grid.zmin || 1
  const lo = range ? range[0] : grid.zmin
  const hi = range ? range[1] : grid.zmax
  const remap = (v) => (range ? lo + ((v - grid.zmin) / span) * (hi - lo) : v)

  const field = (px, py) => {
    const fx = (px - x0) / scale
    const fy = (py - y0) / scale
    if (fx < 0 || fy < 0 || fx > grid.ncols - 1 || fy > grid.nrows - 1) return NaN
    const i = Math.min(grid.ncols - 2, Math.floor(fx))
    const j = Math.min(grid.nrows - 2, Math.floor(fy))
    const tx = fx - i
    const ty = fy - j
    const a = grid.z[j * grid.ncols + i]
    const b = grid.z[j * grid.ncols + i + 1]
    const c = grid.z[(j + 1) * grid.ncols + i]
    const d = grid.z[(j + 1) * grid.ncols + i + 1]
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) return NaN
    return remap(
      a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty
    )
  }
  field.placement = { x0, y0, scale, width: w, height: h }
  field.range = [remap(grid.zmin), remap(grid.zmax)]
  return field
}

/**
 * Escala del mapa que implica una rejilla con tamaño de celda conocido: metros
 * de terreno por píxel de imagen. Es el dato que la app necesita para que todo
 * lo demás —manteos, espesores, la barra de escala— salga en metros de verdad.
 */
export const metersPerPxOfGrid = (grid, field) =>
  grid?.cellsize > 0 && field?.placement?.scale > 0 ? grid.cellsize / field.placement.scale : null

/** Equidistancia razonable para un desnivel dado: unas 10–20 curvas. */
export function suggestInterval(span) {
  if (!(span > 0)) return 100
  const raw = span / 14
  const mag = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= mag * m) return mag * m
  return mag * 10
}
