import { Mail, Github, Globe2 } from 'lucide-react'
import { useLang } from '../lib/i18n.jsx'
import { BUILD } from '../lib/version.js'
import { VERSION, AUTHOR, TOOLS, CHANGELOG } from '../lib/about.js'

/**
 * Ficha de la app: versión, autor, contacto, con qué está hecha y qué ha ido
 * cambiando.
 *
 * Junto a la versión publicada va el **sello del build** —la fecha y hora en
 * que se compiló lo que esta pestaña tiene cargado—: es lo que distingue dos
 * dispositivos que dicen la misma versión pero uno se quedó con el archivo
 * viejo en la caché, que es justo lo que hay que preguntar cuando algo no
 * cuadra en una sala de clases.
 */
export default function AboutPanel() {
  const { t } = useLang()
  return (
    <div className="h-full overflow-y-auto bg-white p-4 text-sm text-slate-700">
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-semibold text-slate-900">MapTeaching</span>
          <span className="rounded-md bg-sky-100 px-1.5 py-0.5 text-[11px] font-semibold text-sky-800">
            v{VERSION}
          </span>
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-slate-600">
          {t('App web de docencia en geología estructural: digitaliza un mapa y resuelve contornos estructurales, rumbo y manteo, perfiles, un modelo 3D y la columna esperada en un pozo.')}
        </p>
        <div className="mt-2 text-[11px] text-slate-500">
          {t('Compilada el')} <b className="font-semibold text-slate-700">{BUILD}</b>
        </div>
      </div>

      <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-800">{t('Creador')}</h3>
      <div className="rounded-lg border border-slate-200 px-3 py-2">
        <div className="text-[13px] font-medium text-slate-800">{AUTHOR.name}</div>
        <div className="text-[12px] text-slate-600">{t(AUTHOR.role)}</div>
        <div className="mt-2 space-y-1 text-[12px]">
          <a className="flex items-center gap-1.5 text-sky-700 hover:underline" href={`mailto:${AUTHOR.email}`}>
            <Mail size={13} /> {AUTHOR.email}
          </a>
          <a
            className="flex items-center gap-1.5 text-sky-700 hover:underline"
            href={AUTHOR.site}
            target="_blank"
            rel="noreferrer"
          >
            <Globe2 size={13} /> {t('App en vivo')}
          </a>
          <a
            className="flex items-center gap-1.5 text-sky-700 hover:underline"
            href={AUTHOR.repo}
            target="_blank"
            rel="noreferrer"
          >
            <Github size={13} /> {t('Código fuente')}
          </a>
        </div>
      </div>

      <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-800">{t('Principales herramientas')}</h3>
      <ul className="space-y-1.5">
        {TOOLS.map((tool) => (
          <li key={tool.name} className="rounded-lg border border-slate-200 px-3 py-1.5">
            <div className="text-[12.5px] font-medium text-slate-800">{tool.name}</div>
            <div className="text-[11.5px] leading-snug text-slate-600">{t(tool.what)}</div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        {t('Todo corre en el navegador: las imágenes y los proyectos se guardan en el propio equipo y no se envían a ningún servidor.')}
      </p>

      <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-800">{t('Registro de cambios')}</h3>
      <ol className="space-y-3">
        {CHANGELOG.map((rel) => (
          <li key={rel.version} className="rounded-lg border border-slate-200 px-3 py-2">
            <div className="flex items-baseline gap-2">
              <span className="text-[12.5px] font-semibold text-slate-900">v{rel.version}</span>
              <span className="text-[11px] text-slate-400">{rel.date}</span>
            </div>
            <div className="text-[12px] font-medium text-slate-700">{t(rel.title)}</div>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-[11.5px] leading-snug text-slate-600">
              {rel.highlights.map((h, i) => (
                <li key={i}>{t(h)}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  )
}
