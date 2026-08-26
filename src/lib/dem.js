// Modelo de elevación digital a partir de las curvas de nivel.
//
// Sólo entran aquí las curvas de nivel topográficas. Los contactos y las fallas
// son trazas geológicas, no isohipsas: no dicen nada de la cota del terreno y
// nunca se pasan a esta función (véase `scene.js`).
//
// El método es el que se hace a mano: entre la curva de 300 y la de 400 se
// dibujan curvas intermedias equiespaciadas —310, 320, … 390— que van pasando
// gradualmente de la forma de una a la de la otra, y el relieve queda definido
// por esa familia de curvas. Aquí no se dibujan n curvas sueltas sino el campo
// continuo del que salen: en cada punto se mide la distancia a la curva de
// abajo y a la de arriba, y la cota sale del reparto entre ambas. Las curvas de
// nivel intermedias son exactamente las curvas de nivel de ese campo, así que
// el paso entre una curva y la siguiente es gradual por construcción y no
// depende de cuántas intermedias se quieran.
//
// Ese reparto no puede ser lineal, y es lo que dejaba el relieve escalonado.
// Con el reparto lineal la ladera es un plano dentro de cada banda: baja con
// pendiente equidistancia/ancho-de-la-banda, constante, y al cruzar la curva
// siguiente cambia de golpe a la pendiente de la banda de al lado. La cota es
// continua —por eso en planta no se notaba— pero la pendiente no, y el
// sombreado lee justo la pendiente: cada curva salía dibujada como una arista,
// una franja de terraza. Las intermedias equiespaciadas quedaban además
// apelotonadas a un lado de la curva y sueltas al otro.
//
// Así que dentro de cada banda el reparto es una cúbica de Hermite monótona
// (PCHIP): pasa por las dos cotas y llega a cada curva con la pendiente
// promedio —media armónica— de las dos bandas que ahí se juntan. Como las dos
// bandas vecinas calculan esa misma media, la pendiente coincide a los dos
// lados y la ladera cruza la curva sin quiebre. La media armónica es la de
// PCHIP y garantiza que la cúbica no se pase de las cotas de sus curvas: entre
// la de 300 y la de 400 no puede haber ni un pico de 410 ni un hoyo de 290, y
// las curvas intermedias salen repartidas de verdad.
//
// Lo que hace que funcione —y lo que fallaba antes— es *con qué par de curvas
// se interpola*. No sirve tomar las dos cotas más cercanas: junto a un collado,
// la segunda cota más próxima salta de la de arriba a la de abajo de un nodo al
// siguiente y la cota interpolada da un brinco de casi dos equidistancias. Por
// eso las curvas se rasterizan primero y se etiquetan las *regiones* que
// delimitan: dentro de una región las curvas que la encierran no cambian, las
// distancias se miden sin salir de ella, y el campo no puede saltar.
//
// Para que ese etiquetado signifique algo, las curvas tienen que cerrar el paso
// de verdad: si entre el final de una curva y el borde de la lámina queda un
// pasillo abierto, las dos laderas que separaba se reencuentran rodeando por
// fuera y pasan a ser la misma región. Con unos pocos pasillos el mapa entero
// acaba siendo una sola región, sin par de curvas que mande en ningún sitio, y
// el relieve se calcula a ciegas —aterrazado, con un rellano en cada curva—. De
// ahí que se prolonguen los extremos que se salen de la lámina y que lo que
// queda fuera del área de trabajo sea barrera: allí no hay curvas que
// digitalizar, así que el margen vacío es el pasillo más ancho de todos.
//
// Quedan las regiones que sólo tocan una curva: el interior de una curva
// cerrada, es decir una cumbre o una depresión. Ahí no hay nada que
// interpolar y hay que prolongar. Se levanta (o se hunde) una bóveda que
// arranca con la misma pendiente que trae la ladera de fuera y se aplana en el
// centro, acotada a una equidistancia: por encima habría otra curva dibujada.
// Es lo que se lee en el mapa —una cima está entre la última curva y la
// siguiente que no llegó a dibujarse— y evita tanto la meseta plana como el
// pico inventado.

