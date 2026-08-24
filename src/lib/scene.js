// Construye la "escena geológica": convierte todo el proyecto a coordenadas de
// terreno (metros) y resuelve las superficies (contactos y fallas) por bloque
// estructural, el modelo de elevación y las estadísticas para el panel de
// resultados. Es la única capa que conoce a la vez el modelo de datos y el motor.

import { toWorldList, toWorld } from './georef.js'
import { buildSurface } from './structure.js'
import { buildBlocks, singleBlock } from './blocks.js'
import { buildDem } from './dem.js'
import { resample, polylineIntersections, dist, bboxOf } from './geom.js'
import { sortedUnits, sortedContacts } from './model.js'

/** Corta una polilínea allí donde la cruza una falla. */
export function splitByFaults(pts, faultPolys) {
  if (pts.length < 2 || faultPolys.length === 0) return [pts]
  const cuts = []
  for (const f of faultPolys) {
    for (const hit of polylineIntersections(pts, f)) cuts.push({ i: hit.ia, t: hit.ta, p: hit.p })
  }
  if (!cuts.length) return [pts]
  cuts.sort((a, b) => a.i - b.i || a.t - b.t)
  const parts = []
  let current = []
  let ci = 0
  for (let i = 0; i < pts.length - 1; i++) {
    current.push(pts[i])
    while (ci < cuts.length && cuts[ci].i === i) {
      current.push(cuts[ci].p)
      if (current.length >= 2) parts.push(current)
      current = [cuts[ci].p]
      ci++
    }
  }
  current.push(pts[pts.length - 1])
  if (current.length >= 2) parts.push(current)
  // Se recortan los extremos pegados a la falla para que el voto de bloque
  // no quede sobre la propia traza.
  return parts.map((part) => trimEnds(part)).filter((p) => p.length >= 2)
}

function trimEnds(pts) {
  const total = pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : 0), 0)
  const cut = Math.min(total * 0.08, total / 4)
  if (cut <= 0) return pts
  const out = []
  let acc = 0
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) acc += dist(pts[i - 1], pts[i])
    if (acc >= cut && acc <= total - cut) out.push(pts[i])
  }
  return out.length >= 2 ? out : pts
}

/** Prolonga una polilínea por sus dos extremos siguiendo la tangente. */
export function extendPolyline(pts, amount) {
  if (pts.length < 2 || amount <= 0) return pts
  const dirAt = (a, b) => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const l = Math.hypot(dx, dy) || 1
    return [dx / l, dy / l]
  }
  const d0 = dirAt(pts[1], pts[0])
  const d1 = dirAt(pts[pts.length - 2], pts[pts.length - 1])
  return [
    [pts[0][0] + d0[0] * amount, pts[0][1] + d0[1] * amount],
    ...pts,
    [pts[pts.length - 1][0] + d1[0] * amount, pts[pts.length - 1][1] + d1[1] * amount],
  ]
}

