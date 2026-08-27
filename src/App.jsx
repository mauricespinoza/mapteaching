import { useCallback, useDeferredValue, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  Undo2,
  Redo2,
  Upload,
  Download,
  FilePlus2,
  FolderOpen,
  Sparkles,
  Map as MapIcon,
  Spline,
  Boxes,
  Crosshair,
  Layers,
  Table,
  BookOpen,
  Image as ImageIcon,
  Layers3,
  Trash2,
  Mountain,
  RefreshCw,
  Maximize2,
  Minimize2,
  Menu,
  Waves,
  Tag,
  PenLine,
  Contrast,
  Type,
  Compass,
  Palette,
  Frame,
} from 'lucide-react'
import { watchForUpdate, reloadToLatest } from './lib/version.js'
import Toolbar, { TOOLS } from './components/Toolbar.jsx'
import MapView from './components/MapView.jsx'
import SectionView from './components/SectionView.jsx'
import ThreeView from './components/ThreeView.jsx'
import WellView from './components/WellView.jsx'
import LayersPanel from './components/LayersPanel.jsx'
import ResultsPanel from './components/ResultsPanel.jsx'
import HelpPanel from './components/HelpPanel.jsx'
import ModelPanel from './components/ModelPanel.jsx'
import { Modal, Field, inputCls, Btn } from './components/ui.jsx'
import { FaultIcon } from './components/icons.jsx'
import { reducer, initialState } from './lib/store.js'
import { newProject, newSection, newWell, newStructureContour, uid, countVertices } from './lib/model.js'
import { buildScene } from './lib/scene.js'
import { buildSampleProject } from './lib/sample.js'
import { buildModelViews, newStructuralModel } from './lib/models.js'
import { buildUnitRaster } from './lib/geomap.js'
import { dist, norm, sub } from './lib/geom.js'
import * as db from './lib/db.js'
import { downloadText, downloadCanvasPng } from './lib/exportFile.js'
import { fmtDistance } from './lib/georef.js'

/**
 * Interruptores de capa de la barra del mapa. Van como iconos: en tablet los
 * rótulos de texto ocupaban dos filas enteras y se comían el mapa. El nombre
 * queda en el `title` y en el rótulo accesible.
 */
const LAYER_TOGGLES = [
  { k: 'contours', label: 'Curvas de nivel', icon: Waves },
  { k: 'contourLabels', label: 'Cotas de las curvas', icon: Tag },
  { k: 'contacts', label: 'Contactos', icon: PenLine },
  { k: 'faults', label: 'Fallas', icon: FaultIcon },
  { k: 'structureContours', label: 'Contornos estructurales', icon: Contrast },
  { k: 'structureLabels', label: 'Rótulos de los contornos', icon: Type },
  { k: 'faultStructureContours', label: 'Contornos estructurales de las fallas', icon: FaultIcon },
  { k: 'attitudes', label: 'Rumbo y manteo', icon: Compass },
  { k: 'sections', label: 'Trazas de perfil', icon: Spline },
  { k: 'wells', label: 'Pozos', icon: Crosshair },
  { k: 'hillshade', label: 'Relieve sombreado', icon: Mountain },
  { k: 'unitFill', label: 'Relleno de unidades', icon: Palette },
  { k: 'models', label: 'Modelos sintéticos', icon: Layers3 },
]

/** Flechas del teclado → dirección de desplazamiento del mapa. */
const ARROWS = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

