// Generador de ejercicios sintéticos. Construye un mapa geológico completo
// (topografía, contactos, falla normal con salto, pozos y perfil) a partir de
// superficies conocidas: sirve para practicar sin necesidad de importar una
// imagen y para verificar que el motor recupera la actitud original.

import { newProject, newUnit, newContact, newFault, newSection, newWell, uid } from './model.js'
import { contourLines } from './marching.js'
import { simplify } from './geom.js'

const RAD = Math.PI / 180

/** Elevación de un plano dados dip, dip-direction y un punto de paso. */
function planeZ(z0, x0, y0, dipDeg, dipDirDeg) {
  const t = dipDirDeg * RAD
  const k = Math.tan(dipDeg * RAD)
  return (x, y) => z0 - k * ((x - x0) * Math.sin(t) + (y - y0) * Math.cos(t))
}

export function buildSampleProject() {
  const mpp = 5 // metros por píxel
  const W = 1600
  const H = 1100
  const bbox = { minX: 0, minY: -H * mpp, maxX: W * mpp, maxY: 0 }
  const toPx = (p) => [p[0] / mpp, -p[1] / mpp]

  // Topografía: relieve regional inclinado, labrado por dos valles meandriformes.
  // Las curvas de nivel dibujan «V» marcadas, de modo que cada contacto cruza
  // varias veces cada cota: es lo que permite ajustar contornos estructurales.
  const valley = (yc, amp, wave, width) => (x, y) =>
    -amp * Math.exp(-Math.pow((y - yc - wave * Math.sin(x / 2100)) / width, 2))
  const v1 = valley(-1100, 380, 900, 560)
  const v2 = valley(-3100, 330, 750, 520)
  const v3 = valley(-4700, 300, 650, 500)
  const topo = (x, y) =>
    1250 -
    0.055 * x +
    0.02 * y +
    120 * Math.sin(x / 1300 + 1.1) +
    90 * Math.cos(y / 950) +
    v1(x, y) +
    v2(x, y) +
    v3(x, y)

  // Falla normal de rumbo N–S, manteo 70° al W, bloque colgante (W) descendido.
  const fault = planeZ(1000, 4200, -2700, 70, 270)
  const throwM = 320
  const shift = (S) => (x, y) => {
    const z = S(x, y)
    return z > fault(x, y) ? z - throwM : z
  }

  // Dos contactos concordantes: manteo 25° hacia el ESE.
  const c1 = shift(planeZ(1150, 3000, -2500, 25, 110))
  const c2 = shift(planeZ(1550, 3000, -2500, 25, 110))

  const project = newProject('Ejercicio demo — falla normal y serie inclinada')
  project.statement =
    'Mapa sintético: tres unidades subhorizontalmente estratificadas con manteo ' +
    '25° al ESE, cortadas por una falla normal N–S de manteo 70°W con ~320 m de ' +
    'salto vertical (bloque occidental descendido).\n\n' +
    '1) Digitaliza (o revisa) las curvas de nivel y los contactos.\n' +
    '2) Obtén los contornos estructurales de cada contacto y verifica rumbo y manteo.\n' +
    '3) Construye el perfil A–A′ y estima el salto de la falla.\n' +
    '4) Predice la columna que cortaría el pozo P-1.'
  project.image = null
  project.georef = { metersPerPx: mpp, scaleLine: null, northVec: [0, -1], northLine: null }
  project.settings.contourInterval = 100
  project.settings.lastElevation = 400
  project.settings.sectionDepth = 2500
  project.virtualSize = { width: W, height: H }

  // Curvas de nivel cada 100 m.
  for (let z = 200; z <= 1600; z += 100) {
    const lines = contourLines(topo, bbox, 150, 110, z)
    for (const line of lines) {
      const pts = simplify(line.map(toPx), 0.8)
      if (pts.length >= 3) project.contours.push({ id: uid('cv'), elevation: z, pts })
    }
  }

  const uBasal = newUnit(project, 'Fm. Quebrada Honda (basal)')
  uBasal.lithology = 'Areniscas y lutitas'
  uBasal.color = '#68C7D8' // Jurásico
  project.units.push(uBasal)
  const uMedia = newUnit(project, 'Fm. Cerro Blanco (media)')
  uMedia.lithology = 'Calizas'
  uMedia.color = '#9BD46F' // Cretácico
  project.units.push(uMedia)
  const uSup = newUnit(project, 'Fm. Los Maitenes (superior)')
  uSup.lithology = 'Volcanoclásticas'
  uSup.color = '#FDB06E' // Paleógeno
  project.units.push(uSup)

  const contactA = newContact(project, uBasal.id, uMedia.id)
  const contactB = newContact(project, uMedia.id, uSup.id)
  for (const [contact, surf] of [
    [contactA, c1],
    [contactB, c2],
  ]) {
    const lines = contourLines((x, y) => surf(x, y) - topo(x, y), bbox, 220, 160, 0)
    for (const line of lines) {
      const pts = simplify(line.map(toPx), 0.8)
      if (pts.length >= 3) contact.traces.push({ id: uid('tr'), pts })
    }
    project.contacts.push(contact)
  }

  const f = newFault(project)
  f.name = 'Falla El Salto'
  f.kinematics = 'normal'
  for (const line of contourLines((x, y) => fault(x, y) - topo(x, y), bbox, 220, 160, 0)) {
    const pts = simplify(line.map(toPx), 0.8)
    if (pts.length >= 3) f.traces.push({ id: uid('tr'), pts })
  }
  project.faults.push(f)

  const section = newSection(project, [140, 620], [1480, 480])
  section.depth = 2500
  project.sections.push(section)

  const w1 = newWell(project, [1150, 500])
  w1.name = 'P-1'
  w1.depth = 1800
  project.wells.push(w1)
  const w2 = newWell(project, [700, 300])
  w2.name = 'P-2 (desviado)'
  w2.depth = 1400
  w2.trend = 95
  w2.plunge = 65
  project.wells.push(w2)

  return { project, truth: { dip: 25, dipDir: 110, faultDip: 70, faultDipDir: 270, throw: throwM } }
}
