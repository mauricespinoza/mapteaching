// Construye la "escena geológica": convierte todo el proyecto a coordenadas de
// terreno (metros) y resuelve las superficies (contactos y fallas) por bloque
// estructural, el modelo de elevación y las estadísticas para el panel de
// resultados. Es la única capa que conoce a la vez el modelo de datos y el motor.

import { toWorldList, toWorld, toImage } from './georef.js'
import { buildSurface, contourSegment } from './structure.js'
import { inheritContactGeometry } from './parallel.js'
import { buildBlocks, singleBlock } from './blocks.js'
import { buildDem } from './dem.js'
import { polylineIntersections, dist, bboxOf } from './geom.js'
import { sortedUnits, sortedContacts, kinematicsOf } from './model.js'

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
  const d0 = tangentAt(pts[1], pts[0])
  const d1 = tangentAt(pts[pts.length - 2], pts[pts.length - 1])
  return [
    [pts[0][0] + d0[0] * amount, pts[0][1] + d0[1] * amount],
    ...pts,
    [pts[pts.length - 1][0] + d1[0] * amount, pts[pts.length - 1][1] + d1[1] * amount],
  ]
}

function tangentAt(a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l = Math.hypot(dx, dy) || 1
  return [dx / l, dy / l]
}

/**
 * Prolonga una traza de falla **hasta salir del área de trabajo**, por los dos
 * extremos y siguiendo su tangente.
 *
 * Una falla se digitaliza a ojo y el trazo se queda a unos metros del borde;
 * esos metros bastan para que el relleno por inundación se cuele por el hueco,
 * rodee el trazo y devuelva un solo bloque: la falla deja de cortar nada. Con
 * una prolongación fija —un 4 % del mapa— seguía fallando por 20 m en el
 * ejercicio de prueba. Ahora se avanza hasta que el extremo queda fuera del
 * área, que es donde la partición ya está sellada.
 *
 * El avance se corta a `limit`. No es un detalle de implementación: una falla
 * que muere de verdad **dentro** del mapa no debe llegar al borde, porque
 * partiría en dos un bloque que es uno solo. Si el extremo está lejos del borde
 * se prolonga lo que se pueda y la inundación lo rodea, que es lo correcto.
 */
function extendToArea(pts, outside, limit, step) {
  if (pts.length < 2) return pts
  const reach = (from, dir) => {
    let d = 0
    while (d < limit) {
      d += step
      if (outside(from[0] + dir[0] * d, from[1] + dir[1] * d)) return d + step
    }
    return limit
  }
  const a = pts[0]
  const b = pts[pts.length - 1]
  const da = tangentAt(pts[1], a)
  const db = tangentAt(pts[pts.length - 2], b)
  const ra = reach(a, da)
  const rb = reach(b, db)
  return [[a[0] + da[0] * ra, a[1] + da[1] * ra], ...pts, [b[0] + db[0] * rb, b[1] + db[1] * rb]]
}

/** Equidistancia de las curvas: mediana de los saltos entre cotas distintas. */
function contourSpacing(worldContours) {
  const zs = [...new Set(worldContours.map((c) => c.elevation))].sort((a, b) => a - b)
  if (zs.length < 2) return 0
  const gaps = []
  for (let i = 1; i < zs.length; i++) gaps.push(zs[i] - zs[i - 1])
  gaps.sort((a, b) => a - b)
  return gaps[gaps.length >> 1]
}

/**
 * Área de trabajo como predicado en coordenadas mundo, para el modelo de
 * elevación. Es lo mismo que `frameTest` de models.js, pero sin la escena: el
 * relieve se calcula antes de que la escena exista.
 */
function demFrameTest(project, georef) {
  const frame = project?.frame
  if (!frame?.a || !frame?.b) return null
  const x0 = Math.min(frame.a[0], frame.b[0])
  const x1 = Math.max(frame.a[0], frame.b[0])
  const y0 = Math.min(frame.a[1], frame.b[1])
  const y1 = Math.max(frame.a[1], frame.b[1])
  return (wx, wy) => {
    const px = toImage(georef, [wx, wy])
    return px[0] >= x0 && px[0] <= x1 && px[1] >= y0 && px[1] <= y1
  }
}

