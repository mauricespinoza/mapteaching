// Dibujo del mapa geológico sobre canvas 2D. Todo se dibuja en coordenadas de
// pantalla; `view` transforma píxeles de imagen → pantalla.

import { toImage, basis, fmtDistance } from './georef.js'
import { kinematicsOf } from './model.js'
import { norm, perp, dist } from './geom.js'

export const toScreen = (view, p) => [p[0] * view.scale + view.tx, p[1] * view.scale + view.ty]
export const toImagePt = (view, p) => [(p[0] - view.tx) / view.scale, (p[1] - view.ty) / view.scale]

const RAD = Math.PI / 180

function path(ctx, view, pts) {
  ctx.beginPath()
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = toScreen(view, pts[i])
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
}

/** Sombreado del relieve a partir del MED (cuando no hay imagen base). */
export function renderHillshade(scene, sunAz = 315, sunAlt = 45) {
  const dem = scene.dem
  if (!dem?.valid) return null
  const { nx, ny, z, cell } = dem
  const canvas = document.createElement('canvas')
  canvas.width = nx
  canvas.height = ny
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(nx, ny)
  const az = (360 - sunAz + 90) * RAD
  const alt = sunAlt * RAD
  const range = Math.max(1e-6, dem.zmax - dem.zmin)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const i0 = Math.max(0, i - 1)
      const i1 = Math.min(nx - 1, i + 1)
      const j0 = Math.max(0, j - 1)
      const j1 = Math.min(ny - 1, j + 1)
      const dzdx = (z[j * nx + i1] - z[j * nx + i0]) / ((i1 - i0) * cell)
      const dzdy = (z[j1 * nx + i] - z[j0 * nx + i]) / ((j1 - j0) * cell)
      const slope = Math.atan(Math.hypot(dzdx, dzdy))
      const aspect = Math.atan2(dzdy, -dzdx)
      let hs =
        Math.cos(alt) * Math.sin(slope) * Math.cos(az - aspect) + Math.sin(alt) * Math.cos(slope)
      hs = Math.max(0, Math.min(1, hs))
      const t = (z[j * nx + i] - dem.zmin) / range
      // Mezcla hipsométrica suave (verde → ocre → gris) modulada por el sombreado.
      const r = 150 + 90 * t
      const g = 170 + 40 * t
      const b = 140 + 60 * t
      const k = 0.45 + 0.75 * hs
      const o = ((ny - 1 - j) * nx + i) * 4 // fila 0 del MED = Y mínimo (sur)
      img.data[o] = Math.min(255, r * k)
      img.data[o + 1] = Math.min(255, g * k)
      img.data[o + 2] = Math.min(255, b * k)
      img.data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

/**
 * Dibuja un raster definido sobre una grilla del mundo, situándolo en
 * coordenadas de imagen. La fila 0 del canvas corresponde al norte (Y máximo).
 */
function drawWorldRaster(ctx, view, georef, canvas, bbox, cell, rows, alpha = 1) {
  const { e, n } = basis(georef)
  const mpp = georef.metersPerPx || 1
  const k = cell / mpp
  // Cada valor se muestrea en un nodo de la grilla, así que el cuadrado que se
  // pinta debe quedar centrado en él: de ahí el desplazamiento de media celda.
  // Sin esto, todo el relleno aparece corrido respecto a las trazas.
  const o = toImage(georef, [
    bbox.minX - cell / 2,
    bbox.minY + (rows - 1) * cell + cell / 2,
  ])
  const os = toScreen(view, o)
  const ex = [e[0] * k * view.scale, e[1] * k * view.scale]
  const ny = [-n[0] * k * view.scale, -n[1] * k * view.scale]
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.globalAlpha = alpha
  // `transform` compone sobre la matriz vigente; `setTransform` la reemplaza y
  // descartaba la escala por densidad de pantalla, de modo que en pantallas
  // retina el raster salía a mitad de tamaño y anclado arriba a la izquierda,
  // desalineado respecto a las trazas y la imagen.
  ctx.transform(ex[0], ex[1], ny[0], ny[1], os[0], os[1])
  ctx.drawImage(canvas, 0, 0)
  ctx.restore()
}

const drawDemCanvas = (ctx, view, scene, canvas) =>
  drawWorldRaster(ctx, view, scene.georef, canvas, scene.dem.bbox, scene.dem.cell, scene.dem.ny)

function label(ctx, x, y, text, opts = {}) {
  const { color = '#0f172a', bg = 'rgba(255,255,255,0.82)', size = 11, weight = '600' } = opts
  ctx.font = `${weight} ${size}px ui-sans-serif, system-ui, sans-serif`
  const w = ctx.measureText(text).width
  ctx.fillStyle = bg
  ctx.fillRect(x - w / 2 - 3, y - size / 2 - 2, w + 6, size + 4)
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y)
}

/**
 * Rótulo de varios renglones centrados en una sola caja. El primero va
 * destacado: en los contornos estructurales es la cota, que es lo que
 * identifica a la curva; debajo van las dos unidades que separa.
 */
function labelBlock(ctx, x, y, lines, opts = {}) {
  const { color = '#0f172a', bg = 'rgba(255,255,255,0.9)', size = 10 } = opts
  const lh = size + 2
  const h = lines.length * lh
  let w = 0
  for (let i = 0; i < lines.length; i++) {
    ctx.font = `${i === 0 ? '700' : '500'} ${size}px ui-sans-serif, system-ui, sans-serif`
    w = Math.max(w, ctx.measureText(lines[i]).width)
  }
  ctx.fillStyle = bg
  ctx.fillRect(x - w / 2 - 4, y - h / 2 - 3, w + 8, h + 6)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let i = 0; i < lines.length; i++) {
    ctx.font = `${i === 0 ? '700' : '500'} ${size}px ui-sans-serif, system-ui, sans-serif`
    ctx.fillStyle = i === 0 ? color : 'rgba(51,65,85,0.95)'
    ctx.fillText(lines[i], x, y - h / 2 + lh * i + lh / 2)
  }
}

