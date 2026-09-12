// Geometría heredada: un contacto sin datos propios sigue el pliegue del que
// tiene encima, con espesor constante.
//
// Un contacto sólo se resuelve por sí mismo cuando su traza corta suficientes
// curvas de nivel: hacen falta dos cotas con dos intersecciones cada una para
// tener dos contornos estructurales y, con ellos, un manteo. Cuando no las hay
// —una unidad que aflora en una franja estrecha, un tramo de traza que corre
// entre dos curvas sin llegar a cruzarlas— el motor no puede decir cómo varía
// el manteo de esas capas, y el ajuste plano de los pocos puntos disponibles
// devuelve una superficie que no tiene nada que ver con la estructura del
// sector: en un pliegue la aplana justo donde el pliegue es la respuesta.
//
// En una serie concordante la respuesta geológica es la de siempre: las capas
// de abajo repiten el pliegue de las de arriba. Se construye entonces la
// superficie *paralela* a la que sí está resuelta (pliegue paralelo o
// concéntrico, clase 1B de Ramsay): la misma geometría, desplazada un espesor
// verdadero constante medido perpendicular a las capas. En cota ese
// desplazamiento no es constante —vale `e / cos δ`, con δ el manteo local— y
// por eso el contacto heredado se separa más en los flancos que en las
// charnelas, exactamente como lo hace un contacto real.
//
// El espesor no se inventa: se ajusta por mínimos cuadrados a los pocos datos
// que el contacto sí tiene (sus cruces con curvas de nivel y, si no llegan a
// tres, su traza leída sobre el modelo de elevación, que también son puntos de
// su superficie). Con un solo dato basta, porque la forma ya la pone el
// contacto de referencia y lo único que falta por determinar es el espesor.
//
// Hay un segundo caso, más sutil: una traza que sólo corta curvas de nivel en un
// tramo sí da un manteo, pero no cómo varía, y se resuelve como un plano bajo un
// pliegue. Ahí las medidas propias se conservan —son datos del mapa— y sólo se
// toma prestada la forma en profundidad, siempre que los datos del contacto
// encajen con un espesor constante; si la contradicen, mandan ellos.
//
// Y un tercero: el contacto que sí midió su propio pliegue, pero sólo en parte
// del mapa. Medir cómo varía el manteo no es medirlo en todas partes, y pasado
// el último contorno estructural la superficie propia deja de estar sujeta a
// nada: media vuelta más allá de la charnela se aparta cientos de metros de la
// de encima, la cruza, y la regla de superposición (`scene.js: truncate`) acaba
// acuñando la unidad contra su propio techo. En una serie concordante eso no
// existe. Así que la herencia deja de ser «todo o nada» y pasa a ser un
// **relevo**: sobre sus contornos manda lo medido y lejos de ellos manda la
// superficie paralela, con una transición suave en medio (`ownSupport`). Es la
// misma regla de siempre, aplicada punto a punto en vez de contacto a contacto:
// donde no hay contornos estructurales que resuelvan la geometría, la unidad de
// abajo sigue a la de encima con espesor constante.
//
// La herencia va **sólo hacia abajo**, hacia las capas más antiguas. Que un
// contacto esté plegado obliga a las capas de debajo a repetir ese pliegue —son
// las que el pliegue arrastró consigo—, pero no dice nada de las de encima: una
// serie más joven puede estar depositada en discordancia sobre el pliegue ya
// formado, y entonces no lo sigue. Un contacto sin datos propios que sólo tenga
// vecinos resueltos por debajo se queda sin resolver, que es la respuesta
// honesta: el mapa no da para saber su forma en profundidad.
//
// La herencia se corta además en las discordancias y en los contactos
// intrusivos: bajo una inconformidad las capas están truncadas, así que tampoco
// son paralelas a ella.

import { attitudeFromGradient } from './structure.js'
import { resample, pointSegment } from './geom.js'
import { isUnconformable } from './model.js'

const RAD = Math.PI / 180

// Manteo máximo admitido al convertir espesor verdadero en desplazamiento
// vertical: más allá, el factor 1/cos δ se dispara y un error pequeño de
// gradiente mandaría el contacto kilómetros abajo.
const MAX_DIP = 80
const MAX_K = 1 / Math.cos(MAX_DIP * RAD)

