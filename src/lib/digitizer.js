// Digitalización automática de las líneas de un mapa escaneado.
//
// Port a JavaScript del algoritmo de MapDigitizer Lite (plugin de QGIS), que
// allí corre sobre numpy/OpenCV. Aquí no hay OpenCV, así que cada pieza se
// escribe a mano sobre arrays tipados; el pipeline y los criterios son los
// mismos:
//
//  1. `inkMask`      umbral adaptativo gaussiano invertido: aísla lo oscuro
//                    respecto de *su entorno*, que es lo que aguanta un
//                    escaneo con la iluminación desigual. Cierre 3×3 para
//                    sellar cortes de 1 px y filtro por tamaño de componente
//                    conexa para tirar motas y texto pequeño.
//  2. `skeletonize`  adelgazamiento Zhang-Suen a 1 px de grosor.
//  3. `pathsFromSkeleton`  el esqueleto sigue siendo un raster: se convierte en
//                    grafo, se clasifica cada píxel por su grado y se recorren
//                    los tramos de nodo a nodo. Los cruces quedan como vértices
//                    compartidos —la red sale «noded»—, que es lo que hace
//                    falta para que un contacto termine donde empieza otro.
//  4. `mergeStrokes` un cruce no debe partir una falla en dos: en cada nudo se
//                    emparejan los dos extremos más colineales y el trazo pasa
//                    de largo.
//  5. sinuosidad     las letras y los símbolos se enrollan; un contacto o una
//                    curva de nivel no. Descarta lo que se enrolla de más.
//
// Lo que se añade aquí y no estaba en el plugin es la **separación por color**:
// en una carta geológica las curvas de nivel van en sepia y los contactos y
// fallas en negro o en color saturado, así que el mismo pipeline corre dos
// veces sobre máscaras de tinta distintas. Ver `classifyInk`.

/** Escala de grises perceptual (Rec. 601), la que usa OpenCV. */
export function toGray(rgba, w, h) {
  const g = new Uint8ClampedArray(w * h)
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000
  }
  return g
}

/** Desenfoque gaussiano separable, con el sigma que OpenCV deriva del lado. */
function gaussianBlur(src, w, h, size) {
  const sigma = 0.3 * ((size - 1) * 0.5 - 1) + 0.8
  const r = Math.max(1, Math.floor(size / 2))
  const k = new Float32Array(2 * r + 1)
  let sum = 0
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma))
    k[i + r] = v
    sum += v
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum

  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let i = -r; i <= r; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i))
        acc += src[y * w + xx] * k[i + r]
      }
      tmp[y * w + x] = acc
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let i = -r; i <= r; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i))
        acc += tmp[yy * w + x] * k[i + r]
      }
      out[y * w + x] = acc
    }
  }
  return out
}

/** Dilatación seguida de erosión con elemento 3×3: sella cortes de 1 px. */
function close3x3(mask, w, h) {
  const dil = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0
      for (let dy = -1; dy <= 1 && !on; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy
          const xx = x + dx
          if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue
          if (mask[yy * w + xx]) {
            on = 1
            break
          }
        }
      }
      dil[y * w + x] = on
    }
  }
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let all = 1
      for (let dy = -1; dy <= 1 && all; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy))
          const xx = Math.min(w - 1, Math.max(0, x + dx))
          if (!dil[yy * w + xx]) {
            all = 0
            break
          }
        }
      }
      out[y * w + x] = all
    }
  }
  return out
}

/** Borra las componentes conexas (8-conectadas) menores que `minPx`. */
function dropSmallComponents(mask, w, h, minPx) {
  if (minPx <= 0) return mask
  const label = new Int32Array(w * h).fill(-1)
  const stack = new Int32Array(w * h)
  const out = new Uint8Array(w * h)
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s] >= 0) continue
    let top = 0
    stack[top++] = s
    label[s] = s
    const members = [s]
    while (top > 0) {
      const cur = stack[--top]
      const cy = (cur / w) | 0
      const cx = cur - cy * w
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = cy + dy
          const xx = cx + dx
          if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue
          const n = yy * w + xx
          if (!mask[n] || label[n] >= 0) continue
          label[n] = s
          members.push(n)
          stack[top++] = n
        }
      }
    }
    if (members.length >= minPx) for (const m of members) out[m] = 1
  }
  return out
}

