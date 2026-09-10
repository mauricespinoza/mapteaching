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

import { planeNormal, planeFromNormal, zRms, STEEP_GRADIENT } from './geom.js'

/**
 * Plano de mínimos cuadrados z = a·x + b·y + c.
 *
 * Si el plano sale empinado se rehace por distancia perpendicular: regresar la
 * cota sobre el mapa supone que el error está en la cota, y en una superficie
 * empinada está en el mapa. Ver `fitPlane` en geom.js, donde se explica.
 */
export function planeFit(pts, weights = null) {
  const direct = planeFitLS(pts, weights)
  // El ajuste perpendicular sólo se calcula si hay alguna posibilidad de que la
  // superficie sea empinada: en una tendida sale igual y cuesta, y esto se
  // ejecuta miles de veces dentro del RANSAC. Un plano que la regresión ya ve a
  // 45° puede ser en realidad de 90°; uno que ve horizontal, no.
  if (!direct || Math.hypot(direct.a, direct.b) < 1) return direct
  const perpendicular = planeFromNormal(planeNormal(pts))
  if (!perpendicular || Math.hypot(perpendicular.a, perpendicular.b) < STEEP_GRADIENT) return direct
  return { ...perpendicular, rms: zRms(pts, perpendicular), n: pts.length }
}

function planeFitLS(pts, weights = null) {
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
export function medianStep(pts) {
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
 * Vecindad a lo largo del afloramiento.
 *
 * Dos cruces son vecinos si van seguidos al recorrer una traza: entre ellos no
 * hay nada, son el mismo trozo de contacto. Nada más cuenta como vecindad, y ahí
 * está el asunto entero.
 *
 * Antes se conectaba por cercanía en el mapa, y la cercanía en el mapa engaña de
 * una manera muy concreta en un pliegue: **el limbo de enfrente pasa cerca**. Un
 * contacto plegado aflora en fajas —una por limbo y por onda— separadas por
 * terreno donde ese contacto no aflora, y por tanto donde no hay ni un solo dato
 * que contradiga a nadie. Un plano tendido puede enhebrar los cruces de fajas
 * distintas, del mismo nivel estructural de ondas sucesivas, cabiendo en la
 * tolerancia y sin que ningún punto intermedio lo desmienta, porque no hay
 * puntos intermedios. La conexión por cercanía se lo permitía: las fajas están a
 * mil metros y el radio llegaba. Se lo permitía *siempre*, además: el radio se
 * mide contra la separación entre cruces, que en un mapa con pocas curvas es
 * grande justamente ahí donde el pliegue es apretado.
 *
 * Recorriendo la traza no hay manera de hacer eso. Para llegar del cruce de una
 * faja al de la siguiente hay que pasar por todos los que hay en medio —los que
 * suben por el limbo, cien metros de cota cada setenta de mapa—, y ésos no caben
 * en el plano ni de lejos. El panel se corta solo donde el afloramiento se corta,
 * que es donde tiene que cortarse.
 *
 * Los tramos distintos siguen pudiendo unirse si se tocan en el mapa (`R`): un
 * mismo contacto se dibuja a menudo en varios trazos, y la falla parte sus
 * trazas en dos. Lo que ya no se puede es saltar por encima de datos ajenos.
 */
function outcropNeighbours(n, runs, pts, R) {
  const adj = Array.from({ length: n }, () => [])
  const link = (a, b) => {
    adj[a].push(b)
    adj[b].push(a)
  }
  const enRun = new Array(n).fill(-1)
  runs.forEach((run, k) => {
    for (const i of run) enRun[i] = k
    for (let i = 1; i < run.length; i++) link(run[i - 1], run[i])
  })
  // Puntas de tramo con puntas de otro tramo: un contacto dibujado a trozos, o
  // cortado por una falla, sigue siendo el mismo afloramiento si se tocan.
  const puntas = []
  for (const run of runs) {
    puntas.push(run[0])
    if (run.length > 1) puntas.push(run[run.length - 1])
  }
  for (let a = 0; a < puntas.length; a++) {
    for (let b = a + 1; b < puntas.length; b++) {
      const i = puntas[a]
      const j = puntas[b]
      if (enRun[i] === enRun[j]) continue
      if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) <= R * 0.2) link(i, j)
    }
  }
  // Un punto que no viene de ninguna traza —un contorno puesto a mano— se queda
  // sin vecinos y forma dominio aparte, que es lo honrado: no hay afloramiento
  // que lo ate a nada.
  return adj
}