/**
 * Rótulo de un contacto: las dos unidades que separa, cada una con su color.
 * Es lo que el trazo no dice —el mapa muestra dónde va el contacto, no entre
 * qué unidades—, y en un mapa digitalizado de golpe, donde todas las líneas
 * cuelgan del mismo contacto, es además la forma de ver de un vistazo cuáles
 * quedan por reasignar. Arriba el techo y abajo la base, en el mismo orden en
 * que se apilan sobre el terreno.
 */
const TAG_SIZE = 9.5
// Puntos de la traza donde se prueba a escribir el rótulo, del centro hacia
// los extremos: el centro de una línea es donde mejor se lee, y los extremos
// son la última salida cuando lo de en medio está ocupado.
const TAG_STOPS = [0.5, 0.35, 0.65, 0.2, 0.8, 0.45, 0.55, 0.1, 0.9]

function drawUnitsTag(ctx, x, y, rows, opts = {}) {
  const { size = TAG_SIZE, border = '#0f172a' } = opts
  const [w, h] = unitsTagSize(ctx, rows, size)
  const lh = size + 4
  const sw = size - 1
  const x0 = x - w / 2
  const y0 = y - h / 2
  ctx.fillStyle = 'rgba(255,255,255,0.93)'
  ctx.fillRect(x0, y0, w, h)
  ctx.strokeStyle = border
  ctx.lineWidth = 1.2
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  for (let i = 0; i < rows.length; i++) {
    const cy = y0 + 4 + lh * i + lh / 2
    ctx.fillStyle = rows[i].color || '#e2e8f0'
    ctx.fillRect(x0 + 5, cy - sw / 2, sw, sw)
    ctx.strokeStyle = 'rgba(15,23,42,0.35)'
    ctx.lineWidth = 1
    ctx.strokeRect(x0 + 5.5, cy - sw / 2 + 0.5, sw - 1, sw - 1)
    ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`
    ctx.fillStyle = '#0f172a'
    ctx.fillText(rows[i].text, x0 + 5 + sw + 5, cy)
  }
  ctx.textAlign = 'center'
}

/** Tamaño en pantalla del rótulo de unidades, para buscarle sitio antes de escribirlo. */
function unitsTagSize(ctx, rows, size = 10) {
  ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`
  let w = 0
  for (const r of rows) w = Math.max(w, ctx.measureText(r.text).width)
  return [w + (size - 1) + 15, rows.length * (size + 4) + 8]
}

/** Tamaño en pantalla que ocupará un rótulo de varios renglones. */
function blockSize(ctx, lines, size = 10) {
  const lh = size + 2
  let w = 0
  for (let i = 0; i < lines.length; i++) {
    ctx.font = `${i === 0 ? '700' : '500'} ${size}px ui-sans-serif, system-ui, sans-serif`
    w = Math.max(w, ctx.measureText(lines[i]).width)
  }
  return [w + 14, lines.length * lh + 10]
}

const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]

/**
 * Sitúa un rótulo en el primer punto candidato que no pise a otro ya escrito.
 * Un mapa a mano se rotula así: la etiqueta se corre a lo largo de la línea
 * hasta encontrar sitio, y si no lo hay se deja la curva sin rótulo antes que
 * apilar texto ilegible. Devuelve el punto elegido, o null.
 */