const DEFAULT_SHOW = {
  contours: true,
  contourLabels: true,
  contacts: true,
  faults: true,
  structureContours: true,
  structureLabels: true,
  faultStructureContours: false,
  attitudes: true,
  sections: true,
  wells: true,
  hillshade: true,
  models: true,
  unitFill: true,
  onlySelectedSC: false,
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(newProject()))
  const project = state.present
  const deferredProject = useDeferredValue(project)
  const [recalcNonce, setRecalcNonce] = useState(0)
  // recalcNonce fuerza un recálculo completo desde el botón «Recalcular».
  const scene = useMemo(
    () => buildScene(deferredProject),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deferredProject, recalcNonce]
  )
  const modelViews = useMemo(() => buildModelViews(deferredProject, scene), [deferredProject, scene])
  const [show, setShow] = useState(DEFAULT_SHOW)
  // El relleno geológico recorre una grilla evaluando cada contacto, así que
  // sólo se calcula cuando la capa está encendida.
  const unitRaster = useMemo(
    () => (show.unitFill ? buildUnitRaster(scene) : null),
    [scene, show.unitFill]
  )

  const [tab, setTab] = useState('mapa')
  const [panel, setPanel] = useState('capas')
  const [panelOpen, setPanelOpen] = useState(true)
  // Versión nueva desplegada mientras la pestaña estaba abierta: se avisa, no se
  // recarga sola (a media clase, perder el ejercicio sería peor que la versión
  // vieja; el proyecto está guardado, pero el aviso deja decidir cuándo).
  const [updateReady, setUpdateReady] = useState(false)
  useEffect(() => watchForUpdate(() => setUpdateReady(true)), [])
  const [tool, setTool] = useState('pan')
  const [fullscreen, setFullscreen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [penOnly, setPenOnly] = useState(true)
  const [selection, setSelection] = useState(null)
  const [activeIds, setActiveIds] = useState({ contact: null, fault: null })
  // Rasgo al que se añade el próximo contorno estructural dibujado a mano.
  const [scTarget, setScTarget] = useState(null)
  const [view, setView] = useState(null)
  const [sectionId, setSectionId] = useState(null)
  const [wellId, setWellId] = useState(null)
  const [image, setImage] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [lastModelKind, setLastModelKind] = useState('fold')
  const [lastScZ, setLastScZ] = useState(null)
  const [projects, setProjects] = useState([])
  const [booted, setBooted] = useState(false)
  const mapCanvasRef = useRef(null)
  const fileRef = useRef(null)
  const projectFileRef = useRef(null)

  // --- Arranque: último proyecto guardado, o ejercicio de ejemplo ---
  useEffect(() => {
    ;(async () => {
      try {
        const list = await db.listProjects()
        if (list.length) dispatch({ type: 'project.load', project: list[0] })
        else {
          const { project: sample } = buildSampleProject()
          await db.saveProject(sample)
          dispatch({ type: 'project.load', project: sample })
        }
      } catch {
        const { project: sample } = buildSampleProject()
        dispatch({ type: 'project.load', project: sample })
      } finally {
        setBooted(true)
      }
    })()
  }, [])

  // --- Autoguardado ---
  useEffect(() => {
    if (!booted) return
    const t = setTimeout(() => {
      db.saveProject(project).catch(() => {})
    }, 700)
    return () => clearTimeout(t)
  }, [project, booted])

  // --- Imagen base ---
  useEffect(() => {
    let cancelled = false
    if (!project.image?.blobId) {
      setImage(null)
      return undefined
    }
    db.getBlob(project.image.blobId)
      .then((b) => (b ? db.loadImageFromBlob(b) : null))
      .then((r) => {
        if (r && !cancelled) setImage(r.img)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [project.image?.blobId])

  useEffect(() => {
    if (!sectionId && project.sections.length) setSectionId(project.sections[0].id)
  }, [project.sections, sectionId])

  // El rasgo elegido desde el menú sólo vale para el contorno que se va a trazar.
  useEffect(() => {
    if (tool !== 'scontour') setScTarget(null)
  }, [tool])

  /**
   * Borra el rasgo seleccionado. De un contacto o una falla borra la traza
   * elegida, no el rasgo entero: es lo que se ha seleccionado en el mapa, y el
   * menú de opciones sigue estando para borrarlo completo. Devuelve si hubo
   * algo que borrar.
   */
  const deleteSelection = useCallback(() => {
    const sel = selection
    if (!sel) return false
    if (sel.kind === 'contour') dispatch({ type: 'contour.delete', id: sel.id })
    else if (sel.kind === 'contact' && sel.traceId)
      dispatch({ type: 'trace.delete', kind: 'contact', id: sel.id, traceId: sel.traceId })
    else if (sel.kind === 'fault' && sel.traceId)
      dispatch({ type: 'trace.delete', kind: 'fault', id: sel.id, traceId: sel.traceId })
    else if (sel.kind === 'section') dispatch({ type: 'section.delete', id: sel.id })
    else if (sel.kind === 'well') dispatch({ type: 'well.delete', id: sel.id })
    else if (sel.kind === 'model') dispatch({ type: 'model.delete', id: sel.id })
    else if (sel.kind === 'sc') {
      // Un contorno calculado no es un dato que borrar, sino el resultado del
      // ajuste: sólo se quitan los puestos a mano.
      if (!sel.manualId) return false
      dispatch({ type: 'sc.delete', kind: sel.featureKind, id: sel.id, scId: sel.manualId })
    } else return false
    setSelection(null)
    return true
  }, [selection])

  /**
   * Desplaza el mapa. El paso es una fracción del lienzo, no un número fijo de
   * píxeles del mapa: así se recorre igual de rápido esté como esté el zoom.
   */
  const panBy = useCallback(
    (dx, dy, big = false) => {
      setView((v) => {
        const base = v || fitView(project.image || project.virtualSize || { width: 1200, height: 900 })
        const el = mapCanvasRef.current
        const w = el?.clientWidth || 800
        const h = el?.clientHeight || 600
        const step = big ? 0.25 : 0.08
        return { ...base, tx: base.tx - dx * w * step, ty: base.ty - dy * h * step }
      })
    },
    [project.image, project.virtualSize]
  )

  // --- Atajos ---
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'history.redo' : 'history.undo' })
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        dispatch({ type: 'history.redo' })
        return
      }
      // Supr / Del borra lo que esté seleccionado: en el computador es lo que
      // se espera, y ahorra ir a buscar la goma o el menú.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (deleteSelection()) e.preventDefault()
        return
      }
      // Flechas: desplazan el mapa. Un paso corto, o un cuarto de pantalla con
      // Mayúsculas, que es lo que se espera al recorrer una lámina grande.
      const arrow = ARROWS[e.key]
      if (arrow && tab === 'mapa') {
        e.preventDefault()
        panBy(arrow[0], arrow[1], e.shiftKey)
        return
      }
      const found = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase())
      if (found && !e.ctrlKey && !e.metaKey) setTool(found.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deleteSelection, panBy, tab])

  // El «modo enfoque» es propio: oculta la interfaz y deja el mapa a pantalla
  // completa por CSS. Se intenta además la pantalla completa del navegador,
  // pero no se depende de ella —en iPad no existe y en escritorio se sale sola
  // con Esc o con ciertos gestos, que era justo lo que rompía el modo.
  const toggleFullscreen = useCallback(() => {
    setFullscreen((on) => {
      const next = !on
      try {
        if (next && !document.fullscreenElement) document.documentElement.requestFullscreen?.()
        else if (!next && document.fullscreenElement) document.exitFullscreen?.()
      } catch {
        // Sin permiso del navegador: el modo enfoque funciona igual.
      }
      return next
    })
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && fullscreen) setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  const mapRect = project.image || project.virtualSize || { width: 1200, height: 900 }

  // --- Acciones de dibujo ---
  const onStroke = useCallback(
    (pts) => {
      if (tool === 'contour') setDialog({ kind: 'contour', pts, elevation: project.settings.lastElevation })
      else if (tool === 'contact') {
        const id = activeIds.contact || project.contacts[0]?.id
        if (!id) {
          setDialog({ kind: 'info', text: 'Crea primero al menos dos unidades para tener un contacto que digitalizar.' })
          return
        }
        dispatch({ type: 'trace.add', kind: 'contact', id, pts })
      } else if (tool === 'fault') {
        let id = activeIds.fault || project.faults[0]?.id
        if (!id) {
          const f = { ...newFaultLocal(project) }
          dispatch({ type: 'fault.add', fault: f })
          id = f.id
          setActiveIds((s) => ({ ...s, fault: id }))
        }
        dispatch({ type: 'trace.add', kind: 'fault', id, pts })
      }
    },
    [tool, activeIds, project]
  )

  const onTwoPoint = useCallback(
    (a, b) => {
      if (tool === 'scale') {
        setDialog({ kind: 'scale', a, b, meters: 1000 })
      } else if (tool === 'north') {
        dispatch({ type: 'georef', patch: { northVec: norm(sub(b, a)), northLine: { a, b } } })
      } else if (tool === 'frame') {
        dispatch({ type: 'patch', patch: { frame: { a, b } } })
        setTool('select')
      } else if (tool === 'section') {
        const s = newSection(project, a, b)
        dispatch({ type: 'section.add', section: s })
        setSectionId(s.id)
      } else if (tool === 'scontour') {
        const target =
          scTarget ||
          (activeIds.contact && { kind: 'contact', id: activeIds.contact }) ||
          (project.contacts[0] && { kind: 'contact', id: project.contacts[0].id })
        if (!target) {
          setDialog({
            kind: 'info',
            text: 'Un contorno estructural pertenece a una superficie: crea antes un contacto o una falla.',
          })
          return
        }
        setDialog({
          kind: 'scontour',
          a,
          b,
          target,
          elevation: lastScZ ?? project.settings.lastElevation ?? 0,
        })
      }
    },
    [tool, project, activeIds, scTarget, lastScZ]
  )

  const onTapPoint = useCallback(
    (p) => {
      if (tool === 'model') {
        const m = newStructuralModel(lastModelKind, p, (project.models || []).length)
        dispatch({ type: 'model.add', model: m })
        setSelection({ kind: 'model', id: m.id })
        setPanel('modelos')
        setTool('select')
        return
      }
      if (tool === 'well') {
        const w = newWell(project, p)
        dispatch({ type: 'well.add', well: w })
        setWellId(w.id)
        setSelection({ kind: 'well', id: w.id })
        setTool('select')
      }
    },
    [tool, project, lastModelKind]
  )

  // --- Archivos ---
  const importImage = async (file) => {
    if (!file) return
    const blobId = uid('img')
    await db.putBlob(blobId, file)
    const { img } = await db.loadImageFromBlob(file)
    dispatch({
      type: 'patch',
      patch: {
        image: { blobId, width: img.width, height: img.height, name: file.name },
        virtualSize: null,
      },
    })
    // La escala del lienzo virtual no sirve para la imagen importada.
    dispatch({ type: 'georef', patch: { metersPerPx: null, scaleLine: null } })
    setView(null)
    setTool('scale')
  }

  const deleteImage = () => {
    const rect = project.image
    // El lienzo hereda el tamaño de la imagen: así la escala y todo lo
    // digitalizado siguen coincidiendo tras quitarla.
    dispatch({
      type: 'patch',
      patch: {
        image: null,
        virtualSize: rect ? { width: rect.width, height: rect.height } : { width: 1400, height: 1000 },
      },
    })
    if (rect?.blobId) db.deleteBlob(rect.blobId).catch(() => {})
    setSelection(null)
    setDialog(null)
  }

  const exportProject = async () => {
    const copy = JSON.parse(JSON.stringify(project))
    if (project.image?.blobId) {
      const blob = await db.getBlob(project.image.blobId)
      if (blob) copy.image = { ...copy.image, dataUrl: await db.blobToDataUrl(blob) }
    }
    downloadText(`${project.name.replace(/[^\w\-]+/g, '_')}.mapteaching.json`, JSON.stringify(copy, null, 1))
  }

  const importProject = async (file) => {
    const text = await file.text()
    const data = JSON.parse(text)
    if (data.image?.dataUrl) {
      const blob = await db.dataUrlToBlob(data.image.dataUrl)
      const blobId = uid('img')
      await db.putBlob(blobId, blob)
      data.image = { ...data.image, blobId, dataUrl: undefined }
    }
    data.id = data.id || uid('proj')
    await db.saveProject(data)
    dispatch({ type: 'project.load', project: data })
    setView(null)
  }

  const openProjects = async () => {
    setProjects(await db.listProjects())
    setDialog({ kind: 'projects' })
  }

  const loadSample = async () => {
    const { project: sample } = buildSampleProject()
    await db.saveProject(sample)
    dispatch({ type: 'project.load', project: sample })
    setView(null)
    setSectionId(sample.sections[0]?.id || null)
  }

  const startNew = async () => {
    const p = newProject()
    await db.saveProject(p)
    dispatch({ type: 'project.load', project: p })
    setView(null)
    setTool('pan')
  }

  const section = project.sections.find((s) => s.id === sectionId) || project.sections[0] || null
  const status = statusText(tool, project, activeIds, scene, scTarget)

  return (
    <div className="flex h-full w-full flex-col bg-slate-100 text-slate-900">
      {updateReady && (
        <div className="flex items-center justify-center gap-2 bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white">
          Hay una versión nueva de MapTeaching.
          <button
            className="rounded-md bg-white/20 px-2 py-0.5 font-semibold hover:bg-white/30"
            onClick={reloadToLatest}
          >
            Actualizar
          </button>
        </div>
      )}
      {/* Barra superior */}
      <header
        className={`${fullscreen ? 'hidden' : 'flex'} flex-wrap items-center gap-2 border-b border-slate-800/10 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-3 py-2 text-slate-100 shadow-sm`}
      >
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-emerald-400 text-slate-900 shadow">
            <Mountain size={18} strokeWidth={2.4} />
          </span>
          <span className="hidden text-[15px] font-bold tracking-tight sm:block">
            Map<span className="text-sky-400">Teaching</span>
          </span>
        </div>
        <input
          className="w-40 rounded-lg border border-white/10 bg-white/10 px-2.5 py-1.5 text-sm font-medium text-white placeholder-slate-400 outline-none transition focus:border-sky-400/60 focus:bg-white/15 md:w-64"
          value={project.name}
          placeholder="Nombre del ejercicio"
          onChange={(e) => dispatch({ type: 'patch', patch: { name: e.target.value } })}
        />
        <div className="flex items-center gap-1">
          <Btn variant="onDark" onClick={() => dispatch({ type: 'history.undo' })} title="Deshacer (Ctrl+Z)" disabled={!state.past.length}>
            <Undo2 size={14} />
          </Btn>
          <Btn variant="onDark" onClick={() => dispatch({ type: 'history.redo' })} title="Rehacer" disabled={!state.future.length}>
            <Redo2 size={14} />
          </Btn>
        </div>
        {/* Las acciones de archivo van en un menú: la fila superior queda para
            lo que se usa a cada momento (nombre, deshacer, pestañas). */}
        <div className="relative">
          <Btn variant="onDark" onClick={() => setMenuOpen((o) => !o)} title="Archivo">
            <Menu size={14} /> Archivo
          </Btn>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
              <div className="absolute left-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-xl bg-white py-1 text-slate-700 shadow-2xl ring-1 ring-black/10">
                {[
                  ['Importar imagen base', ImageIcon, () => fileRef.current?.click()],
                  ['Ejercicio nuevo', FilePlus2, startNew],
                  ['Abrir proyecto…', FolderOpen, openProjects],
                  ['Exportar ejercicio', Download, exportProject],
                  ['Importar ejercicio', Upload, () => projectFileRef.current?.click()],
                ].map(([label, Icon, fn]) => (
                  <button
                    key={label}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-slate-100"
                    onClick={() => {
                      setMenuOpen(false)
                      fn()
                    }}
                  >
                    <Icon size={15} className="text-slate-500" /> {label}
                  </button>
                ))}
                <div className="my-1 border-t border-slate-200" />
                <button
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50"
                  onClick={() => {
                    setMenuOpen(false)
                    setDialog({ kind: 'clear' })
                  }}
                >
                  <Trash2 size={15} /> Borrar todo
                </button>
              </div>
            </>
          )}
        </div>
        <Btn variant="primary" onClick={loadSample}>
          <Sparkles size={14} /> Ejemplo
        </Btn>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            importImage(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <input
          ref={projectFileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) importProject(f)
            e.target.value = ''
          }}
        />

        <Btn
          variant="onDark"
          onClick={toggleFullscreen}
          title={fullscreen ? 'Salir de pantalla completa (F11 o Esc)' : 'Pantalla completa (F11)'}
        >
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </Btn>

        <nav className="ml-auto flex items-center gap-1 rounded-xl bg-white/10 p-1 ring-1 ring-white/10">
          {[
            ['mapa', 'Mapa', MapIcon],
            ['perfil', 'Perfil', Spline],
            ['3d', '3D', Boxes],
            ['pozos', 'Pozos', Crosshair],
          ].map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                tab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </nav>
      </header>

      {/* Aviso de calibración */}
      {!project.georef.metersPerPx && project.image && (
        <div className="flex items-center gap-2 bg-amber-50 px-4 py-1.5 text-xs text-amber-900">
          <b>Falta la escala.</b> Usa la herramienta «Escala gráfica» (R): traza una línea de largo conocido sobre
          el mapa e indica cuántos metros mide.
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {tab === 'mapa' && (
          <Toolbar tool={tool} setTool={setTool} penOnly={penOnly} setPenOnly={setPenOnly} />
        )}

        <main className="relative flex min-w-0 flex-1 flex-col">
          {tab === 'mapa' && (
            <>
              <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white px-3 py-1.5 text-[11px]">
                {LAYER_TOGGLES.map(({ k, label, icon: Icon }) => (
                  <button
                    key={k}
                    onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}
                    title={`${label}: ${show[k] ? 'visible' : 'oculta'}`}
                    aria-pressed={show[k]}
                    aria-label={label}
                    className={`grid h-9 w-9 place-items-center rounded-lg transition ${
                      show[k] ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    <Icon size={17} />
                  </button>
                ))}
                <span className="mx-2 h-6 w-px bg-slate-200" />
                {/* Acciones: sólo el icono mientras la barra vaya justa, para
                    que no empuje los interruptores a otra fila. */}
                <button
                  onClick={() => setRecalcNonce((n) => n + 1)}
                  title="Recalcular contornos estructurales, perfiles, 3D y pozos"
                  className="flex h-9 items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 font-medium text-slate-700 hover:bg-slate-200"
                >
                  <RefreshCw size={15} />
                  <span className="hidden xl:inline">Recalcular</span>
                </button>
                <button
                  onClick={() => setView(null)}
                  title="Encuadrar el mapa en la ventana"
                  className="flex h-9 items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 font-medium text-slate-700 hover:bg-slate-200"
                >
                  <Frame size={15} />
                  <span className="hidden xl:inline">Encuadrar</span>
                </button>
                <button
                  onClick={() =>
                    mapCanvasRef.current && downloadCanvasPng(mapCanvasRef.current, `${project.name}-mapa.png`)
                  }
                  title="Exportar el mapa como PNG"
                  className="flex h-9 items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 font-medium text-slate-700 hover:bg-slate-200"
                >
                  <Download size={15} />
                  <span className="hidden xl:inline">PNG</span>
                </button>
                <span className="ml-auto hidden text-slate-500 lg:inline">
                  {project.georef.metersPerPx
                    ? `1 px ≈ ${project.georef.metersPerPx.toFixed(2)} m · ${countVertices(project)} vértices`
                    : 'sin escala'}
                </span>
              </div>
              {selection?.kind === 'image' && project.image && (
                <div className="pointer-events-auto absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-slate-900/90 px-3 py-2 text-xs text-white shadow-2xl">
                  <ImageIcon size={15} className="text-sky-300" />
                  <span className="max-w-[220px] truncate font-medium">
                    {project.image.name || 'Imagen base'}
                  </span>
                  <span className="text-slate-400">
                    {project.image.width}×{project.image.height}
                  </span>
                  <button
                    className="rounded-lg bg-white/15 px-2.5 py-1.5 font-medium hover:bg-white/25"
                    onClick={() => fileRef.current?.click()}
                  >
                    Reemplazar
                  </button>
                  <button
                    className="flex items-center gap-1 rounded-lg bg-rose-500/90 px-2.5 py-1.5 font-medium hover:bg-rose-500"
                    onClick={() => setDialog({ kind: 'delete-image' })}
                  >
                    <Trash2 size={13} /> Borrar imagen
                  </button>
                  <button
                    className="rounded-lg px-2 py-1.5 text-slate-300 hover:text-white"
                    onClick={() => setSelection(null)}
                  >
                    ✕
                  </button>
                </div>
              )}
              <div className="min-h-0 flex-1">
                <MapView
                  project={project}
                  scene={scene}
                  image={image}
                  show={show}
                  tool={tool}
                  penOnly={penOnly}
                  selection={selection}
                  view={view || fitView(mapRect)}
                  setView={setView}
                  onStroke={onStroke}
                  onTwoPoint={onTwoPoint}
                  onTapPoint={onTapPoint}
                  onEditRequest={(hit) => {
                    setTool('select')
                    setSelection(hit)
                  }}
                  onAddScRequest={(target) => {
                    setScTarget(target)
                    setTool('scontour')
                  }}
                  onPick={(hit) => {
                    setSelection(hit)
                    if (hit?.kind === 'contact') setActiveIds((s) => ({ ...s, contact: hit.id }))
                    // Tocar un contorno estructural deja activa su superficie:
                    // es la que recibirá el próximo contorno que se trace.
                    if (hit?.kind === 'sc' && hit.featureKind === 'contact')
                      setActiveIds((s) => ({ ...s, contact: hit.id }))
                    if (hit?.kind === 'sc' && hit.featureKind === 'fault')
                      setActiveIds((s) => ({ ...s, fault: hit.id }))
                    if (hit?.kind === 'fault') setActiveIds((s) => ({ ...s, fault: hit.id }))
                    if (hit?.kind === 'section') setSectionId(hit.id)
                    if (hit?.kind === 'well') setWellId(hit.id)
                  }}
                  dispatch={dispatch}
                  status={status}
                  mapRect={mapRect}
                  modelViews={modelViews}
                  unitRaster={unitRaster}
                  canvasRef={mapCanvasRef}
                />
              </div>
            </>
          )}
          {tab === 'perfil' && (
            <div className="flex min-h-0 flex-1 flex-col">
              {project.sections.length > 1 && (
                <div className="flex gap-1 border-b border-slate-200 bg-white px-3 py-1.5">
                  {project.sections.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSectionId(s.id)}
                      className={`rounded-lg px-3 py-1 text-xs font-semibold ${
                        s.id === section?.id ? 'bg-violet-100 text-violet-800' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="min-h-0 flex-1">
                <SectionView project={project} scene={scene} section={section} dispatch={dispatch} />
              </div>
            </div>
          )}
          {tab === '3d' && <ThreeView project={project} scene={scene} image={image} />}
          {tab === 'pozos' && (
            <WellView
              project={project}
              scene={scene}
              dispatch={dispatch}
              selectedId={wellId}
              onSelect={setWellId}
            />
          )}
        </main>

        {/* Panel derecho */}
        <aside
          className={`${fullscreen ? 'hidden' : 'flex'} shrink-0 flex-col border-l border-slate-200 bg-white transition-all ${
            panelOpen ? 'w-[320px] md:w-[360px]' : 'w-11'
          }`}
        >
          <div className="flex items-center gap-1 border-b border-slate-200 px-1.5 py-1.5">
            <button
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              onClick={() => setPanelOpen((o) => !o)}
              title={panelOpen ? 'Ocultar panel' : 'Mostrar panel'}
            >
              <Layers size={16} />
            </button>
            {panelOpen &&
              [
                ['capas', 'Capas', Layers],
                ['modelos', 'Modelos', Layers3],
                ['resultados', 'Datos', Table],
                ['ayuda', 'Guía', BookOpen],
              ].map(([id, label, Icon]) => (
                <button
                  key={id}
                  onClick={() => setPanel(id)}
                  className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold ${
                    panel === id ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
          </div>
          {panelOpen && (
            <div className="min-h-0 flex-1 overflow-hidden">
              {panel === 'capas' && (
                <LayersPanel
                  project={project}
                  scene={scene}
                  dispatch={dispatch}
                  selection={selection}
                  onSelect={setSelection}
                  setTool={setTool}
                  activeIds={activeIds}
                  setActiveIds={setActiveIds}
                  onOpenSection={(id) => {
                    setSectionId(id)
                    setTab('perfil')
                  }}
                  onDeleteImage={() => setDialog({ kind: 'delete-image' })}
                />
              )}
              {panel === 'modelos' && (
                <div className="h-full overflow-y-auto p-3">
                  <ModelPanel
                    project={project}
                    scene={scene}
                    dispatch={dispatch}
                    selection={selection}
                    onSelect={(sel) => {
                      setSelection(sel)
                      const m = (project.models || []).find((x) => x.id === sel?.id)
                      if (m) setLastModelKind(m.kind)
                    }}
                    setTool={setTool}
                  />
                </div>
              )}
              {panel === 'resultados' && <ResultsPanel scene={scene} project={project} />}
              {panel === 'ayuda' && <HelpPanel project={project} dispatch={dispatch} />}
            </div>
          )}
        </aside>
      </div>

      {fullscreen && (
        <button
          className="fixed right-3 top-3 z-40 flex items-center gap-1.5 rounded-full bg-slate-900/85 px-3 py-2 text-xs font-semibold text-white shadow-lg hover:bg-slate-900"
          onClick={toggleFullscreen}
          title="Salir del modo enfoque (Esc)"
        >
          <Minimize2 size={14} /> Salir
        </button>
      )}

      {/* Diálogos */}
      {dialog?.kind === 'contour' && (
        <Modal title="Cota de la curva" onClose={() => setDialog(null)}>
          <Field label="Elevación (m s.n.m.)">
            <input
              autoFocus
              type="number"
              className={inputCls}
              value={dialog.elevation}
              onChange={(e) => setDialog({ ...dialog, elevation: Number(e.target.value) })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveContour()
              }}
            />
          </Field>
          <div className="mt-3 flex justify-between gap-2">
            <Btn
              onClick={() =>
                setDialog({ ...dialog, elevation: dialog.elevation - project.settings.contourInterval })
              }
            >
              −{project.settings.contourInterval}
            </Btn>
            <Btn
              onClick={() =>
                setDialog({ ...dialog, elevation: dialog.elevation + project.settings.contourInterval })
              }
            >
              +{project.settings.contourInterval}
            </Btn>
            <Btn variant="primary" className="flex-1" onClick={saveContour}>
              Guardar curva
            </Btn>
          </div>
        </Modal>
      )}

      {dialog?.kind === 'scontour' && (
        <Modal title="Contorno estructural" onClose={() => setDialog(null)}>
          <p className="mb-2 text-xs leading-relaxed text-slate-600">
            Un contorno estructural es la recta de <b>cota constante</b> sobre la superficie: donde el contacto
            pasa por esa altura. El motor los calcula desde los cruces de la traza con las curvas de nivel; el que
            dibujes aquí manda sobre esa cota.
          </p>
          <Field label="Superficie a la que pertenece">
            <select
              className={inputCls}
              value={`${dialog.target.kind}:${dialog.target.id}`}
              onChange={(e) => {
                const [kind, id] = e.target.value.split(':')
                setDialog({ ...dialog, target: { kind, id } })
              }}
            >
              {project.contacts.map((c) => (
                <option key={c.id} value={`contact:${c.id}`}>
                  {c.name}
                </option>
              ))}
              {project.faults.map((f) => (
                <option key={f.id} value={`fault:${f.id}`}>
                  {f.name} (falla)
                </option>
              ))}
            </select>
          </Field>
          <div className="mt-2">
            <Field label="Cota estructural (m s.n.m.)">
              <input
                autoFocus
                type="number"
                className={inputCls}
                value={dialog.elevation}
                onChange={(e) => setDialog({ ...dialog, elevation: Number(e.target.value) })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveStructureContour()
                }}
              />
            </Field>
          </div>
          <div className="mt-3 flex justify-between gap-2">
            <Btn
              onClick={() =>
                setDialog({ ...dialog, elevation: dialog.elevation - project.settings.contourInterval })
              }
            >
              −{project.settings.contourInterval}
            </Btn>
            <Btn
              onClick={() =>
                setDialog({ ...dialog, elevation: dialog.elevation + project.settings.contourInterval })
              }
            >
              +{project.settings.contourInterval}
            </Btn>
            <Btn variant="primary" className="flex-1" onClick={saveStructureContour}>
              Añadir contorno
            </Btn>
          </div>
        </Modal>
      )}

      {dialog?.kind === 'scale' && (
        <Modal title="Calibrar escala" onClose={() => setDialog(null)}>
          <p className="mb-2 text-xs text-slate-600">
            La línea trazada mide {dist(dialog.a, dialog.b).toFixed(1)} píxeles. Indica su longitud real.
          </p>
          <Field label="Longitud real (m)">
            <input
              autoFocus
              type="number"
              className={inputCls}
              value={dialog.meters}
              onChange={(e) => setDialog({ ...dialog, meters: Number(e.target.value) })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveScale()
              }}
            />
          </Field>
          <p className="mt-2 text-xs text-slate-500">
            Resultado: 1 px ≈ {(dialog.meters / Math.max(1e-6, dist(dialog.a, dialog.b))).toFixed(3)} m ·
            ancho del mapa ≈{' '}
            {fmtDistance((dialog.meters / Math.max(1e-6, dist(dialog.a, dialog.b))) * mapRect.width)}
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Btn onClick={() => setDialog(null)}>Cancelar</Btn>
            <Btn variant="primary" onClick={saveScale}>
              Aplicar escala
            </Btn>
          </div>
        </Modal>
      )}

      {dialog?.kind === 'projects' && (
        <Modal title="Proyectos guardados" onClose={() => setDialog(null)} wide>
          <ul className="space-y-1">
            {projects.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <div className="flex-1">
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-slate-500">
                    {p.units?.length || 0} unidades · {p.contours?.length || 0} curvas ·{' '}
                    {new Date(p.updatedAt).toLocaleString()}
                  </div>
                </div>
                <Btn
                  variant="primary"
                  onClick={() => {
                    dispatch({ type: 'project.load', project: p })
                    setView(null)
                    setDialog(null)
                  }}
                >
                  Abrir
                </Btn>
                <Btn
                  variant="danger"
                  onClick={async () => {
                    await db.deleteProject(p.id)
                    setProjects(await db.listProjects())
                  }}
                >
                  Borrar
                </Btn>
              </li>
            ))}
            {projects.length === 0 && <p className="text-sm text-slate-500">No hay proyectos guardados.</p>}
          </ul>
        </Modal>
      )}

      {dialog?.kind === 'clear' && (
        <Modal title="Borrar todo" onClose={() => setDialog(null)}>
          <p className="text-sm leading-relaxed text-slate-700">
            Esto vacía el ejercicio: curvas de nivel, unidades, contactos, fallas, perfiles, pozos y modelos.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Se conservan la imagen base, la escala y el norte, para que puedas empezar de nuevo sobre el mismo
            mapa. La acción se puede deshacer con Ctrl+Z.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Btn onClick={() => setDialog(null)}>Cancelar</Btn>
            <Btn
              variant="danger"
              onClick={() => {
                dispatch({ type: 'clear.all' })
                setSelection(null)
                setSectionId(null)
                setWellId(null)
                setDialog(null)
              }}
            >
              <Trash2 size={14} /> Borrar todo
            </Btn>
          </div>
        </Modal>
      )}

      {dialog?.kind === 'delete-image' && (
        <Modal title="Borrar la imagen base" onClose={() => setDialog(null)}>
          <p className="text-sm leading-relaxed text-slate-700">
            Se quita la imagen del mapa. Todo lo digitalizado encima —curvas, contactos, fallas, perfiles y
            pozos— se conserva con sus coordenadas.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            El lienzo vuelve al tamaño de la imagen para que nada se mueva de sitio. Se puede deshacer con
            Ctrl+Z.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Btn onClick={() => setDialog(null)}>Cancelar</Btn>
            <Btn variant="danger" onClick={deleteImage}>
              <Trash2 size={14} /> Borrar imagen
            </Btn>
          </div>
        </Modal>
      )}

      {dialog?.kind === 'info' && (
        <Modal title="Aviso" onClose={() => setDialog(null)}>
          <p className="text-sm text-slate-700">{dialog.text}</p>
        </Modal>
      )}
    </div>
  )

  function saveContour() {
    dispatch({ type: 'contour.add', elevation: dialog.elevation, pts: dialog.pts })
    dispatch({
      type: 'settings',
      patch: { lastElevation: dialog.elevation + project.settings.contourInterval },
    })
    setDialog(null)
  }

  function saveStructureContour() {
    const { target, a, b, elevation } = dialog
    dispatch({
      type: 'sc.add',
      kind: target.kind,
      id: target.id,
      items: [newStructureContour(elevation, [a, b])],
    })
    setLastScZ(elevation)
    setDialog(null)
    setTool('select')
  }

  function saveScale() {
    const px = dist(dialog.a, dialog.b)
    if (!(px > 0) || !(dialog.meters > 0)) return
    dispatch({
      type: 'georef',
      patch: { metersPerPx: dialog.meters / px, scaleLine: { a: dialog.a, b: dialog.b, meters: dialog.meters } },
    })
    setDialog(null)
    setTool('contour')
  }
}

function newFaultLocal(project) {
  return {
    id: uid('f'),
    name: `Falla ${project.faults.length + 1}`,
    kinematics: 'normal',
    manual: null,
    offset: null,
    traces: [],
  }
}

function fitView(rect) {
  // Encuadre inicial aproximado; MapView lo ajusta al conocer su tamaño real.
  const scale = Math.min(900 / rect.width, 620 / rect.height)
  return { scale, tx: 20, ty: 20 }
}

function statusText(tool, project, activeIds, scene, scTarget) {
  if (tool === 'contour') return `Curva de nivel · próxima cota ${project.settings.lastElevation} m`
  if (tool === 'contact') {
    const c = project.contacts.find((x) => x.id === activeIds.contact) || project.contacts[0]
    return c ? `Trazando contacto: ${c.name}` : 'Crea unidades para generar contactos'
  }
  if (tool === 'fault') {
    const f = project.faults.find((x) => x.id === activeIds.fault) || project.faults[0]
    return f ? `Trazando falla: ${f.name}` : 'Se creará una falla nueva al trazar'
  }
  if (tool === 'scontour') {
    const list = scTarget?.kind === 'fault' ? project.faults : project.contacts
    const target = scTarget ? list.find((x) => x.id === scTarget.id) : null
    return target
      ? `Traza el contorno estructural de ${target.name} y dale su cota`
      : 'Traza una recta de cota constante: al soltar eliges superficie y cota'
  }
  if (tool === 'scale') return 'Traza una línea de largo conocido'
  if (tool === 'north') return 'Traza una flecha apuntando al Norte'
  if (tool === 'frame') return 'Arrastra el rectángulo del área de trabajo'
  if (tool === 'section') return 'Traza la línea del perfil (A–A′)'
  if (tool === 'well') return 'Toca el mapa para ubicar el pozo'
  if (tool === 'erase') return 'Toca un rasgo para eliminarlo'
  if (tool === 'select') return 'Toca un rasgo para seleccionarlo o moverlo · pulsación larga abre sus opciones'
  if (!scene?.ready) return null
  return null
}
