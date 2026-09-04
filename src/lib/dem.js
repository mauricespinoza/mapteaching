// Modelo de elevación digital a partir de las curvas de nivel.
//
// Sólo entran aquí las curvas de nivel topográficas. Los contactos y las fallas
// son trazas geológicas, no isohipsas: no dicen nada de la cota del terreno y
// nunca se pasan a esta función (véase `scene.js`).
//
// El problema es el de siempre: se conoce la cota sobre unas cuantas líneas y
// hay que rellenar todo lo demás. Lo que se busca no es "un" relleno sino el
// más suave de todos: la superficie que pasa por las curvas y que dobla lo
// menos posible en el camino, que es exactamente lo que hace la mano al
// dibujar el sombreado entre dos curvas. Eso se escribe como minimizar
//
//     E(z) = Σ_curvas (z(p) − cota(p))²  +  λ ∫ (∇²z)²
//
// —el ajuste a las curvas contra la curvatura total—, y su mínimo es la lámina
// delgada (spline de placa fina, la misma idea que ANUDEM o `surface` de GMT).
// Esa superficie es continua *en pendiente* al cruzar una curva de nivel, así
// que no deja el escalón que delataba a los métodos anteriores; entre dos
// curvas la ladera pasa de una a otra de forma monótona y sin rellanos; y sobre
// la última curva cerrada de una cumbre levanta ella sola la bóveda, porque
// prolongar la pendiente que llega cuesta menos curvatura que aplanarse.
//
// Lo que se hacía antes —etiquetar las regiones que las curvas encierran y
// repartir la cota según la distancia a la de abajo y a la de arriba— dependía
// de que las curvas cerraran el paso de verdad. En un mapa dibujado a mano eso
// se cumple; en uno digitalizado automáticamente no: las etiquetas de cota
// parten las curvas en trozos, y por cada hueco dos laderas de cotas muy
// distintas se reencuentran y pasan a ser la misma región. Con unos pocos
// huecos el mapa entero es una sola región, sin par de curvas que mande en
// ningún sitio, y la cota se calculaba promediando parejas de curvas por
// distancia: un rellano pegado a cada curva, un escalón entre ellas y una
// cubeta en medio de cada banda. Aquí no hay regiones que cerrar. Cada trozo de
// curva, largo o corto, aporta lo suyo y nada más; que esté partida no cambia
// el resultado.
//
// El mínimo de E es un sistema lineal enorme (una incógnita por nodo) y se
// resuelve en malla escalonada: primero en una grilla gruesa —donde el relieve
// de escala grande se acomoda en pocas pasadas—, y el resultado se interpola
// como punto de partida de la grilla siguiente, el doble de fina, donde ya sólo
// queda afinar el detalle. Así el coste es proporcional al número de nodos, no
// a su cuadrado: es lo que hace que sea utilizable a 300 o 500 celdas de lado.

/** Lado de la grilla más gruesa de la cascada. */
const COARSEST = 12
/** Peso del ajuste a las curvas frente a la curvatura, en la grilla más fina. */
const DATA_WEIGHT = 40
/**
 * Al engrosar la grilla el término de curvatura pesa menos (va con h⁻³ frente
 * al del ajuste), así que las curvas mandan más: es lo que se quiere, porque en
 * una grilla gruesa no hay detalle que preservar y sí una forma general que
 * cuadrar con los datos.
 */
const WEIGHT_PER_LEVEL = 4
/**
 * Tensión: una pizca de membrana mezclada con la placa. Frena las oscilaciones
 * que la curvatura mínima pura puede sacarse de la manga donde las curvas se
 * aprietan, y de paso fija las esquinas de la grilla, que la placa sola deja
 * indeterminadas. Muy pequeña dentro —a esta escala no se nota en la ladera— y
 * bastante mayor fuera del área de trabajo, donde no hay curvas: allí el
 * relieve se prolonga y se va aplanando en vez de dispararse.
 */
const TENSION_IN = 0.004
const TENSION_OUT = 0.25
/**
 * A partir de cuántas "distancias típicas a una curva" empieza a entrar la
 * tensión, y dónde llega al máximo. Dentro de una banda normal no llega a
 * asomar; en un hueco grande sin curvas —el margen del mapa, o el interior de
 * una curva cerrada muy ancha— manda ella y el relieve se prolonga aplanándose
 * en vez de dispararse.
 */
