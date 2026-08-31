// Ejes de pliegues (antiformes y sinformes), a partir de los dominios
// estructurales que ya resuelve cada superficie de contacto.
//
// Un pliegue cilíndrico está hecho de limbos planos que se encuentran en una
// charnela. Los dominios de `domains.js` ya son justamente eso: tramos de una
// superficie con manteo aproximadamente constante. Dos dominios vecinos con
// manteos distintos definen una charnela, y esa charnela es la recta donde
// coinciden sus dos planos — no hace falta ajustar nada más: el eje del
// pliegue sale de la propia geometría de los contornos estructurales.
//
// Cuando varios contactos concordantes se pliegan juntos (un «paquete» de
// capas), cada uno aporta su propio par de dominios y su propia charnela,
// casi coincidentes entre sí. Agruparlas en un único eje por paquete es el
// segundo paso: los candidatos con la misma orientación y la misma posición
// en el mapa se funden en uno solo, que hereda el alcance de todos ellos.

import { medianStep } from './domains.js'
import { vectorToLine } from './piercing.js'
import { toImage } from './georef.js'

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

// Diferencia mínima de manteo entre dos dominios para admitir que hay una
// charnela real entre ellos, y no dos trozos del mismo limbo separados por el
// RANSAC de `structuralDomains` por casualidad.
const MIN_HINGE_ANGLE = 8
// La charnela calculada tiene que caer cerca de datos reales de los dos
// limbos, en unidades de la separación típica entre contornos estructurales.
const REACH_FACTOR = 6
// Dos candidatos de charnela se funden en un mismo eje si sus direcciones no
// difieren más que esto…
const MERGE_ANGLE = 20
// …y si además la charnela de uno pasa cerca de la recta del otro, en el
// mismo tipo de unidades que REACH_FACTOR.
const MERGE_REACH = 10

function centroid(pts) {
  let x = 0
  let y = 0
  let z = 0
  for (const p of pts) {
    x += p[0]
    y += p[1]
    z += p[2]
  }
  const n = pts.length || 1
  return [x / n, y / n, z / n]
}

/** Ángulo entre las normales de dos planos: cuánto difiere el manteo real. */
function planeAngle(p, q) {
  const n1 = [p.a, p.b, -1]
  const n2 = [q.a, q.b, -1]
  const l1 = Math.hypot(...n1)
  const l2 = Math.hypot(...n2)
  const dot = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]
  return Math.acos(Math.min(1, Math.max(-1, dot / (l1 * l2)))) * DEG
}

/**
 * Candidato de charnela entre dos dominios (limbos) de una misma superficie.
 * Devuelve null si no hay manteo suficientemente distinto entre ellos, o si
 * la charnela que sale de sus planos cae lejos de los datos de alguno: eso
 * pasa cuando dos limbos de ondas distintas del mismo tren comparten manteo
 * por coincidencia, sin ser en realidad los dos flancos de una charnela.
 */