/**
 * Rasteriza las curvas sobre la grilla y devuelve, de paso, los puntos densos
 * de cada cota. Las celdas por las que pasa una curva quedan fijadas a su cota:
 * son las condiciones de contorno de todo lo demás y no se tocan nunca más.
 */
function rasterizeLevels(levels, bbox, nx, ny, cell, outside) {
  const n = nx * ny
  const fixed = new Uint8Array(n)
  const fixZ = new Float32Array(n)
  const fixLevel = new Int16Array(n).fill(-1)
  const points = levels.map(() => [])

  const stamp = (x, y, li, z) => {
    const i = Math.round((x - bbox.minX) / cell)
    const j = Math.round((y - bbox.minY) / cell)
    points[li].push([x, y])
    if (i < 0 || j < 0 || i >= nx || j >= ny) return
    const k = j * nx + i
    fixed[k] = 1
    fixZ[k] = z
    fixLevel[k] = li
  }

  // Se recorre el segmento a medio paso de celda: así la traza queda continua
  // aunque los vértices estén muy separados, y dos regiones vecinas nunca se
  // filtran la una en la otra.
  const stampSegment = (a, b, li, elevation) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (cell * 0.5)))
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      stamp(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, li, elevation)
    }
  }

  /**
   * Una curva que se sale de la lámina se prolonga hasta salir de ella.
   *
   * En el mapa esa curva separa lo que queda a un lado de lo que queda al otro
   * hasta el borde mismo. Si se la deja terminar un poco antes, queda un pasillo
   * abierto por fuera, y basta *uno* para que dos bandas de cotas muy distintas
   * pasen a ser la misma región. Con unos pocos pasillos el mapa entero acaba
   * siendo una sola región y el relieve se calcula a ciegas.
   *
   * Se prueba a salir por donde venía la curva y por las cuatro direcciones de
   * la grilla, y se toma la salida más corta. Sólo se prolongan los extremos que
   * ya están a un paso de salir: uno que acaba en mitad del mapa es una traza
   * incompleta, y ahí no hay nada que cerrar.
   */
  const reach = Math.max(cell * 4, Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) * 0.02)
  const isOutside = (x, y) => {
    const i = Math.round((x - bbox.minX) / cell)
    const j = Math.round((y - bbox.minY) / cell)
    if (i < 0 || j < 0 || i >= nx || j >= ny) return true
    return outside[j * nx + i] === 1
  }
  const extendToBorder = (end, inner, li, elevation) => {
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
    const tx = end[0] - inner[0]
    const ty = end[1] - inner[1]
    const tm = Math.hypot(tx, ty)
    if (tm > 1e-9) dirs.push([tx / tm, ty / tm])
    let best = null
    const step = cell * 0.5
    for (const dir of dirs) {
      for (let d = step; d <= reach; d += step) {
        if (!isOutside(end[0] + dir[0] * d, end[1] + dir[1] * d)) continue
        if (!best || d < best[0]) best = [d, dir]
        break
      }
    }
    if (!best) return
    const [d, dir] = best
    // Se sale un par de celdas más allá para tapar también la orla de nodos que
    // la grilla deja por fuera del último dato.
    const len = d + cell * 2
    stampSegment(end, [end[0] + dir[0] * len, end[1] + dir[1] * len], li, elevation)
  }

  for (let li = 0; li < levels.length; li++) {
    const { elevation, lines } = levels[li]
    for (const pts of lines) {
      if (!pts?.length) continue
      stamp(pts[0][0], pts[0][1], li, elevation)
      for (let m = 1; m < pts.length; m++) stampSegment(pts[m - 1], pts[m], li, elevation)
      const first = pts[0]
      const last = pts[pts.length - 1]
      const closed = pts.length > 2 && Math.hypot(last[0] - first[0], last[1] - first[1]) <= cell
      if (!closed) {
        extendToBorder(first, pts[1] || first, li, elevation)
        extendToBorder(last, pts[pts.length - 2] || last, li, elevation)
      }
    }
  }
  return { fixed, fixZ, fixLevel, points }
}

