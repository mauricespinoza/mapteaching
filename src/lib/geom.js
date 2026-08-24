// Utilidades geométricas 2D/3D puras (sin dependencias) usadas por todo el motor
// estructural. Los puntos son arreglos [x, y] o [x, y, z].

export const add = (a, b) => [a[0] + b[0], a[1] + b[1]]
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]]
export const mul = (a, k) => [a[0] * k, a[1] * k]
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1]
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0]
export const len = (a) => Math.hypot(a[0], a[1])
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

export function norm(a) {
  const l = Math.hypot(a[0], a[1])
  return l < 1e-12 ? [0, 0] : [a[0] / l, a[1] / l]
}

/** Perpendicular en sentido horario en pantalla (y hacia abajo). */
export const perp = (a) => [-a[1], a[0]]

export function polylineLength(pts) {
  let s = 0
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i])
  return s
}

/** Distancia punto-segmento y parámetro t del punto proyectado. */
export function pointSegment(p, a, b) {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  let t = l2 < 1e-12 ? 0 : dot(sub(p, a), ab) / l2
  t = Math.max(0, Math.min(1, t))
  const proj = add(a, mul(ab, t))
  return { t, proj, d: dist(p, proj) }
}

/** Distancia mínima de un punto a una polilínea (+ índice de segmento). */
export function pointPolyline(p, pts) {
  let best = { d: Infinity, i: -1, t: 0, proj: null }
  for (let i = 1; i < pts.length; i++) {
    const r = pointSegment(p, pts[i - 1], pts[i])
    if (r.d < best.d) best = { d: r.d, i: i - 1, t: r.t, proj: r.proj }
  }
  if (pts.length === 1) {
    const d = dist(p, pts[0])
    if (d < best.d) best = { d, i: 0, t: 0, proj: pts[0] }
  }
  return best
}

/** Intersección de segmentos ab y cd. Devuelve punto + parámetros o null. */
export function segmentIntersection(a, b, c, d) {
  const r = sub(b, a)
  const s = sub(d, c)
  const den = cross(r, s)
  if (Math.abs(den) < 1e-12) return null
  const t = cross(sub(c, a), s) / den
  const u = cross(sub(c, a), r) / den
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { p: add(a, mul(r, t)), t, u }
}

/** Todas las intersecciones entre dos polilíneas. */
export function polylineIntersections(A, B) {
  const out = []
  for (let i = 1; i < A.length; i++) {
    for (let j = 1; j < B.length; j++) {
      const r = segmentIntersection(A[i - 1], A[i], B[j - 1], B[j])
      if (r) out.push({ p: r.p, ia: i - 1, ta: r.t, ib: j - 1, tb: r.u })
    }
  }
  return out
}

/** Simplificación Ramer–Douglas–Peucker (suaviza trazos a lápiz). */
export function simplify(pts, tol = 1.5) {
  if (pts.length < 3) return pts.slice()
  const keep = new Array(pts.length).fill(false)
  keep[0] = keep[pts.length - 1] = true
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [i0, i1] = stack.pop()
    let maxD = -1
    let idx = -1
    for (let i = i0 + 1; i < i1; i++) {
      const d = pointSegment(pts[i], pts[i0], pts[i1]).d
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = true
      stack.push([i0, idx], [idx, i1])
    }
  }
  return pts.filter((_, i) => keep[i])
}

/** Descarta puntos demasiado juntos (ruido del lápiz). */
export function thin(pts, minDist = 1.2) {
  if (pts.length < 2) return pts.slice()
  const out = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    if (dist(pts[i], out[out.length - 1]) >= minDist) out.push(pts[i])
  }
  if (out.length === 1) out.push(pts[pts.length - 1])
  return out
}

/** Muestreo uniforme de una polilínea cada `step` unidades. */
export function resample(pts, step) {
  if (pts.length < 2) return pts.slice()
  const out = [pts[0]]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    let segLen = dist(a, b)
    if (segLen < 1e-9) continue
    const dir = mul(sub(b, a), 1 / segLen)
    let t = step - carry
    while (t <= segLen) {
      out.push(add(a, mul(dir, t)))
      t += step
    }
    carry = (carry + segLen) % step
  }
  const last = pts[pts.length - 1]
  if (dist(out[out.length - 1], last) > step * 0.25) out.push(last)
  return out
}

