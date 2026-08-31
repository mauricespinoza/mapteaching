import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { render, toImagePt, renderHillshade } from '../lib/render2d.js'
import { structureContourItems } from '../lib/scene.js'
import { foldAxes as computeFoldAxes } from '../lib/folds.js'
import { newStructureContour } from '../lib/model.js'
import MapMenu from './MapMenu.jsx'
import { thin, simplify, pointPolyline, dist, chaikin } from '../lib/geom.js'
import { snapTargets, snapToLines, measureEnd, reading } from '../lib/measure.js'
import { fmtDistance, strikeQuadrant } from '../lib/georef.js'
import {
  nodesOf,
  flattenNodes,
  hitTestNodes,
  insertNode,
  moveNode,
  moveHandle,
  toggleCorner,
  removeNode,
} from '../lib/bezier.js'

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
  onEditRequest,
  onAddScRequest,
  dispatch,
  status,
  modelViews,
  unitRaster,
  projected,
  canvasRef: externalCanvasRef,
}) {
  const innerRef = useRef(null)
  const canvasRef = externalCanvasRef || innerRef
  const wrapRef = useRef(null)
  const [size, setSize] = useState({ width: 800, height: 600 })
  const [draft, setDraft] = useState(null)
  const [cursor, setCursor] = useState(null)
  const [edit, setEdit] = useState(null)
  // Espejo síncrono de `edit`. Durante un arrastre de nodos hacen falta las
  // posiciones recién calculadas antes de que React vuelva a pintar, y sobre
  // todo hace falta poder guardarlas al soltar sin meter el `dispatch` dentro
  // de un actualizador de estado: React puede volver a ejecutar el actualizador
  // en cada repintado, y cada repetición despachaba otra vez.
  const editRef = useRef(null)
  const [menu, setMenu] = useState(null)
  // Contorno estructural en pleno arrastre: se dibuja desde aquí y sólo se
  // escribe en el proyecto al soltar, así el motor no recalcula la escena en
  // cada movimiento del lápiz y el deshacer no se llena de pasos intermedios.
  const [scDraft, setScDraft] = useState(null)
  const [gestureHint, setGestureHint] = useState(null)
  // Regla: se mantiene fuera del proyecto porque es una lectura, no un dato.
  const [measure, setMeasure] = useState(null)
  const [snapOn, setSnapOn] = useState(true)
  const pointers = useRef(new Map())
  const gesture = useRef(null)
  const drag = useRef(null)
  const flashTimer = useRef(null)
  const holdTimer = useRef(null)
  // `openMenuFor` pasa la herramienta a «Seleccionar» (vía `onEditRequest`) al
  // abrir el menú de un rasgo. Sin esta bandera, el efecto de abajo —que
  // cierra el menú en cuanto cambia la herramienta— se disparaba con ese mismo
  // cambio y lo cerraba en el acto, así que el menú nunca llegaba a verse
  // salvo que ya se estuviera en «Seleccionar» de antes.
  const openingMenu = useRef(false)
  const taps = useRef({ startedAt: 0, maxFingers: 0, moved: false, origins: new Map(), lastAt: 0, lastFingers: 0 })

  // Encuadre inicial automático: se calcula al conocer el tamaño del lienzo.
  const view = viewProp || fitTo(size, mapRect)
  useEffect(() => {
    if (!viewProp && size.width > 10) setView(fitTo(size, mapRect))
  }, [viewProp, size, mapRect, setView])

  // --- Edición de nodos del trazo seleccionado ---
  const editable = useMemo(() => {
    if (tool !== 'select' || !selection) return null
    if (selection.kind === 'contour') {
      const c = project.contours.find((x) => x.id === selection.id)
      return c ? { kind: 'contour', id: c.id, traceId: null, trace: c } : null
    }
    if ((selection.kind === 'contact' || selection.kind === 'fault') && selection.traceId) {
      const list = selection.kind === 'fault' ? project.faults : project.contacts
      const owner = list.find((x) => x.id === selection.id)
      const tr = owner?.traces.find((t) => t.id === selection.traceId)
      return tr ? { kind: selection.kind, id: selection.id, traceId: tr.id, trace: tr } : null
    }
    return null
  }, [tool, selection, project])

  useEffect(() => {
    if (!editable) {
      setEdit(null)
      return
    }
    setEdit((prev) =>
      prev && prev.id === editable.id && prev.traceId === editable.traceId
        ? prev
        : {
            kind: editable.kind,
            id: editable.id,
            traceId: editable.traceId,
            nodes: nodesOf(editable.trace),
            activeIndex: -1,
          }
    )
  }, [editable])

  useEffect(() => {
    editRef.current = edit
  }, [edit])

  const editPreview = useMemo(
    () => (edit?.nodes?.length ? flattenNodes(edit.nodes, 6) : null),
    [edit]
  )

  const isDrawTool = ['contour', 'contact', 'fault'].includes(tool)
  const isTwoPointTool = ['scale', 'north', 'section', 'frame', 'scontour'].includes(tool)

  // Contornos estructurales dibujables: la misma lista alimenta el dibujo y la
  // prueba de impacto, así que lo que se ve es exactamente lo que se toca.
  const scItems = useMemo(
    () => (show.structureContours && scene?.ready ? structureContourItems(scene) : []),
    [scene, show.structureContours]
  )
  const scVisible = useMemo(
    () => scItems.filter((it) => it.kind !== 'fault' || show.faultStructureContours),
    [scItems, show.faultStructureContours]
  )

  // Ejes de pliegue: un cálculo aparte sobre los mismos dominios estructurales
  // que ya resuelve la escena, así que sólo se recalculan si cambia ésta.
  const foldAxes = useMemo(
    () => (show.foldAxes && scene?.ready ? computeFoldAxes(scene) : []),
    [scene, show.foldAxes]
  )

  const scDrawn = useMemo(
    () =>
      scDraft
        ? scVisible.map((it) => (it.key === scDraft.key ? { ...it, a: scDraft.pts[0], b: scDraft.pts[1] } : it))
        : scVisible,
    [scVisible, scDraft]
  )

  /** Contorno estructural más cercano al punto (en píxeles de imagen). */
  const scHit = useCallback(
    (p, tolPx = 14) => {
      const tol = tolPx / view.scale
      let best = null
      for (const it of scVisible) {
        const d = pointPolyline(p, [it.a, it.b]).d
        if (d <= tol && (!best || d < best.d)) best = { it, d }
      }
      return best
    },
    [scVisible, view.scale]
  )

  /**
   * Contornos que hay que fijar junto a uno dado: todos los de su cota en su
   * bloque. Al pasar una cota a manos del estudiante, sus contornos hermanos
   * —el otro limbo de un pliegue— tienen que quedarse donde estaban, porque un
   * contorno puesto a mano sustituye a lo calculado en toda esa cota.
   */
  const scFamily = useCallback(
    (it) =>
      scItems.filter(
        (s) =>
          s.kind === it.kind &&
          s.featureId === it.featureId &&
          s.block === it.block &&
          s.elevation === it.elevation &&
          !s.manualId
      ),
    [scItems]
  )

  /**
   * Fija el contorno calculado como dato del proyecto. Devuelve su id, para
   * poder seguir trabajando sobre él. `pts` permite fijarlo ya movido, de modo
   * que arrastrar deje un solo paso en el historial.
   */
  const materializeSc = useCallback(
    (it, pts = null) => {
      const update = (scId) => {
        if (pts) dispatch({ type: 'sc.update', kind: it.kind, id: it.featureId, scId, patch: { pts } })
        return scId
      }
      if (it.manualId) return update(it.manualId)
      // El contorno pudo fijarse hace un instante y venir este `it` de un
      // render anterior (dos toques seguidos en «+100», por ejemplo). Antes de
      // crear otro se busca el que ya ocupa su sitio: uno de la misma cota y
      // prácticamente encima, que sólo puede ser él.
      const list = it.kind === 'fault' ? project.faults : project.contacts
      const same = (list.find((f) => f.id === it.featureId)?.structureContours || []).filter(
        (x) => x.elevation === it.elevation
      )
      if (same.length) {
        const mid = (q) => [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2]
        const here = mid([it.a, it.b])
        const near = Math.max(dist(it.a, it.b) / 2, 20 / view.scale)
        let best = null
        for (const x of same) {
          const d = dist(here, mid(x.pts))
          if (d < near && (!best || d < best.d)) best = { x, d }
        }
        if (best) return update(best.x.id)
      }
      const family = scFamily(it)
      const i = family.findIndex((s) => s.key === it.key)
      if (i < 0) return null
      // Cada uno se fija tal como se ve, de modo que la curva no dé un salto al
      // pasar a ser un dato.
      const items = family.map((s, k) =>
        newStructureContour(s.elevation, k === i && pts ? pts : [s.a, s.b])
      )
      dispatch({ type: 'sc.add', kind: it.kind, id: it.featureId, items })
      return items[i].id
    },
    [scFamily, dispatch, project, view.scale]
  )

  const targets = useMemo(() => (tool === 'measure' ? snapTargets(project) : []), [tool, project])
  const measureRead = useMemo(() => reading(project, scene, measure), [project, scene, measure])
  // Al cambiar de herramienta la medida deja de tener sentido en pantalla.
  useEffect(() => {
    if (tool !== 'measure') setMeasure(null)
    if (openingMenu.current) {
      openingMenu.current = false
      return
    }
    setMenu(null)
  }, [tool])

  /** Recalcula el extremo de la regla a partir del puntero. */
  const traceMeasure = useCallback(
    (from, p) => {
      const tol = 14 / view.scale
      const end = measureEnd(targets, from, p, { snap: snapOn, tol })
      return { a: from ? from.at : p, b: end.at, anchor: from, end: end.on, orthogonal: end.orthogonal }
    },
    [targets, snapOn, view.scale]
  )

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
      measure,
      hover: cursor,
      modelViews,
      unitRaster,
      projected,
      foldAxes,
      edit: edit ? { ...edit, preview: editPreview } : null,
      scItems: scDrawn,
      width: size.width,
      height: size.height,
      dpr,
    })
  }, [view, project, scene, image, hillshade, show, selection, draft, measure, cursor, size, modelViews, unitRaster, projected, foldAxes, edit, editPreview, scDrawn])

  const toImg = useCallback((ev) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return toImagePt(view, [ev.clientX - rect.left, ev.clientY - rect.top])
  }, [view])

  /** Prueba de impacto: devuelve la entidad más cercana al punto. */
  const hitTest = useCallback(
    (p, tolPx = 16) => {
      const tol = tolPx / view.scale
      const layers = project.settings?.layers || {}
      const locked = (k) => layers[k]?.locked
      let best = null
      const consider = (cand, d) => {
        if (d <= tol && (!best || d < best.d)) best = { ...cand, d }
      }
      for (const m of project.models || []) consider({ kind: 'model', id: m.id }, dist(p, m.at))
      for (const w of project.wells) consider({ kind: 'well', id: w.id }, dist(p, w.at))
      for (const s of project.sections) {
        consider({ kind: 'section', id: s.id, handle: 'a' }, dist(p, s.a))
        consider({ kind: 'section', id: s.id, handle: 'b' }, dist(p, s.b))
        consider({ kind: 'section', id: s.id }, pointPolyline(p, [s.a, s.b]).d)
      }
      if (!locked('faults'))
        for (const f of project.faults)
          for (const tr of f.traces) consider({ kind: 'fault', id: f.id, traceId: tr.id }, pointPolyline(p, tr.pts).d)
      if (!locked('contacts'))
        for (const c of project.contacts)
          for (const tr of c.traces) consider({ kind: 'contact', id: c.id, traceId: tr.id }, pointPolyline(p, tr.pts).d)
      if (!locked('contours'))
        for (const c of project.contours) consider({ kind: 'contour', id: c.id }, pointPolyline(p, c.pts).d)
      // La imagen base va al final: sólo se selecciona si no hay nada encima.
      if (!best && project.image && !locked('image')) {
        const { width, height } = project.image
        if (p[0] >= 0 && p[1] >= 0 && p[0] <= width && p[1] <= height) best = { kind: 'image', d: tol }
      }
      return best
    },
    [project, view.scale]
  )

  const finishStroke = useCallback(
    (pts) => {
      setDraft(null)
      if (!pts || pts.length < 2) return
      // Trazo a mano: se adelgaza, se suaviza con Chaikin y sólo después se
      // simplifica, de modo que el resultado sigue el gesto sin el temblor.
      const thinned = thin(pts, 1.5 / view.scale)
      const smoothed = thinned.length >= 4 ? chaikin(thinned, 2) : thinned
      onStroke(simplify(smoothed, 0.9 / view.scale))
    },
    [onStroke, view.scale]
  )

  const commitDraft = useCallback(
    (pts) => {
      if (!pts || pts.length < 2) {
        setDraft(null)
        return
      }
      if (isTwoPointTool) {
        // En un arrastre continuo la polilínea trae muchos puntos: la escala,
        // el norte, el perfil y el marco se definen con el primero y el último.
        onTwoPoint(pts[0], pts[pts.length - 1])
        setDraft(null)
      } else finishStroke(pts)
    },
    [finishStroke, isTwoPointTool, onTwoPoint]
  )

  const commitNodes = useCallback(
    (nodes) => {
      const pts = flattenNodes(nodes, 6)
      if (pts.length < 2) return
      const target = editRef.current || edit
      if (!target) return
      if (target.kind === 'contour') {
        dispatch({ type: 'contour.update', id: target.id, patch: { pts, nodes } })
      } else {
        dispatch({
          type: 'trace.update',
          kind: target.kind,
          id: target.id,
          traceId: target.traceId,
          patch: { pts, nodes },
        })
      }
    },
    [edit, dispatch]
  )

  /**
   * Arrastre de un contorno estructural. El dato no se crea hasta que el gesto
   * se mueve de verdad (lo hace `onPointerMove`): un toque limpio sólo
   * selecciona.
   */
  const startScDrag = (it, p, handle) => {
    drag.current = {
      mode: 'sc',
      it,
      handle,
      a: it.a,
      b: it.b,
      origin: p,
      moved: false,
    }
  }

  // --- Gestos multitáctiles: doble toque con 2 dedos deshace, con 3 rehace ---
  const registerTapDown = (ev) => {
    const g = taps.current
    if (pointers.current.size === 1) {
      g.startedAt = performance.now()
      g.maxFingers = 1
      g.moved = false
      g.origins = new Map()
    }
    g.maxFingers = Math.max(g.maxFingers, pointers.current.size)
    g.origins.set(ev.pointerId, [ev.clientX, ev.clientY])
  }

  const registerTapMove = (ev) => {
    const g = taps.current
    const o = g.origins?.get(ev.pointerId)
    if (o && Math.hypot(ev.clientX - o[0], ev.clientY - o[1]) > 14) g.moved = true
  }

  /** Se evalúa cuando se levanta el último dedo. */
  const registerTapUp = () => {
    const g = taps.current
    if (g.moved || g.maxFingers < 2) return false
    const now = performance.now()
    if (now - g.startedAt > 320) return false
    if (now - g.lastAt < 480 && g.lastFingers === g.maxFingers) {
      g.lastAt = 0
      g.lastFingers = 0
      if (g.maxFingers === 2) {
        dispatch({ type: 'history.undo' })
        flash('Deshacer')
        return true
      }
      if (g.maxFingers >= 3) {
        dispatch({ type: 'history.redo' })
        flash('Rehacer')
        return true
      }
    }
    g.lastAt = now
    g.lastFingers = g.maxFingers
    return false
  }

  const flash = (text) => {
    setGestureHint(text)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setGestureHint(null), 900)
  }

  /** Rasgo (o contorno estructural) más cercano al punto, para el menú de opciones. */
  const findMenuTarget = useCallback(
    (p, tolPx) => {
      const hitNow = hitTest(p, tolPx)
      const scNow = scHit(p, tolPx)
      const target = scNow && (!hitNow || scNow.d < hitNow.d) ? { kind: 'sc', it: scNow.it } : hitNow
      return target && MENU_KINDS.includes(target.kind) ? target : null
    },
    [hitTest, scHit]
  )

  const openMenuFor = useCallback(
    (target, at) => {
      openingMenu.current = true
      if (target.kind === 'sc') onEditRequest?.(scSelection(target.it))
      else if (['contact', 'fault', 'contour'].includes(target.kind)) onEditRequest?.(target)
      setMenu({ at, hit: target })
    },
    [onEditRequest]
  )

  // --- Punteros ---
  const onPointerDown = (ev) => {
    const canvas = canvasRef.current
    canvas.setPointerCapture(ev.pointerId)
    const p = toImg(ev)

    // Clic secundario del ratón: el equivalente de escritorio a la pulsación
    // larga en tablet. Abre el menú del rasgo al instante y no hace nada más
    // con el clic —ni selecciona, ni dibuja, ni navega—.
    if (ev.button === 2) {
      const target = findMenuTarget(p, touchTol(ev, 16))
      if (target) {
        const rect = canvas.getBoundingClientRect()
        openMenuFor(target, [ev.clientX - rect.left, ev.clientY - rect.top])
      }
      return
    }

    pointers.current.set(ev.pointerId, ev)
    registerTapDown(ev)

    // Pulsación larga sobre una línea: entra en edición de vértices y despliega
    // el menú del rasgo. Es la vía natural en tablet, donde no hay clic derecho
    // ni teclas: ahí caben la reasignación de unidades, la cinemática de una
    // falla, la cota de una curva y el borrado.
    clearTimeout(holdTimer.current)
    if (!['erase', 'measure'].includes(tool) && pointers.current.size === 1) {
      const target = findMenuTarget(p, touchTol(ev, 18))
      if (target) {
        const rect = canvas.getBoundingClientRect()
        const at = [ev.clientX - rect.left, ev.clientY - rect.top]
        holdTimer.current = setTimeout(() => {
          if (drag.current?.stroke) return // se convirtió en trazo: no interrumpir
          drag.current = null
          setDraft(null)
          openMenuFor(target, at)
          flash('Opciones')
        }, 550)
      }
    }

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const rect = canvas.getBoundingClientRect()
      gesture.current = {
        d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        c0: [(a.clientX + b.clientX) / 2 - rect.left, (a.clientY + b.clientY) / 2 - rect.top],
        view0: { ...view },
      }
      drag.current = null
      return
    }

    // Con el dedo en modo lápiz se navega, pero un toque limpio selecciona:
    // por eso el arrastre queda "pendiente" hasta que se mueve de verdad.
    const fingerNav = penOnly && ev.pointerType === 'touch'
    const navigating = tool === 'pan' || fingerNav || ev.button === 1 || ev.shiftKey
    if (navigating) {
      drag.current = {
        mode: 'pan',
        x: ev.clientX,
        y: ev.clientY,
        view0: { ...view },
        tapCandidate: fingerNav || tool === 'pan',
        at: p,
      }
      return
    }

    if (tool === 'erase') {
      const hit = hitTest(p, touchTol(ev, 16))
      // Sólo se borran los contornos puestos a mano: los calculados no son un
      // dato que quitar, sino el resultado del ajuste.
      const sc = scHit(p, touchTol(ev, 14))
      if (sc?.it.manualId && (!hit || sc.d < hit.d)) {
        dispatch({ type: 'sc.delete', kind: sc.it.kind, id: sc.it.featureId, scId: sc.it.manualId })
        return
      }
      if (hit && hit.kind !== 'image') deleteHit(hit, dispatch)
      return
    }

    if (tool === 'measure') {
      // Segundo toque: cierra la medida que quedó esperando extremo.
      if (measure?.pending) {
        setMeasure({ ...traceMeasure(measure.anchor, p), pending: false })
        return
      }
      const anchor = snapOn ? snapToLines(targets, p, touchTol(ev, 14) / view.scale) : null
      const from = anchor || { at: p, dir: null }
      setMeasure({ ...traceMeasure(from, p), pending: true })
      drag.current = { mode: 'measure', from, origin: p }
      return
    }

    if (tool === 'select') {
      // Primero los nodos del trazo en edición.
      if (edit?.nodes?.length) {
        const h = hitTestNodes(edit.nodes, p, touchTol(ev, 12) / view.scale, edit.activeIndex)
        if (h?.type === 'node' || h?.type === 'hIn' || h?.type === 'hOut') {
          drag.current = { mode: 'nodes', kind: h.type, index: h.index }
          setEdit((e) => {
            const next = { ...e, activeIndex: h.index }
            editRef.current = next
            return next
          })
          return
        }
        if (h?.type === 'segment') {
          const nodes = insertNode(edit.nodes, h.index, h.t)
          const next = { ...edit, nodes, activeIndex: h.index + 1 }
          editRef.current = next
          setEdit(next)
          commitNodes(nodes)
          drag.current = { mode: 'nodes', kind: 'node', index: h.index + 1 }
          return
        }
      }
      // Manijas del contorno estructural seleccionado: mandan sobre todo lo
      // demás, porque suelen caer justo encima de las trazas.
      const tolSc = touchTol(ev, 14) / view.scale
      if (selection?.kind === 'sc') {
        const cur = scVisible.find((x) => x.key === selection.key) || selection.it
        if (cur) {
          const handle = dist(p, cur.a) <= tolSc ? 'a' : dist(p, cur.b) <= tolSc ? 'b' : null
          if (handle) {
            startScDrag(cur, p, handle)
            return
          }
        }
      }
      const hit = hitTest(p, touchTol(ev, 16))
      const sc = scHit(p, touchTol(ev, 14))
      if (sc && (!hit || sc.d < hit.d)) {
        onPick(scSelection(sc.it))
        startScDrag(sc.it, p, 'move')
        return
      }
      onPick(hit)
      if (hit?.kind === 'well') drag.current = { mode: 'well', id: hit.id }
      else if (hit?.kind === 'model') drag.current = { mode: 'model', id: hit.id }
      else if (hit?.kind === 'section' && hit.handle) drag.current = { mode: 'section', id: hit.id, handle: hit.handle }
      return
    }

    if (tool === 'well' || tool === 'model' || tool === 'piercing') {
      onTapPoint(p)
      return
    }

    if (isDrawTool || isTwoPointTool) {
      // Trazo híbrido: si el puntero se mueve, es un trazo continuo; si se
      // levanta sin moverse, es un vértice más de la polilínea en curso.
      drag.current = {
        mode: 'compose',
        pts: [p],
        origin: p,
        stroke: false,
        hadDraft: Boolean(draft?.pts?.length),
      }
      setDraft((d) => ({ pts: [...(d?.pts || []), p], cursor: p, color: draftColor(tool) }))
    }
  }

  const onPointerMove = (ev) => {
    if (pointers.current.has(ev.pointerId)) pointers.current.set(ev.pointerId, ev)
    registerTapMove(ev)
    if (holdTimer.current && drag.current?.stroke !== false) clearTimeout(holdTimer.current)
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
    if (!d) {
      // Sin botón pulsado, la regla sigue el cursor hasta que se fija el extremo.
      if (tool === 'measure' && measure?.pending) setMeasure({ ...traceMeasure(measure.anchor, p), pending: true })
      return
    }
    if (d.mode === 'measure') {
      setMeasure({ ...traceMeasure(d.from, p), pending: true })
      return
    }
    if (d.mode === 'pan') {
      const moved = Math.hypot(ev.clientX - d.x, ev.clientY - d.y)
      if (moved > 6) d.tapCandidate = false
      setView({ ...d.view0, tx: d.view0.tx + (ev.clientX - d.x), ty: d.view0.ty + (ev.clientY - d.y) })
    } else if (d.mode === 'compose') {
      if (!d.stroke && dist(p, d.origin) * view.scale > 7) d.stroke = true
      if (d.stroke) {
        d.pts.push(p)
        setDraft((prev) => {
          const base = prev?.pts ? prev.pts.slice(0, prev.pts.length - (d.drawn || 0)) : []
          d.drawn = d.pts.length - 1
          return { pts: [...base, ...d.pts.slice(1)], color: draftColor(tool) }
        })
      } else {
        setDraft((prev) => (prev ? { ...prev, cursor: p } : prev))
      }
    } else if (d.mode === 'nodes') {
      const e = editRef.current
      if (!e?.nodes) return
      const nodes = d.kind === 'node' ? moveNode(e.nodes, d.index, p) : moveHandle(e.nodes, d.index, d.kind, p)
      const next = { ...e, nodes }
      editRef.current = next
      setEdit(next)
    } else if (d.mode === 'sc') {
      const dx = p[0] - d.origin[0]
      const dy = p[1] - d.origin[1]
      // Sin haberse movido de verdad no se toca nada: así un toque limpio sobre
      // un contorno lo selecciona sin convertirlo en dato.
      if (!d.moved && Math.hypot(dx, dy) * view.scale < 4) return
      d.moved = true
      d.pts =
        d.handle === 'a' ? [p, d.b] : d.handle === 'b' ? [d.a, p] : [shift(d.a, dx, dy), shift(d.b, dx, dy)]
      setScDraft({ key: d.it.key, pts: d.pts })
    } else if (d.mode === 'well') {
      dispatch({ type: 'well.update', id: d.id, patch: { at: p } })
    } else if (d.mode === 'model') {
      dispatch({ type: 'model.update', id: d.id, patch: { at: p } })
    } else if (d.mode === 'section') {
      dispatch({ type: 'section.update', id: d.id, patch: { [d.handle]: p } })
    }
  }

  const endPointer = (ev) => {
    clearTimeout(holdTimer.current)
    pointers.current.delete(ev.pointerId)
    if (pointers.current.size < 2) gesture.current = null
    const d = drag.current
    drag.current = null
    if (pointers.current.size === 0 && registerTapUp()) {
      setDraft(null)
      return
    }
    if (!d) return

    if (d.mode === 'pan' && d.tapCandidate) {
      // Toque limpio con el dedo: selecciona en vez de navegar. La tolerancia
      // es mayor que con el lápiz porque el dedo apunta con menos precisión.
      const hit = hitTest(d.at, 30)
      onPick(hit)
      return
    }
    if (d.mode === 'sc') {
      setScDraft(null)
      if (d.moved && d.pts) materializeSc(d.it, d.pts)
      return
    }
    if (d.mode === 'nodes') {
      // El guardado va aquí y no dentro de `setEdit`: un despacho dentro de un
      // actualizador se repite con cada repintado y llenaba el historial.
      if (editRef.current?.nodes) commitNodes(editRef.current.nodes)
      return
    }
    if (d.mode === 'measure') {
      const p = toImg(ev)
      // Un arrastre deja la medida hecha; un toque limpio deja el extremo
      // pendiente, para poder fijarlo con un segundo toque en la tablet.
      const moved = dist(p, d.origin) * view.scale > 6
      setMeasure({ ...traceMeasure(d.from, p), pending: !moved })
      return
    }
    if (d.mode === 'compose') {
      const p = toImg(ev)
      if (d.stroke) {
        const pts = [...d.pts]
        // Un trazo continuo suelto equivale a un rasgo completo; si ya había
        // vértices puestos a mano, se añade y el trazo sigue abierto.
        setDraft((prev) => {
          const all = prev?.pts || pts
          if (!d.hadDraft) {
            commitDraft(all)
            return null
          }
          return { ...prev, pts: all }
        })
      } else if (isTwoPointTool) {
        setDraft((prev) => {
          const pts = prev?.pts || []
          if (pts.length >= 2) {
            onTwoPoint(pts[0], pts[pts.length - 1])
            return null
          }
          return prev
        })
      } else {
        setDraft((prev) => (prev ? { ...prev, cursor: p } : prev))
      }
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
          onTwoPoint(draft.pts[0], draft.pts[draft.pts.length - 1])
          setDraft(null)
        } else finishStroke(draft.pts)
      }
      if (e.key === 'Escape') {
        setDraft(null)
        setMeasure(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draft, finishStroke, isTwoPointTool, onTwoPoint])

  const canFinish = draft?.pts?.length >= 2
  const activeNode = edit?.nodes?.[edit.activeIndex]

  const applyNodes = (nodes, activeIndex = edit.activeIndex) => {
    const next = { ...edit, nodes, activeIndex }
    editRef.current = next
    setEdit(next)
    commitNodes(nodes)
  }

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
        <div className="pointer-events-auto absolute bottom-6 left-1/2 flex -translate-x-1/2 gap-2">
          <button
            className="rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg active:scale-95"
            onClick={() => commitDraft(draft.pts)}
          >
            Terminar trazo
          </button>
          <button
            className="rounded-full bg-slate-700 px-4 py-3 text-sm font-semibold text-white shadow-lg active:scale-95"
            onClick={() => setDraft((d) => (d?.pts?.length > 1 ? { ...d, pts: d.pts.slice(0, -1) } : null))}
          >
            Quitar vértice
          </button>
          <button
            className="rounded-full bg-slate-500 px-4 py-3 text-sm font-semibold text-white shadow-lg active:scale-95"
            onClick={() => setDraft(null)}
          >
            Cancelar
          </button>
        </div>
      )}

      {activeNode && !canFinish && (
        <div className="pointer-events-auto absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-900/90 px-2 py-1.5 text-xs font-medium text-white shadow-lg">
          <span className="px-2 text-slate-300">
            Nodo {edit.activeIndex + 1}/{edit.nodes.length}
          </span>
          <button
            className="rounded-full bg-white/15 px-3 py-1.5 hover:bg-white/25"
            onClick={() => applyNodes(toggleCorner(edit.nodes, edit.activeIndex))}
          >
            Suave / pico
          </button>
          <button
            className="rounded-full bg-rose-500/90 px-3 py-1.5 hover:bg-rose-500"
            onClick={() => {
              const nodes = removeNode(edit.nodes, edit.activeIndex)
              applyNodes(nodes, -1)
            }}
          >
            Borrar nodo
          </button>
          <button
            className="rounded-full bg-white/15 px-3 py-1.5 hover:bg-white/25"
            onClick={() => {
              const next = { ...edit, activeIndex: -1 }
              editRef.current = next
              setEdit(next)
            }}
          >
            Listo
          </button>
        </div>
      )}

      {tool === 'measure' && (
        <div className="pointer-events-auto absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-slate-900/90 px-3 py-2 text-white shadow-lg">
          <button
            onClick={() => setSnapOn((v) => !v)}
            title="Pega los extremos a las trazas y mide perpendicular a la traza anclada"
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              snapOn ? 'bg-emerald-500 text-white' : 'bg-white/15 text-slate-200 hover:bg-white/25'
            }`}
          >
            Imán {snapOn ? 'activo' : 'apagado'}
          </button>
          {measureRead ? (
            <div className="flex items-baseline gap-2 px-1 text-xs">
              <span className="font-mono text-base font-semibold">
                {measureRead.calibrated ? fmtDistance(measureRead.meters) : `${measureRead.pixels.toFixed(0)} px`}
              </span>
              {measureRead.azimuth != null && (
                <span className="text-slate-300">{strikeQuadrant(measureRead.azimuth)}</span>
              )}
              {measure?.orthogonal && (
                <span className="rounded bg-emerald-500/25 px-1.5 py-0.5 text-[10px] text-emerald-200">
                  ⊥ {measure.anchor?.name || 'traza'}
                </span>
              )}
              {measureRead.thickness && (
                <span className="text-amber-200">
                  espesor ≈ {fmtDistance(measureRead.thickness.value)} (sen {measureRead.thickness.dip.toFixed(0)}°)
                </span>
              )}
            </div>
          ) : (
            <span className="px-1 text-xs text-slate-300">Arrastra sobre el mapa para medir</span>
          )}
          {measure && (
            <button
              onClick={() => setMeasure(null)}
              className="rounded-full bg-white/15 px-3 py-1.5 text-xs hover:bg-white/25"
            >
              Limpiar
            </button>
          )}
        </div>
      )}

      {menu && (
        <MapMenu
          at={menu.at}
          hit={menu.hit}
          project={project}
          dispatch={dispatch}
          size={size}
          onClose={() => setMenu(null)}
          onAddSc={(target) => onAddScRequest?.(target)}
          onSelect={(it) => {
            const id = materializeSc(it)
            if (id) onPick({ ...scSelection(it), manualId: id })
            return id
          }}
        />
      )}

      {gestureHint && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-slate-900/85 px-6 py-3 text-lg font-semibold text-white shadow-2xl">
          {gestureHint}
        </div>
      )}

      {status && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-slate-900/85 px-4 py-1.5 text-xs font-medium text-white shadow">
          {status}
        </div>
      )}

      {selection?.kind === 'sc' && !edit && (
        <div className="pointer-events-none absolute left-1/2 top-12 -translate-x-1/2 rounded-full bg-sky-900/80 px-3 py-1 text-[11px] text-sky-50 shadow">
          Contorno estructural {selection.elevation} m · arrastra sus extremos para corregirlo
        </div>
      )}

      {edit && !activeNode && (
        <div className="pointer-events-none absolute left-1/2 top-12 -translate-x-1/2 rounded-full bg-sky-900/80 px-3 py-1 text-[11px] text-sky-50 shadow">
          Arrastra un nodo para moverlo · toca la línea para añadir uno
        </div>
      )}
    </div>
  )
}

/** Rasgos que abren menú con una pulsación larga. */
const MENU_KINDS = ['contact', 'fault', 'contour', 'section', 'well', 'model', 'sc']

/** Selección de un contorno estructural, con lo justo para volver a encontrarlo. */
function scSelection(it) {
  return {
    kind: 'sc',
    key: it.key,
    id: it.featureId,
    featureKind: it.kind,
    elevation: it.elevation,
    manualId: it.manualId,
    it,
  }
}

const shift = (p, dx, dy) => [p[0] + dx, p[1] + dy]

/** El dedo apunta con menos precisión que el lápiz: se le da más margen. */
function touchTol(ev, base) {
  return ev?.pointerType === 'touch' ? base * 1.9 : base
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
  if (tool === 'scontour') return '#0284c7'
  return '#0f172a'
}

function deleteHit(hit, dispatch) {
  if (hit.kind === 'contour') dispatch({ type: 'contour.delete', id: hit.id })
  else if (hit.kind === 'contact') dispatch({ type: 'trace.delete', kind: 'contact', id: hit.id, traceId: hit.traceId })
  else if (hit.kind === 'fault') dispatch({ type: 'trace.delete', kind: 'fault', id: hit.id, traceId: hit.traceId })
  else if (hit.kind === 'section') dispatch({ type: 'section.delete', id: hit.id })
  else if (hit.kind === 'well') dispatch({ type: 'well.delete', id: hit.id })
  else if (hit.kind === 'model') dispatch({ type: 'model.delete', id: hit.id })
}
