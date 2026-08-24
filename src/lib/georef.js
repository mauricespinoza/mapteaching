// Georreferenciación local: conversión entre píxeles de la imagen importada y
// coordenadas de terreno en metros (X = Este, Y = Norte), más el formateo de
// rumbos y manteos en las notaciones habituales en geología estructural.

import { norm, perp } from './geom.js'

export const DEFAULT_GEOREF = {
  metersPerPx: null, // se define calibrando la escala gráfica
  scaleLine: null, // { a:[x,y], b:[x,y], meters }
  northVec: [0, -1], // dirección del Norte en coordenadas de imagen (y hacia abajo)
  northLine: null, // { a:[x,y], b:[x,y] }
}

/** Base ortonormal { e: Este, n: Norte } en coordenadas de imagen. */
export function basis(georef) {
  const n = norm(georef?.northVec || [0, -1])
  const e = perp(n) // giro horario en pantalla == horario en el mapa (y hacia abajo)
  return { e, n }
}

/** Píxeles de imagen → metros de terreno [Este, Norte]. */
export function toWorld(georef, p) {
  const { e, n } = basis(georef)
  const mpp = georef?.metersPerPx || 1
  return [mpp * (p[0] * e[0] + p[1] * e[1]), mpp * (p[0] * n[0] + p[1] * n[1])]
}

/** Metros de terreno → píxeles de imagen. */
export function toImage(georef, w) {
  const { e, n } = basis(georef)
  const mpp = georef?.metersPerPx || 1
  const a = w[0] / mpp
  const b = w[1] / mpp
  return [a * e[0] + b * n[0], a * e[1] + b * n[1]]
}

export const toWorldList = (georef, pts) => pts.map((p) => toWorld(georef, p))
export const toImageList = (georef, pts) => pts.map((p) => toImage(georef, p))

/** Azimut (0–360°, horario desde el Norte) de un vector en coordenadas mundo. */
export function azimuthWorld(v) {
  let a = (Math.atan2(v[0], v[1]) * 180) / Math.PI
  if (a < 0) a += 360
  return a
}

/** Azimut de un vector expresado en píxeles de imagen. */
export function azimuthImage(georef, v) {
  const { e, n } = basis(georef)
  return azimuthWorld([v[0] * e[0] + v[1] * e[1], v[0] * n[0] + v[1] * n[1]])
}

export const norm360 = (a) => ((a % 360) + 360) % 360
export const norm180 = (a) => ((a % 180) + 180) % 180

/** Rumbo en notación de cuadrante: N45°E, N20°W, E–W… */
export function strikeQuadrant(azimuthDeg) {
  const a = norm180(azimuthDeg)
  if (Math.abs(a - 90) < 0.5) return 'E–W'
  if (a < 0.5 || a > 179.5) return 'N–S'
  if (a < 90) return `N${a.toFixed(0)}°E`
  return `N${(180 - a).toFixed(0)}°W`
}

const OCTANTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

/** Cuadrante aproximado de una dirección (para el sentido de manteo). */
export function octant(azimuthDeg) {
  const a = norm360(azimuthDeg)
  return OCTANTS[Math.round(a / 45) % 8]
}

/**
 * Convierte rumbo+manteo a notación dip-direction/dip (p. ej. 135/30) y a
 * cuadrante (N45°E, 30°SE), a partir del azimut de la dirección de manteo.
 */
export function formatAttitude(dipDirDeg, dipDeg) {
  const dd = norm360(dipDirDeg)
  const strikeAz = norm180(dd - 90) // regla de la mano derecha: rumbo = dipdir − 90
  return {
    dipDir: dd,
    dip: dipDeg,
    strikeAz,
    quadrant: `${strikeQuadrant(strikeAz)} / ${dipDeg.toFixed(0)}° ${octant(dd)}`,
    dipDirNotation: `${dd.toFixed(0).padStart(3, '0')}/${dipDeg.toFixed(0).padStart(2, '0')}`,
    rhr: `${norm360(dd - 90).toFixed(0).padStart(3, '0')}/${dipDeg.toFixed(0)}`,
  }
}

/** Formatea una distancia en metros con unidad legible. */
export function fmtDistance(m) {
  if (!Number.isFinite(m)) return '—'
  if (Math.abs(m) >= 2000) return `${(m / 1000).toFixed(2)} km`
  if (Math.abs(m) >= 10) return `${m.toFixed(0)} m`
  return `${m.toFixed(1)} m`
}

/** Texto corto de la escala equivalente (1:X) para un ancho de pantalla dado. */
export function scaleRatio(metersPerPx, cssPxPerScreenPx = 1) {
  if (!metersPerPx) return null
  // 96 CSS px ≈ 1 pulgada ≈ 0.0254 m
  const metersPerScreenMeter = (metersPerPx * cssPxPerScreenPx * 96) / 0.0254
  return Math.round(metersPerScreenMeter)
}
