import { useState } from 'react'
import { Trash2, Layers, Ruler, Plus, FlipHorizontal2, ArrowLeftRight } from 'lucide-react'
import { inputCls, ColorSwatch } from './ui.jsx'
import { CONTACT_TYPES, KINEMATICS, reassignContact, sortedUnits, newStructureContour } from '../lib/model.js'

/**
 * Menú de una pulsación larga sobre el mapa. En tablet no hay clic derecho ni
 * teclas, así que es la vía para lo que no cabe en el lienzo: reasignar un
 * contacto a otro par de unidades, cambiar la cinemática de una falla o la cota
 * de una curva, corregir un contorno estructural y borrar el rasgo entero.
 */
export default function MapMenu({ at, hit, project, dispatch, size, onClose, onAddSc, onSelect }) {
  if (!hit) return null
  const W = 268
  const H = size?.height || 600
  // Se ancla en la parte alta-media de la pantalla, no junto al punto tocado:
  // así nunca queda a medio abrir contra el borde inferior, sea cual sea la
  // altura del contenido (algunos menús —contactos, contornos— traen varias
  // filas). El alto máximo con scroll interno es la última red de seguridad
  // si aun así no cupiera entero.
  const left = Math.max(8, Math.min((size?.width || 800) - W - 8, at[0] - W / 2))
  const top = Math.max(8, Math.round(H * 0.12))
  const maxHeight = Math.max(160, H - top - 8)

  const close = () => onClose?.()
  const done = (fn) => () => {
    fn()
    close()
  }

  return (
    <>
      <div className="absolute inset-0 z-20" onPointerDown={close} />
      <div
        className="absolute z-30 w-[268px] overflow-y-auto rounded-2xl border border-slate-200 bg-white/97 p-2.5 shadow-2xl backdrop-blur"
        style={{ left, top, maxHeight }}
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
  if (hit.kind === 'dike') return <DikeMenu hit={hit} project={project} dispatch={dispatch} done={done} onAddSc={onAddSc} />
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

/**
 * Menú de un contacto. La reasignación de unidades es lo delicado: un contacto
 * agrupa todas las trazas que separan el mismo par —y la digitalización
 * automática cuelga de uno solo todas las líneas del mapa—, así que cambiar el
 * par del contacto cambiaba de golpe todas sus líneas. Aquí el cambio se aplica
 * por defecto **sólo a la línea tocada**, que se muda al contacto de ese par (o
 * a uno nuevo); quien quiera el cambio en bloque lo pide en el selector.
 */
function ContactMenu({ hit, project, dispatch, done, onAddSc }) {
  const [scope, setScope] = useState('trace')
  // La traza puede haberse mudado a otro contacto al reasignarla, así que el
  // dueño se busca por la traza y no por el id con el que se abrió el menú:
  // el menú sigue a la línea que se está tocando.
  const c =
    (hit.traceId && project.contacts.find((x) => x.traces.some((t) => t.id === hit.traceId))) ||
    project.contacts.find((x) => x.id === hit.id)
  if (!c) return null
  const units = sortedUnits(project)
  const nTraces = c.traces.length
  const nSc = (c.structureContours || []).length
  const porTraza = Boolean(hit.traceId) && nTraces > 1 && scope === 'trace'
  const setPair = (lowerUnitId, upperUnitId) => {
    if (porTraza) dispatch({ type: 'trace.reassign', id: c.id, traceId: hit.traceId, lowerUnitId, upperUnitId })
    else dispatch({ type: 'contact.update', id: c.id, patch: reassignContact(project, c, lowerUnitId, upperUnitId) })
  }

  return (
    <>
      <Head title={c.name} sub={`contacto · ${nTraces} traza${nTraces === 1 ? '' : 's'}`} color={c.color} />
      <div className="mb-2 flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
        <ColorSwatch
          value={c.color}
          onChange={(color) => dispatch({ type: 'contact.update', id: c.id, patch: { color } })}
          title="Color de la traza de este contacto"
          label={`Color del contacto ${c.name}`}
          size={26}
        />
        <span className="text-[10.5px] leading-tight text-slate-600">Color de la traza</span>
      </div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Unidades que separa</p>
      {hit.traceId && nTraces > 1 && (
        <div className="mb-1.5 flex gap-1 rounded-lg bg-slate-100 p-0.5">
          {[
            ['trace', 'Sólo esta línea'],
            ['contact', `Las ${nTraces} líneas`],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setScope(id)}
              className={`flex-1 rounded-md px-1.5 py-1 text-[10.5px] font-medium transition ${
                scope === id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
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
      {porTraza && (
        <p className="mb-2 rounded-lg bg-sky-50 px-2 py-1.5 text-[10.5px] leading-relaxed text-sky-800">
          La línea tocada pasará al contacto de ese par de unidades —o a uno nuevo si aún no existe—. Las otras{' '}
          {nTraces - 1} de este contacto se quedan como están.
        </p>
      )}
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

/**
 * Menú de un dique. Lo propio de un dique es que la traza tocada pertenece a
 * **una de sus dos paredes**: de ahí que aquí se pueda mudar de pared —el
 * remedio cuando un trazo fue a parar al borde equivocado— y que el contorno
 * estructural se añada a la pared tocada y no al cuerpo.
 */
function DikeMenu({ hit, project, dispatch, done, onAddSc }) {
  const d = (project.dikes || []).find((x) => x.id === hit.id)
  if (!d) return null
  const wall = d.walls.find((w) => w.id === hit.wallId) || d.walls[0]
  const other = d.walls.find((w) => w.id !== wall.id)
  const nSc = (wall.structureContours || []).length
  return (
    <>
      <Head
        title={d.name}
        sub={`dique · ${wall.name} · ${d.walls.map((w) => w.traces.length).join(' + ')} trazas`}
        color={d.color}
      />
      <div className="mb-2 flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
        <ColorSwatch
          value={d.color}
          onChange={(color) => dispatch({ type: 'dike.update', id: d.id, patch: { color } })}
          title="Color del dique"
          label={`Color del dique ${d.name}`}
          size={26}
        />
        <span className="text-[10.5px] leading-tight text-slate-600">Color del cuerpo</span>
      </div>
      <Labeled label="Litología">
        <input
          className={`${inputCls} mb-2`}
          placeholder="Andesita, pórfido…"
          value={d.lithology || ''}
          onChange={(e) => dispatch({ type: 'dike.update', id: d.id, patch: { lithology: e.target.value } })}
        />
      </Labeled>
      {hit.traceId && other && (
        <Action
          icon={ArrowLeftRight}
          label={`Mover esta línea a «${other.name}»`}
          onClick={done(() => dispatch({ type: 'dike.moveTrace', id: d.id, traceId: hit.traceId }))}
        />
      )}
      <Action
        icon={FlipHorizontal2}
        label="Intercambiar las dos paredes"
        onClick={done(() => dispatch({ type: 'dike.swapWalls', id: d.id }))}
      />
      <Action
        icon={Plus}
        label={`Añadir contorno estructural a ${wall.name}`}
        onClick={done(() => onAddSc?.({ kind: 'dike', id: d.id, wallId: wall.id }))}
      />
      {nSc > 0 && (
        <Action
          icon={Layers}
          label={`Restaurar los ${nSc} contornos calculados`}
          onClick={done(() => dispatch({ type: 'sc.clear', kind: 'dike', id: d.id, wallId: wall.id }))}
        />
      )}
      {hit.traceId && (
        <Danger
          label="Borrar esta traza"
          onClick={done(() =>
            dispatch({ type: 'trace.delete', kind: 'dike', id: d.id, wallId: wall.id, traceId: hit.traceId })
          )}
        />
      )}
      <Danger label="Borrar el dique completo" onClick={done(() => dispatch({ type: 'dike.delete', id: d.id }))} />
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
 * Contorno estructural. Si aún es el que calcula el motor, cambiar la cota,
 * moverlo o reasignarlo obliga a fijarlo primero: `onSelect` lo materializa
 * junto con los demás contornos de esa cota, para no perder el otro limbo del
 * pliegue.
 */
function ScMenu({ hit, project, dispatch, done, onSelect }) {
  const it = hit.it
  // Dónde vive el contorno: en el contacto, en la falla o —en un dique— en una
  // de sus dos paredes, que es la que de verdad guarda sus contornos.
  const dike = it.kind === 'dike' ? (project.dikes || []).find((d) => d.id === it.featureId) : null
  const owners = dike ? dike.walls : it.kind === 'fault' ? project.faults : project.contacts
  const wallId = it.wallId || null
  // El contorno puede fijarse desde este mismo menú, y puede mudarse a otro
  // contacto al reasignarlo: el dueño se busca por el id vivo del contorno, no
  // por el `featureId` con el que se abrió el menú, que se queda atrás en
  // cuanto se reasigna —igual que la traza en ContactMenu.
  const [scId, setScId] = useState(it.manualId)
  const owner = scId ? owners.find((x) => (x.structureContours || []).some((s) => s.id === scId)) : null
  const feature = owner || owners.find((x) => x.id === (wallId || it.featureId))
  const sc = scId ? (feature?.structureContours || []).find((x) => x.id === scId) : null
  const z = sc ? sc.elevation : it.elevation
  const step = project.settings.contourInterval || 100
  // Fija el contorno si todavía es el calculado por el motor, y devuelve su id
  // vivo y el del contacto que lo tiene en ese momento: lo necesitan tanto
  // `setZ` como `setPair` antes de despachar su cambio.
  const fix = () => {
    if (sc) return { id: sc.id, ownerId: dike ? dike.id : feature.id }
    const id = onSelect?.(it)
    setScId(id)
    return { id, ownerId: it.featureId }
  }
  const setZ = (elevation) => {
    const { id, ownerId } = fix()
    if (id) dispatch({ type: 'sc.update', kind: it.kind, id: ownerId, wallId, scId: id, patch: { elevation } })
  }
  const units = it.kind === 'contact' ? sortedUnits(project) : null
  const ownerId = dike ? dike.id : feature?.id
  const setPair = (lowerUnitId, upperUnitId) => {
    const { id, ownerId } = fix()
    if (id) dispatch({ type: 'sc.reassign', id: ownerId, scId: id, lowerUnitId, upperUnitId })
  }
  const name = feature?.name || it.name
  return (
    <>
      <Head
        title={`Contorno ${z} m`}
        sub={`${name}${it.block != null ? ` · bloque ${it.block}` : ''}${sc ? ' · editado' : ' · calculado'}`}
        color={it.color}
      />
      <p className="mb-2 rounded-lg bg-slate-50 px-2 py-1.5 text-[10.5px] leading-relaxed text-slate-600">
        {sc ? (
          <>Arrastra sus extremos en el mapa para corregirlo. El motor recalcula el manteo con la curva puesta aquí.</>
        ) : (
          <>
            Es el contorno que calcula el motor a partir de {it.n} punto{it.n === 1 ? '' : 's'}. Al moverlo, cambiarle
            la cota o reasignarlo pasas a mandar tú sobre él; «Borrar este contorno» lo quita del todo, sin dejar uno
            a mano en su lugar.
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
      {units && (
        <>
          <Labeled label="Unidades que separa aquí">
            <div className="mb-1.5 grid grid-cols-2 gap-1.5">
              <select
                className={inputCls}
                value={feature?.lowerUnitId || ''}
                onChange={(e) => setPair(e.target.value || null, feature?.upperUnitId)}
              >
                <option value="">Abajo: —</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              <select
                className={inputCls}
                value={feature?.upperUnitId || ''}
                onChange={(e) => setPair(feature?.lowerUnitId, e.target.value || null)}
              >
                <option value="">Arriba: —</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </Labeled>
          <p className="mb-2 rounded-lg bg-sky-50 px-2 py-1.5 text-[10.5px] leading-relaxed text-sky-800">
            Cambiar cualquiera de las dos muda <b>sólo este contorno</b> al contacto de ese par —o crea uno nuevo
            si todavía no existe—. El resto de «{name}» se queda como está.
          </p>
        </>
      )}
      {!sc && (
        <Action
          icon={Ruler}
          label="Fijar y editar este contorno"
          onClick={done(() => setScId(onSelect?.(it)))}
        />
      )}
      {sc ? (
        <Danger
          label="Borrar este contorno"
          onClick={done(() => dispatch({ type: 'sc.delete', kind: it.kind, id: ownerId, wallId, scId: sc.id }))}
        />
      ) : (
        // El calculado no se quita: se excluye. Su cota queda fuera del
        // ajuste —igual que si se hubiera fijado y borrado— pero sin dejar un
        // contorno a mano en su lugar, así que el motor no lo vuelve a poner.
        <Danger
          label="Borrar este contorno"
          onClick={done(() =>
            dispatch({
              type: 'sc.add',
              kind: it.kind,
              id: it.featureId,
              wallId,
              items: [newStructureContour(it.elevation, [it.a, it.b], { excluded: true })],
            })
          )}
        />
      )}
      {feature?.structureContours?.length > 0 && (
        <Action
          icon={Layers}
          label="Restaurar los contornos calculados"
          onClick={done(() => dispatch({ type: 'sc.clear', kind: it.kind, id: ownerId, wallId }))}
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
