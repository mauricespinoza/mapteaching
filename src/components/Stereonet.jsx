import { useMemo, useState } from 'react'
import { kinematicsOf } from '../lib/model.js'
import { surfaceSummary } from '../lib/scene.js'

// Estereograma equiareal (red de Schmidt), hemisferio inferior.
//
// Es la forma de ver de un vistazo si las unidades son concordantes: sus polos
// se agrupan. Un polo apartado del racimo delata una discordancia; polos
// repartidos en un círculo máximo delatan un pliegue, y ese círculo es el perfil
// del pliegue —su polo es el eje—.
//
// Proyección equiareal y no equiangular a propósito: es la que no deforma las
// densidades, así que un racimo apretado se ve apretado.

const RAD = Math.PI / 180
const R = 128

/** Recta de rumbo/inmersión a coordenadas del estereograma. */
function project(trend, plunge) {
  // r = R·√2·sen(45° − inmersión/2): vertical al centro, horizontal al borde.
  const r = R * Math.SQRT2 * Math.sin((45 - plunge / 2) * RAD)
  return [r * Math.sin(trend * RAD), -r * Math.cos(trend * RAD)]
}

/** Vector unitario (x este, y norte, z arriba) a rumbo/inmersión, hacia abajo. */
function toTrendPlunge(v) {
  let [x, y, z] = v
  if (z > 0) {
    x = -x
    y = -y
    z = -z
  }
  const h = Math.hypot(x, y)
  const trend = (Math.atan2(x, y) / RAD + 360) % 360
  const plunge = (Math.atan2(-z, h) / RAD)
  return [trend, plunge]
}

/** Círculo máximo de un plano: todas sus rectas, proyectadas. */
function greatCircle(dip, dipDir, steps = 72) {
  const d = dip * RAD
  const f = dipDir * RAD
  const strike = [-Math.cos(f), Math.sin(f), 0]
  const down = [Math.sin(f) * Math.cos(d), Math.cos(f) * Math.cos(d), -Math.sin(d)]
  const pts = []
  for (let i = 0; i <= steps; i++) {
    const a = (-90 + (180 * i) / steps) * RAD
    const v = [
      Math.cos(a) * strike[0] + Math.sin(a) * down[0],
      Math.cos(a) * strike[1] + Math.sin(a) * down[1],
      Math.cos(a) * strike[2] + Math.sin(a) * down[2],
    ]
    const [t, p] = toTrendPlunge(v)
    pts.push(project(t, p))
  }
  return pts
}

/** Polo del plano: su normal, en el hemisferio inferior. */
const poleOf = (dip, dipDir) => project((dipDir + 180) % 360, 90 - dip)

/** Todo lo que hay que dibujar: un plano por limbo y por bloque. */
function collect(scene) {
  const out = []
  const rows = surfaceSummary(scene)
  for (const r of rows) {
    const unit = r.kind === 'contacto' ? scene.units.find((u) => u.id === contactUpper(scene, r.id)) : null
    const color = r.kind === 'falla' ? kinematicsOf(r.kinematics).color : unit?.color || r.color || '#0f172a'
    const atts = r.surf.folded
      ? r.surf.domainAttitudes.filter((d) => d.dip != null).map((d, i) => ({ ...d, limb: i }))
      : r.surf.mean
        ? [{ ...r.surf.mean, limb: null }]
        : []
    for (const a of atts) {
      out.push({
        key: `${r.kind}:${r.id}:${r.block}:${a.limb ?? 'm'}`,
        kind: r.kind,
        name: r.name,
        block: r.block,
        limb: a.limb,
        color,
        dip: a.dip,
        dipDir: a.dipDir,
        quadrant: a.quadrant,
        dipDirNotation: a.dipDirNotation,
      })
    }
  }
  return out
}

const contactUpper = (scene, contactId) => scene.contacts.find((c) => c.id === contactId)?.upperUnitId

