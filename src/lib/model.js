// Modelo de datos del proyecto. Todo vive en el navegador (IndexedDB) y se puede
// exportar/importar como .mapteaching.json para repartir ejercicios.

import { DEFAULT_GEOREF } from './georef.js'

export const SCHEMA_VERSION = 1

export function uid(prefix = 'x') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Colores de la tabla cronoestratigráfica internacional (CGMW/ICS), ordenados
 * de la unidad más antigua a la más moderna: como las unidades se numeran de
 * base a techo, la primera capa recibe el color más antiguo. Los tonos más
 * oscuros van algo aclarados para que las trazas y los rótulos se lean encima.
 */
export const ICS_COLORS = [
  { id: 'precambrico', label: 'Precámbrico', color: '#F4789E' },
  { id: 'cambrico', label: 'Cámbrico', color: '#96B06B' },
  { id: 'ordovicico', label: 'Ordovícico', color: '#5FBB93' },
  { id: 'silurico', label: 'Silúrico', color: '#B3E1C4' },
  { id: 'devonico', label: 'Devónico', color: '#D9A55C' },
  { id: 'carbonifero', label: 'Carbonífero', color: '#8CBCB0' },
  { id: 'permico', label: 'Pérmico', color: '#F0705C' },
  { id: 'triasico', label: 'Triásico', color: '#B978B9' },
  { id: 'jurasico', label: 'Jurásico', color: '#68C7D8' },
  { id: 'cretacico', label: 'Cretácico', color: '#9BD46F' },
  { id: 'paleogeno', label: 'Paleógeno', color: '#FDB06E' },
  { id: 'neogeno', label: 'Neógeno', color: '#FFE95C' },
  { id: 'cuaternario', label: 'Cuaternario', color: '#FBFBA6' },
]

export const UNIT_COLORS = ICS_COLORS.map((c) => c.color)

export const CONTACT_TYPES = [
  { id: 'concordante', label: 'Concordante', dash: null },
  { id: 'discordante', label: 'Discordante (inconformidad)', dash: [10, 4] },
  { id: 'intrusivo', label: 'Intrusivo', dash: [2, 3] },
  { id: 'inferido', label: 'Inferido', dash: [6, 6] },
]

export const KINEMATICS = [
  { id: 'normal', label: 'Normal', color: '#f87171', short: 'N' },
  { id: 'inversa', label: 'Inversa', color: '#60a5fa', short: 'I' },
  { id: 'dextral', label: 'Dextral', color: '#34d399', short: 'D' },
  { id: 'sinestral', label: 'Sinestral', color: '#fbbf24', short: 'S' },
  { id: 'normal-dextral', label: 'Normal-dextral', color: '#fb923c', short: 'ND' },
  { id: 'normal-sinestral', label: 'Normal-sinestral', color: '#f472b6', short: 'NS' },
  { id: 'inversa-dextral', label: 'Inversa-dextral', color: '#818cf8', short: 'ID' },
  { id: 'inversa-sinestral', label: 'Inversa-sinestral', color: '#22d3ee', short: 'IS' },
  { id: 'indeterminada', label: 'Indeterminada', color: '#cbd5e1', short: '?' },
]

export const kinematicsOf = (id) => KINEMATICS.find((k) => k.id === id) || KINEMATICS[8]

