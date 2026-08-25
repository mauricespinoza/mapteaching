// Modelos estructurales sintéticos: dado un punto de anclaje y unos pocos
// parámetros de orientación, se calcula la traza que los contactos dibujarían
// sobre la topografía (o sobre un terreno plano si aún no hay curvas).
//
// Los tres modelos comparten la misma idea: cada contacto es una superficie
// z = f(x, y); su traza en planta es la curva donde esa superficie corta la
// topografía, es decir la isolínea cero de (z_superficie − z_topografía).

import { contourLines } from './marching.js'
import { toImage } from './georef.js'
import { formatAttitude, azimuthWorld, norm360 } from './georef.js'
import { UNIT_COLORS, uid } from './model.js'

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

export const MODEL_KINDS = [
  {
    id: 'plane',
    label: 'Plano único',
    hint: 'Un contacto con rumbo y manteo: muestra la traza que dibujaría en el mapa.',
  },
  {
    id: 'layercake',
    label: 'Serie de capas (layer cake)',
    hint: 'n capas paralelas con el mismo rumbo y manteo.',
  },
  {
    id: 'fold',
    label: 'Pliegues',
    hint: 'Tren de pliegues cilíndricos rectos sobre una serie de capas.',
  },
]

export const FOLD_SHAPES = [
  { id: 'sinusoidal', label: 'Redondeado (sinusoidal)' },
  { id: 'chevron', label: 'Angular (chevron)' },
]

export function newStructuralModel(kind, at, index = 0) {
  return {
    id: uid('m'),
    kind: kind || 'plane',
    name:
      kind === 'fold'
        ? `Pliegues ${index + 1}`
        : kind === 'layercake'
          ? `Serie ${index + 1}`
          : `Plano ${index + 1}`,
    at, // punto de anclaje, en píxeles de imagen
    elevation: null, // cota del anclaje; null = la topografía en ese punto
    // Orientación del plano (regla de la mano derecha: el manteo cae 90° en
    // sentido horario desde el rumbo).
    strike: 0,
    dip: 30,
    // Serie de capas
    layers: kind === 'fold' ? 6 : 5,
    thickness: kind === 'fold' ? 200 : 300, // espesor perpendicular, en metros
    // Pliegues
    trend: 0,
    plunge: 10,
    interlimb: 70, // ángulo interlimbo, en grados
    wavelength: 2500, // distancia cresta a cresta, en metros
    asymmetry: 0, // 0 = simétrico … 0.9 = muy asimétrico
    shape: 'sinusoidal',
    // Presentación
    palette: 0,
    fill: true, // pinta el mapa geológico resultante
    symbols: true, // dibuja símbolos de rumbo y manteo
    visible: true,
    opacity: 0.55,
  }
}

/** Colores de las capas del modelo. */
export function modelColors(model) {
  const n = Math.max(1, model.layers | 0)
  const off = (model.palette | 0) * 3
  return Array.from({ length: n }, (_, i) => UNIT_COLORS[(i + off) % UNIT_COLORS.length])
}

// ---------------------------------------------------------------------------
// Perfil del tren de pliegues
// ---------------------------------------------------------------------------

/**
 * Amplitud del pliegue deducida del ángulo interlimbo y la longitud de onda.
 * El manteo máximo de los flancos de un pliegue simétrico es 90° − interlimbo/2.
 */
function foldAmplitude(model) {
  const limbDip = Math.max(0, Math.min(89.5, 90 - model.interlimb / 2))
  const slope = Math.tan(limbDip * RAD)
  const lambda = Math.max(1, model.wavelength)
  return model.shape === 'chevron' ? (lambda * slope) / 4 : (lambda * slope) / (2 * Math.PI)
}

/**
 * Perfil V(u) del pliegue: periódico, con una cresta en u = u0.
 * La asimetría deforma la fase, de modo que un flanco ocupa una fracción `f`
 * de la longitud de onda y el otro el resto (manteniendo la amplitud).
 */
