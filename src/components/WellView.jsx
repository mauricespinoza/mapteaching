import { useMemo, useRef } from 'react'
import { Download, Plus, Trash2 } from 'lucide-react'
import { buildWellModel } from '../lib/wells.js'
import { newWell, kinematicsOf } from '../lib/model.js'
import { fmtDistance, octant } from '../lib/georef.js'
import { downloadSvg, downloadSvgAsPng } from '../lib/exportFile.js'

/** Pozos: parámetros, columna estratigráfica esperada y trayectoria. */
export default function WellView({ project, scene, dispatch, selectedId, onSelect }) {
  const well = project.wells.find((w) => w.id === selectedId) || project.wells[0] || null
  const model = useMemo(
    () => (well && scene?.ready ? buildWellModel(well, scene) : null),
    [well, scene]
  )
  const svgRef = useRef(null)

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <aside className="w-full shrink-0 overflow-y-auto border-b border-slate-200 bg-white p-3 lg:w-80 lg:border-b-0 lg:border-r">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Pozos</h3>
          <button
            className="flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white"
            onClick={() => {
              const rect = project.image || project.virtualSize || { width: 1000, height: 800 }
              const w = newWell(project, [rect.width / 2, rect.height / 2])
              dispatch({ type: 'well.add', well: w })
              onSelect(w.id)
            }}
          >
            <Plus size={14} /> Nuevo
          </button>
        </div>
        <ul className="space-y-1">
          {project.wells.map((w) => (
            <li key={w.id}>
              <button
                className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                  w.id === well?.id ? 'bg-sky-100 text-sky-900' : 'hover:bg-slate-100'
                }`}
                onClick={() => onSelect(w.id)}
              >
                <span className="font-medium">{w.name}</span>
                <span className="block text-xs text-slate-500">
                  {w.depth} m · trend {w.trend}° · plunge {w.plunge}°
                </span>
              </button>
            </li>
          ))}
          {project.wells.length === 0 && (
            <li className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              Usa la herramienta «Pozo» en el mapa o crea uno aquí.
            </li>
          )}
        </ul>

        {well && (
          <div className="mt-4 space-y-2 border-t border-slate-200 pt-3">
            <Field label="Nombre">
              <input
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={well.name}
                onChange={(e) => dispatch({ type: 'well.update', id: well.id, patch: { name: e.target.value } })}
              />
            </Field>
            <Field label="Profundidad medida (m)">
              <input
                type="number"
                min="10"
                step="50"
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={well.depth}
                onChange={(e) =>
                  dispatch({ type: 'well.update', id: well.id, patch: { depth: Number(e.target.value) || 100 } })
                }
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Trend (azimut °)">
                <input
                  type="number"
                  min="0"
                  max="360"
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  value={well.trend}
                  onChange={(e) =>
                    dispatch({ type: 'well.update', id: well.id, patch: { trend: Number(e.target.value) || 0 } })
                  }
                />
              </Field>
              <Field label="Plunge (°)">
                <input
                  type="number"
                  min="1"
                  max="90"
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  value={well.plunge}
                  onChange={(e) =>
                    dispatch({ type: 'well.update', id: well.id, patch: { plunge: Number(e.target.value) || 90 } })
                  }
                />
              </Field>
            </div>
            <p className="text-xs text-slate-500">
              Plunge 90° = pozo vertical. La profundidad es medida a lo largo del pozo (MD).
            </p>
            <button
              className="flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs text-rose-700 hover:bg-rose-50"
              onClick={() => dispatch({ type: 'well.delete', id: well.id })}
            >
              <Trash2 size={14} /> Eliminar pozo
            </button>
          </div>
        )}
      </aside>

      <div className="flex-1 overflow-auto bg-slate-50 p-4">
        {!scene?.ready && <p className="text-sm text-slate-500">Define la escala del mapa para calcular el pozo.</p>}
        {scene?.ready && !well && <p className="text-sm text-slate-500">Crea un pozo para ver su columna.</p>}
        {model && (
          <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-700">Columna esperada</h4>
                <div className="flex gap-1">
                  <button
                    className="rounded border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
                    title="Descargar SVG"
                    onClick={() => downloadSvg(svgRef.current, `${well.name}.svg`)}
                  >
                    <Download size={14} />
                  </button>
                  <button
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    onClick={() => downloadSvgAsPng(svgRef.current, `${well.name}.png`)}
                  >
                    PNG
                  </button>
                </div>
              </div>
              <WellColumn model={model} svgRef={svgRef} />
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <h4 className="mb-2 text-sm font-semibold text-slate-700">Datos del pozo</h4>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <Row k="Cota de boca" v={`${model.surface[2].toFixed(0)} m s.n.m.`} />
                  <Row k="Profundidad (MD)" v={`${model.depth} m`} />
                  <Row k="Profundidad vertical" v={`${model.bottom.tvd.toFixed(0)} m`} />
                  <Row k="Cota de fondo" v={`${model.bottom.z.toFixed(0)} m`} />
                  <Row
                    k="Desplazamiento horizontal"
                    v={fmtDistance(Math.hypot(model.bottom.x - model.surface[0], model.bottom.y - model.surface[1]))}
                  />
                  <Row k="Dirección" v={`${well.trend}° (${octant(well.trend)})`} />
                </dl>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <h4 className="mb-2 text-sm font-semibold text-slate-700">Intersecciones</h4>
                <table className="w-full text-left text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="py-1">Rasgo</th>
                      <th>MD (m)</th>
                      <th>Prof. vertical</th>
                      <th>Cota</th>
                      <th>Actitud</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.markers.map((m, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="py-1">
                          <span
                            className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle"
                            style={{ background: m.kind === 'falla' ? kinematicsOf(m.kinematics).color : m.color }}
                          />
                          {m.name}
                        </td>
                        <td>{m.md.toFixed(0)}</td>
                        <td>{m.tvd.toFixed(0)}</td>
                        <td>{m.z.toFixed(0)}</td>
                        <td>{m.attitude ? m.attitude.dipDirNotation : '—'}</td>
                      </tr>
                    ))}
                    {model.markers.length === 0 && (
                      <tr>
                        <td colSpan="5" className="py-2 text-slate-500">
                          El pozo no corta contactos con la geometría actual.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <h4 className="mb-2 text-sm font-semibold text-slate-700">Espesores</h4>
                <table className="w-full text-left text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="py-1">Unidad</th>
                      <th>Desde (MD)</th>
                      <th>Hasta (MD)</th>
                      <th>Espesor en el pozo</th>
                      <th>Espesor real</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.column.map((c, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="py-1">
                          <span
                            className="mr-1.5 inline-block h-2.5 w-4 rounded-sm align-middle"
                            style={{ background: c.color }}
                          />
                          {c.name}
                        </td>
                        <td>{c.mdTop.toFixed(0)}</td>
                        <td>{c.mdBot.toFixed(0)}</td>
                        <td>{c.thicknessMd.toFixed(0)} m</td>
                        <td>{c.thicknessTrue ? `${c.thicknessTrue.toFixed(0)} m` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-slate-500">
                  El espesor real se corrige por el ángulo entre el pozo y el polo del contacto.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function WellColumn({ model, svgRef }) {
  const H = 520
  const W = 330
  const top = 34
  const bottom = H - 26
  const scale = (bottom - top) / model.depth
  const Y = (md) => top + md * scale
  const barX = 96
  const barW = 74
  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%">
      <rect x="0" y="0" width={W} height={H} fill="#ffffff" />
      <text x={barX + barW / 2} y="18" textAnchor="middle" fontSize="12" fontWeight="700" fill="#0f172a">
        {model.name}
      </text>
      <text x="10" y="18" fontSize="10" fill="#64748b">
        MD (m)
      </text>
      {model.column.map((c, i) => (
        <g key={i}>
          <rect
            x={barX}
            y={Y(c.mdTop)}
            width={barW}
            height={Math.max(1, Y(c.mdBot) - Y(c.mdTop))}
            fill={c.color}
            stroke="#0f172a"
            strokeWidth="0.8"
          />
          {Y(c.mdBot) - Y(c.mdTop) > 16 && (
            <text
              x={barX + barW + 8}
              y={(Y(c.mdTop) + Y(c.mdBot)) / 2 + 3}
              fontSize="10"
              fill="#0f172a"
            >
              {c.name}
            </text>
          )}
        </g>
      ))}
      {/* Escala de profundidad */}
      {ticksFor(model.depth).map((md) => (
        <g key={md}>
          <line x1={barX - 6} y1={Y(md)} x2={barX} y2={Y(md)} stroke="#475569" />
          <text x={barX - 10} y={Y(md) + 3} fontSize="9" fill="#475569" textAnchor="end">
            {md}
          </text>
        </g>
      ))}
      <line x1={barX} y1={top} x2={barX} y2={bottom} stroke="#475569" />
      {/* Marcadores */}
      {model.markers.map((m, i) => (
        <g key={i}>
          <line
            x1={barX - 2}
            y1={Y(m.md)}
            x2={barX + barW + 4}
            y2={Y(m.md)}
            stroke={m.kind === 'falla' ? '#dc2626' : '#0f172a'}
            strokeWidth={m.kind === 'falla' ? 2 : 1.4}
            strokeDasharray={m.kind === 'falla' ? '5 3' : undefined}
          />
          <text x={barX - 12} y={Y(m.md) - 3} fontSize="9" fill="#334155" textAnchor="end">
            {m.md.toFixed(0)}
          </text>
        </g>
      ))}
      <text x={barX + barW / 2} y={bottom + 16} textAnchor="middle" fontSize="9" fill="#64748b">
        Fondo {model.depth} m (cota {model.bottom.z.toFixed(0)} m)
      </text>
    </svg>
  )
}

function ticksFor(depth) {
  const step = depth > 3000 ? 500 : depth > 1200 ? 200 : depth > 500 ? 100 : 50
  const out = []
  for (let v = 0; v <= depth; v += step) out.push(v)
  return out
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  )
}

function Row({ k, v }) {
  return (
    <>
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-right font-medium text-slate-800">{v}</dd>
    </>
  )
}
