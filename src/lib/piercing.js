// Puntos de perforación (piercing points) y salto real de una falla.
//
// El mapa mide **separación**, no salto. La separación de un contacto depende
// de su orientación, así que cada unidad da un número distinto y ninguno es el
// salto. Peor aún: la línea de corte de un contacto contra la falla sólo fija
// la componente perpendicular a ella, porque el bloque puede deslizarse a lo
// largo de esa línea sin que el mapa cambie. Con una serie concordante —todas
// las líneas de corte paralelas— el salto queda indeterminado por mucho que se
// midan diez contactos.
//
// Un **punto de perforación** rompe esa indeterminación de un golpe. Un rasgo
// *lineal* (la charnela de un pliegue, la intersección de un dique con un
// contacto, el eje de un paleocanal) corta el plano de falla en un punto y no
// en una línea. Con el mismo rasgo reconocido a los dos lados hay dos puntos, y
// el vector que los une **es** el salto neto: magnitud, dirección e inmersión,
// sin ajuste ni hipótesis. Es la construcción de Allmendinger (GMDE §6.5.2).
//
// Y al revés: con el salto ya conocido, una superficie medida en un bloque se
// traslada al otro y dice dónde está un contacto que allí no aflora —el caso
// del contacto enterrado, del que no hay datos porque no corta la topografía—.

import { contourLines } from './marching.js'
import { formatAttitude, norm360, toWorld } from './georef.js'

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/**
 * Vector unitario de una recta dada por su dirección de inmersión y su
 * inmersión, en el marco del terreno (x este, y norte, z arriba). Una
 * inmersión positiva apunta hacia abajo.
 */
export function lineVector(trend, plunge) {
  const t = trend * RAD
  const p = plunge * RAD
  return [Math.sin(t) * Math.cos(p), Math.cos(t) * Math.cos(p), -Math.sin(p)]
}

/** Dirección e inmersión de un vector, con la inmersión positiva hacia abajo. */
export function vectorToLine(v) {
  const h = Math.hypot(v[0], v[1])
  const trend = norm360(Math.atan2(v[0], v[1]) * DEG)
  const plunge = Math.atan2(-v[2], h) * DEG
  return { trend, plunge }
}

/**
 * Base del plano de falla en un punto: rumbo y línea de máxima pendiente, las
 * dos unitarias y contenidas en el plano. Sirve para expresar el salto como
 * componentes de rumbo y de buzamiento, que es como se nombra en el campo.
 */
export function faultBasis(dip, dipDir) {
  const d = dip * RAD
  const f = dipDir * RAD
  return {
    strike: [-Math.cos(f), Math.sin(f), 0],
    down: [Math.sin(f) * Math.cos(d), Math.cos(f) * Math.cos(d), -Math.sin(d)],
  }
}

/**
 * Dónde una recta perfora la superficie de falla.
 *
 * Se recorre la recta desde su punto conocido buscando el cambio de signo de
 * (cota de la recta − cota de la falla) y se afina por bisección. Se usa la
 * superficie de falla que resuelve el motor, no un plano medio: es la misma con
 * la que se cortan las unidades, así que el punto cae donde de verdad está la
 * falla aunque sea lístrica.
 *
 * El punto puede quedar por encima o por debajo del terreno, y fuera del área
 * de trabajo: eso no lo invalida —un punto de perforación es una construcción,
 * no un afloramiento—, pero conviene saberlo, así que se informa de la
 * distancia recorrida y de si acabó fuera del marco.
 */
