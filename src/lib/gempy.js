// Exportación del ejercicio a GemPy, y de paso a QGIS.
//
// GemPy no se come una malla: se come dos tablas. Los **puntos de superficie**
// —dónde se sabe que pasa cada contacto— y las **orientaciones** —cómo está
// puesta la superficie ahí—, más el orden estratigráfico y qué elementos son
// fallas. Con eso interpola su propio campo potencial y construye el modelo. La
// malla que dibuja la vista 3D de esta app no le sirve de entrada; es una
// respuesta, no una pregunta.
//
// Y resulta que este ejercicio ya tiene exactamente esos dos datos, medidos:
//
//  - los puntos donde la traza de un contacto corta una curva de nivel son
//    puntos de cota conocida sobre esa superficie —son la materia prima de todo
//    lo que hace esta app—, y son ni más ni menos que los `surface_points`;
//  - el manteo que sale de cada par de contornos estructurales consecutivos,
//    puesto a medio camino entre los dos, son las `orientations`.
//
// Así que la exportación no inventa nada: entrega lo que ya está medido, en el
// orden y con los nombres que GemPy espera.
//
// **Coordenadas.** Van en metros locales: X al Este, Y al Norte, ambos con el
// norte y la escala que el usuario calibró en el mapa, y Z en metros sobre el
// nivel del mar, que sí es absoluta porque sale de las cotas de las curvas. No
// se declara ningún sistema de referencia porque para lo que se va a hacer con
// esto no hace falta: ni GemPy ni la mesa de realidad aumentada usan un CRS —el
// modelo se remapea al volumen físico de la caja— y una traslación no cambia
// ninguna geometría. Quien quiera después llevarlo a un CRS, le suma el offset a
// las dos columnas y ya está; el LÉEME del paquete lo explica.

import { contactPackages, isUnconformable, sortedContacts, sortedUnits } from './model.js'
import { frameTest, modelExtent } from './models.js'

/** Nombre utilizable como identificador en GemPy y en un nombre de archivo. */
export function safeName(name, fallback = 'sin_nombre') {
  const s = String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // sin tildes
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return s || fallback
}

const num = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '')

/**
 * Nombres únicos: dos contactos pueden llamarse igual, y en GemPy el nombre es
 * la identidad de la superficie. Si se repiten, el modelo funde dos horizontes
 * distintos en uno.
 */
function uniqueNames(items) {
  const used = new Map()
  const out = new Map()
  for (const it of items) {
    let base = safeName(it.name, it.kind === 'fault' ? 'Falla' : 'Contacto')
    const n = (used.get(base) || 0) + 1
    used.set(base, n)
    out.set(it.id, n === 1 ? base : `${base}_${n}`)
  }
  return out
}

/**
 * Nombre de un elemento de GemPy tal cual va en los CSV: se respeta el que tiene
 * la unidad en el mapa —espacios y tildes incluidos, que es lo que se lee en la
 * leyenda—, y sólo se quita lo que rompería una tabla separada por comas.
 */
