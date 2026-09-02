import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Field, inputCls, Btn } from './ui.jsx'
import { digitize, toGray, inkMask, dominantInkHue } from '../lib/digitizer.js'
import { uid, newContact, newFault, sortedUnits } from '../lib/model.js'

/**
 * Digitalización automática del mapa cargado.
 *
 * Dos botones y no uno porque en una carta las dos familias de líneas se
 * imprimen con **tintas distintas**: las curvas de nivel en sepia o en un gris
 * fino, y los contactos y las fallas en negro o en un color propio. Separar por
 * color es lo que permite que un paso recoja las curvas y el otro la geología,
 * en vez de un revoltijo de las dos. Cuál es cuál cambia de un mapa a otro —en
 * unas cartas las curvas son las oscuras y la geología va en azul, en otras al
 * revés—, así que la tinta se elige aquí, con el cuentagotas sobre el propio
 * mapa, y el resultado se ve antes de tocar nada.
 */
export default function DigitizePanel({ project, image, dispatch, onClose }) {
  const [target, setTarget] = useState('curvas') // 'curvas' | 'geologia'
  const [mode, setMode] = useState('neutro') // ver classifyInk
  const [hue, setHue] = useState(null)
  const [picking, setPicking] = useState(false)
  const [params, setParams] = useState({
    c: 10,
    minComponentPx: 30,
    tolerancePx: 1.5,
    minLengthPx: 20,
    maxSinuosity: 2.5,
  })
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [destino, setDestino] = useState('nuevo')
  const [elevBase, setElevBase] = useState(project.settings.lastElevation || 0)
  const canvasRef = useRef(null)
  const pixelsRef = useRef(null)

  const W = project.image?.width || 0
  const H = project.image?.height || 0
  // Resolución de trabajo. El adelgazamiento recorre la imagen entera una vez
  // por iteración, así que un escaneo de 12 Mpx tardaría minutos y dejaría la
  // pestaña colgada. Por encima de este tamaño se trabaja sobre una copia
  // reducida y las líneas se devuelven a la escala del mapa al terminar: lo que
  // se pierde es sub-píxel, muy por debajo del grosor del trazo impreso.
  const MAX_PX = 2.2e6
  const escala = W * H > MAX_PX ? Math.sqrt(MAX_PX / (W * H)) : 1
  const wt = Math.max(1, Math.round(W * escala))
  const ht = Math.max(1, Math.round(H * escala))

  // Los píxeles se leen una sola vez: el resto son pasadas sobre el mismo array.
  useEffect(() => {
    if (!image || !W || !H) return
    const cv = document.createElement('canvas')
    cv.width = wt
    cv.height = ht
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(image, 0, 0, wt, ht)
    pixelsRef.current = ctx.getImageData(0, 0, wt, ht)
    // Tono dominante de la tinta con color: es lo que se propone al elegir
    // «de color», para no tener que acertarlo a ojo.
    const px = pixelsRef.current.data
    const raw = inkMask(toGray(px, wt, ht), wt, ht, { blockSize: 31, c: 10, minComponentPx: 30 })
    setHue(dominantInkHue(px, raw, wt, ht))
  }, [image, W, H, wt, ht])

  const run = () => {
    const data = pixelsRef.current
    if (!data) return
    setBusy(true)
    // Un respiro para que el diálogo pinte el «Buscando…» antes de bloquearse.
    setTimeout(() => {
      const out = digitize(data.data, wt, ht, { ...params, mode, hue })
      // De vuelta a los píxeles del mapa, que es el sistema en el que viven las
      // trazas y las curvas del proyecto.
      const k = 1 / escala
      setResult(k === 1 ? out.paths : out.paths.map((p) => p.map(([x, y]) => [x * k, y * k])))
      setBusy(false)
    }, 30)
  }

  useEffect(() => {
    if (pixelsRef.current) run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, hue, params, image])

  // --- Vista previa ---
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !image || !W || !H) return
    const scale = Math.min(560 / W, 360 / H, 1)
    cv.width = Math.round(W * scale)
    cv.height = Math.round(H * scale)
    const ctx = cv.getContext('2d')
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.globalAlpha = 0.35
    ctx.drawImage(image, 0, 0, cv.width, cv.height)
    ctx.globalAlpha = 1
    ctx.strokeStyle = target === 'curvas' ? '#b45309' : '#dc2626'
    ctx.lineWidth = 1.4
    for (const p of result || []) {
      ctx.beginPath()
      p.forEach(([x, y], i) =>
        i ? ctx.lineTo(x * scale, y * scale) : ctx.moveTo(x * scale, y * scale)
      )
      ctx.stroke()
    }
  }, [result, image, W, H, target])

  const pickHue = (e) => {
    const data = pixelsRef.current
    if (!data || !picking) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.min(wt - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * wt)))
    const y = Math.min(ht - 1, Math.max(0, Math.round(((e.clientY - r.top) / r.height) * ht)))
    const i = (y * wt + x) * 4
    const rr = data.data[i] / 255
    const gg = data.data[i + 1] / 255
    const bb = data.data[i + 2] / 255
    const max = Math.max(rr, gg, bb)
    const min = Math.min(rr, gg, bb)
    const d = max - min
    const sat = max <= 0 ? 0 : d / max
    setPicking(false)
    // Un píxel sin color no define un tono: es tinta neutra.
    if (sat < 0.22) {
      setMode('neutro')
      return
    }
    let hh = 0
    if (max === rr) hh = 60 * (((gg - bb) / d) % 6)
    else if (max === gg) hh = 60 * ((bb - rr) / d + 2)
    else hh = 60 * ((rr - gg) / d + 4)
    if (hh < 0) hh += 360
    setMode('color')
    setHue(hh)
  }

  const unidades = useMemo(() => sortedUnits(project), [project])

  /**
   * Ordena las curvas para numerarlas. Las cotas no se leen del dibujo, pero
   * las curvas de un mismo relieve se suceden en un orden: se proyectan sus
   * centros sobre la dirección en la que más se reparten —la de máxima
   * pendiente del conjunto— y se numeran siguiéndola. Es una propuesta, no una
   * medida: hay que revisarla curva a curva.
   */
  const ordenar = (paths) => {
    const mid = paths.map((p) => {
      let sx = 0
      let sy = 0
      for (const q of p) {
        sx += q[0]
        sy += q[1]
      }
      return [sx / p.length, sy / p.length]
    })
    const cx = mid.reduce((s, m) => s + m[0], 0) / (mid.length || 1)
    const cy = mid.reduce((s, m) => s + m[1], 0) / (mid.length || 1)
    let sxx = 0
    let sxy = 0
    let syy = 0
    for (const m of mid) {
      sxx += (m[0] - cx) ** 2
      sxy += (m[0] - cx) * (m[1] - cy)
      syy += (m[1] - cy) ** 2
    }
    const tr = sxx + syy
    const det = sxx * syy - sxy * sxy
    const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det))
    const dir = Math.abs(sxy) > 1e-9 ? [l1 - syy, sxy] : sxx >= syy ? [1, 0] : [0, 1]
    const n = Math.hypot(dir[0], dir[1]) || 1
    return paths
      .map((p, i) => ({ p, t: ((mid[i][0] - cx) * dir[0] + (mid[i][1] - cy) * dir[1]) / n }))
      .sort((a, b) => a.t - b.t)
      .map((x) => x.p)
  }

  const aplicar = () => {
    const paths = result || []
    if (!paths.length) return
    const traces = paths.map((pts) => ({ id: uid('tr'), pts }))
    if (target === 'curvas') {
      const paso = project.settings.contourInterval || 100
      const contours = ordenar(paths).map((pts, i) => ({
        id: uid('cv'),
        elevation: elevBase + i * paso,
        pts,
      }))
      dispatch({ type: 'digitize.add', contours })
    } else if (destino === 'falla') {
      const fault = newFault(project)
      fault.name = 'Falla digitalizada'
      fault.traces = traces
      dispatch({ type: 'digitize.add', fault })
    } else {
      const base = unidades[0]
      const techo = unidades[1] || unidades[0]
      if (!base || !techo) return
      const contact = newContact(project, base.id, techo.id)
      contact.name = 'Contactos digitalizados'
      contact.traces = traces
      dispatch({ type: 'digitize.add', contact })
    }
    onClose()
  }

  if (!project.image) {
    return (
      <Modal title="Digitalizar el mapa" onClose={onClose}>
        <p className="text-sm text-slate-700">
          Hace falta una imagen base: importa el mapa con <b>Archivo → Importar imagen base</b> y vuelve
          aquí.
        </p>
      </Modal>
    )
  }

  const num = (label, key, min, max, step) => (
    <label className="block">
      <span className="mb-0.5 block text-[11px] text-slate-600">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={params[key]}
        onChange={(e) => setParams((p) => ({ ...p, [key]: Number(e.target.value) }))}
        className="w-full accent-sky-600"
      />
    </label>
  )

  return (
    <Modal title="Digitalizar el mapa" onClose={onClose} wide>
      <p className="mb-3 text-xs leading-relaxed text-slate-600">
        Aísla las líneas impresas del mapa y las convierte en trazas. Las dos familias se separan por{' '}
        <b>tinta</b>: en una carta las curvas de nivel y la geología se imprimen con colores distintos,
        así que se digitalizan por separado. Elige qué buscas, ajusta hasta que la vista previa recoja lo
        que quieres, y añádelo.
      </p>

      <div className="mb-3 flex gap-2">
        {[
          ['curvas', 'Curvas de nivel'],
          ['geologia', 'Contactos y fallas'],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTarget(k)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${
              target === k ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        className={`mb-2 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 ${
          picking ? 'cursor-crosshair ring-2 ring-sky-500' : ''
        }`}
        onClick={pickHue}
      >
        <canvas ref={canvasRef} className="block w-full" />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">Tinta:</span>
        {[
          ['neutro', 'Negra o gris'],
          ['color', hue == null ? 'De color' : `De color (${Math.round(hue)}°)`],
          ['todo', 'Toda'],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setMode(k)}
            className={`rounded-lg px-2.5 py-1 font-medium ${
              mode === k ? 'bg-sky-100 text-sky-800 ring-1 ring-sky-300' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => setPicking((v) => !v)}
          className={`rounded-lg px-2.5 py-1 font-medium ${
            picking ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          {picking ? 'Toca una línea…' : 'Tomar del mapa'}
        </button>
        <span className="ml-auto font-medium text-slate-700">
          {busy ? 'Buscando…' : `${result?.length || 0} líneas`}
        </span>
        {escala < 1 && (
          <span className="w-full text-[10px] text-slate-400">
            Imagen grande: se busca sobre una copia al {Math.round(escala * 100)} % y las líneas se
            devuelven a la escala del mapa.
          </span>
        )}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-3">
        {num(`Sensibilidad ${params.c}`, 'c', 2, 30, 1)}
        {num(`Grosor mínimo ${params.minComponentPx} px`, 'minComponentPx', 0, 200, 5)}
        {num(`Suavizado ${params.tolerancePx} px`, 'tolerancePx', 0, 6, 0.25)}
        {num(`Largo mínimo ${params.minLengthPx} px`, 'minLengthPx', 4, 200, 2)}
        {num(`Enredo máximo ${params.maxSinuosity}`, 'maxSinuosity', 1, 8, 0.25)}
      </div>

      {target === 'curvas' ? (
        <div className="mb-3 rounded-lg bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-900">
          Las cotas no están en el dibujo, así que se numeran en orden a partir de la primera, de{' '}
          {project.settings.contourInterval || 100} en {project.settings.contourInterval || 100} m.{' '}
          <b>Es una propuesta</b>: revisa cada curva y corrige su cota con una pulsación larga.
          <div className="mt-1.5 w-40">
            <Field label="Cota de la primera">
              <input
                type="number"
                className={inputCls}
                value={elevBase}
                onChange={(e) => setElevBase(Number(e.target.value))}
              />
            </Field>
          </div>
        </div>
      ) : (
        <div className="mb-3">
          <Field label="Dónde van las trazas" hint="Después se reasignan con una pulsación larga sobre cada traza.">
            <select className={inputCls} value={destino} onChange={(e) => setDestino(e.target.value)}>
              <option value="nuevo">Un contacto nuevo</option>
              <option value="falla">Una falla nueva</option>
            </select>
          </Field>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Btn onClick={onClose}>Cancelar</Btn>
        <Btn
          variant="primary"
          disabled={busy || !result?.length || (target === 'geologia' && unidades.length < 1)}
          onClick={aplicar}
        >
          Añadir {result?.length || 0} líneas
        </Btn>
      </div>
      {target === 'geologia' && unidades.length < 1 && (
        <p className="mt-2 text-[11px] text-rose-700">
          Crea al menos una unidad antes de añadir contactos.
        </p>
      )}
    </Modal>
  )
}
