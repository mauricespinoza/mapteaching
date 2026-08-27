// Geometría de las superficies geológicas en tres dimensiones: la malla de cada
// contacto, recortada por todo lo que la limita, y la del plano de cada falla.
//
// Devuelve triángulos en coordenadas de terreno (metros, z hacia arriba); quien
// dibuje se encarga de llevarlos a la escena. Está aquí y no en la vista porque
// es geología, no pintura: el perfil y el 3D deben cortar por lo mismo.

/**
 * Recorte de un polígono por un criterio evaluado en sus vértices
 * (Sutherland–Hodgman). Cada vértice es `[x, y, z, c0, c1, …]`: las tres
 * coordenadas y el valor de cada criterio, que se cumple cuando es ≥ 0. Al
 * cortar una arista se interpolan a la vez la posición y todos los criterios,
 * así que el borde cae **donde el criterio cambia de signo** y no en el borde de
 * la celda: es lo que hace que el corte contra la falla y contra la topografía
 * salga limpio en vez de aserrado.
 */
export function clipBy(poly, c) {
  const out = []
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]
    const prev = poly[(i - 1 + poly.length) % poly.length]
    const fc = cur[3 + c]
    const fp = prev[3 + c]
    if (fc >= 0) {
      if (fp < 0) out.push(mixVertex(prev, cur, fp / (fp - fc)))
      out.push(cur)
    } else if (fp >= 0) {
      out.push(mixVertex(prev, cur, fp / (fp - fc)))
    }
  }
  return out
}

const mixVertex = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)

/**
 * Superficies de contacto, todas de una pasada.
 *
 * En cada nodo se pide la **pila estratigráfica completa** (`scene.stackAt`), no
 * cada contacto por su cuenta: así se aplica la regla de superposición —la
 * superficie joven pasa por encima y la antigua se corta contra ella— y además
 * sale más barato, porque la pila se resuelve una vez para todos los contactos.
 *
 * Cada celda se recorta por tres cosas, y siempre en el punto exacto en que cada
 * una cambia de signo:
 *
 *  1. **la topografía**: por encima ya está erosionada, y el borde que queda es
 *     justo la traza del contacto en el mapa;
 *  2. **el plano de cada falla que limita el bloque**, con su geometría en
 *     profundidad: el bloque de un lado se mete por debajo de la falla y el de
 *     enfrente se retira, en vez de cortarse los dos a plomo bajo la traza;
 *  3. **la superficie joven que lo trunca**, donde la haya: ahí el contacto
 *     antiguo ya no existe y el borde es la línea de subafloramiento.
 *
 * Devuelve, por contacto y bloque, los triángulos en coordenadas de terreno.
 */
export function contactMeshes(scene, { zMin = -Infinity, inFrame = null, resolution = 110 } = {}) {
  const { bbox, dem } = scene
  const N = resolution
  const dx = (bbox.maxX - bbox.minX) / N
  const dy = (bbox.maxY - bbox.minY) / N
  const nc = scene.contacts.length
  const nn = (N + 1) * (N + 1)

  // Rejilla común: coordenadas, topografía y —lo que decide el corte— la cota
  // del plano de cada falla en cada nodo. Se calcula una sola vez porque cada
  // superficie de contacto se prueba contra ella muchas veces.
  const gx = new Float64Array(nn)
  const gy = new Float64Array(nn)
  const gz = new Float64Array(nn).fill(NaN)
  const cuts = scene.faultCuts || []
  const zf = cuts.map(() => new Float64Array(nn).fill(NaN))
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const k = j * (N + 1) + i
      const x = bbox.minX + i * dx
      const y = bbox.minY + j * dy
      gx[k] = x
      gy[k] = y
      if (inFrame && !inFrame(x, y)) continue
      gz[k] = dem.elevationAt(x, y)
      for (let c = 0; c < cuts.length; c++) zf[c][k] = cuts[c].surf.elevationAt(x, y)
    }
  }

  // Bloques que tienen alguna superficie resuelta.
  const blockIds = new Set()
  for (const byBlock of scene.contactSurfaces.values()) for (const b of byBlock.keys()) blockIds.add(b)

  // Un criterio que no se puede evaluar —no hay superficie joven encima, o la
  // falla no llega hasta aquí— se da por cumplido con holgura. Se acota a un
  // valor grande pero finito: un infinito envenenaría la interpolación del
  // recorte, y con esta cota el corte cae junto al vértice que sí lo incumple,
  // que es lo prudente.
  const LOOSE = Math.max(1, dem.zmax - dem.zmin) * 100
  const loose = (v) => (Number.isFinite(v) ? Math.min(v, LOOSE) : LOOSE)

  const byKey = new Map()
  for (const block of blockIds) {
    // De qué lado de cada falla vive este bloque. Un 0 quiere decir que esa
    // falla no lo limita (se acaba dentro de él) y entonces no lo corta.
    const want = cuts.map((c) => scene.blockSideOf(block, c.id))
    const active = []
    for (let c = 0; c < cuts.length; c++) if (want[c]) active.push(c)

    // Pila de este bloque en cada nodo, extrapolada más allá de su extensión en
    // planta: es lo que ocupa el hueco que la falla inclinada deja debajo.
    const stacks = new Array(nn)
    const rooms = new Array(nn)
    for (let k = 0; k < nn; k++) {
      if (!Number.isFinite(gz[k])) continue
      const st = scene.stackAt(gx[k], gy[k], block)
      stacks[k] = st.z.slice()
      rooms[k] = st.room.slice()
    }

    const corners = [0, 0, 0, 0]
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        corners[0] = j * (N + 1) + i
        corners[1] = corners[0] + 1
        corners[2] = (j + 1) * (N + 1) + i + 1
        corners[3] = (j + 1) * (N + 1) + i
        if (corners.some((k) => !stacks[k])) continue
        for (let ci = 0; ci < nc; ci++) {
          if (corners.some((k) => stacks[k][ci] == null)) continue
          // Un vértice por esquina: posición y el valor de cada criterio.
          let poly = corners.map((k) => {
            const z = stacks[k][ci]
            const v = [gx[k], gy[k], z, gz[k] - z, loose(rooms[k][ci])]
            for (const c of active) v.push(loose(want[c] * (z - zf[c][k])))
            return v
          })
          const nCrit = 2 + active.length
          for (let c = 0; c < nCrit && poly.length >= 3; c++) poly = clipBy(poly, c)
          if (poly.length < 3) continue
          const key = `${ci}|${block}`
          let mesh = byKey.get(key)
          if (!mesh) byKey.set(key, (mesh = { contactIndex: ci, block, tris: [] }))
          // Abanico de triángulos desde el primer vértice del polígono recortado.
          const v0 = poly[0]
          for (let t = 1; t + 1 < poly.length; t++) {
            for (const v of [v0, poly[t], poly[t + 1]]) {
              mesh.tris.push(v[0], v[1], Math.max(zMin, v[2]))
            }
          }
        }
      }
    }
  }
  return [...byKey.values()].filter((m) => m.tris.length)
}

