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

/**
 * Suavizado de Chaikin: cada segmento se sustituye por dos puntos a 1/4 y 3/4,
 * lo que redondea las esquinas sin alejarse del trazo. Dos pasadas bastan para
 * que un trazo a mano alzada pierda el temblor del pulso.
 */
export function chaikin(pts, iterations = 2, keepEnds = true) {
  let cur = pts
  for (let it = 0; it < iterations; it++) {
    if (cur.length < 3) return cur
    const out = keepEnds ? [cur[0]] : []
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i]
      const b = cur[i + 1]
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25])
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
    }
    if (keepEnds) out.push(cur[cur.length - 1])
    cur = out
  }
  return cur
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

// Manteo a partir del cual una superficie deja de poder ajustarse regresando la
// cota sobre el mapa. Ver `planeNormal`.
export const STEEP_GRADIENT = Math.tan((70 * Math.PI) / 180)
// Ningún plano se devuelve exactamente vertical: z = a·x + b·y + c no puede
// representarlo. A 89.8° la pendiente ya es de 286 m de cota por metro de mapa:
// sobre un desnivel de 1000 m, recortar ahí desplaza la superficie menos de
// cuatro metros en el mapa —por debajo del grosor del trazo— y a cambio todo
// sigue siendo un número finito.
const MAX_GRADIENT = Math.tan((89.8 * Math.PI) / 180)

/**
 * Normal del plano que mejor ajusta una nube por distancia **perpendicular**
 * (mínimos cuadrados totales): el autovector menor de la matriz de covarianza,
 * por rotaciones de Jacobi.
 *
 * Devuelve `{ n, c, perp }` —normal unitaria, centroide y residuo medido
 * perpendicular al plano— o null.
 */
export function planeNormal(points) {
  const n = points.length
  if (n < 3) return null
  let cx = 0
  let cy = 0
  let cz = 0
  for (const p of points) {
    cx += p[0]
    cy += p[1]
    cz += p[2]
  }
  cx /= n
  cy /= n
  cz /= n
  let a = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  for (const p of points) {
    const d = [p[0] - cx, p[1] - cy, p[2] - cz]
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) a[i][j] += d[i] * d[j]
  }
  let v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  const mul = (X, Y) => X.map((row) => [0, 1, 2].map((j) => row[0] * Y[0][j] + row[1] * Y[1][j] + row[2] * Y[2][j]))
  for (let sweep = 0; sweep < 40; sweep++) {
    // Se anula el mayor término fuera de la diagonal; en 3x3 basta con eso.
    let p = 0
    let q = 1
    let big = Math.abs(a[0][1])
    if (Math.abs(a[0][2]) > big) {
      big = Math.abs(a[0][2])
      p = 0
      q = 2
    }
    if (Math.abs(a[1][2]) > big) {
      big = Math.abs(a[1][2])
      p = 1
      q = 2
    }
    if (big <= 1e-14 * Math.max(1, a[0][0] + a[1][1] + a[2][2])) break
    const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p])
    const c = Math.cos(th)
    const s = Math.sin(th)
    const r = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    r[p][p] = c
    r[q][q] = c
    r[p][q] = s
    r[q][p] = -s
    const rt = [0, 1, 2].map((i) => [0, 1, 2].map((j) => r[j][i]))
    a = mul(rt, mul(a, r))
    v = mul(v, r)
  }
  let k = 0
  for (let i = 1; i < 3; i++) if (a[i][i] < a[k][k]) k = i
  const nrm = [v[0][k], v[1][k], v[2][k]]
  const len = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1
  return {
    n: [nrm[0] / len, nrm[1] / len, nrm[2] / len],
    c: [cx, cy, cz],
    perp: Math.sqrt(Math.max(0, a[k][k]) / n),
  }
}

/**
 * El mismo ajuste perpendicular, ya escrito como z = a·x + b·y + c.
 * Devuelve null si el plano sale vertical de verdad.
 */
export function planeFromNormal(nn) {
  if (!nn) return null
  const [nx, ny, nz] = nn.n
  if (!(Math.abs(nz) > 1e-12)) return null
  let a = -nx / nz
  let b = -ny / nz
  const g = Math.hypot(a, b)
  if (g > MAX_GRADIENT) {
    a = (a / g) * MAX_GRADIENT
    b = (b / g) * MAX_GRADIENT
  }
  return { a, b, c: nn.c[2] - a * nn.c[0] - b * nn.c[1] }
}

/**
 * Ajuste de plano z = a·x + b·y + c.
 * points: [[x,y,z], ...]. Devuelve { a, b, c, rms } o null.
 *
 * Por defecto se regresa la cota sobre el mapa, que es lo que corresponde
 * cuando el error está en la cota: sobre una superficie tendida, dónde cae el
 * cruce en el mapa se sabe mucho mejor que a qué curva de nivel pertenece.
 *
 * En una superficie empinada la suposición se invierte. Lo que se conoce mal es
 * la posición en planta —el grosor del trazo, el píxel— y la cota es exacta:
 * es la curva de nivel que se eligió. Regresar z sobre (x, y) lee entonces ese
 * error horizontal multiplicado por la tangente del manteo: a 87°, el medio
 * milímetro de un trazo se convierte en decenas de metros de cota, y con los
 * puntos casi alineados en planta —que es como se ve en el mapa una superficie
 * vertical— el sistema queda además mal condicionado y devuelve manteos que no
 * tienen nada que ver con el dato (en el caso que destapó esto, 55° donde los
 * contornos daban 90°).
 *
 * Por eso se mide primero el manteo con un ajuste perpendicular, que no depende
 * de esa suposición ni se degrada al empinarse, y si sale empinado se conserva
 * ése. El `rms` que se publica sigue siendo el vertical, porque las tolerancias
 * de todo lo que viene después están en metros de cota.
 */
export function fitPlane(points) {
  const direct = fitPlaneLS(points)
  if (direct && Math.hypot(direct.a, direct.b) < 1) return direct
  const nn = planeNormal(points)
  const perpendicular = planeFromNormal(nn)
  if (!perpendicular) return direct
  if (Math.hypot(perpendicular.a, perpendicular.b) < STEEP_GRADIENT) return direct
  return { ...perpendicular, rms: zRms(points, perpendicular), perp: nn.perp }
}

/** El residuo vertical de un plano frente a la nube. */
export function zRms(points, pl) {
  let err = 0
  for (const p of points) {
    const d = p[2] - (pl.a * p[0] + pl.b * p[1] + pl.c)
    err += d * d
  }
  return Math.sqrt(err / points.length)
}

/** Regresión de la cota sobre el mapa, sin más. */
export function fitPlaneLS(points) {
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

/**
 * Parte una polilínea por el punto de ella más cercano a `p`. Los dos trozos
 * comparten el punto de corte, para que en el mapa no aparezca un hueco entre
 * ambos. Devuelve null si el corte cae sobre un extremo y una de las mitades
 * no llegaría a ser una línea.
 */
export function splitPolyline(pts, p, minSeg = 1e-6) {
  if (!pts || pts.length < 2) return null
  const h = pointPolyline(p, pts)
  if (h.i < 0 || !h.proj) return null
  // Un corte pegado a un vértice repetiría ese punto: se quita el duplicado.
  const dedupe = (q) => q.filter((v, i) => i === 0 || dist(v, q[i - 1]) > minSeg)
  const a = dedupe([...pts.slice(0, h.i + 1), h.proj])
  const b = dedupe([h.proj, ...pts.slice(h.i + 1)])
  if (a.length < 2 || b.length < 2) return null
  return { a, b, at: h.proj }
}
