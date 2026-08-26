import { useMemo, useState } from 'react'
import { Plus, Trash2, Eye, EyeOff, Palette, RefreshCw, Link2, Unlink, Mountain, Layers, Upload } from 'lucide-react'
import { Field, inputCls, Btn } from './ui.jsx'
import {
  MODEL_KINDS,
  FOLD_SHAPES,
  modelColors,
  foldLimbDips,
  newStructuralModel,
  buildModelEntities,
} from '../lib/models.js'
import {
  TERRAIN_PRESETS,
  terrainPreset,
  terrainField,
  contoursFromField,
  parseDemText,
  gridFromImage,
  gridField,
  metersPerPxOfGrid,
  suggestInterval,
} from '../lib/terrain.js'
import { formatAttitude } from '../lib/georef.js'

/**
 * Los dos modos de generar geometría sin digitalizarla: **capas** —modelos
 * estructurales sintéticos, un plano o un tren de pliegues del que la app
 * calcula la traza en planta— y **curvas de nivel** —el relieve sobre el que
 * todo lo demás se apoya, sacado de una topografía típica o de un modelo de
 * elevación importado—. Van separados porque responden a preguntas distintas:
 * uno pone la estructura, el otro el terreno.
 */
export default function ModelPanel(props) {
  const [tab, setTab] = useState('layers')
  const TABS = [
    { id: 'layers', label: 'Capas', icon: Layers },
    { id: 'contours', label: 'Curvas de nivel', icon: Mountain },
  ]
  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
              tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'layers' ? <LayersSection {...props} /> : <ContoursSection {...props} />}
    </div>
  )
}

/**
 * Modelos estructurales sintéticos: el usuario marca un punto en el mapa y
 * define la orientación; la app dibuja la traza que resultaría en planta.
 */
function LayersSection({ project, scene, dispatch, selection, onSelect, setTool }) {
  const models = project.models || []

  const add = (kind) => {
    const rect = project.image || project.virtualSize || { width: 1400, height: 1000 }
    const m = newStructuralModel(kind, [rect.width / 2, rect.height / 2], models.length)
    dispatch({ type: 'model.add', model: m })
    onSelect({ kind: 'model', id: m.id })
    // Se aplica de inmediato para que el resto de la app (contornos
    // estructurales, perfil, 3D y pozos) trabaje ya con el modelo nuevo.
    applyModel(m)
  }

  const applyModel = (m) => {
    if (!scene?.ready) return
    const ents = buildModelEntities(m, scene)
    if (!ents) return
    dispatch({ type: 'model.apply', id: m.id, units: ents.units, contacts: ents.contacts })
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3">
        <p className="mb-2 text-xs leading-relaxed text-slate-600">
          Marca un punto y define la orientación: la app calcula la traza que los contactos dibujarían al
          cortar la topografía. Funciona también sin curvas de nivel (terreno plano).
        </p>
        <div className="flex flex-wrap gap-1.5">
          {MODEL_KINDS.map((k) => (
            <Btn key={k.id} variant="dark" onClick={() => add(k.id)} title={k.hint}>
              <Plus size={13} /> {k.label}
            </Btn>
          ))}
        </div>
        <button
          className="mt-2 text-[11px] font-medium text-sky-700 hover:underline"
          onClick={() => setTool('model')}
        >
          …o usa la herramienta «Modelo» y toca el mapa donde quieras ubicarlo
        </button>
      </div>

      {models.length === 0 && (
        <p className="px-1 text-xs text-slate-500">Todavía no hay modelos en este ejercicio.</p>
      )}

      {models.map((m) => (
        <ModelCard
          key={m.id}
          model={m}
          dispatch={dispatch}
          selected={selection?.kind === 'model' && selection.id === m.id}
          onSelect={() => onSelect({ kind: 'model', id: m.id })}
          onApply={() => applyModel(m)}
          canApply={Boolean(scene?.ready)}
          scene={scene}
        />
      ))}
    </div>
  )
}