export function piercePoint(P0, u, fault, { reach, step = null, inArea = null } = {}) {
  if (!fault?.defined) return null
  const h = step || Math.max(reach / 400, 1e-3)
  const g = (s) => {
    const x = P0[0] + u[0] * s
    const y = P0[1] + u[1] * s
    const z = P0[2] + u[2] * s
    const zf = fault.elevationAt(x, y)
    return Number.isFinite(zf) ? z - zf : NaN
  }
  const at = (s) => [P0[0] + u[0] * s, P0[1] + u[1] * s, P0[2] + u[2] * s]

  // Afina por bisección un intervalo en el que la diferencia cambia de signo.
  const refine = (a, b, ga) => {
    let lo = a
    let hi = b
    let glo = ga
    for (let k = 0; k < 60; k++) {
      const m = (lo + hi) / 2
      const gm = g(m)
      if (!Number.isFinite(gm)) break
      if (Math.sign(gm) === Math.sign(glo)) {
        lo = m
        glo = gm
      } else hi = m
    }
    return (lo + hi) / 2
  }

  const g0 = g(0)
  if (Number.isFinite(g0) && g0 === 0) {
    return { point: at(0), distance: 0, outside: Boolean(inArea && !inArea(P0[0], P0[1])) }
  }

  // Cada sentido se recorre por su cuenta —mezclarlos rompería el seguimiento
  // del cambio de signo— y se conserva el corte más cercano al dato: una
  // superficie extrapolada puede volver a cruzar la recta muy lejos, y ése ya
  // no es el punto de perforación de este rasgo.
  let best = null
  for (const sgn of [1, -1]) {
    let prevS = 0
    let prevG = g0
    for (let i = 1; i <= 400; i++) {
      const s = sgn * i * h
      const v = g(s)
      if (!Number.isFinite(v)) {
        prevG = NaN
        prevS = s
        continue
      }
      if (Number.isFinite(prevG) && prevG !== 0 && Math.sign(v) !== Math.sign(prevG)) {
        const s0 = refine(prevS, s, prevG)
        if (!best || Math.abs(s0) < Math.abs(best)) best = s0
        break
      }
      prevS = s
      prevG = v
    }
  }
  if (best == null) return null
  const P = at(best)
  return { point: P, distance: Math.abs(best), outside: Boolean(inArea && !inArea(P[0], P[1])) }
}

/**
 * Salto neto a partir de un par de puntos de perforación.
 *
 * `pair` describe el mismo rasgo lineal a los dos lados de la falla: un punto
 * sobre él en el mapa y su dirección/inmersión. La orientación puede diferir
 * entre bloques si la falla los rotó, así que cada lado lleva la suya.
 */
export function piercingSlip(scene, pair, { inArea = null } = {}) {
  const fault = scene.faultSurfaces.get(pair.faultId)
  if (!fault?.defined || !fault.mean) return null
  const reach = scene.side * 2
  const sides = []
  for (const key of ['a', 'b']) {
    const s = pair[key]
    if (!s || !Number.isFinite(s.trend) || !Number.isFinite(s.plunge)) return null
    // `at` viene en píxeles de imagen, que es como se marca sobre el mapa; el
    // cálculo entero va en metros de terreno.
    const w = scene.georef ? toWorld(scene.georef, s.at) : s.at
    const z = Number.isFinite(s.z) ? s.z : scene.dem.elevationAt(w[0], w[1])
    if (!Number.isFinite(z)) return null
    const P0 = [w[0], w[1], z]
    const hit = piercePoint(P0, lineVector(s.trend, s.plunge), fault, { reach, inArea })
    if (!hit) return null
    sides.push({ key, from: P0, ...hit, trend: s.trend, plunge: s.plunge })
  }
  const [A, B] = sides
  // Del bloque A al bloque B: el salto es el vector que lleva el punto de A
  // sobre su homólogo de B.
  const v = [B.point[0] - A.point[0], B.point[1] - A.point[1], B.point[2] - A.point[2]]
  const magnitude = Math.hypot(v[0], v[1], v[2])
  const { trend, plunge } = vectorToLine(v)
  const { dip, dipDir } = fault.mean
  const { strike, down } = faultBasis(dip, dipDir)
  const strikeSlip = v[0] * strike[0] + v[1] * strike[1] + v[2] * strike[2]
  const dipSlip = v[0] * down[0] + v[1] * down[1] + v[2] * down[2]
  // Cuánto se sale el salto del plano de falla. Debería ser cero: si no lo es,
  // los dos rasgos no son homólogos o alguna orientación está mal medida.
  const normal = [
    strike[1] * down[2] - strike[2] * down[1],
    strike[2] * down[0] - strike[0] * down[2],
    strike[0] * down[1] - strike[1] * down[0],
  ]
  const offPlane = v[0] * normal[0] + v[1] * normal[1] + v[2] * normal[2]
  return {
    a: A,
    b: B,
    vector: v,
    magnitude,
    trend,
    plunge,
    strikeSlip,
    dipSlip,
    rake: norm360(Math.atan2(-dipSlip, strikeSlip) * DEG),
    throw: Math.abs(v[2]),
    heave: Math.hypot(v[0], v[1]),
    offPlane,
    fault: { dip, dipDir, ...formatAttitude(dipDir, dip) },
  }
}

