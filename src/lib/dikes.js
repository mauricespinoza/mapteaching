// Diques: cuerpos tabulares intrusivos, limitados por dos paredes y sin base ni
// techo.
//
// Un dique no es una unidad de la columna ni un contacto entre dos: **corta**
// la pila en vez de formar parte de ella. Por eso no entra en `stackAt` ni en
// la regla de superposición, y se resuelve aparte.
//
// La geometría sale de las **dos paredes**, cada una tratada como la superficie
// que es: su traza corta curvas de nivel, de esos cruces salen sus contornos
// estructurales y de ellos su rumbo y su manteo, exactamente igual que en una
// falla (`structure.js`). El dique es lo que queda **entre** las dos.
//
// De ahí sale gratis lo que un dique hace de verdad en un mapa y una banda de
// ancho fijo no sabría hacer: **acuñarse**. Donde las dos trazas convergen, las
// dos superficies convergen; donde se cruzan, el espesor es cero y el dique
// deja de existir —en el mapa, en el perfil, en el 3D y en la columna de un
// pozo—. La punta no se declara en ninguna parte: se lee del mapa, igual que
// todo lo demás en esta app. Y como el cruce puede ocurrir en profundidad y no
// en la superficie, un dique puede aflorar con espesor y acuñarse hacia abajo,
// que es justamente lo que hace un dique al acercarse a su punta.
//
// Contra ese mismo mecanismo hay que protegerse: dos planos ajustados por
// separado se cortan **siempre** en alguna parte, así que un acuñamiento lejos
// de los datos sería un artefacto del ajuste y no un dato del mapa. La regla es
// la de siempre en esta app —el espesor constante es la hipótesis por defecto y
// sólo el mapa la desmiente, igual que en `parallel.js`—: se prueba si los
// cruces de la segunda pared encajan con un espesor constante respecto de la
// primera y, si encajan, se adopta la superficie **paralela**, que por
// construcción no se cruza nunca. Si no encajan —las dos trazas convergen de
// verdad—, manda lo medido y el dique se acuña donde el mapa dice.
//
// El desajuste se mide **perpendicular a las paredes**, no en cota: a 81° de
// manteo, el grosor del trazo son cincuenta metros de cota, y comparar eso con
// media equidistancia daría siempre «no encaja» (ver `perpRms`).
//
// Con una sola pared digitalizada —un dique fino se dibuja con una línea— la
// otra se construye paralela a ella, al espesor y del lado que diga la ficha.
// Eso ya no es una medida sino un dato declarado, y el panel de resultados lo
// distingue.
//
// Lo que este modelo **no** hace todavía: un dique desplazado por una falla se
// resuelve con todas sus trazas juntas, así que ahí conviene digitalizar un
// dique por bloque.

import { fitParallelOffset, offsetObservations, parallelSurface, slopeFactor } from './parallel.js'

/**
 * Superficie paralela a otra a un espesor verdadero fijo. No es una superficie
 * del mapa: no tiene trazas ni contornos propios, sólo cota y pendiente, que es
 * lo único que hace falta para cerrar el cuerpo del dique por el otro lado.
 *
 * `offset > 0` la sitúa **por debajo** de la referencia, como en `parallel.js`.
 */
function offsetSurface(reference, offset) {
  const step = Math.max(reference?.gradStep || 0, 1e-6)
  const elevationAt = (x, y) => {
    const s = reference.sampleAt(x, y)
    if (!s || !Number.isFinite(s.z)) return null
    return s.z - offset * slopeFactor(s.a, s.b)
  }
  const sampleAt = (x, y) => {
    const z = elevationAt(x, y)
    if (!Number.isFinite(z)) return { z: null, a: 0, b: 0 }
    const xp = elevationAt(x + step, y)
    const xm = elevationAt(x - step, y)
    const yp = elevationAt(x, y + step)
    const ym = elevationAt(x, y - step)
    return {
      z,
      a: Number.isFinite(xp) && Number.isFinite(xm) ? (xp - xm) / (2 * step) : 0,
      b: Number.isFinite(yp) && Number.isFinite(ym) ? (yp - ym) / (2 * step) : 0,
    }
  }
  return {
    defined: true,
    declared: true,
    gradStep: step,
    mean: reference.mean,
    elevationAt,
    sampleAt,
    attitudeAt: reference.attitudeAt,
  }
}

/** ¿Resolvió esta pared su geometría con sus propios cruces con las curvas? */
const resolved = (surf) => Boolean(surf?.defined && (surf.quality === 'ok' || surf.quality === 'manual'))

