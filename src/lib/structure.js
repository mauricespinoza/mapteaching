// Motor de contornos estructurales.
//
// Cada horizonte (contacto geológico o traza de falla) es la intersección de una
// superficie con la topografía. Los puntos donde la traza cruza una curva de nivel
// son puntos de cota conocida sobre esa superficie: ajustando una recta a los
// puntos de igual cota se obtiene el *contorno estructural* de esa cota. Entre dos
// contornos consecutivos, el rumbo es la dirección de las rectas y el manteo
// sale de atan(Δcota / separación horizontal).
//
// Antes de ajustar nada los puntos se reparten en dominios (domains.js), porque
// una superficie plegada cambia de manteo: unir los puntos de igual cota a través
// de una charnela daría un contorno estructural que no existe en el mapa.

import { fitLine, fitPlane, polylineIntersections, dot, sub, norm, perp, clipLineToRect } from './geom.js'
import { azimuthWorld, formatAttitude, norm360 } from './georef.js'
import { structuralDomains, domainPlaneField } from './domains.js'

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/**
 * Intersecta las trazas de una estructura con las curvas de nivel.
 * @param traces  [[ [x,y], ... ]] polilíneas en coordenadas mundo (m)
 * @param contours [{ elevation, pts }] curvas de nivel en coordenadas mundo
 * @returns [[x, y, z], ...]
 */
export function intersectWithContours(traces, contours, tol = 1) {
  const raw = []
  for (const trace of traces) {
    if (trace.length < 2) continue
    for (const c of contours) {
      if (c.pts.length < 2) continue
      for (const hit of polylineIntersections(trace, c.pts)) {
        raw.push([hit.p[0], hit.p[1], c.elevation])
      }
    }
  }
  // Los cruces tangenciales generan varias intersecciones casi coincidentes:
  // se colapsan para no falsear el ajuste del contorno estructural.
  const out = []
  for (const p of raw) {
    let dup = false
    for (const q of out) {
      if (q[2] === p[2] && Math.hypot(q[0] - p[0], q[1] - p[1]) < tol) {
        dup = true
        break
      }
    }
    if (!dup) out.push(p)
  }
  return out
}

/** Agrupa los puntos 3D por cota y ajusta una recta a cada grupo. */
export function structureContours(points3D, tol = 1, limbOf = null) {
  const byZ = new Map()
  for (const p of points3D) {
    // Con `limbOf` los puntos de una misma cota se separan por limbo: en un
    // pliegue, ajustar una sola recta a los dos flancos promediaría a través
    // de la charnela y daría un rumbo que no existe.
    const limb = limbOf ? limbOf(p) : 0
    const key = `${p[2]}|${limb}`
    let arr = byZ.get(key)
    if (!arr) byZ.set(key, (arr = { elevation: p[2], limb, pts: [] }))
    arr.pts.push([p[0], p[1]])
  }
  const out = []
  for (const group of byZ.values()) {
    const { elevation, limb } = group
    const pts = group.pts
    if (pts.length < 2) {
      out.push({ elevation, limb, points: pts, fit: null, n: pts.length })
      continue
    }
    const fit = fitLine(pts)
    if (!fit || fit.spread < tol * 1.5) {
      // Puntos prácticamente coincidentes: no definen una dirección de rumbo.
      out.push({ elevation, limb, points: pts, fit: null, n: pts.length })
      continue
    }
    // Extensión del contorno: proyección de los puntos sobre la recta.
    let tmin = Infinity
    let tmax = -Infinity
    for (const p of pts) {
      const t = dot(sub(p, fit.c), fit.dir)
      if (t < tmin) tmin = t
      if (t > tmax) tmax = t
    }
    out.push({ elevation, limb, points: pts, fit, tmin, tmax, n: pts.length })
  }
  out.sort((a, b) => a.limb - b.limb || a.elevation - b.elevation)
  return out
}