export default function Stereonet({ scene }) {
  const data = useMemo(() => (scene?.ready ? collect(scene) : []), [scene])
  const [showPlanes, setShowPlanes] = useState(true)
  const [showPoles, setShowPoles] = useState(true)
  const [hover, setHover] = useState(null)

  if (!data.length) {
    return (
      <p className="text-xs text-slate-500">
        Todavía no hay ninguna actitud resuelta: hacen falta al menos dos contornos estructurales de un mismo
        rasgo.
      </p>
    )
  }

  const S = R + 26
  const spokes = [0, 30, 60, 90, 120, 150]
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-3 text-[11px] text-slate-600">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showPlanes} onChange={(e) => setShowPlanes(e.target.checked)} />
          Planos (círculos máximos)
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showPoles} onChange={(e) => setShowPoles(e.target.checked)} />
          Polos
        </label>
      </div>
      <svg viewBox={`${-S} ${-S} ${2 * S} ${2 * S}`} width="100%" style={{ maxWidth: 380 }}>
        <circle cx="0" cy="0" r={R} fill="#ffffff" stroke="#334155" strokeWidth="1.6" />
        {/* Círculos de igual inmersión cada 30°, en equiárea */}
        {[30, 60].map((p) => (
          <circle
            key={p}
            cx="0"
            cy="0"
            r={R * Math.SQRT2 * Math.sin((45 - p / 2) * RAD)}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth="1"
          />
        ))}
        {spokes.map((a) => {
          const [x, y] = project(a, 0)
          return <line key={a} x1={x} y1={y} x2={-x} y2={-y} stroke="#e2e8f0" strokeWidth="1" />
        })}
        <g fontSize="11" fill="#475569" fontFamily="ui-sans-serif, system-ui" textAnchor="middle">
          <text x="0" y={-R - 8}>N</text>
          <text x={R + 12} y="4">E</text>
          <text x="0" y={R + 16}>S</text>
          <text x={-R - 12} y="4">W</text>
        </g>
        {showPlanes &&
          data.map((d) => (
            <polyline
              key={`gc-${d.key}`}
              points={greatCircle(d.dip, d.dipDir).map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}
              fill="none"
              stroke={d.color}
              strokeWidth={hover === d.key ? 3 : 1.6}
              strokeDasharray={d.kind === 'falla' ? '6 3' : undefined}
              opacity={hover && hover !== d.key ? 0.25 : 0.9}
            />
          ))}
        {showPoles &&
          data.map((d) => {
            const [x, y] = poleOf(d.dip, d.dipDir)
            return (
              <g key={`p-${d.key}`} onMouseEnter={() => setHover(d.key)} onMouseLeave={() => setHover(null)}>
                <circle
                  cx={x}
                  cy={y}
                  r={hover === d.key ? 6.5 : 4.5}
                  fill={d.color}
                  stroke="#fff"
                  strokeWidth="1.4"
                  opacity={hover && hover !== d.key ? 0.35 : 1}
                />
                <title>
                  {d.name}
                  {d.limb != null ? ` · limbo ${d.limb + 1}` : ''}
                  {d.block != null ? ` · bloque ${d.block}` : ''} — {d.quadrant}
                </title>
              </g>
            )
          })}
      </svg>
      <ul className="mt-2 space-y-0.5 text-[11px]">
        {data.map((d) => (
          <li
            key={`l-${d.key}`}
            className={`flex items-center gap-1.5 rounded px-1 ${hover === d.key ? 'bg-slate-100' : ''}`}
            onMouseEnter={() => setHover(d.key)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
            <span className="text-slate-700">{d.name}</span>
            {d.limb != null && <span className="text-slate-400">limbo {d.limb + 1}</span>}
            {d.block != null && <span className="text-slate-400">bloque {d.block}</span>}
            <span className="ml-auto font-mono text-slate-600">{d.dipDirNotation}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 rounded-lg bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-600">
        Red de Schmidt (equiareal), hemisferio inferior. Cada plano es un círculo máximo y su <b>polo</b> el punto
        que lo representa. Unidades concordantes tienen polos agrupados; un polo apartado del racimo es una
        discordancia. Si los polos de un mismo contacto se reparten a lo largo de un círculo máximo, la superficie
        está plegada y el polo de ese círculo es el eje del pliegue.
      </p>
    </div>
  )
}
