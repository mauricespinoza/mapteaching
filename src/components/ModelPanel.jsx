import { Plus, Trash2, Eye, EyeOff, Palette, RefreshCw, Link2, Unlink } from 'lucide-react'
import { Field, inputCls, Btn } from './ui.jsx'
import {
  MODEL_KINDS,
  FOLD_SHAPES,
  modelColors,
  foldLimbDips,
  newStructuralModel,
  buildModelEntities,
} from '../lib/models.js'
import { formatAttitude } from '../lib/georef.js'

/**
 * Modelos estructurales sintéticos: el usuario marca un punto en el mapa y
 * define la orientación; la app dibuja la traza que resultaría en planta.
 */
export default function ModelPanel({ project, scene, dispatch, selection, onSelect, setTool }) {
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
        />
      ))}
    </div>
  )
}

function ModelCard({ model, dispatch, selected, onSelect, onApply, canApply }) {
  const set = (patch) => dispatch({ type: 'model.update', id: model.id, patch })
  const colors = modelColors(model)
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