/**
 * Factor 1/cos δ a partir del gradiente de la superficie: lo que convierte un
 * espesor verdadero (perpendicular a las capas) en el desnivel que le
 * corresponde. Lo usan también los diques, que son dos superficies paralelas
 * separadas un espesor (`dikes.js`).
 */
export const slopeFactor = (a, b) => Math.min(MAX_K, Math.sqrt(1 + a * a + b * b))

// Hasta dónde se da por buena la forma que el propio contacto midió, en
// múltiplos de la separación entre sus contornos estructurales. Dentro de
// `SUPPORT_NEAR` manda entero lo medido; a partir de `SUPPORT_FAR` no queda
// nada suyo y manda la geometría prestada. Un contorno más allá del último
// medido es todavía una extrapolación razonable; tres es ya inventar.
const SUPPORT_NEAR = 1
const SUPPORT_FAR = 3

/** Transición suave 1 → 0 (smoothstep), sin quiebros en el contacto dibujado. */
function fade(d, near, far) {
  if (!(far > near)) return d <= near ? 1 : 0
  if (d <= near) return 1
  if (d >= far) return 0
  const u = (d - near) / (far - near)
  return 1 - u * u * (3 - 2 * u)
}

/**
 * Separación típica entre los contornos estructurales de una superficie,
 * medida perpendicular a ellos. Es la distancia a la que el mapa vuelve a
 * decir algo de esa superficie, y por tanto la escala natural con la que medir
 * «cerca» y «lejos» de sus datos.
 */
export function contourReach(surf) {
  const s = (surf?.nodes || []).map((n) => n.s).sort((a, b) => a - b)
  const gaps = []
  for (let i = 1; i < s.length; i++) {
    const g = s[i] - s[i - 1]
    if (g > 1e-6) gaps.push(g)
  }
  if (!gaps.length) return 0
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]
}

/**
 * Dónde tiene el contacto datos propios con los que resolver su geometría:
 * devuelve un peso 1 sobre sus contornos estructurales, que baja a 0 al
 * alejarse de ellos.
 *
 * No son los puntos sueltos sino los **contornos**: una recta de cota conocida
 * resuelve la superficie a lo largo de todo su trazado, no sólo donde la traza
 * cortó la curva de nivel. Por eso la distancia se mide al segmento y no a la
 * nube de cruces.
 *
 * Devuelve `null` cuando la superficie no tiene ningún contorno resuelto: ahí
 * no hay nada propio que conservar y la geometría prestada vale en todas partes.
 */
export function ownSupport(surf, reach) {
  if (!(reach > 0)) return null
  const segs = []
  for (const sc of surf?.structureContours || []) {
    if (!sc.fit || !Number.isFinite(sc.tmin) || !Number.isFinite(sc.tmax)) continue
    const { c, dir } = sc.fit
    segs.push([
      [c[0] + dir[0] * sc.tmin, c[1] + dir[1] * sc.tmin],
      [c[0] + dir[0] * sc.tmax, c[1] + dir[1] * sc.tmax],
    ])
  }
  if (!segs.length) return null
  const near = reach * SUPPORT_NEAR
  const far = reach * SUPPORT_FAR
  return (x, y) => {
    let d = Infinity
    for (const [a, b] of segs) {
      const r = pointSegment([x, y], a, b).d
      if (r < d) d = r
    }
    return fade(d, near, far)
  }
}

/**
 * Ajusta el espesor verdadero que separa una superficie de referencia de un
 * conjunto de puntos observados.
 *
 * Cada punto aporta la ecuación `z_ref(x,y) − e·k(x,y) = z_obs`, con
 * `k = 1/cos δ` el factor que convierte espesor perpendicular en desnivel. Es
 * lineal en `e`, así que la solución de mínimos cuadrados es directa.
 * `offset > 0` sitúa la superficie por debajo de la referencia.
 */
export function fitParallelOffset(reference, points) {
  if (!reference?.sampleAt) return null
  let num = 0
  let den = 0
  const used = []
  for (const p of points) {
    const s = reference.sampleAt(p[0], p[1])
    if (!s || !Number.isFinite(s.z)) continue
    const k = slopeFactor(s.a, s.b)
    const d = s.z - p[2]
    num += k * d
    den += k * k
    used.push([k, d])
  }
  if (!used.length || den < 1e-12) return null
  const offset = num / den
  if (!Number.isFinite(offset)) return null
  let ss = 0
  for (const [k, d] of used) {
    const r = d - offset * k
    ss += r * r
  }
  return { offset, rms: Math.sqrt(ss / used.length), n: used.length }
}