/**
 * Desajuste en cota que se admite dentro de un mismo dominio. Se mide contra el
 * intervalo entre curvas de nivel: un cuarto de intervalo separa limbos sin
 * partir un panel por el error de digitalización.
 */
function domainTolerance(points3D, tol) {
  const zs = [...new Set(points3D.map((p) => p[2]))].sort((a, b) => a - b)
  if (zs.length < 2) return Math.max(tol * 3, 1)
  const gaps = []
  for (let i = 1; i < zs.length; i++) gaps.push(zs[i] - zs[i - 1])
  gaps.sort((a, b) => a - b)
  return Math.max(gaps[gaps.length >> 1] * 0.25, tol * 3)
}

/** Promedio circular de direcciones de recta (módulo 180°). */
function meanDirection(dirs) {
  let sx = 0
  let sy = 0
  for (const d of dirs) {
    const a = 2 * Math.atan2(d[1], d[0])
    sx += Math.cos(a)
    sy += Math.sin(a)
  }
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) return dirs[0]
  const a = Math.atan2(sy, sx) / 2
  return [Math.cos(a), Math.sin(a)]
}

/**
 * Actitud (rumbo/manteo) entre dos contornos estructurales consecutivos.
 * Devuelve null si están tan alineados que la separación es indeterminada.
 */
function attitudeBetween(lo, hi) {
  if (!lo.fit || !hi.fit) return null
  const dir = meanDirection([lo.fit.dir, hi.fit.dir])
  let n = norm(perp(dir)) // normal a la traza del contorno, en el plano horizontal
  const dz = hi.elevation - lo.elevation
  if (Math.abs(dz) < 1e-9) return null
  // Separación horizontal medida perpendicular al rumbo.
  let sep = dot(sub(hi.fit.c, lo.fit.c), n)
  if (Math.abs(sep) < 1e-6) return null
  // n debe apuntar hacia el contorno de mayor cota; la dirección de manteo es −n.
  if (sep < 0) {
    n = [-n[0], -n[1]]
    sep = -sep
  }
  const dip = Math.atan2(Math.abs(dz), sep) * DEG
  const dipDir = azimuthWorld([-n[0], -n[1]])
  return {
    z1: lo.elevation,
    z2: hi.elevation,
    dz,
    spacing: sep,
    dip,
    dipDir,
    strikeDir: dir,
    ...formatAttitude(dipDir, dip),
    nPoints: lo.n + hi.n,
  }
}

/** Actitud media a partir del plano de mínimos cuadrados (z = ax + by + c). */
function attitudeFromPlane(plane) {
  if (!plane) return null
  const g = Math.hypot(plane.a, plane.b)
  const dip = Math.atan(g) * DEG
  const dipDir = g < 1e-9 ? 0 : azimuthWorld([-plane.a, -plane.b])
  return { dip, dipDir, ...formatAttitude(dipDir, dip), rms: plane.rms }
}

/**
 * Ajuste local móvil (moving least squares): en cada punto se ajusta un plano
 * ponderando los datos por su distancia. El resultado es una superficie
 * continua y derivable que sigue los pliegues en vez de promediarlos, y que da
 * la orientación local en cualquier punto. Con datos planos degenera
 * exactamente en el plano global, así que sustituye al ajuste plano sin
 * cambiar los casos sencillos.
 */
