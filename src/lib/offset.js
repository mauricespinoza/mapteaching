// Superficie paralela de verdad: la que queda a un espesor constante de otra
// medido **perpendicular** a ella, no en vertical.
//
// La manera de siempre de construir un contacto heredado era bajar la
// referencia en cada punto un desnivel `e / cos δ`. Es exacto sobre un limbo
// plano y falla en cuanto la superficie se curva, por dos motivos:
//
//  - el δ que se usa no es la pendiente de lo que se dibuja (el modelo de
//    pliegue publica el manteo de los limbos, más tendido que el tramo que los
//    une), así que donde la referencia se empina la unidad de abajo adelgaza;
//  - y aunque fuera la pendiente exacta, desplazar cada punto en vertical no es
//    desplazarlo a lo largo de la normal. Bajo una charnela estrecha las
//    normales se cruzan antes de llegar al espesor, y la cuenta punto a punto
//    dibuja ahí una «cola de golondrina»: el doble valle y los bollos en el
//    fondo de los sinformes.
//
// La definición geométrica no tiene ninguno de los dos problemas. El contacto
// de abajo es el lugar de los puntos que están **a distancia e** de la
// referencia, y eso es la envolvente inferior de las esferas de radio `e`
// centradas en ella: la *erosión* morfológica de la superficie por una bola,
//
//     g(x) = min_{|u − x| ≤ e} f(u) − √(e² − |u − x|²)
//
// Tiene exactamente el espesor verdadero `e` en todas partes, nunca es más
// empinada que la referencia —la erosión no amplifica pendientes—, y bajo un
// sinforme se abre en un arco más ancho en vez de cruzarse consigo misma. Bajo
// un antiforme estrecho la erosión deja una arista (el arco interior se cierra
// en un punto); una apertura con una bola más pequeña la redondea, y en esa
// charnela la capa queda algo más gruesa, que es lo que hacen los pliegues de
// verdad cuando el espacio del núcleo se acaba.
//
// Se calcula sobre una malla que cubre el área de trabajo, una sola vez por
// superficie, y se lee con interpolación bicúbica, que da cota y gradiente
// continuos.

// Nodos de la malla por lado del área. La erosión no necesita más: la
// superficie que sale es tan suave como la referencia o más.
const GRID_NODES = 120
// Radio máximo del disco de búsqueda, en celdas. Si el espesor es mayor, se
// engruesa la celda: el error de discretizar la erosión decrece con el radio.
const MAX_DISK = 18

/** Malla regular de cotas, con su origen y su paso. */
function makeGrid(x0, y0, h, nx, ny) {
  return { x0, y0, h, nx, ny, z: new Float64Array(nx * ny) }
}

/**
 * Discos de búsqueda: los desplazamientos de nodo dentro de un radio, ordenados
 * por distancia para poder cortar el recorrido en cuanto se pasa del espesor.
 */
function diskOffsets(R) {
  const list = []
  for (let dj = -R; dj <= R; dj++) {
    for (let di = -R; di <= R; di++) {
      const r2 = di * di + dj * dj
      if (r2 <= R * R) list.push([di, dj, r2])
    }
  }
  list.sort((a, b) => a[2] - b[2])
  // En arreglos planos: la erosión recorre el disco una vez por nodo y es,
  // con diferencia, lo que más cuesta de toda la herencia.
  const n = list.length
  const di = new Int32Array(n)
  const dj = new Int32Array(n)
  const d2 = new Float64Array(n)
  list.forEach((o, k) => {
    di[k] = o[0]
    dj[k] = o[1]
    d2[k] = o[2]
  })
  return { n, di, dj, d2 }
}

/**
 * Erosión (o dilatación) de la malla `F` por bolas de radio variable. `rad[k]`
 * es el radio en el nodo `k`, en metros; con signo positivo la superficie
 * queda **debajo** (erosión) y con signo negativo, **encima** (dilatación).
 * `F` tiene un margen de `pad` nodos alrededor de la malla de salida para que
 * las bolas del borde encuentren superficie bajo ellas.
 */
function ballMorph(F, out, pad, rad, disk) {
  const h = F.h
  const h2 = h * h
  const { n, di, dj, d2 } = disk
  const Fz = F.z
  const W = F.nx
  for (let j = 0; j < out.ny; j++) {
    for (let i = 0; i < out.nx; i++) {
      const k = j * out.nx + i
      const e = rad[k]
      const below = e >= 0
      const r2 = (e * e) / h2
      const I = i + pad
      const J = j + pad
      let best = below ? Infinity : -Infinity
      for (let m = 0; m < n; m++) {
        const q = d2[m]
        if (q > r2) break
        const u = I + di[m]
        const v = J + dj[m]
        if (u < 0 || v < 0 || u >= W || v >= F.ny) continue
        const lift = Math.sqrt(r2 - q) * h
        const f = Fz[v * W + u]
        if (below) {
          if (f - lift < best) best = f - lift
        } else if (f + lift > best) best = f + lift
      }
      out.z[k] = Number.isFinite(best) ? best : Fz[J * W + I] - e
    }
  }
}

