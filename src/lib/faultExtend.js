// Prolongación de la traza de una falla hasta los bordes del área de trabajo.
//
// La app ya prolonga cada falla por su cuenta para cerrar la partición en
// bloques (`scene.js`, dibujada fina y punteada en el mapa): pero esa
// prolongación es un recurso del motor, no un dato, y se corrige —dice el
// propio comentario del dibujo— «digitalizando la traza más allá». Esto es
// justamente esa corrección hecha con un botón: en vez de una recta que
// adivina el rumbo, se calcula dónde **la superficie de falla ya resuelta**
// —la que ya sale de sus contornos estructurales— vuelve a cruzar el
// terreno más allá de lo digitalizado. Con relieve, ese cruce no es una
// recta: serpentea con la topografía exactamente como serpentea la traza
// real, porque es la misma cuenta con la que sale la traza real.
//
// El cruce de una superficie con el terreno es la isolínea de nivel cero de
// `superficie − terreno` (la misma idea con la que se trazó la pared de un
// dique al construir el ejemplo de acuñamiento), así que se reutiliza
// `contourLines` para hallarlo sobre toda el área de trabajo y luego se
// descarta la parte que ya coincide con lo digitalizado —no hace falta
// duplicar esos puntos, ya están—.
//
// El acuñamiento hacia la vertical: si la falla está sellada por una
// discordancia (`sealedByContactId`, o la que infiere `scene.faultSeal`), no
// existe por encima de esa superficie. Donde la cobertura no se ha erosionado
// —el terreno queda por encima de la discordancia— la falla no puede aflorar,
// así que esa parte del área queda fuera de la cuenta: la prolongación se
// corta ahí en vez de atravesar la cobertura como si no existiera.

import { contourLines } from './marching.js'
import { modelExtent, frameTest } from './models.js'
import { toWorld, toImage } from './georef.js'
import { dist } from './geom.js'

/**
 * Nuevos tramos de traza para prolongar una falla hasta el borde del área de
 * trabajo, en píxeles de imagen —listos para `trace.addMany`—, o `null` si la
 * falla no tiene superficie resuelta o no hay relieve con el que cruzarla.
 */
export function extendFaultTrace(fault, scene) {
  const surf = scene.faultSurfaces?.get(fault.id)
  if (!surf?.defined || !scene.dem?.valid) return null
  const { dem, georef } = scene
  const bbox = modelExtent(scene)
  const inFrame = frameTest(scene)
  if (!(bbox.maxX > bbox.minX) || !(bbox.maxY > bbox.minY)) return null

  // La discordancia que la sella, si la hay: por encima de ella la falla ya
  // no existe (ver `faultCutsContact` en model.js), así que tampoco puede
  // cruzar el terreno ahí. `scene.faultSeal` es la misma que usan el 3D y la
  // partición en bloques para decidirlo, así que no hace falta repetir esa
  // lógica aquí.
  const sealId = scene.faultSeal?.(fault.id)
  const sealByBlock = sealId ? scene.contactSurfaces?.get(sealId) : null
  const validAt = (x, y) => {
    if (inFrame && !inFrame(x, y)) return false
    if (!sealByBlock) return true
    const block = scene.blocks?.blockAt?.(x, y)
    const sealSurf = block != null ? sealByBlock.get(block) : null
    const zSeal = sealSurf?.defined ? sealSurf.elevationAt(x, y) : null
    if (!Number.isFinite(zSeal)) return true
    return dem.elevationAt(x, y) <= zSeal
  }

  const side = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY)
  const step = Math.max(side / 220, 1)
  const N = Math.max(40, Math.min(300, Math.round(side / step)))
  const f = (x, y) => {
    if (!validAt(x, y)) return NaN
    const z = surf.elevationAt(x, y)
    const zt = dem.elevationAt(x, y)
    return Number.isFinite(z) && Number.isFinite(zt) ? z - zt : NaN
  }
  const lines = contourLines(f, bbox, N, N, 0)
  if (!lines.length) return null

  // Lo ya digitalizado, en coordenadas de terreno: la prolongación no
  // necesita repetirlo, sólo lo que hay más allá.
  const mapped = []
  for (const tr of fault.traces || []) for (const p of tr.pts) mapped.push(toWorld(georef, p))
  const near = (p) => mapped.some((m) => dist(m, p) < step * 1.6)

  const extras = []
  for (const line of lines) {
    let run = []
    for (const p of line) {
      if (mapped.length && near(p)) {
        if (run.length > 1) extras.push(run)
        run = []
      } else {
        run.push(p)
      }
    }
    if (run.length > 1) extras.push(run)
  }
  if (!extras.length) return null
  return extras.map((run) => run.map((p) => toImage(georef, p)))
}
