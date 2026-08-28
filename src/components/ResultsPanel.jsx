import { useMemo, useState } from 'react'
import { Download, Compass, Move3d } from 'lucide-react'
import { surfaceSummary } from '../lib/scene.js'
import { fmtDistance } from '../lib/georef.js'
import { kinematicsOf } from '../lib/model.js'
import { faultSlip } from '../lib/slip.js'
import { frameTest } from '../lib/models.js'
import { downloadText } from '../lib/exportFile.js'
import { Btn } from './ui.jsx'
import ThicknessPanel from './ThicknessPanel.jsx'
import Stereonet from './Stereonet.jsx'

/** Rumbo y manteo por pares de contornos estructurales consecutivos. */
export default function ResultsPanel({ scene, project }) {
  if (!scene?.ready) {
    return (
      <div className="h-full overflow-y-auto p-3">
        <ThicknessPanel scene={scene} project={project} />
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
            {r.surf.folded ? (
              <div className="mb-1.5">
                <p className="text-xs font-medium text-slate-700">
                  Manteo variable · {r.surf.domainAttitudes.filter((d) => d.dip != null).length} limbos
                </p>
                <p className="text-[10px] leading-snug text-slate-500">
                  Los puntos no caben en un solo plano: se resuelven por separado.
                </p>
                <ul className="mt-0.5 space-y-0.5 text-[11px] text-slate-600">
                  {r.surf.domainAttitudes.map((d, k) =>
                    d.dip == null ? null : (
                      <li key={k}>
                        <span className="font-medium text-slate-700">{limbName(k)}:</span> {d.quadrant} ·{' '}
                        <span className="font-mono">{d.dipDirNotation}</span>
                        <span className="ml-1 text-slate-400">
                          · {d.n} datos · RMS {d.rms.toFixed(0)} m
                        </span>
                      </li>
                    )
                  )}
                </ul>
              </div>
            ) : (
              r.surf.mean && (
                <p className="mb-1.5 text-xs text-slate-700">
                  <span className="font-medium">Promedio:</span> {r.surf.mean.quadrant} ·{' '}
                  <span className="font-mono">{r.surf.mean.dipDirNotation}</span>
                  {r.surf.mean.manual && <span className="ml-1 text-amber-600">(manual)</span>}
                  {!r.surf.mean.manual && Number.isFinite(r.surf.mean.rms) && (
                    <span className="ml-1 text-slate-400">· ajuste plano RMS {r.surf.mean.rms.toFixed(0)} m</span>
                  )}
                </p>
              )
            )}
            {r.surf.inherited && <InheritedNote info={r.surf.inherited} />}
            {r.surf.manualContours?.length > 0 && (
              <p className="mb-1.5 rounded-lg bg-sky-50 px-2 py-1.5 text-[11px] leading-relaxed text-sky-900">
                <b>
                  {r.surf.manualContours.length} contorno{r.surf.manualContours.length === 1 ? '' : 's'} puesto
                  {r.surf.manualContours.length === 1 ? '' : 's'} a mano
                </b>{' '}
                ({r.surf.manualContours.map((m) => `${m.elevation} m`).join(', ')}). En esas cotas manda la curva
                dibujada: el motor descarta ahí sus propios cruces con las curvas de nivel y recalcula el resto con
                ella.
              </p>
            )}
            {unresolvedLimbs(r.surf) > 0 && (
              <p className="mb-1.5 text-[11px] text-slate-500">
                {unresolvedLimbs(r.surf)} contorno(s) de otro limbo con una sola cota: dan rumbo, no manteo.
              </p>
            )}
            {r.surf.pairs.length > 0 ? (
              <table className="w-full text-left text-[11px]">
                <thead className="text-slate-500">
                  <tr>
                    {r.surf.folded && <th className="py-0.5">Limbo</th>}
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
                      {r.surf.folded && <td className="py-0.5">{limbName(p.limb)}</td>}
                      <td className="py-0.5 font-mono">
                        {p.z1}–{p.z2}
                        {p.manual && (
                          <span className="ml-1 font-sans text-sky-600" title="Con un contorno puesto a mano">
                            ✎
                          </span>
                        )}
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
              !r.surf.inherited && (
                <p className="text-[11px] text-amber-600">
                  No hay pares de contornos consecutivos: hacen falta al menos dos cotas con dos intersecciones
                  cada una.
                </p>
              )
            )}
          </div>
        ))}
      </div>

      <StereonetSection scene={scene} />
      <SlipSection scene={scene} project={project} />

      <h3 className="mb-2 mt-6 border-t border-slate-200 pt-4 text-sm font-semibold text-slate-700">
        Cómo se obtienen manteo y espesor
      </h3>
      <ThicknessPanel scene={scene} project={project} />

      <div className="mt-4 rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">
        <p className="mb-1 font-semibold text-slate-700">Cómo se calcula</p>
        Cada punto donde un contacto cruza una curva de nivel es un punto de la superficie con cota conocida. La
        recta ajustada a los puntos de igual cota es el <em>contorno estructural</em>; su dirección da el rumbo.
        Entre dos contornos consecutivos, manteo = arctan(Δcota / separación horizontal), y la dirección de manteo
        apunta hacia el contorno de menor cota.
        <p className="mt-1.5">
          Antes de ajustar nada, los puntos se reparten en <em>limbos</em>: la forma en que la traza cruza el
          relieve —la regla de las V— da la dirección de manteo local, y sólo se unen los puntos compatibles con un
          mismo plano. Así una charnela no promedia los dos flancos, y dos ondas de un tren de pliegues no comparten
          contorno aunque manteen igual.
        </p>
      </div>
    </div>
  )
}

