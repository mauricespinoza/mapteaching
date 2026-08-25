// Edición de trazos como curvas Bézier.
//
// El motor estructural sigue consumiendo polilíneas (`pts`), así que un trazo
// editable guarda además sus `nodes`: puntos de control con dos manejadores
// cada uno. La polilínea se regenera al vuelo desde los nodos, de modo que la
// edición no obliga a tocar nada del resto de la app.

import { dist, pointSegment, simplify } from './geom.js'

/** Nodo: punto + manejadores relativos (entrada y salida). */
const node = (p, hIn, hOut) => ({ p: [p[0], p[1]], hIn, hOut })

/**
 * Convierte una polilínea en nodos suaves (Catmull–Rom → Bézier).
 * Se simplifica antes para no acabar con cientos de nodos tras un trazo a mano.
 */
export function nodesFromPolyline(pts, tolerance = 6) {
  const base = simplify(pts, tolerance)
  if (base.length < 2) return base.map((p) => node(p, [0, 0], [0, 0]))
  const out = []
  for (let i = 0; i < base.length; i++) {
    const prev = base[i - 1] || base[i]
    const next = base[i + 1] || base[i]
    // Tangente de Catmull–Rom; /6 convierte a manejadores de Bézier cúbica.
    const tx = (next[0] - prev[0]) / 6
    const ty = (next[1] - prev[1]) / 6
    out.push(node(base[i], [-tx, -ty], [tx, ty]))
  }
  // Los extremos no tienen vecino: se dejan rectos hacia dentro.
  return out
}

/** Nodos con manejadores nulos: polilínea recta, vértice a vértice. */
export function cornerNodesFromPolyline(pts) {
  return pts.map((p) => node(p, [0, 0], [0, 0]))
}

const ctrlOut = (n) => [n.p[0] + (n.hOut?.[0] || 0), n.p[1] + (n.hOut?.[1] || 0)]
const ctrlIn = (n) => [n.p[0] + (n.hIn?.[0] || 0), n.p[1] + (n.hIn?.[1] || 0)]

function cubicAt(a, c1, c2, b, t) {
  const u = 1 - t
  const w0 = u * u * u
  const w1 = 3 * u * u * t
  const w2 = 3 * u * t * t
  const w3 = t * t * t
  return [
    w0 * a[0] + w1 * c1[0] + w2 * c2[0] + w3 * b[0],
    w0 * a[1] + w1 * c1[1] + w2 * c2[1] + w3 * b[1],
  ]
}

/** Puntos de control de la cúbica entre dos nodos consecutivos. */
export function segmentControls(nodes, i) {
  const a = nodes[i]
  const b = nodes[i + 1]
  return [a.p, ctrlOut(a), ctrlIn(b), b.p]
}

/**
 * Evalúa los nodos como polilínea. `step` es la separación aproximada entre
 * puntos, en las mismas unidades que los nodos (píxeles de imagen).
 */
export function flattenNodes(nodes, step = 8) {
  if (!nodes?.length) return []
  if (nodes.length === 1) return [nodes[0].p.slice()]
  const out = [nodes[0].p.slice()]
  for (let i = 0; i < nodes.length - 1; i++) {
    const [a, c1, c2, b] = segmentControls(nodes, i)
    // Longitud aproximada por el polígono de control.
    const approx = dist(a, c1) + dist(c1, c2) + dist(c2, b)
    const n = Math.max(2, Math.min(32, Math.round(approx / step)))
    for (let k = 1; k <= n; k++) out.push(cubicAt(a, c1, c2, b, k / n))
  }
  return out
}

/** Nodos ya existentes o derivados de la polilínea del trazo. */
export function nodesOf(trace, smooth = true) {
  if (trace?.nodes?.length >= 2) return trace.nodes
  const pts = trace?.pts || []
  return smooth ? nodesFromPolyline(pts) : cornerNodesFromPolyline(pts)
}

/**
 * Qué se ha tocado: un nodo, uno de sus manejadores, o un punto sobre la curva
 * (para insertar un nodo nuevo). `tol` va en las mismas unidades que los nodos.
 */