/**
 * Reparte la tinta según su color.
 *
 * En una carta, las curvas de nivel van en sepia y los contactos y las fallas
 * en negro (o en un color saturado propio). La saturación separa unas de otras
 * sin tener que acertar el tono exacto: la tinta neutra —negra o gris— es la
 * geología, y la tinta con color es el relieve. Con `hue` puesto se afina al
 * tono elegido, que es lo que hace falta cuando el mapa lleva varias tintas de
 * color.
 *
 * @param mode 'todo' | 'neutro' | 'color'
 * @param hue  tono objetivo en grados (0-360), o null para cualquier color
 */
export function classifyInk(rgba, mask, w, h, { mode = 'todo', hue = null, hueTol = 40, satMin = 0.22 } = {}) {
  if (mode === 'todo') return mask
  const out = new Uint8Array(w * h)
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    const p = i * 4
    const r = rgba[p] / 255
    const g = rgba[p + 1] / 255
    const b = rgba[p + 2] / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const sat = max <= 0 ? 0 : (max - min) / max
    if (mode === 'neutro') {
      if (sat < satMin) out[i] = 1
      continue
    }
    if (sat < satMin) continue
    if (hue == null) {
      out[i] = 1
      continue
    }
    const d = max - min
    let hh = 0
    if (d > 0) {
      if (max === r) hh = 60 * (((g - b) / d) % 6)
      else if (max === g) hh = 60 * ((b - r) / d + 2)
      else hh = 60 * ((r - g) / d + 4)
    }
    if (hh < 0) hh += 360
    let diff = Math.abs(hh - hue)
    if (diff > 180) diff = 360 - diff
    if (diff <= hueTol) out[i] = 1
  }
  return out
}

/** Tono dominante de la tinta con color: el sepia de las curvas, típicamente. */
export function dominantInkHue(rgba, mask, w, h, satMin = 0.22) {
  const bins = new Float64Array(36)
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    const p = i * 4
    const r = rgba[p] / 255
    const g = rgba[p + 1] / 255
    const b = rgba[p + 2] / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const d = max - min
    const sat = max <= 0 ? 0 : d / max
    if (sat < satMin) continue
    let hh = 0
    if (max === r) hh = 60 * (((g - b) / d) % 6)
    else if (max === g) hh = 60 * ((b - r) / d + 2)
    else hh = 60 * ((r - g) / d + 4)
    if (hh < 0) hh += 360
    bins[Math.min(35, Math.floor(hh / 10))] += 1
  }
  let best = -1
  let bestN = 0
  for (let i = 0; i < 36; i++) {
    if (bins[i] > bestN) {
      bestN = bins[i]
      best = i
    }
  }
  return best < 0 || bestN < 50 ? null : best * 10 + 5
}

/**
 * Máscara de tinta: umbral adaptativo gaussiano invertido + cierre + filtro de
 * componentes pequeñas. Devuelve {0,1} por píxel.
 */
export function inkMask(gray, w, h, { blockSize = 31, c = 10, minComponentPx = 30 } = {}) {
  let size = Math.max(3, Math.round(blockSize))
  if (size % 2 === 0) size += 1
  const mean = gaussianBlur(gray, w, h, size)
  const mask = new Uint8Array(w * h)
  // Invertido: la tinta es más oscura que su entorno.
  for (let i = 0; i < mask.length; i++) mask[i] = gray[i] < mean[i] - c ? 1 : 0
  return dropSmallComponents(close3x3(mask, w, h), w, h, minComponentPx)
}

/** Zhang-Suen: adelgaza la máscara a un esqueleto de 1 px. */
export function skeletonize(mask, w, h) {
  const img = Uint8Array.from(mask)
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img[y * w + x])
  const doomed = []
  for (let guard = 0; guard < 200; guard++) {
    let changed = false
    for (let step = 0; step < 2; step++) {
      doomed.length = 0
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!img[y * w + x]) continue
          // P2..P9 en sentido horario desde el norte.
          const p = [
            at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1),
            at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1),
          ]
          let b = 0
          for (const v of p) b += v
          if (b < 2 || b > 6) continue
          let a = 0
          for (let i = 0; i < 8; i++) if (!p[i] && p[(i + 1) % 8]) a++
          if (a !== 1) continue
          const cond =
            step === 0
              ? p[0] * p[2] * p[4] === 0 && p[2] * p[4] * p[6] === 0
              : p[0] * p[2] * p[6] === 0 && p[0] * p[4] * p[6] === 0
          if (cond) doomed.push(y * w + x)
        }
      }
      if (doomed.length) {
        for (const i of doomed) img[i] = 0
        changed = true
      }
    }
    if (!changed) break
  }
  return img
}