/**
 * Contacto que no se resuelve con sus propios datos y sigue al contacto vecino
 * manteniendo el espesor. El espesor sale de un ajuste, así que se publica con
 * los datos que lo sostienen y su desajuste.
 */
function InheritedNote({ info }) {
  const shaky = Number.isFinite(info.rms) && info.rms > Math.max(0.25 * info.thickness, 1)
  return (
    <div className="mb-1.5 rounded-lg bg-sky-50 px-2 py-1.5 text-[11px] leading-relaxed text-sky-900">
      {info.upgrade ? (
        <>
          <b>Manteo medido, forma prestada.</b> Sus contornos estructurales dan un manteo, pero no cómo varía: la
          geometría en profundidad sigue el pliegue de{' '}
        </>
      ) : (
        <>
          <b>Geometría heredada.</b> No hay contornos estructurales suficientes para resolver este contacto por sí
          solo, así que sigue {info.folded ? 'el pliegue' : 'la geometría'} de{' '}
        </>
      )}
      <b>«{info.name}»</b> (el contacto de encima) con un espesor constante de{' '}
      <b>{fmtDistance(info.thickness)}</b> medido perpendicular a las capas.
      <p className="mt-0.5 text-sky-800">
        Espesor ajustado con {info.n} punto{info.n === 1 ? '' : 's'}{' '}
        {info.source === 'curvas' ? 'de corte con las curvas de nivel' : 'de su traza leída sobre el relieve'}
        {Number.isFinite(info.rms) && <> · desajuste RMS {info.rms.toFixed(0)} m</>}.
      </p>
      {shaky && (
        <p className="mt-0.5 text-amber-700">
          ⚠ Los datos de este contacto no encajan bien con un espesor constante: revisa la traza o impón la
          actitud a mano.
        </p>
      )}
    </div>
  )
}

/** Dominios que sólo tienen una cota: aportan rumbo pero no manteo. */
function unresolvedLimbs(surf) {
  if (!surf.domainAttitudes || surf.domainAttitudes.length < 2) return 0
  return surf.domainAttitudes.filter((d) => d.dip == null && d.n >= 2).length
}

/** Nombre corto de un limbo para las tablas. */
function limbName(k) {
  return `Limbo ${k + 1}`
}

