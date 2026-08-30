// Dominios estructurales: en qué panel de una misma superficie cae cada punto.
//
// Un contacto plegado no es un plano. Los puntos donde su traza corta las curvas
// de nivel pertenecen a limbos distintos, y unir los de igual cota sin más —
// como si todo fuese un solo panel— promedia a través de la charnela y produce
// un contorno estructural que no existe. Lo mismo ocurre entre dos ondas de un
// tren de pliegues: dos limbos homólogos mantean igual, pero están desplazados,
// así que tampoco pueden compartir contorno.
//
// El criterio para separarlos es el de la regla de las V: la geometría de la
// traza respecto de la topografía da la dirección de manteo local, y ésa es
// justamente la pendiente del plano que ajusta a los puntos de intersección.
// Aquí se extraen, uno tras otro, los conjuntos máximos de puntos compatibles
// con un mismo plano (RANSAC), exigiendo además que estén espacialmente
// conectados. Cada conjunto es un dominio: un tramo de la superficie con manteo
// aproximadamente constante. El cambio de dominio es el cambio de pendiente.

/** Plano de mínimos cuadrados z = a·x + b·y + c. */
export function planeFit(pts, weights = null) {
  const n = pts.length
  if (n < 3) return null
  let cx = 0
  let cy = 0
  let cz = 0
  let sw = 0
  for (let i = 0; i < n; i++) {
    const w = weights ? weights[i] : 1
    cx += w * pts[i][0]
    cy += w * pts[i][1]
    cz += w * pts[i][2]
    sw += w
  }
  if (!(sw > 0)) return null
  cx /= sw
  cy /= sw
  cz /= sw
  let m00 = 0
  let m01 = 0
  let m11 = 0
  let r0 = 0
  let r1 = 0
  for (let i = 0; i < n; i++) {
    const w = weights ? weights[i] : 1
    const dx = pts[i][0] - cx
    const dy = pts[i][1] - cy
    const dz = pts[i][2] - cz
    m00 += w * dx * dx
    m01 += w * dx * dy
    m11 += w * dy * dy
    r0 += w * dx * dz
    r1 += w * dy * dz
  }
  const det = m00 * m11 - m01 * m01
  const scale = Math.max(m00 + m11, 1e-12)
  // Puntos alineados en planta: la pendiente transversal queda indeterminada.
  if (Math.abs(det) < 1e-6 * scale * scale) return null
  const a = (r0 * m11 - r1 * m01) / det
  const b = (r1 * m00 - r0 * m01) / det
  const c = cz - a * cx - b * cy
  let sse = 0
  for (const p of pts) {
    const e = p[2] - (a * p[0] + b * p[1] + c)
    sse += e * e
  }
  return { a, b, c, rms: Math.sqrt(sse / n), n }
}

const planeAt = (pl, x, y) => pl.a * x + pl.b * y + pl.c

/** Plano exacto por tres puntos; null si son casi colineales en planta. */
function planeThrough(p, q, r) {
  const ux = q[0] - p[0]
  const uy = q[1] - p[1]
  const vx = r[0] - p[0]
  const vy = r[1] - p[1]
  const det = ux * vy - uy * vx
  const scale = (ux * ux + uy * uy + vx * vx + vy * vy) || 1
  // Triángulo demasiado alargado: el plano que sale de él es pura extrapolación.
  if (Math.abs(det) < 0.08 * scale) return null
  const dq = q[2] - p[2]
  const dr = r[2] - p[2]
  const a = (dq * vy - dr * uy) / det
  const b = (dr * ux - dq * vx) / det
  return { a, b, c: p[2] - a * p[0] - b * p[1] }
}

/**
 * Escala de vecindad del problema: la separación típica entre contornos
 * estructurales, medida como la distancia al punto de cota distinta más
 * cercano. No sirve la distancia al vecino más próximo sin más: a lo largo de
 * una traza los cruces se apiñan, y con ese radio dos contornos consecutivos
 * quedarían desconectados y ningún panel llegaría a tener dos cotas.
 */
