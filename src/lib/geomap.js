// Mapa geológico en planta: qué unidad aflora en cada punto.
//
// El relleno lo delimitan las trazas, no el modelo. Antes se decidía la unidad
// nodo a nodo comparando la topografía con la superficie de cada contacto, y el
// borde entre dos colores caía donde el modelo dijera —a decenas de metros de la
// traza dibujada, porque una superficie ajustada pasa por sus datos pero entre
// ellos hace lo que puede—. En el mapa el contacto *es* la línea que se
// digitalizó, así que ahora manda ella:
//
//  1. las trazas de contactos y fallas se rasterizan como muros,
//  2. se etiquetan las regiones que dejan entre sí (inundación por lados),
//  3. cada región recibe **una sola** unidad, la que más veces gana al comparar
//     la topografía con la pila estratigráfica dentro de ella.
//
// Así el color sólo puede cambiar sobre una traza, que es lo que se ve en un
// mapa geológico, y una unidad que topa con una falla se detiene en la falla.
// El modelo sigue mandando en *qué* unidad es cada región —que es lo que no se
// puede leer del mapa sin resolver la estructura—, pero ya no en dónde acaba.

import { modelExtent, frameTest } from './models.js'

/**
 * Unidad que aflora en un punto, dadas las cotas de los contactos allí.
 * Los contactos llegan en orden estratigráfico (de base a techo).
 */
export function outcroppingUnit(contacts, elevations, z, units) {
  let unitId = null
  let seen = false
  for (let i = 0; i < contacts.length; i++) {
    const e = elevations[i]
    if (e == null) continue
    if (!seen) {
      // Por debajo del contacto más bajo definido queda la unidad inferior.
      unitId = contacts[i].lowerUnitId
      seen = true
    }
    if (z >= e) unitId = contacts[i].upperUnitId
  }
  if (!seen) return units.length ? units[units.length - 1] : null
  return units.find((u) => u.id === unitId) || null
}

/**
 * Rasteriza todas las trazas del mapa —contactos y fallas— como muros de la
 * grilla. Son los bordes que ningún color puede cruzar.
 */
function rasterizeTraces(scene, bbox, nx, ny, cell) {
  const wall = new Uint8Array(nx * ny)
  const stamp = (x, y) => {
    const i = Math.round((x - bbox.minX) / cell)
    const j = Math.round((y - bbox.minY) / cell)
    if (i < 0 || j < 0 || i >= nx || j >= ny) return
    wall[j * nx + i] = 1
  }
  const line = (pts) => {
    if (!pts || pts.length < 2) return
    stamp(pts[0][0], pts[0][1])
    for (let m = 1; m < pts.length; m++) {
      const a = pts[m - 1]
      const b = pts[m]
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (cell * 0.5)))
      for (let s = 1; s <= steps; s++) {
        const t = s / steps
        stamp(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
      }
    }
  }
  for (const cw of scene.contactWorld) for (const tr of cw.traces) line(tr)
  for (const fw of scene.faultWorld) for (const tr of fw.traces) line(tr)
  return wall
}

/** Regiones que las trazas dejan entre sí (inundación por lados, no por esquinas). */
function labelRegions(wall, nx, ny) {
  const region = new Int32Array(nx * ny).fill(-1)
  const stack = new Int32Array(nx * ny)
  let count = 0
  for (let start = 0; start < region.length; start++) {
    if (wall[start] || region[start] >= 0) continue
    const id = count++
    let top = 0
    stack[top++] = start
    region[start] = id
    while (top > 0) {
      const k = stack[--top]
      const i = k % nx
      const j = (k - i) / nx
      if (i > 0 && !wall[k - 1] && region[k - 1] < 0) ((region[k - 1] = id), (stack[top++] = k - 1))
      if (i < nx - 1 && !wall[k + 1] && region[k + 1] < 0) ((region[k + 1] = id), (stack[top++] = k + 1))
      if (j > 0 && !wall[k - nx] && region[k - nx] < 0) ((region[k - nx] = id), (stack[top++] = k - nx))
      if (j < ny - 1 && !wall[k + nx] && region[k + nx] < 0) ((region[k + nx] = id), (stack[top++] = k + nx))
    }
  }
  return { region, count }
}