function ModelCard({ model, dispatch, selected, onSelect, onApply, canApply, scene }) {
  const set = (patch) => dispatch({ type: 'model.update', id: model.id, patch })
  const colors = modelColors(model, scene)
  const isFold = model.kind === 'fold'
  const isStack = model.kind !== 'plane'
  const attitude = formatAttitude(((model.strike || 0) + 90) % 360, model.dip || 0)
  const limbs = isFold ? foldLimbDips(model) : null

  return (
    <div
      className={`rounded-xl border p-3 transition ${
        selected ? 'border-sky-400 bg-sky-50/60 shadow-sm' : 'border-slate-200 bg-white'
      }`}
      onPointerDown={onSelect}
    >
      <div className="mb-2 flex items-center gap-2">
        <input
          className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-sm font-medium hover:border-slate-300 focus:border-sky-400 focus:outline-none"
          value={model.name}
          onChange={(e) => set({ name: e.target.value })}
        />
        <Btn
          variant="ghost"
          title={model.visible ? 'Ocultar' : 'Mostrar'}
          onClick={() => set({ visible: !model.visible })}
        >
          {model.visible ? <Eye size={14} /> : <EyeOff size={14} />}
        </Btn>
        <Btn variant="ghost" title="Cambiar colores" onClick={() => set({ palette: (model.palette || 0) + 1 })}>
          <Palette size={14} />
        </Btn>
        <Btn variant="ghost" title="Eliminar" onClick={() => dispatch({ type: 'model.delete', id: model.id })}>
          <Trash2 size={14} />
        </Btn>
      </div>

      <select className={`${inputCls} mb-2`} value={model.kind} onChange={(e) => set({ kind: e.target.value })}>
        {MODEL_KINDS.map((k) => (
          <option key={k.id} value={k.id}>
            {k.label}
          </option>
        ))}
      </select>

      {/* Orientación del plano — no aplica al modelo de pliegues, cuya
          orientación la fijan el eje y la geometría del plegamiento. */}
      {!isFold && (
        <div className="mb-2 grid grid-cols-2 gap-2">
          <Slider
            label="Rumbo (RHR)"
            value={model.strike}
            min={0}
            max={359}
            unit="°"
            onChange={(v) => set({ strike: v })}
          />
          <Slider label="Manteo" value={model.dip} min={0} max={89} unit="°" onChange={(v) => set({ dip: v })} />
        </div>
      )}
      {!isFold && (
        <p className="mb-2 rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
          {attitude.quadrant} · <span className="font-mono">{attitude.dipDirNotation}</span>
        </p>
      )}

      {isStack && (
        <div className="mb-2 grid grid-cols-2 gap-2">
          <Slider label="N.º de capas" value={model.layers} min={1} max={14} onChange={(v) => set({ layers: v })} />
          <Slider
            label="Espesor"
            value={model.thickness}
            min={20}
            max={2000}
            step={10}
            unit=" m"
            onChange={(v) => set({ thickness: v })}
          />
        </div>
      )}

      {isFold && (
        <>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <Slider
              label="Trend del eje"
              value={model.trend}
              min={0}
              max={359}
              unit="°"
              onChange={(v) => set({ trend: v })}
            />
            <Slider
              label="Plunge del eje"
              value={model.plunge}
              min={0}
              max={85}
              unit="°"
              onChange={(v) => set({ plunge: v })}
            />
          </div>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <Slider
              label="Ángulo interlimbo"
              value={model.interlimb}
              min={10}
              max={180}
              unit="°"
              onChange={(v) => set({ interlimb: v })}
            />
            <Slider
              label="Longitud de onda"
              value={model.wavelength}
              min={200}
              max={12000}
              step={100}
              unit=" m"
              onChange={(v) => set({ wavelength: v })}
            />
          </div>
          <Slider
            label="Asimetría"
            value={model.asymmetry}
            min={0}
            max={0.9}
            step={0.05}
            decimals={2}
            onChange={(v) => set({ asymmetry: v })}
          />
          <select
            className={`${inputCls} mt-2`}
            value={model.shape}
            onChange={(e) => set({ shape: e.target.value })}
          >
            {FOLD_SHAPES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          {limbs && (
            <p className="mt-2 rounded-lg bg-slate-100 px-2 py-1 text-[11px] leading-relaxed text-slate-600">
              Manteo máximo de los flancos:{' '}
              {limbs.symmetric ? (
                <b>{limbs.short.toFixed(0)}°</b>
              ) : (
                <>
                  flanco corto <b>{limbs.short.toFixed(0)}°</b> · flanco largo <b>{limbs.long.toFixed(0)}°</b>
                </>
              )}
              . El eje del pliegue tiene {model.plunge}° de inmersión hacia {model.trend}°.
            </p>
          )}
        </>
      )}

      <div className="mt-2.5 rounded-lg border border-slate-200 bg-slate-50 p-2">
        <div className="flex items-center gap-1.5">
          <Btn variant="primary" className="flex-1" onClick={onApply} disabled={!canApply}>
            <RefreshCw size={13} /> {model.applied ? 'Recalcular el mapa' : 'Aplicar al mapa'}
          </Btn>
          {model.applied && (
            <Btn
              variant="ghost"
              title="Quitar del mapa las unidades y contactos generados"
              onClick={() => dispatch({ type: 'model.unapply', id: model.id })}
            >
              <Unlink size={14} />
            </Btn>
          )}
        </div>
        <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-relaxed text-slate-600">
          <Link2 size={12} className="mt-0.5 shrink-0" />
          {model.applied
            ? 'El modelo está aplicado: sus capas y contactos alimentan los contornos estructurales, el perfil, la vista 3D y los pozos. Si cambias los parámetros, vuelve a pulsar para recalcular.'
            : 'Aplícalo para convertirlo en unidades y contactos reales, y que el resto de las vistas trabajen con él.'}
        </p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={model.fill} onChange={(e) => set({ fill: e.target.checked })} />
          Pintar mapa
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={model.symbols} onChange={(e) => set({ symbols: e.target.checked })} />
          Símbolos
        </label>
        <div className="ml-auto flex gap-0.5">
          {colors.slice(0, 8).map((c, i) => (
            <span key={i} className="h-3.5 w-3.5 rounded-sm ring-1 ring-black/10" style={{ background: c }} />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Curvas de nivel generadas: el relieve de partida de un ejercicio.
 *
 * Sin curvas de nivel no hay cota del terreno, y sin cota no hay contornos
 * estructurales, ni perfil, ni 3D. Digitalizarlas sobre una carta escaneada es
 * lento, y para practicar la lectura del relieve —la regla de las uves, una
 * cuenca cerrada, un escarpe— basta con un terreno de laboratorio del que se
 * conoce la respuesta. Las curvas que salen son las isolíneas exactas de ese
 * terreno, así que el alumno puede contrastar su lectura contra la verdad.
 */
function ContoursSection({ project, dispatch }) {
  const rect = project.image || project.virtualSize || { width: 1400, height: 1000 }
  const [preset, setPreset] = useState(TERRAIN_PRESETS[0].id)
  const [base, setBase] = useState(200)
  const [relief, setRelief] = useState(800)
  const [interval, setIntervalM] = useState(100)
  const [azimuth, setAzimuth] = useState(0)
  const [grid, setGrid] = useState(null)
  const [demName, setDemName] = useState('')
  const [demError, setDemError] = useState('')
  const [demRange, setDemRange] = useState([0, 1000])
  const [useDemScale, setUseDemScale] = useState(true)
  const [busy, setBusy] = useState(false)

  const hasContours = project.contours.length > 0

  // Miniaturas: la misma generación, en pequeño. Enseñan de un vistazo qué
  // relieve produce cada opción, que es más claro que cualquier descripción.
  const thumbs = useMemo(() => {
    const r = { width: 100, height: 72 }
    const out = {}
    for (const p of TERRAIN_PRESETS) {
      out[p.id] = contoursFromField(terrainField(p.id, r, { base: 0, relief: 100, azimuth: 0 }), r, {
        interval: 12,
        resolution: 70,
        tol: 0.35,
      })
    }
    return out
  }, [])

  const commit = (contours, extra) => {
    if (!contours.length) {
      setDemError('El relieve no ha dado ninguna curva: prueba con otra equidistancia.')
      return
    }
    if (hasContours && !window.confirm(`Se sustituirán las ${project.contours.length} curvas de nivel actuales por ${contours.length}. ¿Seguir?`)) return
    dispatch({ type: 'contour.bulk', contours, replace: true })
    if (extra?.metersPerPx) dispatch({ type: 'georef', patch: { metersPerPx: extra.metersPerPx } })
    setDemError('')
  }

  const generatePreset = () => {
    setBusy(true)
    try {
      const field = terrainField(preset, rect, { base, relief, azimuth })
      commit(contoursFromField(field, rect, { interval }))
    } finally {
      setBusy(false)
    }
  }

  const generateDem = () => {
    if (!grid) return
    setBusy(true)
    try {
      const range = grid.cellsize ? null : demRange
      const field = gridField(grid, rect, { range })
      const mpp = useDemScale ? metersPerPxOfGrid(grid, field) : null
      commit(contoursFromField(field, rect, { interval }), { metersPerPx: mpp })
    } finally {
      setBusy(false)
    }
  }

  const loadDem = async (file) => {
    if (!file) return
    setDemError('')
    setDemName(file.name)
    try {
      let g = null
      if (/\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name)) {
        // Imagen en escala de grises: mapa de alturas sin metros ni cotas.
        const url = URL.createObjectURL(file)
        try {
          const img = await new Promise((res, rej) => {
            const im = new Image()
            im.onload = () => res(im)
            im.onerror = rej
            im.src = url
          })
          g = gridFromImage(img)
        } finally {
          URL.revokeObjectURL(url)
        }
      } else {
        g = parseDemText(await file.text())
      }
      if (!g) {
        setGrid(null)
        setDemError('No he sabido leer el archivo. Se admiten malla ASCII de ESRI (.asc), volcados XYZ o CSV de x y z, y una imagen en escala de grises.')
        return
      }
      setGrid(g)
      if (g.cellsize) setIntervalM(suggestInterval(g.zmax - g.zmin))
      else setIntervalM(suggestInterval(demRange[1] - demRange[0]))
    } catch (e) {
      setGrid(null)
      setDemError(`No he podido leer el archivo: ${e.message}`)
    }
  }

  const info = terrainPreset(preset)
  const nCurvas = Math.max(0, Math.floor(relief / Math.max(1, interval)))

  return (
    <div className="space-y-3">
      <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3 text-xs leading-relaxed text-slate-600">
        Las curvas de nivel son el punto de partida: de ellas salen la cota del terreno, los contornos
        estructurales, el perfil y el relieve 3D. Aquí se generan sin digitalizarlas, y son las isolíneas
        exactas del relieve elegido.
      </p>

      {/* ---- Topografías típicas ---- */}
      <section className="rounded-xl border border-slate-200 bg-white p-3">
        <h4 className="mb-2 text-xs font-semibold text-slate-700">Topografía típica</h4>
        <div className="mb-2 grid grid-cols-2 gap-1.5">
          {TERRAIN_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              title={p.hint}
              className={`rounded-lg border p-1.5 text-left transition ${
                preset === p.id ? 'border-sky-400 bg-sky-50 ring-1 ring-sky-300' : 'border-slate-200 hover:border-slate-400'
              }`}
            >
              <Thumb lines={thumbs[p.id]} />
              <span className="mt-1 block text-[11px] font-medium leading-tight text-slate-700">{p.label}</span>
            </button>
          ))}
        </div>
        <p className="mb-2 rounded-lg bg-slate-100 px-2 py-1 text-[11px] leading-relaxed text-slate-600">{info.hint}</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Cota de la base (m)">
            <input
              type="number"
              className={inputCls}
              value={base}
              step={50}
              onChange={(e) => setBase(Number(e.target.value))}
            />
          </Field>
          <Field label="Desnivel (m)">
            <input
              type="number"
              className={inputCls}
              value={relief}
              min={10}
              step={50}
              onChange={(e) => setRelief(Math.max(10, Number(e.target.value)))}
            />
          </Field>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label="Equidistancia (m)">
            <input
              type="number"
              className={inputCls}
              value={interval}
              min={1}
              step={10}
              onChange={(e) => setIntervalM(Math.max(1, Number(e.target.value)))}
            />
          </Field>
          <Slider label="Orientación" value={azimuth} min={0} max={359} unit="°" onChange={setAzimuth} />
        </div>
        <p className="mt-1.5 text-[11px] text-slate-500">
          Saldrán unas <b>{nCurvas}</b> curvas, entre {base} y {base + relief} m.
        </p>
        <Btn variant="primary" className="mt-2 w-full" onClick={generatePreset} disabled={busy}>
          <Mountain size={13} /> Generar las curvas de nivel
        </Btn>
      </section>

      {/* ---- Modelo de elevación importado ---- */}
      <section className="rounded-xl border border-slate-200 bg-white p-3">
        <h4 className="mb-1 text-xs font-semibold text-slate-700">…o desde un modelo de elevación</h4>
        <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
          Malla ASCII de ESRI (<span className="font-mono">.asc</span>, la exportación estándar de un SIG),
          volcado <span className="font-mono">XYZ</span> o <span className="font-mono">CSV</span> de x y z, o una
          imagen en escala de grises como mapa de alturas. El modelo se encaja en el área de la imagen
          conservando su proporción.
        </p>
        <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-2.5 py-2 text-xs font-medium text-slate-600 hover:border-sky-400 hover:text-sky-700">
          <Upload size={13} /> {demName || 'Elegir archivo…'}
          <input
            type="file"
            className="hidden"
            accept=".asc,.grd,.txt,.xyz,.csv,image/*"
            onChange={(e) => loadDem(e.target.files?.[0])}
          />
        </label>
        {demError && <p className="mt-1.5 text-[11px] leading-relaxed text-rose-600">{demError}</p>}
        {grid && (
          <>
            <p className="mt-2 rounded-lg bg-slate-100 px-2 py-1 text-[11px] leading-relaxed text-slate-600">
              {grid.ncols} × {grid.nrows} celdas ·{' '}
              {grid.cellsize ? (
                <>
                  celda de {grid.cellsize} m · cotas {grid.zmin.toFixed(0)}–{grid.zmax.toFixed(0)} m
                </>
              ) : (
                'sin escala ni cotas propias (una imagen no sabe de metros)'
              )}
            </p>
            {!grid.cellsize && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label="Cota mínima (m)">
                  <input
                    type="number"
                    className={inputCls}
                    value={demRange[0]}
                    step={50}
                    onChange={(e) => setDemRange([Number(e.target.value), demRange[1]])}
                  />
                </Field>
                <Field label="Cota máxima (m)">
                  <input
                    type="number"
                    className={inputCls}
                    value={demRange[1]}
                    step={50}
                    onChange={(e) => setDemRange([demRange[0], Number(e.target.value)])}
                  />
                </Field>
              </div>
            )}
            <div className="mt-2">
              <Field label="Equidistancia (m)">
                <input
                  type="number"
                  className={inputCls}
                  value={interval}
                  min={1}
                  step={10}
                  onChange={(e) => setIntervalM(Math.max(1, Number(e.target.value)))}
                />
              </Field>
            </div>
            {grid.cellsize > 0 && (
              <label className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-600">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={useDemScale}
                  onChange={(e) => setUseDemScale(e.target.checked)}
                />
                <span>
                  Tomar también <b>la escala del mapa</b> del tamaño de celda. Es lo que hace que manteos,
                  espesores y la barra de escala salgan en metros de verdad.
                </span>
              </label>
            )}
            <Btn variant="primary" className="mt-2 w-full" onClick={generateDem} disabled={busy}>
              <Mountain size={13} /> Generar las curvas de nivel
            </Btn>
          </>
        )}
      </section>

      {hasContours && (
        <p className="px-1 text-[11px] leading-relaxed text-amber-700">
          El ejercicio ya tiene <b>{project.contours.length}</b> curvas de nivel: generar otras las sustituye.
          Se puede deshacer con Ctrl+Z.
        </p>
      )}
    </div>
  )
}

/** Miniatura de un relieve: sus curvas, dibujadas pequeñas. */
function Thumb({ lines }) {
  return (
    <svg viewBox="0 0 100 72" className="block w-full rounded bg-slate-50" aria-hidden="true">
      {(lines || []).map((c, i) => (
        <polyline
          key={i}
          points={c.pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}
          fill="none"
          stroke="#92400e"
          strokeWidth="0.9"
          strokeOpacity="0.75"
        />
      ))}
    </svg>
  )
}

function Slider({ label, value, min, max, step = 1, unit = '', decimals = 0, onChange }) {
  return (
    <Field label={`${label}: ${Number(value ?? 0).toFixed(decimals)}${unit}`}>
      <input
        type="range"
        className="w-full accent-sky-600"
        min={min}
        max={max}
        step={step}
        value={value ?? 0}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  )
}