export function buildMls(points3D, basePlane) {
  const n = points3D.length
  if (n < 4) return null
  // Ancho de banda: suficiente para que cada ajuste vea varios puntos, pero
  // menor que la longitud de onda de un pliegue.
  let sx = 0
  let sy = 0
  for (const p of points3D) {
    sx += p[0]
    sy += p[1]
  }
  const cx = sx / n
  const cy = sy / n
  let spread = 0
  for (const p of points3D) spread += Math.hypot(p[0] - cx, p[1] - cy)
  spread /= n
  // El ancho de banda se adapta en cada consulta a la distancia del k-ésimo
  // punto más cercano: estrecho donde hay datos densos (sigue el pliegue) y
  // ancho donde son escasos (se mantiene estable).
  const K = Math.min(n, 8)
  const hFloor = Math.max(spread * 0.06, 1e-6)
  const hCeil = Math.max(spread * 1.5, hFloor * 4)
  const eps2 = Math.pow(Math.max(spread * 1e-4, 1e-6), 2)
  const d2s = new Float64Array(n)
  const kbuf = new Float64Array(Math.max(1, Math.min(n, 8)))
  // Regularización hacia un plano de referencia: evita que un grupo de puntos
  // casi alineados (lo habitual en una traza) produzca un ajuste inestable. Ese
  // plano es el del dominio estructural que corresponde a cada zona, no el plano
  // global: si fuese el global, la superficie tendería al promedio de los dos
  // limbos y el pliegue se aplanaría justo donde importa.
  const zMean = points3D.reduce((s2, p) => s2 + p[2], 0) / n
  const flat = { a: 0, b: 0, c: zMean }
  const planeOf = typeof basePlane === 'function' ? basePlane : () => basePlane
  const lambda = 1e-9
  const MU = 0.15

  function fit(x, y) {
    const g = planeOf(x, y) || flat
    for (let i = 0; i < n; i++) {
      const dx = points3D[i][0] - x
      const dy = points3D[i][1] - y
      d2s[i] = dx * dx + dy * dy
    }
    // k-ésima distancia por inserción en un búfer de tamaño K: ordenar las N
    // distancias en cada consulta hacía inviable rellenar una grilla entera.
    let filled = 0
    for (let i = 0; i < n; i++) {
      const v = d2s[i]
      if (filled < K) {
        let j = filled++
        while (j > 0 && kbuf[j - 1] > v) {
          kbuf[j] = kbuf[j - 1]
          j--
        }
        kbuf[j] = v
      } else if (v < kbuf[K - 1]) {
        let j = K - 1
        while (j > 0 && kbuf[j - 1] > v) {
          kbuf[j] = kbuf[j - 1]
          j--
        }
        kbuf[j] = v
      }
    }
    const h = Math.min(hCeil, Math.max(hFloor, Math.sqrt(kbuf[filled - 1]) * 1.1))
    const h2 = h * h
    // Sistema normal 3x3 de z = a·(x−x0) + b·(y−y0) + c, centrado en la consulta.
    let m00 = lambda
    let m01 = 0
    let m02 = 0
    let m11 = lambda
    let m12 = 0
    let m22 = lambda
    let r0 = lambda * g.a
    let r1 = lambda * g.b
    let r2 = lambda * (g.a * x + g.b * y + g.c)
    let wsum = 0
    for (let i = 0; i < n; i++) {
      const p = points3D[i]
      const dx = p[0] - x
      const dy = p[1] - y
      const rr = dx * dx + dy * dy
      // Peso singular (Shepard): tiende a infinito en el dato, de modo que la
      // superficie interpola los puntos observados en vez de sólo aproximarlos.
      const w = Math.exp(-rr / h2) / (rr + eps2)
      if (!Number.isFinite(w)) return { z: points3D[i][2], a: g.a, b: g.b }
      if (w < 1e-12) continue
      wsum += w
      m00 += w * dx * dx
      m01 += w * dx * dy
      m02 += w * dx
      m11 += w * dy * dy
      m12 += w * dy
      m22 += w
      r0 += w * dx * p[2]
      r1 += w * dy * p[2]
      r2 += w * p[2]
    }
    // Regularización proporcional a la masa de datos: tira del *gradiente*
    // hacia el plano global sin tocar la cota local, así la superficie sigue
    // interpolando los puntos pero no inventa pendientes donde los datos están
    // alineados sobre una traza y no determinan la dirección transversal.
    const tau = MU * m22 * h2
    m00 += tau
    m11 += tau
    r0 += tau * g.a
    r1 += tau * g.b
    if (wsum < 1e-9) return { z: g.a * x + g.b * y + g.c, a: g.a, b: g.b }
    // Resolución directa del sistema simétrico 3x3.
    const A = [
      [m00, m01, m02],
      [m01, m11, m12],
      [m02, m12, m22],
    ]
    const r = [r0, r1, r2]
    const sol = solve3(A, r)
    if (!sol) return { z: g.a * x + g.b * y + g.c, a: g.a, b: g.b }
    return { z: sol[2], a: sol[0], b: sol[1] }
  }

  return { evaluate: fit, n }
}