function foldProfile(model) {
  const A = foldAmplitude(model)
  const lambda = Math.max(1, model.wavelength)
  const a = Math.max(0, Math.min(0.9, model.asymmetry || 0))
  const f = 0.5 * (1 - a)
  const chevron = model.shape === 'chevron'
  return (u, u0) => {
    let t = ((u - u0) / lambda + f) % 1
    if (t < 0) t += 1
    // Deformación de fase: [0,f) → [0,0.5) y [f,1) → [0.5,1)
    const s = t < f ? (0.5 * t) / f : 0.5 + (0.5 * (t - f)) / (1 - f)
    if (chevron) return s < 0.5 ? A * (4 * s - 1) : A * (3 - 4 * s)
    return -A * Math.cos(2 * Math.PI * s)
  }
}

/** Manteos reales de los dos flancos (difieren si el pliegue es asimétrico). */
export function foldLimbDips(model) {
  const A = foldAmplitude(model)
  const lambda = Math.max(1, model.wavelength)
  const a = Math.max(0, Math.min(0.9, model.asymmetry || 0))
  const f = 0.5 * (1 - a)
  const k = model.shape === 'chevron' ? 4 : 2 * Math.PI
  const short = Math.atan((A * k) / (lambda * 2 * f)) * DEG
  const long = Math.atan((A * k) / (lambda * 2 * (1 - f))) * DEG
  return { short, long, symmetric: a === 0 }
}

// ---------------------------------------------------------------------------
// Superficies
// ---------------------------------------------------------------------------

/**
 * Construye las funciones de elevación de un modelo.
 * Devuelve { surfaces, strat, ok }:
 *  - surfaces[k].elevationAt(x, y) → cota del contacto k (mundo, metros)
 *  - strat(x, y, z) → coordenada estratigráfica (distancia perpendicular a la
 *    superficie de referencia), que sirve para pintar el mapa geológico
 */
export function modelGeometry(model, scene) {
  const anchorWorld = worldAnchor(model, scene)
  if (!anchorWorld) return null
  const [x0, y0, z0] = anchorWorld
  const n = Math.max(1, model.layers | 0)
  const thickness = Math.max(1, model.thickness)

  if (model.kind === 'fold') {
    const tau = (model.trend || 0) * RAD
    const phi = Math.max(0, Math.min(85, model.plunge || 0)) * RAD
    const cosPhi = Math.cos(phi)
    const sinPhi = Math.sin(phi)
    const V = foldProfile(model)
    // Ejes del perfil: u atraviesa el eje del pliegue, w corre a lo largo de él.
    const uOf = (x, y) => x * Math.cos(tau) - y * Math.sin(tau)
    const wOf = (x, y) => x * Math.sin(tau) + y * Math.cos(tau)
    const u0 = uOf(x0, y0)
    // v es la coordenada "hacia arriba" dentro del plano de perfil.
    const vOf = (x, y, z) => sinPhi * wOf(x, y) + cosPhi * z
    const c0 = vOf(x0, y0, z0) - V(u0, u0)

    const elevationOf = (c) => (x, y) =>
      (V(uOf(x, y), u0) + c - sinPhi * wOf(x, y)) / cosPhi

    // Una superficie plegada aflora sólo si su desplazamiento cae dentro de
    // [0, 2·amplitud]: por encima está erosionada y por debajo, enterrada. La
    // pila se centra en esa ventana para que el nivel de erosión corte la mitad
    // de la serie y el mapa muestre la banda completa de capas.
    const offsets = stackOffsets(n, thickness, foldAmplitude(model))
    return {
      kind: 'fold',
      anchor: anchorWorld,
      thickness,
      offsets,
      surfaces: offsets.map((off, k) => ({
        index: k,
        offset: off,
        elevationAt: elevationOf(c0 + off),
      })),
      strat: (x, y, z) => vOf(x, y, z) - V(uOf(x, y), u0) - c0,
      layerIndexAt: (c) => layerIndexFor(c, n, thickness, foldAmplitude(model)),
    }
  }

  // Plano y layer cake: superficies planas paralelas.
  const dip = Math.max(0, Math.min(89.5, model.dip || 0))
  const dipDir = norm360((model.strike || 0) + 90)
  const k = Math.tan(dip * RAD)
  const sd = Math.sin(dipDir * RAD)
  const cd = Math.cos(dipDir * RAD)
  const cosDip = Math.cos(dip * RAD)
  const base = (x, y) => z0 - k * ((x - x0) * sd + (y - y0) * cd)
  // El plano único pasa exactamente por el punto marcado; la serie de capas se
  // centra en él.
  const offsets = model.kind === 'plane' ? [0] : stackOffsets(n, thickness)

  return {
    kind: model.kind,
    anchor: anchorWorld,
    thickness,
    offsets,
    surfaces: offsets.map((off, i) => ({
      index: i,
      offset: off,
      elevationAt: (x, y) => base(x, y) + off / cosDip,
    })),
    strat: (x, y, z) => (z - base(x, y)) * cosDip,
    layerIndexAt: (c) => layerIndexFor(c, n, thickness),
  }
}