function hingeBetween(planeA, planeB, groupA, groupB) {
  if (planeAngle(planeA, planeB) < MIN_HINGE_ANGLE) return null

  // Recta, en planta, donde coinciden los dos planos: A·x + B·y + C = 0.
  const A = planeA.a - planeB.a
  const B = planeA.b - planeB.b
  const C = planeA.c - planeB.c
  const g = Math.hypot(A, B)
  if (g < 1e-9) return null

  // Dirección 3D de la charnela: en planta es perpendicular al gradiente de
  // esa recta; la pendiente a lo largo de ella es la misma para los dos
  // planos, porque es justo donde acuerdan.
  const ddx = -B / g
  const ddy = A / g
  const ddz = planeA.a * ddx + planeA.b * ddy
  const dlen = Math.hypot(ddx, ddy, ddz) || 1
  const dir = [ddx / dlen, ddy / dlen, ddz / dlen]

  const cA = centroid(groupA)
  const cB = centroid(groupB)
  const mx = (cA[0] + cB[0]) / 2
  const my = (cA[1] + cB[1]) / 2
  // Pie de la perpendicular desde el punto medio de los centroides hasta la
  // recta de charnela: la posición exacta de la charnela junto a los datos.
  const t = -(A * mx + B * my + C) / (g * g)
  const x0 = mx + A * t
  const y0 = my + B * t
  const z0 = planeA.a * x0 + planeA.b * y0 + planeA.c

  const spacing = Math.max(medianStep([...groupA, ...groupB]), 1e-6)
  const reach = spacing * REACH_FACTOR
  const nearest = (pt, group) => {
    let best = Infinity
    for (const p of group) {
      const d = Math.hypot(p[0] - pt[0], p[1] - pt[1])
      if (d < best) best = d
    }
    return best
  }
  if (nearest([x0, y0], groupA) > reach || nearest([x0, y0], groupB) > reach) return null

  // Clasificación geométrica: si los dos limbos mantean alejándose de la
  // charnela (como una carpa) es un antiforme; si mantean hacia ella (como un
  // valle) es un sinforme. Se compara la dirección de buzamiento de cada
  // limbo con la dirección «hacia fuera» de la charnela que le corresponde.
  const g1 = Math.hypot(planeA.a, planeA.b)
  const g2 = Math.hypot(planeB.a, planeB.b)
  const downA = g1 > 1e-9 ? [-planeA.a / g1, -planeA.b / g1] : [0, 0]
  const downB = g2 > 1e-9 ? [-planeB.a / g2, -planeB.b / g2] : [0, 0]
  const v = [cA[0] - cB[0], cA[1] - cB[1]]
  const vlen = Math.hypot(...v) || 1
  const vn = [v[0] / vlen, v[1] / vlen]
  const score = (downA[0] - downB[0]) * vn[0] + (downA[1] - downB[1]) * vn[1]
  if (Math.abs(score) < 1e-6) return null // limbos casi horizontales: sin criterio claro

  return {
    type: score > 0 ? 'antiform' : 'synform',
    dir,
    at: [x0, y0, z0],
    points: [...groupA, ...groupB],
    support: groupA.length + groupB.length,
  }
}

function pointLineDistance(p, p0, dir) {
  const w = [p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]]
  const t = w[0] * dir[0] + w[1] * dir[1] + w[2] * dir[2]
  const dx = p[0] - (p0[0] + dir[0] * t)
  const dy = p[1] - (p0[1] + dir[1] * t)
  const dz = p[2] - (p0[2] + dir[2] * t)
  return Math.hypot(dx, dy, dz)
}

/**
 * Funde en un único eje los candidatos de charnela del mismo tipo cuya
 * orientación y posición coinciden: es el paquete de capas concordantes que
 * se pliega junto. Un eje real y su opuesto (recta, no vector) tienen la
 * misma orientación, así que la comparación de ángulo usa el valor absoluto
 * del producto punto.
 */
function clusterAxes(raw) {
  const sorted = [...raw].sort((a, b) => b.support - a.support)
  const clusters = []
  for (const cand of sorted) {
    let target = null
    for (const cl of clusters) {
      if (cl.type !== cand.type) continue
      const cosA = Math.abs(cl.dir[0] * cand.dir[0] + cl.dir[1] * cand.dir[1] + cl.dir[2] * cand.dir[2])
      if (Math.acos(Math.min(1, cosA)) * DEG > MERGE_ANGLE) continue
      if (pointLineDistance(cand.at, cl.at, cl.dir) > cl.reach) continue
      target = cl
      break
    }
    if (target) target.members.push(cand)
    else {
      const spacing = Math.max(medianStep(cand.points), 1e-6)
      clusters.push({ type: cand.type, dir: cand.dir, at: cand.at, members: [cand], reach: spacing * MERGE_REACH })
    }
  }
  return clusters
}