/**
 * Superficie paralela a otra: misma forma, desplazada un espesor verdadero
 * constante. Conserva los datos propios del contacto (sus puntos y sus
 * contornos, aunque sean insuficientes) y sustituye la geometría.
 *
 * Con `info.upgrade` el contacto sí tenía contornos suficientes para medir *un*
 * manteo, pero no para saber cómo varía: entonces sus medidas se respetan tal
 * cual y lo único que se toma prestado es la forma en profundidad.
 *
 * Con `info.support` —el peso que devuelve `ownSupport`— la sustitución deja de
 * ser total y pasa a ser un **relevo**: sobre sus propios contornos manda la
 * superficie medida y lejos de ellos manda la prestada, con una transición
 * suave en medio. Es la regla geológica aplicada donde de verdad hace falta:
 * donde no hay contornos estructurales que resuelvan la geometría, la unidad
 * de abajo sigue a la de encima con espesor constante, en vez de extrapolar un
 * pliegue propio que nadie midió y acabar cortando a su techo.
 */
export function parallelSurface(base, reference, fit, info = {}) {
  const step = Math.max(base?.gradStep || 0, reference?.gradStep || 0, 1e-6)
  const support = info.support || null

  function elevationAt(x, y) {
    const s = reference.sampleAt(x, y)
    if (!s || !Number.isFinite(s.z)) return null
    const z = s.z - fit.offset * slopeFactor(s.a, s.b)
    if (!support) return z
    const w = support(x, y)
    if (w <= 0) return z
    const own = base.elevationAt(x, y)
    if (!Number.isFinite(own)) return z
    return w >= 1 ? own : own * w + z * (1 - w)
  }

  // El manteo de la superficie desplazada no es el de la referencia en el mismo
  // punto: en la charnela de un pliegue paralelo el radio de curvatura cambia.
  // Se toma, por tanto, el gradiente de la superficie que realmente se dibuja.
  function sampleAt(x, y) {
    const z = elevationAt(x, y)
    if (!Number.isFinite(z)) return { z: null, a: 0, b: 0 }
    const xp = elevationAt(x + step, y)
    const xm = elevationAt(x - step, y)
    const yp = elevationAt(x, y + step)
    const ym = elevationAt(x, y - step)
    const a = Number.isFinite(xp) && Number.isFinite(xm) ? (xp - xm) / (2 * step) : 0
    const b = Number.isFinite(yp) && Number.isFinite(ym) ? (yp - ym) / (2 * step) : 0
    return { z, a, b }
  }

  const attitudeAt = (x, y) => {
    const s = sampleAt(x, y)
    if (!Number.isFinite(s.z)) return reference.attitudeAt ? reference.attitudeAt(x, y) : reference.mean
    return attitudeFromGradient(s.a, s.b)
  }

  // La actitud media es la de la referencia: son superficies paralelas. Se
  // publica sin RMS porque no sale de ningún ajuste plano de estos datos. Si el
  // contacto medía la suya, se respeta: es un dato del mapa.
  const mean = info.upgrade
    ? base.mean
    : reference.mean
      ? { ...reference.mean, rms: null, inherited: true }
      : null

  return {
    ...base,
    elevationAt,
    sampleAt,
    attitudeAt,
    mean,
    // Los limbos y sus actitudes son los de la referencia: el contacto heredado
    // tiene, por construcción, el mismo pliegue. Salvo que el contacto tenga los
    // suyos medidos, en cuyo caso se conservan.
    folded: info.upgrade ? base.folded : reference.folded,
    limbCount: info.upgrade ? base.limbCount : reference.limbCount,
    domains: info.upgrade ? base.domains : reference.domains,
    domainAttitudes: info.upgrade ? base.domainAttitudes : reference.domainAttitudes,
    quality: info.upgrade ? base.quality : 'heredada',
    defined: true,
    inherited: {
      ...info,
      // La función de peso no viaja en la ficha: lo que interesa contar es que
      // la geometría prestada sólo manda lejos de los contornos propios.
      support: undefined,
      partial: Boolean(support),
      thickness: Math.abs(fit.offset),
      offset: fit.offset,
      below: fit.offset >= 0,
      rms: fit.rms,
      n: fit.n,
      folded: Boolean(reference.folded),
    },
  }
}

