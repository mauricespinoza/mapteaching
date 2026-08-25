import {
  Hand,
  MousePointer2,
  Waves,
  PenLine,
  Split,
  Ruler,
  Compass,
  Spline,
  Crosshair,
  Eraser,
  Layers3,
  Frame,
  MoveHorizontal,
  Contrast,
} from 'lucide-react'

export const TOOLS = [
  { id: 'pan', label: 'Navegar', icon: Hand, key: 'H' },
  { id: 'select', label: 'Seleccionar', icon: MousePointer2, key: 'V' },
  { id: 'contour', label: 'Curva de nivel', icon: Waves, key: 'C' },
  { id: 'contact', label: 'Contacto', icon: PenLine, key: 'X' },
  { id: 'fault', label: 'Falla', icon: Split, key: 'F' },
  { id: 'scontour', label: 'Contorno estr.', icon: Contrast, key: 'G' },
  { id: 'scale', label: 'Escala gráfica', icon: Ruler, key: 'R' },
  { id: 'measure', label: 'Medir', icon: MoveHorizontal, key: 'D' },
  { id: 'north', label: 'Norte', icon: Compass, key: 'N' },
  { id: 'frame', label: 'Área de trabajo', icon: Frame, key: 'B' },
  { id: 'section', label: 'Traza de perfil', icon: Spline, key: 'S' },
  { id: 'well', label: 'Pozo', icon: Crosshair, key: 'W' },
  { id: 'model', label: 'Modelo', icon: Layers3, key: 'M' },
  { id: 'erase', label: 'Borrar rasgo', icon: Eraser, key: 'E' },
]

export default function Toolbar({ tool, setTool, penOnly, setPenOnly }) {
  return (
    <div className="flex h-full w-16 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-slate-200 bg-white py-2 md:w-[4.5rem]">
      {TOOLS.map((t) => {
        const Icon = t.icon
        const active = tool === t.id
        return (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            title={`${t.label} (${t.key})`}
            className={`flex w-14 flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[10px] leading-tight transition ${
              active ? 'bg-sky-600 text-white shadow' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Icon size={20} />
            <span className="text-center">{t.label}</span>
          </button>
        )
      })}
      <div className="mt-2 w-14 border-t border-slate-200 pt-2 text-center">
        <p
          className="mb-1 rounded-lg bg-slate-100 px-1 py-1.5 text-[9px] leading-tight text-slate-600"
          title="Un toque coloca un vértice; mantener y arrastrar dibuja un trazo continuo"
        >
          Toque = vértice<br />Arrastrar = trazo
        </p>
        <button
          onClick={() => setPenOnly(!penOnly)}
          className={`mt-1 w-full rounded-lg px-1 py-1.5 text-[10px] font-medium ${
            penOnly ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
          }`}
          title="Con el lápiz activo, los dedos sólo navegan (rechazo de palma)"
        >
          {penOnly ? 'Sólo lápiz' : 'Dedo dibuja'}
        </button>
      </div>
    </div>
  )
}