/**
 * Etiqueta las regiones que las curvas dejan entre sí (relleno por inundación,
 * 4-conectividad) y anota, para cada una, la cota más baja y la más alta de las
 * curvas que la tocan: son las dos con las que se interpola dentro.
 *
 * Lo que cae fuera del área de trabajo tampoco se inunda: es tan barrera como
 * una curva. Sin eso, dos laderas separadas por una curva se reencuentran
 * rodeando por el margen —donde no hay curvas que digitalizar— y acaban siendo
 * la misma región.
 */
function labelRegions(fixed, fixLevel, outside, nx, ny) {
  const n = nx * ny
  const region = new Int32Array(n).fill(-1)
  const stack = new Int32Array(n)
  const lo = []
  const hi = []
  const size = []
  const levelsOf = []
  let count = 0

  for (let start = 0; start < n; start++) {
    if (fixed[start] || outside[start] || region[start] >= 0) continue
    const id = count++
    lo.push(Infinity)
    hi.push(-Infinity)
    size.push(0)
    levelsOf.push(new Set())
    let top = 0
    stack[top++] = start
    region[start] = id
    while (top > 0) {
      const k = stack[--top]
      size[id]++
      const i = k % nx
      const j = (k - i) / nx
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue
          const ii = i + di
          const jj = j + dj
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue
          const kn = jj * nx + ii
          if (fixed[kn]) {
            // Curva vecina: anota su cota como límite de esta región.
            const li = fixLevel[kn]
            if (li >= 0) {
              if (li < lo[id]) lo[id] = li
              if (li > hi[id]) hi[id] = li
              levelsOf[id].add(li)
            }
            continue
          }
          if (outside[kn]) continue
          // La inundación va por lados, no por esquinas: dos regiones que se
          // tocan sólo en diagonal están separadas por la curva que pasa entre
          // ellas y no deben fundirse.
          if (di !== 0 && dj !== 0) continue
          if (region[kn] < 0) {
            region[kn] = id
            stack[top++] = kn
          }
        }
      }
    }
  }
  return { region, lo, hi, size, levelsOf: levelsOf.map((s) => [...s].sort((a, b) => a - b)), count }
}

/**
 * Distancia a una curva de nivel (transformada vectorial de Danielsson, dos
 * pasadas). Propaga el vector al punto más cercano, no un conteo de pasos, así
 * que la distancia es prácticamente exacta y —lo que importa aquí— isótropa: un
 * chamfer por pasos deja facetas en las direcciones diagonales que se cuelan
 * tal cual en el relieve.
 */
function distanceField(samples, bbox, nx, ny, cell) {
  const n = nx * ny
  const vx = new Float32Array(n)
  const vy = new Float32Array(n)
  const d2 = new Float64Array(n).fill(Infinity)
  for (const p of samples) {
    let ix = Math.round((p[0] - bbox.minX) / cell)
    let iy = Math.round((p[1] - bbox.minY) / cell)
    ix = Math.max(0, Math.min(nx - 1, ix))
    iy = Math.max(0, Math.min(ny - 1, iy))
    const k = iy * nx + ix
    const dx = p[0] - (bbox.minX + ix * cell)
    const dy = p[1] - (bbox.minY + iy * cell)
    const q = dx * dx + dy * dy
    if (q < d2[k]) {
      d2[k] = q
      vx[k] = dx
      vy[k] = dy
    }
  }
  const relax = (k, kn, ox, oy) => {
    if (d2[kn] === Infinity) return
    const dx = vx[kn] + ox
    const dy = vy[kn] + oy
    const q = dx * dx + dy * dy
    if (q < d2[k]) {
      d2[k] = q
      vx[k] = dx
      vy[k] = dy
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      if (i > 0) relax(k, k - 1, -cell, 0)
      if (j > 0) relax(k, k - nx, 0, -cell)
      if (i > 0 && j > 0) relax(k, k - nx - 1, -cell, -cell)
      if (i < nx - 1 && j > 0) relax(k, k - nx + 1, cell, -cell)
    }
  }
  for (let j = ny - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i
      if (i < nx - 1) relax(k, k + 1, cell, 0)
      if (j < ny - 1) relax(k, k + nx, 0, cell)
      if (i < nx - 1 && j < ny - 1) relax(k, k + nx + 1, cell, cell)
      if (i > 0 && j < ny - 1) relax(k, k + nx - 1, -cell, cell)
    }
  }
  const out = new Float64Array(n)
  for (let k = 0; k < n; k++) out[k] = Math.sqrt(d2[k])
  return out
}