/**
 * Puntos de la superficie con los que fijar el espesor. Los cruces con las
 * curvas de nivel son exactos y se usan siempre que haya al menos tres; si no,
 * se recurre a la traza leída sobre el modelo de elevación, que también son
 * puntos donde la superficie corta la topografía, aunque con el error del
 * relieve interpolado.
 */
export function offsetObservations(surf, dem, step) {
  const exact = surf?.points3D || []
  if (exact.length >= 3) return { points: exact, source: 'curvas' }
  const out = exact.slice()
  if (dem?.valid) {
    for (const tr of surf?.traces || []) {
      if (tr.length < 2) continue
      for (const p of resample(tr, step)) {
        const z = dem.elevationAt(p[0], p[1])
        if (Number.isFinite(z)) out.push([p[0], p[1], z])
      }
    }
  }
  if (!out.length) return null
  return { points: out, source: exact.length === out.length ? 'curvas' : 'traza' }
}

/** ¿Sirve esta superficie para dictar la geometría de otra? */
const canReference = (surf) =>
  Boolean(surf && (surf.inherited || surf.quality === 'ok' || surf.quality === 'manual'))

/** ¿Le faltan datos a este contacto para resolverse por sí solo? */
const needsGeometry = (contact, surf) =>
  Boolean(surf && !surf.inherited && surf.quality !== 'ok' && !contact?.manual)

/** ¿Está el contacto resuelto por sus propios datos? */
const selfResolved = (contact, surf) =>
  Boolean(surf && !surf.inherited && !contact?.manual && surf.quality === 'ok')

/**
 * ¿Tiene el contacto contornos suficientes para un manteo, pero no para saber
 * cómo varía? Es el caso de una traza que sólo corta curvas en un tramo: da un
 * limbo y nada más, y se resuelve como un plano.
 */
const singleDip = (contact, surf) => selfResolved(contact, surf) && !surf.folded

/**
 * Un plano bajo un contacto plegado: el manteo constante es peor respuesta que
 * el pliegue, así que la forma se toma prestada aunque las medidas propias se
 * conserven.
 */
const flatUnderFold = (contact, surf, reference) =>
  singleDip(contact, surf) && Boolean(reference?.folded)

/**
 * ¿Hay algo que **completarle** a un contacto que midió su propio pliegue?
 *
 * Medir cómo varía el manteo no es medirlo en todas partes. Un contacto se
 * ajusta a sus contornos y fuera de ellos extrapola, y extrapolar un pliegue es
 * lo que se va de las manos: a media vuelta de la charnela la superficie propia
 * se aparta cientos de metros de la de encima, la cruza, y la regla de
 * superposición acaba acuñando la unidad contra su propio techo —que es
 * justamente lo que no puede pasar en una serie concordante—.
 *
 * Un plano no tiene ese problema: su extrapolación es una recta y sigue siendo
 * la medida. Por eso esto es sólo para el contacto plegado, y por eso lo medido
 * no se toca: lo prestado entra únicamente donde sus contornos no llegan.
 */
const completesFold = (contact, surf) => selfResolved(contact, surf) && Boolean(surf.folded)

/**
 * Reparte la geometría resuelta entre los contactos que no la tienen.
 *
 * Sólo hacia abajo: cada contacto busca su referencia hacia el techo. Se
 * recorre la pila de techo a base para que la herencia se encadene —si el
 * contacto de arriba ya heredó su forma, el siguiente hacia abajo puede
 * apoyarse en él—. Trabaja bloque a bloque: a través de una falla los espesores
 * se ajustan por separado, con los datos de cada lado.
 *
 * Muta `contactSurfaces` y devuelve la lista de herencias aplicadas.
 */
