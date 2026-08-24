import { useState } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        className={`max-h-[88vh] w-full ${wide ? 'max-w-3xl' : 'max-w-md'} overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl`}
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
      <div className="flex items-center gap-1 px-3 py-2">
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
    default: 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50',
    primary: 'bg-sky-600 text-white hover:bg-sky-700',
    dark: 'bg-slate-800 text-white hover:bg-slate-900',
    danger: 'border border-rose-200 text-rose-700 hover:bg-rose-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
  }
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${styles[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
