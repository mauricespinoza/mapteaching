import { Download } from 'lucide-react'
import { surfaceSummary } from '../lib/scene.js'
import { fmtDistance } from '../lib/georef.js'
import { kinematicsOf } from '../lib/model.js'
import { downloadText } from '../lib/exportFile.js'
import { Btn } from './ui.jsx'

/** Rumbo y manteo por pares de contornos estructurales consecutivos. */
export default function ResultsPanel({ scene, project }) {
  if (!scene?.ready) {
    return (
      <div className="p-4 text-sm text-slate-500">
        Calibra la escala del mapa para calcular contornos estructurales.
      </div>
    )
  }
  const rows = surfaceSummary(scene)
  const withData = rows.filter((r) => r.surf.structureContours.some((s) => s.fit) || r.surf.mean)

  return (
    <div className="h-full overflow-y-auto bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Resultados estructurales</h3>
        <Btn onClick={() => downloadText(`${project.name}-actitudes.csv`, toCsv(rows), 'text/csv')}>
          <Download size={13} /> CSV
        </Btn>
      </div>

      {withData.length === 0 && (
        <p className="text-xs text-slate-500">
          Digitaliza curvas de nivel y al menos un contacto: los puntos donde el contacto cruza cada curva definen
          los contornos estructurales.
        </p>
      )}

      <div className="space-y-3">
        {withData.map((r, i) => (
          <div key={i} className="rounded-xl border border-slate-200 p-2.5">
            <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ background: r.kind === 'falla' ? kinematicsOf(r.kinematics).color : r.color || '#0f172a' }}
              />
              <span className="text-sm font-semibold text-slate-800">{r.name}</span>
              {r.block != null && <span className="text-xs text-slate-500">bloque {r.block}</span>}
              <span className="text-xs uppercase tracking-wide text-slate-400">{r.kind}</span>
            </div>
            {r.surf.mean && (
              <p className="mb-1.5 text-xs text-slate-700">
                <span className="font-medium">Promedio:</span> {r.surf.mean.quadrant} ·{' '}
                <span className="font-mono">{r.surf.mean.dipDirNotation}</span>
                {r.surf.mean.manual && <span className="ml-1 text-amber-600">(manual)</span>}
                {r.surf.plane && !r.surf.mean.manual && (
                  <span className="ml-1 text-slate-400">· ajuste plano RMS {r.surf.plane.rms.toFixed(0)} m</span>
                )}
              </p>
            )}
            {r.surf.pairs.length > 0 ? (
              <table className="w-full text-left text-[11px]">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-0.5">Contornos</th>
                    <th>Rumbo</th>
                    <th>Manteo</th>
                    <th>Dir/mant.</th>
                    <th>Separación</th>
                  </tr>
                </thead>
                <tbody>
                  {r.surf.pairs.map((p, k) => (
                    <tr key={k} className="border-t border-slate-100">
                      <td className="py-0.5 font-mono">
                        {p.z1}–{p.z2}
                      </td>
                      <td>{p.quadrant.split(' / ')[0]}</td>
                      <td>{p.dip.toFixed(1)}°</td>
                      <td className="font-mono">{p.dipDirNotation}</td>
                      <td>{fmtDistance(p.spacing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-[11px] text-amber-600">
                No hay pares de contornos consecutivos: hacen falta al menos dos cotas con dos intersecciones cada
                una.
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">
        <p className="mb-1 font-semibold text-slate-700">Cómo se calcula</p>
        Cada punto donde un contacto cruza una curva de nivel es un punto de la superficie con cota conocida. La
        recta ajustada a los puntos de igual cota es el <em>contorno estructural</em>; su dirección da el rumbo.
        Entre dos contornos consecutivos, manteo = arctan(Δcota / separación horizontal), y la dirección de manteo
        apunta hacia el contorno de menor cota.
      </div>
    </div>
  )
}

function toCsv(rows) {
  const head = 'rasgo,tipo,bloque,cota_1,cota_2,rumbo_cuadrante,rumbo_azimut,manteo,dir_manteo,separacion_m'
  const lines = [head]
  for (const r of rows) {
    for (const p of r.surf.pairs) {
      lines.push(
        [
          `"${r.name}"`,
          r.kind,
          r.block ?? '',
          p.z1,
          p.z2,
          `"${p.quadrant.split(' / ')[0]}"`,
          p.strikeAz.toFixed(1),
          p.dip.toFixed(1),
          p.dipDir.toFixed(1),
          p.spacing.toFixed(1),
        ].join(',')
      )
    }
    if (r.surf.mean) {
      lines.push(
        [
          `"${r.name} (promedio)"`,
          r.kind,
          r.block ?? '',
          '',
          '',
          `"${r.surf.mean.quadrant.split(' / ')[0]}"`,
          r.surf.mean.strikeAz.toFixed(1),
          r.surf.mean.dip.toFixed(1),
          r.surf.mean.dipDir.toFixed(1),
          '',
        ].join(',')
      )
    }
  }
  return lines.join('\n')
}
