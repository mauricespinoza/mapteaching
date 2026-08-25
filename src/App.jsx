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
} from 'lucide-react'
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
import { reducer, initialState } from './lib/store.js'
import { newProject, newSection, newWell, uid, countVertices } from './lib/model.js'
import { buildScene } from './lib/scene.js'
import { buildSampleProject } from './lib/sample.js'
import { buildModelViews, newStructuralModel } from './lib/models.js'
import { dist, norm, sub } from './lib/geom.js'
import * as db from './lib/db.js'
import { downloadText, downloadCanvasPng } from './lib/exportFile.js'
import { fmtDistance } from './lib/georef.js'

const DEFAULT_SHOW = {
  contours: true,
  contourLabels: true,
  contacts: true,
  faults: true,
  structureContours: true,
  faultStructureContours: false,
  attitudes: true,
  sections: true,
  wells: true,
  hillshade: true,
  models: true,
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

  const [tab, setTab] = useState('mapa')
  const [panel, setPanel] = useState('capas')
  const [panelOpen, setPanelOpen] = useState(true)
  const [tool, setTool] = useState('pan')
  const [drawMode, setDrawMode] = useState('free')
  const [penOnly, setPenOnly] = useState(true)
  const [selection, setSelection] = useState(null)
  const [activeIds, setActiveIds] = useState({ contact: null, fault: null })
  const [view, setView] = useState(null)
  const [show, setShow] = useState(DEFAULT_SHOW)
  const [sectionId, setSectionId] = useState(null)
  const [wellId, setWellId] = useState(null)
  const [image, setImage] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [lastModelKind, setLastModelKind] = useState('fold')
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
      const found = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase())
      if (found && !e.ctrlKey && !e.metaKey) setTool(found.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
      } else if (tool === 'section') {
        const s = newSection(project, a, b)
        dispatch({ type: 'section.add', section: s })
        setSectionId(s.id)
      }
    },
    [tool, project]
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
  const status = statusText(tool, project, activeIds, scene)

  return (
    <div className="flex h-full w-full flex-col bg-slate-100 text-slate-900">
      {/* Barra superior */}
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-800/10 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-3 py-2 text-slate-100 shadow-sm">
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
        <div className="flex flex-wrap items-center gap-1">
          <Btn variant="onDark" onClick={() => fileRef.current?.click()}>
            <ImageIcon size={14} /> Imagen
          </Btn>
          <Btn variant="onDark" onClick={startNew}>
            <FilePlus2 size={14} /> Nuevo
          </Btn>
          <Btn variant="onDark" onClick={openProjects}>
            <FolderOpen size={14} /> Abrir
          </Btn>
          <Btn variant="onDark" onClick={exportProject}>
            <Download size={14} /> Exportar
          </Btn>
          <Btn variant="onDark" onClick={() => projectFileRef.current?.click()}>
            <Upload size={14} /> Importar
          </Btn>
          <Btn variant="onDark" onClick={() => setDialog({ kind: 'clear' })} title="Vaciar el ejercicio">
            <Trash2 size={14} /> Borrar todo
          </Btn>
          <Btn variant="primary" onClick={loadSample}>
            <Sparkles size={14} /> Ejemplo
          </Btn>
        </div>
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
          <Toolbar
            tool={tool}
            setTool={setTool}
            drawMode={drawMode}
            setDrawMode={setDrawMode}
            penOnly={penOnly}
            setPenOnly={setPenOnly}
          />
        )}

        <main className="relative flex min-w-0 flex-1 flex-col">
          {tab === 'mapa' && (
            <>
              <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white px-3 py-1.5 text-[11px]">
                {[
                  ['contours', 'Curvas'],
                  ['contourLabels', 'Cotas'],
                  ['contacts', 'Contactos'],
                  ['faults', 'Fallas'],
                  ['structureContours', 'Contornos estr.'],
                  ['faultStructureContours', 'Contornos de falla'],
                  ['attitudes', 'Rumbo/manteo'],
                  ['sections', 'Perfiles'],
                  ['wells', 'Pozos'],
                  ['hillshade', 'Relieve'],
                  ['models', 'Modelos'],
                ].map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}
                    className={`rounded-full px-2.5 py-1 font-medium transition ${
                      show[k] ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <span className="ml-auto text-slate-500">
                  {project.georef.metersPerPx
                    ? `1 px ≈ ${project.georef.metersPerPx.toFixed(2)} m · ${countVertices(project)} vértices`
                    : 'sin escala'}
                </span>
                <Btn
                  onClick={() => setRecalcNonce((n) => n + 1)}
                  title="Recalcular contornos estructurales, perfiles, 3D y pozos"
                >
                  <RefreshCw size={13} /> Recalcular
                </Btn>
                <Btn onClick={() => setView(null)}>Encuadrar</Btn>
                <Btn
                  onClick={() =>
                    mapCanvasRef.current && downloadCanvasPng(mapCanvasRef.current, `${project.name}-mapa.png`)
                  }
                >
                  PNG
                </Btn>
              </div>
              <div className="min-h-0 flex-1">
                <MapView
                  project={project}
                  scene={scene}
                  image={image}
                  show={show}
                  tool={tool}
                  drawMode={drawMode}
                  penOnly={penOnly}
                  selection={selection}
                  view={view || fitView(mapRect)}
                  setView={setView}
                  onStroke={onStroke}
                  onTwoPoint={onTwoPoint}
                  onTapPoint={onTapPoint}
                  onPick={(hit) => {
                    setSelection(hit)
                    if (hit?.kind === 'contact') setActiveIds((s) => ({ ...s, contact: hit.id }))
                    if (hit?.kind === 'fault') setActiveIds((s) => ({ ...s, fault: hit.id }))
                    if (hit?.kind === 'section') setSectionId(hit.id)
                    if (hit?.kind === 'well') setWellId(hit.id)
                  }}
                  dispatch={dispatch}
                  status={status}
                  mapRect={mapRect}
                  modelViews={modelViews}
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
          className={`flex shrink-0 flex-col border-l border-slate-200 bg-white transition-all ${
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

function statusText(tool, project, activeIds, scene) {
  if (tool === 'contour') return `Curva de nivel · próxima cota ${project.settings.lastElevation} m`
  if (tool === 'contact') {
    const c = project.contacts.find((x) => x.id === activeIds.contact) || project.contacts[0]
    return c ? `Trazando contacto: ${c.name}` : 'Crea unidades para generar contactos'
  }
  if (tool === 'fault') {
    const f = project.faults.find((x) => x.id === activeIds.fault) || project.faults[0]
    return f ? `Trazando falla: ${f.name}` : 'Se creará una falla nueva al trazar'
  }
  if (tool === 'scale') return 'Traza una línea de largo conocido'
  if (tool === 'north') return 'Traza una flecha apuntando al Norte'
  if (tool === 'section') return 'Traza la línea del perfil (A–A′)'
  if (tool === 'well') return 'Toca el mapa para ubicar el pozo'
  if (tool === 'erase') return 'Toca un rasgo para eliminarlo'
  if (tool === 'select') return 'Toca un rasgo para seleccionarlo o moverlo'
  if (!scene?.ready) return null
  return null
}
