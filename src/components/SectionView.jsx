import { useMemo, useRef } from 'react'
import { Download, Image as ImageIcon } from 'lucide-react'
import { buildSectionModel } from '../lib/section.js'
import { kinematicsOf } from '../lib/model.js'
import { fmtDistance, octant } from '../lib/georef.js'
import { downloadSvg, downloadSvgAsPng } from '../lib/exportFile.js'

const M = { left: 62, right: 26, top: 34, bottom: 46 }

/** Vista de perfil estructural (SVG exportable). */
export default function SectionView({ project, scene, section, dispatch }) {
  const svgRef = useRef(null)
  const model = useMemo(
    () => (section && scene?.ready ? buildSectionModel(section, scene) : null),
    [section, scene]
  )

  if (!section) {
    return <Empty text="Dibuja una traza de perfil en el mapa (herramienta «Perfil») y selecciónala aquí." />
  }
  if (!scene?.ready) return <Empty text="Primero define la escala del mapa." />
  if (!model) return <Empty text="La traza del perfil no es válida." />

  const W = 980
  const plotW = W - M.left - M.right
  const xScale = plotW / model.length
  const yScale = xScale * (section.vExag || 1)
  const zTop = Math.ceil((model.topoMax + 100) / 100) * 100
  const zBot = model.bottom
  const plotH = Math.max(160, (zTop - zBot) * yScale)
  const H = plotH + M.top + M.bottom
  const X = (d) => M.left + d * xScale
  const Y = (z) => M.top + (zTop - z) * yScale
  const poly = (pts) => pts.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')

  const [nameA, nameB] = (section.name || 'A–A′').split('–')
  const zTicks = niceTicks(zBot, zTop, 8)
  const dTicks = niceTicks(0, model.length, 8)

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 text-sm">
        <span className="font-semibold text-slate-800">{section.name}</span>
        <span className="text-slate-500">
          Az {model.azimuth.toFixed(0)}° ({octant(model.azimuth)}) · {fmtDistance(model.length)}
        </span>
        <label className="flex items-center gap-1 text-slate-600">
          Exag. vertical
          <input
            type="number"
            min="0.2"
            max="10"
            step="0.2"
            value={section.vExag || 1}
            onChange={(e) =>
              dispatch({ type: 'section.update', id: section.id, patch: { vExag: Number(e.target.value) || 1 } })
            }
            className="w-16 rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-1 text-slate-600">
          Profundidad (m)
          <input
            type="number"
            min="100"
            step="100"
            value={section.depth}
            onChange={(e) =>
              dispatch({ type: 'section.update', id: section.id, patch: { depth: Number(e.target.value) || 1000 } })
            }
            className="w-24 rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <div className="ml-auto flex gap-2">
          <button
            className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
            onClick={() => downloadSvg(svgRef.current, `${section.name}.svg`)}
          >
            <Download size={15} /> SVG
          </button>
          <button
            className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
            onClick={() => downloadSvgAsPng(svgRef.current, `${section.name}.png`)}
          >
            <ImageIcon size={15} /> PNG
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-slate-50 p-4">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: 1400 }}>
          <rect x="0" y="0" width={W} height={H} fill="#ffffff" />
          {/* Marco y ejes */}
          <g stroke="#cbd5e1" strokeWidth="1">
            {zTicks.map((z) => (
              <line key={z} x1={M.left} y1={Y(z)} x2={W - M.right} y2={Y(z)} />
            ))}
          </g>
          <g fontSize="10" fill="#475569" fontFamily="ui-sans-serif, system-ui">
            {zTicks.map((z) => (
              <text key={z} x={M.left - 8} y={Y(z) + 3} textAnchor="end">
                {z}
              </text>
            ))}
            {dTicks.map((d) => (
              <text key={d} x={X(d)} y={H - M.bottom + 16} textAnchor="middle">
                {d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${d.toFixed(0)} m`}
              </text>
            ))}
            <text x={16} y={M.top + plotH / 2} transform={`rotate(-90 16 ${M.top + plotH / 2})`} textAnchor="middle">
              Cota (m s.n.m.)
            </text>
            <text x={M.left + plotW / 2} y={H - 8} textAnchor="middle">
              Distancia a lo largo del perfil
            </text>
          </g>

          <clipPath id="sectionClip">
            <rect x={M.left} y={M.top} width={plotW} height={plotH} />
          </clipPath>

          <g clipPath="url(#sectionClip)">
            {/* Unidades */}
            {model.units.map((u) =>
              u.polys.map((p, i) => (
                <polygon key={`${u.id}-${i}`} points={poly(p)} fill={u.color} fillOpacity="0.75" stroke="none" />
              ))
            )}
            {/* Contactos proyectados sobre la topografía (erosionados) */}
            {model.contacts.map((c) =>
              c.air.map((l, i) => (
                <polyline
                  key={`${c.id}-air-${i}`}
                  points={poly(l)}
                  fill="none"
                  stroke={c.color}
                  strokeWidth="1.2"
                  strokeDasharray="4 4"
                  opacity="0.7"
                />
              ))
            )}
            {/* Contactos */}
            {model.contacts.map((c) =>
              c.lines.map((l, i) => (
                <polyline
                  key={`${c.id}-${i}`}
                  points={poly(l)}
                  fill="none"
                  stroke={c.color}
                  strokeWidth="2.2"
                  strokeDasharray={c.type === 'discordante' ? '10 4' : c.type === 'intrusivo' ? '3 3' : undefined}
                />
              ))
            )}
            {/* Fallas */}
            {model.faults.map((f, i) => {
              const kin = kinematicsOf(f.kinematics)
              return (
                <g key={`${f.faultId}-${i}`}>
                  <line
                    x1={X(f.line[0][0])}
                    y1={Y(f.line[0][1])}
                    x2={X(f.line[1][0])}
                    y2={Y(f.line[1][1])}
                    stroke="#111827"
                    strokeWidth="3.4"
                  />
                  <line
                    x1={X(f.line[0][0])}
                    y1={Y(f.line[0][1])}
                    x2={X(f.line[1][0])}
                    y2={Y(f.line[1][1])}
                    stroke={kin.color}
                    strokeWidth="2"
                  />
                  {slipArrows(f, X, Y)}
                </g>
              )
            })}
            {/* Topografía */}
            <polyline points={poly(model.topoLine)} fill="none" stroke="#0f172a" strokeWidth="2.4" />
            {/* Pozos proyectados */}
            {model.wells.map((w) => (
              <WellOnSection key={w.id} w={w} model={model} scene={scene} X={X} Y={Y} />
            ))}
          </g>

          <rect x={M.left} y={M.top} width={plotW} height={plotH} fill="none" stroke="#0f172a" strokeWidth="1.2" />
          <text x={M.left} y={M.top - 12} fontSize="15" fontWeight="700" fill="#4c1d95">
            {nameA || 'A'}
          </text>
          <text x={W - M.right} y={M.top - 12} fontSize="15" fontWeight="700" fill="#4c1d95" textAnchor="end">
            {nameB || "A'"}
          </text>
          <text x={M.left + plotW / 2} y={M.top - 12} fontSize="11" fill="#64748b" textAnchor="middle">
            Exageración vertical ×{section.vExag || 1}
          </text>
        </svg>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <h4 className="mb-2 text-sm font-semibold text-slate-700">Unidades en el perfil</h4>
            <div className="flex flex-wrap gap-3 text-xs">
              {model.units.map((u) => (
                <span key={u.id} className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-5 rounded-sm" style={{ background: u.color }} />
                  {u.name}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <h4 className="mb-2 text-sm font-semibold text-slate-700">Fallas cortadas</h4>
            {model.faults.length === 0 && <p className="text-xs text-slate-500">El perfil no corta fallas.</p>}
            <ul className="space-y-1 text-xs text-slate-600">
              {model.faults.map((f, i) => (
                <li key={i}>
                  <span className="font-medium">{f.name}</span> · {kinematicsOf(f.kinematics).label} · manteo real{' '}
                  {f.dip.toFixed(0)}° hacia {octant(f.dipDir)} · aparente en el perfil {f.apparentDip.toFixed(0)}° ·
                  distancia {fmtDistance(f.d)}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Los contactos se proyectan con los contornos estructurales de cada bloque: el desplazamiento a través de
          las fallas surge de la solución por bloques. Las líneas punteadas sobre la topografía muestran los
          horizontes ya erosionados.
        </p>
      </div>
    </div>
  )
}

function WellOnSection({ w, model, scene, X, Y }) {
  const { well } = w
  const p0 = { d: w.d, z: null }
  const rad = Math.PI / 180
  const dirZ = -Math.sin(well.plunge * rad)
  const horiz = Math.cos(well.plunge * rad)
  const az = well.trend
  const along = Math.cos((az - model.azimuth) * rad) * horiz
  const z0 = interpTopo(model, w.d)
  p0.z = z0
  const end = { d: w.d + along * well.depth, z: z0 + dirZ * well.depth }
  void scene
  return (
    <g>
      <line x1={X(p0.d)} y1={Y(p0.z)} x2={X(end.d)} y2={Y(end.z)} stroke="#78350f" strokeWidth="2.4" />
      <circle cx={X(p0.d)} cy={Y(p0.z)} r="4" fill="#f59e0b" stroke="#78350f" strokeWidth="1.5" />
      <text x={X(p0.d)} y={Y(p0.z) - 10} fontSize="11" fontWeight="600" fill="#78350f" textAnchor="middle">
        {w.name}
      </text>
    </g>
  )
}

function interpTopo(model, d) {
  const i = Math.max(1, Math.min(model.ds.length - 1, model.ds.findIndex((x) => x >= d)))
  const d0 = model.ds[i - 1]
  const d1 = model.ds[i]
  const t = d1 === d0 ? 0 : (d - d0) / (d1 - d0)
  return model.topo[i - 1] + (model.topo[i] - model.topo[i - 1]) * t
}

/** Flechas de movimiento relativo sobre la falla. */
function slipArrows(f, X, Y) {
  const kind = f.kinematics || ''
  const mid = [(f.line[0][0] + f.line[1][0]) / 2, (f.line[0][1] + f.line[1][1]) / 2]
  const dx = f.line[1][0] - f.line[0][0]
  const dy = f.line[1][1] - f.line[0][1]
  const l = Math.hypot(dx, dy) || 1
  const u = [dx / l, dy / l]
  const n = [-u[1], u[0]]
  const sx = X(mid[0] + n[0] * 40) - X(mid[0])
  const sy = Y(mid[1] + n[1] * 40) - Y(mid[1])
  const px = X(mid[0])
  const py = Y(mid[1])
  const arrows = []
  const sign = kind.startsWith('inversa') ? -1 : 1
  if (kind.startsWith('normal') || kind.startsWith('inversa')) {
    for (const s of [1, -1]) {
      const bx = px + sx * 0.35 * s
      const by = py + sy * 0.35 * s
      const dxx = (X(mid[0] + u[0] * 40) - px) * 0.6 * s * sign
      const dyy = (Y(mid[1] + u[1] * 40) - py) * 0.6 * s * sign
      arrows.push(
        <line key={`a${s}`} x1={bx} y1={by} x2={bx + dxx} y2={by + dyy} stroke="#111827" strokeWidth="2"
          markerEnd="url(#slipArrow)" />
      )
    }
  }
  return (
    <>
      <defs>
        <marker id="slipArrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 Z" fill="#111827" />
        </marker>
      </defs>
      {arrows}
    </>
  )
}

function niceTicks(min, max, count) {
  const span = max - min
  if (!(span > 0)) return [min]
  const raw = span / count
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((k) => k * pow).find((v) => v >= raw) || pow * 10
  const out = []
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100)
  return out
}

function Empty({ text }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-slate-500">{text}</div>
  )
}