/** Eliminación gaussiana con pivoteo para un sistema 3x3. */
function solve3(A, r) {
  const m = [
    [A[0][0], A[0][1], A[0][2], r[0]],
    [A[1][0], A[1][1], A[1][2], r[1]],
    [A[2][0], A[2][1], A[2][2], r[2]],
  ]
  for (let c = 0; c < 3; c++) {
    let piv = c
    for (let i = c + 1; i < 3; i++) if (Math.abs(m[i][c]) > Math.abs(m[piv][c])) piv = i
    if (Math.abs(m[piv][c]) < 1e-12) return null
    if (piv !== c) {
      const t = m[c]
      m[c] = m[piv]
      m[piv] = t
    }
    for (let i = 0; i < 3; i++) {
      if (i === c) continue
      const f = m[i][c] / m[c][c]
      for (let j = c; j < 4; j++) m[i][j] -= f * m[c][j]
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]]
}

/** Actitud local a partir del gradiente de la superficie. */
export function attitudeFromGradient(a, b) {
  const grad = Math.hypot(a, b)
  const dip = Math.atan(grad) * DEG
  const dipDir = grad < 1e-9 ? 0 : azimuthWorld([-a, -b])
  return { dip, dipDir, ...formatAttitude(dipDir, dip) }
}

/**
 * Construye el modelo de una superficie geológica a partir de sus contornos
 * estructurales. `elevationAt(x, y)` interpola entre contornos consecutivos
 * (permite pliegues cilíndricos) y extrapola con el gradiente de los extremos.
 */
