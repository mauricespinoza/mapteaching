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
    units: [], // { id, name, color, order, lithology, notes }
    contacts: [], // { id, name, color, type, lowerUnitId, upperUnitId, manual, traces }
    faults: [], // { id, name, kinematics, dipManual, traces }
    sections: [], // { id, name, a, b, vExag, depth }
    wells: [], // { id, name, at, depth, trend, plunge }
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
export function newStructureContour(elevation, pts) {
  return { id: uid('sc'), elevation, pts: [pts[0], pts[pts.length - 1]] }
}


export function newFault(project) {
  return {
    id: uid('f'),
    name: `Falla ${project.faults.length + 1}`,
    kinematics: 'normal',
    manual: null, // { dipDir, dip }
    offset: null, // separación estimada (m), sólo informativa
    structureContours: [],
    traces: [],
  }
}

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

export const allTracePoints = (feature) => (feature?.traces || []).map((t) => t.pts)

export function countVertices(project) {
  let n = 0
  for (const c of project.contours) n += c.pts.length
  for (const c of project.contacts) for (const t of c.traces) n += t.pts.length
  for (const f of project.faults) for (const t of f.traces) n += t.pts.length
  return n
}
