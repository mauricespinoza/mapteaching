// Motor de contornos estructurales.
//
// Cada horizonte (contacto geológico o traza de falla) es la intersección de una
// superficie con la topografía. Los puntos donde la traza cruza una curva de nivel
// son puntos de cota conocida sobre esa superficie: ajustando una recta a los
// puntos de igual cota se obtiene el *contorno estructural* de esa cota. Entre dos
// contornos consecutivos, el rumbo es la dirección de las rectas y el manteo
// sale de atan(Δcota / separación horizontal).

import { fitLine, fitPlane, polylineIntersections, dot, sub, norm, perp, clipLineToRect } from './geom.js'
import { azimuthWorld, formatAttitude, norm360 } from './georef.js'

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
export function structureContours(points3D, tol = 1) {
  const byZ = new Map()
  for (const p of points3D) {
    const key = p[2]
    let arr = byZ.get(key)
    if (!arr) byZ.set(key, (arr = []))
    arr.push([p[0], p[1]])
  }
  const out = []
  for (const [elevation, pts] of byZ) {
    if (pts.length < 2) {
      out.push({ elevation, points: pts, fit: null, n: pts.length })
      continue
    }
    const fit = fitLine(pts)
    if (!fit || fit.spread < tol * 1.5) {
      // Puntos prácticamente coincidentes: no definen una dirección de rumbo.
      out.push({ elevation, points: pts, fit: null, n: pts.length })
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
    out.push({ elevation, points: pts, fit, tmin, tmax, n: pts.length })
  }
  out.sort((a, b) => a.elevation - b.elevation)
  return out
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
 * Construye el modelo de una superficie geológica a partir de sus contornos
 * estructurales. `elevationAt(x, y)` interpola entre contornos consecutivos
 * (permite pliegues cilíndricos) y extrapola con el gradiente de los extremos.
 */
export function buildSurface({ traces, contours, manual = null, name = '', color = '#000', tol = 1 }) {
  const points3D = intersectWithContours(traces, contours, tol)
  const scs = structureContours(points3D, tol)
  const usable = scs.filter((s) => s.fit)
  const plane = fitPlane(points3D)
  const pairs = []
  for (let i = 1; i < usable.length; i++) {
    const a = attitudeBetween(usable[i - 1], usable[i])
    if (a) pairs.push(a)
  }

  let mean = null
  if (manual && Number.isFinite(manual.dip) && Number.isFinite(manual.dipDir)) {
    mean = { dip: manual.dip, dipDir: norm360(manual.dipDir), manual: true, ...formatAttitude(norm360(manual.dipDir), manual.dip) }
  } else if (pairs.length) {
    // Promedio vectorial de los polos para no sesgar con la ambigüedad angular.
    let sx = 0
    let sy = 0
    let sz = 0
    for (const p of pairs) {
      const t = p.dipDir * RAD
      const d = p.dip * RAD
      sx += Math.sin(t) * Math.sin(d)
      sy += Math.cos(t) * Math.sin(d)
      sz += Math.cos(d)
    }
    const l = Math.hypot(sx, sy, sz) || 1
    const dip = Math.acos(Math.min(1, Math.max(-1, sz / l))) * DEG
    const dipDir = azimuthWorld([sx, sy])
    mean = { dip, dipDir, ...formatAttitude(dipDir, dip) }
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

  return {
    name,
    color,
    points3D,
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