/**
 * Un eje consolidado a partir de su grupo de candidatos: dirección promedio
 * (ponderada por soporte, con el sentido de cada miembro alineado al primero),
 * posición promedio y alcance a lo largo del eje que cubre a todos los puntos
 * de todos los limbos implicados — así el eje de un paquete de varios
 * contactos llega tan lejos como el más largo de ellos.
 */
function finalizeAxis(cluster, index, georef) {
  const members = cluster.members
  const ref = members[0].dir
  let dx = 0
  let dy = 0
  let dz = 0
  let sw = 0
  for (const m of members) {
    const s = m.dir[0] * ref[0] + m.dir[1] * ref[1] + m.dir[2] * ref[2] < 0 ? -1 : 1
    dx += s * m.dir[0] * m.support
    dy += s * m.dir[1] * m.support
    dz += s * m.dir[2] * m.support
    sw += m.support
  }
  const dlen = Math.hypot(dx, dy, dz) || 1
  let dir = [dx / dlen, dy / dlen, dz / dlen]
  // El sentido queda fijado por la convención de inmersión: siempre hacia
  // abajo, para que el extremo `b` sea el que hay que rotular con la flecha
  // de inmersión.
  if (dir[2] > 0) dir = [-dir[0], -dir[1], -dir[2]]

  let ox = 0
  let oy = 0
  let oz = 0
  for (const m of members) {
    ox += m.at[0] * m.support
    oy += m.at[1] * m.support
    oz += m.at[2] * m.support
  }
  const origin = [ox / sw, oy / sw, oz / sw]

  let sMin = Infinity
  let sMax = -Infinity
  for (const m of members) {
    for (const p of m.points) {
      const s = (p[0] - origin[0]) * dir[0] + (p[1] - origin[1]) * dir[1] + (p[2] - origin[2]) * dir[2]
      if (s < sMin) sMin = s
      if (s > sMax) sMax = s
    }
  }
  if (!(sMax > sMin)) {
    sMin = -1
    sMax = 1
  }
  const a = [origin[0] + dir[0] * sMin, origin[1] + dir[1] * sMin, origin[2] + dir[2] * sMin]
  const b = [origin[0] + dir[0] * sMax, origin[1] + dir[1] * sMax, origin[2] + dir[2] * sMax]

  const { trend, plunge } = vectorToLine(dir)
  const contacts = [
    ...new Map(
      members.map((m) => [`${m.contactId}|${m.block}`, { id: m.contactId, name: m.name, color: m.color, block: m.block }])
    ).values(),
  ]

  return {
    id: `fold_${index}`,
    type: cluster.type,
    trend,
    plunge,
    origin,
    dir,
    a,
    b, // extremo de menor cota, en dirección de inmersión: ahí va la flecha
    aImg: toImage(georef, a),
    bImg: toImage(georef, b),
    contacts,
    support: sw,
  }
}

/**
 * Ejes de pliegue de toda la escena: uno por paquete de capas concordantes,
 * con su tipo (antiforme/sinforme), su inmersión y su traza en el mapa.
 */
export function foldAxes(scene) {
  if (!scene?.ready) return []
  const raw = []
  for (const c of scene.contacts) {
    const byBlock = scene.contactSurfaces.get(c.id)
    if (!byBlock) continue
    for (const [block, surf] of byBlock) {
      const dom = surf.domains
      if (!dom || dom.count < 2) continue
      for (let i = 0; i < dom.count; i++) {
        const pi = dom.planes[i]
        if (!pi) continue
        for (let j = i + 1; j < dom.count; j++) {
          const pj = dom.planes[j]
          if (!pj) continue
          const hit = hingeBetween(pi, pj, dom.groups[i], dom.groups[j])
          if (hit) raw.push({ ...hit, contactId: c.id, name: c.name, color: c.color, block })
        }
      }
    }
  }
  if (!raw.length) return []
  return clusterAxes(raw).map((cl, i) => finalizeAxis(cl, i, scene.georef))
}
