// Regla del mapa: medir distancias sobre el mapa y, sobre todo, medirlas donde
// hay que medirlas. El ancho de un afloramiento sólo se convierte en espesor si
// se mide perpendicular al rumbo (e = L · sen δ); una separación entre contornos
// estructurales sólo da el manteo si es la separación perpendicular. Por eso el
// imán no sólo pega los extremos a las trazas: fija además la dirección normal
// a la traza en la que se ancla, de modo que lo que se lee ya es la ortogonal.

import { dist, dot, sub, norm, perp, pointPolyline, polylineIntersections } from './geom.js'
import { toWorld, azimuthImage } from './georef.js'

const RAD = Math.PI / 180

/** Todas las trazas digitalizadas a las que puede pegarse la regla. */
export function snapTargets(project) {
  const out = []
  const layers = project.settings?.layers || {}
  const open = (k) => !layers[k]?.locked
  if (open('contours')) {
    for (const c of project.contours) {
      if (c.pts.length >= 2) out.push({ kind: 'contour', id: c.id, name: `Curva ${c.elevation} m`, pts: c.pts })
    }
  }
  if (open('contacts')) {
    for (const c of project.contacts) {
      for (const tr of c.traces) {
        if (tr.pts.length >= 2) out.push({ kind: 'contact', id: c.id, traceId: tr.id, name: c.name, pts: tr.pts })
      }
    }
  }
  if (open('faults')) {
    for (const f of project.faults) {
      for (const tr of f.traces) {
        if (tr.pts.length >= 2) out.push({ kind: 'fault', id: f.id, traceId: tr.id, name: f.name, pts: tr.pts })
      }
    }
  }
  return out
}

/** Punto más cercano sobre alguna traza, con la tangente local. */
export function snapToLines(targets, p, tol) {
  let best = null
  for (const t of targets) {
    const r = pointPolyline(p, t.pts)
    if (r.d > tol || (best && r.d >= best.d)) continue
    const a = t.pts[r.i]
    const b = t.pts[r.i + 1] || t.pts[r.i]
    const dir = norm(sub(b, a))
    best = { ...t, at: r.proj, dir, d: r.d }
  }
  return best
}

/**
 * Extremo de la medida. Con imán, se obliga a que caiga sobre la normal a la
 * traza anclada; si esa normal cruza otra traza cerca, se pega al cruce, que es
 * justo lo que se busca al medir de un contacto al siguiente.
 */
export function measureEnd(targets, anchor, p, { snap, tol }) {
  if (!snap || !anchor?.dir) {
    const free = snapToLines(targets, p, snap ? tol : 0)
    return { at: free ? free.at : p, on: free || null, orthogonal: false }
  }
  const n = perp(anchor.dir)
  const s = dot(sub(p, anchor.at), n)
  let at = [anchor.at[0] + n[0] * s, anchor.at[1] + n[1] * s]
  // Cruce de la normal con otra traza, buscado a lo largo de todo el rayo.
  const far = [anchor.at[0] + n[0] * s * 1.35, anchor.at[1] + n[1] * s * 1.35]
  let on = null
  let bestD = tol
  for (const t of targets) {
    if (t.id === anchor.id && t.traceId === anchor.traceId) continue
    for (const hit of polylineIntersections([anchor.at, far], t.pts)) {
      const d = dist(hit.p, at)
      if (d < bestD) {
        bestD = d
        on = t
        at = hit.p
      }
    }
  }
  return { at, on, orthogonal: true }
}

/** Lectura completa de la regla, lista para mostrar. */
export function reading(project, scene, m) {
  if (!m?.a || !m?.b) return null
  const georef = project.georef
  const A = toWorld(georef, m.a)
  const B = toWorld(georef, m.b)
  const meters = dist(A, B)
  const v = sub(m.b, m.a)
  const calibrated = Boolean(georef?.metersPerPx)
  const azimuth = dist(m.a, m.b) > 1e-6 ? azimuthImage(georef, v) : null
  // Espesor verdadero: sólo tiene sentido si la medida es perpendicular al
  // rumbo del contacto en el que se ancló y ese contacto tiene manteo resuelto.
  let thickness = null
  if (m.orthogonal && m.anchor?.kind === 'contact' && scene?.ready) {
    const surf = scene.contactSurfaceAt(m.anchor.id, A[0], A[1])
    const att = surf?.attitudeAt ? surf.attitudeAt(A[0], A[1]) : surf?.mean
    if (att && Number.isFinite(att.dip)) {
      thickness = { dip: att.dip, value: meters * Math.sin(att.dip * RAD) }
    }
  }
  return { meters, pixels: dist(m.a, m.b), azimuth, calibrated, thickness }
}