export function hitTestNodes(nodes, p, tol, activeIndex = -1) {
  // Los manejadores sólo se pueden agarrar en el nodo activo, para que no
  // estorben al mover nodos vecinos.
  if (activeIndex >= 0 && nodes[activeIndex]) {
    const n = nodes[activeIndex]
    if (n.hOut && dist(p, ctrlOut(n)) <= tol) return { type: 'hOut', index: activeIndex }
    if (n.hIn && dist(p, ctrlIn(n)) <= tol) return { type: 'hIn', index: activeIndex }
  }
  for (let i = 0; i < nodes.length; i++) {
    if (dist(p, nodes[i].p) <= tol) return { type: 'node', index: i }
  }
  // Sobre la curva: se busca el segmento más cercano usando la polilínea densa.
  let best = null
  for (let i = 0; i < nodes.length - 1; i++) {
    const [a, c1, c2, b] = segmentControls(nodes, i)
    const steps = 12
    let prev = a
    for (let k = 1; k <= steps; k++) {
      const cur = cubicAt(a, c1, c2, b, k / steps)
      const r = pointSegment(p, prev, cur)
      if (r.d <= tol && (!best || r.d < best.d)) {
        best = { type: 'segment', index: i, t: (k - 1 + r.t) / steps, d: r.d }
      }
      prev = cur
    }
  }
  return best
}

/** Inserta un nodo partiendo la cúbica en el parámetro t (De Casteljau). */
export function insertNode(nodes, i, t) {
  const [a, c1, c2, b] = segmentControls(nodes, i)
  const lerp = (u, v) => [u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t]
  const p01 = lerp(a, c1)
  const p12 = lerp(c1, c2)
  const p23 = lerp(c2, b)
  const p012 = lerp(p01, p12)
  const p123 = lerp(p12, p23)
  const mid = lerp(p012, p123)

  const out = nodes.map((n) => ({ p: n.p.slice(), hIn: n.hIn?.slice() || [0, 0], hOut: n.hOut?.slice() || [0, 0] }))
  out[i].hOut = [p01[0] - a[0], p01[1] - a[1]]
  out[i + 1].hIn = [p23[0] - b[0], p23[1] - b[1]]
  out.splice(i + 1, 0, {
    p: mid,
    hIn: [p012[0] - mid[0], p012[1] - mid[1]],
    hOut: [p123[0] - mid[0], p123[1] - mid[1]],
  })
  return out
}

/** Mueve un nodo, arrastrando con él sus manejadores. */
export function moveNode(nodes, i, p) {
  return nodes.map((n, k) => (k === i ? { ...n, p: [p[0], p[1]] } : n))
}

/**
 * Mueve un manejador. Por defecto mantiene el nodo suave: el manejador opuesto
 * se refleja para que la curva no forme un pico.
 */
export function moveHandle(nodes, i, which, p, smooth = true) {
  return nodes.map((n, k) => {
    if (k !== i) return n
    const h = [p[0] - n.p[0], p[1] - n.p[1]]
    const other = which === 'hOut' ? 'hIn' : 'hOut'
    const next = { ...n, [which]: h }
    if (smooth) {
      const prev = n[other] || [0, 0]
      const lenPrev = Math.hypot(prev[0], prev[1])
      const lenH = Math.hypot(h[0], h[1]) || 1
      // Se conserva la longitud del opuesto y sólo se alinea su dirección.
      const scale = (lenPrev || lenH) / lenH
      next[other] = [-h[0] * scale, -h[1] * scale]
    }
    return next
  })
}

/** Alterna entre nodo suave (manejadores alineados) y vértice en pico. */
export function toggleCorner(nodes, i) {
  return nodes.map((n, k) => {
    if (k !== i) return n
    const isCorner = !n.hIn?.[0] && !n.hIn?.[1] && !n.hOut?.[0] && !n.hOut?.[1]
    if (!isCorner) return { ...n, hIn: [0, 0], hOut: [0, 0] }
    const prev = nodes[k - 1]?.p || n.p
    const next = nodes[k + 1]?.p || n.p
    const tx = (next[0] - prev[0]) / 6
    const ty = (next[1] - prev[1]) / 6
    return { ...n, hIn: [-tx, -ty], hOut: [tx, ty] }
  })
}

export function removeNode(nodes, i) {
  if (nodes.length <= 2) return nodes
  return nodes.filter((_, k) => k !== i)
}

export { ctrlIn, ctrlOut }