export function newProject(name = 'Ejercicio sin título') {
  const now = new Date().toISOString()
  return {
    schema: SCHEMA_VERSION,
    id: uid('proj'),
    name,
    createdAt: now,
    updatedAt: now,
    statement: '',
    image: null, // { blobId, width, height, name }
    virtualSize: { width: 1400, height: 1000 }, // lienzo mientras no haya imagen
    // Marco rectangular del área de trabajo, en píxeles de imagen. Recorta los
    // polígonos de unidades, las trazas de los modelos y el modelo 3D.
    frame: null, // { a: [x, y], b: [x, y] }
    // Sobre el lienzo virtual se asume una escala de trabajo (≈10 × 7 km), de
    // modo que los modelos sintéticos funcionan sin calibrar nada. Al importar
    // una imagen la escala se borra para que el usuario la calibre.
    georef: { ...DEFAULT_GEOREF, metersPerPx: 7 },
    contours: [], // { id, elevation, pts }
    // `hidden` apaga el relleno de color de la unidad; en los contactos,
    // `hidden` apaga la traza y `labelHidden` sólo su rótulo. Ver `isHidden`.
    units: [], // { id, name, color, order, lithology, notes, hidden }
    contacts: [], // { id, name, color, type, lowerUnitId, upperUnitId, manual, traces, hidden, labelHidden }
    faults: [], // { id, name, kinematics, dipManual, traces }
    sections: [], // { id, name, a, b, vExag, depth }
    wells: [], // { id, name, at, depth, trend, plunge }
    // Pares de puntos de perforación: el mismo rasgo lineal reconocido a los
    // dos lados de una falla, que da su salto real (ver piercing.js).
    piercings: [], // { id, faultId, name, a: { at, trend, plunge }, b: {...} }
    models: [], // modelos sintéticos: plano, serie de capas o pliegues
    settings: {
      contourInterval: 100,
      lastElevation: 0,
      sectionDepth: 2000,
      vExag: 1,
      demResolution: 300,
      demSmoothing: 2, // pasadas de suavizado del relieve
      // Visibilidad, opacidad y bloqueo por capa. Una capa bloqueada no se
      // puede seleccionar ni editar en el mapa.
      layers: {
        image: { opacity: 1, locked: false },
        contours: { opacity: 1, locked: false },
        units: { opacity: 0.6, locked: false },
        contacts: { opacity: 1, locked: false },
        faults: { opacity: 1, locked: false },
        models: { opacity: 1, locked: false },
      },
      blockCell: 0, // 0 = automático
    },
  }
}

export function newUnit(project, name) {
  const order = project.units.length
  return {
    id: uid('u'),
    name: name || `Unidad ${order + 1}`,
    color: UNIT_COLORS[order % UNIT_COLORS.length],
    order,
    lithology: '',
    notes: '',
  }
}

/** Oscurece un color hexadecimal (para que la traza contraste sobre el mapa). */
export function darken(hex, k = 0.45) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return '#0f172a'
  const v = parseInt(m[1], 16)
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => Math.round(x * (1 - k)))
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

/** Nombre automático de un contacto a partir del par de unidades que separa. */
export function contactNameFor(project, lowerUnitId, upperUnitId) {
  const lower = project.units.find((u) => u.id === lowerUnitId)
  const upper = project.units.find((u) => u.id === upperUnitId)
  return lower && upper ? `${lower.name} / ${upper.name}` : 'Contacto'
}

export function newContact(project, lowerUnitId, upperUnitId) {
  const lower = project.units.find((u) => u.id === lowerUnitId)
  const upper = project.units.find((u) => u.id === upperUnitId)
  return {
    id: uid('c'),
    name: contactNameFor(project, lowerUnitId, upperUnitId),
    color: darken(upper?.color || lower?.color || '#334155', 0.45),
    type: 'concordante',
    lowerUnitId: lowerUnitId || null,
    upperUnitId: upperUnitId || null,
    manual: null, // { dipDir, dip } fuerza la actitud si faltan intersecciones
    // Contornos estructurales puestos a mano: rectas de cota conocida sobre la
    // superficie, que sustituyen a las que calcula el motor en esa cota.
    structureContours: [], // { id, elevation, pts: [[x,y],[x,y]] } en píxeles
    traces: [],
  }
}

/**
 * Cambio del par de unidades de un contacto. El nombre y el color se regeneran
 * sólo si eran los automáticos: un nombre escrito a mano no se pisa.
 */
export function reassignContact(project, contact, lowerUnitId, upperUnitId) {
  const patch = { lowerUnitId: lowerUnitId || null, upperUnitId: upperUnitId || null }
  const auto = contactNameFor(project, contact.lowerUnitId, contact.upperUnitId)
  if (!contact.name || contact.name === auto || contact.name === 'Contacto') {
    patch.name = contactNameFor(project, lowerUnitId, upperUnitId)
  }
  const upper = project.units.find((u) => u.id === upperUnitId)
  const lower = project.units.find((u) => u.id === lowerUnitId)
  const autoColor = darken(
    project.units.find((u) => u.id === contact.upperUnitId)?.color ||
      project.units.find((u) => u.id === contact.lowerUnitId)?.color ||
      '#334155',
    0.45
  )
  if (!contact.color || contact.color === autoColor) {
    patch.color = darken(upper?.color || lower?.color || '#334155', 0.45)
  }
  return patch
}