/** Componente conexa mayor de un subconjunto, según la vecindad dada. */
function largestByAdjacency(idx, adj) {
  const inSet = new Set(idx)
  const seen = new Set()
  let best = []
  for (const s of idx) {
    if (seen.has(s)) continue
    const comp = [s]
    seen.add(s)
    const stack = [s]
    while (stack.length) {
      const a = stack.pop()
      for (const b of adj[a]) {
        if (seen.has(b) || !inSet.has(b)) continue
        seen.add(b)
        comp.push(b)
        stack.push(b)
      }
    }
    if (comp.length > best.length) best = comp
  }
  return best
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
 * Cada punto, en el panel que de verdad lo explica.
 *
 * El RANSAC extrae los planos uno tras otro y, al terminar, reparte lo que
 * sobró en el panel más cercano que lo admita. Las dos cosas se deciden con el
 * plano que había en ese momento, no con el que queda al final, y ahí es donde
 * se cuela el problema: **cerca de una charnela los dos limbos se juntan**, así
 * que los puntos del flanco de enfrente entran dentro de la tolerancia de este
 * y se los queda. Al reajustar con ellos dentro, el plano se va al promedio de
 * los dos flancos, deja de pasar por unos y por otros, y el panel queda montado
 * a caballo de la charnela.
 *
 * Ese panel promedio es el origen de todo lo que se ve mal en un pliegue. Su
 * contorno de cada cota une un punto de un limbo con otro del limbo opuesto:
 * el contorno estructural que cruza el pliegue en vez de seguirlo. Y como la
 * charnela se calcula donde se cortan dos planos, y esa recta es perpendicular
 * a la *diferencia* de sus gradientes, un plano que ya es el promedio de los
 * dos flancos le quita a esa diferencia justo su componente a través del
 * pliegue: queda la que corre a lo largo, y el eje sale girado hacia la
 * perpendicular de su dirección real. De ahí los ejes oblicuos, y casi
 * ortogonales, sobre un pliegue cuya dirección se lee a simple vista.
 *
 * La cura no necesita saber nada de pliegues: **un punto pertenece al panel
 * que mejor lo explica**. Se recorre el reparto entero comparando cada punto
 * con todos los paneles que tiene al lado, se mueve el que otro explique
 * claramente mejor, se reajustan los planos y se repite. Es el mismo ir y
 * venir de las medias móviles, y converge en dos o tres vueltas: en cuanto un
 * puñado de puntos del flanco de enfrente se marcha, el plano deja de ser un
 * promedio, se pega a su limbo, y los que quedaban del otro lado dejan de
 * encajar y se van detrás.
 *
 * Dos limbos homólogos de un tren de pliegues no se confunden por esto: tienen
 * el mismo manteo, pero están desplazados, así que el plano del de al lado pasa
 * cientos de metros por encima o por debajo de estos puntos. La comparación es
 * en cota, no en manteo, y ésa es la que los distingue. Y sólo compite el panel
 * que tiene datos ahí mismo: un plano que encaja en cota pero cuyos puntos
 * están a un kilómetro no explica nada, pasa por casualidad.
 */
function assignToBestPlane(points3D, labels, zTol, R, adj) {
  // Hace falta que el otro panel explique el punto **claramente** mejor: sin
  // margen, dos planos casi iguales se intercambiarían puntos en cada vuelta
  // sin que el reparto mejorase en nada.
  const margin = zTol * 0.2
  const reach = R * 2.5
  // Sólo compite el panel con el que el punto comparte afloramiento (o, sin
  // trazas, el que tiene datos ahí al lado). Un plano que encaja en cota pero
  // cuyos puntos están al otro lado de un terreno sin datos no explica nada.
  const tocan = (i, idx) => {
    if (adj) {
      const set = new Set(idx)
      return adj[i].some((j) => set.has(j))
    }
    for (const j of idx) {
      if (Math.hypot(points3D[j][0] - points3D[i][0], points3D[j][1] - points3D[i][1]) <= reach) return true
    }
    return false
  }
  for (let round = 0; round < 4; round++) {
    const groups = new Map()
    labels.forEach((l, i) => {
      if (!groups.has(l)) groups.set(l, [])
      groups.get(l).push(i)
    })
    const planes = new Map()
    for (const [l, idx] of groups) {
      planes.set(l, idx.length >= 3 && distinctZ(points3D, idx) >= 2 ? planeFit(idx.map((i) => points3D[i])) : null)
    }
    const next = labels.slice()
    let moved = 0
    for (let i = 0; i < points3D.length; i++) {
      const p = points3D[i]
      const own = planes.get(labels[i])
      let bestL = labels[i]
      let bestErr = own ? Math.abs(p[2] - planeAt(own, p[0], p[1])) : Infinity
      for (const [l, idx] of groups) {
        if (l === labels[i]) continue
        const pl = planes.get(l)
        if (!pl) continue
        const err = Math.abs(p[2] - planeAt(pl, p[0], p[1]))
        if (err > zTol || err >= bestErr - margin) continue
        if (!tocan(i, idx)) continue
        bestErr = err
        bestL = l
      }
      if (bestL !== labels[i]) {
        next[i] = bestL
        moved++
      }
    }
    labels = next
    if (!moved) break
  }

  return labels
}

/**
 * Reparte los puntos en dominios planos.
 * @param points3D [[x, y, z], ...]
 * @param zTol     desajuste en cota admisible dentro de un dominio (m)
 * @param radius   distancia máxima para considerar dos puntos vecinos (m)
 */
export function structuralDomains(points3D, { zTol = 25, radius = null, runs = null } = {}) {
  const n = points3D.length
  const labels = new Array(n).fill(0)
  if (n < 3) return finish(points3D, labels)

  const R = radius || medianStep(points3D) * 3.5
  // Con los tramos de afloramiento, la vecindad va por la traza; sin ellos
  // —contornos puestos a mano—, por cercanía en el mapa, como antes.
  const adj = runs?.length ? outcropNeighbours(n, runs, points3D, R) : null
  let pool = points3D.map((_, i) => i)
  const found = []

  while (pool.length >= 3) {
    const best = bestPlane(points3D, pool, zTol, R, adj)
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
  const vecinoDe = (i, grupo) => {
    if (adj) {
      const set = new Set(grupo)
      return adj[i].some((j) => set.has(j))
    }
    for (const j of grupo) {
      if (Math.hypot(points3D[j][0] - points3D[i][0], points3D[j][1] - points3D[i][1]) <= R * 2.5) return true
    }
    return false
  }
  for (const i of pool) {
    let bestK = -1
    let bestErr = Infinity
    for (let k = 0; k < found.length; k++) {
      const pl = planes[k]
      if (!pl) continue
      // Un punto sólo se suma al panel con el que comparte afloramiento: si hay
      // que cruzar terreno sin datos para llegar, no es el mismo panel.
      if (!vecinoDe(i, found[k])) continue
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

  return finish(points3D, assignToBestPlane(points3D, labels, zTol, R, adj))
}

/** Mejor plano de consenso sobre `pool` (RANSAC). */
function bestPlane(pts, pool, zTol, R, adj) {
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
      idx = adj ? largestByAdjacency(inl, adj) : largestCluster(pts, inl, R)
      if (idx.length < 3 || distinctZ(pts, idx) < 2) return
      const refit = planeFit(idx.map((t) => pts[t]))
      if (!refit) return
      pl = refit
    }
    // Un panel tiene que explicar a los suyos con la misma tolerancia con la
    // que los admitió. Los puntos se recogen con el plano de la ronda anterior
    // y el ajuste final es otro, así que puede acabar describiendo mal a la
    // mitad de ellos —y eso es exactamente lo que hace un panel montado a
    // caballo de una charnela: entra en la tolerancia por los pelos, recoge
    // puntos de los dos flancos y su plano, que es el promedio de los dos, no
    // pasa por ninguno—. Se quedan sólo los que el ajuste final sí explica; si
    // eran de dos flancos, lo que queda es uno.
    idx = idx.filter((t) => Math.abs(pts[t][2] - planeAt(pl, pts[t][0], pts[t][1])) <= zTol)
    if (idx.length >= 3) idx = adj ? largestByAdjacency(idx, adj) : largestCluster(pts, idx, R)
    if (idx.length < 3 || distinctZ(pts, idx) < 2) return
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

/**
 * Puntos mínimos por limbo. Un plano lo fijan tres puntos: con tres, o con
 * cuatro, el ajuste pasa por los datos haga la superficie lo que haga y su
 * actitud no está confirmada por nada. Seis es el primer número con el que un
 * dominio sostiene un manteo propio, y es también el listón con el que se
 * admite una charnela entre dos de ellos (ver `folds.js`).
 */
export const MIN_LIMB_POINTS = 6

/**
 * Diferencia mínima entre dos planos para admitir que entre ellos hay una
 * charnela real, y no dos trozos del mismo limbo que el RANSAC separó por
 * casualidad. En grados.
 */
export const MIN_HINGE_ANGLE = 8

/** Ángulo entre dos planos z = a·x + b·y + c, en grados. */
export function planeAngle(p, q) {
  const n1 = [p.a, p.b, -1]
  const n2 = [q.a, q.b, -1]
  const l1 = Math.hypot(n1[0], n1[1], n1[2])
  const l2 = Math.hypot(n2[0], n2[1], n2[2])
  const d = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]
  return (Math.acos(Math.min(1, Math.max(-1, d / (l1 * l2)))) * 180) / Math.PI
}

/**
 * ¿Hay pliegue aquí? Lo hay cuando dos limbos —los dos con puntos de sobra y
 * manteo propio— difieren lo bastante como para que entre ellos haya una
 * charnela. Es el mismo listón con el que se acepta un eje de pliegue
 * (`folds.js`), y se le pregunta a un paquete estructural entero: un contacto
 * suelto con pocos cruces no decide si su paquete está plegado, lo deciden
 * todos sus contactos juntos.
 *
 * @param list [{ groups, planes, count }] repartos de las superficies del paquete
 */
export function hasFoldEvidence(list) {
  for (const dom of list) {
    if (!dom || dom.count < 2) continue
    for (let i = 0; i < dom.count; i++) {
      if (!isLimb(dom.groups[i], dom.planes[i])) continue
      for (let j = i + 1; j < dom.count; j++) {
        if (!isLimb(dom.groups[j], dom.planes[j])) continue
        if (planeAngle(dom.planes[i], dom.planes[j]) >= MIN_HINGE_ANGLE) return true
      }
    }
  }
  return false
}

/**
 * ¿Es este dominio un **limbo** —un panel de la superficie con manteo propio—
 * o sólo lo que le sobró al reparto? Un limbo tiene puntos de sobra y un plano
 * resuelto; lo demás son restos: una traza suelta, un par de cruces
 * tangenciales, el rabo de un contorno que se salió de su panel.
 */
export const isLimb = (group, plane) => Boolean(plane) && (group?.length || 0) >= MIN_LIMB_POINTS

/**
 * Rehace el reparto a partir de unas etiquetas ya decididas: compacta los
 * índices, reagrupa los puntos y reajusta el plano de cada dominio. Es lo que
 * usa `structuralDomains` al terminar, y lo que necesita quien retoque las
 * etiquetas después (ver `tidyDomains` en structure.js).
 */
export function rebuildDomains(points3D, labels) {
  return finish(points3D, labels)
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