/**
 * Rellena los nodos por los que pasa una curva —los únicos huecos que deja el
 * campo— con el promedio de sus vecinos, unas cuantas relajaciones.
 *
 * Clavarlos a la cota de la curva no vale: la curva de 1300 pasa por *dentro*
 * de la celda, y el centro del nodo queda un poco a un lado, así que su cota es
 * 1300 más o menos lo que ese trocito de ladera suba o baje. Clavarlo dejaba
 * una muesca de medio nodo a lo largo de cada curva —el escalón que se veía
 * sombreado— y no se puede corregir con la distancia, que no lleva signo.
 *
 * El promedio de los vecinos sí lo resuelve: la ladera a un lado y otro del
 * trazo ya está bien calculada, y en un tramo recto el promedio de los dos
 * vecinos opuestos da exactamente el valor de en medio. Repetirlo unas pasadas
 * propaga el relleno a los pocos sitios donde el trazo es más grueso de un nodo
 * (una curva en diagonal, o dos curvas que casi se tocan).
 */
function fillTraceCells(z, fixed, outside, nx, ny, passes = 12) {
  const holes = []
  for (let k = 0; k < nx * ny; k++) if (fixed[k] && !outside[k]) holes.push(k)
  if (!holes.length) return
  for (let p = 0; p < passes; p++) {
    let moved = 0
    for (const k of holes) {
      const i = k % nx
      const j = (k - i) / nx
      let sum = 0
      let w = 0
      // Los vecinos de fuera del trazo mandan; los de dentro sólo empujan el
      // relleno hacia el interior de un trazo grueso.
      for (const [ii, jj] of [
        [i - 1, j],
        [i + 1, j],
        [i, j - 1],
        [i, j + 1],
      ]) {
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue
        const kn = jj * nx + ii
        if (outside[kn]) continue
        const wn = fixed[kn] ? 0.25 : 1
        sum += z[kn] * wn
        w += wn
      }
      if (!w) continue
      const v = sum / w
      moved = Math.max(moved, Math.abs(v - z[k]))
      z[k] = v
    }
    if (moved < 1e-3) break
  }
}

/**
 * Prolonga el relieve fuera del área de trabajo copiando, en cada nodo, la cota
 * del nodo válido más cercano (misma transformada vectorial de dos pasadas que
 * las distancias a las curvas).
 *
 * Fuera del recorte no hay curvas que interpolar, así que tampoco hay relieve
 * que calcular; pero la malla de la vista 3D cubre toda la imagen, y dejar el
 * margen a una cota inventada abre un escalón a lo largo del borde del área de
 * trabajo. Copiando el vecino válido más cercano el margen sale como una
 * prolongación horizontal del terreno: encaja en el borde y no añade pendiente.
 */
function extendOutside(z, outside, nx, ny, cell) {
  const n = nx * ny
  if (!outside.includes(1)) return
  const vx = new Float32Array(n)
  const vy = new Float32Array(n)
  const d2 = new Float64Array(n)
  const src = new Float32Array(n)
  for (let k = 0; k < n; k++) {
    if (outside[k]) d2[k] = Infinity
    else ((d2[k] = 0), (src[k] = z[k]))
  }
  const relax = (k, kn, ox, oy) => {
    if (d2[kn] === Infinity) return
    const dx = vx[kn] + ox
    const dy = vy[kn] + oy
    const q = dx * dx + dy * dy
    if (q < d2[k]) ((d2[k] = q), (vx[k] = dx), (vy[k] = dy), (src[k] = src[kn]))
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      if (!outside[k]) continue
      if (i > 0) relax(k, k - 1, -cell, 0)
      if (j > 0) relax(k, k - nx, 0, -cell)
      if (i > 0 && j > 0) relax(k, k - nx - 1, -cell, -cell)
      if (i < nx - 1 && j > 0) relax(k, k - nx + 1, cell, -cell)
    }
  }
  for (let j = ny - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i
      if (!outside[k]) continue
      if (i < nx - 1) relax(k, k + 1, cell, 0)
      if (j < ny - 1) relax(k, k + nx, 0, cell)
      if (i < nx - 1 && j < ny - 1) relax(k, k + nx + 1, cell, cell)
      if (i > 0 && j < ny - 1) relax(k, k + nx - 1, -cell, cell)
    }
  }
  for (let k = 0; k < n; k++) if (outside[k] && d2[k] < Infinity) z[k] = src[k]
}