function medianStep(pts) {
  const d = []
  for (let i = 0; i < pts.length; i++) {
    let best = Infinity
    for (let j = 0; j < pts.length; j++) {
      if (j === i || pts[j][2] === pts[i][2]) continue
      const v = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1])
      if (v < best) best = v
    }
    if (Number.isFinite(best)) d.push(best)
  }
  if (!d.length) return 1
  d.sort((a, b) => a - b)
  return d[d.length >> 1] || 1
}

/**
 * Componente conexa mayor de un subconjunto, uniendo puntos a menos de R. Los
 * puntos se reparten en una rejilla de paso R para no comparar todos con todos:
 * esta rutina se llama miles de veces dentro del RANSAC.
 */
function largestCluster(pts, idx, R) {
  const n = idx.length
  if (n <= 1) return idx
  const cell = Math.max(R, 1e-9)
  const buckets = new Map()
  const key = (cx, cy) => `${cx},${cy}`
  const cellOf = (i) => [Math.floor(pts[idx[i]][0] / cell), Math.floor(pts[idx[i]][1] / cell)]
  for (let i = 0; i < n; i++) {
    const [cx, cy] = cellOf(i)
    const k = key(cx, cy)
    let arr = buckets.get(k)
    if (!arr) buckets.set(k, (arr = []))
    arr.push(i)
  }
  const seen = new Array(n).fill(false)
  const R2 = R * R
  let best = []
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue
    const comp = [s]
    seen[s] = true
    const stack = [s]
    while (stack.length) {
      const a = stack.pop()
      const p = pts[idx[a]]
      const [cx, cy] = cellOf(a)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const arr = buckets.get(key(cx + dx, cy + dy))
          if (!arr) continue
          for (const b of arr) {
            if (seen[b]) continue
            const q = pts[idx[b]]
            const ex = q[0] - p[0]
            const ey = q[1] - p[1]
            if (ex * ex + ey * ey > R2) continue
            seen[b] = true
            comp.push(b)
            stack.push(b)
          }
        }
      }
    }
    if (comp.length > best.length) best = comp
  }
  return best.map((i) => idx[i])
}

const distinctZ = (pts, idx) => new Set(idx.map((i) => pts[i][2])).size

/**
 * Los puntos de una misma cota dentro de un panel son su contorno estructural,
 * y un contorno estructural va por el rumbo del panel. Si no lo hace, el panel
 * está juntando puntos que no se tocan: con pocos datos por cota siempre hay
 * algún plano que pasa por puntos de limbos distintos, y esto lo descarta.
 */
function strikeConsistent(pts, idx, plane, minSep, tolDeg = 28) {
  const g = Math.hypot(plane.a, plane.b)
  if (g < 1e-9) return true
  const sx = -plane.b / g // rumbo: perpendicular al gradiente
  const sy = plane.a / g
  const byZ = new Map()
  for (const i of idx) {
    if (!byZ.has(pts[i][2])) byZ.set(pts[i][2], [])
    byZ.get(pts[i][2]).push(i)
  }
  const cos = Math.cos(tolDeg * Math.PI / 180)
  for (const list of byZ.values()) {
    if (list.length < 2) continue
    // Par más separado de la cota: es el que mejor define la dirección.
    let a = -1
    let b = -1
    let far = 0
    for (let u = 0; u < list.length; u++) {
      for (let v = u + 1; v < list.length; v++) {
        const d = Math.hypot(pts[list[u]][0] - pts[list[v]][0], pts[list[u]][1] - pts[list[v]][1])
        if (d > far) {
          far = d
          a = list[u]
          b = list[v]
        }
      }
    }
    if (far < minSep) continue // demasiado juntos para dar una dirección
    const dx = (pts[b][0] - pts[a][0]) / far
    const dy = (pts[b][1] - pts[a][1]) / far
    if (Math.abs(dx * sx + dy * sy) < cos) return false
  }
  return true
}

/**
 * Puntos ajenos que caen dentro de la franja que el panel ocupa entre su
 * contorno estructural más alto y el más bajo. Un panel real no se salta datos:
 * si entre sus propios contornos hay una cota que no encaja, es que ahí dentro
 * la superficie cambia de pendiente y el panel está uniendo dos limbos.
 */
