// Mapa geológico en planta: qué unidad aflora en cada punto.
//
// Una unidad aflora donde la topografía queda por encima de su contacto basal y
// por debajo del contacto que la limita por arriba. Recorriendo una grilla y
// evaluando las superficies de cada contacto en el bloque que corresponde, se
// obtiene el relleno de los polígonos definidos por contactos sucesivos.

import { modelExtent } from './models.js'

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
 * Raster con el color de la unidad que aflora en cada nodo. Se devuelve en el
 * mismo formato que el raster de los modelos, para dibujarlo con el mismo
 * transformador de coordenadas.
 */
export function buildUnitRaster(scene, resolution = 170) {
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
  const elevations = new Array(contacts.length)

  const canvas = document.createElement('canvas')
  canvas.width = nx
  canvas.height = ny
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(nx, ny)

  for (let j = 0; j < ny; j++) {
    const y = bbox.minY + j * cell
    for (let i = 0; i < nx; i++) {
      const x = bbox.minX + i * cell
      const z = scene.dem.elevationAt(x, y)
      let any = false
      for (let c = 0; c < contacts.length; c++) {
        const surf = scene.contactSurfaceAt(contacts[c].id, x, y)
        if (!surf || !surf.defined) {
          elevations[c] = null
          continue
        }
        const e = surf.elevationAt(x, y)
        elevations[c] = Number.isFinite(e) ? e : null
        if (elevations[c] != null) any = true
      }
      // La fila 0 del canvas corresponde al norte (Y máximo).
      const o = ((ny - 1 - j) * nx + i) * 4
      if (!any) {
        img.data[o + 3] = 0
        continue
      }
      const unit = outcroppingUnit(contacts, elevations, z, units)
      const col = unit ? colors.get(unit.id) : null
      if (!col) {
        img.data[o + 3] = 0
        continue
      }
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
  if (!m) return null
  const v = parseInt(m[1], 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