const TENSION_FROM = 3
const TENSION_FULL = 7
/**
 * Sobrerrelajación de Gauss-Seidel y pasadas por grilla. Las pasadas se doblan
 * en cada grilla más gruesa: allí cuestan cuatro veces menos y son las que
 * cuadran la forma general, así que a la grilla fina llega poco que corregir y
 * le basta con pulir el detalle. Todo el trabajo junto sale proporcional al
 * número de nodos de la grilla fina.
 */
const OMEGA = 1.25
const SWEEPS = 20
const SWEEPS_MAX = 320

/**
 * Puntos de las curvas, remuestreados a medio paso de celda: son los datos a
 * los que se ajusta la superficie. Cada uno se reparte por interpolación
 * bilineal entre los cuatro nodos que lo rodean, así que su posición cuenta con
 * precisión de subcelda y la curva no queda "pegada" al nodo más próximo (ese
 * error de medio nodo, repetido a lo largo de cada curva, era otra fuente de
 * escalones).
 */
function buildSamples(usable, cell) {
  const xs = []
  const ys = []
  const es = []
  const step = cell * 0.5
  const push = (x, y, e) => {
    xs.push(x)
    ys.push(y)
    es.push(e)
  }
  for (const { elevation, lines } of usable) {
    for (const pts of lines) {
      if (!pts?.length) continue
      push(pts[0][0], pts[0][1], elevation)
      for (let m = 1; m < pts.length; m++) {
        const a = pts[m - 1]
        const b = pts[m]
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
        for (let s = 1; s <= steps; s++) {
          const t = s / steps
          push(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, elevation)
        }
      }
    }
  }
  return { x: Float64Array.from(xs), y: Float64Array.from(ys), e: Float64Array.from(es), n: es.length }
}

/**
 * Distancia de cada nodo a la curva más próxima, en celdas (chamfer de dos
 * pasadas: aproximada, pero sólo se usa para graduar la tensión). Los nodos por
 * los que pasa una curva quedan a cero.
 */
function distanceToData(nx, ny, seeds) {
  const n = nx * ny
  const d = new Float64Array(n).fill(1e9)
  for (const k of seeds) d[k] = 0
  const D1 = 1
  const D2 = Math.SQRT2
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      let v = d[k]
      if (i > 0) v = Math.min(v, d[k - 1] + D1)
      if (j > 0) v = Math.min(v, d[k - nx] + D1)
      if (i > 0 && j > 0) v = Math.min(v, d[k - nx - 1] + D2)
      if (i < nx - 1 && j > 0) v = Math.min(v, d[k - nx + 1] + D2)
      d[k] = v
    }
  }
  for (let j = ny - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i
      let v = d[k]
      if (i < nx - 1) v = Math.min(v, d[k + 1] + D1)
      if (j < ny - 1) v = Math.min(v, d[k + nx] + D1)
      if (i < nx - 1 && j < ny - 1) v = Math.min(v, d[k + nx + 1] + D2)
      if (i > 0 && j < ny - 1) v = Math.min(v, d[k + nx - 1] + D2)
      d[k] = v
    }
  }
  return d
}

