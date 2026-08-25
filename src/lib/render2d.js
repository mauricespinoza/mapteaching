// Dibujo del mapa geológico sobre canvas 2D. Todo se dibuja en coordenadas de
// pantalla; `view` transforma píxeles de imagen → pantalla.

import { toImage, basis } from './georef.js'
import { kinematicsOf } from './model.js'
import { contourSegment } from './structure.js'
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
  ctx.setTransform(ex[0], ex[1], ny[0], ny[1], os[0], os[1])
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
    hover,
    modelViews,
    edit,
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
    for (const mv of modelViews) drawModelTraces(ctx, view, mv, selection)
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
      ctx.globalAlpha = 0.95
      path(ctx, view, live)
      ctx.stroke()
      ctx.globalAlpha = 1
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
  if (show.structureContours && scene?.ready) {
    for (const c of scene.contacts) {
      const byBlock = scene.contactSurfaces.get(c.id)
      if (!byBlock) continue
      if (selection?.kind === 'contact' && selection.id !== c.id && show.onlySelectedSC) continue
      for (const [, surf] of byBlock) {
        drawStructureContours(ctx, view, scene, surf, c.color || '#0f172a')
      }
    }
    if (show.faultStructureContours) {
      for (const f of project.faults) {
        const surf = scene.faultSurfaces.get(f.id)
        if (surf) drawStructureContours(ctx, view, scene, surf, kinematicsOf(f.kinematics).color)
      }
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

  if (edit?.nodes?.length) drawEditNodes(ctx, view, edit)

  drawOverlays(ctx, opts)
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

function drawStructureContours(ctx, view, scene, surf, color) {
  for (const sc of surf.structureContours) {
    if (!sc.fit) continue
    const seg = contourSegment(sc, null)
    if (!seg) continue
    const a = toScreen(view, toImage(scene.georef, seg[0]))
    const b = toScreen(view, toImage(scene.georef, seg[1]))
    ctx.strokeStyle = color
    ctx.lineWidth = 1.8
    ctx.setLineDash([10, 6])
    ctx.beginPath()
    ctx.moveTo(a[0], a[1])
    ctx.lineTo(b[0], b[1])
    ctx.stroke()
    ctx.setLineDash([])
    label(ctx, b[0], b[1], `${sc.elevation}`, { color, size: 10, bg: 'rgba(255,255,255,0.9)' })
    ctx.fillStyle = color
    for (const p of sc.points) {
      const s = toScreen(view, toImage(scene.georef, p))
      ctx.beginPath()
      ctx.arc(s[0], s[1], 3.2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function midpointOfPair(pair, surf) {
  const lo = surf.structureContours.find((s) => s.elevation === pair.z1 && s.fit)
  const hi = surf.structureContours.find((s) => s.elevation === pair.z2 && s.fit)
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
