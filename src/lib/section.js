// Construcción de perfiles estructurales: topografía, geometría en profundidad
// de las unidades, fallas con su manteo aparente y pozos proyectados.

import { toWorld, azimuthWorld } from './georef.js'
import { dist, sub, dot, norm, polylineIntersections, pointSegment } from './geom.js'

const RAD = Math.PI / 180
const SAMPLES = 420

const contactBelow = (scene, unit) => scene.contacts.find((c) => c.upperUnitId === unit.id) || null
const contactAbove = (scene, unit) => scene.contacts.find((c) => c.lowerUnitId === unit.id) || null

/** Recorte de un polígono por un semiplano f(d,z) ≥ 0 (Sutherland–Hodgman). */
function clipHalfPlane(poly, f) {
  if (!poly.length) return poly
  const out = []
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]
    const prev = poly[(i - 1 + poly.length) % poly.length]
    const fc = f(cur[0], cur[1])
    const fp = f(prev[0], prev[1])
    if (fc >= 0) {
      if (fp < 0) out.push(intersectEdge(prev, cur, fp, fc))
      out.push(cur)
    } else if (fp >= 0) {
      out.push(intersectEdge(prev, cur, fp, fc))
    }
  }
  return out
}

function intersectEdge(a, b, fa, fb) {
  const t = fa / (fa - fb)
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

export function buildSectionModel(section, scene) {
  const georef = scene.georef
  const A = toWorld(georef, section.a)
  const B = toWorld(georef, section.b)
  const L = dist(A, B)
  if (!(L > 0)) return null
  const u = norm(sub(B, A))
  const azimuth = azimuthWorld(u)
  const at = (d) => [A[0] + u[0] * d, A[1] + u[1] * d]

  const n = SAMPLES
  const ds = []
  const topo = []
  const blockIds = []
  for (let i = 0; i < n; i++) {
    const d = (L * i) / (n - 1)
    const p = at(d)
    ds.push(d)
    topo.push(scene.dem.elevationAt(p[0], p[1]))
    blockIds.push(scene.blocks.blockAt(p[0], p[1]))
  }
  const topoMax = Math.max(...topo)
  const topoMin = Math.min(...topo)
  const bottom = topoMin - (section.depth || 2000)
  // Cada dominio se calcula un poco más allá de sus bordes: bajo una falla
  // inclinada, el bloque de un lado se mete por debajo del de enfrente y hay
  // que tener geometría suya para rellenar ese hueco.
  const margin = Math.min(L * 0.35, (topoMax - bottom) * 2)

  // ---- Fallas: intersección con la traza del perfil y manteo aparente ----
  const segAB = [A, B]
  const faultCrossings = []
  for (const fw of scene.faultWorld) {
    const surf = scene.faultSurfaces.get(fw.id)
    const att = surf?.mean
    for (const tr of fw.traces) {
      for (const hit of polylineIntersections(segAB, tr)) {
        const d = hit.ta * L
        const zSurface = scene.dem.elevationAt(hit.p[0], hit.p[1])
        const dip = att ? att.dip : 90
        const dipDir = att ? att.dipDir : azimuth + 90
        const k = Math.tan(Math.min(89.5, dip) * RAD) * Math.cos((dipDir - azimuth) * RAD)
        const appDip = (Math.atan(Math.abs(k)) * 180) / Math.PI
        faultCrossings.push({
          faultId: fw.id,
          fault: fw.fault,
          d,
          z: zSurface,
          k,
          dip,
          dipDir,
          apparentDip: appDip,
          surf,
        })
      }
    }
  }
  faultCrossings.sort((a, b) => a.d - b.d)

  // Cota del plano de falla a lo largo del perfil, tomada de la superficie que
  // resuelven sus contornos estructurales y no de una recta con el manteo medio:
  // el recorte de las unidades y la línea que se dibuja salen los dos de aquí,
  // así que en el perfil la falla y el corte que produce son la misma
  // superficie —y la misma que corta en 3D—. La superficie ya viene anclada a
  // la traza de la falla, así que aquí no hay que reajustar nada.
  const PN = 260
  const dSpan = L + 2 * margin
  for (const fc of faultCrossings) {
    const zs = new Float64Array(PN).fill(NaN)
    let any = false
    if (fc.surf?.defined) {
      for (let i = 0; i < PN; i++) {
        const p = at(-margin + (dSpan * i) / (PN - 1))
        const v = fc.surf.elevationAt(p[0], p[1])
        if (Number.isFinite(v)) {
          zs[i] = v
          any = true
        }
      }
    }
    const lookup = (d) => {
      const t = ((d + margin) / dSpan) * (PN - 1)
      const i = Math.max(0, Math.min(PN - 2, Math.floor(t)))
      const f = Math.max(0, Math.min(1, t - i))
      const a = zs[i]
      const b = zs[i + 1]
      if (!Number.isFinite(a)) return b
      if (!Number.isFinite(b)) return a
      return a + (b - a) * f
    }
    if (!any) {
      fc.zPlane = (d) => fc.z - fc.k * (d - fc.d)
      continue
    }
    fc.zPlane = lookup
  }

  // ---- Dominios: tramos del perfil con el mismo bloque estructural ----
  const domains = []
  let start = 0
  for (let i = 1; i <= n; i++) {
    if (i === n || blockIds[i] !== blockIds[start]) {
      domains.push({ blockId: blockIds[start], i0: start, i1: i - 1, d0: ds[start], d1: ds[i - 1] })
      start = i
    }
  }
  // Se asocia cada frontera de dominio con la falla que la produce.
  for (let i = 0; i < domains.length; i++) {
    const dom = domains[i]
    dom.left = i > 0 ? nearestCrossing(faultCrossings, dom.d0) : null
    dom.right = i < domains.length - 1 ? nearestCrossing(faultCrossings, dom.d1) : null
  }

  const boundaryFn = (crossing, insideD, insideZ) => {
    if (!crossing) return null
    // Con el plano casi paralelo al perfil el criterio «encima o debajo» no
    // discrimina —el corte apenas lo cruza—, y ahí lo sensato es cortar a plomo.
    const useDip = Math.abs(crossing.k) > Math.tan(8 * RAD)
    const f = useDip
      ? (d, z) => {
          const zp = crossing.zPlane(d)
          return Number.isFinite(zp) ? z - zp : crossing.k * (d - crossing.d) + (z - crossing.z)
        }
      : (d) => d - crossing.d
    const sign = Math.sign(f(insideD, insideZ)) || 1
    return (d, z) => sign * f(d, z)
  }

  // ---- Superficies de contacto por dominio ----
  const contactsOut = scene.contacts.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    type: c.type,
    lines: [],
    air: [],
  }))
  const contactIndex = new Map(contactsOut.map((c, i) => [c.id, i]))
  const unitsOut = scene.units.map((un) => ({ id: un.id, name: un.name, color: un.color, polys: [] }))
  const unitIndex = new Map(unitsOut.map((u, i) => [u.id, i]))

  for (const dom of domains) {
    const dStart = Math.max(-margin, dom.d0 - margin)
    const dEnd = Math.min(L + margin, dom.d1 + margin)
    const m = 160
    const dd = []
    const tz = []
    for (let i = 0; i < m; i++) {
      const d = dStart + ((dEnd - dStart) * i) / (m - 1)
      dd.push(d)
      const p = at(d)
      tz.push(scene.dem.elevationAt(p[0], p[1]))
    }
    const midD = (dom.d0 + dom.d1) / 2
    const midZ = scene.dem.elevationAt(at(midD)[0], at(midD)[1])
    const fLeft = boundaryFn(dom.left, midD, midZ)
    const fRight = boundaryFn(dom.right, midD, midZ)
    const clip = (poly) => {
      let p = poly
      if (fLeft) p = clipHalfPlane(p, fLeft)
      if (fRight && p.length) p = clipHalfPlane(p, fRight)
      return p
    }
    // Recorte de una polilínea (no cerrada) por los mismos semiplanos.
    const clipLine = (line) => {
      let segs = [line]
      for (const f of [fLeft, fRight]) {
        if (!f) continue
        const next = []
        for (const s of segs) {
          let cur = []
          for (let i = 0; i < s.length; i++) {
            const p = s[i]
            const v = f(p[0], p[1])
            if (v >= 0) cur.push(p)
            else if (cur.length) {
              const prev = s[i - 1]
              if (prev) cur.push(intersectEdge(prev, p, f(prev[0], prev[1]), v))
              if (cur.length >= 2) next.push(cur)
              cur = []
            }
          }
          if (cur.length >= 2) next.push(cur)
        }
        segs = next
      }
      return segs
    }

    // Elevación de cada contacto a lo largo del dominio. Se pide la pila
    // completa en cada punto —una sola vez para todos los contactos— para que
    // el perfil vea la misma serie que el mapa: sin contactos cruzados.
    // Se pide siempre la pila *de este bloque*, aunque el punto caiga en planta
    // sobre el bloque de al lado: más allá del borde del dominio es justo donde
    // este bloque se mete por debajo de la falla, y tomar allí la pila del
    // vecino era lo que hacía que el corte bajara recto desde la traza.
    const stacks = dd.map((d) => {
      const p = at(d)
      const st = scene.stackAt(p[0], p[1], dom.blockId)
      return { z: st.z.slice(), cut: st.cut.slice() }
    })
    const zByContact = new Map()
    for (let ci = 0; ci < scene.contacts.length; ci++) {
      const c = scene.contacts[ci]
      const zs = stacks.map((st) => {
        const z = st.z[ci]
        return Number.isFinite(z) ? z : null
      })
      if (!zs.some((z) => z != null)) continue
      zByContact.set(c.id, zs)
      const idx = contactIndex.get(c.id)
      // La línea se parte en tramos continuos: donde no hay cota, y donde un
      // contacto más joven lo ha cortado. Ahí el contacto antiguo ya no existe
      // —su cota sigue haciendo falta para cerrar la unidad de debajo, pero
      // dibujarla la calcaría sobre la discordancia—. Sin partir, la línea
      // saltaría el hueco de lado a lado.
      const runs = { below: [], above: [] }
      let cur = null
      for (let i = 0; i < m; i++) {
        const z = zs[i]
        const ok = z != null && !stacks[i].cut[ci]
        const where = ok ? (z <= tz[i] ? 'below' : 'above') : null
        if (!where || !cur || cur.where !== where) {
          if (cur && cur.pts.length >= 2) runs[cur.where].push(cur.pts)
          cur = where ? { where, pts: [] } : null
        }
        if (cur) cur.pts.push([dd[i], z])
      }
      if (cur && cur.pts.length >= 2) runs[cur.where].push(cur.pts)
      for (const line of runs.below) for (const seg of clipLine(line)) if (seg.length >= 2) contactsOut[idx].lines.push(seg)
      for (const line of runs.above) for (const seg of clipLine(line)) if (seg.length >= 2) contactsOut[idx].air.push(seg)
    }

    // Relleno de cada unidad entre su contacto basal y su techo.
    for (const un of scene.units) {
      const base = contactBelow(scene, un)
      const top = contactAbove(scene, un)
      const zb = base ? zByContact.get(base.id) : null
      const zt = top ? zByContact.get(top.id) : null
      // Hace falta al menos uno de los dos contactos resuelto en este dominio.
      // Sin ninguno no se sabe dónde empieza ni dónde acaba la unidad, y
      // rellenar «desde el fondo hasta la topografía» la extendía sobre todo un
      // bloque de falla en el que no hay dato suyo, tapando a las demás.
      if (!zb && !zt) continue
      let run = []
      const flush = () => {
        if (run.length >= 2) {
          const poly = clip([...run.map((r) => r.top), ...run.map((r) => r.bot).reverse()])
          if (poly.length >= 3) unitsOut[unitIndex.get(un.id)].polys.push(poly)
        }
        run = []
      }
      for (let i = 0; i < m; i++) {
        const zTop = Math.min(zt ? (zt[i] ?? Infinity) : Infinity, tz[i])
        const zBot = Math.max(zb ? (zb[i] ?? -Infinity) : -Infinity, bottom)
        if (Number.isFinite(zTop) && Number.isFinite(zBot) && zTop > zBot) {
          run.push({ top: [dd[i], zTop], bot: [dd[i], zBot] })
        } else flush()
      }
      flush()
    }
  }

  // ---- Líneas de falla en el perfil ----
  const topoAt = (d) => {
    const t = (d / L) * (n - 1)
    const i = Math.max(0, Math.min(n - 2, Math.floor(t)))
    const f = Math.max(0, Math.min(1, t - i))
    return topo[i] + (topo[i + 1] - topo[i]) * f
  }
  // La falla se dibuja siguiendo su propia superficie —la misma con la que se
  // recortan las unidades—, muestreada entre la topografía y el fondo del
  // perfil. Se queda el tramo continuo que pasa por el cruce con la traza: si
  // el plano vuelve a asomar más allá, ése ya es otro afloramiento.
  const faultsOut = faultCrossings.map((fc) => {
    const zAt = fc.zPlane
    const STEPS = 320
    const runs = []
    let run = []
    for (let i = 0; i < STEPS; i++) {
      const d = (L * i) / (STEPS - 1)
      const z = zAt(d)
      if (Number.isFinite(z) && z <= topoAt(d) + 1e-6 && z >= bottom) run.push([d, z])
      else if (run.length) ((runs.push(run)), (run = []))
    }
    if (run.length) runs.push(run)
    let path = runs.find((r) => r[0][0] <= fc.d && r[r.length - 1][0] >= fc.d)
    if (!path) path = runs.sort((a, b) => b.length - a.length)[0]
    if (!path || path.length < 2) {
      // Plano vertical o sin superficie utilizable: una recta con su manteo.
      const dBot = Math.abs(fc.k) > 1e-6 ? fc.d + (fc.z - bottom) / fc.k : fc.d
      path = [
        [fc.d, fc.z],
        [dBot, bottom],
      ]
    }
    return {
      faultId: fc.faultId,
      name: fc.fault.name,
      kinematics: fc.fault.kinematics,
      d: fc.d,
      z: fc.z,
      apparentDip: fc.apparentDip,
      dip: fc.dip,
      dipDir: fc.dipDir,
      dipsTowardPlus: fc.k > 0,
      path,
      line: [path[0], path[path.length - 1]],
      zAt,
    }
  })

  // ---- Pozos cercanos al perfil ----
  const corridor = section.corridor || L * 0.12
  const wellsOut = []
  for (const w of scene.project.wells) {
    const p = toWorld(georef, w.at)
    const r = pointSegment(p, A, B)
    if (r.d > corridor) continue
    const d = dot(sub(r.proj, A), u)
    wellsOut.push({ id: w.id, name: w.name, d, offset: r.d, well: w })
  }

  return {
    id: section.id,
    name: section.name,
    length: L,
    azimuth,
    backAzimuth: (azimuth + 180) % 360,
    A,
    B,
    ds,
    topo,
    topoLine: ds.map((d, i) => [d, topo[i]]),
    topoMax,
    topoMin,
    bottom,
    domains,
    units: unitsOut,
    contacts: contactsOut,
    faults: faultsOut,
    wells: wellsOut,
    depth: section.depth,
    vExag: section.vExag || 1,
  }
}

function nearestCrossing(crossings, d) {
  let best = null
  let bd = Infinity
  for (const c of crossings) {
    const dd = Math.abs(c.d - d)
    if (dd < bd) {
      bd = dd
      best = c
    }
  }
  return best
}