export function inheritContactGeometry({ contacts, contactSurfaces, dem, tol = 1, side = 1000, zStep = 0 }) {
  const applied = []
  if (!contacts?.length || !contactSurfaces) return applied
  const step = Math.max(tol * 6, side / 200)
  // Desajuste máximo para aceptar la geometría prestada en un contacto que sí
  // resolvió su manteo: media equidistancia, que es la precisión con la que las
  // curvas de nivel sitúan un punto en cota.
  const foldTol = Math.max(zStep * 0.5, tol * 2)

  const surfaceOf = (contactId, block) => contactSurfaces.get(contactId)?.get(block) || null

  /**
   * Superficie realmente resuelta detrás de una referencia. Si la referencia ya
   * es heredada, se salta hasta su origen: las superficies intermedias son la
   * misma geometría desplazada, así que apoyarse en la primera evita encadenar
   * evaluaciones (cada eslabón costaría cinco veces el anterior) sin cambiar el
   * resultado, porque el espesor se ajusta contra ella directamente.
   *
   * La excepción es la referencia sólo **completada**: ésa no es un desplazado
   * rígido de su origen —sobre sus propios contornos manda lo que midió—, así
   * que saltársela cambiaría la forma que se copia. Se usa tal cual, y la
   * cadena se paga.
   */
  const rootOf = (surf, contact) =>
    surf.inherited && !surf.inherited.partial
      ? { surface: surf.inherited.root, contactId: surf.inherited.contactId, name: surf.inherited.name }
      : { surface: surf, contactId: contact.id, name: contact.name }

  /**
   * Intenta resolver el contacto `i` con el contacto resuelto más próximo hacia
   * el techo.
   */
  function inherit(i) {
    const contact = contacts[i]
    const byBlock = contactSurfaces.get(contact.id)
    if (!byBlock) return
    // Los bloques que una falla sellada no separa comparten un mismo objeto de
    // superficie: se hereda una vez por superficie —no por bloque— y el
    // resultado se escribe en todos los suyos, o la herencia los volvería a
    // separar con dos ajustes distintos de la misma geometría.
    const shared = new Map()
    for (const [block, surf] of byBlock) {
      if (!shared.has(surf)) shared.set(surf, [])
      shared.get(surf).push(block)
    }
    for (const [surf, blocksOfSurf] of shared) {
      const block = blocksOfSurf[0]
      const unresolved = needsGeometry(contact, surf)
      // Un contacto ya resuelto toma prestada la forma entera sólo si midió
      // un único manteo bajo un vecino plegado; si midió el pliegue, sólo se
      // le completa lo que le falta fuera de sus contornos.
      if (!unresolved && !selfResolved(contact, surf)) continue
      const obs = offsetObservations(surf, dem, step)
      if (!obs) continue
      for (let j = i + 1; j < contacts.length; j++) {
        const between = contacts[j]
        // La discordancia corta la herencia al llegar a ella: bajo una
        // inconformidad las capas están truncadas y no son paralelas a ella.
        // Es el límite de paquete de `contactPackages`, visto desde abajo: se
        // sube hasta él y no se pasa, así que un contacto nunca toma prestada
        // la forma de otro paquete.
        if (isUnconformable(between)) break
        const ref = surfaceOf(between.id, block)
        if (canReference(ref)) {
          const root = rootOf(ref, between)
          const upgrade = !unresolved
          const complete = upgrade && completesFold(contact, surf)
          if (upgrade && !complete && !flatUnderFold(contact, surf, root.surface)) break
          // Lo medido no se tira cuando de verdad describe la forma: en un
          // contacto que resolvió su propio pliegue, la geometría prestada
          // entra únicamente donde sus contornos no alcanzan (`ownSupport`).
          // Con un solo manteo medido no hay forma que conservar y la prestada
          // vale en todo el bloque; y si no se sabe hasta dónde alcanzan sus
          // contornos, no hay relevo que hacer y se le deja lo suyo.
          const support = complete ? ownSupport(surf, contourReach(surf)) : null
          if (complete && !support) break
          const fit = fitParallelOffset(root.surface, obs.points)
          // Si los datos propios no encajan con un espesor constante respecto
          // del vecino, mandan ellos: la geometría prestada sería una hipótesis
          // peor que la medida.
          if (upgrade && fit && fit.rms > foldTol) break
          if (fit) {
            const heredada = parallelSurface(surf, root.surface, fit, {
              contactId: root.contactId,
              name: root.name,
              root: root.surface,
              block,
              upgrade,
              support,
              source: obs.source,
            })
            for (const b of blocksOfSurf) byBlock.set(b, heredada)
            applied.push({
              contactId: contact.id,
              block,
              referenceId: root.contactId,
              offset: fit.offset,
              upgrade,
              partial: Boolean(complete),
            })
          }
          break
        }
      }
    }
  }

  for (let i = contacts.length - 1; i >= 0; i--) inherit(i)
  return applied
}