/**
 * Suavizado con un núcleo 3×3, unas pocas pasadas. Limpia el ruido de nodo a
 * nodo que deja la rasterización de las curvas, sin mover el relieve de donde
 * el mapa lo pone.
 */
function smooth(z, nx, ny, passes) {
  if (passes <= 0) return z
  let src = z
  let dst = new Float32Array(z.length)
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let sum = 0
        let wsum = 0
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj
          if (jj < 0 || jj >= ny) continue
          for (let di = -1; di <= 1; di++) {
            const ii = i + di
            if (ii < 0 || ii >= nx) continue
            const w = (di === 0 ? 2 : 1) * (dj === 0 ? 2 : 1)
            sum += src[jj * nx + ii] * w
            wsum += w
          }
        }
        dst[j * nx + i] = sum / wsum
      }
    }
    const tmp = src
    src = dst
    dst = tmp
  }
  return src
}

/**
 * @param levels  [{ elevation, lines: [[[x,y], ...], ...] }] en coordenadas mundo
 * @param bbox    { minX, minY, maxX, maxY }
 * @param res     número de celdas en el lado mayor
 * @param inFrame (x, y) => boolean — área de trabajo, si el ejercicio define una.
 *                La grilla cubre toda la imagen, pero las curvas sólo se
 *                digitalizan dentro del área de trabajo: sin este dato el
 *                margen vacío es un pasillo que une todas las bandas.
 */