/**
 * Suavizado binomial [1 2 1]² que no toca los planos: un kernel simétrico deja
 * intacta cualquier función lineal, así que sólo quita el ruido de discretizar
 * la erosión, no el manteo.
 */
function binomial(G) {
  const { nx, ny } = G
  const tmp = new Float64Array(nx * ny)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      if (i === 0 || i === nx - 1) tmp[k] = G.z[k]
      else tmp[k] = (G.z[k - 1] + 2 * G.z[k] + G.z[k + 1]) / 4
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      if (j === 0 || j === ny - 1) G.z[k] = tmp[k]
      else G.z[k] = (tmp[k - nx] + 2 * tmp[k] + tmp[k + nx]) / 4
    }
  }
}

/** Catmull–Rom en 1D: valor y derivada respecto de `t` ∈ [0, 1]. */
function cubic(p0, p1, p2, p3, t) {
  const a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3
  const b = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3
  const c = -0.5 * p0 + 0.5 * p2
  return [((a * t + b) * t + c) * t + p1, (3 * a * t + 2 * b) * t + c]
}

/**
 * Lectura bicúbica de la malla: cota y gradiente, ambos continuos. Devuelve
 * `null` fuera de ella.
 */
function sampleGrid(G, x, y) {
  const fx = (x - G.x0) / G.h
  const fy = (y - G.y0) / G.h
  if (!(fx >= 0 && fy >= 0 && fx <= G.nx - 1 && fy <= G.ny - 1)) return null
  const i = Math.min(G.nx - 2, Math.floor(fx))
  const j = Math.min(G.ny - 2, Math.floor(fy))
  const tx = fx - i
  const ty = fy - j
  const at = (u, v) => {
    const cu = u < 0 ? 0 : u >= G.nx ? G.nx - 1 : u
    const cv = v < 0 ? 0 : v >= G.ny ? G.ny - 1 : v
    // Fuera de la malla se prolonga linealmente, para que el borde no aplane
    // la pendiente.
    const z = G.z[cv * G.nx + cu]
    let out = z
    if (u !== cu) out += Math.abs(u - cu) * (z - G.z[cv * G.nx + (u < 0 ? 1 : G.nx - 2)])
    if (v !== cv) out += Math.abs(v - cv) * (z - G.z[(v < 0 ? 1 : G.ny - 2) * G.nx + cu])
    return out
  }
  const rows = []
  const drows = []
  for (let m = -1; m <= 2; m++) {
    const [z, dz] = cubic(at(i - 1, j + m), at(i, j + m), at(i + 1, j + m), at(i + 2, j + m), tx)
    rows.push(z)
    drows.push(dz)
  }
  const [z, dzy] = cubic(rows[0], rows[1], rows[2], rows[3], ty)
  const [dzx] = cubic(drows[0], drows[1], drows[2], drows[3], ty)
  return { z, a: dzx / G.h, b: dzy / G.h }
}

/**
 * Distancia perpendicular con signo de un punto a la superficie muestreada en
 * `F`: positiva si el punto queda por debajo. Es el espesor verdadero que ese
 * dato mide respecto de la referencia.
 */
function signedDistance(F, x, y, z) {
  const s = sampleGrid(F, x, y)
  if (!s) return null
  const vert = s.z - z
  const R = Math.abs(vert)
  if (R < 1e-9) return 0
  const h = F.h
  const cx = (x - F.x0) / h
  const cy = (y - F.y0) / h
  const n = Math.ceil(R / h)
  let best = R
  for (let v = Math.floor(cy) - n; v <= Math.ceil(cy) + n; v++) {
    if (v < 0 || v >= F.ny) continue
    for (let u = Math.floor(cx) - n; u <= Math.ceil(cx) + n; u++) {
      if (u < 0 || u >= F.nx) continue
      const dx = (u - cx) * h
      const dy = (v - cy) * h
      const dz = F.z[v * F.nx + u] - z
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (d < best) best = d
    }
  }
  return vert >= 0 ? best : -best
}

