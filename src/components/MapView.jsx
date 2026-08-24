import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { render, toImagePt, renderHillshade } from '../lib/render2d.js'
import { thin, simplify, pointPolyline, dist } from '../lib/geom.js'

/**
 * Lienzo del mapa. Pensado para lápiz sobre tablet: el lápiz dibuja, los dedos
 * navegan (arrastre y pinza) y la rueda hace zoom en el escritorio.
 */
export default function MapView({
  project,
  scene,
  image,
  show,
  tool,
  drawMode,
  penOnly,
  selection,
  view: viewProp,
  setView,
  mapRect,
  onStroke,
  onTwoPoint,
  onTapPoint,
  onPick,
  dispatch,
  status,
}) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const [size, setSize] = useState({ width: 800, height: 600 })
  const [draft, setDraft] = useState(null)
  const [cursor, setCursor] = useState(null)
  const pointers = useRef(new Map())
  const gesture = useRef(null)
  const drag = useRef(null)

  // Encuadre inicial automático: se calcula al conocer el tamaño del lienzo.
  const view = viewProp || fitTo(size, mapRect)
  useEffect(() => {
    if (!viewProp && size.width > 10) setView(fitTo(size, mapRect))
  }, [viewProp, size, mapRect, setView])

  const isDrawTool = ['contour', 'contact', 'fault'].includes(tool)
  const isTwoPointTool = ['scale', 'north', 'section'].includes(tool)

  const hillshade = useMemo(() => {
    const levels = new Set((scene?.worldContours || []).map((c) => c.elevation))
    if (image || !show.hillshade || !scene?.dem?.valid || levels.size < 3) return null
    try {
      return renderHillshade(scene)
    } catch {
      return null
    }
  }, [image, show.hillshade, scene])

  // --- Tamaño responsivo ---
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setSize({ width: Math.max(200, r.width), height: Math.max(200, r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // --- Dibujo ---
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    canvas.width = size.width * dpr
    canvas.height = size.height * dpr
    canvas.style.width = `${size.width}px`
    canvas.style.height = `${size.height}px`
    const ctx = canvas.getContext('2d')
    render(ctx, {
      view,
      project,
      scene,
      image,
      hillshade,
      show,
      selection,
      draft,
      hover: cursor,
      width: size.width,
      height: size.height,
      dpr,
    })
  }, [view, project, scene, image, hillshade, show, selection, draft, cursor, size])

  const toImg = useCallback((ev) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return toImagePt(view, [ev.clientX - rect.left, ev.clientY - rect.top])
  }, [view])

  /** Prueba de impacto: devuelve la entidad más cercana al punto. */
  const hitTest = useCallback(
    (p, tolPx = 14) => {
      const tol = tolPx / view.scale
      let best = null
      const consider = (cand, d) => {
        if (d <= tol && (!best || d < best.d)) best = { ...cand, d }
      }
      for (const w of project.wells) consider({ kind: 'well', id: w.id }, dist(p, w.at))
      for (const s of project.sections) {
        consider({ kind: 'section', id: s.id, handle: 'a' }, dist(p, s.a))
        consider({ kind: 'section', id: s.id, handle: 'b' }, dist(p, s.b))
        consider({ kind: 'section', id: s.id }, pointPolyline(p, [s.a, s.b]).d)
      }
      for (const f of project.faults)
        for (const tr of f.traces) consider({ kind: 'fault', id: f.id, traceId: tr.id }, pointPolyline(p, tr.pts).d)
      for (const c of project.contacts)
        for (const tr of c.traces) consider({ kind: 'contact', id: c.id, traceId: tr.id }, pointPolyline(p, tr.pts).d)
      for (const c of project.contours) consider({ kind: 'contour', id: c.id }, pointPolyline(p, c.pts).d)
      return best
    },
    [project, view.scale]
  )

  const finishStroke = useCallback(
    (pts) => {
      setDraft(null)
      if (!pts || pts.length < 2) return
      const cleaned = simplify(thin(pts, 1.2 / view.scale), 1.1 / view.scale)
      onStroke(cleaned)
    },
    [onStroke, view.scale]
  )

  // --- Punteros ---
  const onPointerDown = (ev) => {
    const canvas = canvasRef.current
    canvas.setPointerCapture(ev.pointerId)
    pointers.current.set(ev.pointerId, ev)
    const p = toImg(ev)

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const rect = canvas.getBoundingClientRect()
      gesture.current = {
        d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        c0: [(a.clientX + b.clientX) / 2 - rect.left, (a.clientY + b.clientY) / 2 - rect.top],
        view0: { ...view },
      }
      setDraft(null)
      drag.current = null
      return
    }

    const navigating =
      tool === 'pan' || (penOnly && ev.pointerType === 'touch') || ev.button === 1 || ev.shiftKey
    if (navigating) {
      drag.current = { mode: 'pan', x: ev.clientX, y: ev.clientY, view0: { ...view } }
      return
    }

    if (tool === 'select' || tool === 'erase') {
      const hit = hitTest(p)
      if (tool === 'erase') {
        if (hit) deleteHit(hit, dispatch)
        return
      }
      onPick(hit)
      if (hit?.kind === 'well') drag.current = { mode: 'well', id: hit.id }
      else if (hit?.kind === 'section' && hit.handle) drag.current = { mode: 'section', id: hit.id, handle: hit.handle }
      return
    }

    if (tool === 'well') {
      onTapPoint(p)
      return
    }

    if (isDrawTool) {
      if (drawMode === 'vertex') {
        setDraft((d) => ({ pts: [...(d?.pts || []), p], cursor: p, color: draftColor(tool) }))
      } else {
        drag.current = { mode: 'draw', pts: [p] }
        setDraft({ pts: [p], color: draftColor(tool) })
      }
      return
    }

    if (isTwoPointTool) {
      if (drawMode === 'vertex') {
        const pts = [...(draft?.pts || []), p]
        if (pts.length >= 2) {
          onTwoPoint(pts[0], pts[1])
          setDraft(null)
        } else setDraft({ pts, color: draftColor(tool) })
      } else {
        drag.current = { mode: 'two', a: p }
        setDraft({ pts: [p, p], color: draftColor(tool) })
      }
    }
  }

  const onPointerMove = (ev) => {
    if (pointers.current.has(ev.pointerId)) pointers.current.set(ev.pointerId, ev)
    const p = toImg(ev)
    if (ev.pointerType !== 'touch') setCursor(p)

    if (gesture.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const rect = canvasRef.current.getBoundingClientRect()
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      const c = [(a.clientX + b.clientX) / 2 - rect.left, (a.clientY + b.clientY) / 2 - rect.top]
      const g = gesture.current
      const scale = Math.max(0.02, Math.min(60, g.view0.scale * (d / (g.d0 || 1))))
      const wx = (g.c0[0] - g.view0.tx) / g.view0.scale
      const wy = (g.c0[1] - g.view0.ty) / g.view0.scale
      setView({ scale, tx: c[0] - wx * scale, ty: c[1] - wy * scale })
      return
    }

    const d = drag.current
    if (!d) return
    if (d.mode === 'pan') {
      setView({ ...d.view0, tx: d.view0.tx + (ev.clientX - d.x), ty: d.view0.ty + (ev.clientY - d.y) })
    } else if (d.mode === 'draw') {
      d.pts.push(p)
      setDraft({ pts: [...d.pts], color: draftColor(tool) })
    } else if (d.mode === 'two') {
      setDraft({ pts: [d.a, p], color: draftColor(tool) })
    } else if (d.mode === 'well') {
      dispatch({ type: 'well.update', id: d.id, patch: { at: p } })
    } else if (d.mode === 'section') {
      dispatch({ type: 'section.update', id: d.id, patch: { [d.handle]: p } })
    }
  }

  const endPointer = (ev) => {
    pointers.current.delete(ev.pointerId)
    if (pointers.current.size < 2) gesture.current = null
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.mode === 'draw') finishStroke(d.pts)
    else if (d.mode === 'two') {
      const p = toImg(ev)
      setDraft(null)
      if (dist(d.a, p) > 4 / view.scale) onTwoPoint(d.a, p)
    }
  }

  const onWheel = (ev) => {
    ev.preventDefault()
    const rect = canvasRef.current.getBoundingClientRect()
    const cx = ev.clientX - rect.left
    const cy = ev.clientY - rect.top
    const factor = Math.exp(-ev.deltaY * 0.0016)
    const scale = Math.max(0.02, Math.min(60, view.scale * factor))
    const wx = (cx - view.tx) / view.scale
    const wy = (cy - view.ty) / view.scale
    setView({ scale, tx: cx - wx * scale, ty: cy - wy * scale })
  }

  // Cierre de trazos por vértices desde el teclado.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Enter' && draft?.pts?.length >= 2) {
        if (isTwoPointTool) {
          onTwoPoint(draft.pts[0], draft.pts[1])
          setDraft(null)
        } else finishStroke(draft.pts)
      }
      if (e.key === 'Escape') setDraft(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draft, finishStroke, isTwoPointTool, onTwoPoint])

  const canFinish = drawMode === 'vertex' && draft?.pts?.length >= 2

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-slate-100">
      <canvas
        ref={canvasRef}
        className="block touch-none select-none"
        style={{ cursor: tool === 'pan' ? 'grab' : 'crosshair' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={(e) => {
          setCursor(null)
          endPointer(e)
        }}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      {canFinish && (
        <div className="pointer-events-auto absolute bottom-24 left-1/2 flex -translate-x-1/2 gap-2">
          <button
            className="rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg"
            onClick={() => {
              if (isTwoPointTool) {
                onTwoPoint(draft.pts[0], draft.pts[1])
                setDraft(null)
              } else finishStroke(draft.pts)
            }}
          >
            Terminar trazo
          </button>
          <button
            className="rounded-full bg-slate-700 px-4 py-3 text-sm font-semibold text-white shadow-lg"
            onClick={() => setDraft((d) => (d?.pts?.length > 1 ? { ...d, pts: d.pts.slice(0, -1) } : null))}
          >
            Quitar vértice
          </button>
        </div>
      )}
      {status && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-slate-900/85 px-4 py-1.5 text-xs font-medium text-white shadow">
          {status}
        </div>
      )}
    </div>
  )
}

