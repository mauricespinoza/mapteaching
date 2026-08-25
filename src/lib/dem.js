// Modelo de elevación digital a partir de las curvas de nivel.
//
// El método es el que se hace a mano: entre la curva de 300 y la de 400 se
// dibujan curvas intermedias equiespaciadas —310, 320, … 390— que van pasando
// gradualmente de la forma de una a la de la otra, y el relieve queda definido
// por esa familia de curvas. Aquí no se dibujan n curvas sueltas sino el campo
// continuo del que salen: en cada punto se mide la distancia a la curva de
// abajo y a la de arriba, y la cota es el reparto lineal entre ambas. Las
// curvas de nivel intermedias son exactamente las curvas de nivel de ese campo,
// así que el paso entre una curva y la siguiente es gradual por construcción y
// no depende de cuántas intermedias se quieran.
//
// Lo que hace que funcione —y lo que fallaba antes— es *con qué par de curvas
// se interpola*. No sirve tomar las dos cotas más cercanas: junto a un collado,
// la segunda cota más próxima salta de la de arriba a la de abajo de un nodo al
// siguiente y la cota interpolada da un brinco de casi dos equidistancias. Por
// eso las curvas se rasterizan primero y se etiquetan las *regiones* que
// delimitan: dentro de una región las curvas que la encierran no cambian, las
// distancias se miden sin salir de ella, y el campo no puede saltar.
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
function rasterizeLevels(levels, bbox, nx, ny, cell) {
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
   * Una curva que se va por el borde de la lámina se prolonga hasta el borde.
   * En el mapa esa curva separa lo que queda a un lado de lo que queda al otro
   * también en el margen; si se la deja terminar un poco antes, queda un pasillo
   * abierto por fuera que une bandas de cotas muy distintas y el relieve se
   * desmorona. Sólo se prolongan los extremos que ya están pegados al borde: uno
   * que acaba en mitad del mapa es una traza incompleta, y ahí no hay nada que
   * cerrar.
   */
  const reach = cell * 1.5
  const extendToBorder = (end, inner, li, elevation) => {
    const dx = bbox.minX + (nx - 1) * cell - end[0]
    const dy = bbox.minY + (ny - 1) * cell - end[1]
    const gaps = [
      [end[0] - bbox.minX, [-1, 0]],
      [dx, [1, 0]],
      [end[1] - bbox.minY, [0, -1]],
      [dy, [0, 1]],
    ]
    let best = null
    for (const [gap, dir] of gaps) if (gap <= reach && (!best || gap < best[0])) best = [gap, dir]
    if (!best) return
    const [gap, dir] = best
    // Se sale un par de celdas más allá para tapar también la fila que la
    // grilla añade por encima del último dato.
    const len = gap + cell * 2
    stampSegment(end, [end[0] + dir[0] * len, end[1] + dir[1] * len], li, elevation)
    void inner
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
 */
function labelRegions(fixed, fixLevel, nx, ny) {
  const n = nx * ny
  const region = new Int32Array(n).fill(-1)
  const stack = new Int32Array(n)
  const lo = []
  const hi = []
  const size = []
  const levelsOf = []
  let count = 0

  for (let start = 0; start < n; start++) {
    if (fixed[start] || region[start] >= 0) continue
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
 * Suavizado con un núcleo 3×3, unas pocas pasadas. El reparto lineal en la
 * distancia deja una arista al cruzar cada curva —la pendiente cambia de una
 * banda a la siguiente—, y unas pasadas la redondean sin mover el relieve de
 * donde el mapa lo pone.
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
 * @param levels [{ elevation, lines: [[[x,y], ...], ...] }] en coordenadas mundo
 * @param bbox   { minX, minY, maxX, maxY }
 * @param res    número de celdas en el lado mayor
 */
export function buildDem(levels, bbox, res = 200, smoothPasses = 3) {
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
  const { fixed, fixZ, fixLevel, points } = rasterizeLevels(usable, bbox, nx, ny, cell)
  const { region, lo, hi, levelsOf, count } = labelRegions(fixed, fixLevel, nx, ny)

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
  const isCap = kind

  // Las celdas por las que pasa una curva también se evalúan con el campo, no se
  // clavan a la cota: la curva pasa por algún punto dentro de la celda, no por
  // su centro, así que clavarla dejaba un escalón de medio píxel a lo largo de
  // cada curva. El campo ya vale la cota de la curva allí, con precisión
  // subcelda, porque la distancia a esa curva tiende a cero.
  const evalRegion = new Int32Array(n)
  evalRegion.set(region)
  for (let k = 0; k < n; k++) {
    if (!fixed[k]) continue
    const li = fixLevel[k]
    const i = k % nx
    const j = (k - i) / nx
    let best = -1
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ii = i + di
        const jj = j + dj
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue
        const r = region[jj * nx + ii]
        if (r < 0) continue
        // Se prefiere la ladera que esta curva limita: da la cota correcta y la
        // pendiente correcta a los dos lados.
        if (kind[r] === BAND && lo[r] <= li && li <= hi[r]) {
          best = r
          dj = 2
          break
        }
        if (best < 0) best = r
      }
    }
    evalRegion[k] = best
  }

  // --- Laderas y márgenes.
  for (let k = 0; k < n; k++) {
    const r = evalRegion[k]
    if (r < 0) {
      z[k] = fixed[k] ? fixZ[k] : elevationOf[0]
      continue
    }
    if (kind[r] === CAP) continue
    if (kind[r] === BAND) {
      const zLo = elevationOf[lo[r]]
      const zHi = elevationOf[hi[r]]
      const a = distTo(lo[r], k)
      const b = distTo(hi[r], k)
      const s = a + b
      z[k] = s > 1e-9 && Number.isFinite(s) ? zLo + (zHi - zLo) * (a / s) : zLo
      continue
    }
    let num = 0
    let den = 0
    let snapped = false
    for (const li of levelsOf[r]) {
      const d = distTo(li, k)
      if (!Number.isFinite(d)) continue
      if (d < 1e-6) {
        z[k] = elevationOf[li]
        snapped = true
        break
      }
      const w = 1 / (d * d)
      num += w * elevationOf[li]
      den += w
    }
    if (!snapped) z[k] = den > 0 ? num / den : elevationOf[lo[r]]
  }

  // --- Regiones de cumbre o depresión: bóveda que prolonga la ladera de fuera.
  // Para cada una hacen falta tres cosas: hacia dónde sigue el relieve (arriba
  // o abajo), con qué pendiente llega la ladera vecina, y hasta dónde puede
  // subir antes de que tocara dibujar la curva siguiente.
  const capApex = new Float64Array(count)
  for (let k = 0; k < n; k++) {
    const r = region[k]
    if (r < 0 || !isCap[r]) continue
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
        if (r >= 0 && isCap[r] && lo[r] === li) {
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
        if (r < 0 || r === capId || isCap[r]) continue
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
    if (!isCap[r] || !Number.isFinite(lo[r])) continue
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
    const r = evalRegion[k]
    if (r < 0 || !isCap[r]) continue
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