/** Cuántos contornos estructurales llegó a ajustar una pared. */
const fitCount = (surf) => (surf?.structureContours || []).filter((s) => s.fit).length

/**
 * Puntos con los que comparar las dos paredes: los cruces de sus trazas con las
 * curvas de nivel, que es donde el mapa dice de verdad por dónde va cada una.
 */
function samplePoints(surfs) {
  const out = []
  for (const s of surfs) for (const p of s?.points3D || []) out.push([p[0], p[1]])
  return out
}

/**
 * Desajuste del espesor constante, medido **perpendicular a las paredes** y no
 * en cota.
 *
 * `fitParallelOffset` devuelve el residuo en cota, y en una pared empinada eso
 * no se puede comparar con nada: a 81° de manteo, diez metros de error en el
 * mapa —el grosor del trazo— son cincuenta y siete de cota. Dividir por el
 * factor 1/cos δ lo devuelve a la escala en la que el desajuste significa algo:
 * metros de espesor.
 */
const perpRms = (fit, ref) => {
  const dip = ref?.mean?.dip
  const k = Number.isFinite(dip) ? slopeFactor(Math.tan(Math.min(89, dip) * (Math.PI / 180)), 0) : 1
  return fit.rms / k
}

/**
 * ¿Encajan los datos de una pared con un espesor constante respecto de la otra?
 *
 * El listón es la precisión con la que el mapa sitúa una pared empinada: unos
 * pocos anchos de trazo, o media equidistancia llevada a la perpendicular
 * —que en una pared de canto es mucho menos que media equidistancia en cota—.
 */
const constantThickness = (fit, ref, { tol, zStep }) => {
  const dip = ref?.mean?.dip
  const cos = Number.isFinite(dip) ? Math.cos(Math.min(89, dip) * (Math.PI / 180)) : 1
  return perpRms(fit, ref) <= Math.max(tol * 3, (zStep || 0) * 0.5 * cos)
}

/**
 * Resuelve la segunda pared del dique contra la primera.
 *
 * Dos respuestas posibles, y la que se elija es justamente la que decide si el
 * dique puede acuñarse:
 *
 * - **Paralela.** Si los datos de esta pared encajan con un espesor constante,
 *   se adopta la superficie paralela a la de referencia. Es lo que evita el
 *   acuñamiento de mentira: dos planos ajustados por separado se cortan
 *   siempre en alguna parte, y si el mapa no dice que convergen, ese cruce es
 *   ruido del ajuste y no una punta de dique.
 * - **Medida.** Si los datos la contradicen —las dos trazas convergen de
 *   verdad—, manda lo medido. Entonces las dos superficies se cruzan donde el
 *   mapa dice, y el dique se acuña ahí.
 *
 * Una pared que no resuelve su propia geometría no tiene nada que decir: se le
 * presta la forma entera y sus pocos datos sólo fijan el espesor.
 */
function completeWall(other, ref, { dem, step, tol, zStep }) {
  const obs = offsetObservations(other, dem, step)
  if (!obs) return null
  const fit = fitParallelOffset(ref, obs.points)
  if (!fit) return null
  const own = resolved(other)
  const parallel = !own || constantThickness(fit, ref, { tol, zStep })
  return {
    surface: parallel ? parallelSurface(other, ref, fit, { upgrade: own }) : other,
    parallel,
    tapered: !parallel,
    thickness: Math.abs(fit.offset),
    rms: perpRms(fit, ref),
    n: fit.n,
    source: obs.source,
  }
}

/**
 * Resuelve un dique a partir de las superficies de sus dos paredes.
 *
 * @param dike       la ficha del proyecto
 * @param wallSurfs  [superficie de la pared 0, superficie de la pared 1]
 * @returns { id, dike, low, high, spanAt, contains, thickness, … } o `null`
 *          si ninguna de las dos paredes se puede resolver.
 */