/**
 * Una superficie trasladada por el vector de salto.
 *
 * Es la hipótesis de bloque rígido: si la falla movió el bloque entero, la
 * superficie que se midió a un lado estaba antes donde dice el otro. Trasladarla
 * predice dónde está un contacto que en ese bloque no aflora —porque quedó
 * enterrado o erosionado— y del que, por tanto, no hay contornos estructurales.
 *
 * `sign` es +1 para llevar del bloque A al B y −1 para el camino contrario.
 */
export function translatedSurface(surf, vector, sign = 1) {
  const dx = vector[0] * sign
  const dy = vector[1] * sign
  const dz = vector[2] * sign
  return {
    elevationAt: (x, y) => {
      const z = surf.elevationAt(x - dx, y - dy)
      return Number.isFinite(z) ? z + dz : NaN
    },
  }
}

/**
 * Traza que tendría en el mapa una superficie trasladada: su corte con la
 * topografía, recortado al bloque de destino. Es la línea que habría que
 * dibujar si el contacto aflorara, y la que dice dónde buscarlo.
 */
export function projectedTrace(scene, surf, vector, sign, block, { inArea = null, resolution = 200 } = {}) {
  const moved = translatedSurface(surf, vector, sign)
  const bbox = scene.bbox
  const f = (x, y) => {
    if (inArea && !inArea(x, y)) return NaN
    if (block != null && scene.blocks.blockAt(x, y) !== block) return NaN
    const z = moved.elevationAt(x, y)
    const t = scene.dem.elevationAt(x, y)
    return Number.isFinite(z) && Number.isFinite(t) ? z - t : NaN
  }
  let lines = []
  try {
    lines = contourLines(f, bbox, resolution, resolution, 0)
  } catch {
    lines = []
  }
  return lines.filter((l) => l.length >= 2)
}

/**
 * A qué profundidad queda una superficie trasladada dentro de un bloque, cuando
 * no llega a cortar la topografía. Positivo hacia abajo: es lo que habría que
 * perforar para encontrarla, y por dónde conviene hacerlo.
 */
export function burialDepth(scene, surf, vector, sign, block, inArea = null, n = 60) {
  const moved = translatedSurface(surf, vector, sign)
  const bbox = scene.bbox
  let min = Infinity
  let sum = 0
  let count = 0
  let best = null
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = bbox.minX + (i / n) * (bbox.maxX - bbox.minX)
      const y = bbox.minY + (j / n) * (bbox.maxY - bbox.minY)
      if (inArea && !inArea(x, y)) continue
      if (block != null && scene.blocks.blockAt(x, y) !== block) continue
      const z = moved.elevationAt(x, y)
      const t = scene.dem.elevationAt(x, y)
      if (!Number.isFinite(z) || !Number.isFinite(t)) continue
      const d = t - z // >0: por debajo del terreno
      sum += d
      count++
      if (d < min) {
        min = d
        best = [x, y]
      }
    }
  }
  if (!count) return null
  return { mean: sum / count, min, at: best, above: min < 0 }
}