const ORTHO = [[-1, 0], [0, 1], [1, 0], [0, -1]]
const DIAG = [[-1, 1], [1, 1], [1, -1], [-1, -1]]

/**
 * Vecinos con adyacencia 8 **reducida**: un vecino diagonal sólo cuenta si no
 * hay ninguno de los dos ortogonales que ya lo conectan. Sin esto, cada escalón
 * del esqueleto infla el grado del píxel y siembra cruces que no existen.
 */
function neighbors(skel, w, h, x, y) {
  const on = (xx, yy) => xx >= 0 && yy >= 0 && xx < w && yy < h && skel[yy * w + xx]
  const out = []
  for (const [dy, dx] of ORTHO) if (on(x + dx, y + dy)) out.push([x + dx, y + dy])
  for (const [dy, dx] of DIAG) {
    if (!on(x + dx, y + dy)) continue
    if (!on(x + dx, y) && !on(x, y + dy)) out.push([x + dx, y + dy])
  }
  return out
}

function degreeMap(skel, w, h) {
  const deg = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!skel[y * w + x]) continue
      deg[y * w + x] = neighbors(skel, w, h, x, y).length
    }
  }
  return deg
}

/**
 * Esqueleto → polilíneas topológicamente limpias, en píxeles [x, y].
 *
 * Cada tramo va de nodo a nodo siguiendo cadenas de grado 2. Un cruce real da
 * un *grupo* de píxeles-nodo contiguos (una X deja un bloque 2×2), así que se
 * agrupan y todos los tramos que llegan terminan en el mismo vértice.
 */
export function pathsFromSkeleton(skel, w, h, { minLengthPx = 5 } = {}) {
  const deg = degreeMap(skel, w, h)
  const isNode = new Uint8Array(w * h)
  for (let i = 0; i < skel.length; i++) if (skel[i] && deg[i] !== 2) isNode[i] = 1

  // Agrupar píxeles-nodo contiguos: cada grupo es un cruce lógico, con un
  // píxel representante al que se anclan todos los tramos que llegan.
  const clusterOf = new Int32Array(w * h).fill(-1)
  const rep = new Map()
  for (let s = 0; s < isNode.length; s++) {
    if (!isNode[s] || clusterOf[s] >= 0) continue
    const members = [s]
    clusterOf[s] = s
    const stack = [s]
    while (stack.length) {
      const cur = stack.pop()
      const cy = (cur / w) | 0
      const cx = cur - cy * w
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = cy + dy
          const xx = cx + dx
          if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue
          const n = yy * w + xx
          if (!isNode[n] || clusterOf[n] >= 0) continue
          clusterOf[n] = s
          members.push(n)
          stack.push(n)
        }
      }
    }
    let sx = 0
    let sy = 0
    for (const m of members) {
      sy += (m / w) | 0
      sx += m % w
    }
    sx /= members.length
    sy /= members.length
    let bestM = members[0]
    let bestD = Infinity
    for (const m of members) {
      const my = (m / w) | 0
      const mx = m - my * w
      const d = (mx - sx) ** 2 + (my - sy) ** 2
      if (d < bestD) {
        bestD = d
        bestM = m
      }
    }
    rep.set(s, bestM)
  }

  const visited = new Uint8Array(w * h)
  // Clave de arista: `a * n + b` cabe de sobra en un entero exacto para
  // cualquier imagen razonable, y evita construir cadenas en el bucle caliente.
  const n = w * h
  const usedEdges = new Set()
  const paths = []

  const walk = (start, first) => {
    const path = [start, first]
    let prev = start
    let cur = first
    while (!isNode[cur]) {
      visited[cur] = 1
      const cy = (cur / w) | 0
      const cx = cur - cy * w
      let next = null
      for (const [nx, ny] of neighbors(skel, w, h, cx, cy)) {
        const n = ny * w + nx
        if (n !== prev && (isNode[n] || !visited[n])) {
          next = n
          break
        }
      }
      if (next == null) break
      path.push(next)
      prev = cur
      cur = next
    }
    return path
  }

  for (let node = 0; node < isNode.length; node++) {
    if (!isNode[node]) continue
    const ny0 = (node / w) | 0
    const nx0 = node - ny0 * w
    for (const [nx, ny] of neighbors(skel, w, h, nx0, ny0)) {
      const nb = ny * w + nx
      if (usedEdges.has(node * n + nb)) continue
      if (isNode[nb]) {
        usedEdges.add(node * n + nb)
        usedEdges.add(nb * n + node)
        // Dos cruces distintos pegados: hay tramo entre ellos. Dentro del
        // mismo cruce sólo hay ruido interno del grupo.
        if (clusterOf[node] !== clusterOf[nb]) paths.push([node, nb])
        continue
      }
      if (visited[nb]) continue
      const path = walk(node, nb)
      usedEdges.add(node * n + nb)
      if (path.length >= 2 && isNode[path[path.length - 1]]) {
        usedEdges.add(path[path.length - 1] * n + path[path.length - 2])
      }
      paths.push(path)
    }
  }

  // Anillos puros: cadenas de grado 2 que no tocan ningún nodo.
  for (let s = 0; s < skel.length; s++) {
    if (!skel[s] || deg[s] !== 2 || visited[s]) continue
    visited[s] = 1
    const sy = (s / w) | 0
    const sx = s - sy * w
    const nbs = neighbors(skel, w, h, sx, sy)
    const first = nbs.map(([x, y]) => y * w + x).find((n) => !visited[n])
    if (first == null) continue
    const path = walk(s, first)
    path.push(s)
    paths.push(path)
  }

  // Espolones: tramos cortos con algún extremo libre son artefactos del
  // adelgazamiento, no líneas del mapa.
  const keep = paths.filter((p) => {
    if (p.length >= minLengthPx) return true
    return !(deg[p[0]] === 1 || deg[p[p.length - 1]] === 1)
  })

  const snap = (path) => {
    const out = path.slice()
    for (const idx of [0, out.length - 1]) {
      const cl = clusterOf[out[idx]]
      if (cl >= 0 && rep.has(cl)) out[idx] = rep.get(cl)
    }
    const dedup = [out[0]]
    for (const v of out.slice(1)) if (v !== dedup[dedup.length - 1]) dedup.push(v)
    return dedup
  }

  return keep
    .map(snap)
    .filter((p) => p.length >= 2)
    .map((p) => p.map((i) => [i % w, (i / w) | 0]))
}