/** Estereograma, detrás de un botón: ocupa sitio y no siempre hace falta. */
function StereonetSection({ scene }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Estereograma</h3>
        <Btn onClick={() => setOpen((o) => !o)} variant={open ? 'dark' : 'default'}>
          <Compass size={13} /> {open ? 'Ocultar' : 'Ver estereograma'}
        </Btn>
      </div>
      {open ? (
        <Stereonet scene={scene} />
      ) : (
        <p className="text-[11px] text-slate-500">
          Polos y planos de cada unidad en una red de Schmidt, con el color de la unidad: enseña de un vistazo
          qué es concordante y qué no.
        </p>
      )}
    </div>
  )
}

/**
 * Salto de cada falla.
 *
 * Se separan a propósito dos cosas que se confunden todo el rato: la
 * **separación**, que es lo que el mapa mide y cambia con cada unidad, y el
 * **salto neto**, que es el movimiento real y es uno solo para toda la falla.
 */
function SlipSection({ scene, project }) {
  const [open, setOpen] = useState(false)
  const inArea = useMemo(() => frameTest(scene), [scene])
  const faults = useMemo(
    () => (open && scene?.ready ? project.faults.map((f) => faultSlip(scene, f.id, { inArea })).filter(Boolean) : []),
    [open, scene, project, inArea]
  )
  if (!project.faults.length) return null
  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Salto de las fallas</h3>
        <Btn onClick={() => setOpen((o) => !o)} variant={open ? 'dark' : 'default'}>
          <Move3d size={13} /> {open ? 'Ocultar' : 'Calcular saltos'}
        </Btn>
      </div>
      {!open && (
        <p className="text-[11px] text-slate-500">
          Separación de cada unidad a través de cada falla y el salto neto que las explica a todas.
        </p>
      )}
      {open &&
        faults.map((f) => (
          <div key={f.faultId} className="mb-3 rounded-xl border border-slate-200 p-2.5">
            <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ background: kinematicsOf(f.kinematics).color }}
              />
              <span className="text-sm font-semibold text-slate-800">{f.name}</span>
              <span className="text-xs text-slate-500">{f.attitude.quadrant}</span>
            </div>
            {f.rows.some((r) => r.cutoff) ? (
              <table className="w-full text-left text-[11px]">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-0.5">Unidad</th>
                    <th title="Separación medida perpendicular a la línea de corte, dentro del plano de falla">
                      Sep. en el plano
                    </th>
                    <th title="Diferencia de cota del contacto a un lado y otro, en la falla">Sep. vertical</th>
                    <th title="Salto que haría falta si la falla fuese de puro buzamiento">Si fuese buz. puro</th>
                    <th title="Cuánto se aparta esta unidad del salto único que explica a todas">Residuo</th>
                  </tr>
                </thead>
                <tbody>
                  {f.rows.map((r) => (
                    <tr key={r.contactId} className="border-t border-slate-100">
                      <td className="py-0.5">
                        <span
                          className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                          style={{ background: r.color || '#94a3b8' }}
                        />
                        {r.name}
                      </td>
                      {r.cutoff ? (
                        <>
                          <td>{fmtDistance(Math.abs(r.cutoff.h))}</td>
                          <td>
                            {Number.isFinite(r.verticalSeparation) ? fmtDistance(Math.abs(r.verticalSeparation)) : '—'}
                          </td>
                          <td>{r.dipSlipOnly == null ? '—' : fmtDistance(Math.abs(r.dipSlipOnly))}</td>
                          <td className={Math.abs(r.residual ?? 0) > 40 ? 'font-semibold text-amber-700' : ''}>
                            {Number.isFinite(r.residual) ? fmtDistance(Math.abs(r.residual)) : '—'}
                          </td>
                        </>
                      ) : (
                        <td colSpan="4" className="text-slate-400">
                          {r.both ? r.note : 'sólo resuelta a un lado de la falla'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-[11px] text-amber-600">
                Ninguna unidad está resuelta a los dos lados de esta falla: sin el mismo contacto en los dos
                bloques no hay separación que medir. Digitaliza su traza también al otro lado.
              </p>
            )}
            {f.net && <NetSlip net={f.net} used={f.used} rows={f.rows} />}
          </div>
        ))}
      {open && (
        <div className="rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">
          <p className="mb-1 font-semibold text-slate-700">Separación no es salto</p>
          La <b>separación</b> es lo que el mapa mide: cuánto se ha corrido el mismo contacto a un lado y otro.
          Depende de la orientación de ese contacto, así que cada unidad da un número distinto y ninguno es «el
          salto». El <b>salto neto</b> es el vector que une dos puntos que antes estaban juntos; es uno solo para
          toda la falla, porque los bloques se mueven enteros.
          <p className="mt-1.5">
            Se calcula con la construcción de las <b>líneas de corte</b>: la intersección de cada contacto con el
            plano de falla es una línea en ese plano, y hay una en cada bloque. El salto es el vector del plano que
            lleva una sobre la otra. Una sola línea no basta —el salto puede deslizarse a lo largo de ella—, así
            que hacen falta dos de orientación distinta.
          </p>
        </div>
      )}
    </div>
  )
}

function NetSlip({ net, used, rows }) {
  const withCut = rows.filter((r) => r.cutoff)
  const mismatch = Math.max(0, ...withCut.map((r) => r.cutoff.mismatch))
  const spread = Math.max(0, ...withCut.map((r) => Math.abs(r.residual || 0)))
  return (
    <div className="mt-2 rounded-lg bg-sky-50 px-2 py-1.5 text-[11px] leading-relaxed text-sky-900">
      <b>Salto neto {fmtDistance(net.magnitude)}</b> · cabeceo {net.rake.toFixed(0)}° en el plano ·{' '}
      {fmtDistance(Math.abs(net.dipSlip))} de buzamiento y {fmtDistance(Math.abs(net.strikeSlip))} de rumbo.
      <div className="text-sky-800">
        Componente vertical {fmtDistance(net.throw)} · horizontal {fmtDistance(net.heave)} · resuelto con{' '}
        {used} unidad{used === 1 ? '' : 'es'}.
      </div>
      {!net.determined && (
        <p className="mt-0.5 text-amber-700">
          ⚠ <b>No está determinado.</b> Todas las líneas de corte son casi paralelas —capas paralelas dan cortes
          paralelos—, así que los datos sólo fijan la componente perpendicular a ellas: el salto puede deslizarse a
          lo largo de la línea de corte sin cambiar nada de lo que se ve. Lo que se publica es el <b>menor</b>
          {' '}salto compatible con el mapa, que es una cota inferior. Para fijarlo hace falta un segundo rasgo con
          otra orientación: un contacto discordante, un dique o el eje de un pliegue cortado por la falla.
        </p>
      )}
      {spread > 40 && (
        <p className="mt-0.5 text-amber-700">
          ⚠ Las unidades no se ponen de acuerdo: hasta {fmtDistance(spread)} de diferencia entre lo que cada una
          pide y el salto único. Un bloque se mueve entero, así que eso no lo produce la falla — es que alguna
          superficie está mal resuelta junto a ella, casi siempre por falta de traza a uno de los dos lados.
        </p>
      )}
      {mismatch > 12 && (
        <p className="mt-0.5 text-amber-700">
          ⚠ Las líneas de corte de los dos bloques no son paralelas (hasta {mismatch.toFixed(0)}° de diferencia).
          Un desplazamiento rígido no puede producir eso: o las superficies están mal resueltas cerca de la falla,
          o hay rotación o arrastre. Toma estos números como orientativos.
        </p>
      )}
    </div>
  )
}

function toCsv(rows) {
  const head = 'rasgo,tipo,bloque,limbo,cota_1,cota_2,rumbo_cuadrante,rumbo_azimut,manteo,dir_manteo,separacion_m'
  const lines = [head]
  for (const r of rows) {
    for (const p of r.surf.pairs) {
      lines.push(
        [
          `"${r.name}"`,
          r.kind,
          r.block ?? '',
          p.limb + 1,
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
          `"${r.name}${r.surf.inherited ? ` (heredado de ${r.surf.inherited.name})` : ' (promedio)'}"`,
          r.kind,
          r.block ?? '',
          r.surf.mean.limb != null ? r.surf.mean.limb + 1 : '',
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
