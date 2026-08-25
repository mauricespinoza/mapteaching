import { AlertTriangle, Ruler } from 'lucide-react'
import { surfaceSummary } from '../lib/scene.js'
import { fmtDistance, octant } from '../lib/georef.js'

const RAD = Math.PI / 180

/**
 * Sección pedagógica: muestra, con el triángulo que se dibuja a mano, cómo se
 * obtienen el manteo y el espesor a partir de dos contornos estructurales.
 * Sin escala horizontal calibrada no hay distancia real y no se puede calcular.
 */
export default function ThicknessPanel({ scene, project }) {
  const hasScale = Boolean(project.georef?.metersPerPx)

  if (!hasScale) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
        <p className="flex items-start gap-2 text-xs leading-relaxed text-amber-900">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            <b>Falta la escala horizontal del mapa.</b> El manteo y el espesor salen de comparar una
            diferencia de cotas (en metros, que ya conoces por las curvas de nivel) con una distancia medida
            sobre el mapa. Sin saber cuántos metros mide esa distancia, el triángulo no se puede resolver:
            usa la herramienta «Escala gráfica» y traza una línea de largo conocido.
          </span>
        </p>
      </div>
    )
  }

  const rows = surfaceSummary(scene).filter((r) => r.surf.pairs.length)

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">
        <p className="mb-1 flex items-center gap-1.5 font-semibold text-slate-700">
          <Ruler size={13} /> De dónde sale cada número
        </p>
        Dos contornos estructurales consecutivos son dos rectas de cota conocida sobre la misma superficie.
        La diferencia de cotas <b>Δh</b> y la separación horizontal <b>d</b> medida perpendicular al rumbo
        forman un triángulo rectángulo: el ángulo entre la hipotenusa y la horizontal es el <b>manteo</b>.
        El espesor de una unidad se obtiene del mismo triángulo, midiendo perpendicular a las capas.
      </div>

      {rows.length === 0 && (
        <p className="px-1 text-xs text-slate-500">
          Todavía no hay pares de contornos estructurales consecutivos con los que construir el triángulo.
        </p>
      )}

      {rows.map((r, i) => (
        <div key={i} className="rounded-xl border border-slate-200 p-3">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-slate-800">{r.name}</span>
            {r.block != null && <span className="text-xs text-slate-500">bloque {r.block}</span>}
          </div>
          {r.surf.pairs.slice(0, 3).map((p, k) => (
            <Triangle key={k} pair={p} />
          ))}
          {r.surf.pairs.length > 3 && (
            <p className="mt-1 text-[11px] text-slate-400">
              …y {r.surf.pairs.length - 3} par(es) más en la tabla de resultados.
            </p>
          )}
        </div>
      ))}

      <ThicknessNote project={project} scene={scene} />
    </div>
  )
}

/** Triángulo rectángulo cota–distancia–manteo, a escala. */
function Triangle({ pair }) {
  const W = 300
  const H = 120
  const pad = { l: 40, r: 14, t: 12, b: 26 }
  const bw = W - pad.l - pad.r
  const bh = H - pad.t - pad.b
  // El triángulo se dibuja con la proporción real siempre que quepa.
  const ratio = Math.abs(pair.dz) / Math.max(1e-6, pair.spacing)
  const drawH = Math.min(bh, bw * ratio)
  const drawW = ratio > 0 ? Math.min(bw, drawH / ratio) : bw
  const x0 = pad.l
  const y0 = pad.t + bh
  const x1 = x0 + drawW
  const y1 = y0 - drawH

  return (
    <div className="mb-2 rounded-lg bg-white">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block">
        <polygon points={`${x0},${y0} ${x1},${y0} ${x1},${y1}`} fill="#e0f2fe" stroke="#0284c7" strokeWidth="1.5" />
        <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="#0f172a" strokeWidth="2" />
        {/* Ángulo de manteo */}
        <path
          d={`M ${x0 + 26} ${y0} A 26 26 0 0 0 ${x0 + 26 * Math.cos(Math.atan(ratio))} ${
            y0 - 26 * Math.sin(Math.atan(ratio))
          }`}
          fill="none"
          stroke="#b45309"
          strokeWidth="1.4"
        />
        <text x={x0 + 31} y={y0 - 9} fontSize="10" fontWeight="700" fill="#b45309">
          {pair.dip.toFixed(1)}°
        </text>
        {/* Cotas */}
        <text x={x0 - 4} y={y0 + 4} fontSize="9" fill="#475569" textAnchor="end">
          {pair.z1}
        </text>
        <text x={x1 + 4} y={y1 + 4} fontSize="9" fill="#475569">
          {pair.z2}
        </text>
        {/* Catetos */}
        <text x={(x0 + x1) / 2} y={y0 + 16} fontSize="9.5" fill="#0f172a" textAnchor="middle">
          d = {fmtDistance(pair.spacing)}
        </text>
        <text
          x={x1 + 6}
          y={(y0 + y1) / 2}
          fontSize="9.5"
          fill="#0f172a"
          transform={`rotate(90 ${x1 + 6} ${(y0 + y1) / 2})`}
          textAnchor="middle"
        >
          Δh = {Math.abs(pair.dz).toFixed(0)} m
        </text>
      </svg>
      <p className="px-1 pb-1 text-[11px] leading-relaxed text-slate-600">
        <span className="font-mono">
          tan({pair.dip.toFixed(1)}°) = {Math.abs(pair.dz).toFixed(0)} m / {pair.spacing.toFixed(0)} m ={' '}
          {(Math.abs(pair.dz) / pair.spacing).toFixed(3)}
        </span>
        <br />
        Contornos {pair.z1} y {pair.z2} m · manteo {pair.dip.toFixed(1)}° hacia {octant(pair.dipDir)}.
      </p>
    </div>
  )
}

/** Cómo se pasa de la separación en el mapa al espesor real de una unidad. */
function ThicknessNote({ project, scene }) {
  const units = scene.units
  if (units.length < 1) return null
  // Manteo representativo: el de la primera superficie resuelta.
  const rows = surfaceSummary(scene).filter((r) => r.surf.mean)
  const dip = rows.length ? rows[0].surf.mean.dip : null

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <h4 className="mb-1.5 text-xs font-semibold text-slate-700">Del mapa al espesor real</h4>
      <p className="mb-2 text-[11px] leading-relaxed text-slate-600">
        El espesor de una unidad es la distancia <b>perpendicular</b> entre su base y su techo, no la que se
        mide en el mapa. Con las capas inclinadas un ángulo δ:
      </p>
      <ul className="space-y-1 text-[11px] text-slate-700">
        <li>
          <span className="font-mono">e = L · sen δ</span> — si <b>L</b> es la distancia horizontal entre los
          dos contactos medida en el mapa, perpendicular al rumbo.
        </li>
        <li>
          <span className="font-mono">e = V · cos δ</span> — si <b>V</b> es la diferencia de cotas entre base
          y techo en un mismo punto (por ejemplo, en un pozo vertical).
        </li>
      </ul>
      {dip != null && (
        <p className="mt-2 rounded-lg bg-white px-2 py-1.5 text-[11px] text-slate-600">
          Con el manteo medio de este ejercicio ({dip.toFixed(0)}°): una franja de{' '}
          <b>{fmtDistance(1000)}</b> medida en el mapa equivale a un espesor real de{' '}
          <b>{fmtDistance(1000 * Math.sin(dip * RAD))}</b>.
        </p>
      )}
      <p className="mt-2 text-[11px] text-slate-500">
        Escala actual: 1 px ≈ {project.georef.metersPerPx.toFixed(2)} m.
      </p>
    </div>
  )
}
