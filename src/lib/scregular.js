// Regularizar y densificar contornos estructurales.
//
// Los contornos que calcula el motor salen de los cruces de la traza con las
// curvas de nivel, y esos cruces llevan el ruido de la digitalización: dos
// contornos consecutivos de una misma superficie plana salen con unos grados de
// diferencia de rumbo y con separaciones que bailan. Eso es error de medida, no
// geología, y ensucia el manteo que se lee de cada par.
//
// Aquí se hacen dos cosas con la misma cuenta:
//
//  - **Regularizar**: sustituir un grupo de contornos por otros paralelos y
//    equiespaciados, con el rumbo medio y la separación media del grupo.
//  - **Densificar**: prolongar ese mismo patrón a las cotas de las demás curvas
//    de nivel, donde la traza no llegó a cortar.
//
// Lo que impide que esto se coma la geología es el **umbral**: sólo se promedian
// contornos que ya se parecían. Si el rumbo da un salto o la separación cambia
// de golpe, ahí la superficie cambia de verdad —una discordancia, un flanco de
// pliegue, otra unidad— y el grupo se corta. Promediar por encima de ese salto
// convertiría dos geometrías distintas en una sola inventada.

import { contourSegment } from './structure.js'
import { toImage } from './georef.js'
import { norm180, azimuthWorld } from './georef.js'
import { uid } from './model.js'

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/** Diferencia entre dos direcciones axiales (mod 180), en grados. */
function axialDiff(a, b) {
  const d = Math.abs(norm180(a) - norm180(b))
  return Math.min(d, 180 - d)
}

/** Media circular de direcciones axiales. */
function axialMean(angles) {
  let sx = 0
  let sy = 0
  for (const a of angles) {
    sx += Math.cos(2 * a * RAD)
    sy += Math.sin(2 * a * RAD)
  }
  return norm180((Math.atan2(sy, sx) * DEG) / 2)
}

/**
 * Describe cada contorno por lo que importa para compararlo con los demás: su
 * dirección, su punto medio y su desplazamiento perpendicular respecto a un
 * origen común.
 */
function describe(surf, sc) {
  const seg = contourSegment(sc, null, 0)
  if (!seg) return null
  const dir = [seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]]
  const l = Math.hypot(dir[0], dir[1])
  if (!(l > 0)) return null
  const az = azimuthWorld(dir)
  return {
    sc,
    elevation: sc.elevation,
    limb: sc.limb ?? 0,
    mid: [(seg[0][0] + seg[1][0]) / 2, (seg[0][1] + seg[1][1]) / 2],
    length: l,
    strike: norm180(az),
  }
}

/**
 * Parte una serie de contornos ordenados por cota en tramos internamente
 * consistentes. Un tramo se corta donde el rumbo gira más de `strikeTol` o donde
 * la separación se aparta más de `spacingTol` de la del tramo.
 */
function runs(items, strikeTol, spacingTol) {
  const out = []
  let cur = []
  const offsetOf = (it, n) => it.mid[0] * n[0] + it.mid[1] * n[1]
  const push = () => {
    if (cur.length >= 2) out.push(cur)
    else if (cur.length === 1) out.push(cur)
    cur = []
  }
  for (const it of items) {
    if (!cur.length) {
      cur = [it]
      continue
    }
    const prev = cur[cur.length - 1]
    if (axialDiff(prev.strike, it.strike) > strikeTol) {
      push()
      cur = [it]
      continue
    }
    if (cur.length >= 2) {
      // Separación por metro de cota, comparada con la que llevaba el tramo.
      const n = normalOf(axialMean(cur.map((c) => c.strike)))
      const rates = []
      for (let i = 1; i < cur.length; i++) {
        const dz = cur[i].elevation - cur[i - 1].elevation
        if (Math.abs(dz) < 1e-9) continue
        rates.push((offsetOf(cur[i], n) - offsetOf(cur[i - 1], n)) / dz)
      }
      const dz = it.elevation - prev.elevation
      const rate = Math.abs(dz) > 1e-9 ? (offsetOf(it, n) - offsetOf(prev, n)) / dz : null
      if (rates.length && rate != null) {
        const mean = rates.reduce((a, b) => a + b, 0) / rates.length
        const rel = Math.abs(mean) > 1e-9 ? Math.abs(rate / mean - 1) : Math.abs(rate) > 1e-9 ? 1 : 0
        // Un cambio de signo es un cambio de sentido de manteo: nunca se junta.
        if (rate * mean < 0 || rel > spacingTol) {
          push()
          cur = [it]
          continue
        }
      }
    }
    cur.push(it)
  }
  push()
  return out
}

const normalOf = (strikeAz) => [Math.cos(strikeAz * RAD), -Math.sin(strikeAz * RAD)]

/**
 * Ajuste de un tramo: el rumbo medio y la recta desplazamiento–cota, cuya
 * pendiente es la separación media por metro de cota.
 */
