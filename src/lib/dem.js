// Modelo de elevación digital construido a partir de las curvas de nivel.
// Para cada nodo de la grilla se buscan las dos cotas más cercanas y se
// interpola linealmente entre ellas: es la reconstrucción manual clásica
// («entre la curva de 300 y la de 400») y evita el aspecto aterrazado.

const EPS = 1e-6

/**
 * Campo de distancia euclidiana (transformada vectorial de Danielsson, 2 pasadas).
 * Es O(nx·ny) por nivel: con la búsqueda por anillos el cálculo del MED era el
 * cuello de botella de toda la app.
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
 * @param levels [{ elevation, samples: [[x,y], ...] }] en coordenadas mundo
 * @param bbox   { minX, minY, maxX, maxY }
 * @param res    número de celdas en el lado mayor
 */
export function buildDem(levels, bbox, res = 120) {
  const width = bbox.maxX - bbox.minX
  const height = bbox.maxY - bbox.minY
  const side = Math.max(width, height)
  const cell = side / res
  const nx = Math.max(2, Math.ceil(width / cell) + 1)
  const ny = Math.max(2, Math.ceil(height / cell) + 1)
  const z = new Float32Array(nx * ny)

  const usable = levels.filter((l) => l.samples.length > 0)
  usable.sort((a, b) => a.elevation - b.elevation)

  if (usable.length === 0) {
    return makeDem(bbox, nx, ny, cell, z, 0, 0, false)
  }
  if (usable.length === 1) {
    z.fill(usable[0].elevation)
    return makeDem(bbox, nx, ny, cell, z, usable[0].elevation, usable[0].elevation, true)
  }

  const fields = usable.map((l) => distanceField(l.samples, bbox, nx, ny, cell))

  let zmin = Infinity
  let zmax = -Infinity
  for (let k = 0; k < nx * ny; k++) {
    // Dos cotas más cercanas al nodo.
    let k1 = -1
    let k2 = -1
    for (let m = 0; m < fields.length; m++) {
      const d = fields[m][k]
      if (k1 < 0 || d < fields[k1][k]) {
        k2 = k1
        k1 = m
      } else if (k2 < 0 || d < fields[k2][k]) {
        k2 = m
      }
    }
    const d1 = fields[k1][k]
    const d2v = k2 >= 0 ? fields[k2][k] : Infinity
    let value
    if (d1 < EPS || !Number.isFinite(d2v) || k2 === k1) value = usable[k1].elevation
    else {
      const z1 = usable[k1].elevation
      const z2 = usable[k2].elevation
      value = z1 + (z2 - z1) * (d1 / (d1 + d2v))
    }
    z[k] = value
    if (value < zmin) zmin = value
    if (value > zmax) zmax = value
  }
  return makeDem(bbox, nx, ny, cell, z, zmin, zmax, true)
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
