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
import { structuralDomains, domainPlaneField, completeDomainPlanes } from './domains.js'

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

/**
 * Agrupa los puntos 3D por cota y ajusta una recta a cada grupo.
 *
 * `keyOf` separa además grupos que comparten cota y limbo: es lo que mantiene
 * a cada contorno estructural puesto a mano como una curva propia, aunque el
 * reparto en dominios lo asigne al mismo limbo que otro.
 */
export function structureContours(points3D, tol = 1, limbOf = null, keyOf = null) {
  const byZ = new Map()
  for (const p of points3D) {
    // Con `limbOf` los puntos de una misma cota se separan por limbo: en un
    // pliegue, ajustar una sola recta a los dos flancos promediaría a través
    // de la charnela y daría un rumbo que no existe.
    const limb = limbOf ? limbOf(p) : 0
    const manualId = (keyOf && keyOf(p)) || null
    const key = `${p[2]}|${limb}|${manualId || ''}`
    let arr = byZ.get(key)
    if (!arr) byZ.set(key, (arr = { elevation: p[2], limb, manualId, pts: [] }))
    arr.pts.push([p[0], p[1]])
  }
  const out = []
  for (const group of byZ.values()) {
    const { elevation, limb, manualId } = group
    const pts = group.pts
    if (pts.length < 2) {
      out.push({ elevation, limb, manualId, points: pts, fit: null, n: pts.length })
      continue
    }
    const fit = fitLine(pts)
    if (!fit || fit.spread < tol * 1.5) {
      // Puntos prácticamente coincidentes: no definen una dirección de rumbo.
      out.push({ elevation, limb, manualId, points: pts, fit: null, n: pts.length })
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
    out.push({ elevation, limb, manualId, points: pts, fit, tmin, tmax, n: pts.length })
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
    // El manteo sale de un contorno puesto a mano: conviene que se note en la
    // tabla, porque es una decisión del estudiante y no una medida del mapa.
    manual: Boolean(lo.manualId || hi.manualId),
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
 * Escala del problema: la separación típica entre contornos estructurales,
 * medida como la distancia al punto de *otra* cota más cercano. Es la anchura
 * mínima que puede tener una charnela sin inventar detalle: entre dos contornos
 * consecutivos no hay ningún dato, así que nada más fino que eso está medido.
 */
function contourSpacing(points3D) {
  const d = []
  for (let i = 0; i < points3D.length; i++) {
    let best = Infinity
    for (let j = 0; j < points3D.length; j++) {
      if (points3D[j][2] === points3D[i][2]) continue
      const v = Math.hypot(points3D[j][0] - points3D[i][0], points3D[j][1] - points3D[i][1])
      if (v < best) best = v
    }
    if (Number.isFinite(best)) d.push(best)
  }
  if (!d.length) return null
  d.sort((a, b) => a - b)
  return d[d.length >> 1] || null
}

/**
 * Corrección local sobre una tendencia: ajuste local móvil de los residuos,
 * con peso gaussiano y ancho `h` fijo. Sin singularidad en el dato a propósito
 * —un peso que tiende a infinito hace que el ajuste salte de un punto al
 * siguiente y es justo lo que arruga la superficie—, y con ancho constante,
 * porque un ancho que cambie de un sitio a otro traslada sus propios quiebros
 * a la superficie.
 *
 * `rel` marca qué datos son fiables: un punto que contradice a todos sus vecinos
 * pesa casi nada y deja de arrastrar la superficie hacia sí.
 */
const ZERO = { z: 0, a: 0, b: 0 }

function residualField(points3D, residuals, rel, h, mu = 0.25) {
  let any = false
  for (const r of residuals) {
    if (Math.abs(r) > 1e-9) {
      any = true
      break
    }
  }
  // Datos que ya están sobre la tendencia: no hay nada que corregir y la
  // superficie se queda exactamente en ella.
  if (!any) return () => ZERO
  const h2 = h * h
  const lambda = 1e-9
  return (x, y) => {
    let m00 = lambda
    let m01 = 0
    let m02 = 0
    let m11 = lambda
    let m12 = 0
    let m22 = lambda
    let r0 = 0
    let r1 = 0
    let r2 = 0
    let wsum = 0
    let raw = 0
    for (let i = 0; i < points3D.length; i++) {
      const dx = points3D[i][0] - x
      const dy = points3D[i][1] - y
      const q = (dx * dx + dy * dy) / h2
      if (q > 30) continue
      const g = Math.exp(-q)
      raw += g
      const w = g * rel[i]
      if (w < 1e-14) continue
      wsum += w
      m00 += w * dx * dx
      m01 += w * dx * dy
      m02 += w * dx
      m11 += w * dy * dy
      m12 += w * dy
      m22 += w
      r0 += w * dx * residuals[i]
      r1 += w * dy * residuals[i]
      r2 += w * residuals[i]
    }
    if (wsum < 1e-9 || raw < 1e-12) return ZERO
    // Sin esto, unos pocos puntos alineados sobre una traza dictarían una
    // pendiente transversal que no está medida.
    const tau = mu * m22 * h2
    m00 += tau
    m11 += tau
    const sol = solve3(
      [
        [m00, m01, m02],
        [m01, m11, m12],
        [m02, m12, m22],
      ],
      [r0, r1, r2]
    )
    if (!sol) return ZERO
    // Fiabilidad media de lo que se ve desde aquí. Donde los únicos datos al
    // alcance son los que se contradicen, la corrección se apaga y la
    // superficie se queda en la tendencia en vez de ir a buscarlos: si no, en
    // las pasadas finas —tan estrechas que no alcanzan ningún otro dato— un
    // dato imposible acabaría mandando él solo.
    const trust = wsum / raw
    return { z: sol[2] * trust, a: sol[0] * trust, b: sol[1] * trust }
  }
}

/** Mediana de valores absolutos: escala típica de un residuo, sin que un dato disparatado la infle. */
function mad(values) {
  const a = values.map(Math.abs).sort((p, q) => p - q)
  return a[a.length >> 1] || 0
}

/**
 * Salto típico entre cotas de los datos —en la práctica, el intervalo entre
 * curvas de nivel—. Es la resolución vertical del ejercicio: por debajo de eso
 * no hay forma de saber si dos observaciones se contradicen o simplemente caen
 * entre dos curvas.
 */
function elevationStep(points3D) {
  const zs = [...new Set(points3D.map((p) => p[2]))].sort((a, b) => a - b)
  if (zs.length < 2) return 0
  const gaps = []
  for (let i = 1; i < zs.length; i++) gaps.push(zs[i] - zs[i - 1])
  gaps.sort((a, b) => a - b)
  return gaps[gaps.length >> 1] || 0
}

// Anchura de la charnela y de las pasadas de corrección, en unidades de la
// separación entre contornos. La charnela se redondea en aproximadamente un
// intervalo de contornos, que es lo más fino que los datos resuelven; las dos
// pasadas —primero ancha, luego estrecha— recuperan lo que la tendencia no
// explica sin volver a rizar la superficie.
const HINGE = 1.0
const PASSES = [1.2, 0.6]
// A partir de cuántas desviaciones un dato se considera en contradicción con
// sus vecinos. Generoso: se trata de no dejar que un dato imposible pegue un
// tirón a toda su vecindad, no de descartar datos buenos.
const OUTLIER = 4

/**
 * Modelo de una superficie plegada: la forma del pliegue más lo que los datos
 * corrigen sobre ella.
 *
 * La *tendencia* es la mezcla de los planos de los dominios estructurales
 * (domains.js): limbos planos que se funden en las charnelas. Sobre ella se
 * añaden dos pasadas de corrección local con los residuos, cada vez más
 * estrechas, de modo que la superficie acaba pasando por los datos.
 *
 * Se hace en dos piezas y no de una vez porque un ajuste local que tenga que
 * reproducir él solo toda la amplitud del pliegue oscila entre dato y dato: la
 * superficie sale ondulada dentro de limbos que son planos, y esas ondas se ven
 * como bollos en las charnelas. Con la geometría del pliegue ya puesta por la
 * tendencia, los residuos son pequeños y su corrección no puede rizar nada.
 *
 * Devuelve `{ z, a, b }`: cota y gradiente local, con `z = a·x + b·y + c` cerca
 * del punto consultado.
 */
export function buildFoldModel(points3D, trend, spacing) {
  const n = points3D.length
  if (n < 4 || !trend) return null
  const s = spacing || 1
  const trendAt = (x, y) => {
    const g = trend(x, y)
    return g ? g.a * x + g.b * y + g.c : NaN
  }
  let res = points3D.map((p) => {
    const z = trendAt(p[0], p[1])
    return Number.isFinite(z) ? p[2] - z : 0
  })
  // Un dato que se aparta muchísimo de la tendencia no puede ser cierto a la vez
  // que sus vecinos: dos observaciones de la misma superficie separadas 200 m en
  // cota y 40 m en el mapa se contradicen, y hacer pasar la superficie por las
  // dos obliga a un pico. El umbral se mide contra la dispersión típica de los
  // propios residuos, de modo que sólo marca lo que se sale del conjunto, y es
  // deliberadamente generoso: se trata de no dejar que un dato imposible arrastre
  // a toda su vecindad, no de descartar datos buenos.
  //
  // Es un peso por dato, constante: no interviene en la suavidad de la
  // superficie, sólo en cuánto tira cada observación.
  // Nunca por debajo de un intervalo de curvas de nivel: separaciones menores
  // que eso no son contradicciones, es la resolución del ejercicio.
  const limit = Math.max(OUTLIER * mad(res) * 1.4826, elevationStep(points3D), 1e-6)
  const rel = res.map((r) => (Math.abs(r) > limit ? 0.02 : 1))
  const layers = []
  for (const k of PASSES) {
    const layer = residualField(points3D, res, rel, s * k)
    layers.push(layer)
    res = points3D.map((p, i) => res[i] - layer(p[0], p[1]).z)
  }
  return {
    n,
    evaluate: (x, y) => {
      const g = trend(x, y)
      if (!g) return { z: NaN, a: 0, b: 0 }
      let z = g.a * x + g.b * y + g.c
      let a = g.a
      let b = g.b
      for (const layer of layers) {
        const r = layer(x, y)
        z += r.z
        a += r.a
        b += r.b
      }
      return { z, a, b }
    },
  }
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
/**
 * Puntos con los que un contorno estructural puesto a mano entra en el motor.
 * Es una recta de cota conocida sobre la superficie, así que se muestrea en
 * unos pocos puntos que valen exactamente lo mismo que un cruce con una curva
 * de nivel: el resto del cálculo no necesita saber de dónde vienen.
 */
const SC_SAMPLES = 5

function sampleManualContour(mc) {
  const [a, b] = [mc.a, mc.b]
  const out = []
  for (let i = 0; i < SC_SAMPLES; i++) {
    const t = i / (SC_SAMPLES - 1)
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, mc.elevation])
  }
  return out
}

/**
 * @param manualContours [{ id, elevation, a, b }] contornos puestos a mano, en
 *   coordenadas mundo. En las cotas que tocan sustituyen a los datos calculados:
 *   el estudiante toma el control de esa curva y el motor deja de discutirla.
 */
export function buildSurface({
  traces,
  contours,
  manual = null,
  manualContours = [],
  name = '',
  color = '#000',
  tol = 1,
}) {
  const measured = intersectWithContours(traces, contours, tol)
  const overridden = new Set(manualContours.map((m) => m.elevation))
  const manualIdOf = new Map()
  const drawn = []
  for (const mc of manualContours) {
    for (const p of sampleManualContour(mc)) {
      manualIdOf.set(p, mc.id)
      drawn.push(p)
    }
  }
  const points3D = overridden.size
    ? [...measured.filter((p) => !overridden.has(p[2])), ...drawn]
    : measured
  const keyOf = manualIdOf.size ? (p) => manualIdOf.get(p) || null : null
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

  // Modelo de la superficie: la forma del pliegue que dan los dominios, afinada
  // con los datos. Da la orientación en cualquier punto y deja que la superficie
  // se pliegue manteniendo la continuidad.
  const spacing = contourSpacing(points3D)
  const domPlanes = completeDomainPlanes(dom.groups, dom.planes, plane)
  const basePlaneAt = domainPlaneField(dom.groups, domPlanes, plane, (spacing || 1) * HINGE)
  const model = points3D.length >= 6 ? buildFoldModel(points3D, basePlaneAt, spacing) : null

  const scs = structureContours(points3D, tol, limbOf, keyOf)
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
    // El modelo del pliegue es el preferente: es continuo, sigue los pliegues y
    // con datos planos reproduce exactamente el plano.
    if (model && !manual) return model.evaluate(x, y).z
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

  // Paso de las diferencias finitas cuando la superficie no tiene modelo de
  // pliegue: lo bastante ancho para que el gradiente no lea el ruido del ajuste.
  const gradStep = Math.max(tol * 4, 1e-6)

  /**
   * Cota y gradiente local de la superficie en un punto, `{ z, a, b }` con
   * `z = a·x + b·y + c` localmente. El modelo del pliegue da las dos cosas de
   * una sola pasada; sin él, el gradiente sale por diferencias finitas. Es lo
   * que necesita una superficie paralela para desplazarse un espesor
   * perpendicular constante (parallel.js).
   */
  function sampleAt(x, y) {
    if (model && !manual) {
      const m = model.evaluate(x, y)
      return { z: m.z, a: m.a, b: m.b }
    }
    const z = elevationAt(x, y)
    if (!Number.isFinite(z)) return { z: null, a: 0, b: 0 }
    const xp = elevationAt(x + gradStep, y)
    const xm = elevationAt(x - gradStep, y)
    const yp = elevationAt(x, y + gradStep)
    const ym = elevationAt(x, y - gradStep)
    return {
      z,
      a: Number.isFinite(xp) && Number.isFinite(xm) ? (xp - xm) / (2 * gradStep) : 0,
      b: Number.isFinite(yp) && Number.isFinite(ym) ? (yp - ym) / (2 * gradStep) : 0,
    }
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

  const attitudeAt = model
    ? (x, y) => {
        const m = model.evaluate(x, y)
        return attitudeFromGradient(m.a, m.b)
      }
    : () => mean

  return {
    name,
    color,
    traces,
    manualContours,
    points3D,
    model,
    gradStep,
    sampleAt,
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