/** Douglas–Peucker sobre una polilínea de píxeles. */
export function simplifyPath(path, tolerance = 1.5) {
  if (path.length <= 2 || tolerance <= 0) return path.slice()
  const keep = new Uint8Array(path.length)
  keep[0] = keep[path.length - 1] = 1
  const stack = [[0, path.length - 1]]
  while (stack.length) {
    const [i0, i1] = stack.pop()
    if (i1 - i0 < 2) continue
    const ax = path[i0][0]
    const ay = path[i0][1]
    const sx = path[i1][0] - ax
    const sy = path[i1][1] - ay
    const len = Math.hypot(sx, sy)
    let best = 0
    let bestI = -1
    for (let i = i0 + 1; i < i1; i++) {
      const rx = path[i][0] - ax
      const ry = path[i][1] - ay
      const d = len === 0 ? Math.hypot(rx, ry) : Math.abs(rx * sy - ry * sx) / len
      if (d > best) {
        best = d
        bestI = i
      }
    }
    if (best > tolerance && bestI > 0) {
      keep[bestI] = 1
      stack.push([i0, bestI], [bestI, i1])
    }
  }
  return path.filter((_, i) => keep[i])
}

/** Vector unitario que apunta hacia fuera del extremo indicado. */
function directionAt(path, end, probe = 6) {
  const k = Math.min(probe, path.length - 1)
  const a = end === 0 ? path[0] : path[path.length - 1]
  const b = end === 0 ? path[k] : path[path.length - 1 - k]
  const vx = b[0] - a[0]
  const vy = b[1] - a[1]
  const n = Math.hypot(vx, vy)
  return n ? [vx / n, vy / n] : [0, 0]
}

/**
 * Funde tramos colineales a través de los cruces.
 *
 * Un cruce no debe partir una falla en dos elementos: la que pasa de largo es
 * una sola. En cada punto donde convergen varios extremos se emparejan los dos
 * cuya dirección sea más opuesta —el trazo más recto a través del nudo—, de
 * forma codiciosa: una X se resuelve como dos trazos que se cruzan, y en una T
 * el par colineal forma el trazo pasante y la rama queda aparte.
 */
