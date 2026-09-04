// Reducer del proyecto con historial (deshacer/rehacer).

import { newContact, newUnit, uid, sortedUnits } from './model.js'

const LIMIT = 80

export const initialState = (project) => ({ past: [], present: project, future: [] })

const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)))

const touch = (p) => ({ ...p, updatedAt: new Date().toISOString() })

const replaceIn = (arr, id, fn) => arr.map((it) => (it.id === id ? fn(it) : it))

function apply(project, action) {
  const p = project
  switch (action.type) {
    case 'patch':
      return { ...p, ...action.patch }
    case 'layer':
      return {
        ...p,
        settings: {
          ...p.settings,
          layers: {
            ...(p.settings.layers || {}),
            [action.layer]: { ...(p.settings.layers?.[action.layer] || {}), ...action.patch },
          },
        },
      }
    case 'settings':
      return { ...p, settings: { ...p.settings, ...action.patch } }
    case 'georef':
      return { ...p, georef: { ...p.georef, ...action.patch } }

    case 'contour.add':
      return { ...p, contours: [...p.contours, { id: uid('cv'), elevation: action.elevation, pts: action.pts }] }
    case 'contour.update':
      return { ...p, contours: replaceIn(p.contours, action.id, (c) => ({ ...c, ...action.patch })) }
    case 'contour.delete':
      return { ...p, contours: p.contours.filter((c) => c.id !== action.id) }
    case 'contour.clear':
      return { ...p, contours: [] }
    // Alta en bloque de las curvas que genera un relieve. Va en una sola acción
    // para que quepa en un solo paso de deshacer: son decenas de curvas y
    // añadirlas de una en una dejaría el historial inservible.
    case 'contour.bulk': {
      const nuevas = action.contours.map((c) => ({ id: uid('cv'), elevation: c.elevation, pts: c.pts }))
      return { ...p, contours: action.replace ? nuevas : [...p.contours, ...nuevas] }
    }

    /**
     * Alta de lo que sale de digitalizar el mapa: las curvas de nivel, o un
     * contacto o una falla con todas sus trazas de una vez. Va en una sola
     * acción para que quepa en un solo paso de deshacer: una digitalización
     * produce decenas de líneas y deshacerlas de una en una dejaría el
     * historial inservible.
     */
    case 'digitize.add': {
      if (action.contours) return { ...p, contours: [...p.contours, ...action.contours] }
      if (action.contact) return { ...p, contacts: [...p.contacts, action.contact] }
      if (action.fault) return { ...p, faults: [...p.faults, action.fault] }
      return p
    }

    case 'unit.add': {
      const unit = newUnit(p, action.name)
      const units = [...p.units, unit]
      const prevTop = sortedUnits(p)[p.units.length - 1]
      let contacts = p.contacts
      if (prevTop) {
        const c = newContact({ ...p, units }, prevTop.id, unit.id)
        contacts = [...contacts, c]
      }
      return { ...p, units, contacts }
    }
    case 'unit.update':
      return { ...p, units: replaceIn(p.units, action.id, (u) => ({ ...u, ...action.patch })) }
    case 'unit.delete': {
      const units = p.units.filter((u) => u.id !== action.id).map((u, i) => ({ ...u, order: i }))
      const contacts = p.contacts.filter((c) => c.lowerUnitId !== action.id && c.upperUnitId !== action.id)
      return { ...p, units, contacts }
    }
    case 'unit.move': {
      const list = sortedUnits(p)
      const i = list.findIndex((u) => u.id === action.id)
      const j = i + action.delta
      if (i < 0 || j < 0 || j >= list.length) return p
      const copy = [...list]
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
      return { ...p, units: copy.map((u, k) => ({ ...u, order: k })) }
    }

    case 'contact.add':
      return { ...p, contacts: [...p.contacts, newContact(p, action.lowerUnitId, action.upperUnitId)] }
    case 'contact.update':
      return { ...p, contacts: replaceIn(p.contacts, action.id, (c) => ({ ...c, ...action.patch })) }
    case 'contact.delete':
      return { ...p, contacts: p.contacts.filter((c) => c.id !== action.id) }
    /**
     * Saca una traza de su contacto y la lleva al contacto que ya tenga ese
     * par de unidades, o a uno nuevo si no hay ninguno. Así reasignar las
     * unidades de una sola traza no cambia las demás que compartían contacto
     * —lo que junta la digitalización automática, todas las trazas de una
     * tinta en un solo contacto sin unidades, y hay que poder separar trazo a
     * trozo—. Los contornos estructurales a mano se quedan donde estaban: son
     * la interpretación de la superficie, no de una traza en particular.
     */
    case 'contact.reassignTrace': {
      const src = p.contacts.find((c) => c.id === action.id)
      const trace = src?.traces.find((t) => t.id === action.traceId)
      if (!src || !trace) return p
      const remaining = src.traces.filter((t) => t.id !== action.traceId)
      const target = p.contacts.find(
        (c) => c.id !== src.id && c.lowerUnitId === action.lowerUnitId && c.upperUnitId === action.upperUnitId
      )
      let contacts = p.contacts.map((c) => {
        if (c.id === src.id) return { ...c, traces: remaining }
        if (target && c.id === target.id) return { ...c, traces: [...c.traces, trace] }
        return c
      })
      if (!target) contacts = [...contacts, { ...newContact(p, action.lowerUnitId, action.upperUnitId), traces: [trace] }]
      // Un contacto que se queda sin trazas ni contornos a mano ya no sirve de nada.
      contacts = contacts.filter((c) => c.id !== src.id || remaining.length > 0 || (src.structureContours || []).length > 0)
      return { ...p, contacts }
    }

    case 'fault.add':
      return { ...p, faults: [...p.faults, action.fault] }
    case 'fault.update':
      return { ...p, faults: replaceIn(p.faults, action.id, (f) => ({ ...f, ...action.patch })) }
    case 'fault.delete':
      return { ...p, faults: p.faults.filter((f) => f.id !== action.id) }

    case 'trace.add': {
      const key = action.kind === 'fault' ? 'faults' : 'contacts'
      return {
        ...p,
        [key]: replaceIn(p[key], action.id, (it) => ({
          ...it,
          traces: [...it.traces, { id: uid('tr'), pts: action.pts }],
        })),
      }
    }
    case 'trace.delete': {
      const key = action.kind === 'fault' ? 'faults' : 'contacts'
      return {
        ...p,
        [key]: replaceIn(p[key], action.id, (it) => ({ ...it, traces: it.traces.filter((t) => t.id !== action.traceId) })),
      }
    }
    /**
     * Corta una traza en dos, en el punto que se tocó. `i` es el índice del
     * segmento donde cae el corte y `at` el punto exacto sobre él —lo que
     * calcula `pointPolyline` en `cutHit`—, así que el corte no reajusta el
     * trazo, sólo lo parte donde ya pasaba.
     *
     * Cortar en el primer o el último vértice no parte nada —un lado quedaría
     * con un solo punto—, así que ahí no hace nada.
     */
    case 'trace.split': {
      const splitPts = (pts) => {
        if (action.i < 0 || action.i >= pts.length - 1) return null
        if (action.i === 0 && (action.at[0] === pts[0][0] && action.at[1] === pts[0][1])) return null
        const last = pts.length - 2
        if (action.i === last && action.at[0] === pts[pts.length - 1][0] && action.at[1] === pts[pts.length - 1][1]) return null
        const a = [...pts.slice(0, action.i + 1), action.at]
        const b = [action.at, ...pts.slice(action.i + 1)]
        return a.length >= 2 && b.length >= 2 ? [a, b] : null
      }
      if (action.kind === 'contour') {
        const src = p.contours.find((c) => c.id === action.id)
        const halves = src && splitPts(src.pts)
        if (!halves) return p
        return {
          ...p,
          contours: [
            ...p.contours.filter((c) => c.id !== src.id),
            { ...src, id: uid('cv'), pts: halves[0] },
            { ...src, id: uid('cv'), pts: halves[1] },
          ],
        }
      }
      const key = action.kind === 'fault' ? 'faults' : 'contacts'
      const owner = p[key].find((x) => x.id === action.id)
      const trace = owner?.traces.find((t) => t.id === action.traceId)
      const halves = trace && splitPts(trace.pts)
      if (!owner || !halves) return p
      return {
        ...p,
        [key]: replaceIn(p[key], owner.id, (it) => ({
          ...it,
          traces: [
            ...it.traces.filter((t) => t.id !== trace.id),
            { id: uid('tr'), pts: halves[0] },
            { id: uid('tr'), pts: halves[1] },
          ],
        })),
      }
    }
    case 'trace.update': {
      const key = action.kind === 'fault' ? 'faults' : 'contacts'
      return {
        ...p,
        [key]: replaceIn(p[key], action.id, (it) => ({
          ...it,
          traces: replaceIn(it.traces, action.traceId, (t) => ({
            ...t,
            ...(action.patch || { pts: action.pts }),
          })),
        })),
      }
    }

    // --- Contornos estructurales puestos a mano ---
    // Viven en el rasgo (contacto o falla) y sustituyen a los que calcula el
    // motor en esa cota: el estudiante toma el control de esa curva.
    case 'sc.add': {
      const key = action.kind === 'fault' ? 'faults' : 'contacts'
      return {
        ...p,
        [key]: replaceIn(p[key], action.id, (it) => ({
          ...it,
          structureContours: [...(it.structureContours || []), ...action.items],
        })),
      }
    }
    case 'sc.update': {
      const key = action.kind === 'fault' ? 'faults' : 'contacts'
      return {
        ...p,
        [key]: replaceIn(p[key], action.id, (it) => ({
          ...it,
          structureContours: replaceIn(it.structureContours || [], action.scId, (sc) => ({
            ...sc,
            ...action.patch,
          })),
        })),
      }
    }
    case 'sc.delete': {
      const key = action.kind === 'fault' ? 'faults' : 'contacts'
      return {
        ...p,
        [key]: replaceIn(p[key], action.id, (it) => ({
          ...it,
          structureContours: (it.structureContours || []).filter((sc) => sc.id !== action.scId),
        })),
      }
    }
    /**
     * Varios rasgos a la vez, en un solo paso de historial: regularizar o
     * densificar toca todos los contactos del ejercicio y deshacerlo tiene que
     * ser un solo Ctrl+Z, no veinte.
     */
    case 'sc.bulk': {
      let next = p
      for (const g of action.groups) {
        const key = g.kind === 'fault' ? 'faults' : 'contacts'
        next = {
          ...next,
          [key]: replaceIn(next[key], g.id, (it) => ({
            ...it,
            structureContours: action.replace
              ? g.items
              : [...(it.structureContours || []), ...g.items],
            // `scOnly` marca que la superficie la definen estos contornos y no
            // los cruces de su traza con las curvas de nivel. Lo pone quien
            // mueve la superficie en el 3D, donde los contornos cambian de cota
            // y ya no sustituyen a ningún cruce.
            ...(g.scOnly === undefined ? {} : { scOnly: !!g.scOnly }),
          })),
        }
      }
      return next
    }
    case 'sc.clear': {
      const key = action.kind === 'fault' ? 'faults' : 'contacts'
      return {
        ...p,
        [key]: replaceIn(p[key], action.id, (it) => ({
          ...it,
          structureContours: action.elevation == null
            ? []
            : (it.structureContours || []).filter((sc) => sc.elevation !== action.elevation),
          // Sin contornos a mano no hay nada que pueda definir la superficie por
          // su cuenta: vuelve a mandar lo medido sobre el mapa.
          ...(action.elevation == null ? { scOnly: false } : {}),
        })),
      }
    }

    case 'section.add':
      return { ...p, sections: [...p.sections, action.section] }
    case 'section.update':
      return { ...p, sections: replaceIn(p.sections, action.id, (s) => ({ ...s, ...action.patch })) }
    case 'section.delete':
      return { ...p, sections: p.sections.filter((s) => s.id !== action.id) }

    case 'model.add':
      return { ...p, models: [...(p.models || []), action.model] }
    case 'model.update':
      return { ...p, models: replaceIn(p.models || [], action.id, (m) => ({ ...m, ...action.patch })) }
    case 'model.apply': {
      // Se sustituye lo generado antes por este mismo modelo, para que aplicarlo
      // dos veces no duplique unidades ni contactos.
      const keptUnits = (p.units || []).filter((u) => u.fromModel !== action.id)
      const keptContacts = (p.contacts || []).filter((c) => c.fromModel !== action.id)
      const base = keptUnits.reduce((m, u) => Math.max(m, u.order ?? 0), -1) + 1
      return {
        ...p,
        units: [...keptUnits, ...action.units.map((u, i) => ({ ...u, order: base + i }))],
        contacts: [...keptContacts, ...action.contacts],
        models: (p.models || []).map((m) => (m.id === action.id ? { ...m, applied: true } : m)),
      }
    }
    case 'model.unapply': {
      return {
        ...p,
        units: (p.units || []).filter((u) => u.fromModel !== action.id),
        contacts: (p.contacts || []).filter((c) => c.fromModel !== action.id),
        models: (p.models || []).map((m) => (m.id === action.id ? { ...m, applied: false } : m)),
      }
    }

    case 'model.delete':
      return {
        ...p,
        models: (p.models || []).filter((m) => m.id !== action.id),
        units: (p.units || []).filter((u) => u.fromModel !== action.id),
        contacts: (p.contacts || []).filter((c) => c.fromModel !== action.id),
      }

    case 'well.add':
      return { ...p, wells: [...p.wells, action.well] }
    case 'well.update':
      return { ...p, wells: replaceIn(p.wells, action.id, (w) => ({ ...w, ...action.patch })) }
    case 'well.delete':
      return { ...p, wells: p.wells.filter((w) => w.id !== action.id) }

    case 'piercing.add':
      return { ...p, piercings: [...(p.piercings || []), action.pair] }
    case 'piercing.update':
      return { ...p, piercings: replaceIn(p.piercings || [], action.id, (x) => ({ ...x, ...action.patch })) }
    case 'piercing.delete':
      return { ...p, piercings: (p.piercings || []).filter((x) => x.id !== action.id) }

    case 'clear.all':
      return {
        ...p,
        contours: [],
        units: [],
        contacts: [],
        faults: [],
        sections: [],
        wells: [],
        piercings: [],
        models: [],
      }
    case 'clear.drawing':
      return { ...p, contours: [], units: [], contacts: [], faults: [] }

    default:
      return p
  }
}

export function reducer(state, action) {
  switch (action.type) {
    case 'history.undo': {
      if (!state.past.length) return state
      const past = state.past.slice(0, -1)
      const present = state.past[state.past.length - 1]
      return { past, present, future: [state.present, ...state.future].slice(0, LIMIT) }
    }
    case 'history.redo': {
      if (!state.future.length) return state
      const [present, ...future] = state.future
      return { past: [...state.past, state.present].slice(-LIMIT), present, future }
    }
    case 'project.load':
      return { past: [], present: action.project, future: [] }
    default: {
      const next = apply(state.present, action)
      if (next === state.present) return state
      return {
        past: [...state.past, clone(state.present)].slice(-LIMIT),
        present: touch(next),
        future: [],
      }
    }
  }
}
