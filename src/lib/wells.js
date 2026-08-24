// Pozos: trayectoria (trend/plunge), intersección con contactos y fallas, y
// columna estratigráfica esperada en el punto del pozo.

import { toWorld } from './georef.js'

const RAD = Math.PI / 180

/** Vector unitario de la trayectoria en coordenadas mundo (z positivo hacia arriba). */
export function wellDirection(trendDeg, plungeDeg) {
  const t = trendDeg * RAD
  const p = plungeDeg * RAD
  return [Math.sin(t) * Math.cos(p), Math.cos(t) * Math.cos(p), -Math.sin(p)]
}

function contactElevationsAt(scene, x, y) {
  const out = []
  for (const c of scene.contacts) {
    const surf = scene.contactSurfaceAt(c.id, x, y)
    if (!surf || !surf.defined) {
      out.push({ contact: c, z: null, surf: null })
      continue
    }
    const z = surf.elevationAt(x, y)
    out.push({ contact: c, z: Number.isFinite(z) ? z : null, surf })
  }
  return out
}

/** Unidad estratigráfica en un punto, dadas las cotas de los contactos. */
function unitAt(scene, elevs, z) {
  const defined = elevs.filter((e) => e.z != null)
  if (!defined.length) return scene.units[scene.units.length - 1] || null
  let unitId = null
  for (const e of defined) {
    if (z >= e.z) unitId = e.contact.upperUnitId
  }
  if (unitId == null) unitId = defined[0].contact.lowerUnitId
  return scene.units.find((u) => u.id === unitId) || null
}

export function buildWellModel(well, scene) {
  const p0 = toWorld(scene.georef, well.at)
  const z0 = scene.dem.elevationAt(p0[0], p0[1])
  const dir = wellDirection(well.trend, Math.max(1, Math.min(90, well.plunge)))
  const depth = Math.max(1, well.depth)
  const n = 400
  const path = []
  for (let i = 0; i <= n; i++) {
    const md = (depth * i) / n
    path.push({
      md,
      x: p0[0] + dir[0] * md,
      y: p0[1] + dir[1] * md,
      z: z0 + dir[2] * md,
      tvd: z0 - (z0 + dir[2] * md),
    })
  }

  // Intersecciones con contactos y fallas por cambio de signo de (z_pozo − z_superficie).
  const markers = []
  const crossFor = (id, kind, meta) => {
    let prev = null
    for (const s of path) {
      const surf =
        kind === 'contacto' ? scene.contactSurfaceAt(id, s.x, s.y) : scene.faultSurfaces.get(id)
      if (!surf || !surf.defined) {
        prev = null
        continue
      }
      const zs = surf.elevationAt(s.x, s.y)
      if (!Number.isFinite(zs)) {
        prev = null
        continue
      }
      const f = s.z - zs
      if (prev && prev.f * f <= 0 && Math.abs(prev.f - f) > 1e-9) {
        const t = prev.f / (prev.f - f)
        const md = prev.md + (s.md - prev.md) * t
        const z = prev.z + (s.z - prev.z) * t
        markers.push({
          kind,
          id,
          md,
          z,
          tvd: z0 - z,
          attitude: surf.mean || null,
          ...meta,
        })
      }
      prev = { f, md: s.md, z: s.z }
    }
  }
  for (const c of scene.contacts) crossFor(c.id, 'contacto', { name: c.name, color: c.color, contact: c })
  for (const f of scene.project.faults) {
    if (scene.faultSurfaces.has(f.id)) crossFor(f.id, 'falla', { name: f.name, kinematics: f.kinematics, fault: f })
  }
  markers.sort((a, b) => a.md - b.md)

  // Columna: se recorre la trayectoria clasificando cada tramo.
  const column = []
  let current = null
  for (const s of path) {
    const elevs = contactElevationsAt(scene, s.x, s.y)
    const unit = unitAt(scene, elevs, s.z)
    const key = unit ? unit.id : '∅'
    if (!current || current.key !== key) {
      if (current) current.mdBot = s.md
      current = {
        key,
        unitId: unit?.id || null,
        name: unit?.name || 'Sin unidad definida',
        color: unit?.color || '#94a3b8',
        lithology: unit?.lithology || '',
        mdTop: s.md,
        mdBot: depth,
      }
      column.push(current)
    }
  }
  for (const seg of column) {
    seg.tvdTop = -dir[2] * seg.mdTop
    seg.tvdBot = -dir[2] * seg.mdBot
    seg.zTop = z0 + dir[2] * seg.mdTop
    seg.zBot = z0 + dir[2] * seg.mdBot
    seg.thicknessMd = seg.mdBot - seg.mdTop
  }

  // Espesor real (perpendicular a las capas) usando la actitud del contacto basal.
  for (let i = 0; i < column.length; i++) {
    const seg = column[i]
    const marker = markers.find((m) => m.kind === 'contacto' && Math.abs(m.md - seg.mdBot) < depth / n + 1e-6)
    const att = marker?.attitude || markers.find((m) => m.kind === 'contacto')?.attitude
    if (att) {
      const nrm = [
        Math.sin(att.dipDir * RAD) * Math.sin(att.dip * RAD),
        Math.cos(att.dipDir * RAD) * Math.sin(att.dip * RAD),
        Math.cos(att.dip * RAD),
      ]
      const cosA = Math.abs(dir[0] * nrm[0] + dir[1] * nrm[1] + dir[2] * nrm[2])
      seg.thicknessTrue = seg.thicknessMd * cosA
    }
  }

  return {
    id: well.id,
    name: well.name,
    well,
    surface: [p0[0], p0[1], z0],
    dir,
    depth,
    path,
    markers,
    column,
    bottom: {
      x: p0[0] + dir[0] * depth,
      y: p0[1] + dir[1] * depth,
      z: z0 + dir[2] * depth,
      tvd: -dir[2] * depth,
    },
  }
}