/**
 * Todo lo que hay que dibujar en el mapa a partir de los pares resueltos: para
 * cada falla con salto conocido, la traza que tendría cada contacto que sólo se
 * midió a un lado, llevado al otro.
 *
 * Es la respuesta a «este contacto está enterrado, ¿por dónde pasa?»: si el
 * bloque se movió entero, el contacto de enfrente está donde dice el salto.
 */
export function buildProjections(scene, project, { inArea = null, resolution = 190 } = {}) {
  if (!scene?.ready) return []
  const out = []
  for (const pair of project.piercings || []) {
    if (!pair.faultId || !pair.b) continue
    const slip = piercingSlip(scene, pair, { inArea })
    if (!slip) continue
    const { up, low, rows } = projectableContacts(scene, pair.faultId)
    if (up == null) continue
    // El salto va del punto A al B. Qué bloque es cuál lo dice dónde se observó
    // el rasgo —el punto marcado en el mapa—, no el punto ya perforado: ése
    // cae sobre la falla, que es justo la frontera entre los dos bloques.
    const blockA = scene.blocks.blockAt(slip.a.from[0], slip.a.from[1])
    for (const r of rows) {
      // Llevar del bloque medido al bloque sin datos: en el sentido del salto
      // si el medido es A, y al revés si es B.
      const sign = r.fromBlock === blockA ? 1 : -1
      const lines = projectedTrace(scene, r.surf, slip.vector, sign, r.toBlock, { inArea, resolution })
      out.push({
        pairId: pair.id,
        faultId: pair.faultId,
        contactId: r.contactId,
        name: r.name,
        color: r.color,
        fromBlock: r.fromBlock,
        toBlock: r.toBlock,
        lines,
        // Si no aflora, lo que interesa es a qué profundidad quedó: es el caso
        // que motiva todo esto —el contacto enterrado del que no hay dato—.
        depth: lines.length ? null : burialDepth(scene, r.surf, slip.vector, sign, r.toBlock, inArea),
      })
    }
  }
  return out
}

/**
 * Qué contactos se pueden predecir en el otro bloque: los que están resueltos a
 * un lado de la falla y no al otro. Son exactamente los que el ejercicio no
 * puede resolver por sí solo, y para los que sirve el salto.
 */
export function projectableContacts(scene, faultId) {
  const blocks = []
  const all = new Set()
  for (const byBlock of scene.contactSurfaces.values()) for (const b of byBlock.keys()) all.add(b)
  for (const b of all) {
    const side = scene.blockSideOf(b, faultId)
    if (side) blocks.push({ block: b, side })
  }
  const up = blocks.find((b) => b.side > 0)
  const low = blocks.find((b) => b.side < 0)
  if (!up || !low) return { up: null, low: null, rows: [] }
  const rows = []
  for (const c of scene.contacts) {
    const byBlock = scene.contactSurfaces.get(c.id)
    const sUp = byBlock?.get(up.block)
    const sLow = byBlock?.get(low.block)
    const hasUp = Boolean(sUp?.defined)
    const hasLow = Boolean(sLow?.defined)
    if (hasUp === hasLow) continue // o está en los dos, o en ninguno
    rows.push({
      contactId: c.id,
      name: c.name,
      color: c.color,
      // De dónde sale y a dónde va.
      fromBlock: hasUp ? up.block : low.block,
      toBlock: hasUp ? low.block : up.block,
      // El salto va del bloque A al B; para el camino inverso hay que cambiarle
      // el signo, y quién es A depende de en qué bloque cayó cada punto.
      surf: hasUp ? sUp : sLow,
    })
  }
  return { up: up.block, low: low.block, rows }
}
