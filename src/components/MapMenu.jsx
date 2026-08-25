import { useState } from 'react'
import { Trash2, Layers, Ruler, Plus } from 'lucide-react'
import { inputCls } from './ui.jsx'
import { CONTACT_TYPES, KINEMATICS, reassignContact, sortedUnits } from '../lib/model.js'

/**
 * Menú de una pulsación larga sobre el mapa. En tablet no hay clic derecho ni
 * teclas, así que es la vía para lo que no cabe en el lienzo: reasignar un
 * contacto a otro par de unidades, cambiar la cinemática de una falla o la cota
 * de una curva, corregir un contorno estructural y borrar el rasgo entero.
 */
export default function MapMenu({ at, hit, project, dispatch, size, onClose, onAddSc, onSelect }) {
  if (!hit) return null
  const W = 268
  const left = Math.max(8, Math.min((size?.width || 800) - W - 8, at[0] - W / 2))
  const top = Math.max(8, Math.min((size?.height || 600) - 190, at[1] + 12))

  const close = () => onClose?.()
  const done = (fn) => () => {
    fn()
    close()
  }

  return (
    <>
      <div className="absolute inset-0 z-20" onPointerDown={close} />
      <div
        className="absolute z-30 w-[268px] rounded-2xl border border-slate-200 bg-white/97 p-2.5 shadow-2xl backdrop-blur"
        style={{ left, top }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Body hit={hit} project={project} dispatch={dispatch} done={done} onAddSc={onAddSc} onSelect={onSelect} />
        <button
          className="mt-2 w-full rounded-lg bg-slate-100 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200"
          onClick={close}
        >
          Cerrar
        </button>
      </div>
    </>
  )
}

function Body({ hit, project, dispatch, done, onAddSc, onSelect }) {
  if (hit.kind === 'contact') return <ContactMenu hit={hit} project={project} dispatch={dispatch} done={done} onAddSc={onAddSc} />
  if (hit.kind === 'fault') return <FaultMenu hit={hit} project={project} dispatch={dispatch} done={done} onAddSc={onAddSc} />
  if (hit.kind === 'contour') return <ContourMenu hit={hit} project={project} dispatch={dispatch} done={done} />
  if (hit.kind === 'sc') return <ScMenu hit={hit} project={project} dispatch={dispatch} done={done} onSelect={onSelect} />
  if (hit.kind === 'section') {
    const s = project.sections.find((x) => x.id === hit.id)
    return (
      <>
        <Head title={s?.name || 'Perfil'} sub="traza de perfil" />
        <Danger label="Borrar perfil" onClick={done(() => dispatch({ type: 'section.delete', id: hit.id }))} />
      </>
    )
  }
  if (hit.kind === 'well') {
    const w = project.wells.find((x) => x.id === hit.id)
    return (
      <>
        <Head title={w?.name || 'Pozo'} sub="pozo" />
        <Danger label="Borrar pozo" onClick={done(() => dispatch({ type: 'well.delete', id: hit.id }))} />
      </>
    )
  }
  if (hit.kind === 'model') {
    return (
      <>
        <Head title="Modelo estructural" sub="modelo sintético" />
        <Danger label="Borrar modelo" onClick={done(() => dispatch({ type: 'model.delete', id: hit.id }))} />
      </>
    )
  }
  return null
}

function ContactMenu({ hit, project, dispatch, done, onAddSc }) {
  const c = project.contacts.find((x) => x.id === hit.id)
  if (!c) return null
  const units = sortedUnits(project)
  const nTraces = c.traces.length
  const nSc = (c.structureContours || []).length
  const setPair = (lowerUnitId, upperUnitId) =>
    dispatch({ type: 'contact.update', id: c.id, patch: reassignContact(project, c, lowerUnitId, upperUnitId) })

  return (
    <>
      <Head title={c.name} sub={`contacto · ${nTraces} traza${nTraces === 1 ? '' : 's'}`} color={c.color} />
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Unidades que separa</p>
      <div className="mb-2 grid grid-cols-2 gap-1.5">
        <Labeled label="Abajo">
          <select
            className={inputCls}
            value={c.lowerUnitId || ''}
            onChange={(e) => setPair(e.target.value || null, c.upperUnitId)}
          >
            <option value="">—</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Arriba">
          <select
            className={inputCls}
            value={c.upperUnitId || ''}
            onChange={(e) => setPair(c.lowerUnitId, e.target.value || null)}
          >
            <option value="">—</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Labeled>
      </div>
      <Labeled label="Tipo de contacto">
        <select
          className={`${inputCls} mb-2`}
          value={c.type}
          onChange={(e) => dispatch({ type: 'contact.update', id: c.id, patch: { type: e.target.value } })}
        >
          {CONTACT_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </Labeled>
      <Action
        icon={Plus}
        label="Añadir contorno estructural"
        onClick={done(() => onAddSc?.({ kind: 'contact', id: c.id }))}
      />
      {nSc > 0 && (
        <Action
          icon={Layers}
          label={`Restaurar los ${nSc} contornos calculados`}
          onClick={done(() => dispatch({ type: 'sc.clear', kind: 'contact', id: c.id }))}
        />
      )}
      {hit.traceId && (
        <Danger
          label="Borrar esta traza"
          onClick={done(() => dispatch({ type: 'trace.delete', kind: 'contact', id: c.id, traceId: hit.traceId }))}
        />
      )}
      <Danger label="Borrar el contacto completo" onClick={done(() => dispatch({ type: 'contact.delete', id: c.id }))} />
    </>
  )
}

function FaultMenu({ hit, project, dispatch, done, onAddSc }) {
  const f = project.faults.find((x) => x.id === hit.id)
  if (!f) return null
  const nSc = (f.structureContours || []).length
  return (
    <>
      <Head title={f.name} sub={`falla · ${f.traces.length} traza${f.traces.length === 1 ? '' : 's'}`} />
      <Labeled label="Cinemática">
        <select
          className={`${inputCls} mb-2`}
          value={f.kinematics}
          onChange={(e) => dispatch({ type: 'fault.update', id: f.id, patch: { kinematics: e.target.value } })}
        >
          {KINEMATICS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </Labeled>
      <Action
        icon={Plus}
        label="Añadir contorno estructural"
        onClick={done(() => onAddSc?.({ kind: 'fault', id: f.id }))}
      />
      {nSc > 0 && (
        <Action
          icon={Layers}
          label={`Restaurar los ${nSc} contornos calculados`}
          onClick={done(() => dispatch({ type: 'sc.clear', kind: 'fault', id: f.id }))}
        />
      )}
      {hit.traceId && (
        <Danger
          label="Borrar esta traza"
          onClick={done(() => dispatch({ type: 'trace.delete', kind: 'fault', id: f.id, traceId: hit.traceId }))}
        />
      )}
      <Danger label="Borrar la falla completa" onClick={done(() => dispatch({ type: 'fault.delete', id: f.id }))} />
    </>
  )
}

function ContourMenu({ hit, project, dispatch, done }) {
  const c = project.contours.find((x) => x.id === hit.id)
  if (!c) return null
  const step = project.settings.contourInterval || 100
  const setZ = (elevation) => dispatch({ type: 'contour.update', id: c.id, patch: { elevation } })
  return (
    <>
      <Head title={`Curva de nivel ${c.elevation} m`} sub={`${c.pts.length} vértices`} />
      <Labeled label="Cota (m s.n.m.)">
        <div className="mb-2 flex items-center gap-1.5">
          <button
            className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs"
            title={`Bajar ${step} m`}
            onClick={() => setZ(c.elevation - step)}
          >
            −{step}
          </button>
          <input
            type="number"
            className={inputCls}
            value={c.elevation}
            onChange={(e) => setZ(Number(e.target.value))}
          />
          <button
            className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs"
            title={`Subir ${step} m`}
            onClick={() => setZ(c.elevation + step)}
          >
            +{step}
          </button>
        </div>
      </Labeled>
      <Danger label="Borrar la curva" onClick={done(() => dispatch({ type: 'contour.delete', id: c.id }))} />
    </>
  )
}

/**
 * Contorno estructural. Si aún es el que calcula el motor, cambiar la cota o
 * moverlo obliga a fijarlo primero: `onSelect` lo materializa junto con los
 * demás contornos de esa cota, para no perder el otro limbo del pliegue.
 */
function ScMenu({ hit, project, dispatch, done, onSelect }) {
  const it = hit.it
  const key = it.kind === 'fault' ? 'faults' : 'contacts'
  const feature = project[key].find((x) => x.id === it.featureId)
  // El contorno puede fijarse desde este mismo menú, y entonces `hit.it` se
  // queda viejo: el id vivo se guarda aquí.
  const [scId, setScId] = useState(it.manualId)
  const sc = scId ? (feature?.structureContours || []).find((x) => x.id === scId) : null
  const z = sc ? sc.elevation : it.elevation
  const step = project.settings.contourInterval || 100
  const setZ = (elevation) => {
    let id = sc?.id
    if (!id) {
      id = onSelect?.(it)
      setScId(id)
    }
    if (id) dispatch({ type: 'sc.update', kind: it.kind, id: it.featureId, scId: id, patch: { elevation } })
  }
  return (
    <>
      <Head
        title={`Contorno ${z} m`}
        sub={`${it.name}${it.block != null ? ` · bloque ${it.block}` : ''}${sc ? ' · editado' : ' · calculado'}`}
        color={it.color}
      />
      <p className="mb-2 rounded-lg bg-slate-50 px-2 py-1.5 text-[10.5px] leading-relaxed text-slate-600">
        {sc ? (
          <>Arrastra sus extremos en el mapa para corregirlo. El motor recalcula el manteo con la curva puesta aquí.</>
        ) : (
          <>
            Es el contorno que calcula el motor a partir de {it.n} punto{it.n === 1 ? '' : 's'}. Al moverlo o cambiarle
            la cota pasas a mandar tú sobre esa cota.
          </>
        )}
      </p>
      <Labeled label="Cota estructural (m s.n.m.)">
        <div className="mb-2 flex items-center gap-1.5">
          <button
            className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs"
            title={`Bajar ${step} m`}
            onClick={() => setZ(z - step)}
          >
            −{step}
          </button>
          <input
            type="number"
            className={inputCls}
            value={z}
            onChange={(e) => setZ(Number(e.target.value))}
          />
          <button
            className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs"
            title={`Subir ${step} m`}
            onClick={() => setZ(z + step)}
          >
            +{step}
          </button>
        </div>
      </Labeled>
      {!sc && (
        <Action
          icon={Ruler}
          label="Fijar y editar este contorno"
          onClick={done(() => setScId(onSelect?.(it)))}
        />
      )}
      {sc && (
        <Danger
          label="Borrar este contorno"
          onClick={done(() => dispatch({ type: 'sc.delete', kind: it.kind, id: it.featureId, scId: sc.id }))}
        />
      )}
      {feature?.structureContours?.length > 0 && (
        <Action
          icon={Layers}
          label="Restaurar los contornos calculados"
          onClick={done(() => dispatch({ type: 'sc.clear', kind: it.kind, id: it.featureId }))}
        />
      )}
    </>
  )
}

function Head({ title, sub, color }) {
  return (
    <div className="mb-2 flex items-start gap-2 border-b border-slate-100 pb-1.5">
      {color && <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />}
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-slate-800">{title}</p>
        {sub && <p className="truncate text-[10.5px] text-slate-500">{sub}</p>}
      </div>
    </div>
  )
}

/**
 * Rótulo de un control. Es un `div` y no un `label` a propósito: algunas filas
 * llevan varios botones y un `label` que los envuelve a todos le pone su texto
 * como nombre accesible al primero, que entonces se anuncia mal.
 */
function Labeled({ label, children }) {
  return (
    <div className="block">
      <span className="mb-0.5 block text-[10px] font-medium text-slate-500">{label}</span>
      {children}
    </div>
  )
}

function Action({ icon: Icon, label, onClick }) {
  return (
    <button
      className="mb-1 flex w-full items-center gap-2 rounded-lg bg-slate-100 px-2.5 py-2 text-left text-[11.5px] font-medium text-slate-700 hover:bg-slate-200"
      onClick={onClick}
    >
      <Icon size={14} /> {label}
    </button>
  )
}

function Danger({ label, onClick }) {
  return (
    <button
      className="mb-1 flex w-full items-center gap-2 rounded-lg bg-rose-50 px-2.5 py-2 text-left text-[11.5px] font-medium text-rose-700 hover:bg-rose-100"
      onClick={onClick}
    >
      <Trash2 size={14} /> {label}
    </button>
  )
}