function placeLabel(ctx, taken, candidates, text, size = 10, force = false, box = null) {
  ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`
  // Un poco de aire alrededor: dos rótulos que se rozan se leen mal aunque no
  // lleguen a solaparse.
  const w = box ? box[0] : ctx.measureText(text).width + 12
  const h = box ? box[1] : size + 10
  for (const [x, y] of candidates) {
    const r = [x - w / 2, y - h / 2, x + w / 2, y + h / 2]
    if (!taken.some((t) => overlaps(r, t))) {
      taken.push(r)
      return [x, y]
    }
  }
  if (force && candidates.length) {
    const [x, y] = candidates[0]
    taken.push([x - w / 2, y - h / 2, x + w / 2, y + h / 2])
    return [x, y]
  }
  return null
}

export function render(ctx, opts) {
  const {
    view,
    project,
    scene,
    image,
    hillshade,
    show,
    selection,
    draft,
    measure,
    hover,
    modelViews,
    edit,
    scItems,
    unitRaster,
    projected,
    foldAxes,
    width,
    height,
    dpr = 1,
  } = opts

  const L = project.settings?.layers || {}
  const alphaOf = (k) => (L[k]?.opacity ?? 1)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(0, 0, width, height)

  // --- Base ---
  if (image) {
    ctx.save()
    ctx.imageSmoothingQuality = 'high'
    ctx.globalAlpha = alphaOf('image')
    const p = toScreen(view, [0, 0])
    ctx.drawImage(image, p[0], p[1], image.width * view.scale, image.height * view.scale)
    ctx.restore()
  } else if (hillshade && show.hillshade) {
    drawDemCanvas(ctx, view, scene, hillshade)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  const mapRect = project.image || project.virtualSize
  if (mapRect) {
    const a = toScreen(view, [0, 0])
    const b = toScreen(view, [mapRect.width, mapRect.height])
    ctx.strokeStyle = '#94a3b8'
    ctx.lineWidth = 1
    ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1])
  }

  // --- Polígonos de unidades definidos por los contactos ---
  if (show.unitFill && unitRaster && scene?.ready) {
    drawWorldRaster(
      ctx, view, scene.georef, unitRaster.canvas, unitRaster.bbox,
      unitRaster.cell, unitRaster.ny, (L.units?.opacity ?? 0.6)
    )
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  // --- Modelos estructurales sintéticos ---
  if (show.models && modelViews?.length && scene?.ready) {
    for (const mv of modelViews) {
      if (mv.raster) {
        drawWorldRaster(
          ctx, view, scene.georef, mv.raster.canvas, mv.raster.bbox,
          mv.raster.cell, mv.raster.ny, (mv.model.opacity ?? 0.55) * alphaOf('models')
        )
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
    }
    ctx.save()
    ctx.globalAlpha = alphaOf('models')
    for (const mv of modelViews) drawModelTraces(ctx, view, mv, selection)
    ctx.restore()
  }

  // --- Curvas de nivel ---
  if (show.contours) {
    ctx.save()
    ctx.globalAlpha = alphaOf('contours')
    for (const c of project.contours) {
      const selected = selection?.kind === 'contour' && selection.id === c.id
      const index = project.settings.contourInterval
        ? Math.abs(c.elevation) % (project.settings.contourInterval * 5) < 1e-6
        : false
      const live = edit?.preview && edit.kind === 'contour' && edit.id === c.id ? edit.preview : c.pts
      ctx.strokeStyle = selected ? '#dc2626' : index ? '#92400e' : '#b45309'
      ctx.lineWidth = selected ? 2.6 : index ? 1.8 : 1.1
      ctx.globalAlpha = 0.95 * alphaOf('contours')
      path(ctx, view, live)
      ctx.stroke()
      ctx.globalAlpha = alphaOf('contours')
    }
    if (show.contourLabels) {
      for (const c of project.contours) {
        if (c.pts.length < 3) continue
        const p = toScreen(view, c.pts[Math.floor(c.pts.length / 2)])
        if (p[0] < -40 || p[1] < -20 || p[0] > width + 40 || p[1] > height + 20) continue
        label(ctx, p[0], p[1], `${c.elevation}`, { color: '#7c2d12', size: 10 })
      }
    }
    ctx.restore()
  }

  // --- Contornos estructurales ---
  // Las líneas van aquí, en su lugar habitual del orden de capas; sus rótulos
  // se difieren al final del dibujo (ver más abajo) para que ninguna otra
  // capa los tape.
  let scOrder = null
  if (show.structureContours && scene?.ready) {
    const visible = (scItems || []).filter(
      (it) =>
        (it.kind !== 'fault' || show.faultStructureContours) &&
        !(show.onlySelectedSC && selection?.kind === 'contact' && selection.id !== it.featureId)
    )
    // El seleccionado se rotula primero: es el que se está trabajando.
    scOrder = [...visible].sort(
      (a, b) =>
        Number(selection?.kind === 'sc' && selection.key === b.key) -
          Number(selection?.kind === 'sc' && selection.key === a.key) ||
        Number(Boolean(b.manualId)) - Number(Boolean(a.manualId))
    )
    for (const it of scOrder) {
      drawStructureContour(ctx, view, it, { selected: selection?.kind === 'sc' && selection.key === it.key })
    }
  }

  // --- Contactos ---
  if (show.contacts) {
    ctx.save()
    ctx.globalAlpha = alphaOf('contacts')
    for (const c of project.contacts) {
      const selected = selection?.kind === 'contact' && selection.id === c.id
      for (const tr of c.traces) {
        const live = edit?.preview && edit.id === c.id && edit.traceId === tr.id ? edit.preview : tr.pts
        ctx.strokeStyle = c.color || '#0f172a'
        ctx.lineWidth = selected ? 4.5 : 3
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.setLineDash(dashFor(c.type))
        path(ctx, view, live)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }
    ctx.restore()
  }

  // --- Fallas ---
  if (show.faults) {
    ctx.save()
    ctx.globalAlpha = alphaOf('faults')
    for (const f of project.faults) {
      const kin = kinematicsOf(f.kinematics)
      const selected = selection?.kind === 'fault' && selection.id === f.id
      const surf = scene?.faultSurfaces?.get(f.id)
      for (const tr of f.traces) {
        const live = edit?.preview && edit.id === f.id && edit.traceId === tr.id ? edit.preview : tr.pts
        ctx.strokeStyle = selected ? '#111827' : '#1f2937'
        ctx.lineWidth = selected ? 6 : 4.5
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        path(ctx, view, live)
        ctx.stroke()
        ctx.strokeStyle = kin.color
        ctx.lineWidth = selected ? 3.4 : 2.4
        path(ctx, view, live)
        ctx.stroke()
        drawFaultSymbols(ctx, view, scene, live, f, kin, surf)
      }
    }
    ctx.restore()
  }

  // --- Símbolos de rumbo y manteo ---
  if (show.attitudes && scene?.ready) {
    for (const c of scene.contacts) {
      const byBlock = scene.contactSurfaces.get(c.id)
      if (!byBlock) continue
      for (const [, surf] of byBlock) {
        for (const pair of surf.pairs) {
          const mid = midpointOfPair(pair, surf)
          if (!mid) continue
          drawAttitude(ctx, view, scene, mid, pair, c.color || '#0f172a')
        }
      }
    }
  }

  // --- Ejes de pliegue (antiformes y sinformes) ---
  if (show.foldAxes && foldAxes?.length) {
    for (const ax of foldAxes) drawFoldAxis(ctx, view, ax)
  }

  // --- Marco del área de trabajo ---
  if (project.frame) {
    const a = toScreen(view, project.frame.a)
    const b = toScreen(view, project.frame.b)
    const x = Math.min(a[0], b[0])
    const y = Math.min(a[1], b[1])
    const w = Math.abs(b[0] - a[0])
    const h = Math.abs(b[1] - a[1])
    // Lo de fuera del área se atenúa, para que se lea qué queda dentro.
    ctx.save()
    ctx.fillStyle = 'rgba(148,163,184,0.22)'
    ctx.beginPath()
    ctx.rect(0, 0, width, height)
    ctx.rect(x, y, w, h)
    ctx.fill('evenodd')
    ctx.restore()
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 2
    ctx.setLineDash([8, 4])
    ctx.strokeRect(x, y, w, h)
    ctx.setLineDash([])
    label(ctx, x + w / 2, y - 10, 'Área de trabajo', { color: '#0f172a', size: 10 })
  }

  // --- Perfiles ---
  if (show.sections) {
    for (const s of project.sections) {
      const selected = selection?.kind === 'section' && selection.id === s.id
      const a = toScreen(view, s.a)
      const b = toScreen(view, s.b)
      ctx.strokeStyle = selected ? '#7c3aed' : '#4c1d95'
      ctx.lineWidth = selected ? 3.5 : 2.5
      ctx.setLineDash([9, 5])
      ctx.beginPath()
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
      ctx.stroke()
      ctx.setLineDash([])
      const name = s.name || ''
      const [n0, n1] = name.split('–')
      label(ctx, a[0], a[1] - 12, n0 || 'A', { color: '#4c1d95' })
      label(ctx, b[0], b[1] - 12, n1 || "A'", { color: '#4c1d95' })
      for (const p of [a, b]) {
        ctx.fillStyle = '#4c1d95'
        ctx.beginPath()
        ctx.arc(p[0], p[1], selected ? 6 : 4.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  // --- Pozos ---
  if (show.wells) {
    for (const w of project.wells) {
      const p = toScreen(view, w.at)
      const selected = selection?.kind === 'well' && selection.id === w.id
      ctx.strokeStyle = '#0f172a'
      ctx.fillStyle = selected ? '#f59e0b' : '#fef3c7'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(p[0], p[1], 7, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(p[0] - 10, p[1])
      ctx.lineTo(p[0] + 10, p[1])
      ctx.moveTo(p[0], p[1] - 10)
      ctx.lineTo(p[0], p[1] + 10)
      ctx.stroke()
      if (w.plunge < 89 && scene?.ready) {
        // Proyección horizontal de la trayectoria desviada.
        const { e, n } = basis(scene.georef)
        const t = w.trend * RAD
        const dirWorld = [Math.sin(t), Math.cos(t)]
        const dImg = norm([
          dirWorld[0] * e[0] + dirWorld[1] * n[0],
          dirWorld[0] * e[1] + dirWorld[1] * n[1],
        ])
        const L = 26
        ctx.strokeStyle = '#b45309'
        ctx.setLineDash([5, 3])
        ctx.beginPath()
        ctx.moveTo(p[0], p[1])
        ctx.lineTo(p[0] + dImg[0] * L, p[1] + dImg[1] * L)
        ctx.stroke()
        ctx.setLineDash([])
      }
      label(ctx, p[0], p[1] - 16, w.name, { color: '#78350f', size: 11 })
    }
  }

  // --- Contactos proyectados a través de la falla ---
  // Van punteados y en el color del contacto, pero más claros: no son un dato
  // observado sino dónde estaría el contacto si el bloque se movió en bloque.
  if (show.projected && projected?.length) {
    ctx.save()
    ctx.setLineDash([2, 5])
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    for (const pr of projected) {
      if (!pr.lines?.length) continue
      ctx.strokeStyle = pr.color
      ctx.globalAlpha = 0.85
      for (const line of pr.lines) {
        const pts = line.map((w) => toScreen(view, toImage(scene.georef, w)))
        if (pts.length < 2) continue
        ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1])
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  // --- Puntos de perforación ---
  if (show.piercings && (project.piercings || []).length) {
    for (const pp of project.piercings) {
      const selected = selection?.kind === 'piercing' && selection.id === pp.id
      const sides = [
        ['a', pp.a],
        ['b', pp.b],
      ].filter(([, s]) => s?.at)
      const screens = sides.map(([, s]) => toScreen(view, s.at))
      // El segmento que une los dos lados: es la separación que se ve en el
      // mapa, no el salto —el salto se mide entre los puntos ya perforados—.
      if (screens.length === 2) {
        ctx.save()
        ctx.strokeStyle = selected ? '#be123c' : '#9f1239'
        ctx.setLineDash([6, 4])
        ctx.lineWidth = selected ? 2.5 : 1.6
        ctx.beginPath()
        ctx.moveTo(screens[0][0], screens[0][1])
        ctx.lineTo(screens[1][0], screens[1][1])
        ctx.stroke()
        ctx.restore()
      }
      sides.forEach(([key, s], i) => {
        const p = screens[i]
        // Flecha con la dirección de inmersión del rasgo lineal.
        if (scene?.ready && Number.isFinite(s.trend)) {
          const { e, n } = basis(scene.georef)
          const t = s.trend * RAD
          const dirWorld = [Math.sin(t), Math.cos(t)]
          const d = norm([
            dirWorld[0] * e[0] + dirWorld[1] * n[0],
            dirWorld[0] * e[1] + dirWorld[1] * n[1],
          ])
          ctx.strokeStyle = '#be123c'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(p[0], p[1])
          ctx.lineTo(p[0] + d[0] * 24, p[1] + d[1] * 24)
          ctx.stroke()
          ctx.beginPath()
          ctx.moveTo(p[0] + d[0] * 24, p[1] + d[1] * 24)
          ctx.lineTo(p[0] + d[0] * 17 - d[1] * 5, p[1] + d[1] * 17 + d[0] * 5)
          ctx.lineTo(p[0] + d[0] * 17 + d[1] * 5, p[1] + d[1] * 17 - d[0] * 5)
          ctx.closePath()
          ctx.fillStyle = '#be123c'
          ctx.fill()
        }
        ctx.fillStyle = selected ? '#be123c' : '#fecdd3'
        ctx.strokeStyle = '#881337'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(p[0], p[1], 6, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        label(ctx, p[0], p[1] - 14, `${pp.name} ${key.toUpperCase()}`, { color: '#881337', size: 10 })
      })
    }
  }

  // --- Símbolos de los modelos ---
  if (show.models && modelViews?.length && scene?.ready) {
    for (const mv of modelViews) drawModelSymbols(ctx, view, mv, selection, scene.georef)
  }

  // --- Calibración: escala y norte ---
  if (project.georef.scaleLine) {
    const { a, b, meters } = project.georef.scaleLine
    const sa = toScreen(view, a)
    const sb = toScreen(view, b)
    ctx.strokeStyle = '#059669'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(sa[0], sa[1])
    ctx.lineTo(sb[0], sb[1])
    ctx.stroke()
    for (const p of [sa, sb]) {
      ctx.beginPath()
      ctx.arc(p[0], p[1], 4, 0, Math.PI * 2)
      ctx.fillStyle = '#059669'
      ctx.fill()
    }
    label(ctx, (sa[0] + sb[0]) / 2, (sa[1] + sb[1]) / 2 - 12, `${meters} m`, { color: '#065f46' })
  }
  if (project.georef.northLine) {
    const { a, b } = project.georef.northLine
    const sa = toScreen(view, a)
    const sb = toScreen(view, b)
    drawArrow(ctx, sa, sb, '#1d4ed8', 3)
    label(ctx, sb[0], sb[1] - 12, 'N', { color: '#1d4ed8' })
  }

  // --- Trazo en curso ---
  if (draft?.pts?.length) {
    ctx.strokeStyle = draft.color || '#ef4444'
    ctx.lineWidth = 3
    ctx.setLineDash([6, 4])
    path(ctx, view, draft.pts)
    if (draft.cursor) {
      const c = toScreen(view, draft.cursor)
      ctx.lineTo(c[0], c[1])
    }
    ctx.stroke()
    ctx.setLineDash([])
    drawVertices(ctx, view, draft.pts, draft.color || '#ef4444')
  }
  if (hover) {
    const p = toScreen(view, hover)
    ctx.strokeStyle = 'rgba(15,23,42,0.35)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(p[0], p[1], 9, 0, Math.PI * 2)
    ctx.stroke()
  }

  if (measure) drawMeasure(ctx, view, project, measure)

  if (edit?.nodes?.length) drawEditNodes(ctx, view, edit)

  // --- Rótulos de los contornos estructurales ---
  // Se dibujan al final, encima de contactos, fallas, pozos y todo lo demás:
  // son la referencia de cota que se está leyendo mientras se trabaja, y
  // enterrada bajo una falla o un contacto deja de servir para eso.
  const taken = []
  if (scOrder && show.structureLabels !== false) {
    for (const it of scOrder) {
      drawStructureContourLabel(ctx, view, it, { selected: selection?.kind === 'sc' && selection.key === it.key, taken })
    }
  }

  // --- Rótulos de los contactos: las dos unidades que separan ---
  // Van después de los contornos y comparten con ellos el registro de sitio
  // ocupado, así que ceden el paso a la cota que se está leyendo y se quedan
  // sin escribir antes que apilarse encima.
  if (show.contacts && show.contactLabels) {
    const unitById = new Map(project.units.map((u) => [u.id, u]))
    for (const c of project.contacts) {
      const upper = unitById.get(c.upperUnitId)
      const lower = unitById.get(c.lowerUnitId)
      if (!upper && !lower) continue
      const rows = [
        { text: shortName(upper?.name || 'sin unidad', 16), color: upper?.color },
        { text: shortName(lower?.name || 'sin unidad', 16), color: lower?.color },
      ]
      const box = unitsTagSize(ctx, rows, TAG_SIZE)
      for (const tr of c.traces) {
        const pts = tr.pts
        if (!pts || pts.length < 2) continue
        // El rótulo busca sitio a lo largo de su propia traza: así siempre se
        // lee pegado a la línea que describe, aunque el centro esté ocupado.
        // Se prueban bastantes puntos porque en un mapa cargado los primeros
        // caen sobre otros rótulos y sin alternativas la línea se quedaría sin
        // identificar, que es justo lo que este rótulo viene a evitar.
        const spots = TAG_STOPS.map((t) => toScreen(view, pts[Math.round(t * (pts.length - 1))])).filter(
          (q) => q[0] > -60 && q[1] > -30 && q[0] < width + 60 && q[1] < height + 30
        )
        if (!spots.length) continue
        const spot = placeLabel(ctx, taken, spots, rows[0].text, TAG_SIZE, false, box)
        if (spot) drawUnitsTag(ctx, spot[0], spot[1], rows, { size: TAG_SIZE, border: c.color || '#0f172a' })
      }
    }
  }

  drawOverlays(ctx, opts)
}

/** La regla: segmento acotado, con marca de escuadra si va perpendicular. */
function drawMeasure(ctx, view, project, m) {
  const a = toScreen(view, m.a)
  const b = toScreen(view, m.b)
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const L = Math.hypot(dx, dy)
  const color = '#0f766e'

  // Las trazas a las que se pegó, resaltadas para que se vea de qué se mide.
  ctx.lineCap = 'round'
  for (const [t, alpha] of [[m.anchor, 0.9], [m.end, 0.55]]) {
    if (!t?.pts) continue
    ctx.strokeStyle = `rgba(5,150,105,${alpha})`
    ctx.lineWidth = 3
    path(ctx, view, t.pts)
    ctx.stroke()
  }

  // Funda blanca bajo la cota: el mapa de debajo puede ser de cualquier color.
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = 5.5
  ctx.beginPath()
  ctx.moveTo(a[0], a[1])
  ctx.lineTo(b[0], b[1])
  ctx.stroke()
  ctx.strokeStyle = color
  ctx.lineWidth = 2.4
  ctx.beginPath()
  ctx.moveTo(a[0], a[1])
  ctx.lineTo(b[0], b[1])
  ctx.stroke()

  if (L > 1) {
    // Topes en los extremos, como en una cota de plano.
    const ux = dx / L
    const uy = dy / L
    for (const [p, s] of [[a, 1], [b, -1]]) {
      ctx.beginPath()
      ctx.moveTo(p[0] - uy * 7, p[1] + ux * 7)
      ctx.lineTo(p[0] + uy * 7, p[1] - ux * 7)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(p[0], p[1])
      ctx.lineTo(p[0] + ux * 10 * s, p[1] + uy * 10 * s)
      ctx.stroke()
    }
    // Escuadra en el anclaje: deja claro que la lectura es la ortogonal.
    if (m.orthogonal && m.anchor?.dir) {
      const t = norm(toScreenDir(view, m.anchor.dir))
      const k = 11
      ctx.strokeStyle = '#10b981'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(a[0] + t[0] * k, a[1] + t[1] * k)
      ctx.lineTo(a[0] + t[0] * k + ux * k, a[1] + t[1] * k + uy * k)
      ctx.lineTo(a[0] + ux * k, a[1] + uy * k)
      ctx.stroke()
    }
  }

  const mpp = project.georef?.metersPerPx
  const world = mpp ? fmtDistance(dist(m.a, m.b) * mpp) : `${dist(m.a, m.b).toFixed(0)} px`
  // El rótulo se aparta de la cota, no la tapa.
  const off = L > 1 ? [(-dy / L) * 16, (dx / L) * 16] : [0, -16]
  label(ctx, (a[0] + b[0]) / 2 + off[0], (a[1] + b[1]) / 2 + off[1], world, {
    color: '#0f766e',
    size: 12,
    bg: 'rgba(255,255,255,0.92)',
  })
}

/** Dirección en píxeles de imagen → dirección en pantalla (sin traslación). */
function toScreenDir(view, d) {
  return [d[0] * view.scale, d[1] * view.scale]
}

/** Trazas de los contactos de un modelo sintético. */
function drawModelTraces(ctx, view, mv, selection) {
  const selected = selection?.kind === 'model' && selection.id === mv.id
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  for (const tr of mv.traces) {
    for (const line of tr.lines) {
      ctx.strokeStyle = 'rgba(15,23,42,0.85)'
      ctx.lineWidth = selected ? 3.6 : 2.6
      path(ctx, view, line)
      ctx.stroke()
      ctx.strokeStyle = tr.upperColor
      ctx.lineWidth = selected ? 1.8 : 1.2
      path(ctx, view, line)
      ctx.stroke()
    }
  }
}

/** Símbolos de rumbo/manteo y punto de anclaje de un modelo. */
function drawModelSymbols(ctx, view, mv, selection, georef) {
  const selected = selection?.kind === 'model' && selection.id === mv.id
  for (const sym of mv.symbols) {
    if (!Number.isFinite(sym.dip)) continue
    const p = toScreen(view, sym.at)
    drawStrikeDip(ctx, p, sym, '#0f172a', georef)
  }
  // Punto de anclaje
  const a = toScreen(view, mv.model.at)
  ctx.beginPath()
  ctx.arc(a[0], a[1], selected ? 8 : 6, 0, Math.PI * 2)
  ctx.fillStyle = selected ? '#f43f5e' : '#ffffff'
  ctx.strokeStyle = '#0f172a'
  ctx.lineWidth = 2
  ctx.fill()
  ctx.stroke()
  if (mv.anchorAttitude) {
    label(ctx, a[0], a[1] - 18, mv.model.name, { color: '#0f172a', size: 11 })
  }
}

/** Símbolo clásico de rumbo y manteo: barra de rumbo + garrapata de manteo. */
function drawStrikeDip(ctx, p, att, color, georef) {
  const dirScreen = azimuthToImage(georef, att.dipDir - 90)
  const dipScreen = azimuthToImage(georef, att.dipDir)
  const L = 15
  ctx.strokeStyle = color
  ctx.lineWidth = 2.2
  ctx.beginPath()
  ctx.moveTo(p[0] - dirScreen[0] * L, p[1] - dirScreen[1] * L)
  ctx.lineTo(p[0] + dirScreen[0] * L, p[1] + dirScreen[1] * L)
  ctx.stroke()
  if (att.dip < 0.5) {
    // Capa horizontal: círculo con cruz.
    ctx.beginPath()
    ctx.arc(p[0], p[1], 5, 0, Math.PI * 2)
    ctx.stroke()
    return
  }
  ctx.beginPath()
  ctx.moveTo(p[0], p[1])
  ctx.lineTo(p[0] + dipScreen[0] * 8, p[1] + dipScreen[1] * 8)
  ctx.stroke()
  ctx.font = '600 9px ui-sans-serif, system-ui, sans-serif'
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(
    `${att.dip.toFixed(0)}`,
    p[0] + dipScreen[0] * 17,
    p[1] + dipScreen[1] * 17
  )
}

/** Dirección unitaria en coordenadas de imagen para un azimut del mundo. */
function azimuthToImage(georef, az) {
  const a = (az * Math.PI) / 180
  return norm(toImage(georef, [Math.sin(a), Math.cos(a)]))
}

/** Nodos y manejadores Bézier del trazo en edición. */
function drawEditNodes(ctx, view, edit) {
  const { nodes, activeIndex } = edit
  // Manejadores sólo del nodo activo, para no llenar la pantalla de puntos.
  const act = nodes[activeIndex]
  if (act) {
    const c = toScreen(view, act.p)
    for (const which of ['hIn', 'hOut']) {
      const h = act[which]
      if (!h || (!h[0] && !h[1])) continue
      const hp = toScreen(view, [act.p[0] + h[0], act.p[1] + h[1]])
      ctx.strokeStyle = '#0284c7'
      ctx.lineWidth = 1.4
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(c[0], c[1])
      ctx.lineTo(hp[0], hp[1])
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.arc(hp[0], hp[1], 5.5, 0, Math.PI * 2)
      ctx.fillStyle = '#38bdf8'
      ctx.strokeStyle = '#0c4a6e'
      ctx.lineWidth = 1.6
      ctx.fill()
      ctx.stroke()
    }
  }
  for (let i = 0; i < nodes.length; i++) {
    const s = toScreen(view, nodes[i].p)
    const isActive = i === activeIndex
    ctx.beginPath()
    ctx.arc(s[0], s[1], isActive ? 7 : 5, 0, Math.PI * 2)
    ctx.fillStyle = isActive ? '#f59e0b' : '#ffffff'
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 2
    ctx.fill()
    ctx.stroke()
  }
}

function dashFor(type) {
  if (type === 'discordante') return [12, 5]
  if (type === 'intrusivo') return [3, 4]
  if (type === 'inferido') return [7, 7]
  return []
}

function drawVertices(ctx, view, pts, color) {
  ctx.fillStyle = color
  for (const p of pts) {
    const s = toScreen(view, p)
    ctx.beginPath()
    ctx.arc(s[0], s[1], 3, 0, Math.PI * 2)
    ctx.fill()
  }
}

/**
 * Un contorno estructural: la recta de cota constante sobre la superficie.
 * Los que calcula el motor van punteados; los que el estudiante ha puesto o
 * corregido a mano, en trazo continuo y con sus dos extremos como manijas. El
 * rótulo lleva el rasgo al que pertenece y la cota que representa, que es lo
 * que distingue un contorno de otro cuando se cruzan varios en el mapa.
 */
function drawStructureContour(ctx, view, it, { selected = false } = {}) {
  const a = toScreen(view, it.a)
  const b = toScreen(view, it.b)
  const manual = Boolean(it.manualId)
  if (selected) {
    ctx.strokeStyle = 'rgba(14,165,233,0.35)'
    ctx.lineWidth = 9
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(a[0], a[1])
    ctx.lineTo(b[0], b[1])
    ctx.stroke()
  }
  ctx.strokeStyle = it.color
  ctx.lineWidth = manual ? 2.6 : 1.8
  ctx.setLineDash(manual ? [] : [10, 6])
  ctx.beginPath()
  ctx.moveTo(a[0], a[1])
  ctx.lineTo(b[0], b[1])
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = it.color
  if (manual || selected) {
    // Manijas de los extremos: son las que se arrastran para corregir la curva.
    for (const p of [a, b]) {
      ctx.beginPath()
      ctx.arc(p[0], p[1], selected ? 6 : 4.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1.6
      ctx.stroke()
    }
  } else {
    // Los puntos que definen el ajuste: cada uno es un cruce traza–curva.
    for (const p of it.points) {
      const s = toScreen(view, p)
      ctx.beginPath()
      ctx.arc(s[0], s[1], 3.2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

/**
 * Rótulo de un contorno estructural, dibujado aparte de su línea: se difiere
 * a un pase final para quedar siempre por encima de las demás capas (ver
 * `render`).
 */
function drawStructureContourLabel(ctx, view, it, { selected = false, taken = [] } = {}) {
  const a = toScreen(view, it.a)
  const b = toScreen(view, it.b)
  const manual = Boolean(it.manualId)
  const lines = it.lines?.length ? it.lines : [`${it.elevation} m`, shortName(it.name)]
  const box = blockSize(ctx, lines, 10)
  // Extremos primero y luego puntos a lo largo de la recta: el rótulo busca
  // sitio sin dejar de tocar su propia curva.
  const along = [0.5, 0.25, 0.75].map((t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  const spot = placeLabel(ctx, taken, [b, a, ...along], lines[0], 10, selected || manual, box)
  if (spot) {
    labelBlock(ctx, spot[0], spot[1], lines, {
      color: it.color,
      size: 10,
      bg: manual ? 'rgba(224,242,254,0.95)' : 'rgba(255,255,255,0.9)',
    })
  }
}

/**
 * Eje de un pliegue, con su simbología clásica: espigas en los extremos que
 * se abren hacia fuera del trazo en un antiforme —los limbos bajan
 * alejándose del eje— y se cierran hacia dentro en un sinforme —los limbos
 * bajan hacia el eje—, más una flecha de inmersión en el extremo hundido
 * cuando el pliegue no es prácticamente horizontal.
 */
function drawFoldAxis(ctx, view, ax) {
  const a = toScreen(view, ax.aImg)
  const b = toScreen(view, ax.bImg)
  const color = '#dc2626' // rojo intenso: un eje de pliegue tiene que resaltar sobre curvas y contactos
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 2.2
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(a[0], a[1])
  ctx.lineTo(b[0], b[1])
  ctx.stroke()

  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1
  const u = [dx / len, dy / len]

  const barb = 12
  const spread = 32 * RAD
  const wings = (p, out) => {
    ctx.lineWidth = 1.8
    for (const s of [1, -1]) {
      const ang = s * spread
      const wx = out[0] * Math.cos(ang) - out[1] * Math.sin(ang)
      const wy = out[0] * Math.sin(ang) + out[1] * Math.cos(ang)
      ctx.beginPath()
      ctx.moveTo(p[0], p[1])
      ctx.lineTo(p[0] + wx * barb, p[1] + wy * barb)
      ctx.stroke()
    }
  }
  const outward = ax.type === 'antiform'
  wings(a, outward ? [-u[0], -u[1]] : [u[0], u[1]])
  wings(b, outward ? [u[0], u[1]] : [-u[0], -u[1]])

  // Flecha de inmersión en `b` —el extremo hundido, por convención de cómo se
  // construyó el eje—: sólo si el pliegue realmente se hunde.
  if (ax.plunge > 3) {
    const L = 20
    const tip = [b[0] + u[0] * L, b[1] + u[1] * L]
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(b[0], b[1])
    ctx.lineTo(tip[0], tip[1])
    ctx.stroke()
    const headAng = 22 * RAD
    const back = (ang) => [
      tip[0] - (u[0] * Math.cos(ang) - u[1] * Math.sin(ang)) * 9,
      tip[1] - (u[0] * Math.sin(ang) + u[1] * Math.cos(ang)) * 9,
    ]
    const p1 = back(headAng)
    const p2 = back(-headAng)
    ctx.beginPath()
    ctx.moveTo(tip[0], tip[1])
    ctx.lineTo(p1[0], p1[1])
    ctx.lineTo(p2[0], p2[1])
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
    label(ctx, tip[0], tip[1] + 14, `${ax.plunge.toFixed(0)}°`, { color, size: 10 })
  }

  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  label(ctx, mid[0], mid[1] - 14, ax.type === 'antiform' ? 'Antiforme' : 'Sinforme', { color, size: 10.5 })
  ctx.restore()
}

/** Nombre abreviado para que el rótulo no tape el mapa. */
function shortName(name, max = 16) {
  const t = String(name || '')
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function midpointOfPair(pair, surf) {
  // El limbo forma parte de la identidad del contorno: en un pliegue hay dos
  // contornos de la misma cota, uno en cada flanco.
  const same = (s, z) => s.elevation === z && s.limb === pair.limb && s.part === pair.part && s.fit
  const lo = surf.structureContours.find((s) => same(s, pair.z1))
  const hi = surf.structureContours.find((s) => same(s, pair.z2))
  if (!lo || !hi) return null
  return [(lo.fit.c[0] + hi.fit.c[0]) / 2, (lo.fit.c[1] + hi.fit.c[1]) / 2]
}

function drawAttitude(ctx, view, scene, world, pair, color) {
  const p = toScreen(view, toImage(scene.georef, world))
  const dirImg = norm(toImage(scene.georef, pair.strikeDir))
  const dipImg = norm(toImage(scene.georef, [
    Math.sin(pair.dipDir * RAD),
    Math.cos(pair.dipDir * RAD),
  ]))
  const L = 18
  ctx.strokeStyle = color
  ctx.lineWidth = 2.4
  ctx.beginPath()
  ctx.moveTo(p[0] - dirImg[0] * L, p[1] - dirImg[1] * L)
  ctx.lineTo(p[0] + dirImg[0] * L, p[1] + dirImg[1] * L)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(p[0], p[1])
  ctx.lineTo(p[0] + dipImg[0] * 9, p[1] + dipImg[1] * 9)
  ctx.stroke()
  label(ctx, p[0] + dipImg[0] * 22, p[1] + dipImg[1] * 22, `${pair.dip.toFixed(0)}°`, {
    color,
    size: 10,
  })
}

function drawFaultSymbols(ctx, view, scene, pts, fault, kin, surf) {
  const att = fault.manual || surf?.mean
  const kind = fault.kinematics || 'indeterminada'
  const screen = pts.map((p) => toScreen(view, p))
  let total = 0
  for (let i = 1; i < screen.length; i++) total += dist(screen[i - 1], screen[i])
  if (total < 30) return
  const step = 52
  let acc = step / 2
  const dipSide = (() => {
    if (!att || !scene?.ready) return null
    const t = att.dipDir * RAD
    const w = [Math.sin(t), Math.cos(t)]
    return norm(toImage(scene.georef, w))
  })()
  for (let i = 1; i < screen.length; i++) {
    const a = screen[i - 1]
    const b = screen[i]
    const segLen = dist(a, b)
    if (segLen < 1e-6) continue
    const dir = norm([b[0] - a[0], b[1] - a[1]])
    let side = perp(dir)
    if (dipSide && side[0] * dipSide[0] + side[1] * dipSide[1] < 0) side = [-side[0], -side[1]]
    while (acc <= segLen) {
      const p = [a[0] + dir[0] * acc, a[1] + dir[1] * acc]
      drawFaultTick(ctx, p, dir, side, kind, kin.color)
      acc += step
    }
    acc -= segLen
  }
}

function drawFaultTick(ctx, p, dir, side, kind, color) {
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 2
  if (kind.startsWith('normal')) {
    ctx.beginPath()
    ctx.moveTo(p[0], p[1])
    ctx.lineTo(p[0] + side[0] * 8, p[1] + side[1] * 8)
    ctx.stroke()
  } else if (kind.startsWith('inversa')) {
    const t = 8
    ctx.beginPath()
    ctx.moveTo(p[0] - dir[0] * t * 0.6, p[1] - dir[1] * t * 0.6)
    ctx.lineTo(p[0] + dir[0] * t * 0.6, p[1] + dir[1] * t * 0.6)
    ctx.lineTo(p[0] + side[0] * t, p[1] + side[1] * t)
    ctx.closePath()
    ctx.fill()
  }
  if (kind.includes('dextral') || kind.includes('sinestral')) {
    const s = kind.includes('dextral') ? 1 : -1
    const n = perp(dir)
    const L = 11
    for (const sign of [1, -1]) {
      const base = [p[0] + n[0] * 3 * sign, p[1] + n[1] * 3 * sign]
      const tip = [base[0] + dir[0] * L * sign * s, base[1] + dir[1] * L * sign * s]
      ctx.beginPath()
      ctx.moveTo(base[0], base[1])
      ctx.lineTo(tip[0], tip[1])
      ctx.stroke()
      const back = [tip[0] - dir[0] * 4 * sign * s, tip[1] - dir[1] * 4 * sign * s]
      ctx.beginPath()
      ctx.moveTo(tip[0], tip[1])
      ctx.lineTo(back[0] - n[0] * 3.5 * sign, back[1] - n[1] * 3.5 * sign)
      ctx.stroke()
    }
  }
}

function drawArrow(ctx, a, b, color, w = 2) {
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = w
  ctx.beginPath()
  ctx.moveTo(a[0], a[1])
  ctx.lineTo(b[0], b[1])
  ctx.stroke()
  const d = norm([b[0] - a[0], b[1] - a[1]])
  const n = perp(d)
  ctx.beginPath()
  ctx.moveTo(b[0], b[1])
  ctx.lineTo(b[0] - d[0] * 12 + n[0] * 5, b[1] - d[1] * 12 + n[1] * 5)
  ctx.lineTo(b[0] - d[0] * 12 - n[0] * 5, b[1] - d[1] * 12 - n[1] * 5)
  ctx.closePath()
  ctx.fill()
}

/** Barra de escala y rosa de los vientos. */
function drawOverlays(ctx, { view, project, width, height }) {
  const mpp = project.georef.metersPerPx
  const pad = 16
  if (mpp) {
    const targetPx = Math.min(200, width * 0.28)
    const rawMeters = (targetPx / view.scale) * mpp
    const pow = Math.pow(10, Math.floor(Math.log10(rawMeters)))
    const nice = [1, 2, 5, 10].map((k) => k * pow).find((v) => v >= rawMeters / 2) || pow
    const px = (nice / mpp) * view.scale
    const y = height - pad - 18
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.fillRect(pad - 6, y - 12, px + 12, 34)
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(pad, y)
    ctx.lineTo(pad + px, y)
    ctx.moveTo(pad, y - 5)
    ctx.lineTo(pad, y + 5)
    ctx.moveTo(pad + px, y - 5)
    ctx.lineTo(pad + px, y + 5)
    ctx.moveTo(pad + px / 2, y - 4)
    ctx.lineTo(pad + px / 2, y + 4)
    ctx.stroke()
    ctx.fillStyle = '#0f172a'
    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, pad, y + 6)
  }
  // Rosa de los vientos
  const cx = width - pad - 26
  const cy = pad + 26
  const n = project.georef.northVec || [0, -1]
  const nn = norm(n)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.beginPath()
  ctx.arc(cx, cy, 24, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#334155'
  ctx.lineWidth = 1
  ctx.stroke()
  drawArrow(ctx, [cx - nn[0] * 14, cy - nn[1] * 14], [cx + nn[0] * 16, cy + nn[1] * 16], '#1d4ed8', 2)
  ctx.fillStyle = '#1d4ed8'
  ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('N', cx + nn[0] * 30, cy + nn[1] * 30)
}