function fitRun(run) {
  const strike = axialMean(run.map((r) => r.strike))
  const n = normalOf(strike)
  const s = [-n[1], n[0]]
  const pts = run.map((r) => ({
    z: r.elevation,
    o: r.mid[0] * n[0] + r.mid[1] * n[1],
    a: r.mid[0] * s[0] + r.mid[1] * s[1],
    length: r.length,
  }))
  const nz = pts.length
  const mz = pts.reduce((t, p) => t + p.z, 0) / nz
  const mo = pts.reduce((t, p) => t + p.o, 0) / nz
  let sxy = 0
  let sxx = 0
  for (const p of pts) {
    sxy += (p.z - mz) * (p.o - mo)
    sxx += (p.z - mz) * (p.z - mz)
  }
  const slope = sxx > 1e-9 ? sxy / sxx : 0
  const along = pts.reduce((t, p) => t + p.a, 0) / nz
  const length = pts.reduce((t, p) => t + p.length, 0) / nz
  const rms = Math.sqrt(pts.reduce((t, p) => t + (p.o - (mo + slope * (p.z - mz))) ** 2, 0) / nz)
  return {
    strike,
    n,
    s,
    slope,
    mz,
    mo,
    along,
    length,
    rms,
    // Separación entre dos contornos consecutivos de la equidistancia dada.
    spacingPerMetre: Math.abs(slope),
    dip: Math.abs(slope) > 1e-9 ? Math.atan(1 / Math.abs(slope)) * DEG : 90,
  }
}

/** Extremos en mundo de un contorno regular a la cota z. */
function segmentAt(fit, z, length) {
  const o = fit.mo + fit.slope * (z - fit.mz)
  const c = [fit.n[0] * o + fit.s[0] * fit.along, fit.n[1] * o + fit.s[1] * fit.along]
  const h = length / 2
  return [
    [c[0] - fit.s[0] * h, c[1] - fit.s[1] * h],
    [c[0] + fit.s[0] * h, c[1] + fit.s[1] * h],
  ]
}

/** Recorre las superficies de contacto reunidas por rasgo. */
function eachContactSurface(scene) {
  const out = []
  for (const c of scene.contacts) {
    const byBlock = scene.contactSurfaces.get(c.id)
    if (!byBlock) continue
    for (const [block, surf] of byBlock) out.push({ contact: c, block, surf })
  }
  return out
}

/**
 * Contornos regularizados y, si se pide, densificados a las demás cotas.
 *
 * `mode` es `'regularize'` (sólo rehace los que hay) o `'densify'` (añade además
 * los de las cotas de curva de nivel que faltan). Devuelve los contornos ya en
 * píxeles de imagen, listos para `sc.bulk`, y un informe de qué se hizo y qué
 * se dejó en paz.
 */
export function regularContours(scene, { mode = 'regularize', strikeTol = 15, spacingTol = 0.35, inArea = null } = {}) {
  const levels = [...new Set(scene.worldContours.map((c) => c.elevation))].sort((a, b) => a - b)
  const byFeature = new Map()
  const report = []
  for (const { contact, block, surf } of eachContactSurface(scene)) {
    // Se parte de lo que hay ahora, calculado o puesto a mano: si el estudiante
    // ya corrigió un contorno, promediar sin contarlo tiraría su corrección. Y
    // así los dos botones se pueden encadenar —regularizar y luego densificar—
    // en vez de que el segundo no encuentre nada que leer.
    const described = (surf.structureContours || [])
      .filter((sc) => sc.fit)
      .map((sc) => describe(surf, sc))
      .filter(Boolean)
    if (described.length < 2) continue
    const byLimb = new Map()
    for (const d of described) {
      if (!byLimb.has(d.limb)) byLimb.set(d.limb, [])
      byLimb.get(d.limb).push(d)
    }
    for (const [limb, list] of byLimb) {
      list.sort((a, b) => a.elevation - b.elevation)
      const groups = runs(list, strikeTol, spacingTol)
      for (const run of groups) {
        if (run.length < 2) {
          report.push({
            name: contact.name,
            block,
            limb,
            kept: true,
            reason: 'un solo contorno en el tramo: no hay nada que promediar',
            elevations: run.map((r) => r.elevation),
          })
          continue
        }
        const fit = fitRun(run)
        const items = []
        const own = new Set(run.map((r) => r.elevation))
        const targets = mode === 'densify' ? [...new Set([...own, ...levels])].sort((a, b) => a - b) : [...own]
        for (const z of targets) {
          const seg = segmentAt(fit, z, fit.length)
          // Fuera del área de trabajo un contorno estructural no dice nada.
          if (inArea && !inArea(seg[0][0], seg[0][1]) && !inArea(seg[1][0], seg[1][1])) continue
          items.push({
            id: uid('sc'),
            elevation: z,
            pts: [toImage(scene.georef, seg[0]), toImage(scene.georef, seg[1])],
          })
        }
        if (!items.length) continue
        const key = contact.id
        if (!byFeature.has(key)) byFeature.set(key, { kind: 'contact', id: key, items: [] })
        byFeature.get(key).items.push(...items)
        report.push({
          name: contact.name,
          block,
          limb,
          kept: false,
          count: items.length,
          from: run.length,
          added: items.length - run.length,
          elevations: run.map((r) => r.elevation),
          strike: fit.strike,
          dip: fit.dip,
          spacing: fit.spacingPerMetre,
          rms: fit.rms,
        })
      }
      if (groups.length > 1) {
        report.push({
          name: contact.name,
          block,
          limb,
          split: groups.length,
          reason: 'la serie se parte: el rumbo o la separación cambian más de lo tolerado',
        })
      }
    }
  }
  return { groups: [...byFeature.values()], report }
}
