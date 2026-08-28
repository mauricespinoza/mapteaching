// Salto de falla: qué desplazamiento hace falta para explicar lo que se ve.
//
// Lo que un mapa mide directamente no es el salto sino la **separación**: cuánto
// se ha corrido en el mapa, o en la vertical, el mismo contacto a un lado y otro
// de la falla. La separación depende de la orientación del contacto, así que
// cada unidad da un número distinto y ninguno es «el salto». El salto neto —el
// vector que une dos puntos que antes estaban juntos— es uno solo para toda la
// falla, porque los bloques se mueven enteros.
//
// La construcción clásica: la intersección de cada contacto con el plano de
// falla es su **línea de corte** (cut-off line). Hay una en cada bloque, y el
// salto es el vector, contenido en el plano de falla, que lleva una sobre la
// otra. Una sola línea de corte no basta: se puede deslizar a lo largo de ella
// sin que nada cambie, así que sólo fija la componente perpendicular. Con dos
// líneas de corte de orientación distinta el vector queda determinado, y con más
// se resuelve por mínimos cuadrados.
//
// Todo lo que se publica aquí sale de las superficies que ya resuelve el motor;
// no hay ningún parámetro que ajustar a mano.

import { contourLines } from './marching.js'
import { fitLine } from './geom.js'
import { formatAttitude, norm360 } from './georef.js'

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/**
 * Base del plano de falla: el vector rumbo y el vector buzamiento abajo, los dos
 * unitarios y contenidos en el plano. Un punto del espacio se describe con
 * `(s, t)`: s a lo largo del rumbo, t plano abajo.
 */
function faultBasis(dip, dipDir) {
  const d = dip * RAD
  const f = dipDir * RAD
  // (x = este, y = norte, z = arriba)
  const strike = [-Math.cos(f), Math.sin(f), 0]
  const down = [Math.sin(f) * Math.cos(d), Math.cos(f) * Math.cos(d), -Math.sin(d)]
  return { strike, down }
}

/** Línea de corte de una superficie contra el plano de falla, en planta. */
function cutoffCurve(surfZ, faultZ, bbox, inArea, n = 150) {
  const f = (x, y) => {
    if (inArea && !inArea(x, y)) return NaN
    const a = surfZ(x, y)
    const b = faultZ(x, y)
    return Number.isFinite(a) && Number.isFinite(b) ? a - b : NaN
  }
  const lines = contourLines(f, bbox, n, n, 0)
  if (!lines.length) return null
  // Se queda la rama más larga: la superficie extrapolada puede volver a cortar
  // el plano lejos del área con datos, y ésa no es la línea de corte.
  let best = lines[0]
  for (const l of lines) if (l.length > best.length) best = l
  return best.length >= 2 ? best : null
}

/** Longitud de una polilínea. */
const runLength = (pts) => {
  let s = 0
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return s
}

/**
 * Salto de una falla, resuelto con todas las unidades que la cruzan.
 *
 * Devuelve, por contacto, su separación medida (la que sí se lee del mapa) y,
 * para la falla entera, el salto neto que mejor explica todas las líneas de
 * corte a la vez.
 */