/**
 * Ajuste de recta por mínimos cuadrados totales (PCA 2D).
 * Devuelve { c: centroide, dir: unitario, rms, spread } o null.
 */
export function fitLine(points) {
  const n = points.length
  if (n < 2) return null
  let cx = 0
  let cy = 0
  for (const p of points) {
    cx += p[0]
    cy += p[1]
  }
  cx /= n
  cy /= n
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (const p of points) {
    const dx = p[0] - cx
    const dy = p[1] - cy
    sxx += dx * dx
    sxy += dx * dy
    syy += dy * dy
  }
  sxx /= n
  sxy /= n
  syy /= n
  // Autovector mayor de la matriz de covarianza 2x2.
  const tr = sxx + syy
  const det = sxx * syy - sxy * sxy
  const disc = Math.max(0, (tr * tr) / 4 - det)
  const l1 = tr / 2 + Math.sqrt(disc)
  const l2 = tr / 2 - Math.sqrt(disc)
  let dir
  if (Math.abs(sxy) > 1e-12) dir = norm([l1 - syy, sxy])
  else dir = sxx >= syy ? [1, 0] : [0, 1]
  const rms = Math.sqrt(Math.max(0, l2))
  const spread = Math.sqrt(Math.max(0, l1))
  return { c: [cx, cy], dir, rms, spread, n }
}

/**
 * Ajuste de plano z = a·x + b·y + c por mínimos cuadrados.
 * points: [[x,y,z], ...]. Devuelve { a, b, c, rms } o null.
 */
export function fitPlane(points) {
  const n = points.length
  if (n < 3) return null
  let sx = 0
  let sy = 0
  let sz = 0
  for (const p of points) {
    sx += p[0]
    sy += p[1]
    sz += p[2]
  }
  const mx = sx / n
  const my = sy / n
  const mz = sz / n
  let sxx = 0
  let sxy = 0
  let syy = 0
  let sxz = 0
  let syz = 0
  for (const p of points) {
    const dx = p[0] - mx
    const dy = p[1] - my
    const dz = p[2] - mz
    sxx += dx * dx
    sxy += dx * dy
    syy += dy * dy
    sxz += dx * dz
    syz += dy * dz
  }
  const det = sxx * syy - sxy * sxy
  if (Math.abs(det) < 1e-9) return null
  const a = (syy * sxz - sxy * syz) / det
  const b = (sxx * syz - sxy * sxz) / det
  const c = mz - a * mx - b * my
  let err = 0
  for (const p of points) {
    const d = p[2] - (a * p[0] + b * p[1] + c)
    err += d * d
  }
  return { a, b, c, rms: Math.sqrt(err / n) }
}

/** Recorta una recta infinita (punto + dirección) a un rectángulo. */
export function clipLineToRect(c, dir, rect) {
  const { minX, minY, maxX, maxY } = rect
  let t0 = -Infinity
  let t1 = Infinity
  const edges = [
    [dir[0], minX - c[0], maxX - c[0]],
    [dir[1], minY - c[1], maxY - c[1]],
  ]
  for (const [d, lo, hi] of edges) {
    if (Math.abs(d) < 1e-12) {
      if (lo > 0 || hi < 0) return null
      continue
    }
    const a = lo / d
    const b = hi / d
    t0 = Math.max(t0, Math.min(a, b))
    t1 = Math.min(t1, Math.max(a, b))
  }
  if (t1 <= t0) return null
  return [add(c, mul(dir, t0)), add(c, mul(dir, t1))]
}

export function bboxOf(pointLists) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const pts of pointLists) {
    for (const p of pts) {
      if (p[0] < minX) minX = p[0]
      if (p[1] < minY) minY = p[1]
      if (p[0] > maxX) maxX = p[0]
      if (p[1] > maxY) maxY = p[1]
    }
  }
  if (!Number.isFinite(minX)) return null
  return { minX, minY, maxX, maxY }
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
export const lerp = (a, b, t) => a + (b - a) * t