/**
 * Malla del plano de falla, tomada de **su propia superficie** y no de una rampa
 * con el manteo medio: es la misma con la que se recortan las unidades, así que
 * lo que se ve y lo que corta son el mismo objeto, y una falla lístrica o
 * alabeada sale curva como debe.
 *
 * Desde cada punto de la traza se desciende siguiendo la línea de máxima
 * pendiente del plano —el buzamiento local— hasta el fondo del modelo o hasta
 * salir del área de trabajo. No se reajusta nada al arrancar: la superficie ya
 * viene anclada a la traza (ver `anchorToTrace`), y retocarla aquí volvería a
 * separar el plano que se ve del que corta.
 */
export function faultSheetMesh(trace, surf, dem, { zBottom, inFrame = null, side, rows = 14 } = {}) {
  if (!trace || trace.length < 2 || !surf?.defined) return null
  const step = Math.max(side * 0.0015, 0.5)
  const eps = step * 0.5
  const zAt = (x, y) => {
    const v = surf.elevationAt(x, y)
    return Number.isFinite(v) ? v : NaN
  }

  const descend = (p) => {
    const zTop = zAt(p[0], p[1])
    if (!Number.isFinite(zTop)) return null
    const path = [[p[0], p[1], zTop]]
    let x = p[0]
    let y = p[1]
    let z = zTop
    for (let n = 0; n < 600 && z > zBottom; n++) {
      const gxg = (zAt(x + eps, y) - zAt(x - eps, y)) / (2 * eps)
      const gyg = (zAt(x, y + eps) - zAt(x, y - eps)) / (2 * eps)
      const g = Math.hypot(gxg, gyg)
      if (!(g > 1e-9)) break
      const nx = x - (gxg / g) * step
      const ny = y - (gyg / g) * step
      if (inFrame && !inFrame(nx, ny)) break
      const nz = zAt(nx, ny)
      if (!Number.isFinite(nz) || nz >= z) break
      x = nx
      y = ny
      z = nz
      path.push([x, y, z])
    }
    if (path.length < 2) return null
    // Se remuestrea a cotas equiespaciadas para que dos columnas vecinas casen.
    const zEnd = Math.max(zBottom, path[path.length - 1][2])
    const col = []
    for (let r = 0; r < rows; r++) {
      const zt = zTop + ((zEnd - zTop) * r) / (rows - 1)
      let k = 0
      while (k + 2 < path.length && path[k + 1][2] > zt) k++
      const a = path[k]
      const b = path[k + 1]
      const t = Math.abs(b[2] - a[2]) > 1e-9 ? (zt - a[2]) / (b[2] - a[2]) : 0
      const u = Math.max(0, Math.min(1, t))
      col.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, zt])
    }
    return col
  }

  const every = Math.max(1, Math.floor(trace.length / 70))
  const cols = []
  for (let i = 0; i < trace.length; i += every) {
    const col = descend(trace[i])
    if (col) cols.push(col)
  }
  if (cols.length < 2) return null
  const tris = []
  for (let i = 1; i < cols.length; i++) {
    const a = cols[i - 1]
    const b = cols[i]
    for (let r = 1; r < rows; r++) {
      for (const v of [a[r - 1], b[r - 1], b[r], a[r - 1], b[r], a[r]]) tris.push(v[0], v[1], v[2])
    }
  }
  return tris.length ? tris : null
}