function straddled(pts, idx, plane, pool, R) {
  const g = Math.hypot(plane.a, plane.b)
  if (g < 1e-9) return 0
  const dx = -plane.a / g // hacia cotas menores: eje de manteo
  const dy = -plane.b / g
  const tx = -dy // a lo largo del rumbo
  const ty = dx
  let sMin = Infinity
  let sMax = -Infinity
  let tMin = Infinity
  let tMax = -Infinity
  for (const i of idx) {
    const s = pts[i][0] * dx + pts[i][1] * dy
    const t = pts[i][0] * tx + pts[i][1] * ty
    if (s < sMin) sMin = s
    if (s > sMax) sMax = s
    if (t < tMin) tMin = t
    if (t > tMax) tMax = t
  }
  const inSet = new Set(idx)
  let count = 0
  for (const i of pool) {
    if (inSet.has(i)) continue
    const s = pts[i][0] * dx + pts[i][1] * dy
    if (s < sMin || s > sMax) continue
    const t = pts[i][0] * tx + pts[i][1] * ty
    if (t < tMin - R || t > tMax + R) continue
    count++
  }
  return count
}

/** Generador congruencial: el resultado no puede cambiar entre renderizados. */
function rng(seed) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/**
 * Reparte los puntos en dominios planos.
 * @param points3D [[x, y, z], ...]
 * @param zTol     desajuste en cota admisible dentro de un dominio (m)
 * @param radius   distancia máxima para considerar dos puntos vecinos (m)
 */
export function structuralDomains(points3D, { zTol = 25, radius = null } = {}) {
  const n = points3D.length
  const labels = new Array(n).fill(0)
  if (n < 3) return finish(points3D, labels)

  const R = radius || medianStep(points3D) * 3.5
  let pool = points3D.map((_, i) => i)
  const found = []

  while (pool.length >= 3) {
    const best = bestPlane(points3D, pool, zTol, R)
    if (!best || best.idx.length < 3) break
    found.push(best.idx)
    const taken = new Set(best.idx)
    pool = pool.filter((i) => !taken.has(i))
  }

  if (!found.length) return finish(points3D, labels)

  found.forEach((idx, k) => {
    for (const i of idx) labels[i] = k
  })

  // Los puntos sobrantes se agregan al dominio que mejor los explica, siempre
  // que quede cerca: si ninguno lo hace, forman dominios propios (una traza
  // suelta de la que sólo se conoce una cota sigue siendo un contorno válido).
  const planes = found.map((idx) => planeFit(idx.map((i) => points3D[i])))
  let next = found.length
  const orphans = []
  for (const i of pool) {
    let bestK = -1
    let bestErr = Infinity
    for (let k = 0; k < found.length; k++) {
      const pl = planes[k]
      if (!pl) continue
      let near = Infinity
      for (const j of found[k]) {
        const v = Math.hypot(points3D[j][0] - points3D[i][0], points3D[j][1] - points3D[i][1])
        if (v < near) near = v
      }
      if (near > R * 2.5) continue
      const err = Math.abs(points3D[i][2] - planeAt(pl, points3D[i][0], points3D[i][1]))
      if (err < bestErr) {
        bestErr = err
        bestK = k
      }
    }
    if (bestK >= 0 && bestErr <= zTol) labels[i] = bestK
    else orphans.push(i)
  }

  // Huérfanos: se agrupan por cota y cercanía, que es lo único que los une.
  const used = new Set()
  for (const i of orphans) {
    if (used.has(i)) continue
    const group = [i]
    used.add(i)
    for (const j of orphans) {
      if (used.has(j)) continue
      if (points3D[j][2] !== points3D[i][2]) continue
      if (group.some((g) => Math.hypot(points3D[j][0] - points3D[g][0], points3D[j][1] - points3D[g][1]) <= R)) {
        group.push(j)
        used.add(j)
      }
    }
    for (const g of group) labels[g] = next
    next++
  }

  return finish(points3D, labels)
}