/** Desplazamientos de los n+1 contactos de una serie centrada en el ancla. */
function stackOffsets(n, thickness, center = 0) {
  return Array.from({ length: n + 1 }, (_, k) => center + (k - n / 2) * thickness)
}

/** Índice de capa (0…n−1) para una coordenada estratigráfica, con repetición. */
function layerIndexFor(c, n, thickness, center = 0) {
  const i = Math.floor((c - center) / thickness + n / 2)
  return ((i % n) + n) % n
}

function worldAnchor(model, scene) {
  if (!model?.at || !scene) return null
  const [wx, wy] = toWorldPt(scene, model.at)
  const z = Number.isFinite(model.elevation) ? model.elevation : topoAt(scene, wx, wy)
  return [wx, wy, z]
}

function toWorldPt(scene, px) {
  const g = scene.georef
  const mpp = g?.metersPerPx || 1
  const nv = g?.northVec || [0, -1]
  const len = Math.hypot(nv[0], nv[1]) || 1
  const nrm = [nv[0] / len, nv[1] / len]
  const e = [-nrm[1], nrm[0]]
  return [mpp * (px[0] * e[0] + px[1] * e[1]), mpp * (px[0] * nrm[0] + px[1] * nrm[1])]
}

/** Elevación del terreno; si aún no hay curvas de nivel, terreno plano en 0. */
function topoAt(scene, x, y) {
  if (scene?.dem?.valid) return scene.dem.elevationAt(x, y)
  return 0
}

// ---------------------------------------------------------------------------
// Trazas en planta
// ---------------------------------------------------------------------------

/**
 * Traza de cada contacto: isolínea cero de (superficie − topografía),
 * devuelta en píxeles de imagen para dibujarla sobre el mapa.
 */
export function modelTraces(model, scene, resolution = 190) {
  const geo = modelGeometry(model, scene)
  if (!geo) return []
  const { bbox } = scene
  const w = bbox.maxX - bbox.minX
  const h = bbox.maxY - bbox.minY
  if (!(w > 0 && h > 0)) return []
  const nx = Math.max(24, Math.round(resolution * Math.min(1, w / Math.max(w, h))))
  const ny = Math.max(24, Math.round(resolution * Math.min(1, h / Math.max(w, h))))
  const colors = modelColors(model)

  const out = []
  for (const surf of geo.surfaces) {
    const f = (x, y) => surf.elevationAt(x, y) - topoAt(scene, x, y)
    let lines = []
    try {
      lines = contourLines(f, bbox, nx, ny, 0)
    } catch {
      lines = []
    }
    if (!lines.length) continue
    out.push({
      index: surf.index,
      // El contacto k separa la capa k−1 (abajo) de la capa k (arriba).
      color: colors[Math.min(colors.length - 1, Math.max(0, surf.index - 1))],
      upperColor: colors[Math.min(colors.length - 1, surf.index)],
      lines: lines.map((line) => line.map((p) => toImage(scene.georef, p))),
    })
  }
  return out
}

/**
 * Mapa geológico del modelo: para cada nodo de una grilla se calcula qué capa
 * aflora y se pinta de su color. Se devuelve un canvas en coordenadas de la
 * grilla del mundo, junto con los datos para situarlo sobre el mapa.
 */
