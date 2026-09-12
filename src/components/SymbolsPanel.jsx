import { RotateCcw } from 'lucide-react'
import { Collapsible, ColorSwatch, Btn } from './ui.jsx'
import { KINEMATICS, symbolsOf, DEFAULT_SYMBOLS } from '../lib/model.js'

/**
 * Capas cuyo grosor de línea se puede escalar. El multiplicador vive por
 * capa (ver `widthScale`), no un valor absoluto: así una falla sigue
 * dibujándose más gruesa que un contacto aunque las dos se hayan movido, que
 * es la jerarquía visual con la que ya se lee cualquier mapa de la app.
 */
const WIDTH_ROWS = [
  ['contacts', 'Contactos'],
  ['faults', 'Fallas'],
  ['dikes', 'Diques'],
  ['foldAxes', 'Ejes de pliegue'],
  ['structureContours', 'Contornos estructurales'],
  ['contours', 'Curvas de nivel'],
]

/**
 * Pestaña de simbología: de qué color va cada tipo de falla y el eje de
 * pliegue, y cuán grueso se dibuja cada capa. Es la leyenda de un mapa a
 * mano hecha ajustable, para la clase que necesita distinguir algo que el
 * color o el grosor de siempre no separan bien —o para que se lea al
 * proyectar o imprimir—.
 *
 * Cambia sólo el dibujo: la geología no se entera de qué color se pintó una
 * falla normal, así que esto no toca el motor ni el modelo, sólo
 * `project.settings.symbols` (ver `symbolsOf` en `model.js`).
 */
export default function SymbolsPanel({ project, dispatch }) {
  const sym = symbolsOf(project)
  const setPatch = (patch) => dispatch({ type: 'symbols', patch })

  const setFaultColor = (id, color) => setPatch({ faultColors: { ...sym.faultColors, [id]: color } })
  const resetFaultColor = (id) => {
    const next = { ...sym.faultColors }
    delete next[id]
    setPatch({ faultColors: next })
  }
  const setWidth = (key, v) => setPatch({ widths: { ...sym.widths, [key]: v } })
  const anyCustomColor = Object.keys(sym.faultColors).length > 0
  const anyCustomWidth = Object.values(sym.widths).some((v) => Math.abs((v ?? 1) - 1) > 1e-6)
  const foldChanged = sym.foldAxisColor !== DEFAULT_SYMBOLS.foldAxisColor
  const resetAll = () => setPatch({ faultColors: {}, foldAxisColor: DEFAULT_SYMBOLS.foldAxisColor, widths: {} })

  return (
    <div className="h-full overflow-y-auto">
      <Collapsible title="Colores de falla" badge={anyCustomColor ? 'personalizado' : null}>
        <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
          El color de cada cinemática, en el mapa, el perfil, el 3D, el estereograma y la columna de un
          pozo. Se puede volver al de siempre fila por fila.
        </p>
        <div className="space-y-1.5">
          {KINEMATICS.map((k) => {
            const custom = sym.faultColors[k.id]
            return (
              <div key={k.id} className="flex items-center gap-2">
                <ColorSwatch
                  value={custom || k.color}
                  onChange={(c) => setFaultColor(k.id, c)}
                  size={24}
                  title={k.label}
                  label={k.label}
                />
                <span className="flex-1 text-xs text-slate-700">{k.label}</span>
                {custom && (
                  <Btn variant="ghost" title="Volver al color de siempre" onClick={() => resetFaultColor(k.id)}>
                    <RotateCcw size={12} />
                  </Btn>
                )}
              </div>
            )
          })}
        </div>
      </Collapsible>

      <Collapsible title="Eje de pliegue" badge={foldChanged ? 'personalizado' : null}>
        <div className="flex items-center gap-2">
          <ColorSwatch
            value={sym.foldAxisColor}
            onChange={(c) => setPatch({ foldAxisColor: c })}
            size={24}
            title="Eje de pliegue"
            label="Eje de pliegue"
          />
          <span className="flex-1 text-xs text-slate-700">Antiformes y sinformes, en el mapa</span>
          {foldChanged && (
            <Btn
              variant="ghost"
              title="Volver al color de siempre"
              onClick={() => setPatch({ foldAxisColor: DEFAULT_SYMBOLS.foldAxisColor })}
            >
              <RotateCcw size={12} />
            </Btn>
          )}
        </div>
      </Collapsible>

      <Collapsible title="Grosor de líneas" badge={anyCustomWidth ? 'personalizado' : null}>
        <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
          Multiplica el grosor de siempre de cada capa en el mapa —útil para que se lea bien al
          proyectar o al imprimir—. ×1 es el grosor de toda la vida.
        </p>
        <div className="space-y-2.5">
          {WIDTH_ROWS.map(([key, label]) => {
            const v = sym.widths[key] ?? 1
            return (
              <label key={key} className="block text-xs text-slate-700">
                <div className="mb-0.5 flex items-center justify-between">
                  <span>{label}</span>
                  <span className="tabular-nums text-slate-400">×{v.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.4"
                  max="2.5"
                  step="0.05"
                  value={v}
                  onChange={(e) => setWidth(key, Number(e.target.value))}
                  className="w-full"
                />
              </label>
            )
          })}
        </div>
      </Collapsible>

      <div className="p-3">
        <Btn variant="ghost" onClick={resetAll} disabled={!anyCustomColor && !anyCustomWidth && !foldChanged}>
          <RotateCcw size={13} /> Restablecer toda la simbología
        </Btn>
      </div>
    </div>
  )
}