/** Mejor plano de consenso sobre `pool` (RANSAC). */
function bestPlane(pts, pool, zTol, R) {
  const m = pool.length
  const combos = (m * (m - 1) * (m - 2)) / 6
  const exhaustive = combos <= 20000
  const rand = rng(m * 7919 + 13)
  const iterations = exhaustive ? 0 : 4000
  let best = null

  const consider = (i, j, k) => {
    const p = pts[pool[i]]
    const q = pts[pool[j]]
    const r = pts[pool[k]]
    // Un plano no queda definido por tres puntos de la misma cota.
    if (p[2] === q[2] && q[2] === r[2]) return
    let pl = planeThrough(p, q, r)
    if (!pl) return
    // Conteo barato primero: agrupar y ajustar cuesta bastante más que contar,
    // y el consenso sólo puede encogerse al exigir conexión, así que un plano
    // que ni contando llega al mejor de momento se descarta sin tocarlo.
    let count = 0
    for (const t of pool) {
      if (Math.abs(pts[t][2] - planeAt(pl, pts[t][0], pts[t][1])) <= zTol) count++
    }
    if (count < 3 || (best && count <= best.score)) return
    // Dos rondas: consenso con el plano de la terna y refinado con su ajuste.
    let idx = null
    for (let pass = 0; pass < 2; pass++) {
      const inl = []
      for (const t of pool) {
        if (Math.abs(pts[t][2] - planeAt(pl, pts[t][0], pts[t][1])) <= zTol) inl.push(t)
      }
      if (inl.length < 3 || (best && inl.length <= best.score)) return
      idx = largestCluster(pts, inl, R)
      if (idx.length < 3 || distinctZ(pts, idx) < 2) return
      const refit = planeFit(idx.map((t) => pts[t]))
      if (!refit) return
      pl = refit
    }
    const fit = planeFit(idx.map((t) => pts[t]))
    if (!fit) return
    if (!strikeConsistent(pts, idx, fit, R * 0.3)) return
    const score = idx.length - straddled(pts, idx, fit, pool, R)
    if (!best || score > best.score || (score === best.score && fit.rms < best.rms)) {
      best = { idx, score, rms: fit.rms, plane: fit }
    }
  }

  if (exhaustive) {
    for (let i = 0; i < m - 2; i++) {
      for (let j = i + 1; j < m - 1; j++) {
        for (let k = j + 1; k < m; k++) consider(i, j, k)
      }
    }
  } else {
    for (let it = 0; it < iterations; it++) {
      const i = Math.floor(rand() * m)
      const j = Math.floor(rand() * m)
      const k = Math.floor(rand() * m)
      if (i === j || j === k || i === k) continue
      consider(i, j, k)
    }
  }
  return best
}

function finish(points3D, labels) {
  const seen = new Map()
  const compact = labels.map((l) => {
    if (!seen.has(l)) seen.set(l, seen.size)
    return seen.get(l)
  })
  const count = seen.size || 1
  const groups = Array.from({ length: count }, () => [])
  compact.forEach((l, i) => groups[l].push(points3D[i]))
  // Un grupo de una sola cota no define un plano: ajustarle uno daría manteo 0,
  // que es una respuesta y no un «no se sabe». Se queda sin plano y el panel de
  // resultados lo declara contorno sin manteo resuelto.
  const planes = groups.map((g) =>
    g.length >= 3 && new Set(g.map((p) => p[2])).size >= 2 ? planeFit(g) : null
  )
  return { labels: compact, count, groups, planes }
}

/**
 * Un plano para cada dominio. Los que no resuelven manteo por sí solos —una
 * traza suelta de la que sólo se conoce una cota— heredan la actitud del
 * dominio resuelto más cercano y se desplazan hasta pasar por sus propios
 * puntos. Es la hipótesis de pliegue cilíndrico —el manteo se mantiene a lo
 * largo del pliegue—, y evita que un contorno aislado se quede fuera de la
 * reconstrucción: sin plano no entra en la mezcla, y la superficie pasaría de
 * largo por encima del único dato que hay allí.
 */
