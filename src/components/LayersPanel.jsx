import {
  Plus,
  Trash2,
  Pencil,
  ArrowUp,
  ArrowDown,
  Eraser,
  Lock,
  Unlock,
  Image as ImageIcon,
  Frame,
  Maximize,
} from 'lucide-react'
import { Collapsible, Field, inputCls, Btn } from './ui.jsx'
import { CONTACT_TYPES, KINEMATICS, newFault, sortedUnits, sortedContacts } from '../lib/model.js'
import { fmtDistance } from '../lib/georef.js'

/** Panel lateral con todas las entidades del proyecto. */
/**
 * Marco rectangular que acota el ejercicio: los polígonos del mapa geológico y
 * el modelo 3D se recortan a esta área.
 */
function WorkArea({ project, dispatch, setTool }) {
  const f = project.frame
  const size = project.image || project.virtualSize
  const fit = () => {
    if (!size?.width || !size?.height) return
    dispatch({ type: 'patch', patch: { frame: { a: [0, 0], b: [size.width, size.height] } } })
  }
  return (
    <div className="mt-2 rounded-lg border border-slate-200 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <Frame size={13} className="shrink-0 text-slate-400" />
        <span className="flex-1 text-xs font-medium text-slate-700">Área de trabajo</span>
        <span className="text-[10px] text-slate-400">
          {f ? `${Math.round(Math.abs(f.b[0] - f.a[0]))} × ${Math.round(Math.abs(f.b[1] - f.a[1]))} px` : 'sin marco'}
        </span>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
        Recorta los polígonos del mapa y el modelo 3D al rectángulo que definas.
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Btn variant="primary" onClick={() => setTool('frame')}>
          <Pencil size={13} /> {f ? 'Redefinir' : 'Dibujar marco'}
        </Btn>
        {size?.width > 0 && (
          <Btn variant="ghost" title="Ajustar al tamaño del mapa" onClick={fit}>
            <Maximize size={13} /> Todo el mapa
          </Btn>
        )}
        {f && (
          <Btn variant="ghost" title="Quitar el marco" onClick={() => dispatch({ type: 'patch', patch: { frame: null } })}>
            <Trash2 size={13} /> Quitar
          </Btn>
        )}
      </div>
    </div>
  )
}