/**
 * Raster con el color de la unidad que aflora en cada nodo. Se devuelve en el
 * mismo formato que el raster de los modelos, para dibujarlo con el mismo
 * transformador de coordenadas.
 */
export function buildUnitRaster(scene, resolution = 190) {
  if (typeof document === 'undefined') return null
  if (!scene?.ready || !scene.contacts.length || !scene.units.length) return null
  if (!scene.dem?.valid) return null

  const bbox = modelExtent(scene)
  const w = bbox.maxX - bbox.minX
  const h = bbox.maxY - bbox.minY
  if (!(w > 0 && h > 0)) return null
  const cell = Math.max(w, h) / resolution
  const nx = Math.max(2, Math.ceil(w / cell) + 1)
  const ny = Math.max(2, Math.ceil(h / cell) + 1)

  const contacts = scene.contacts
  const units = scene.units
  const colors = new Map(units.map((u) => [u.id, hexToRgb(u.color)]))
  const inFrame = frameTest(scene)

  const wall = rasterizeTraces(scene, bbox, nx, ny, cell)
  // Lo que queda fuera del área de trabajo también es muro: si no, dos zonas
  // separadas por una traza se reencuentran rodeando por fuera del marco y
  // acaban siendo la misma región.
  if (inFrame) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (!inFrame(bbox.minX + i * cell, bbox.minY + j * cell)) wall[j * nx + i] = 1
      }
    }
  }
  const { region, count } = labelRegions(wall, nx, ny)

  // Voto de unidad por región: cada nodo dice qué unidad aflora en él según la
  // pila estratigráfica, y la región entera se queda con la más votada.
  const votes = new Map()
  const unitIndex = new Map(units.map((u, i) => [u.id, i]))
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const r = region[j * nx + i]
      if (r < 0) continue
      const x = bbox.minX + i * cell
      const y = bbox.minY + j * cell
      if (inFrame && !inFrame(x, y)) continue
      const z = scene.dem.elevationAt(x, y)
      const stack = scene.stackAt(x, y).z
      if (!stack.some((v) => v != null)) continue
      const unit = outcroppingUnit(contacts, stack, z, units)
      if (!unit) continue
      const ui = unitIndex.get(unit.id)
      let tally = votes.get(r)
      if (!tally) votes.set(r, (tally = new Int32Array(units.length)))
      tally[ui]++
    }
  }

  const unitOfRegion = new Int16Array(count).fill(-1)
  for (const [r, tally] of votes) {
    let best = -1
    let bestN = 0
    for (let u = 0; u < tally.length; u++) if (tally[u] > bestN) ((bestN = tally[u]), (best = u))
    unitOfRegion[r] = best
  }

  const canvas = document.createElement('canvas')
  canvas.width = nx
  canvas.height = ny
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(nx, ny)

  const paint = (ui, o) => {
    const col = ui >= 0 ? colors.get(units[ui].id) : null
    if (!col) {
      img.data[o + 3] = 0
      return
    }
    img.data[o] = col[0]
    img.data[o + 1] = col[1]
    img.data[o + 2] = col[2]
    img.data[o + 3] = 255
  }

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      // La fila 0 del canvas corresponde al norte (Y máximo).
      const o = ((ny - 1 - j) * nx + i) * 4
      const x = bbox.minX + i * cell
      const y = bbox.minY + j * cell
      if (inFrame && !inFrame(x, y)) {
        img.data[o + 3] = 0
        continue
      }
      const r = region[k]
      if (r >= 0) {
        paint(unitOfRegion[r], o)
        continue
      }
      // Celda de traza: toma el color de la región vecina más presente, para
      // que la línea no deje un hueco entre dos polígonos.
      let ui = -1
      for (let dj = -1; dj <= 1 && ui < 0; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di
          const jj = j + dj
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue
          const rr = region[jj * nx + ii]
          if (rr >= 0 && unitOfRegion[rr] >= 0) {
            ui = unitOfRegion[rr]
            break
          }
        }
      }
      paint(ui, o)
    }
  }
  ctx.putImageData(img, 0, 0)
  return { canvas, bbox, cell, nx, ny }
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return null
  const v = parseInt(m[1], 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