function fitTo(size, rect) {
  const r = rect || { width: 1200, height: 900 }
  const pad = 24
  const scale = Math.min((size.width - pad * 2) / r.width, (size.height - pad * 2) / r.height) || 0.5
  return {
    scale,
    tx: (size.width - r.width * scale) / 2,
    ty: (size.height - r.height * scale) / 2,
  }
}

function draftColor(tool) {
  if (tool === 'contour') return '#b45309'
  if (tool === 'fault') return '#dc2626'
  if (tool === 'scale') return '#059669'
  if (tool === 'north') return '#1d4ed8'
  if (tool === 'section') return '#7c3aed'
  return '#0f172a'
}

function deleteHit(hit, dispatch) {
  if (hit.kind === 'contour') dispatch({ type: 'contour.delete', id: hit.id })
  else if (hit.kind === 'contact') dispatch({ type: 'trace.delete', kind: 'contact', id: hit.id, traceId: hit.traceId })
  else if (hit.kind === 'fault') dispatch({ type: 'trace.delete', kind: 'fault', id: hit.id, traceId: hit.traceId })
  else if (hit.kind === 'section') dispatch({ type: 'section.delete', id: hit.id })
  else if (hit.kind === 'well') dispatch({ type: 'well.delete', id: hit.id })
}
