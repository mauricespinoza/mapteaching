import { useState } from 'react'
import { ChevronDown, ChevronRight, X, Palette } from 'lucide-react'

export function Modal({ title, onClose, children, wide }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`max-h-[88vh] w-full ${wide ? 'max-w-3xl' : 'max-w-md'} overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-black/5`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-800">{title}</h3>
          <button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Collapsible({ title, badge, children, defaultOpen = true, action }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-slate-200">
      <div className="flex items-center gap-1 px-3 py-2 transition hover:bg-slate-50/80">
        <button className="flex flex-1 items-center gap-1.5 text-left" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <span className="text-sm font-semibold text-slate-700">{title}</span>
          {badge != null && (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{badge}</span>
          )}
        </button>
        {action}
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  )
}

export function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  )
}

export const inputCls =
  'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-sky-500 focus:outline-none'

export function Btn({ children, onClick, variant = 'default', className = '', ...rest }) {
  const styles = {
    default: 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400',
    primary: 'bg-sky-600 text-white shadow-sm hover:bg-sky-700',
    dark: 'bg-slate-800 text-white hover:bg-slate-900',
    onDark: 'bg-white/10 text-slate-100 ring-1 ring-white/10 hover:bg-white/20',
    danger: 'border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100',
    ghost: 'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
  }
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${styles[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

/**
 * Selector de color de una unidad o de un contacto. El `input type="color"` a
 * secas es un cuadradito gris que nadie identifica como «aquí se cambia el
 * color»: aquí se pinta el color a tamaño de botón, con un aro claro que lo
 * despega del fondo y una paleta en la esquina que dice qué hace al tocarlo.
 * El `input` real queda encima, transparente, para no perder el selector
 * nativo del sistema —el único que funciona igual en tablet y en escritorio—.
 */
export function ColorSwatch({ value, onChange, title, label, size = 30, className = '' }) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-lg ring-1 ring-slate-300 ring-offset-1 ring-offset-white transition hover:ring-2 hover:ring-sky-500 ${className}`}
      style={{ width: size, height: size, background: value || '#e2e8f0' }}
      title={title}
    >
      <Palette
        size={Math.round(size * 0.5)}
        strokeWidth={2.2}
        className="pointer-events-none drop-shadow-[0_0_2px_rgba(255,255,255,0.95)]"
        style={{ color: readableOn(value) }}
      />
      <input
        type="color"
        aria-label={label || title || 'Color'}
        value={value || '#888888'}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </span>
  )
}

/** Tinta que se lee sobre un fondo dado: los tonos ICS claros piden tinta oscura. */
function readableOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return '#334155'
  const v = parseInt(m[1], 16)
  const l = (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255
  return l > 0.6 ? 'rgba(15,23,42,0.75)' : 'rgba(255,255,255,0.9)'
}