export function faultSlip(scene, faultId, { inArea = null, samples = 150 } = {}) {
  const surf = scene.faultSurfaces.get(faultId)
  const fault = scene.project.faults.find((f) => f.id === faultId)
  if (!surf?.defined || !surf.mean) return null
  const { dip, dipDir } = surf.mean
  const { strike, down } = faultBasis(dip, dipDir)
  const bbox = scene.bbox
  const O = [(bbox.minX + bbox.maxX) / 2, (bbox.minY + bbox.maxY) / 2, surf.elevationAt((bbox.minX + bbox.maxX) / 2, (bbox.minY + bbox.maxY) / 2)]
  if (!Number.isFinite(O[2])) return null

  // Un punto de la línea de corte, llevado a coordenadas del plano de falla.
  const toPlane = (x, y) => {
    const z = surf.elevationAt(x, y)
    const v = [x - O[0], y - O[1], z - O[2]]
    return [
      v[0] * strike[0] + v[1] * strike[1] + v[2] * strike[2],
      v[0] * down[0] + v[1] * down[1] + v[2] * down[2],
    ]
  }

  // Bloques que esta falla separa, con el lado en que queda cada uno.
  const blocks = []
  for (const b of blockIdsOf(scene)) {
    const side = scene.blockSideOf(b, faultId)
    if (side) blocks.push({ block: b, side })
  }
  const up = blocks.find((b) => b.side > 0)
  const low = blocks.find((b) => b.side < 0)
  if (!up || !low) return null

  const rows = []
  const eqs = []
  for (let i = 0; i < scene.contacts.length; i++) {
    const c = scene.contacts[i]
    const byBlock = scene.contactSurfaces.get(c.id)
    const sUp = byBlock?.get(up.block)
    const sLow = byBlock?.get(low.block)
    const row = { contactId: c.id, name: c.name, color: c.color, both: Boolean(sUp?.defined && sLow?.defined) }
    if (!row.both) {
      rows.push(row)
      continue
    }
    const cUp = cutoffCurve((x, y) => sUp.elevationAt(x, y), (x, y) => surf.elevationAt(x, y), bbox, inArea, samples)
    const cLow = cutoffCurve((x, y) => sLow.elevationAt(x, y), (x, y) => surf.elevationAt(x, y), bbox, inArea, samples)
    if (!cUp || !cLow) {
      row.note = 'sin línea de corte dentro del área'
      rows.push(row)
      continue
    }
    const pUp = cUp.map(([x, y]) => toPlane(x, y))
    const pLow = cLow.map(([x, y]) => toPlane(x, y))
    const fUp = fitLine(pUp)
    const fLow = fitLine(pLow)
    if (!fUp || !fLow) {
      row.note = 'línea de corte demasiado corta'
      rows.push(row)
      continue
    }
    // Dirección común de las dos líneas de corte y su perpendicular en el plano.
    let dir = [fUp.dir[0] + fLow.dir[0] * Math.sign(fUp.dir[0] * fLow.dir[0] + fUp.dir[1] * fLow.dir[1] || 1), fUp.dir[1] + fLow.dir[1] * Math.sign(fUp.dir[0] * fLow.dir[0] + fUp.dir[1] * fLow.dir[1] || 1)]
    const dl = Math.hypot(dir[0], dir[1]) || 1
    dir = [dir[0] / dl, dir[1] / dl]
    const nrm = [-dir[1], dir[0]]
    // Separación perpendicular entre las dos líneas de corte, dentro del plano.
    const h = (fLow.c[0] - fUp.c[0]) * nrm[0] + (fLow.c[1] - fUp.c[1]) * nrm[1]
    // ¿Se parecen las dos líneas de corte? Si no, no hay una traslación rígida
    // que las relacione y el número no significa nada.
    const cosang = Math.abs(fUp.dir[0] * fLow.dir[0] + fUp.dir[1] * fLow.dir[1])
    row.cutoff = {
      h,
      nrm,
      dir,
      mismatch: Math.acos(Math.min(1, cosang)) * DEG,
      lengthUp: runLength(cUp),
      lengthLow: runLength(cLow),
    }
    // Separaciones que sí se leen del mapa, medidas en la vertical y en planta.
    const zUp = midElevation(sUp, cLow)
    const zLow = midElevation(sLow, cLow)
    if (Number.isFinite(zUp) && Number.isFinite(zLow)) row.verticalSeparation = zUp - zLow
    // Si la falla fuese de puro buzamiento, ¿qué salto haría falta para esta unidad?
    const dipComponent = nrm[1]
    row.dipSlipOnly = Math.abs(dipComponent) > 0.08 ? h / dipComponent : null
    rows.push(row)
    eqs.push({ nrm, h, name: c.name })
  }

  // Salto neto: el vector del plano que satisface todas las perpendiculares.
  const net = solveSlip(eqs)
  // Y cuánto se aparta cada unidad de ese salto único. Un desplazamiento rígido
  // tiene que explicar a todas a la vez; si una se sale, el número que da esa
  // unidad no es un salto sino un error de la superficie cerca de la falla.
  if (net) {
    for (const row of rows) {
      if (!row.cutoff) continue
      const pred = net.u[0] * row.cutoff.nrm[0] + net.u[1] * row.cutoff.nrm[1]
      row.residual = row.cutoff.h - pred
    }
  }
  const out = {
    faultId,
    name: fault?.name || 'Falla',
    kinematics: fault?.kinematics,
    dip,
    dipDir,
    attitude: formatAttitude(dipDir, dip),
    rows,
    used: eqs.length,
    net: null,
  }
  if (net) {
    const [us, ut] = net.u
    const magnitude = Math.hypot(us, ut)
    // Cabeceo medido desde el rumbo, dentro del plano.
    const rake = norm360(Math.atan2(-ut, us) * DEG)
    out.net = {
      strikeSlip: us,
      dipSlip: ut,
      magnitude,
      rake,
      throw: Math.abs(ut) * Math.sin(dip * RAD),
      heave: Math.abs(ut) * Math.cos(dip * RAD),
      determined: net.determined,
      conditioning: net.conditioning,
    }
  }
  return out
}