/**
 * Corrige una superficie de falla para que pase por su traza.
 *
 * El plano se ajusta a los cruces de la traza con las curvas de nivel: pasa por
 * esos puntos, pero entre ellos se aparta —en el ejercicio de prueba hasta 39 m
 * sobre un relieve de 942—. Y sin embargo la traza *entera* está sobre el plano
 * por definición: es donde la falla corta el terreno. Se mide ese residuo a lo
 * largo de la traza y se suma a la superficie, ponderado por la distancia en
 * planta. Como la corrección sólo depende de (x, y), es la misma a cualquier
 * profundidad —se propaga buzamiento abajo—, que es lo que hace un plano.
 *
 * Importa porque esa misma superficie hace tres cosas a la vez: dibujar el plano
 * en 3D, dibujar la falla en el perfil y **cortar las unidades** en los dos. Si
 * el dibujo y el corte no salen de la misma superficie, las unidades aparecen
 * cortadas donde la falla no está.
 */
function anchorToTrace(surf, traces, dem, side) {
  if (!surf?.defined || !dem?.valid) return surf
  const step = Math.max(side * 0.01, 1)
  const anchors = []
  for (const tr of traces) {
    let acc = Infinity
    for (let i = 0; i < tr.length; i++) {
      if (i > 0) acc += dist(tr[i - 1], tr[i])
      if (acc < step) continue
      acc = 0
      const zs = surf.elevationAt(tr[i][0], tr[i][1])
      const zt = dem.elevationAt(tr[i][0], tr[i][1])
      if (Number.isFinite(zs) && Number.isFinite(zt)) anchors.push([tr[i][0], tr[i][1], zt - zs])
    }
  }
  if (!anchors.length) return surf
  // Núcleo suave del ancho del muestreo: junto a la traza manda el residuo de
  // ahí mismo, y lejos se mezclan los vecinos sin saltos donde la traza dobla.
  const h2 = step * step
  const correction = (x, y) => {
    let w = 0
    let s = 0
    for (const a of anchors) {
      const dx = a[0] - x
      const dy = a[1] - y
      const d2 = dx * dx + dy * dy + h2
      const k = 1 / (d2 * d2)
      w += k
      s += k * a[2]
    }
    return w > 0 ? s / w : 0
  }
  return {
    ...surf,
    elevationAt: (x, y) => {
      const v = surf.elevationAt(x, y)
      return Number.isFinite(v) ? v + correction(x, y) : v
    },
  }
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

  // Partición en bloques. El área de trabajo es la que manda: fuera de ella no
  // hay ejercicio, así que su exterior es muro, y las trazas de falla se
  // prolongan hasta salir de ella para que la partición quede sellada aunque el
  // trazo se haya quedado a unos metros del borde.
  const cell = project.settings.blockCell || side / 220
  const inArea = demFrameTest(project, georef)
  const outsideArea = inArea ? (x, y) => !inArea(x, y) : null
  // Sin marco definido, el área es la extensión de todo lo digitalizado: el
  // margen que la grilla añade alrededor hace de exterior.
  const outsideBox = (x, y) => x < bbox.minX || x > bbox.maxX || y < bbox.minY || y > bbox.maxY
  const outside = outsideArea || outsideBox
  const extended = faultPolys.map((pts) => extendToArea(pts, outside, side * 0.25, cell))
  const blocks = faultPolys.length ? buildBlocks(extended, bbox, cell, outside) : singleBlock()

  // Modelo de elevación a partir de las curvas. Se agrupan por cota y se pasan
  // como polilíneas: el motor las rasteriza él mismo para que cada curva quede
  // continua y separe de verdad las dos laderas que tiene a los lados.
  // No hay interfaz para esta resolución, así que un 200 guardado es el valor
  // por defecto antiguo: se sube el suelo para que los ejercicios ya creados
  // también ganen el relieve fino.
  const res = Math.max(project.settings.demResolution || 0, 300)
  const merged = new Map()
  for (const c of worldContours) {
    if (!merged.has(c.elevation)) merged.set(c.elevation, [])
    merged.get(c.elevation).push(c.pts)
  }
  // La grilla cubre toda la imagen, pero las curvas sólo se digitalizan dentro
  // del área de trabajo. Sin decírselo, el margen vacío que queda alrededor es
  // un pasillo abierto que une todas las bandas de cota y el relieve se calcula
  // a ciegas. (Es el mismo criterio que usa el mapa de unidades.)
  const dem = buildDem(
    [...merged.entries()].map(([elevation, lines]) => ({ elevation, lines })),
    bbox,
    res,
    project.settings.demSmoothing ?? 2,
    demFrameTest(project, georef)
  )

  /**
   * Contornos estructurales puestos a mano, en coordenadas mundo y repartidos
   * por bloque: al otro lado de una falla la superficie es otra, así que una
   * curva dibujada aquí no manda allí.
   */
  const manualContoursByBlock = (feature) => {
    const out = new Map()
    for (const sc of feature.structureContours || []) {
      if (!sc?.pts || sc.pts.length < 2 || !Number.isFinite(sc.elevation)) continue
      const [a, b] = toWorldList(georef, [sc.pts[0], sc.pts[sc.pts.length - 1]])
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const block = blocks.blockAt(mid[0], mid[1])
      if (!out.has(block)) out.set(block, [])
      out.get(block).push({ id: sc.id, elevation: sc.elevation, a, b })
    }
    return out
  }

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
    // Un contorno dibujado a mano define la superficie aunque en ese bloque no
    // haya traza: es un dato del estudiante y basta para resolverla.
    const manualByBlock = manualContoursByBlock(cw.contact)
    for (const block of manualByBlock.keys()) if (!byBlock.has(block)) byBlock.set(block, [])
    const surfaces = new Map()
    for (const [block, traces] of byBlock) {
      surfaces.set(
        block,
        buildSurface({
          traces,
          contours: worldContours,
          manual: cw.contact.manual,
          manualContours: manualByBlock.get(block) || [],
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
    const manualSc = [...manualContoursByBlock(fw.fault).values()].flat()
    if (!fw.traces.length && !manualSc.length) continue
    const surf = buildSurface({
      traces: fw.traces,
      contours: worldContours,
      manual: fw.fault.manual,
      manualContours: manualSc,
      name: fw.fault.name,
      tol,
    })
    faultSurfaces.set(fw.id, anchorToTrace(surf, fw.traces, dem, side))
  }

  // ---- Con qué falla y de qué lado limita cada bloque ----
  //
  // Los bloques se etiquetan en planta, sobre la traza de la falla, y eso vale
  // en la superficie: la traza es justo donde el plano de falla corta el
  // terreno. Pero en profundidad el plano se va de lado, y quedarse con la
  // etiqueta de planta equivale a cortar las unidades a plomo bajo la traza,
  // como si toda falla fuera vertical.
  //
  // El criterio correcto no es en qué lado de la *traza* está un punto sino de
  // qué lado del *plano* está: (x, y, z) queda por encima de la falla si
  // z > z_falla(x, y). Cada bloque está entero a un lado de ese plano, y saber
  // a cuál basta para cortar bien a cualquier profundidad. Se averigua a un
  // paso a cada lado de la traza: allí donde el plano se hunde bajo el terreno
  // hay roca *sobre* la falla —ése es el bloque de encima—, y donde se levanta
  // y ya está erosionado sólo queda roca *bajo* ella.
  const faultCuts = []
  const blockSides = new Map()
  {
    const probe = Math.max(cell * 3, side * 0.004)
    const votes = new Map()
    const key = (block, faultId) => `${block}|${faultId}`
    for (const fw of faultWorld) {
      const surf = faultSurfaces.get(fw.id)
      if (!surf?.defined) continue
      let used = false
      for (const tr of fw.traces) {
        for (let i = 1; i < tr.length; i++) {
          const a = tr[i - 1]
          const b = tr[i]
          const len = Math.hypot(b[0] - a[0], b[1] - a[1])
          if (len < 1e-9) continue
          const ux = -(b[1] - a[1]) / len
          const uy = (b[0] - a[0]) / len
          const mx = (a[0] + b[0]) / 2
          const my = (a[1] + b[1]) / 2
          const p = [mx + ux * probe, my + uy * probe]
          const q = [mx - ux * probe, my - uy * probe]
          const zp = surf.elevationAt(p[0], p[1])
          const zq = surf.elevationAt(q[0], q[1])
          if (!Number.isFinite(zp) || !Number.isFinite(zq) || Math.abs(zp - zq) < tol) continue
          const bp = blocks.blockAt(p[0], p[1])
          const bq = blocks.blockAt(q[0], q[1])
          // Si a los dos lados hay el mismo bloque, aquí la falla no separa
          // nada (se está fuera de su extremo) y el punto no dice nada.
          if (!bp || !bq || bp === bq) continue
          const above = zp < zq ? bp : bq
          const below = zp < zq ? bq : bp
          for (const [block, s] of [
            [above, 1],
            [below, -1],
          ]) {
            const k = key(block, fw.id)
            const v = votes.get(k) || [0, 0]
            v[s > 0 ? 0 : 1]++
            votes.set(k, v)
          }
          used = true
        }
      }
      if (used) faultCuts.push({ id: fw.id, surf })
    }
    // Un bloque con votos repartidos no está limpiamente a un lado —la falla se
    // acaba dentro de él— y entonces esa falla no lo corta.
    for (const [k, [plus, minus]] of votes) {
      const total = plus + minus
      if (plus >= total * 0.8) blockSides.set(k, 1)
      else if (minus >= total * 0.8) blockSides.set(k, -1)
    }
  }

  /**
   * ¿Pertenece el punto (x, y, z) al bloque `block`? Lo decide el lado del
   * plano de cada falla que lo limita, así que el corte sigue la falla en
   * profundidad en vez de bajar recto desde su traza.
   */
  function belongsToBlock(block, x, y, z) {
    if (!faultCuts.length) return true
    for (const cut of faultCuts) {
      const want = blockSides.get(`${block}|${cut.id}`)
      if (!want) continue
      const zf = cut.surf.elevationAt(x, y)
      if (!Number.isFinite(zf)) continue
      if ((z > zf ? 1 : -1) !== want) return false
    }
    return true
  }

  const units = sortedUnits(project)
  const contacts = sortedContacts(project)

  // Unidades sin datos propios: heredan el pliegue de la unidad de encima con
  // espesor constante. Va después del modelo de elevación porque, cuando un
  // contacto no cruza ninguna curva de nivel, el espesor se ajusta leyendo su
  // traza sobre el relieve.
  const zStep = contourSpacing(worldContours)
  const inherited = inheritContactGeometry({ contacts, contactSurfaces, dem, tol, side, zStep })

  /**
   * Regla de superposición: **la superficie joven manda y la vieja se limita
   * contra ella.**
   *
   * Cada contacto se ajusta a sus propios datos, así que lejos de ellos se
   * extrapola a su aire y dos superficies acaban cruzándose. En este ejercicio
   * pasa en la cuarta parte del mapa. La solución de antes era un ajuste
   * monótono que repartía el desacuerdo a medias entre las dos, y eso es lo que
   * no puede ser: la de encima es la más joven —se depositó después—, y una
   * capa depositada después no la deforma la que tiene debajo. En una
   * discordancia angular la superficie joven pasa entera por encima y las
   * antiguas, plegadas, quedan cortadas contra ella; el mapa de subafloramiento
   * es justo el rastro de ese corte.
   *
   * Así que la pila se recorre de techo a muro y cada contacto se baja hasta el
   * de encima si lo sobrepasa. La superficie joven no se mueve ni un metro
   * —antes se hundía hasta 174 m en este ejercicio— y la antigua se acuña
   * contra ella. Donde eso ocurre el contacto viejo ya no existe: `cut` lo
   * marca para que no se dibuje su línea ni su superficie, aunque su cota siga
   * ahí para que la unidad de debajo sepa dónde termina.
   *
   * `room` es lo mismo pero medido: cuánto sitio le queda al contacto por
   * debajo de la superficie joven más baja que tiene encima. Cambia de signo
   * justo en la línea de subafloramiento, así que quien dibuja en una malla
   * puede cortar ahí exactamente en vez de en el borde de la celda.
   */
  const truncate = (values) => {
    const z = values.slice()
    const cut = new Array(values.length).fill(false)
    const room = new Array(values.length).fill(Infinity)
    let lid = Infinity
    for (let i = z.length - 1; i >= 0; i--) {
      room[i] = lid - values[i]
      if (z[i] > lid) {
        z[i] = lid
        cut[i] = true
      }
      lid = z[i]
    }
    return { z, cut, room }
  }

  /**
   * Pila estratigráfica en un punto: la cota de cada contacto, resuelto en el
   * bloque que le toca, con la regla de superposición ya aplicada (ver
   * `truncate`). Devuelve `z` —la cota de cada contacto, o `null` si ahí no hay
   * superficie resuelta—, `cut` —qué contactos ha cortado uno más joven, y por
   * tanto no existen en ese punto— y `room` —el margen que le queda a cada uno
   * bajo la superficie que lo corta, negativo donde está cortado—.
   *
   * El resultado se guarda para la última consulta: quien recorre una grilla
   * suele pedir todos los contactos del mismo punto, uno tras otro. Los arrays
   * devueltos se reutilizan, así que hay que leerlos antes de la siguiente
   * llamada.
   *
   * Con `forceBlock` se pide la pila de un bloque concreto aunque el punto caiga
   * en planta sobre otro: es lo que hace falta bajo una falla inclinada, donde
   * el bloque de un lado se mete por debajo del de enfrente.
   */
  const stackCache = { x: NaN, y: NaN, block: null, z: [], cut: [], room: [] }
  function stackAt(x, y, forceBlock) {
    const block = forceBlock || blocks.blockAt(x, y)
    if (x === stackCache.x && y === stackCache.y && block === stackCache.block) return stackCache
    const raw = []
    const idx = []
    const z = new Array(contacts.length).fill(null)
    const cut = new Array(contacts.length).fill(false)
    const room = new Array(contacts.length).fill(null)
    for (let i = 0; i < contacts.length; i++) {
      const surf = contactSurfaces.get(contacts[i].id)?.get(block)
      if (!surf?.defined) continue
      const v = surf.elevationAt(x, y)
      if (!Number.isFinite(v)) continue
      idx.push(i)
      raw.push(v)
    }
    const fixed = truncate(raw)
    for (let k = 0; k < idx.length; k++) {
      z[idx[k]] = fixed.z[k]
      cut[idx[k]] = fixed.cut[k]
      room[idx[k]] = fixed.room[k]
    }
    stackCache.x = x
    stackCache.y = y
    stackCache.block = block
    stackCache.z = z
    stackCache.cut = cut
    stackCache.room = room
    return stackCache
  }

  const contactIndex = new Map(contacts.map((c, i) => [c.id, i]))

  return {
    ready,
    georef,
    bbox,
    side,
    tol,
    mpp,
    blocks,
    /** Fallas que cortan bloques, con su superficie: el corte en profundidad. */
    faultCuts,
    /** Lado de cada falla (+1 encima, −1 debajo) en que queda cada bloque. */
    blockSideOf: (block, faultId) => blockSides.get(`${block}|${faultId}`) || 0,
    belongsToBlock,
    dem,
    worldContours,
    contactSurfaces,
    inherited,
    faultSurfaces,
    faultWorld,
    contactWorld,
    units,
    contacts,
    project,
    stackAt,
    contactIndex,
    /**
     * Cota de un contacto en un punto, ya con la regla de superposición
     * aplicada, o `null` si allí el contacto no existe —lo ha cortado uno más
     * joven—. Es lo que deben usar el mapa geológico, el perfil, el 3D y los
     * pozos.
     */
    contactElevationAt(contactId, x, y) {
      const i = contactIndex.get(contactId)
      if (i == null) return null
      const st = stackAt(x, y)
      return st.cut[i] ? null : st.z[i]
    },
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

/**
 * Contornos estructurales dibujables, en píxeles de imagen: lo que se pinta en
 * el mapa y lo que se puede tocar para editarlo. Reúne los que calcula el motor
 * y los que el estudiante ha puesto a mano, con el rasgo y la cota que
 * representan, que es lo que va en su rótulo.
 */
export function structureContourItems(scene) {
  if (!scene?.ready) return []
  const out = []
  const collect = (kind, feature, color, block, surf) => {
    for (const sc of surf.structureContours || []) {
      if (!sc.fit) continue
      // El contorno calculado se prolonga un poco más allá de sus puntos, que es
      // como se dibuja a mano; el puesto por el estudiante se dibuja exactamente
      // donde lo trazó, ni un píxel más.
      const seg = contourSegment(sc, null, sc.manualId ? 0 : 0.15)
      if (!seg) continue
      out.push({
        key: `${kind}:${feature.id}:${block}:${sc.elevation}:${sc.limb}:${sc.manualId || ''}`,
        kind,
        featureId: feature.id,
        name: feature.name,
        color,
        block,
        elevation: sc.elevation,
        limb: sc.limb,
        manualId: sc.manualId || null,
        n: sc.n,
        a: toImage(scene.georef, seg[0]),
        b: toImage(scene.georef, seg[1]),
        points: sc.points.map((p) => toImage(scene.georef, p)),
      })
    }
  }
  for (const c of scene.contacts) {
    const byBlock = scene.contactSurfaces.get(c.id)
    if (!byBlock) continue
    for (const [block, surf] of byBlock) collect('contact', c, c.color || '#0f172a', block, surf)
  }
  for (const f of scene.project.faults) {
    const surf = scene.faultSurfaces.get(f.id)
    if (surf) collect('fault', f, kinematicsOf(f.kinematics).color, null, surf)
  }
  return out
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
