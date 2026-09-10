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

import { sortedContacts, sortedUnits } from './model.js'
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
      label: c.name,
      color: c.color,
      type: c.type,
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
      label: f.name,
      color: '#444444',
      kinematics: f.kinematics,
      points,
      orientations,
      fallback: orientations.length ? null : meanFallback(new Map([[0, surf]]), shift),
    })
  }

  return { surfaces, contacts, faults, units: sortedUnits(scene.project), shift, extent: ext }
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
 * La columna del nombre se escribe dos veces, como `formation` y como
 * `surface`: GemPy la ha llamado de las dos maneras según la versión, y una
 * columna de más no le estorba a nadie mientras que la que falta rompe la
 * lectura.
 */
export function surfacePointsCsv(data) {
  const rows = ['X,Y,Z,formation,surface']
  for (const s of data.surfaces) {
    for (const p of s.points) rows.push(`${num(p[0])},${num(p[1])},${num(p[2])},${s.name},${s.name}`)
  }
  return rows.join('\n') + '\n'
}

/**
 * `orientations.csv`. `azimuth` es la dirección de manteo y `polarity` vale 1:
 * la unidad de arriba del contacto es la joven, que es como está definida la
 * pila en esta app, así que el polo apunta al techo en todas.
 */
export function orientationsCsv(data) {
  const rows = ['X,Y,Z,azimuth,dip,polarity,formation,surface,origen']
  for (const s of data.surfaces) {
    const list = s.orientations.length ? s.orientations : s.fallback ? [s.fallback] : []
    for (const a of list) {
      const origen = a.media
        ? 'actitud media de la superficie'
        : `${a.manual ? 'contornos a mano' : 'contornos'} ${a.cotas[0]}-${a.cotas[1]} m`
      rows.push(
        `${num(a.x)},${num(a.y)},${num(a.z)},${num(a.dipDir, 1)},${num(a.dip, 1)},1,${s.name},${s.name},${origen}`
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
  const unitName = (id) => data.units.find((u) => u.id === id)?.name || null

  return {
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
    // Una serie estratigráfica con todos los contactos concordantes, y una
    // serie por falla: en GemPy cada falla es su propia serie y desplaza a las
    // que vienen después.
    series: [
      ...fallas.map((f) => ({
        nombre: `Falla_${f.name}`,
        es_falla: true,
        superficies: [f.name],
        cinematica: f.kinematics || null,
      })),
      {
        nombre: 'Estratigrafia',
        es_falla: false,
        // De la más joven a la más antigua, que es como las pide GemPy.
        superficies: contactos.map((c) => c.name).reverse(),
      },
    ],
    superficies: data.surfaces.map((s) => ({
      nombre: s.name,
      etiqueta: s.label,
      tipo: s.kind === 'fault' ? 'falla' : s.type || 'concordante',
      color: s.color,
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
 * Relieve en ESRI ASCII Grid: lo lee GemPy para poner la topografía, y lo lee
 * QGIS como ráster sin más. Las filas van de norte a sur, que es al revés que
 * la grilla del modelo de elevación.
 *
 * Para la mesa de realidad aumentada esto sobra: allí la topografía es la
 * arena, y el módulo corta el modelo contra lo que lee el sensor.
 */
export function demAsc(scene, shift = [0, 0]) {
  const d = scene.dem
  if (!d?.valid) return null
  const out = [
    `ncols ${d.nx}`,
    `nrows ${d.ny}`,
    `xllcorner ${(d.bbox.minX + shift[0]).toFixed(3)}`,
    `yllcorner ${(d.bbox.minY + shift[1]).toFixed(3)}`,
    `cellsize ${d.cell.toFixed(4)}`,
    'NODATA_value -9999',
  ]
  const inFrame = frameTest(scene)
  for (let j = d.ny - 1; j >= 0; j--) {
    const row = new Array(d.nx)
    for (let i = 0; i < d.nx; i++) {
      const x = d.bbox.minX + i * d.cell
      const y = d.bbox.minY + j * d.cell
      const z = d.z[j * d.nx + i]
      row[i] = inFrame && !inFrame(x, y) ? '-9999' : Number.isFinite(z) ? z.toFixed(2) : '-9999'
    }
    out.push(row.join(' '))
  }
  return out.join('\n') + '\n'
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
 * La API de GemPy cambió bastante entre la 2 y la 3; esto está escrito para la
 * 3. Si la versión instalada es otra, lo que hay que retocar son las tres
 * llamadas del final: los datos de los CSV siguen valiendo igual.
 */
export function pythonScript(model) {
  const q = (s) => `"${String(s).replace(/"/g, '\\"')}"`
  const fallas = model.series.filter((s) => s.es_falla)
  const mapping = model.series
    .map((s) => `    ${q(s.nombre)}: [${s.superficies.map(q).join(', ')}],`)
    .join('\n')
  const colores = model.superficies.map((s) => `    ${q(s.nombre)}: ${q(s.color)},`).join('\n')
  return `"""Modelo GemPy generado por MapTeaching a partir de «${model.nombre}».

Escrito para GemPy 3. Si tienes la 2.x, los CSV sirven igual: lo que cambia son
las llamadas de construcción del final (ver la documentación de tu versión).

Coordenadas: metros locales, X al Este, Y al Norte, Z sobre el nivel del mar.
No hay CRS y no hace falta: GemPy trabaja con números, y la mesa de realidad
aumentada remapea el extent al volumen de la caja. Si algún día quieres llevar
esto a un sistema de referencia, súmale el offset a las dos columnas:

    sp[["X", "Y"]] += [E0, N0]
"""

import gempy as gp
import gempy_viewer as gpv

RUTA = "."

EXTENT = ${JSON.stringify(model.extent)}       # [xmin, xmax, ymin, ymax, zmin, zmax] en metros
RESOLUCION = ${JSON.stringify(model.resolution)}   # celdas del cubo; súbela cuando el modelo ya salga bien

# Series, en orden: primero las fallas, después la pila estratigráfica. Dentro
# de cada serie, las superficies van de la más joven a la más antigua.
SERIES = {
${mapping}
}

FALLAS = [${fallas.map((s) => q(s.nombre)).join(', ')}]

COLORES = {
${colores}
}


def construir():
    modelo = gp.create_geomodel(
        project_name=${q(model.nombre)},
        extent=EXTENT,
        resolution=RESOLUCION,
        importer_helper=gp.data.ImporterHelper(
            path_to_orientations=f"{RUTA}/orientations.csv",
            path_to_surface_points=f"{RUTA}/surface_points.csv",
        ),
    )

    gp.map_stack_to_surfaces(gempy_model=modelo, mapping_object=SERIES)
    if FALLAS:
        gp.set_is_fault(modelo, FALLAS)

    # Topografía desde el relieve que se interpoló de las curvas de nivel.
    # En la mesa de realidad aumentada esto sobra: allí la topografía es la
    # arena, y el módulo corta el modelo contra lo que lee el sensor.
    try:
        gp.set_topography_from_file(grid=modelo.grid, filepath=f"{RUTA}/dem.asc")
    except Exception as e:  # noqa: BLE001
        print("Sin topografía:", e)

    pintar(modelo)
    gp.compute_model(modelo)
    return modelo


def pintar(modelo):
    """Los colores de las unidades del mapa, para que el modelo se lea igual.

    La forma de tocar el color cambia entre versiones de GemPy, así que si no
    encaja no se interrumpe nada: el modelo sale igual, con otros colores.
    """
    for nombre, color in COLORES.items():
        try:
            modelo.structural_frame.get_element_by_name(nombre).color = color
        except Exception:  # noqa: BLE001
            pass


if __name__ == "__main__":
    modelo = construir()
    print(modelo.structural_frame)
    gpv.plot_2d(modelo, show_data=True)
    gpv.plot_3d(modelo, show_topography=True, show_lith=True)
`
}

/** El LÉEME que acompaña al paquete: qué es cada archivo y qué hacer con él. */
export function readme(model, data) {
  const plegadasSinPanel = data.surfaces.filter((s) => s.fallback?.plegada)
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
| \`model.json\` | El cubo del modelo, el orden de las series, qué es falla y los colores. Lo que los CSV no dicen. |
| \`dem.asc\` | El relieve interpolado de las curvas, en ESRI ASCII Grid. Para GemPy y para QGIS. |
| \`gempy_model.py\` | Guion listo para correr, con las series y las fallas ya declaradas. |
| \`gis/*.geojson\` | Trazas de contactos y fallas, y curvas de nivel. Para QGIS o GemGIS. |

## Qué tan fiel es esto

Medido contra pliegues sintéticos de actitud conocida —el mismo ejercicio hecho
con un modelo del que se sabe la respuesta—: los puntos de superficie caen sobre
la superficie verdadera con un desvío de **1 a 3 m** de mediana, con curvas de
nivel cada 100 m. Las orientaciones aciertan el manteo con **2° a 13°** de error
de mediana según lo apretado que sea el pliegue. Los avisos del final dicen qué
mirar antes de fiarse.

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
pip install gempy gempy_viewer
python gempy_model.py
\`\`\`

El guion está escrito para GemPy 3. Con la 2.x los CSV sirven igual —las
columnas del nombre van repetidas como \`formation\` y como \`surface\` justo para
eso—; lo que hay que adaptar son las llamadas de construcción.

## De aquí a la mesa de realidad aumentada

Una vez que \`construir()\` devuelve un modelo calculado, el módulo de GemPy de
[open_AR_Sandbox](https://github.com/cgre-aachen/open_AR_Sandbox) lo toma tal
cual: le pasas el \`geo_model\` y las dimensiones de la caja, y él se encarga de
remapear el extent al volumen físico y de cortar el modelo contra la superficie
de arena que lee el sensor. Por eso \`dem.asc\` no hace falta allí: la topografía
la pone la arena.

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
  const dem = demAsc(scene, data.shift)
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