export function mergeStrokes(paths, { angleThresholdDeg = 45, probePx = 6 } = {}) {
  if (!paths.length) return []
  const key = (p) => `${p[0]},${p[1]}`
  const closed = []
  const open = []
  paths.forEach((p, i) => {
    if (key(p[0]) === key(p[p.length - 1])) closed.push(p)
    else open.push(i)
  })

  const ends = new Map()
  for (const i of open) {
    for (const [e, coord] of [[0, paths[i][0]], [1, paths[i][paths[i].length - 1]]]) {
      const k = key(coord)
      if (!ends.has(k)) ends.set(k, [])
      ends.get(k).push([i, e])
    }
  }

  const paired = new Map()
  const portKey = ([i, e]) => `${i}:${e}`
  for (const incident of ends.values()) {
    if (incident.length < 2) continue
    const dirs = incident.map(([i, e]) => directionAt(paths[i], e, probePx))
    const cands = []
    for (let a = 0; a < incident.length; a++) {
      for (let b = a + 1; b < incident.length; b++) {
        const cos = Math.min(1, Math.max(-1, dirs[a][0] * dirs[b][0] + dirs[a][1] * dirs[b][1]))
        const dev = (Math.acos(-cos) * 180) / Math.PI
        if (dev <= angleThresholdDeg) cands.push([dev, a, b])
      }
    }
    cands.sort((x, y) => x[0] - y[0])
    const used = new Set()
    for (const [, a, b] of cands) {
      if (used.has(a) || used.has(b)) continue
      used.add(a)
      used.add(b)
      paired.set(portKey(incident[a]), incident[b])
      paired.set(portKey(incident[b]), incident[a])
    }
  }

  const strokes = []
  const visited = new Set()
  const oriented = (i, entry) => (entry === 0 ? paths[i].slice() : paths[i].slice().reverse())
  for (const i of open) {
    if (visited.has(i)) continue
    let startEnd = 0
    if (paired.has(portKey([i, 0])) && !paired.has(portKey([i, 1]))) startEnd = 1
    const verts = oriented(i, startEnd)
    visited.add(i)
    let exit = portKey([i, 1 - startEnd])
    while (paired.has(exit)) {
      const [ni, ne] = paired.get(exit)
      if (visited.has(ni)) break
      verts.push(...oriented(ni, ne).slice(1))
      visited.add(ni)
      exit = portKey([ni, 1 - ne])
    }
    strokes.push(verts)
  }
  return [...strokes, ...closed]
}

/**
 * Sinuosidad: largo del trazo dividido por la distancia entre sus extremos.
 * Una falla suavemente curva ronda 1,0–1,5; una letra o un símbolo se enrolla
 * y se dispara. Es el filtro con el que se echa el texto del mapa.
 */
export function sinuosity(path) {
  let len = 0
  for (let i = 1; i < path.length; i++) {
    len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
  }
  const chord = Math.hypot(
    path[path.length - 1][0] - path[0][0],
    path[path.length - 1][1] - path[0][1]
  )
  return chord < 1e-9 ? Infinity : len / chord
}

/**
 * Pipeline completo sobre los píxeles de la imagen base.
 *
 * @param rgba  ImageData.data de la imagen
 * @param opts  ver los valores por defecto; `mode`/`hue` eligen qué tinta se
 *              digitaliza (ver `classifyInk`)
 * @returns  { paths, mask } con las polilíneas en píxeles de la imagen
 */
export function digitize(rgba, w, h, opts = {}) {
  const {
    blockSize = 31,
    c = 10,
    minComponentPx = 30,
    mode = 'todo',
    hue = null,
    hueTol = 40,
    satMin = 0.22,
    tolerancePx = 1.5,
    minLengthPx = 12,
    angleThresholdDeg = 45,
    maxSinuosity = 2.5,
    minVertices = 2,
  } = opts

  const gray = toGray(rgba, w, h)
  const raw = inkMask(gray, w, h, { blockSize, c, minComponentPx })
  const mask = classifyInk(rgba, raw, w, h, { mode, hue, hueTol, satMin })
  const skel = skeletonize(mask, w, h)
  const tramos = pathsFromSkeleton(skel, w, h, { minLengthPx })
  const strokes = mergeStrokes(tramos, { angleThresholdDeg })
  const paths = []
  for (const s of strokes) {
    if (maxSinuosity > 0 && sinuosity(s) > maxSinuosity) continue
    const simple = simplifyPath(s, tolerancePx)
    if (simple.length < minVertices) continue
    // Un trazo más corto que el mínimo no es una línea del mapa.
    let len = 0
    for (let i = 1; i < simple.length; i++) {
      len += Math.hypot(simple[i][0] - simple[i - 1][0], simple[i][1] - simple[i - 1][1])
    }
    if (len < minLengthPx) continue
    paths.push(simple)
  }
  return { paths, mask }
}
