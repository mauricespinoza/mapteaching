// Catálogo de ejercicios de ejemplo que la app ofrece «listos para abrir».
//
// Hay dos clases de ejemplo:
//   - los sintéticos, que se generan con código (sample.js) y por eso no pesan
//     nada en el bundle;
//   - los modelos de prueba, proyectos reales exportados desde la propia app
//     (.mapteaching.json, imagen base incluida) que viven en public/examples/ y
//     se descargan sólo cuando el usuario los elige.

import * as db from './db.js'
import { uid } from './model.js'
import { buildSampleProject } from './sample.js'

const asset = (file) => `${import.meta.env.BASE_URL}examples/${file}`

export const EXAMPLES = [
  {
    id: 'demo-sintetico',
    name: 'Ejercicio demo — falla normal y serie inclinada',
    summary: 'Mapa sintético generado por la app: topografía, tres unidades con manteo 25° ESE y una falla normal de ~320 m de salto.',
    detail: 'Sin imagen base. Sirve para practicar el flujo completo y comprobar que el motor recupera la actitud original.',
    kind: 'builder',
  },
  {
    id: 'falla-normal-serie-inclinada',
    name: 'Modelo de prueba — Falla normal y serie inclinada',
    summary: 'Proyecto de prueba digitalizado sobre una imagen de mapa: curvas de nivel, siete unidades, seis contactos, una falla normal, dos perfiles y tres pozos.',
    detail: 'Trae la imagen base, la escala calibrada, el marco de trabajo y un par de puntos de perforación para el salto de falla.',
    kind: 'file',
    url: asset('falla-normal-serie-inclinada.mapteaching.json'),
  },
]

export const findExample = (id) => EXAMPLES.find((e) => e.id === id) || EXAMPLES[0]

/**
 * Convierte un proyecto tal como viene del .json (imagen embebida en dataUrl)
 * en uno utilizable: guarda la imagen como blob en IndexedDB y le pone id
 * propio, de modo que abrir el mismo ejemplo dos veces no pise la copia que el
 * usuario ya tenga con sus anotaciones.
 */
export async function adoptProject(data, name) {
  const project = { ...data }
  if (name) project.name = name
  if (project.image?.dataUrl) {
    const blob = await db.dataUrlToBlob(project.image.dataUrl)
    const blobId = uid('img')
    await db.putBlob(blobId, blob)
    project.image = { ...project.image, blobId, dataUrl: undefined }
  }
  project.id = uid('proj')
  const now = new Date().toISOString()
  project.createdAt = project.createdAt || now
  project.updatedAt = now
  return project
}

/** Carga un ejemplo del catálogo y lo deja guardado y listo para abrir. */
export async function loadExample(id) {
  const example = findExample(id)
  let project
  if (example.kind === 'file') {
    const res = await fetch(example.url)
    if (!res.ok) throw new Error(`No se pudo descargar el ejemplo (${res.status})`)
    project = await adoptProject(await res.json(), example.name)
  } else {
    project = buildSampleProject().project
  }
  await db.saveProject(project)
  return project
}