export function buildDem(levels, bbox, res = 200, smoothPasses = 3, inFrame = null) {
  const width = bbox.maxX - bbox.minX
  const height = bbox.maxY - bbox.minY
  const side = Math.max(width, height)
  const cell = side / res
  const nx = Math.max(2, Math.ceil(width / cell) + 1)
  const ny = Math.max(2, Math.ceil(height / cell) + 1)
  const n = nx * ny
  const z = new Float32Array(n)

  const usable = levels
    .filter((l) => Number.isFinite(l.elevation) && l.lines?.some((pts) => pts?.length))
    .sort((a, b) => a.elevation - b.elevation)

  if (usable.length === 0) return makeDem(bbox, nx, ny, cell, z, 0, 0, false)
  if (usable.length === 1) {
    z.fill(usable[0].elevation)
    return makeDem(bbox, nx, ny, cell, z, usable[0].elevation, usable[0].elevation, true)
  }

  const elevationOf = usable.map((l) => l.elevation)
  const outside = new Uint8Array(n)
  if (inFrame) {
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        if (!inFrame(bbox.minX + i * cell, bbox.minY + j * cell)) outside[j * nx + i] = 1
  }
  const { fixed, fixZ, fixLevel, points } = rasterizeLevels(usable, bbox, nx, ny, cell, outside)
  const { region, lo, hi, levelsOf, count } = labelRegions(fixed, fixLevel, outside, nx, ny)

  // Un campo de distancias por cota. La región dice *con cuáles* interpolar en
  // cada nodo; el campo dice a qué distancia están.
  const fields = usable.map((l, li) => distanceField(points[li], bbox, nx, ny, cell))
  const distTo = (li, k) => (li >= 0 && li < fields.length ? fields[li][k] : Infinity)

  // Tres clases de región, según cuántas curvas la limitan:
  //  · una sola  → cumbre o depresión: hay que prolongar,
  //  · dos consecutivas → ladera limpia: reparto lineal entre ambas,
  //  · más de dos → el margen exterior del mapa, o un trozo donde falta una
  //    curva. Ahí no hay un par que mande, y repartir entre la más baja y la
  //    más alta inventaría una rampa enorme; se promedia por inverso del
  //    cuadrado de la distancia, que vale la cota exacta al llegar a cada curva
  //    y pasa de una a otra sin costuras.
  const BAND = 0
  const CAP = 1
  const MIXED = 2
  const kind = new Uint8Array(count)
  for (let r = 0; r < count; r++) {
    if (!Number.isFinite(lo[r]) || lo[r] === hi[r]) kind[r] = CAP
    else if (hi[r] - lo[r] === 1) kind[r] = BAND
    else kind[r] = MIXED
  }

  // Las celdas por las que pasa una curva quedan fuera de todas las regiones:
  // son huecos en el campo, y se rellenan al final (véase `fillTraceCells`). No
  // se les puede asignar una banda: la curva pasa por algún punto dentro de la
  // celda, y la distancia —que no tiene signo— no dice de qué lado del trazo
  // quedó el centro del nodo. Asignarlas a la banda de abajo ponía cada celda
  // de curva hasta una celda entera por debajo de donde va, y esa muesca de un
  // nodo, repetida a lo largo de todas las curvas, es la terraza que se veía.

  // Pendiente de la banda que hay más allá de una curva, medida desde este
  // mismo nodo. `near` es lo que dista el nodo de la curva compartida; la curva
  // del otro extremo de esa banda está `near + ancho` más lejos, así que la
  // resta da el ancho de la banda vecina justo por aquí. Es una estimación
  // —la curva de más allá podría quedar más cerca rodeando un espolón— y por
  // eso se acota a un múltiplo de la pendiente de esta banda: sirve para
  // suavizar el paso, no para mandar sobre él.
  const NEIGHBOUR_RATIO = 5
  const neighbourSlope = (outer, inner, near, k, own) => {
    if (outer < 0 || outer >= elevationOf.length) return own
    const width = distTo(outer, k) - near
    if (!Number.isFinite(width) || width < cell * 0.5) return own
    const s = Math.abs(elevationOf[outer] - elevationOf[inner]) / width
    if (!(s > 0)) return own
    return Math.max(own / NEIGHBOUR_RATIO, Math.min(own * NEIGHBOUR_RATIO, s))
  }
  /** Media armónica: la pendiente con la que se llega a la curva desde ambos lados. */
  const meetingSlope = (p, q) => (p > 0 && q > 0 ? (2 * p * q) / (p + q) : 0)

  /**
   * Cota donde no hay un par de curvas que mande: los trozos en que falta una
   * curva y la región toca tres cotas o más.
   *
   * No sirve promediar las cotas por inverso de la distancia. Con peso 1/d² la
   * curva más cercana aplasta a las demás y un buen trozo alrededor de cada
   * curva se queda pegado a su cota: sale un rellano en cada curva y un escalón
   * entre ellas, que es justo el aterrazado que se ve sombreado. Bajar el
   * exponente lo reparte, pero entonces las curvas lejanas tiran del resultado
   * y la ladera se deforma.
   *
   * Lo que se promedia son *parejas* de curvas, no curvas sueltas: cada pareja
   * propone el mismo reparto lineal que en una banda, y pesa según lo estrecho
   * que sea el paso entre sus dos curvas por aquí —la cuarta potencia, para que
   * la pareja que de verdad encierra al nodo mande y las demás apenas cuenten—.
   * Al acercarse a una curva el valor tiende a su cota de forma lineal —no
   * cuadrática—, así que no deja rellano. Sale mejor que el promedio por
   * distancia en las dos cosas a la vez: se aparta la mitad del terreno real y
   * reparte los nodos entre las cotas en vez de apelotonarlos en ellas.
   */
  const bracketed = (list, k) => {
    let num = 0
    let den = 0
    for (let a = 0; a < list.length; a++) {
      const da = distTo(list[a], k)
      if (!Number.isFinite(da)) continue
      if (da < 1e-6) return elevationOf[list[a]]
      for (let b = a + 1; b < list.length; b++) {
        const db = distTo(list[b], k)
        if (!Number.isFinite(db)) continue
        const s = da + db
        if (!(s > 1e-9)) continue
        const w = 1 / (s * s * s * s)
        num += w * ((elevationOf[list[a]] * db + elevationOf[list[b]] * da) / s)
        den += w
      }
    }
    return den > 0 ? num / den : null
  }

  // --- Laderas y márgenes.
  for (let k = 0; k < n; k++) {
    if (fixed[k]) {
      // Valor de partida del hueco: la cota de la curva. El relleno lo afina.
      z[k] = fixZ[k]
      continue
    }
    const r = region[k]
    if (r < 0) {
      // Fuera del área de trabajo: lo resuelve `extendOutside` al final.
      z[k] = elevationOf[0]
      continue
    }
    if (kind[r] === CAP) continue
    if (kind[r] === BAND) {
      const li = lo[r]
      const hj = hi[r]
      const zLo = elevationOf[li]
      const zHi = elevationOf[hj]
      const a = distTo(li, k)
      const b = distTo(hj, k)
      const w = a + b
      if (!(w > 1e-9) || !Number.isFinite(w)) {
        z[k] = zLo
        continue
      }
      // Pendiente propia de la banda aquí, y la de las bandas de encima y de
      // debajo. Donde no hay banda vecina —la curva de más abajo del mapa, o la
      // que rodea una cumbre— se usa la propia, y el tramo sale recto por ese
      // extremo, que es lo que había antes.
      const own = (zHi - zLo) / w
      const below = neighbourSlope(li - 1, li, a, k, own)
      const above = neighbourSlope(hj + 1, hj, b, k, own)
      // Tangentes de la cúbica en coordenada de banda (t = 0 en la curva de
      // abajo, t = 1 en la de arriba): pendiente del terreno × ancho de banda.
      const m0 = meetingSlope(below, own) * w
      const m1 = meetingSlope(own, above) * w
      const t = a / w
      const t2 = t * t
      const t3 = t2 * t
      z[k] =
        (2 * t3 - 3 * t2 + 1) * zLo +
        (t3 - 2 * t2 + t) * m0 +
        (-2 * t3 + 3 * t2) * zHi +
        (t3 - t2) * m1
      continue
    }
    const v = bracketed(levelsOf[r], k)
    z[k] = v == null ? elevationOf[lo[r]] : v
  }

  // --- Regiones de cumbre o depresión: bóveda que prolonga la ladera de fuera.
  // Para cada una hacen falta tres cosas: hacia dónde sigue el relieve (arriba
  // o abajo), con qué pendiente llega la ladera vecina, y hasta dónde puede
  // subir antes de que tocara dibujar la curva siguiente.
  const capApex = new Float64Array(count)
  for (let k = 0; k < n; k++) {
    const r = region[k]
    if (r < 0 || kind[r] !== CAP) continue
    const d = distTo(lo[r], k)
    if (d > capApex[r]) capApex[r] = d
  }

  const upVotes = new Int32Array(count)
  const downVotes = new Int32Array(count)
  const slopeSum = new Float64Array(count)
  const slopeN = new Int32Array(count)
  for (let k = 0; k < n; k++) {
    if (!fixed[k]) continue
    const li = fixLevel[k]
    if (li < 0) continue
    const i = k % nx
    const j = (k - i) / nx
    // Regiones que esta celda de curva separa: la de dentro (la cumbre) y la de
    // fuera (la ladera). La ladera dice hacia dónde sigue el terreno y con qué
    // pendiente llega.
    let capId = -1
    for (let dj = -1; dj <= 1 && capId < 0; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ii = i + di
        const jj = j + dj
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue
        const r = region[jj * nx + ii]
        if (r >= 0 && kind[r] === CAP && lo[r] === li) {
          capId = r
          break
        }
      }
    }
    if (capId < 0) continue
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ii = i + di
        const jj = j + dj
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue
        const kn = jj * nx + ii
        const r = region[kn]
        if (r < 0 || r === capId || kind[r] !== BAND) continue
        const zLo = elevationOf[lo[r]]
        const zHi = elevationOf[hi[r]]
        if (hi[r] === li && lo[r] < li) upVotes[capId]++
        else if (lo[r] === li && hi[r] > li) downVotes[capId]++
        else continue
        // Ancho de la banda vecina medido justo aquí: la distancia desde este
        // nodo hasta la otra curva. La pendiente de llegada es la equidistancia
        // dividida por ese ancho.
        const w = hi[r] === li ? distTo(lo[r], kn) : distTo(hi[r], kn)
        if (Number.isFinite(w) && w > cell * 0.5) {
          slopeSum[capId] += Math.abs(zHi - zLo) / w
          slopeN[capId]++
        }
      }
    }
  }

  const capHeight = new Float64Array(count)
  const capSign = new Float64Array(count)
  for (let r = 0; r < count; r++) {
    if (kind[r] !== CAP || !Number.isFinite(lo[r])) continue
    const li = lo[r]
    const sign = upVotes[r] >= downVotes[r] && upVotes[r] > 0 ? 1 : downVotes[r] > 0 ? -1 : 0
    capSign[r] = sign
    if (!sign) continue
    // Equidistancia local: la que separa esta curva de la vecina en esa
    // dirección; si no hay otra, la mediana del mapa.
    const nb = sign > 0 ? li - 1 : li + 1
    const interval =
      nb >= 0 && nb < elevationOf.length
        ? Math.abs(elevationOf[li] - elevationOf[nb])
        : medianInterval(elevationOf)
    const slope = slopeN[r] ? slopeSum[r] / slopeN[r] : 0
    // La bóveda arranca con la pendiente de la ladera (su derivada en la base
    // es 2h/apex) y se acota a una equidistancia: por encima ya tocaría otra
    // curva dibujada.
    capHeight[r] = Math.min(interval * 0.9, (slope * capApex[r]) / 2)
  }

  for (let k = 0; k < n; k++) {
    const r = region[k]
    if (r < 0 || kind[r] !== CAP) continue
    const z0 = Number.isFinite(lo[r]) ? elevationOf[lo[r]] : elevationOf[0]
    const apex = capApex[r]
    if (!capSign[r] || apex < 1e-9) {
      z[k] = z0
      continue
    }
    // Bóveda parabólica: pendiente de la ladera en la base, plana en la cima.
    const u = Math.min(1, distTo(lo[r], k) / apex)
    z[k] = z0 + capSign[r] * capHeight[r] * (2 * u - u * u)
  }

  fillTraceCells(z, fixed, outside, nx, ny)
  extendOutside(z, outside, nx, ny, cell)

  const smoothed = smooth(z, nx, ny, Math.max(0, smoothPasses))
  if (smoothed !== z) z.set(smoothed)

  let zmin = Infinity
  let zmax = -Infinity
  for (let k = 0; k < n; k++) {
    const v = z[k]
    if (v < zmin) zmin = v
    if (v > zmax) zmax = v
  }
  return makeDem(bbox, nx, ny, cell, z, zmin, zmax, true)
}