export default function LayersPanel({
  project,
  scene,
  dispatch,
  selection,
  onSelect,
  setTool,
  setActiveIds,
  onOpenSection,
  onDeleteImage,
}) {
  const units = sortedUnits(project).slice().reverse() // techo arriba, como una columna
  const contacts = sortedContacts(project)

  const draw = (kind, id) => {
    setActiveIds((s) => ({ ...s, [kind]: id }))
    setTool(kind)
    onSelect({ kind, id })
  }

  const layers = project.settings?.layers || {}
  const setLayer = (layer, patch) => dispatch({ type: 'layer', layer, patch })

  return (
    <div className="h-full overflow-y-auto bg-white">
      <Collapsible title="Capas del mapa" badge={null} defaultOpen>
        <div className="space-y-1">
          {[
            ['image', 'Imagen base', project.image ? project.image.name || 'imagen' : 'sin imagen'],
            ['contours', 'Curvas de nivel', `${project.contours.length}`],
            ['units', 'Relleno de unidades', `${project.units.length}`],
            ['contacts', 'Contactos', `${project.contacts.length}`],
            ['faults', 'Fallas', `${project.faults.length}`],
            ['models', 'Modelos', `${(project.models || []).length}`],
          ].map(([key, label, hint]) => {
            const st = layers[key] || { opacity: 1, locked: false }
            const disabled = key === 'image' && !project.image
            return (
              <div
                key={key}
                className={`rounded-lg border px-2 py-1.5 ${
                  disabled ? 'border-slate-100 bg-slate-50 opacity-60' : 'border-slate-200'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {key === 'image' && <ImageIcon size={13} className="shrink-0 text-slate-400" />}
                  <span className="flex-1 truncate text-xs font-medium text-slate-700">{label}</span>
                  <span className="truncate text-[10px] text-slate-400">{hint}</span>
                  <Btn
                    variant="ghost"
                    title={st.locked ? 'Desbloquear para poder editar' : 'Bloquear: impide seleccionar y editar'}
                    onClick={() => setLayer(key, { locked: !st.locked })}
                  >
                    {st.locked ? <Lock size={13} className="text-amber-600" /> : <Unlock size={13} />}
                  </Btn>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="w-14 shrink-0 text-[10px] text-slate-500">
                    {Math.round((st.opacity ?? 1) * 100)}%
                  </span>
                  <input
                    type="range"
                    className="h-1 flex-1 accent-sky-600"
                    min="0"
                    max="1"
                    step="0.05"
                    value={st.opacity ?? 1}
                    disabled={disabled}
                    onChange={(e) => setLayer(key, { opacity: Number(e.target.value) })}
                  />
                </div>
              </div>
            )
          })}
        </div>
        {project.image && (
          <Btn
            variant="danger"
            className="mt-2 w-full"
            onClick={() => onDeleteImage?.()}
          >
            <Trash2 size={13} /> Borrar imagen base
          </Btn>
        )}

        <WorkArea project={project} dispatch={dispatch} setTool={setTool} />
      </Collapsible>

      <Collapsible
        title="Unidades (columna)"
        badge={project.units.length}
        action={
          <Btn variant="dark" onClick={() => dispatch({ type: 'unit.add' })}>
            <Plus size={13} /> Unidad
          </Btn>
        }
      >
        {units.length === 0 && (
          <p className="text-xs text-slate-500">
            Crea las unidades de base a techo. Entre unidades consecutivas se genera un contacto que podrás
            digitalizar.
          </p>
        )}
        <ul className="space-y-1.5">
          {units.map((u) => (
            <li key={u.id} className="rounded-lg border border-slate-200 p-2">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={u.color}
                  onChange={(e) => dispatch({ type: 'unit.update', id: u.id, patch: { color: e.target.value } })}
                  className="h-7 w-7 cursor-pointer rounded border border-slate-300"
                />
                <input
                  className="flex-1 rounded border border-transparent px-1 py-0.5 text-sm hover:border-slate-300"
                  value={u.name}
                  onChange={(e) => dispatch({ type: 'unit.update', id: u.id, patch: { name: e.target.value } })}
                />
                <Btn variant="ghost" title="Subir" onClick={() => dispatch({ type: 'unit.move', id: u.id, delta: 1 })}>
                  <ArrowUp size={13} />
                </Btn>
                <Btn variant="ghost" title="Bajar" onClick={() => dispatch({ type: 'unit.move', id: u.id, delta: -1 })}>
                  <ArrowDown size={13} />
                </Btn>
                <Btn variant="ghost" title="Eliminar" onClick={() => dispatch({ type: 'unit.delete', id: u.id })}>
                  <Trash2 size={13} />
                </Btn>
              </div>
              <input
                className="mt-1 w-full rounded border border-slate-200 px-1.5 py-0.5 text-xs text-slate-600"
                placeholder="Litología / descripción"
                value={u.lithology}
                onChange={(e) => dispatch({ type: 'unit.update', id: u.id, patch: { lithology: e.target.value } })}
              />
            </li>
          ))}
        </ul>
      </Collapsible>

      <Collapsible title="Contactos" badge={project.contacts.length}>
        {contacts.length === 0 && (
          <p className="text-xs text-slate-500">Se crean automáticamente al añadir unidades.</p>
        )}
        <ul className="space-y-2">
          {contacts.map((c) => {
            const byBlock = scene?.contactSurfaces?.get(c.id)
            const nTraces = c.traces.length
            return (
              <li
                key={c.id}
                className={`rounded-lg border p-2 ${
                  selection?.kind === 'contact' && selection.id === c.id ? 'border-sky-400 bg-sky-50' : 'border-slate-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={c.color}
                    onChange={(e) => dispatch({ type: 'contact.update', id: c.id, patch: { color: e.target.value } })}
                    className="h-6 w-6 cursor-pointer rounded border border-slate-300"
                  />
                  <input
                    className="flex-1 rounded border border-transparent px-1 py-0.5 text-sm hover:border-slate-300"
                    value={c.name}
                    onChange={(e) => dispatch({ type: 'contact.update', id: c.id, patch: { name: e.target.value } })}
                  />
                  <Btn variant="primary" onClick={() => draw('contact', c.id)}>
                    <Pencil size={13} /> Trazar
                  </Btn>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  <select
                    className={inputCls}
                    value={c.type}
                    onChange={(e) => dispatch({ type: 'contact.update', id: c.id, patch: { type: e.target.value } })}
                  >
                    {CONTACT_TYPES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1 text-xs text-slate-500">
                    {nTraces} traza{nTraces === 1 ? '' : 's'}
                    {nTraces > 0 && (
                      <Btn
                        variant="ghost"
                        title="Borrar trazas"
                        onClick={() =>
                          c.traces.forEach((t) =>
                            dispatch({ type: 'trace.delete', kind: 'contact', id: c.id, traceId: t.id })
                          )
                        }
                      >
                        <Eraser size={13} />
                      </Btn>
                    )}
                  </div>
                </div>
                <ManualAttitude
                  value={c.manual}
                  onChange={(manual) => dispatch({ type: 'contact.update', id: c.id, patch: { manual } })}
                />
                {byBlock && byBlock.size > 0 && (
                  <div className="mt-1.5 space-y-0.5 text-[11px] text-slate-600">
                    {[...byBlock.entries()].map(([b, s]) => (
                      <div key={b}>
                        Bloque {b}: {s.mean ? `${s.mean.quadrant} (${s.mean.dipDirNotation})` : 'sin actitud'} ·{' '}
                        {s.structureContours.filter((x) => x.fit).length} contornos
                        {s.inherited ? (
                          <span className="ml-1 text-sky-700">
                            ↳ sigue la geometría de «{s.inherited.name}» · espesor{' '}
                            {fmtDistance(s.inherited.thickness)}
                          </span>
                        ) : (
                          s.quality !== 'ok' && (
                            <span className="ml-1 text-amber-600">⚠ {qualityText(s.quality)}</span>
                          )
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </Collapsible>

      <Collapsible
        title="Fallas"
        badge={project.faults.length}
        action={
          <Btn variant="dark" onClick={() => dispatch({ type: 'fault.add', fault: newFault(project) })}>
            <Plus size={13} /> Falla
          </Btn>
        }
      >
        <ul className="space-y-2">
          {project.faults.map((f) => {
            const surf = scene?.faultSurfaces?.get(f.id)
            return (
              <li
                key={f.id}
                className={`rounded-lg border p-2 ${
                  selection?.kind === 'fault' && selection.id === f.id ? 'border-orange-400 bg-orange-50' : 'border-slate-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    className="flex-1 rounded border border-transparent px-1 py-0.5 text-sm hover:border-slate-300"
                    value={f.name}
                    onChange={(e) => dispatch({ type: 'fault.update', id: f.id, patch: { name: e.target.value } })}
                  />
                  <Btn variant="primary" onClick={() => draw('fault', f.id)}>
                    <Pencil size={13} /> Trazar
                  </Btn>
                  <Btn variant="ghost" onClick={() => dispatch({ type: 'fault.delete', id: f.id })}>
                    <Trash2 size={13} />
                  </Btn>
                </div>
                <select
                  className={`${inputCls} mt-1.5`}
                  value={f.kinematics}
                  onChange={(e) => dispatch({ type: 'fault.update', id: f.id, patch: { kinematics: e.target.value } })}
                >
                  {KINEMATICS.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <ManualAttitude
                  value={f.manual}
                  onChange={(manual) => dispatch({ type: 'fault.update', id: f.id, patch: { manual } })}
                />
                {surf && (
                  <p className="mt-1 text-[11px] text-slate-600">
                    {surf.mean ? `${surf.mean.quadrant} (${surf.mean.dipDirNotation})` : 'sin actitud'} ·{' '}
                    {f.traces.length} traza(s)
                    {surf.quality !== 'ok' && <span className="ml-1 text-amber-600">⚠ {qualityText(surf.quality)}</span>}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      </Collapsible>

      <Collapsible title="Curvas de nivel" badge={project.contours.length} defaultOpen={false}>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <Field label="Equidistancia (m)">
            <input
              type="number"
              className={inputCls}
              value={project.settings.contourInterval}
              onChange={(e) =>
                dispatch({ type: 'settings', patch: { contourInterval: Number(e.target.value) || 100 } })
              }
            />
          </Field>
          <Field label="Próxima cota">
            <input
              type="number"
              className={inputCls}
              value={project.settings.lastElevation}
              onChange={(e) => dispatch({ type: 'settings', patch: { lastElevation: Number(e.target.value) || 0 } })}
            />
          </Field>
        </div>
        <ul className="max-h-56 space-y-1 overflow-y-auto text-xs">
          {project.contours.map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1">
              <input
                type="number"
                className="w-20 rounded border border-slate-300 px-1 py-0.5"
                value={c.elevation}
                onChange={(e) =>
                  dispatch({ type: 'contour.update', id: c.id, patch: { elevation: Number(e.target.value) || 0 } })
                }
              />
              <span className="flex-1 text-slate-500">{c.pts.length} pts</span>
              <Btn variant="ghost" onClick={() => dispatch({ type: 'contour.delete', id: c.id })}>
                <Trash2 size={13} />
              </Btn>
            </li>
          ))}
        </ul>
        {project.contours.length > 0 && (
          <Btn variant="danger" className="mt-2" onClick={() => dispatch({ type: 'contour.clear' })}>
            Borrar todas las curvas
          </Btn>
        )}
      </Collapsible>

      <Collapsible title="Perfiles" badge={project.sections.length} defaultOpen={false}>
        <ul className="space-y-1">
          {project.sections.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1.5">
              <input
                className="w-20 rounded border border-transparent px-1 text-sm hover:border-slate-300"
                value={s.name}
                onChange={(e) => dispatch({ type: 'section.update', id: s.id, patch: { name: e.target.value } })}
              />
              <Btn variant="primary" onClick={() => onOpenSection(s.id)}>
                Ver perfil
              </Btn>
              <Btn variant="ghost" onClick={() => dispatch({ type: 'section.delete', id: s.id })}>
                <Trash2 size={13} />
              </Btn>
            </li>
          ))}
          {project.sections.length === 0 && (
            <p className="text-xs text-slate-500">Usa la herramienta «Perfil» y traza una línea sobre el mapa.</p>
          )}
        </ul>
      </Collapsible>

      <Collapsible title="Pozos" badge={project.wells.length} defaultOpen={false}>
        <ul className="space-y-1">
          {project.wells.map((w) => (
            <li key={w.id} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1.5 text-sm">
              <span className="flex-1">{w.name}</span>
              <span className="text-xs text-slate-500">{w.depth} m</span>
              <Btn variant="ghost" onClick={() => dispatch({ type: 'well.delete', id: w.id })}>
                <Trash2 size={13} />
              </Btn>
            </li>
          ))}
          {project.wells.length === 0 && (
            <p className="text-xs text-slate-500">Con la herramienta «Pozo», toca el mapa donde quieras ubicarlo.</p>
          )}
        </ul>
      </Collapsible>
    </div>
  )
}

function ManualAttitude({ value, onChange }) {
  const on = Boolean(value)
  return (
    <div className="mt-1.5 flex items-center gap-2 text-xs">
      <label className="flex items-center gap-1 text-slate-600">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => onChange(e.target.checked ? { dipDir: 90, dip: 45 } : null)}
        />
        Actitud manual
      </label>
      {on && (
        <>
          <input
            type="number"
            className="w-16 rounded border border-slate-300 px-1 py-0.5"
            value={value.dipDir}
            title="Dirección de manteo (azimut)"
            onChange={(e) => onChange({ ...value, dipDir: Number(e.target.value) || 0 })}
          />
          <span className="text-slate-400">/</span>
          <input
            type="number"
            className="w-14 rounded border border-slate-300 px-1 py-0.5"
            value={value.dip}
            title="Manteo"
            onChange={(e) => onChange({ ...value, dip: Number(e.target.value) || 0 })}
          />
        </>
      )}
    </div>
  )
}

function qualityText(q) {
  return {
    'sin-datos': 'sin intersecciones con curvas',
    insuficiente: 'sólo un punto por cota',
    'una-cota': 'una sola cota resuelta',
    manual: 'actitud impuesta a mano',
    heredada: 'geometría heredada del contacto vecino',
  }[q] || q
}
