// Persistencia local: proyectos + imágenes base en IndexedDB.

const DB_NAME = 'geoestructura'
const DB_VERSION = 1
const STORE_PROJECTS = 'projects'
const STORE_BLOBS = 'blobs'

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx(store, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode)
        const s = t.objectStore(store)
        let out
        try {
          out = fn(s)
        } catch (err) {
          reject(err)
          return
        }
        t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out)
        t.onerror = () => reject(t.error)
        t.onabort = () => reject(t.error)
      })
  )
}

export const saveProject = (project) => tx(STORE_PROJECTS, 'readwrite', (s) => s.put(project))
export const deleteProject = (id) => tx(STORE_PROJECTS, 'readwrite', (s) => s.delete(id))
export const getProject = (id) => tx(STORE_PROJECTS, 'readonly', (s) => s.get(id))

export async function listProjects() {
  const all = await tx(STORE_PROJECTS, 'readonly', (s) => s.getAll())
  return (all || []).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
}

export const putBlob = (key, blob) => tx(STORE_BLOBS, 'readwrite', (s) => s.put(blob, key))
export const getBlob = (key) => tx(STORE_BLOBS, 'readonly', (s) => s.get(key))
export const deleteBlob = (key) => tx(STORE_BLOBS, 'readwrite', (s) => s.delete(key))

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

export async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl)
  return res.blob()
}

export function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => resolve({ img, url })
    img.onerror = (e) => {
      URL.revokeObjectURL(url)
      reject(e)
    }
    img.src = url
  })
}