export function modelRaster(model, scene, resolution = 260) {
  if (typeof document === 'undefined') return null
  const geo = modelGeometry(model, scene)
  if (!geo) return null
  const { bbox } = scene
  const w = bbox.maxX - bbox.minX
  const h = bbox.maxY - bbox.minY
  if (!(w > 0 && h > 0)) return null
  const cell = Math.max(w, h) / resolution
  const nx = Math.max(2, Math.ceil(w / cell) + 1)
  const ny = Math.max(2, Math.ceil(h / cell) + 1)

  const colors = modelColors(model).map(hexToRgb)
  const canvas = document.createElement('canvas')
  canvas.width = nx
  canvas.height = ny
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(nx, ny)

  for (let j = 0; j < ny; j++) {
    const y = bbox.minY + j * cell
    for (let i = 0; i < nx; i++) {
      const x = bbox.minX + i * cell
      const z = topoAt(scene, x, y)
      const c = geo.strat(x, y, z)
      // Un solo plano: se sombrea sólo el bloque bajo la superficie.
      const idx = model.kind === 'plane' ? (c < 0 ? 0 : -1) : geo.layerIndexAt(c)
      // La fila 0 del canvas corresponde al norte (Y máximo).
      const o = ((ny - 1 - j) * nx + i) * 4
      if (idx < 0) {
        img.data[o + 3] = 0
        continue
      }
      const col = colors[idx]
      img.data[o] = col[0]
      img.data[o + 1] = col[1]
      img.data[o + 2] = col[2]
      img.data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return { canvas, bbox, cell, nx, ny }
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return [148, 163, 184]
  const v = parseInt(m[1], 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

// ---------------------------------------------------------------------------
// Actitudes
// ---------------------------------------------------------------------------

/** Rumbo y manteo de la superficie del modelo en un punto (mundo). */
export function attitudeAt(geo, x, y, step = 25) {
  const surf = geo.surfaces[0]
  const zx = (surf.elevationAt(x + step, y) - surf.elevationAt(x - step, y)) / (2 * step)
  const zy = (surf.elevationAt(x, y + step) - surf.elevationAt(x, y - step)) / (2 * step)
  const grad = Math.hypot(zx, zy)
  const dip = Math.atan(grad) * DEG
  const dipDir = grad < 1e-9 ? 0 : azimuthWorld([-zx, -zy])
  return { dip, dipDir, ...formatAttitude(dipDir, dip) }
}

/** Malla de símbolos de rumbo y manteo repartidos por el mapa. */
export function modelSymbols(model, scene, cols = 6, rows = 5) {
  const geo = modelGeometry(model, scene)
  if (!geo) return []
  const { bbox } = scene
  const out = []
  const step = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) / 400
  for (let j = 1; j <= rows; j++) {
    for (let i = 1; i <= cols; i++) {
      const x = bbox.minX + ((bbox.maxX - bbox.minX) * i) / (cols + 1)
      const y = bbox.minY + ((bbox.maxY - bbox.minY) * j) / (rows + 1)
      const att = attitudeAt(geo, x, y, step)
      if (!Number.isFinite(att.dip)) continue
      out.push({ at: toImage(scene.georef, [x, y]), ...att })
    }
  }
  return out
}

/** Todo lo que el mapa necesita dibujar de un modelo. */
export function buildModelView(model, scene) {
  if (!model?.visible || !scene) return null
  const geo = modelGeometry(model, scene)
  if (!geo) return null
  return {
    id: model.id,
    model,
    geo,
    traces: modelTraces(model, scene),
    raster: model.fill ? modelRaster(model, scene) : null,
    symbols: model.symbols
      ? modelSymbols(model, scene, ...(model.kind === 'fold' ? [6, 5] : [3, 3]))
      : [],
    anchorAttitude: attitudeAt(geo, geo.anchor[0], geo.anchor[1]),
  }
}

export function buildModelViews(project, scene) {
  if (!scene?.ready || !project?.models?.length) return []
  const out = []
  for (const m of project.models) {
    try {
      const v = buildModelView(m, scene)
      if (v) out.push(v)
    } catch {
      // Un modelo con parámetros degenerados no debe romper el mapa completo.
    }
  }
  return out
}
