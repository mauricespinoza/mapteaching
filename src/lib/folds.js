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
// Puntos mínimos por limbo. Un plano lo fijan tres puntos: con tres, o con
// cuatro, el ajuste pasa por los datos haga la superficie lo que haga y su
// manteo no está confirmado por nada. Dibujar un eje de pliegue en el mapa es
// una afirmación fuerte —dice dónde está la charnela y hacia dónde se sumerge—,
// así que se exige que cada limbo tenga puntos de sobra: seis, tres más de los
// que consume el propio plano. Con menos, un trozo suelto de una serie que en
// realidad es plana sale con un manteo cualquiera, y dos trozos así siempre
// «se cruzan» en alguna parte: es el pliegue que no existe.
const MIN_LIMB_POINTS = 6
// La charnela calculada tiene que caer cerca de datos reales de los dos
// limbos, en unidades de la separación típica entre contornos estructurales.
const REACH_FACTOR = 6
// Dos candidatos de charnela se funden en un mismo eje si sus direcciones no
// difieren más que esto…
const MERGE_ANGLE = 20
// …y si además el trazo axial de uno pasa cerca del otro **en planta**, en el
// mismo tipo de unidades que REACH_FACTOR. Es una tolerancia estrecha a
// propósito: en un tren de pliegues las charnelas del mismo tipo se repiten
// cada longitud de onda, y fundirlas promediaría ondas distintas en un eje
// que no está en ninguna de ellas.
const MERGE_REACH = 2.5

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
 * Dos planos distintos siempre se cortan en alguna recta, así que la mayor
 * parte del trabajo es descartar los cruces que no son charnelas. Devuelve
 * null si los limbos no tienen datos suficientes para sostener un eje, si su
 * manteo no difiere lo bastante, si el cruce cae lejos de los datos de alguno
 * de los dos, o si entre ellos hay un tercer limbo por el camino: en un tren
 * de pliegues los limbos homólogos también se cruzan, y su cruce cae justo
 * encima de la charnela que hay entre medio, sin ser ellos sus flancos.
 *
 * `others` son los demás limbos con manteo resuelto de la misma superficie.
 */
function hingeBetween(planeA, planeB, groupA, groupB, others = []) {
  if (groupA.length < MIN_LIMB_POINTS || groupB.length < MIN_LIMB_POINTS) return null
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
  const dA = nearest([x0, y0], groupA)
  const dB = nearest([x0, y0], groupB)
  if (dA > reach || dB > reach) return null

  // En un tren de pliegues los limbos alternan manteo, así que dos limbos
  // *homólogos* —el primero y el tercero, el segundo y el cuarto— también
  // «se cruzan», y su cruce cae encima de la charnela que hay entre medio.
  // Geométricamente es un cruce, pero no es una charnela: entre esos dos
  // limbos hay otro limbo por el camino. Se reconoce en que el cruce queda
  // más cerca de los datos de ese tercer limbo que de los dos que supuestamente
  // se juntan ahí. Sólo cuentan como competidores los limbos con manteo
  // resuelto: un contorno suelto de una sola cota no es un panel.
  for (const g of others) {
    if (nearest([x0, y0], g) < Math.max(dA, dB)) return null
  }

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

/**
 * Distancia **en planta** de un punto al eje: es la separación entre los dos
 * trazos axiales sobre el mapa. Se mide así, y no en 3D, porque los contactos
 * de un mismo paquete cortan la misma charnela a cotas distintas —cada uno a
 * su nivel estratigráfico—: en 3D esa diferencia de cota los separa cientos de
 * metros y el paquete nunca llegaría a fundirse en un solo eje.
 */
function axialTraceDistance(p, p0, dir) {
  const dx = p[0] - p0[0]
  const dy = p[1] - p0[1]
  const len = Math.hypot(dir[0], dir[1])
  if (len < 1e-9) return Math.hypot(dx, dy)
  return Math.abs(dx * dir[1] - dy * dir[0]) / len
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
      if (axialTraceDistance(cand.at, cl.at, cl.dir) > cl.reach) continue
      // Dos charnelas de la *misma* superficie que no comparten limbo son dos
      // ondas distintas del tren, por paralelas que salgan: no son el mismo
      // eje. Sí se funden las que comparten limbo, que son una sola charnela
      // vista a través de un limbo que el RANSAC partió en dos trozos.
      const differentWave = cl.members.some(
        (m) => m.key === cand.key && !m.pair.some((d) => cand.pair.includes(d))
      )
      if (differentWave) continue
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
          const others = []
          for (let k = 0; k < dom.count; k++) {
            if (k !== i && k !== j && dom.planes[k]) others.push(dom.groups[k])
          }
          const hit = hingeBetween(pi, pj, dom.groups[i], dom.groups[j], others)
          if (hit)
            raw.push({
              ...hit,
              contactId: c.id,
              name: c.name,
              color: c.color,
              block,
              key: `${c.id}|${block}`,
              pair: [i, j],
            })
        }
      }
    }
  }
  if (!raw.length) return []
  return clusterAxes(raw).map((cl, i) => finalizeAxis(cl, i, scene.georef))
}