/** Cota media de una superficie a lo largo de una curva en planta. */
function midElevation(surf, curve) {
  let s = 0
  let n = 0
  for (const [x, y] of curve) {
    const v = surf.elevationAt(x, y)
    if (Number.isFinite(v)) {
      s += v
      n++
    }
  }
  return n ? s / n : NaN
}

function blockIdsOf(scene) {
  const ids = new Set()
  for (const byBlock of scene.contactSurfaces.values()) for (const b of byBlock.keys()) ids.add(b)
  return ids
}

/**
 * Resuelve el vector de salto `u` a partir de las ecuaciones `u · n̂ᵢ = hᵢ`, una
 * por línea de corte. Con una sola ecuación el sistema es indeterminado —el
 * salto puede deslizarse a lo largo de esa línea— y se devuelve la solución de
 * mínima norma, avisando de que no está determinada.
 */
function solveSlip(eqs) {
  if (!eqs.length) return null
  // Normales A y términos h: se resuelve AᵀA u = Aᵀh.
  let a11 = 0
  let a12 = 0
  let a22 = 0
  let b1 = 0
  let b2 = 0
  for (const e of eqs) {
    a11 += e.nrm[0] * e.nrm[0]
    a12 += e.nrm[0] * e.nrm[1]
    a22 += e.nrm[1] * e.nrm[1]
    b1 += e.nrm[0] * e.h
    b2 += e.nrm[1] * e.h
  }
  const det = a11 * a22 - a12 * a12
  const trace = a11 + a22
  // Número de condición del sistema: cerca de 0 quiere decir que todas las
  // líneas de corte son paralelas y no fijan más que una componente.
  const conditioning = trace > 0 ? det / ((trace / 2) * (trace / 2)) : 0
  if (conditioning > 0.02) {
    return { u: [(b1 * a22 - b2 * a12) / det, (b2 * a11 - b1 * a12) / det], determined: true, conditioning }
  }
  // Indeterminado: mínima norma en la dirección de la normal media.
  const n = eqs.length
  let nx = 0
  let ny = 0
  let h = 0
  for (const e of eqs) {
    const sgn = nx * e.nrm[0] + ny * e.nrm[1] < 0 ? -1 : 1
    nx += sgn * e.nrm[0]
    ny += sgn * e.nrm[1]
    h += sgn * e.h
  }
  const l = Math.hypot(nx, ny) || 1
  return { u: [(nx / l) * (h / n), (ny / l) * (h / n)], determined: false, conditioning }
}