export function buildSurface({ traces, contours, manual = null, name = '', color = '#000', tol = 1 }) {
  const points3D = intersectWithContours(traces, contours, tol)
  const plane = fitPlane(points3D)

  // Reparto en dominios estructurales: cada uno es un tramo de la superficie con
  // un manteo, de modo que un pliegue se resuelve limbo a limbo y dos ondas de
  // un mismo tren no comparten contornos.
  const zTol = domainTolerance(points3D, tol)
  const dom = structuralDomains(points3D, { zTol })
  const index = new Map(points3D.map((p, i) => [p, dom.labels[i]]))
  const limbOf = points3D.length ? (p) => index.get(p) ?? 0 : null
  const limbCount = dom.count
  const domainAttitudes = dom.planes.map((pl, k) =>
    pl
      ? { ...attitudeFromPlane(pl), n: dom.groups[k].length, rms: pl.rms }
      : { n: dom.groups[k]?.length || 0, rms: null }
  )
  const folded = domainAttitudes.filter((d) => d.dip != null).length > 1

  // Ajuste local móvil: da la orientación en cualquier punto y permite que la
  // superficie se pliegue manteniendo la continuidad. Se apoya en el plano del
  // dominio de cada zona, no en el plano global.
  const basePlaneAt = domainPlaneField(dom.groups, dom.planes, plane)
  const mls = points3D.length >= 6 ? buildMls(points3D, basePlaneAt) : null

  const scs = structureContours(points3D, tol, limbOf)
  const usable = scs.filter((s) => s.fit)
  const pairs = []
  // Los pares se forman dentro de cada limbo, entre cotas consecutivas.
  const byLimb = new Map()
  for (const sc of usable) {
    if (!byLimb.has(sc.limb)) byLimb.set(sc.limb, [])
    byLimb.get(sc.limb).push(sc)
  }
  for (const list of byLimb.values()) {
    list.sort((a, b) => a.elevation - b.elevation)
    for (let i = 1; i < list.length; i++) {
      const a = attitudeBetween(list[i - 1], list[i])
      if (a) pairs.push({ ...a, limb: list[i].limb })
    }
  }

  let mean = null
  if (manual && Number.isFinite(manual.dip) && Number.isFinite(manual.dipDir)) {
    mean = { dip: manual.dip, dipDir: norm360(manual.dipDir), manual: true, ...formatAttitude(norm360(manual.dipDir), manual.dip) }
  } else if (pairs.length) {
    // En una superficie plegada no hay una actitud media: promediar los polos de
    // dos limbos opuestos da un manteo que no existe en el mapa. Se toma como
    // representativa la del dominio con más datos, y las demás se publican en
    // `domainAttitudes`.
    const dominant = dom.groups.reduce(
      (best, g, k) => (dom.planes[k] && g.length > (dom.groups[best]?.length || 0) ? k : best),
      -1
    )
    const used = folded && dominant >= 0 ? pairs.filter((p) => p.limb === dominant) : pairs
    const sample = used.length ? used : pairs
    // Promedio vectorial de los polos para no sesgar con la ambigüedad angular.
    let sx = 0
    let sy = 0
    let sz = 0
    for (const p of sample) {
      const t = p.dipDir * RAD
      const d = p.dip * RAD
      sx += Math.sin(t) * Math.sin(d)
      sy += Math.cos(t) * Math.sin(d)
      sz += Math.cos(d)
    }
    const l = Math.hypot(sx, sy, sz) || 1
    const dip = Math.acos(Math.min(1, Math.max(-1, sz / l))) * DEG
    const dipDir = azimuthWorld([sx, sy])
    // El RMS que se muestra es el del dominio, no el del plano global: con la
    // superficie repartida en limbos, el ajuste global no mide nada real.
    mean = {
      dip,
      dipDir,
      ...formatAttitude(dipDir, dip),
      limb: dominant >= 0 ? dominant : null,
      rms: dominant >= 0 ? dom.planes[dominant].rms : plane?.rms,
    }
  } else if (plane) {
    mean = attitudeFromPlane(plane)
  }

  // Eje de referencia: dirección de manteo media (positiva hacia cotas menores).
  let axis = null
  if (mean) {
    const t = mean.dipDir * RAD
    axis = [Math.sin(t), Math.cos(t)]
  } else if (usable.length) {
    axis = norm(perp(usable[0].fit.dir))
  }

  // Posición de cada contorno a lo largo del eje de manteo.
  const nodes = usable
    .map((s) => ({
      elevation: s.elevation,
      c: s.fit.c,
      dir: s.fit.dir,
      n: norm(perp(s.fit.dir)),
      s: axis ? dot(s.fit.c, axis) : 0,
    }))
    .sort((a, b) => a.s - b.s)
  for (const nd of nodes) {
    // Normal orientada según el eje (mismo sentido para todos los contornos).
    if (axis && dot(nd.n, axis) < 0) nd.n = [-nd.n[0], -nd.n[1]]
  }

  const origin = points3D.length
    ? [
        points3D.reduce((a, p) => a + p[0], 0) / points3D.length,
        points3D.reduce((a, p) => a + p[1], 0) / points3D.length,
        points3D.reduce((a, p) => a + p[2], 0) / points3D.length,
      ]
    : null

  const tanDip = mean ? Math.tan(mean.dip * RAD) : 0

  function elevationAt(x, y) {
    // El ajuste local móvil es el modelo preferente: es continuo, sigue los
    // pliegues y con datos planos reproduce exactamente el plano.
    if (mls && !manual) return mls.evaluate(x, y).z
    if (nodes.length >= 2) {
      const s = dot([x, y], axis)
      if (s <= nodes[0].s) {
        const g = gradient(0)
        return nodes[0].elevation + g * (s - nodes[0].s)
      }
      if (s >= nodes[nodes.length - 1].s) {
        const g = gradient(nodes.length - 2)
        const last = nodes[nodes.length - 1]
        return last.elevation + g * (s - last.s)
      }
      for (let i = 1; i < nodes.length; i++) {
        if (s <= nodes[i].s) {
          const A = nodes[i - 1]
          const B = nodes[i]
          // Interpolación por distancias perpendiculares a cada contorno:
          // respeta contornos no paralelos (manteo variable).
          const da = dot(sub([x, y], A.c), A.n)
          const db = dot(sub([x, y], B.c), B.n)
          let t
          if (da >= 0 && db <= 0 && da - db > 1e-9) t = da / (da - db)
          else t = (s - A.s) / (B.s - A.s || 1e-9)
          t = Math.max(-0.5, Math.min(1.5, t))
          return A.elevation + (B.elevation - A.elevation) * t
        }
      }
    }
    if (nodes.length === 1 && mean) {
      const A = nodes[0]
      const d = dot(sub([x, y], A.c), axis)
      return A.elevation - tanDip * d
    }
    if (origin && mean) {
      const d = dot(sub([x, y], [origin[0], origin[1]]), axis)
      return origin[2] - tanDip * d
    }
    if (plane) return plane.a * x + plane.b * y + plane.c
    return null
  }

  function gradient(i) {
    const A = nodes[i]
    const B = nodes[i + 1]
    if (!A || !B) return -tanDip
    const ds = B.s - A.s
    if (Math.abs(ds) < 1e-9) return -tanDip
    return (B.elevation - A.elevation) / ds
  }

  const quality = points3D.length === 0
    ? 'sin-datos'
    : usable.length >= 2
      ? 'ok'
      : manual
        ? 'manual'
        : usable.length === 1
          ? 'una-cota'
          : 'insuficiente'

  const attitudeAt = mls
    ? (x, y) => {
        const m = mls.evaluate(x, y)
        return attitudeFromGradient(m.a, m.b)
      }
    : () => mean

  return {
    name,
    color,
    points3D,
    mls,
    limbCount,
    domains: dom,
    domainAttitudes,
    folded,
    attitudeAt,
    structureContours: scs,
    pairs,
    mean,
    plane,
    axis,
    nodes,
    quality,
    defined: Boolean(mean || plane || nodes.length),
    elevationAt,
  }
}

/**
 * Segmento dibujable de un contorno estructural: la recta ajustada, extendida un
 * poco más allá de los puntos que la definen (y, si se da un rectángulo,
 * recortada a él).
 */
export function contourSegment(sc, rect = null, extend = 0.15) {
  if (!sc.fit) return null
  const span = Math.max(sc.tmax - sc.tmin, 1e-6)
  const pad = span * extend
  const a = [sc.fit.c[0] + sc.fit.dir[0] * (sc.tmin - pad), sc.fit.c[1] + sc.fit.dir[1] * (sc.tmin - pad)]
  const b = [sc.fit.c[0] + sc.fit.dir[0] * (sc.tmax + pad), sc.fit.c[1] + sc.fit.dir[1] * (sc.tmax + pad)]
  if (!rect) return [a, b]
  return clipLineToRect(sc.fit.c, sc.fit.dir, rect) || [a, b]
}

/** Manteo aparente sobre un plano vertical de azimut dado. */
export function apparentDip(dipDeg, dipDirDeg, sectionAzimuthDeg) {
  const theta = (dipDirDeg - sectionAzimuthDeg) * RAD
  return Math.atan(Math.tan(dipDeg * RAD) * Math.abs(Math.cos(theta))) * DEG
}