/**
 * Espesor en cada punto del mapa: el ajustado para todo el contacto, más lo que
 * sus propios datos piden cerca de ellos.
 *
 * Es una regresión de núcleo gaussiano con una observación ficticia de peso
 * `prior` que vale el espesor medio: lejos de los datos el espesor vuelve a ser
 * el ajustado y, entre ellos, cambia con la suavidad que marca `width`. Una
 * capa no cambia de espesor de un contorno al siguiente, así que la anchura es
 * de varios contornos; lo que el mapa sí dice —en los sinformes de un pliegue
 * similar la distancia perpendicular crece— se recoge sin arrugar la superficie.
 */
export function thicknessField(obs, e0, width, prior = 1) {
  const pts = obs.filter((o) => Number.isFinite(o.d))
  if (!pts.length || !(width > 0)) return () => e0
  const w2 = width * width
  return (x, y) => {
    let sw = prior
    let s = prior * e0
    for (const o of pts) {
      const dx = o.x - x
      const dy = o.y - y
      const q = (dx * dx + dy * dy) / w2
      if (q > 20) continue
      const w = Math.exp(-q)
      sw += w
      s += w * o.d
    }
    return s / sw
  }
}

/**
 * La referencia muestreada sobre la malla del área `extent`, con el margen que
 * necesitan las bolas de radio `maxThickness` en el borde. Devuelve `null` si la
 * referencia no está definida en toda la malla.
 */
export function referenceGrid(reference, extent, maxThickness) {
  const w = extent.maxX - extent.minX
  const hgt = extent.maxY - extent.minY
  const side = Math.max(w, hgt, 1e-6)
  const reach = Math.abs(maxThickness)
  const h = Math.max(side / GRID_NODES, reach / MAX_DISK, 1e-6)
  const pad = Math.ceil(reach / h) + 2
  const nx = Math.ceil(w / h) + 1
  const ny = Math.ceil(hgt / h) + 1
  const F = makeGrid(extent.minX - pad * h, extent.minY - pad * h, h, nx + 2 * pad, ny + 2 * pad)
  let bad = false
  for (let j = 0; j < F.ny; j++) {
    for (let i = 0; i < F.nx; i++) {
      const s = reference.sampleAt(F.x0 + i * h, F.y0 + j * h)
      const z = s && Number.isFinite(s.z) ? s.z : NaN
      if (!Number.isFinite(z)) bad = true
      F.z[j * F.nx + i] = z
    }
  }
  if (bad) return null
  return { F, pad, nx, ny, h }
}

/**
 * La superficie desplazada, como malla. Primero se erosiona con el espesor más
 * el radio de redondeo y luego se dilata con ese radio (una apertura): las
 * aristas que deja la erosión bajo las charnelas estrechas se redondean con
 * radio `round`, y en todo lo demás la superficie queda exactamente al espesor
 * pedido.
 */
export function offsetGrid(ref, thickness, round) {
  const { F, pad, nx, ny, h } = ref
  const out = makeGrid(F.x0 + pad * h, F.y0 + pad * h, h, nx, ny)
  // La apertura necesita un margen propio: la dilatación mira alrededor de cada
  // nodo, así que la erosión se calcula en un marco más ancho.
  const rp = Math.min(pad, Math.ceil(round / h) + 1)
  const mid = makeGrid(out.x0 - rp * h, out.y0 - rp * h, h, nx + 2 * rp, ny + 2 * rp)
  const rad = new Float64Array(mid.nx * mid.ny)
  let maxR = 0
  for (let j = 0; j < mid.ny; j++) {
    for (let i = 0; i < mid.nx; i++) {
      const e = thickness(mid.x0 + i * h, mid.y0 + j * h)
      const r = e >= 0 ? e + round : e - round
      rad[j * mid.nx + i] = r
      if (Math.abs(r) > maxR) maxR = Math.abs(r)
    }
  }
  const disk = diskOffsets(Math.ceil(maxR / h) + 1)
  ballMorph(F, mid, pad - rp, rad, disk)
  if (round > 0) {
    // Dilatación (o erosión, si la superficie va por encima) con el radio de
    // redondeo: el paso inverso de la apertura.
    const back = new Float64Array(out.nx * out.ny)
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const e = thickness(out.x0 + i * h, out.y0 + j * h)
        back[j * nx + i] = e >= 0 ? -round : round
      }
    }
    ballMorph(mid, out, rp, back, diskOffsets(Math.ceil(round / h) + 1))
  } else {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) out.z[j * nx + i] = mid.z[(j + rp) * mid.nx + i + rp]
    }
  }
  binomial(out)
  binomial(out)
  return out
}

export { sampleGrid, signedDistance }
