// Extracción de isolíneas (marching squares) sobre una función escalar.
// Se usa para generar ejercicios sintéticos y para dibujar isolíneas derivadas.

function key(p) {
  return `${p[0].toFixed(3)},${p[1].toFixed(3)}`
}

export function contourLines(f, bbox, nx, ny, level) {
  const dx = (bbox.maxX - bbox.minX) / nx
  const dy = (bbox.maxY - bbox.minY) / ny
  const val = new Float64Array((nx + 1) * (ny + 1))
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      val[j * (nx + 1) + i] = f(bbox.minX + i * dx, bbox.minY + j * dy) - level
    }
  }
  const segs = []
  const interp = (ax, ay, av, bx, by, bv) => {
    const t = av / (av - bv)
    return [ax + (bx - ax) * t, ay + (by - ay) * t]
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x0 = bbox.minX + i * dx
      const y0 = bbox.minY + j * dy
      const x1 = x0 + dx
      const y1 = y0 + dy
      const v00 = val[j * (nx + 1) + i]
      const v10 = val[j * (nx + 1) + i + 1]
      const v01 = val[(j + 1) * (nx + 1) + i]
      const v11 = val[(j + 1) * (nx + 1) + i + 1]
      const idx = (v00 > 0 ? 1 : 0) | (v10 > 0 ? 2 : 0) | (v11 > 0 ? 4 : 0) | (v01 > 0 ? 8 : 0)
      if (idx === 0 || idx === 15) continue
      const bottom = () => interp(x0, y0, v00, x1, y0, v10)
      const right = () => interp(x1, y0, v10, x1, y1, v11)
      const top = () => interp(x1, y1, v11, x0, y1, v01)
      const left = () => interp(x0, y1, v01, x0, y0, v00)
      const push = (a, b) => {
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-9) segs.push([a, b])
      }
      switch (idx) {
        case 1: case 14: push(left(), bottom()); break
        case 2: case 13: push(bottom(), right()); break
        case 3: case 12: push(left(), right()); break
        case 4: case 11: push(right(), top()); break
        case 5: push(left(), top()); push(bottom(), right()); break
        case 6: case 9: push(bottom(), top()); break
        case 7: case 8: push(left(), top()); break
        case 10: push(left(), bottom()); push(right(), top()); break
        default: break
      }
    }
  }
  return chain(segs)
}

/** Une segmentos sueltos en polilíneas continuas. */
function chain(segs) {
  const map = new Map()
  for (const s of segs) {
    for (const [a, b] of [[s[0], s[1]], [s[1], s[0]]]) {
      const k = key(a)
      if (!map.has(k)) map.set(k, [])
      map.get(k).push({ from: a, to: b })
    }
  }
  const used = new Set()
  const lines = []
  const idOf = (s) => `${key(s.from)}>${key(s.to)}`
  for (const s of segs) {
    const start = { from: s[0], to: s[1] }
    if (used.has(idOf(start))) continue
    used.add(idOf(start))
    used.add(`${key(s[1])}>${key(s[0])}`)
    const line = [start.from, start.to]
    // Extensión hacia adelante y hacia atrás.
    for (const forward of [true, false]) {
      let end = forward ? line[line.length - 1] : line[0]
      for (let guard = 0; guard < 100000; guard++) {
        const cands = map.get(key(end)) || []
        let next = null
        for (const c of cands) {
          if (used.has(idOf(c))) continue
          next = c
          break
        }
        if (!next) break
        used.add(idOf(next))
        used.add(`${key(next.to)}>${key(next.from)}`)
        if (forward) line.push(next.to)
        else line.unshift(next.to)
        end = next.to
      }
    }
    if (line.length >= 2) lines.push(line)
  }
  return lines
}