export function resolveDike(dike, wallSurfs, { dem, tol = 1, side = 1000, zStep = 0 } = {}) {
  const step = Math.max(tol * 6, side / 200)
  const [s0, s1] = wallSurfs
  const has = (s) => Boolean(s?.defined)
  let a = null // pared de referencia, con su superficie final
  let b = null // la otra
  let quality = 'ok'
  let thickness = null

  if (has(s0) && has(s1)) {
    // Las dos paredes están en el mapa: manda la mejor resuelta y la otra se
    // completa contra ella, de modo que donde no hay contornos el espesor se
    // mantiene constante en vez de inventarse un cruce.
    const refFirst = fitCount(s0) >= fitCount(s1) ? 0 : 1
    const ref = refFirst === 0 ? s0 : s1
    const oth = refFirst === 0 ? s1 : s0
    const done = completeWall(oth, ref, { dem, step, tol, zStep })
    a = { index: refFirst, surface: ref, raw: ref }
    b = done
      ? { index: 1 - refFirst, surface: done.surface, raw: oth, fit: done }
      : { index: 1 - refFirst, surface: oth, raw: oth }
    thickness = done?.thickness ?? null
    quality = done ? (done.tapered ? 'medido' : 'paralelo') : 'sin-espesor'
  } else if (has(s0) || has(s1)) {
    // Una sola pared. La otra es paralela al espesor declarado en la ficha, del
    // lado que diga `side`: un dato del estudiante, no una medida.
    const i = has(s0) ? 0 : 1
    const ref = i === 0 ? s0 : s1
    const e = Math.abs(Number(dike.thickness) || 0)
    if (!(e > 0)) return null
    const sgn = (dike.side ?? 1) >= 0 ? -1 : 1 // offset<0 la pone por encima
    a = { index: i, surface: ref, raw: ref }
    b = { index: 1 - i, surface: offsetSurface(ref, sgn * e), raw: i === 0 ? s1 : s0, declared: true }
    thickness = e
    quality = 'declarado'
  } else {
    return null
  }

  // ¿Cuál de las dos queda arriba? Se vota sobre los cruces medidos de las dos,
  // que es donde el mapa las sitúa. Para dos superficies paralelas la respuesta
  // es la misma en todo el mapa; donde convergen deja de serlo, y ahí
  // justamente está la punta del dique.
  const pts = samplePoints([a.raw, b.raw].filter(Boolean))
  let up = 0
  let down = 0
  for (const p of pts) {
    const za = a.surface.elevationAt(p[0], p[1])
    const zb = b.surface.elevationAt(p[0], p[1])
    if (!Number.isFinite(za) || !Number.isFinite(zb)) continue
    if (zb > za) up++
    else down++
  }
  const high = up >= down ? b : a
  const low = up >= down ? a : b

  /**
   * Tramo vertical que el dique ocupa en un punto, o `null` donde no existe.
   * `null` es la respuesta en la punta: allí las dos paredes ya se cruzaron y
   * el espesor es cero o negativo.
   */
  const spanAt = (x, y) => {
    const zl = low.surface.elevationAt(x, y)
    const zh = high.surface.elevationAt(x, y)
    if (!Number.isFinite(zl) || !Number.isFinite(zh) || zh <= zl) return null
    return [zl, zh]
  }

  const contains = (x, y, z) => {
    const s = spanAt(x, y)
    return Boolean(s && z >= s[0] && z <= s[1])
  }

  /** ¿Aflora el dique aquí? Es la pregunta que contesta el mapa en planta. */
  const outcropsAt = (x, y) => {
    if (!dem?.valid) return false
    const z = dem.elevationAt(x, y)
    return Number.isFinite(z) && contains(x, y, z)
  }

  return {
    id: dike.id,
    dike,
    name: dike.name,
    color: dike.color,
    /** Superficies finales, ya orientadas: `low` es el muro y `high` el techo. */
    low: low.surface,
    high: high.surface,
    /** Las superficies tal como salieron del mapa, para dibujar sus contornos. */
    wallSurfaces: wallSurfs,
    /** Índice de la pared que sirvió de referencia. */
    referenceWall: a.index,
    declared: Boolean(b.declared),
    /** ¿Se acuña? Sus dos paredes convergen de verdad, y el mapa lo dice. */
    tapered: Boolean(b.fit?.tapered),
    thickness,
    fit: b.fit || null,
    quality,
    spanAt,
    contains,
    outcropsAt,
  }
}

/**
 * Todos los diques resueltos de una escena, con el buscador que necesitan el
 * mapa, el perfil, el 3D y los pozos: qué dique ocupa un punto del espacio.
 *
 * Cuando dos diques se cruzan gana el último de la lista, que es el más
 * reciente de la ficha; en el mapa eso se corrige reordenándolos.
 */
export function dikeIndex(list) {
  const dikes = list.filter(Boolean)
  return {
    list: dikes,
    at(x, y, z) {
      for (let i = dikes.length - 1; i >= 0; i--) if (dikes[i].contains(x, y, z)) return dikes[i]
      return null
    },
    outcropAt(x, y) {
      for (let i = dikes.length - 1; i >= 0; i--) if (dikes[i].outcropsAt(x, y)) return dikes[i]
      return null
    },
  }
}