/** Una grilla de la cascada, con la geometría y los datos ya enganchados. */
function makeLevel(bbox, nx, ny, cell, samples, mu, inFrame) {
  const n = nx * ny
  const z = new Float64Array(n)
  const dw = new Float64Array(n)
  const diag = new Float64Array(n)
  const tau = new Float64Array(n)

  // Enganche de cada muestra a su celda: el nodo inferior izquierdo y la
  // posición dentro de la celda, de donde salen los cuatro pesos bilineales.
  const P = samples.n
  const base = new Int32Array(P)
  const tx = new Float32Array(P)
  const ty = new Float32Array(P)
  const count = new Int32Array(n + 1)
  for (let p = 0; p < P; p++) {
    const fx = (samples.x[p] - bbox.minX) / cell
    const fy = (samples.y[p] - bbox.minY) / cell
    let i = Math.floor(fx)
    let j = Math.floor(fy)
    i = Math.max(0, Math.min(nx - 2, i))
    j = Math.max(0, Math.min(ny - 2, j))
    const a = Math.max(0, Math.min(1, fx - i))
    const b = Math.max(0, Math.min(1, fy - j))
    const k = j * nx + i
    base[p] = k
    tx[p] = a
    ty[p] = b
    const w00 = (1 - a) * (1 - b)
    const w10 = a * (1 - b)
    const w01 = (1 - a) * b
    const w11 = a * b
    dw[k] += w00 * w00
    dw[k + 1] += w10 * w10
    dw[k + nx] += w01 * w01
    dw[k + nx + 1] += w11 * w11
    count[k]++
    count[k + 1]++
    count[k + nx]++
    count[k + nx + 1]++
  }

  // Índice inverso nodo → muestras que lo tocan. Sin él habría que recorrer
  // todas las muestras en cada pasada, y sobre todo el ajuste no podría
  // resolverse nodo a nodo: las cuatro esquinas de una celda comparten muestra,
  // y dejar esa parte "para la pasada siguiente" hace que el método se
  // desmadre cuando las curvas pesan mucho.
  const off = new Int32Array(n + 1)
  let acc = 0
  for (let k = 0; k < n; k++) {
    off[k] = acc
    acc += count[k]
  }
  off[n] = acc
  const cursor = off.slice(0, n)
  const sidx = new Int32Array(acc)
  const swgt = new Float32Array(acc)
  const attach = (k, p, w) => {
    const m = cursor[k]++
    sidx[m] = p
    swgt[m] = w
  }
  for (let p = 0; p < P; p++) {
    const k = base[p]
    const a = tx[p]
    const b = ty[p]
    attach(k, p, (1 - a) * (1 - b))
    attach(k + 1, p, a * (1 - b))
    attach(k + nx, p, (1 - a) * b)
    attach(k + nx + 1, p, a * b)
  }

  // Tensión, graduada por lo lejos que queda la curva más próxima. La escala de
  // referencia es la distancia típica de un nodo a su curva, que es medio ancho
  // de banda: así el criterio no depende de la resolución ni de la equidistancia
  // del mapa, sino de lo apretadas que vayan las curvas en este mapa concreto.
  // Fuera del área de trabajo no hay curvas que digitalizar, así que allí la
  // tensión entra entera desde el primer nodo.
  const seeds = new Int32Array(P)
  for (let p = 0; p < P; p++) seeds[p] = base[p] + (tx[p] < 0.5 ? 0 : 1) + (ty[p] < 0.5 ? 0 : nx)
  const dist = distanceToData(nx, ny, seeds)
  const inside = new Uint8Array(n)
  const scale = new Float64Array(n)
  let m = 0
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      if (!inFrame || inFrame(bbox.minX + i * cell, bbox.minY + j * cell)) {
        inside[k] = 1
        scale[m++] = dist[k]
      }
    }
  }
  const typical = Math.max(1, m ? scale.subarray(0, m).sort()[m >> 1] : 1)
  for (let k = 0; k < n; k++) {
    if (!inside[k]) {
      tau[k] = TENSION_OUT
      continue
    }
    const u = (dist[k] / typical - TENSION_FROM) / (TENSION_FULL - TENSION_FROM)
    const t = u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u)
    tau[k] = TENSION_IN + (TENSION_OUT - TENSION_IN) * t
  }

  // Diagonal del sistema. La curvatura aporta 16 si el nodo tiene laplaciano
  // propio —los del borde no lo tienen— más uno por cada vecino que lo tenga;
  // la tensión, la suma de sus cuatro aristas; el ajuste, μ·Σw².
  const inner = (i, j) => i > 0 && i < nx - 1 && j > 0 && j < ny - 1
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      let d = inner(i, j) ? 16 : 0
      if (inner(i - 1, j)) d += 1
      if (inner(i + 1, j)) d += 1
      if (inner(i, j - 1)) d += 1
      if (inner(i, j + 1)) d += 1
      let t = 0
      if (i > 0) t += (tau[k] + tau[k - 1]) * 0.5
      if (i < nx - 1) t += (tau[k] + tau[k + 1]) * 0.5
      if (j > 0) t += (tau[k] + tau[k - nx]) * 0.5
      if (j < ny - 1) t += (tau[k] + tau[k + nx]) * 0.5
      diag[k] = d + t + mu * dw[k] + 1e-9
    }
  }
  return { nx, ny, cell, z, diag, tau, base, tx, ty, off, sidx, swgt, mu, e: samples.e }
}

/**
 * Gauss-Seidel rojo-negro sobre el sistema completo —curvatura, tensión y
 * ajuste a las curvas—, unas cuantas pasadas. El sistema es simétrico definido
 * positivo (es la derivada de una suma de cuadrados), así que la sobre-
 * relajación converge y cada pasada baja la energía.
 */
