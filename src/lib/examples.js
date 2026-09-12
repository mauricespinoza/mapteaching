// Catálogo de ejercicios de ejemplo que la app ofrece «listos para abrir».
//
// Cada ejemplo es un modelo de prueba: un proyecto real exportado desde la
// propia app (.mapteaching.json, imagen base incluida) que vive en
// public/examples/ y se descarga sólo cuando el usuario lo elige.

import * as db from './db.js'
import { uid } from './model.js'

const asset = (file) => `${import.meta.env.BASE_URL}examples/${file}`

export const EXAMPLES = [
  {
    id: 'falla-normal-serie-inclinada',
    name: 'Fold & inclined normal fault',
    summary: 'Proyecto de prueba digitalizado sobre una imagen de mapa: curvas de nivel, siete unidades, seis contactos, una falla normal, dos perfiles y tres pozos.',
    detail: 'Trae la imagen base, la escala calibrada, el marco de trabajo y un par de puntos de perforación para el salto de falla.',
    url: asset('falla-normal-serie-inclinada.mapteaching.json'),
  },
  {
    id: 'fold-fault-unconformity',
    name: 'Fold, fault & unconformity',
    summary: 'Proyecto de prueba digitalizado sobre una imagen de mapa: curvas de nivel, diez unidades plegadas, nueve contactos —uno discordante—, dos fallas normales y dos perfiles.',
    detail: 'Trae la imagen base y la escala calibrada. La discordancia trunca el pliegue de la serie inferior, y las dos fallas normales cortan el conjunto.',
    url: asset('fold-fault-unconformity.mapteaching.json'),
  },
  {
    id: 'dike-pinch-out',
    name: 'Dike pinch-out',
    summary: 'Ejercicio sintético: la misma serie inclinada y falla normal del ejemplo base, más un dique andesítico de manteo empinado cuyas dos paredes convergen hacia el norte.',
    detail: 'Sin imagen: relieve y trazas generados por código, como el ejercicio de arranque. El dique se acuña donde sus dos paredes se cruzan, y trae un tercer perfil que lo corta donde aún tiene espesor.',
    url: asset('dike-pinch-out.mapteaching.json'),
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
  const res = await fetch(example.url)
  if (!res.ok) throw new Error(`No se pudo descargar el ejemplo (${res.status})`)
  const project = await adoptProject(await res.json(), example.name)
  await db.saveProject(project)
  return project
}