/** Contorno estructural puesto a mano: un segmento de cota conocida. */
export function newStructureContour(elevation, pts, { excluded = false } = {}) {
  const sc = { id: uid('sc'), elevation, pts: [pts[0], pts[pts.length - 1]] }
  // `excluded` no describe una geometría: es la marca de «aquí no va nada»,
  // puesta donde el motor calculaba un contorno que el estudiante quitó. La
  // cota queda igual excluida del ajuste que con un contorno a mano normal
  // —ver `overridden` en `buildSurface`—, pero sin aportarle puntos propios:
  // el resultado es que ese contorno calculado deja de existir, en vez de
  // sustituirlo por otro. `pts` guarda dónde estaba, por si hace falta migrar
  // el proyecto o depurarlo; no se dibuja ni se usa para nada más.
  if (excluded) sc.excluded = true
  return sc
}


export function newFault(project) {
  return {
    id: uid('f'),
    name: `Falla ${project.faults.length + 1}`,
    kinematics: 'normal',
    manual: null, // { dipDir, dip }
    offset: null, // separación estimada (m), sólo informativa
    // Contacto que sella la falla: desde él hacia el techo la falla ya no
    // desplaza nada. Es el caso de una falla antigua truncada por una
    // discordancia —se movió, se erosionó y la cobertura se depositó encima
    // ya sin romper—. `null` = la falla corta toda la pila.
    sealedByContactId: null,
    structureContours: [],
    traces: [],
  }
}

/**
 * ¿Desplaza esta falla al contacto `contactId`?
 *
 * Una falla sellada mueve lo que hay **bajo** la superficie que la sella y
 * nada desde ella hacia arriba, la propia superficie incluida: si esa
 * superficie estuviera desplazada, la falla no estaría sellada por ella. El
 * orden es el estratigráfico, así que se compara la posición de los dos
 * contactos en la pila (`order`, de `contactOrder`).
 */
export function faultCutsContact(fault, contactId, order) {
  const seal = fault?.sealedByContactId
  if (!seal) return true
  const iSeal = order.get(seal)
  const i = order.get(contactId)
  // Un sello que ya no existe —el contacto se borró— no sella nada.
  if (iSeal == null || i == null) return true
  return i < iSeal
}

/** Posición de cada contacto en la pila estratigráfica, por id. */
export const contactOrder = (project) => new Map(sortedContacts(project).map((c, i) => [c.id, i]))

export function newSection(project, a, b) {
  const n = project.sections.length
  const letter = String.fromCharCode(65 + (n % 26))
  return {
    id: uid('s'),
    name: `${letter}–${letter}'`,
    a,
    b,
    depth: project.settings.sectionDepth,
    vExag: project.settings.vExag,
    corridor: null, // ancho del corredor de proyección de pozos (m); null = automático
  }
}

export function newWell(project, at) {
  return {
    id: uid('w'),
    name: `Pozo ${project.wells.length + 1}`,
    at,
    depth: 1500,
    trend: 0,
    plunge: 90, // 90° = vertical
  }
}

/**
 * Par de puntos de perforación: el mismo rasgo lineal —una charnela de pliegue,
 * la intersección de un dique con un contacto, el eje de un paleocanal— visto a
 * los dos lados de una falla. Cada lado guarda un punto sobre el rasgo, en
 * píxeles de imagen, y su dirección de inmersión e inmersión.
 *
 * La orientación se guarda por separado en cada lado porque una falla puede
 * haber rotado un bloque respecto del otro; si no lo hizo, basta con copiarla.
 */
export function newPiercingPair(project, faultId, at) {
  const n = (project.piercings || []).length + 1
  return {
    id: uid('pp'),
    faultId: faultId || null,
    name: `Par ${n}`,
    feature: '', // qué rasgo es: charnela, dique, paleocanal…
    a: { at, trend: 0, plunge: 0 },
    b: null, // se completa con el segundo toque
  }
}

/** Unidades ordenadas de base a techo. */
export const sortedUnits = (project) => [...project.units].sort((a, b) => a.order - b.order)

/**
 * Contactos ordenados estratigráficamente (por la posición de la unidad
 * inferior); los que no tienen unidades asignadas quedan al final.
 */
export function sortedContacts(project) {
  const idx = new Map(sortedUnits(project).map((u, i) => [u.id, i]))
  return [...project.contacts].sort((a, b) => {
    const ia = idx.has(a.lowerUnitId) ? idx.get(a.lowerUnitId) : 1e6
    const ib = idx.has(b.lowerUnitId) ? idx.get(b.lowerUnitId) : 1e6
    return ia - ib
  })
}

/** El contacto que ya separa este par de unidades, si existe. */
export function findContactByPair(project, lowerUnitId, upperUnitId) {
  return (
    project.contacts.find((c) => c.lowerUnitId === lowerUnitId && c.upperUnitId === upperUnitId) || null
  )
}