function elementName(name, fallback) {
  const s = String(name || '')
    .replace(/[,"\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s || fallback
}

/**
 * Nombre de cada superficie **en GemPy**, que no es el del contacto sino el de
 * la unidad que queda encima.
 *
 * GemPy le da al volumen que queda sobre una superficie el nombre de esa
 * superficie, y llama `basement` a lo que queda bajo la más antigua. Con el
 * nombre del contacto, la leyenda del modelo muestra contactos —«Unidad_1_
 * Unidad_2»— donde tiene que decir unidades. Así que cada contacto se llama
 * como su unidad de arriba.
 *
 * Las excepciones: las fallas conservan el suyo, y si dos contactos tienen la
 * misma unidad de arriba —una cobertura discordante sobre dos unidades
 * distintas— esos se quedan con el nombre del contacto, porque en GemPy el
 * nombre es la identidad y con uno solo se fundirían en una superficie.
 */
function gempyNames(contacts, faults, names, unitName) {
  const upperCount = new Map()
  for (const c of contacts) {
    if (c.upperUnitId) upperCount.set(c.upperUnitId, (upperCount.get(c.upperUnitId) || 0) + 1)
  }
  const out = new Map()
  // `basement` lo pone GemPy; nadie más puede llamarse así.
  const used = new Set(['basement'])
  const claim = (id, base) => {
    let name = base
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}_${n}`
    used.add(name.toLowerCase())
    out.set(id, name)
  }
  for (const f of faults) claim(f.id, names.get(f.id))
  for (const c of contacts) {
    const upper = upperCount.get(c.upperUnitId) === 1 ? unitName(c.upperUnitId) : null
    claim(c.id, upper ? elementName(upper, names.get(c.id)) : names.get(c.id))
  }
  return out
}

/**
 * Todo lo que se exporta, reunido: qué superficies hay, con qué nombre, sus
 * puntos y sus orientaciones. El resto de las funciones de este módulo se
 * limitan a darle formato.
 */
export function gempyData(scene) {
  const contacts = sortedContacts(scene.project)
  const faults = scene.project.faults || []
  const names = uniqueNames([
    ...contacts.map((c) => ({ id: c.id, name: c.name, kind: 'contact' })),
    ...faults.map((f) => ({ id: f.id, name: f.name, kind: 'fault' })),
  ])
  const units = sortedUnits(scene.project)
  const unitById = new Map(units.map((u) => [u.id, u]))
  const gNames = gempyNames(contacts, faults, names, (id) => unitById.get(id)?.name)
  const packages = contactPackages(scene.project)
  const inFrame = frameTest(scene)
  const keep = (p) => !inFrame || inFrame(p[0], p[1])
  // El origen local de la app es la esquina de la imagen, y el área de trabajo
  // suele quedar al sur de ella: tal cual, la mitad de las coordenadas salen
  // negativas. Se corren para que el modelo empiece en (0, 0), que además deja
  // el `extent` en la forma que la mesa espera —ancho, largo y alto desde
  // cero—. Es una traslación, así que no cambia ninguna geometría; queda
  // anotada en `model.json` por si hay que deshacerla.
  const ext = modelExtent(scene)
  const shift = [-ext.minX, -ext.minY]
  const mv = (p) => [p[0] + shift[0], p[1] + shift[1], p[2]]

  const surfaces = []

  for (const c of contacts) {
    const byBlock = scene.contactSurfaces.get(c.id)
    if (!byBlock) continue
    const points = []
    const orientations = []
    // Los bloques de falla comparten superficie: en GemPy la falla es otra
    // serie que la desplaza, así que el contacto es uno solo y sus puntos van
    // todos juntos. Lo que no se puede es mezclar sus *orientaciones* en una
    // media —cada panel entrega la suya, con su sitio.
    // Por superficie y no por bloque: los bloques que una falla sellada no
    // separa comparten una sola superficie y recorrerla dos veces entregaría
    // cada punto y cada orientación repetidos.
    for (const surf of new Set(byBlock.values())) {
      for (const p of surf.points3D) if (keep(p)) points.push(mv(p))
      for (const a of pairOrientations(surf, shift)) if (keep([a.x, a.y])) orientations.push(a)
    }
    if (!points.length) continue
    surfaces.push({
      id: c.id,
      kind: 'contact',
      name: names.get(c.id),
      gempyName: gNames.get(c.id),
      label: c.name,
      color: c.color,
      // En GemPy el color es el del volumen de encima, o sea, el de la unidad.
      gempyColor: unitById.get(c.upperUnitId)?.color || c.color,
      type: c.type,
      pkg: packages.get(c.id) || 0,
      folded: [...byBlock.values()].some((surf) => surf.folded),
      lowerUnitId: c.lowerUnitId,
      upperUnitId: c.upperUnitId,
      points,
      orientations,
      // Sin ningún panel confirmado no habría orientación para esta superficie,
      // y GemPy necesita al menos una por serie. Se cae a la actitud media, que
      // es más pobre pero es un dato: se marca como tal para que se note.
      fallback: orientations.length ? null : meanFallback(byBlock, shift),
    })
  }

  for (const f of faults) {
    const surf = scene.faultSurfaces.get(f.id)
    if (!surf) continue
    const points = surf.points3D.filter(keep).map(mv)
    if (!points.length) continue
    const orientations = pairOrientations(surf, shift).filter((a) => keep([a.x, a.y]))
    surfaces.push({
      id: f.id,
      kind: 'fault',
      name: names.get(f.id),
      gempyName: gNames.get(f.id),
      label: f.name,
      color: '#444444',
      gempyColor: '#444444',
      folded: Boolean(surf.folded),
      kinematics: f.kinematics,
      points,
      orientations,
      fallback: orientations.length ? null : meanFallback(new Map([[0, surf]]), shift),
    })
  }

  return { surfaces, contacts, faults, units, shift, extent: ext }
}

/**
 * Las orientaciones, de donde de verdad las mide esta app: **el manteo entre dos
 * contornos estructurales consecutivos**, colocado a medio camino entre los dos.
 *
 * Es la medida que el ejercicio enseña a hacer —la separación horizontal entre
 * dos contornos de cota conocida da el manteo, y su dirección da el rumbo—, y es
 * local: describe la franja donde se hizo, no la superficie entera.
 *
 * La alternativa era ajustar un plano a cada panel y entregar su actitud. Se
 * probó y sale bastante peor, y por una razón que se entiende: un panel puede
 * enhebrar puntos de varias ondas de un tren de pliegues —los de las charnelas,
 * que están casi a la misma cota— y el plano que sale de ahí describe la
 * envolvente de las crestas, no un limbo. Medido contra pliegues sintéticos de
 * actitud conocida, el error de manteo del plano del panel llegaba a 42° de
 * mediana donde el del par de contornos se quedaba en 12°. Además el par hereda
 * todos los filtros del contorno, que ya no publica rumbos que no ha medido.
 */
function pairOrientations(surf, shift) {
  const out = []
  for (const pr of surf.pairs || []) {
    if (!pr.at || !Number.isFinite(pr.dip) || !Number.isFinite(pr.dipDir)) continue
    out.push({
      x: pr.at[0] + shift[0],
      y: pr.at[1] + shift[1],
      z: pr.at[2],
      dip: pr.dip,
      dipDir: pr.dipDir,
      n: pr.nPoints,
      manual: pr.manual,
      cotas: [pr.z1, pr.z2],
    })
  }
  return out
}

/**
 * Actitud media de la superficie, situada en el centroide de sus puntos: el
 * respaldo para cuando no hay ni un par de contornos.
 *
 * Que sea un mal dato o el mejor posible depende de una sola cosa. En una
 * superficie que no está plegada, la media *es* su actitud, y con pocos cruces
 * es además todo lo que el mapa da de sí. En una plegada, la media promedia dos
 * flancos y describe un sitio que no existe. Por eso se marca `plegada`: el
 * LÉEME sólo avisa de las segundas.
 */
function meanFallback(byBlock, shift) {
  for (const [, surf] of byBlock) {
    const m = surf.mean
    if (!m || !Number.isFinite(m.dip) || !surf.points3D.length) continue
    const g = surf.points3D
    const x = g.reduce((a, p) => a + p[0], 0) / g.length
    const y = g.reduce((a, p) => a + p[1], 0) / g.length
    const z = surf.elevationAt(x, y)
    if (!Number.isFinite(z)) continue
    return {
      x: x + shift[0],
      y: y + shift[1],
      z,
      dip: m.dip,
      dipDir: m.dipDir,
      n: g.length,
      media: true,
      plegada: Boolean(surf.folded),
    }
  }
  return null
}

/**
 * `surface_points.csv`.
 *
 * El nombre va **una sola vez**, en `formation`, que es como lo llaman tanto
 * GemPy 2 como GemPy 3. Repetirlo como `surface` rompe la 3: al leer, renombra
 * `surface` a `formation`, quedan dos columnas con el mismo nombre y falla. Por
 * lo mismo ninguna otra columna puede llamarse como algo que GemPy renombra
 * (`surface`, `x`, `Azimuth`, `G_x`…).
 */
export function surfacePointsCsv(data) {
  const rows = ['X,Y,Z,formation']
  for (const s of data.surfaces) {
    for (const p of s.points) rows.push(`${num(p[0])},${num(p[1])},${num(p[2])},${s.gempyName}`)
  }
  return rows.join('\n') + '\n'
}

/**
 * `orientations.csv`. `azimuth` es la dirección de manteo y `polarity` vale 1:
 * la unidad de arriba del contacto es la joven, que es como está definida la
 * pila en esta app, así que el polo apunta al techo en todas.
 */
export function orientationsCsv(data) {
  const rows = ['X,Y,Z,azimuth,dip,polarity,formation,origen']
  for (const s of data.surfaces) {
    const list = s.orientations.length ? s.orientations : s.fallback ? [s.fallback] : []
    for (const a of list) {
      const origen = a.media
        ? 'actitud media de la superficie'
        : `${a.manual ? 'contornos a mano' : 'contornos'} ${a.cotas[0]}-${a.cotas[1]} m`
      rows.push(
        `${num(a.x)},${num(a.y)},${num(a.z)},${num(a.dipDir, 1)},${num(a.dip, 1)},1,${s.gempyName},${origen}`
      )
    }
  }
  return rows.join('\n') + '\n'
}

/**
 * `model.json`: todo lo que las dos tablas no dicen y GemPy necesita saber —el
 * cubo que ocupa el modelo, el orden de las series y qué elementos son fallas.
 *
 * El orden importa y es fácil equivocarlo: dentro de una serie, GemPy espera
 * las superficies **de la más joven a la más antigua**. En esta app los
 * contactos vienen ordenados de base a techo, así que se dan la vuelta.
 */
export function modelJson(project, scene, data, opts = {}) {
  const ext = data.extent
  const dem = scene.dem
  const zRange = Math.max(1, dem.zmax - dem.zmin)
  // La misma profundidad que usa la vista 3D, para que el cubo exportado sea el
  // que se ha estado mirando en pantalla.
  const depth = Math.min(opts.depth || project.settings?.sectionDepth || 2000, Math.max(400, zRange * 1.4))
  const zMin = Math.round(dem.zmin - depth)
  const zMax = Math.round(dem.zmax + (dem.zmax - dem.zmin) * 0.05)
  const contactos = data.surfaces.filter((s) => s.kind === 'contact')
  const fallas = data.surfaces.filter((s) => s.kind === 'fault')
  const unitOf = (id) => data.units.find((u) => u.id === id) || null
  const unitName = (id) => unitOf(id)?.name || null

  // Una serie estratigráfica por paquete: cada discordancia abre uno nuevo, y
  // en GemPy una discordancia es justamente el límite entre dos series —la de
  // arriba erosiona a la de abajo—. Sin discordancias es una sola serie.
  const paquetes = [...new Set(contactos.map((c) => c.pkg))].sort((a, b) => a - b)
  const estratigrafia = paquetes
    .map((pkg, i) => {
      const cs = contactos.filter((c) => c.pkg === pkg)
      const serie = {
        nombre: paquetes.length > 1 ? `Estratigrafia_${i + 1}` : 'Estratigrafia',
        es_falla: false,
        // De la más joven a la más antigua, que es como las pide GemPy.
        superficies: cs.map((c) => c.gempyName).reverse(),
      }
      // La app sólo sabe que la base del paquete es una inconformidad: una
      // superficie labrada, que corta lo de abajo. Eso es «erosiva» (ERODE). Si
      // no se sabe, se omite y GemPy pone ERODE por su cuenta.
      if (i > 0 && cs[0].type === 'discordante') serie.relacion = 'erosiva'
      return serie
    })
    .reverse()

  // Lo que queda bajo el contacto más antiguo de la última serie: en GemPy es
  // `basement`, y sin color propio saldría con el que GemPy elija.
  const base = contactos.find((c) => c.pkg === paquetes[0])
  const baseUnit = base ? unitOf(base.lowerUnitId) : null

  return {
    version_formato: 2,
    nombre: project.name,
    generado: new Date().toISOString(),
    generado_por: 'MapTeaching',
    coordenadas: {
      sistema: 'local',
      unidades: 'm',
      x: 'Este',
      y: 'Norte',
      z: 'cota sobre el nivel del mar',
      origen: 'esquina suroeste del área de trabajo',
      nota:
        'Métricas y orientadas al norte verdadero. Ni GemPy ni la mesa de realidad ' +
        'aumentada necesitan un CRS: una traslación no cambia ninguna geometría. Para ' +
        'llevarlas a un sistema de referencia, súmale a X e Y las coordenadas absolutas ' +
        'de esa esquina.',
      metros_por_pixel: scene.mpp,
    },
    extent: [0, Math.round(ext.maxX - ext.minX), 0, Math.round(ext.maxY - ext.minY), zMin, zMax],
    resolution: opts.resolution || [50, 50, 50],
    // La mesa de realidad aumentada recalcula el modelo entero en cada cuadro,
    // y a 50³ no llega.
    resolution_mesa: [20, 20, 20],
    // Una serie por falla —en GemPy cada falla es su propia serie y desplaza a
    // las que vienen después— y después la pila, de la más joven a la más
    // antigua.
    series: [
      ...fallas.map((f) => ({
        nombre: `Falla_${f.name}`,
        es_falla: true,
        superficies: [f.gempyName],
        cinematica: f.kinematics || null,
      })),
      ...estratigrafia,
    ],
    basamento: baseUnit ? { unidad: baseUnit.name, color: baseUnit.color } : null,
    superficies: data.surfaces.map((s) => ({
      nombre: s.name,
      elemento_gempy: s.gempyName,
      etiqueta: s.label,
      tipo: s.kind === 'fault' ? 'falla' : s.type || 'concordante',
      color: s.color,
      color_elemento: s.gempyColor,
      plegada: Boolean(s.folded),
      unidad_abajo: s.kind === 'contact' ? unitName(s.lowerUnitId) : null,
      unidad_arriba: s.kind === 'contact' ? unitName(s.upperUnitId) : null,
      n_puntos: s.points.length,
      n_orientaciones: s.orientations.length || (s.fallback ? 1 : 0),
      orientacion_de_respaldo: Boolean(s.fallback),
    })),
    unidades: data.units.map((u, i) => ({ orden: i, nombre: u.name, color: u.color, litologia: u.lithology || null })),
    topografia: 'dem.asc',
  }
}

/**
 * Relieve en ESRI ASCII Grid: lo lee el guion de GemPy para poner la
 * topografía, y lo lee QGIS como ráster sin más. Las filas van de norte a sur,
 * que es al revés que la grilla del modelo de elevación.
 *
 * Cubre **exactamente** el cubo del modelo en planta —`xllcorner` y
 * `yllcorner` son su esquina, y ancho y alto son los suyos— y no lleva ni un
 * NODATA: GemPy pone un punto de topografía por celda y no sabe qué hacer con
 * un -9999. Las celdas que caen fuera del marco de trabajo (un marco girado
 * respecto del norte deja esquinas fuera) toman la cota del vecino válido más
 * cercano.
 *
 * Como las celdas del formato son cuadradas y el cubo no tiene por qué serlo,
 * se busca un número de columnas cerca de la resolución del relieve con el que
 * también las filas cierren justas. El ancho cierra exacto; el alto, con un
 * desajuste de una fracción de celda en el borde norte —en el peor caso media
 * celda, en la práctica bastante menos—.
 *
 * Para la mesa de realidad aumentada esto sobra: allí la topografía es la
 * arena, y el módulo corta el modelo contra lo que lee el sensor.
 */
export function demAsc(scene, shift = [0, 0], extent = null) {
  const d = scene.dem
  if (!d?.valid) return null
  const [x0, x1, y0, y1] = extent || [
    d.bbox.minX + shift[0],
    d.bbox.maxX + shift[0],
    d.bbox.minY + shift[1],
    d.bbox.maxY + shift[1],
  ]
  const { ncols, nrows, cell } = demGrid(x1 - x0, y1 - y0, d.cell)
  const inFrame = frameTest(scene)
  const z = new Float64Array(ncols * nrows).fill(NaN)
  for (let j = 0; j < nrows; j++) {
    for (let i = 0; i < ncols; i++) {
      // Centro de la celda, de vuelta en coordenadas de la app.
      const x = x0 + (i + 0.5) * cell - shift[0]
      const y = y0 + (j + 0.5) * cell - shift[1]
      if (inFrame && !inFrame(x, y)) continue
      const v = d.elevationAt(x, y)
      if (Number.isFinite(v)) z[j * ncols + i] = v
    }
  }
  if (!fillNearest(z, ncols, nrows)) return null
  const out = [
    `ncols ${ncols}`,
    `nrows ${nrows}`,
    `xllcorner ${x0.toFixed(3)}`,
    `yllcorner ${y0.toFixed(3)}`,
    `cellsize ${cell.toFixed(6)}`,
    'NODATA_value -9999',
  ]
  for (let j = nrows - 1; j >= 0; j--) {
    const row = new Array(ncols)
    for (let i = 0; i < ncols; i++) row[i] = z[j * ncols + i].toFixed(2)
    out.push(row.join(' '))
  }
  return out.join('\n') + '\n'
}

/**
 * Columnas, filas y lado de celda para cubrir `w × h` con celdas cuadradas de
 * lado parecido a `target`: el ancho cierra justo, y de los candidatos se
 * queda con el que deja el alto más cerca de un número entero de celdas.
 */
export function demGrid(w, h, target) {
  const n0 = Math.max(2, Math.round(w / Math.max(target, 1e-9)))
  let best = null
  for (let n = Math.max(2, Math.floor(n0 * 0.8)); n <= Math.ceil(n0 * 1.25); n++) {
    const cell = w / n
    const rows = Math.max(2, Math.round(h / cell))
    const miss = Math.abs(rows * cell - h) / cell
    if (!best || miss < best.miss - 1e-9) best = { ncols: n, nrows: rows, cell, miss }
  }
  return best
}

/**
 * Rellena los NaN de una grilla con el valor del vecino válido más cercano
 * (por pasos de grilla, en las ocho direcciones). Devuelve false si no había
 * ningún valor del que partir.
 */
function fillNearest(z, nx, ny) {
  let queue = []
  for (let k = 0; k < z.length; k++) if (Number.isFinite(z[k])) queue.push(k)
  if (!queue.length) return false
  if (queue.length === z.length) return true
  while (queue.length) {
    const next = []
    const fresh = new Map()
    for (const k of queue) {
      const i = k % nx
      const j = (k - i) / nx
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di
          const jj = j + dj
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue
          const kk = jj * nx + ii
          if (Number.isFinite(z[kk])) continue
          // Todos los vecinos válidos de este frente cuentan igual: se
          // promedian, para no dejar escalones según el orden de la cola.
          const f = fresh.get(kk)
          if (f) {
            f.sum += z[k]
            f.n++
          } else {
            fresh.set(kk, { sum: z[k], n: 1 })
            next.push(kk)
          }
        }
      }
    }
    for (const [kk, f] of fresh) z[kk] = f.sum / f.n
    queue = next
  }
  return true
}

/** Una capa GeoJSON de líneas, en las mismas coordenadas locales. */
function lineLayer(features) {
  return JSON.stringify(
    {
      type: 'FeatureCollection',
      // Coordenadas planas en metros, no grados. GeoJSON moderno da por
      // supuesto WGS84; se deja dicho aquí para que nadie lo interprete así.
      crs: null,
      unidades: 'm (sistema local, X = Este, Y = Norte)',
      features,
    },
    null,
    1
  )
}

const lineFeature = (pts, props) => ({
  type: 'Feature',
  properties: props,
  geometry: { type: 'LineString', coordinates: pts.map((p) => [Number(p[0].toFixed(2)), Number(p[1].toFixed(2))]) },
})

/** Trazas de contactos y de fallas, y curvas de nivel, para QGIS o GemGIS. */
export function geoJsonLayers(scene, data) {
  const nameOf = new Map(data.surfaces.map((s) => [s.id, s.name]))
  const [dx, dy] = data.shift
  const mv = (pts) => pts.map((p) => [p[0] + dx, p[1] + dy])
  const contactos = []
  for (const cw of scene.contactWorld) {
    for (const tr of cw.traces) {
      if (tr.length < 2) continue
      contactos.push(
        lineFeature(mv(tr), {
          nombre: nameOf.get(cw.id) || cw.contact.name,
          etiqueta: cw.contact.name,
          tipo: cw.contact.type,
          color: cw.contact.color,
        })
      )
    }
  }
  const fallas = []
  for (const fw of scene.faultWorld) {
    for (const tr of fw.traces) {
      if (tr.length < 2) continue
      fallas.push(
        lineFeature(mv(tr), {
          nombre: nameOf.get(fw.id) || fw.fault.name,
          etiqueta: fw.fault.name,
          cinematica: fw.fault.kinematics,
        })
      )
    }
  }
  const curvas = scene.worldContours
    .filter((c) => c.pts.length >= 2)
    .map((c) => lineFeature(mv(c.pts), { cota: c.elevation }))

  return [
    { name: 'gis/contactos.geojson', text: lineLayer(contactos) },
    { name: 'gis/fallas.geojson', text: lineLayer(fallas) },
    { name: 'gis/curvas_de_nivel.geojson', text: lineLayer(curvas) },
  ]
}

/**
 * Guion de Python listo para correr.
 *
 * Se entrega hecho porque el paso de las tablas al modelo es donde se pierde la
 * gente: hay que declarar las series en orden, marcar cuáles son fallas y poner
 * la topografía, y nada de eso está en los CSV. Aquí va escrito con los nombres
 * y el orden que este ejercicio tiene de verdad.
 *
 * Escrito para GemPy 3 (probado con gempy 2025.2 y gempy_viewer 2025.1) y con
 * lo mínimo instalado: arma las tablas a mano en vez de usar `ImporterHelper`,
 * y lee el `dem.asc` con numpy en vez de `set_topography_from_file`, que pide
 * `subsurface` y `rasterio`.
 */
export function pythonScript(model) {
  const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  const fallas = model.series.filter((s) => s.es_falla)
  const mapping = model.series
    .map((s) => `    ${q(s.nombre)}: [${s.superficies.map(q).join(', ')}],`)
    .join('\n')
  const colores = model.superficies
    .filter((s) => s.tipo !== 'falla')
    .map((s) => `    ${q(s.elemento_gempy)}: ${q(s.color_elemento)},`)
    .join('\n')
  const base = model.basamento
  return `"""Modelo GemPy generado por MapTeaching a partir de «${model.nombre}».

Escrito para GemPy 3 (gempy 2025.2, gempy_viewer 2025.1). No necesita
subsurface ni rasterio: las tablas y el relieve se leen con pandas y numpy.

Cada superficie lleva el nombre de la unidad que queda ENCIMA de ella, que es
como GemPy nombra los volúmenes; lo que queda bajo la más antigua es
\`basement\`${base ? ` (aquí, ${base.unidad})` : ''}.

Coordenadas: metros locales, X al Este, Y al Norte, Z sobre el nivel del mar.
No hay CRS y no hace falta: GemPy trabaja con números, y la mesa de realidad
aumentada remapea el extent al volumen de la caja. Si algún día quieres llevar
esto a un sistema de referencia, súmale el offset a las dos columnas:

    sp[["X", "Y"]] += [E0, N0]
"""

import numpy as np
import pandas as pd
import gempy as gp

RUTA = "."
NOMBRE = ${q(model.nombre)}

EXTENT = ${JSON.stringify(model.extent)}       # [xmin, xmax, ymin, ymax, zmin, zmax] en metros
RESOLUCION = ${JSON.stringify(model.resolution)}   # celdas del cubo; súbela cuando el modelo ya salga bien

# Series, en orden: primero las fallas, después la pila estratigráfica. Dentro
# de cada serie, las superficies van de la más joven a la más antigua.
SERIES = {
${mapping}
}

FALLAS = [${fallas.map((s) => q(s.nombre)).join(', ')}]

# Color de cada unidad, el mismo del mapa. El de lo que queda bajo el contacto
# más antiguo va aparte, porque GemPy lo llama basement.
COLORES = {
${colores}
}
COLOR_BASAMENTO = ${base?.color ? q(base.color) : 'None'}


def construir(resolucion=RESOLUCION, topografia=True):
    sp = pd.read_csv(f"{RUTA}/surface_points.csv")
    ori = pd.read_csv(f"{RUTA}/orientations.csv")
    # Dirección de manteo y manteo -> vector normal (polo hacia el techo).
    az, dip = np.radians(ori.azimuth), np.radians(ori.dip)
    puntos = gp.data.SurfacePointsTable.from_arrays(
        x=sp.X.values, y=sp.Y.values, z=sp.Z.values, names=sp.formation.values)
    orient = gp.data.OrientationsTable.from_arrays(
        x=ori.X.values, y=ori.Y.values, z=ori.Z.values,
        G_x=(np.sin(dip) * np.sin(az) * ori.polarity).values,
        G_y=(np.sin(dip) * np.cos(az) * ori.polarity).values,
        G_z=(np.cos(dip) * ori.polarity).values,
        names=ori.formation.values, name_id_map=puntos.name_id_map)
    modelo = gp.create_geomodel(
        project_name=NOMBRE, extent=EXTENT, resolution=resolucion,
        structural_frame=gp.data.StructuralFrame.from_data_tables(puntos, orient))
    gp.map_stack_to_surfaces(gempy_model=modelo, mapping_object=SERIES)
    if FALLAS:
        gp.set_is_fault(modelo, FALLAS)
    pintar(modelo)
    # Topografía desde el relieve que se interpoló de las curvas de nivel.
    # En la mesa de realidad aumentada esto sobra: allí la topografía es la
    # arena, y el módulo corta el modelo contra lo que lee el sensor.
    if topografia:
        poner_topografia(modelo, f"{RUTA}/dem.asc")
    gp.compute_model(modelo)
    verificar_orden(modelo)
    return modelo


def pintar(modelo):
    """Los colores de las unidades del mapa, para que el modelo se lea igual."""
    for nombre, color in COLORES.items():
        modelo.structural_frame.get_element_by_name(nombre).color = color
    if COLOR_BASAMENTO:
        modelo.structural_frame.basement_color = COLOR_BASAMENTO


def poner_topografia(modelo, ruta):
    """Lee el dem.asc (ESRI ASCII Grid) a mano y lo pone como topografía."""
    lineas = open(ruta).read().splitlines()
    cab = {l.split()[0].lower(): float(l.split()[1]) for l in lineas[:6]}
    z = np.loadtxt(lineas[6:])[::-1]                      # fila 0 = sur
    cs = cab["cellsize"]
    xs = cab["xllcorner"] + cs * (np.arange(z.shape[1]) + 0.5)
    ys = cab["yllcorner"] + cs * (np.arange(z.shape[0]) + 0.5)
    X, Y = np.meshgrid(xs, ys)
    valores = np.stack([X.T, Y.T, z.T], axis=-1)          # GemPy usa índices [ix, iy]
    modelo.grid.topography = gp.data.Topography(
        _regular_grid=modelo.grid.regular_grid, values_2d=valores)
    gp.set_active_grid(modelo.grid, [gp.data.Grid.GridTypes.TOPOGRAPHY])


def verificar_orden(modelo):
    """Avisa si GemPy reordenó alguna serie al calcular.

    GemPy 3 reordena las superficies de cada serie según el campo escalar. Si
    el orden calculado no es el del mapa, es que esos contactos se cruzan en el
    modelo: suele faltar dato (orientaciones) en esa zona.
    """
    for g in modelo.structural_frame.structural_groups:
        esperado = SERIES.get(g.name)
        obtenido = [e.name for e in g.elements]
        if esperado and obtenido != list(esperado):
            print(f"AVISO serie {g.name}: orden del mapa {list(esperado)} "
                  f"-> orden calculado {obtenido}. Esos contactos se cruzan en el modelo.")


if __name__ == "__main__":
    import gempy_viewer as gpv

    modelo = construir()
    print(modelo.structural_frame)
    # Sin topografía en los perfiles: si no, gempy_viewer tapa de negro todo
    # lo que queda por encima del relieve.
    gpv.plot_2d(modelo, show_data=True, show_topography=False)
    try:
        gpv.plot_3d(modelo, show_topography=True, show_lith=True)
    except ImportError as e:  # la vista 3D pide pyvista, que es opcional
        print("Sin vista 3D:", e)
`
}

/** El LÉEME que acompaña al paquete: qué es cada archivo y qué hacer con él. */
export function readme(model, data) {
  const plegadasSinPanel = data.surfaces.filter((s) => s.fallback?.plegada)
  const base = model.basamento
  const llanasSinPanel = data.surfaces.filter((s) => s.fallback && !s.fallback.plegada)
  const sinPila = data.surfaces.filter((s) => s.kind === 'contact' && (!s.lowerUnitId || !s.upperUnitId))
  const puntos = data.surfaces.reduce((a, s) => a + s.points.length, 0)
  const orientaciones = model.superficies.reduce((a, s) => a + s.n_orientaciones, 0)
  return `# ${model.nombre} — exportación a GemPy

Generado por MapTeaching el ${new Date(model.generado).toLocaleString('es-CL')}.

${puntos} puntos de superficie y ${orientaciones} orientaciones, en ${model.superficies.length} superficies
(${model.series.filter((s) => s.es_falla).length} fallas).

## Qué hay aquí

| Archivo | Qué es |
|---|---|
| \`surface_points.csv\` | Los puntos donde se sabe que pasa cada contacto: cada cruce de una traza con una curva de nivel. Es el dato primario del ejercicio. |
| \`orientations.csv\` | Una actitud por panel estructural, situada en el centroide de los cruces que la sostienen. |
| \`model.json\` | El cubo del modelo, el orden de las series, qué es falla, qué superficie está plegada y los colores. Lo que los CSV no dicen. |
| \`dem.asc\` | El relieve interpolado de las curvas, en ESRI ASCII Grid, recortado justo al cubo del modelo y sin celdas vacías. Para GemPy y para QGIS. |
| \`gempy_model.py\` | Guion listo para correr, con las series y las fallas ya declaradas. |
| \`gis/*.geojson\` | Trazas de contactos y fallas, y curvas de nivel. Para QGIS o GemGIS. |

## Qué tan fiel es esto

Medido contra pliegues sintéticos de actitud conocida —el mismo ejercicio hecho
con un modelo del que se sabe la respuesta—: los puntos de superficie caen sobre
la superficie verdadera con un desvío de **1 a 3 m** de mediana, con curvas de
nivel cada 100 m. Las orientaciones aciertan el manteo con **2° a 13°** de error
de mediana según lo apretado que sea el pliegue. Los avisos del final dicen qué
mirar antes de fiarse.

## Nombres: unidades, no contactos

En los CSV cada contacto se llama como **la unidad que queda encima de él**
(\`Unidad 2\` y no \`Unidad_1_Unidad_2\`), porque GemPy le pone al volumen
que queda sobre una superficie el nombre de esa superficie. Así la leyenda del
modelo muestra unidades.${
    base
      ? ` Lo que queda bajo el contacto más antiguo GemPy lo llama \`basement\`:
aquí es **${base.unidad}**, y el guion le pone su color.`
      : ''
  } Las fallas conservan su nombre. En \`model.json\`, \`elemento_gempy\` dice
qué nombre lleva cada superficie en GemPy.

## Coordenadas

Metros locales: **X al Este, Y al Norte**, con la escala y el norte que se
calibraron en el mapa, y **Z en metros sobre el nivel del mar** —ésta sí es
absoluta, porque sale de las cotas de las curvas—.

No se declara ningún sistema de referencia, y no es un olvido: ni GemPy ni la
mesa de realidad aumentada usan uno. GemPy trabaja con números y la mesa remapea
el extent al volumen físico de la caja. Una traslación no cambia ningún manteo,
ningún espesor ni ninguna geometría. Si más adelante quieres superponer esto con
datos reales en QGIS, súmale el offset del origen a las columnas X e Y y declara
el EPSG que corresponda.

## Cómo correrlo

\`\`\`bash
pip install "gempy==2025.2.0" "gempy_viewer==2025.1.6"
python gempy_model.py
\`\`\`

El guion está escrito para GemPy 3 y no necesita \`subsurface\` ni \`rasterio\`:
lee las tablas con pandas y el relieve con numpy. Con la 2.x los CSV sirven
igual —el nombre va en la columna \`formation\`, que es la que esperan las
dos versiones—; lo que hay que adaptar son las llamadas de construcción.

Si al calcular aparece un **AVISO** de que una serie cambió de orden, es que
GemPy ha encontrado esos contactos cruzados en el modelo y los ha reordenado
según su campo escalar: la estratigrafía que sale ya no es la del mapa. Suele
faltar dato —orientaciones— donde se cruzan.

## De aquí a la mesa de realidad aumentada

Una vez que \`construir()\` devuelve un modelo calculado, el módulo de GemPy de
[open_AR_Sandbox](https://github.com/cgre-aachen/open_AR_Sandbox) lo toma tal
cual: le pasas el \`geo_model\` y las dimensiones de la caja, y él se encarga de
remapear el extent al volumen físico y de cortar el modelo contra la superficie
de arena que lee el sensor. Por eso \`dem.asc\` no hace falta allí: la topografía
la pone la arena (\`construir(topografia=False)\`). Como la mesa recalcula el
modelo en cada cuadro, conviene bajarle la resolución a la de
\`resolution_mesa\` de \`model.json\`: \`construir(resolucion=${JSON.stringify(model.resolution_mesa)}, topografia=False)\`.

Lo único que conviene mirar es la **relación de aspecto**: este modelo mide
${Math.round(model.extent[1] - model.extent[0])} × ${Math.round(model.extent[3] - model.extent[2])} m en planta
(${((model.extent[1] - model.extent[0]) / (model.extent[3] - model.extent[2])).toFixed(2)} : 1) y
${Math.round(model.extent[5] - model.extent[4])} m de alto. Si la caja tiene otra proporción, el remapeo
la estira; conviene ajustar el marco del ejercicio en la app antes que deformar
el modelo después.

## Advertencias del propio dato
${
  plegadasSinPanel.length
    ? `
**Revisa estas antes de fiarte del modelo.** Están plegadas y no tienen ningún
panel estructural confirmado, así que su única orientación es la actitud
**media** de toda la superficie — y la media de dos flancos describe un manteo
que no existe en ninguna parte del mapa. Lo que corresponde es volver a la app y
darles más dato: más cruces con curvas de nivel, o contornos estructurales
puestos a mano en cada flanco.

${plegadasSinPanel.map((s) => `  - ${s.name} (${s.label})`).join('\n')}
`
    : `
Ninguna superficie plegada se ha quedado sin orientación medida.
`
}${
  llanasSinPanel.length
    ? `
Estas otras tampoco tienen panel confirmado —les faltan cruces—, pero no están
plegadas, así que su actitud media sí las describe y sirve como orientación:

${llanasSinPanel.map((s) => `  - ${s.name} (${s.label})`).join('\n')}
`
    : ''
}
${
  sinPila.length
    ? `
**El orden de la serie es una suposición para estas.** No tienen las dos
unidades asignadas en la app, así que el ejercicio no dice qué va encima y qué
va debajo de ellas, y en \`SERIES\` han quedado colocadas donde caían. En GemPy
el orden de la serie *es* la estratigrafía: si está mal, el modelo apila mal.
Asígnales las unidades en la app, o corrige a mano la lista de \`SERIES\` en el
guion:

${sinPila.map((s) => `  - ${s.name} (${s.label})`).join('\n')}
`
    : ''
}
Cada orientación dice de qué par de contornos salió, en la columna \`origen\` de
\`orientations.csv\`. Merece la pena mirarla: una orientación equivocada le hace
más daño a una interpolación implícita que una orientación de menos, porque el
campo potencial la obedece en su entorno y arrastra la superficie con ella.

### Lo que conviene revisar en un tren de pliegues

Si el ejercicio tiene varias ondas seguidas, revisa las orientaciones cuya
**dirección de manteo va paralela al eje del pliegue** y cuyo **manteo se parece
a la inmersión del eje**. Suelen venir de un panel que ha enhebrado charnelas de
ondas distintas en vez de seguir un limbo: mide a lo largo del pliegue y no a
través, y la dirección puede salir justo del revés. Sobre pliegues sintéticos de
actitud conocida eso afecta a una de cada cinco orientaciones en los trenes
apretados, y a ninguna en un pliegue simple.

Es una limitación conocida del reparto en paneles, no de esta exportación: el
mismo defecto que hace salir algún eje de pliegue atravesado en el mapa. Mientras
no esté resuelto, en un tren de pliegues conviene abrir \`orientations.csv\` y
borrar esas filas antes de calcular el modelo; el resto de la tabla es buena, y
los puntos de superficie no están afectados.
`
}

/**
 * El paquete entero, listo para meter en un .zip.
 * @returns [{ name, text }]
 */
export function buildGempyBundle(project, scene, opts = {}) {
  const data = gempyData(scene)
  if (!data.surfaces.length) return null
  const model = modelJson(project, scene, data, opts)
  const dem = demAsc(scene, data.shift, model.extent)
  return [
    { name: 'LEEME.md', text: readme(model, data) },
    { name: 'surface_points.csv', text: surfacePointsCsv(data) },
    { name: 'orientations.csv', text: orientationsCsv(data) },
    { name: 'model.json', text: JSON.stringify(model, null, 2) },
    ...(dem ? [{ name: 'dem.asc', text: dem }] : []),
    { name: 'gempy_model.py', text: pythonScript(model) },
    ...geoJsonLayers(scene, data),
  ]
}