export function completeDomainPlanes(groups, planes, fallback = null) {
  const out = planes.slice()
  const centroid = groups.map((g) =>
    g.length ? [g.reduce((s, p) => s + p[0], 0) / g.length, g.reduce((s, p) => s + p[1], 0) / g.length] : null
  )
  for (let k = 0; k < groups.length; k++) {
    if (out[k] || !groups[k].length || !centroid[k]) continue
    let src = null
    let best = Infinity
    for (let m = 0; m < groups.length; m++) {
      if (!planes[m] || !centroid[m]) continue
      const d = Math.hypot(centroid[m][0] - centroid[k][0], centroid[m][1] - centroid[k][1])
      if (d < best) {
        best = d
        src = planes[m]
      }
    }
    if (!src) src = fallback
    if (!src) continue
    let c = 0
    for (const p of groups[k]) c += p[2] - (src.a * p[0] + src.b * p[1])
    out[k] = { a: src.a, b: src.b, c: c / groups[k].length, rms: null, n: groups[k].length, inherited: true }
  }
  return out
}

/**
 * Campo de planos de referencia: en cada punto del mapa, la mezcla de los
 * planos de dominio que le corresponden. Es la forma del pliegue —limbos
 * planos y charnelas redondeadas— antes de afinar con los datos.
 *
 * El peso de cada dominio es una masa gaussiana sobre *sus* puntos, así que el
 * campo es derivable en todas partes. Importa que lo sea: un peso construido
 * sobre la distancia al punto más cercano tiene un pliegue en cada mediatriz, y
 * esos pliegues se copian a la superficie en forma de bollos.
 *
 * El núcleo es alargado a lo largo del rumbo *del propio dominio* —fijo, no
 * interpolado— porque un contorno estructural es una línea de cota constante:
 * promediar a lo largo de ella no cuesta nada, mientras que promediar a través
 * del manteo aplana el pliegue. Con el rumbo fijo por dominio el núcleo no gira
 * al movernos, que es lo que estropearía la suavidad.
 *
 * `sigma` es la anchura de la charnela medida a través del manteo. Se pasa desde
 * fuera porque la escala del problema es la separación entre contornos
 * estructurales, que sólo se conoce con los datos delante.
 */
export function domainPlaneField(groups, planes, fallback, sigma, aniso = 6) {
  const usable = []
  for (let k = 0; k < groups.length; k++) {
    const pl = planes[k]
    if (!pl || !groups[k].length) continue
    const g = Math.hypot(pl.a, pl.b)
    // Un dominio horizontal no tiene rumbo: se pondera de forma isótropa.
    const flat = g < 1e-12
    usable.push({ pts: groups[k], plane: pl, ux: flat ? 1 : pl.a / g, uy: flat ? 0 : pl.b / g, flat })
  }
  if (!usable.length) return fallback ? () => fallback : null
  if (usable.length === 1) {
    const only = usable[0].plane
    return () => only
  }
  const sd2 = Math.max(sigma * sigma, 1e-9)
  const ss2 = sd2 * aniso * aniso
  // Distancia al cuadrado en unidades del núcleo: 1 es un `sigma` a través del
  // manteo y `aniso` sigmas a lo largo del rumbo.
  const reach = (u, p, x, y) => {
    const dx = p[0] - x
    const dy = p[1] - y
    if (u.flat) return (dx * dx + dy * dy) / sd2
    const dd = dx * u.ux + dy * u.uy
    const ds = -dx * u.uy + dy * u.ux
    return (dd * dd) / sd2 + (ds * ds) / ss2
  }
  return (x, y) => {
    let wa = 0
    let wb = 0
    let wz = 0
    let ws = 0
    for (const u of usable) {
      let w = 0
      // Peso racional y no gaussiano. Cerca de los datos se comporta como una
      // campana de anchura `sigma` y da la charnela redondeada; lejos decae como
      // 1/d⁶, es decir según la *proporción* entre distancias y no según una
      // anchura fija. Esto último importa fuera del alcance de los datos: con una
      // campana de anchura fija el reparto entre dominios se vuelve un salto
      // brusco, y como los planos extrapolados a esa distancia difieren en
      // kilómetros, el salto se ve como un escalón en la superficie.
      for (const p of u.pts) {
        const q = 1 + reach(u, p, x, y)
        w += 1 / (q * q * q)
      }
      ws += w
      wa += w * u.plane.a
      wb += w * u.plane.b
      wz += w * planeAt(u.plane, x, y)
    }
    if (!(ws > 0)) return usable[0].plane
    const a = wa / ws
    const b = wb / ws
    const z = wz / ws
    return { a, b, c: z - a * x - b * y }
  }
}