function relax(L, sweeps) {
  const { nx, ny, z, diag, tau, base, tx, ty, off, sidx, swgt, mu, e } = L
  const nx1 = nx - 1
  const ny1 = ny - 1

  /** Laplaciano en el nodo; cero donde no está definido (el borde). */
  const lap = (i, j, k) =>
    i > 0 && i < nx1 && j > 0 && j < ny1 ? z[k - 1] + z[k + 1] + z[k - nx] + z[k + nx] - 4 * z[k] : 0

  /** Residuo del ajuste a las curvas que pasan por las celdas de este nodo. */
  const fit = (k) => {
    const m1 = off[k + 1]
    let g = 0
    for (let m = off[k]; m < m1; m++) {
      const p = sidx[m]
      const kb = base[p]
      const a = tx[p]
      const b = ty[p]
      g +=
        swgt[m] *
        (e[p] -
          ((1 - a) * (1 - b) * z[kb] +
            a * (1 - b) * z[kb + 1] +
            (1 - a) * b * z[kb + nx] +
            a * b * z[kb + nx + 1]))
    }
    return g
  }

  const wide = nx > 4 && ny > 4
  for (let s = 0; s < sweeps; s++) {
    for (let color = 0; color < 2; color++) {
      for (let j = 0; j < ny; j++) {
        const row = j * nx
        const fast = wide && j >= 2 && j <= ny - 3
        const i0 = (j + color) & 1
        for (let i = i0; i < nx; i += 2) {
          const k = row + i
          const zk = z[k]
          let r
          if (fast && i >= 2 && i <= nx - 3) {
            // Estrella de 13 puntos: el laplaciano aplicado dos veces, ya
            // desarrollado. Es el camino que recorre casi toda la grilla.
            r = -(
              20 * zk -
              8 * (z[k - 1] + z[k + 1] + z[k - nx] + z[k + nx]) +
              2 * (z[k - nx - 1] + z[k - nx + 1] + z[k + nx - 1] + z[k + nx + 1]) +
              (z[k - 2] + z[k + 2] + z[k - 2 * nx] + z[k + 2 * nx])
            )
          } else {
            // Junto al borde el laplaciano no está definido en todos los
            // vecinos: la estrella se arma nodo a nodo. Los que faltan valen
            // cero, que es la condición de borde libre —la lámina sale del mapa
            // con la curvatura que traiga, sin aplanarse ni doblarse.
            r = 4 * lap(i, j, k)
            if (i > 0) r -= lap(i - 1, j, k - 1)
            if (i < nx1) r -= lap(i + 1, j, k + 1)
            if (j > 0) r -= lap(i, j - 1, k - nx)
            if (j < ny1) r -= lap(i, j + 1, k + nx)
          }
          const tk = tau[k]
          if (i > 0) r -= (tk + tau[k - 1]) * 0.5 * (zk - z[k - 1])
          if (i < nx1) r -= (tk + tau[k + 1]) * 0.5 * (zk - z[k + 1])
          if (j > 0) r -= (tk + tau[k - nx]) * 0.5 * (zk - z[k - nx])
          if (j < ny1) r -= (tk + tau[k + nx]) * 0.5 * (zk - z[k + nx])
          if (off[k] !== off[k + 1]) r += mu * fit(k)
          z[k] = zk + (OMEGA * r) / diag[k]
        }
      }
    }
  }
}

/** Interpola la solución de la grilla gruesa en la fina (bilineal). */
function prolong(coarse, fine) {
  const { nx: cnx, ny: cny, cell: ccell, z: cz } = coarse
  const { nx, ny, cell, z } = fine
  for (let j = 0; j < ny; j++) {
    const fy = (j * cell) / ccell
    let cj = Math.floor(fy)
    cj = Math.max(0, Math.min(cny - 2, cj))
    const ty = Math.max(0, Math.min(1, fy - cj))
    for (let i = 0; i < nx; i++) {
      const fx = (i * cell) / ccell
      let ci = Math.floor(fx)
      ci = Math.max(0, Math.min(cnx - 2, ci))
      const tx = Math.max(0, Math.min(1, fx - ci))
      const k = cj * cnx + ci
      z[j * nx + i] =
        cz[k] * (1 - tx) * (1 - ty) +
        cz[k + 1] * tx * (1 - ty) +
        cz[k + cnx] * (1 - tx) * ty +
        cz[k + cnx + 1] * tx * ty
    }
  }
}

