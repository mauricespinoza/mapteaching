// Partición del mapa en bloques estructurales separados por las trazas de falla.
// Se rasteriza la traza de cada falla sobre una grilla regular y se etiquetan las
// regiones conexas (flood fill). Cada contacto se resuelve por bloque, de modo que
// el desplazamiento a través de una falla aparece automáticamente en mapa,
// perfil y 3D.
//
// Lo que queda **fuera del área de trabajo también es muro**. La grilla cubre la
// imagen entera, pero el ejercicio sólo llega hasta el marco; sin eso, los dos
// lados de una falla que cruza el área se reencuentran rodeando por el margen
// vacío y el mapa entero sale como un solo bloque — es decir, la falla no corta
// nada. (Es el mismo criterio que ya usan el relieve y el mapa de unidades.)

const BARRIER = -1

export function buildBlocks(faultPolylines, bbox, cell, outside = null) {
  const pad = cell * 2
  const minX = bbox.minX - pad
  const minY = bbox.minY - pad
  const maxX = bbox.maxX + pad
  const maxY = bbox.maxY + pad
  const nx = Math.max(4, Math.ceil((maxX - minX) / cell))
  const ny = Math.max(4, Math.ceil((maxY - minY) / cell))
  const ids = new Int32Array(nx * ny).fill(0)

  const mark = (ix, iy) => {
    if (ix < 0 || iy < 0 || ix >= nx || iy >= ny) return
    ids[iy * nx + ix] = BARRIER
  }

  // Rasterización de las trazas con un pincel de 1 celda de radio: sella
  // pequeños huecos de digitalización sin engordar demasiado la falla.
  for (const pts of faultPolylines) {
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1]
      const [x1, y1] = pts[i]
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (cell * 0.4)))
      for (let s = 0; s <= steps; s++) {
        const t = s / steps
        const x = x0 + (x1 - x0) * t
        const y = y0 + (y1 - y0) * t
        const ix = Math.floor((x - minX) / cell)
        const iy = Math.floor((y - minY) / cell)
        mark(ix, iy)
        mark(ix + 1, iy)
        mark(ix - 1, iy)
        mark(ix, iy + 1)
        mark(ix, iy - 1)
      }
    }
  }

  // El exterior del área de trabajo es muro: cierra el paso alrededor del marco.
  if (outside) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        if (outside(minX + ix * cell, minY + iy * cell)) ids[iy * nx + ix] = BARRIER
      }
    }
  }

  // Flood fill 4-conexo de las celdas libres.
  let next = 1
  const stack = []
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] !== 0) continue
    const id = next++
    ids[i] = id
    stack.push(i)
    while (stack.length) {
      const k = stack.pop()
      const kx = k % nx
      const ky = (k / nx) | 0
      const nb = []
      if (kx > 0) nb.push(k - 1)
      if (kx < nx - 1) nb.push(k + 1)
      if (ky > 0) nb.push(k - nx)
      if (ky < ny - 1) nb.push(k + nx)
      for (const m of nb) {
        if (ids[m] === 0) {
          ids[m] = id
          stack.push(m)
        }
      }
    }
  }

  const blockAt = (x, y) => {
    let ix = Math.floor((x - minX) / cell)
    let iy = Math.floor((y - minY) / cell)
    ix = Math.max(0, Math.min(nx - 1, ix))
    iy = Math.max(0, Math.min(ny - 1, iy))
    const v = ids[iy * nx + ix]
    if (v > 0) return v
    // Sobre la traza —o fuera del área de trabajo— se toma el bloque libre más
    // cercano en anillos crecientes. El radio llega lejos porque el margen que
    // rodea al marco es ahora muro: un punto de ahí sigue teniendo que saber a
    // qué bloque pertenecería.
    const maxR = Math.min(64, Math.max(nx, ny))
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const jx = ix + dx
          const jy = iy + dy
          if (jx < 0 || jy < 0 || jx >= nx || jy >= ny) continue
          const w = ids[jy * nx + jx]
          if (w > 0) return w
        }
      }
    }
    return 0
  }

  /** Bloque dominante de una polilínea (voto de sus vértices). */
  const blockOfPolyline = (pts) => {
    const votes = new Map()
    for (const p of pts) {
      const b = blockAt(p[0], p[1])
      votes.set(b, (votes.get(b) || 0) + 1)
    }
    let best = 0
    let bestN = -1
    for (const [b, n] of votes) {
      if (n > bestN) {
        best = b
        bestN = n
      }
    }
    return best
  }

  return { nx, ny, minX, minY, cell, ids, count: next - 1, blockAt, blockOfPolyline }
}

/** Bloques "todo junto" cuando no hay fallas digitalizadas. */
export function singleBlock() {
  return {
    nx: 1,
    ny: 1,
    minX: 0,
    minY: 0,
    cell: 1,
    ids: new Int32Array([1]),
    count: 1,
    blockAt: () => 1,
    blockOfPolyline: () => 1,
  }
}