/**
 * Par de unidades que propone «+ Contacto»: por defecto la más antigua con la
 * más joven —el caso que no sale solo, una discordancia que salta unidades—,
 * o el primer par sin ficha si ese ya tiene contacto. `null` si todos los
 * pares posibles ya tienen uno.
 */
export function nextContactPair(project) {
  const units = sortedUnits(project)
  if (units.length < 2) return null
  const base = units[units.length - 1].id
  const top = units[0].id
  if (!findContactByPair(project, base, top)) return [base, top]
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      if (!findContactByPair(project, units[i].id, units[j].id)) return [units[i].id, units[j].id]
    }
  }
  return null
}

/**
 * Fusiona los contactos que repiten el mismo par de unidades en uno solo.
 *
 * Cada par de unidades separa una única superficie: dos contactos para el
 * mismo par no son dos rasgos distintos, son el mismo repartido en dos
 * fichas. Eso pasaba —antes de que `contact.add` y el alta automática de
 * `unit.add` comprobaran si el par ya tenía dueño— al pulsar «+ Contacto»
 * más de una vez para el mismo par, o al recuperar un proyecto guardado con
 * ese descuido. El efecto no se nota en el panel hasta que se digitaliza o se
 * calcula el modelo: cada ficha alimenta su propia superficie 3D con sólo una
 * parte de las trazas y los contornos estructurales del contacto real, así
 * que salen dos superficies independientes —y a menudo contradictorias en su
 * actitud— donde sólo debería haber una, y el relleno del mapa en planta
 * titubea entre ellas donde una cubre y la otra no.
 *
 * Se aplica al cargar un proyecto (abrir, importar, ejemplos) para sanear los
 * que ya se guardaron con el problema. Conserva el primer contacto de cada
 * par —nombre, color, tipo y actitud manual— y le suma las trazas y los
 * contornos estructurales de sus duplicados; no reordena ni toca los pares
 * que ya eran únicos.
 */
export function mergeDuplicateContacts(project) {
  const seen = new Map() // "lowerId|upperId" -> contacto que se conserva
  const merged = []
  let changed = false
  for (const c of project.contacts) {
    // Un contacto sin las dos unidades asignadas no separa ningún par: no hay
    // nada que fusionar y agruparlos por "null|null" los mezclaría entre sí.
    const key = c.lowerUnitId && c.upperUnitId ? `${c.lowerUnitId}|${c.upperUnitId}` : null
    const keeper = key && seen.get(key)
    if (!keeper) {
      const copy = { ...c, traces: [...c.traces], structureContours: [...(c.structureContours || [])] }
      if (key) seen.set(key, copy)
      merged.push(copy)
      continue
    }
    changed = true
    keeper.traces.push(...c.traces)
    keeper.structureContours.push(...(c.structureContours || []))
  }
  return changed ? { ...project, contacts: merged } : project
}

/**
 * Visibilidad individual de una unidad o un contacto.
 *
 * Ocultar es sólo dejar de dibujar: el rasgo sigue en el proyecto y sigue
 * mandando en el modelo. Un contacto oculto sigue partiendo el mapa en
 * regiones y sigue definiendo la superficie que separa dos unidades; una
 * unidad oculta sigue estando en la pila. Lo contrario —que ocultar cambiara
 * la geología— convertiría el ojo en un borrador encubierto, y en clase se
 * apaga una capa justo para mirar lo que hay debajo, no para quitarla.
 *
 * Sólo se guarda lo oculto (`hidden`, `labelHidden`): un proyecto sin esos
 * campos se ve entero, que es como estaban los que ya existían.
 */
export const isHidden = (it) => Boolean(it?.hidden)

/** El rótulo se calla si se apagó el rasgo entero o sólo su rótulo. */
export const isLabelHidden = (it) => Boolean(it?.hidden || it?.labelHidden)

/** Conjunto de ids ocultos de una lista de unidades, contactos o fallas. */
export const hiddenIdSet = (list) => new Set((list || []).filter(isHidden).map((it) => it.id))

export const allTracePoints = (feature) => (feature?.traces || []).map((t) => t.pts)

export function countVertices(project) {
  let n = 0
  for (const c of project.contours) n += c.pts.length
  for (const c of project.contacts) for (const t of c.traces) n += t.pts.length
  for (const f of project.faults) for (const t of f.traces) n += t.pts.length
  return n
}