/** Equidistancia representativa del mapa (mediana de los saltos entre cotas). */
function medianInterval(elevations) {
  const gaps = []
  for (let i = 1; i < elevations.length; i++) gaps.push(elevations[i] - elevations[i - 1])
  if (!gaps.length) return 0
  gaps.sort((a, b) => a - b)
  return gaps[gaps.length >> 1]
}

function makeDem(bbox, nx, ny, cell, z, zmin, zmax, valid) {
  const elevationAt = (x, y) => {
    const fx = (x - bbox.minX) / cell
    const fy = (y - bbox.minY) / cell
    let ix = Math.floor(fx)
    let iy = Math.floor(fy)
    ix = Math.max(0, Math.min(nx - 2, ix))
    iy = Math.max(0, Math.min(ny - 2, iy))
    const tx = Math.max(0, Math.min(1, fx - ix))
    const ty = Math.max(0, Math.min(1, fy - iy))
    const z00 = z[iy * nx + ix]
    const z10 = z[iy * nx + ix + 1]
    const z01 = z[(iy + 1) * nx + ix]
    const z11 = z[(iy + 1) * nx + ix + 1]
    return z00 * (1 - tx) * (1 - ty) + z10 * tx * (1 - ty) + z01 * (1 - tx) * ty + z11 * tx * ty
  }
  return { bbox, nx, ny, cell, z, zmin, zmax, valid, elevationAt }
}