export function buildScene(project) {
  const georef = project.georef
  const ready = Boolean(georef?.metersPerPx)
  const mpp = georef?.metersPerPx || 1

  const worldContours = project.contours
    .filter((c) => c.pts.length >= 2 && Number.isFinite(c.elevation))
    .map((c) => ({ id: c.id, elevation: c.elevation, pts: toWorldList(georef, c.pts) }))

  const faultWorld = project.faults.map((f) => ({
    id: f.id,
    fault: f,
    traces: f.traces.filter((t) => t.pts.length >= 2).map((t) => toWorldList(georef, t.pts)),
  }))
  const faultPolys = faultWorld.flatMap((f) => f.traces)

  const contactWorld = project.contacts.map((c) => ({
    id: c.id,
    contact: c,
    traces: c.traces.filter((t) => t.pts.length >= 2).map((t) => toWorldList(georef, t.pts)),
  }))

  // Extensión de trabajo: imagen completa (si la hay) + toda la geometría.
  const lists = [
    ...worldContours.map((c) => c.pts),
    ...faultPolys,
    ...contactWorld.flatMap((c) => c.traces),
  ]
  const mapRect = project.image || project.virtualSize
  if (mapRect) {
    const { width, height } = mapRect
    lists.push([
      toWorld(georef, [0, 0]),
      toWorld(georef, [width, 0]),
      toWorld(georef, [0, height]),
      toWorld(georef, [width, height]),
    ])
  }
  for (const w of project.wells) lists.push([toWorld(georef, w.at)])
  for (const s of project.sections) lists.push([toWorld(georef, s.a), toWorld(georef, s.b)])
  const bbox = bboxOf(lists) || { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }
  const side = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) || 1000
  const tol = Math.max(mpp * 2.5, side * 0.0008)

  // Para partir el mapa en bloques se prolongan un poco las trazas de falla:
  // así un trazo que no llega exactamente al borde igual separa los bloques.
  const cell = project.settings.blockCell || side / 220
  const extended = faultPolys.map((pts) => extendPolyline(pts, Math.max(side * 0.04, cell * 3)))
  const blocks = faultPolys.length ? buildBlocks(extended, bbox, cell) : singleBlock()

  // Superficies de contacto, resueltas bloque a bloque.
  const contactSurfaces = new Map()
  for (const cw of contactWorld) {
    const byBlock = new Map()
    const pieces = []
    for (const tr of cw.traces) {
      for (const part of splitByFaults(tr, faultPolys)) {
        pieces.push({ pts: part, block: blocks.blockOfPolyline(part) })
      }
    }
    for (const piece of pieces) {
      if (!byBlock.has(piece.block)) byBlock.set(piece.block, [])
      byBlock.get(piece.block).push(piece.pts)
    }
    const surfaces = new Map()
    for (const [block, traces] of byBlock) {
      surfaces.set(
        block,
        buildSurface({
          traces,
          contours: worldContours,
          manual: cw.contact.manual,
          name: cw.contact.name,
          tol,
        })
      )
    }
    contactSurfaces.set(cw.id, surfaces)
  }

  // Superficies de falla: se resuelven con todas sus trazas juntas.
  const faultSurfaces = new Map()
  for (const fw of faultWorld) {
    if (!fw.traces.length) continue
    faultSurfaces.set(
      fw.id,
      buildSurface({
        traces: fw.traces,
        contours: worldContours,
        manual: fw.fault.manual,
        name: fw.fault.name,
        tol,
      })
    )
  }

  // Modelo de elevación a partir de las curvas.
  const res = project.settings.demResolution || 120
  const step = Math.max(side / res / 2, tol)
  const levels = worldContours.map((c) => ({ elevation: c.elevation, samples: resample(c.pts, step) }))
  const merged = new Map()
  for (const l of levels) {
    if (!merged.has(l.elevation)) merged.set(l.elevation, [])
    merged.get(l.elevation).push(...l.samples)
  }
  const dem = buildDem(
    [...merged.entries()].map(([elevation, samples]) => ({ elevation, samples })),
    bbox,
    res
  )

  const units = sortedUnits(project)
  const contacts = sortedContacts(project)

  return {
    ready,
    georef,
    bbox,
    side,
    tol,
    mpp,
    blocks,
    dem,
    worldContours,
    contactSurfaces,
    faultSurfaces,
    faultWorld,
    contactWorld,
    units,
    contacts,
    project,
    /** Superficie de un contacto en el bloque que corresponde a un punto. */
    contactSurfaceAt(contactId, x, y) {
      const byBlock = contactSurfaces.get(contactId)
      if (!byBlock || !byBlock.size) return null
      const b = blocks.blockAt(x, y)
      if (byBlock.has(b)) return byBlock.get(b)
      return null
    },
  }
}

/** Resumen para el panel de resultados. */
export function surfaceSummary(scene) {
  const rows = []
  for (const c of scene.contacts) {
    const byBlock = scene.contactSurfaces.get(c.id)
    if (!byBlock) continue
    for (const [block, surf] of byBlock) {
      rows.push({ kind: 'contacto', id: c.id, block, name: c.name, color: c.color, surf })
    }
  }
  for (const f of scene.project.faults) {
    const surf = scene.faultSurfaces.get(f.id)
    if (surf) rows.push({ kind: 'falla', id: f.id, block: null, name: f.name, kinematics: f.kinematics, surf })
  }
  return rows
}