/**
 * Techo y suelo del mapa. Por encima de la curva más alta el terreno sigue
 * subiendo, pero no puede pasar de una equidistancia: si pasara, habría otra
 * curva dibujada. Lo mismo por abajo. El corte es suave —se acerca al límite
 * sin llegar a tocarlo— para no reintroducir una meseta con arista justo en las
 * cumbres, que es lo que se quería evitar.
 */
function softClamp(z, zLow, zHigh, margin) {
  if (!(margin > 0)) return
  const half = margin * 0.5
  for (let k = 0; k < z.length; k++) {
    const v = z[k]
    if (v > zHigh + half) z[k] = zHigh + half + half * (1 - Math.exp(-(v - zHigh - half) / half))
    else if (v < zLow - half) z[k] = zLow - half - half * (1 - Math.exp(-(zLow - half - v) / half))
  }
}

/**
 * Suavizado con un núcleo 3×3, unas pocas pasadas. La superficie ya sale suave
 * del solver; esto sólo limpia el rizado de nodo a nodo que puede dejar una
 * curva digitalizada con el pulso tembloroso.
 */
function smooth(z, nx, ny, passes) {
  if (passes <= 0) return z
  let src = z
  let dst = new Float64Array(z.length)
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
 *                La grilla cubre toda la imagen; fuera del área no hay curvas
 *                que digitalizar, así que allí el relieve sólo se prolonga.
 */
export function buildDem(levels, bbox, res = 200, smoothPasses = 3, inFrame = null) {
  const width = bbox.maxX - bbox.minX
  const height = bbox.maxY - bbox.minY
  const side = Math.max(width, height)
  const cell = side / res
  const nx = Math.max(2, Math.ceil(width / cell) + 1)
  const ny = Math.max(2, Math.ceil(height / cell) + 1)
  const n = nx * ny

  const usable = levels
    .filter((l) => Number.isFinite(l.elevation) && l.lines?.some((pts) => pts?.length))
    .sort((a, b) => a.elevation - b.elevation)

  if (usable.length === 0) return makeDem(bbox, nx, ny, cell, new Float32Array(n), 0, 0, false)
  if (usable.length === 1) {
    const flat = new Float32Array(n).fill(usable[0].elevation)
    return makeDem(bbox, nx, ny, cell, flat, usable[0].elevation, usable[0].elevation, true)
  }

  const samples = buildSamples(usable, cell)
  if (!samples.n) return makeDem(bbox, nx, ny, cell, new Float32Array(n), 0, 0, false)

  // Cascada de grillas, de la más gruesa a la pedida. Todas comparten el origen
  // y la extensión; sólo cambia el paso.
  const steps = []
  for (let d = 1; ; d *= 2) {
    const c = cell * d
    const gx = Math.max(2, Math.ceil(width / c) + 1)
    const gy = Math.max(2, Math.ceil(height / c) + 1)
    steps.push({ cell: c, nx: d === 1 ? nx : gx, ny: d === 1 ? ny : gy })
    if (Math.max(gx, gy) <= COARSEST) break
    if (d > 1 << 12) break
  }
  steps.reverse()

  let prev = null
  let level = null
  for (let s = 0; s < steps.length; s++) {
    const g = steps[s]
    // El peso de las curvas crece con el paso de la grilla: en la gruesa mandan
    // ellas, en la fina manda la suavidad.
    const mu = DATA_WEIGHT * Math.pow(WEIGHT_PER_LEVEL, steps.length - 1 - s)
    level = makeLevel(bbox, g.nx, g.ny, g.cell, samples, mu, inFrame)
    if (prev) prolong(prev, level)
    else {
      let mean = 0
      for (let p = 0; p < samples.n; p++) mean += samples.e[p]
      level.z.fill(mean / samples.n)
    }
    relax(level, Math.min(SWEEPS_MAX, SWEEPS * Math.pow(2, steps.length - 1 - s)))
    prev = level
  }

  const z = level.z
  const elevations = usable.map((l) => l.elevation)
  softClamp(z, elevations[0], elevations[elevations.length - 1], medianInterval(elevations))

  const smoothed = smooth(z, nx, ny, Math.max(0, smoothPasses))
  const out = new Float32Array(n)
  let zmin = Infinity
  let zmax = -Infinity
  for (let k = 0; k < n; k++) {
    const v = smoothed[k]
    out[k] = v
    if (v < zmin) zmin = v
    if (v > zmax) zmax = v
  }
  return makeDem(bbox, nx, ny, cell, out, zmin, zmax, true)
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
