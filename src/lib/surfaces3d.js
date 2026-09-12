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
 * Con `eroded` se pide justo lo contrario del primer recorte: el trozo que queda
 * **por encima** del terreno, es decir la parte de la superficie que ya se ha
 * erosionado. No es geología observable sino su prolongación, y por eso se
 * dibuja aparte y translúcida; es lo que deja ver hacia dónde seguía el pliegue
 * antes de que el relieve lo cortara. Se limita por arriba con `zMax`.
 *
 * Devuelve, por contacto y bloque, los triángulos en coordenadas de terreno.
 */
export function contactMeshes(
  scene,
  { zMin = -Infinity, zMax = Infinity, inFrame = null, resolution = 110, eroded = false } = {}
) {
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
  const capped = Number.isFinite(zMax)
  // `zMin` recorta igual que `zMax`, no sujeta el vértice: sujetarlo deja dos
  // vértices de un mismo triángulo clavados en la misma cota mientras el
  // tercero sigue en la suya, y ese triángulo sale casi horizontal —el
  // parche plano en el fondo del modelo—. Recortando, el bloque termina donde
  // de verdad cruza esa cota y no antes.
  const cappedMin = Number.isFinite(zMin)

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
            const v = [gx[k], gy[k], z, eroded ? z - gz[k] : gz[k] - z, loose(rooms[k][ci])]
            for (const c of active) v.push(loose(want[c] * (z - zf[c][k])))
            if (capped) v.push(zMax - z)
            if (cappedMin) v.push(z - zMin)
            return v
          })
          const nCrit = 2 + active.length + (capped ? 1 : 0) + (cappedMin ? 1 : 0)
          for (let c = 0; c < nCrit && poly.length >= 3; c++) poly = clipBy(poly, c)
          if (poly.length < 3) continue
          const key = `${ci}|${block}`
          let mesh = byKey.get(key)
          if (!mesh) byKey.set(key, (mesh = { contactIndex: ci, block, tris: [] }))
          // Abanico de triángulos desde el primer vértice del polígono recortado.
          const v0 = poly[0]
          for (let t = 1; t + 1 < poly.length; t++) {
            for (const v of [v0, poly[t], poly[t + 1]]) {
              mesh.tris.push(v[0], v[1], v[2])
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
 * salir del área de trabajo. Con `zTop` se hace además el camino inverso hacia
 * arriba, hasta esa cota o hasta salir del área: es lo que deja ver la falla
 * como una hoja completa, de piso a techo, en vez de cortada justo donde asoma
 * en la traza —que es la cota del terreno ahí, y varía de un punto a otro de
 * la traza—. No se reajusta nada al arrancar: la superficie ya viene anclada a
 * la traza (ver `anchorToTrace`), y retocarla aquí volvería a separar el plano
 * que se ve del que corta.
 *
 * `zTop` puede ser una **función de (x, y)** y no una cota fija. Es lo que hace
 * falta para detener el plano en la superficie que sella la falla: una
 * discordancia no está a una cota, está a la que tenga en cada punto, y por
 * encima de ella la falla no existe —se movió antes y quedó truncada—. Con el
 * techo así, la hoja sube justo hasta la discordancia y se para, en vez de
 * atravesar la cobertura hasta el borde del modelo.
 */
/**
 * Lámina de una superficie que corta la pila: el plano de una falla, o una de
 * las dos paredes de un dique. `zBottom` y `zTop` acotan por dónde se recorta,
 * y los dos aceptan una función `(x, y) → z` para un techo o un suelo que
 * cambian de sitio a lo largo de la traza —una discordancia que sella la
 * falla, o la punta donde un dique se acuña—.
 */
export function faultSheetMesh(trace, surf, dem, { zBottom, zTop = null, inFrame = null, side, rows = 14 } = {}) {
  if (!trace || trace.length < 2 || !surf?.defined) return null
  // Paso «de referencia»: una distancia en el mapa mientras la superficie es
  // tendida, y sólo eso —ver más abajo por qué no basta cuando se empina.
  const step = Math.max(side * 0.0015, 0.5)

  // La cota que `surf.elevationAt(x, y)` da en un plano casi vertical no es de
  // fiar más que exactamente encima de donde se ajustó. La ecuación es
  // z = a·x + b·y + c, y con manteo de 89.6° la pendiente ronda 150: un
  // desvío lateral de apenas 50 m —el trazo digitalizado no cae perfecto
  // sobre la línea del ajuste, ni tiene por qué— sale multiplicado por esa
  // pendiente y da 7500 m de cota espuria. Es la misma matemática por la que
  // `fitPlane` prefiere el ajuste perpendicular para el manteo: aquí es la
  // *evaluación*, no el ajuste, la que se degrada, y ninguna de las dos cosas
  // se arregla acotando el paso del camino —eso ya se hizo y no bastaba—.
  //
  // La salida: no fiarse a ciegas de una cota absoluta lejos de la traza.
  // `{a, b}` sí es de fiar en cualquier punto —es la pendiente del plano, no
  // depende de cuánto se aleje uno de dónde se ajustó—, así que en cada paso
  // se calcula primero cuánto anuncia esa pendiente (`h · g`) y sólo se
  // cambia por lo que de verdad marca la superficie en el punto nuevo cuando
  // las dos cosas más o menos concuerdan. Es lo que deja curvarse a una falla
  // lístrica de manteo moderado —ahí la superficie real y lo que anuncia el
  // plano local casi coinciden—, y lo que evita seguir un valor disparado
  // cuando no: si la lectura se va mucho más allá de lo previsto, no es
  // curvatura, es la amplificación de un plano casi vertical evaluado donde
  // no se ajustó, y se prefiere lo que la propia pendiente anuncia.
  //
  // El punto de partida sí es de fiar: la traza de la falla es, por
  // definición, donde el plano corta el terreno, y el terreno mismo —no la
  // superficie del modelo— es lo que da esa cota sin ambigüedad.
  const walk = (p, dir, limit) => {
    const limitAt = typeof limit === 'function' ? limit : () => limit
    const z0 = dem?.valid ? dem.elevationAt(p[0], p[1]) : surf.elevationAt(p[0], p[1])
    if (!Number.isFinite(z0)) return null
    const path = [[p[0], p[1], z0]]
    let x = p[0]
    let y = p[1]
    let z = z0
    // Con el paso acotado en cota, una falla casi vertical necesita muchos más
    // pasos para bajar la misma distancia que antes cubría de un salto; el
    // límite crece para que eso no la corte antes de tiempo. El costo es
    // trivial: cada paso es una evaluación de un plano o de un pliegue con
    // pocos puntos.
    for (let n = 0; n < 4000; n++) {
      // El techo se pregunta en el punto donde se está, no una vez al salir:
      // una superficie que sella cambia de cota a lo largo de la traza, y una
      // falla inclinada se aparta de ella mientras sube.
      const stop = limitAt(x, y)
      if (!Number.isFinite(stop)) break
      if (dir > 0 ? z <= stop : z >= stop) break
      const s = surf.sampleAt(x, y)
      const g = Math.hypot(s.a, s.b)
      if (!(g > 1e-9)) break
      // Paso repartido como hipotenusa (`step² = horizontal² + vertical²`): el
      // avance en cota queda acotado por `step` en cualquier manteo, y en
      // planta se encoge solo cuanto más vertical es el plano —que es lo que
      // debe pasar: una falla casi vertical se recorre casi en línea recta
      // hacia abajo, con apenas deriva lateral—.
      const h = step / Math.sqrt(1 + g * g)
      const predicted = -dir * h * g
      const nx = x - dir * (s.a / g) * h
      const ny = y - dir * (s.b / g) * h
      if (inFrame && !inFrame(nx, ny)) break
      const ns = surf.sampleAt(nx, ny)
      const actual = Number.isFinite(ns.z) ? ns.z - z : NaN
      // ¿Concuerdan? Un margen generoso —el doble de lo previsto, más un
      // paso— para no desechar curvatura real; nada que se dispare así de
      // lejos de lo que la pendiente local anuncia puede ser tal cosa.
      z += Number.isFinite(actual) && Math.abs(actual - predicted) <= Math.abs(predicted) * 2 + step ? actual : predicted
      x = nx
      y = ny
      path.push([x, y, z])
    }
    return path
  }

  const column = (p) => {
    const down = walk(p, 1, zBottom)
    if (!down) return null
    let path = down
    if (zTop != null) {
      const up = walk(p, -1, zTop)
      // El primer punto de `up` es el mismo `p` que ya encabeza `down`: se
      // quita antes de invertirlo y anteponerlo, para no repetirlo.
      if (up && up.length > 1) path = [...up.slice(1).reverse(), ...down]
    }
    if (path.length < 2) return null
    // Se remuestrea a cotas equiespaciadas para que dos columnas vecinas casen.
    // El suelo puede venir como función del punto —así se detiene la lámina de
    // una pared de dique donde el cuerpo ya se acuñó—, y entonces se pregunta
    // donde arranca la columna.
    const floor = typeof zBottom === 'function' ? zBottom(p[0], p[1]) : zBottom
    const zHigh = path[0][2]
    const zLow = Number.isFinite(floor) ? Math.max(floor, path[path.length - 1][2]) : path[path.length - 1][2]
    const col = []
    for (let r = 0; r < rows; r++) {
      const zt = zHigh + ((zLow - zHigh) * r) / (rows - 1)
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
    const col = column(trace[i])
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
