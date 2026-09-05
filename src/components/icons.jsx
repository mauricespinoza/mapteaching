// Iconos propios, con la misma interfaz que los de lucide (`size`,
// `strokeWidth`, `className`) para poder mezclarlos en las mismas listas.

const base = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
}

/**
 * Curvas de nivel: los «cerritos» concéntricos con los que se explica en
 * clase, no las líneas onduladas genéricas del icono de lucide. Tres curvas
 * cerradas de contorno irregular —como salen de verdad en un mapa
 * topográfico—, cada vez más chicas y corridas hacia la cumbre, que queda
 * descentrada: es la lectura en planta de una loma, exactamente lo que se
 * digitaliza con esta herramienta.
 *
 * Tres y no más: con cuatro, a los 22 px de la barra las curvas se empastan y
 * el icono deja de leerse.
 */
export function ContourIcon({ size = 24, strokeWidth = 2, className = '', ...rest }) {
  return (
    <svg width={size} height={size} strokeWidth={strokeWidth} className={className} {...base} {...rest}>
      <path d="M23.3 12.1C23.0 14.2 19.7 15.9 17.8 17.7C15.9 19.5 14.1 22.7 11.9 22.9C9.7 23.1 6.3 20.7 4.8 18.9C3.3 17.1 3.3 14.6 3.1 12.1C2.8 9.6 2.0 5.5 3.5 4.1C5.0 2.7 9.3 3.5 11.9 3.7C14.5 3.9 17.2 3.9 19.1 5.3C21.0 6.7 23.5 10.0 23.3 12.1Z" />
      <path d="M19.7 11.7C19.5 13.0 17.3 14.1 16.1 15.2C14.9 16.4 13.7 18.5 12.3 18.6C11.0 18.7 8.7 17.2 7.8 16.0C6.8 14.8 6.8 13.2 6.7 11.7C6.5 10.1 6.0 7.4 6.9 6.5C7.9 5.6 10.7 6.1 12.3 6.3C14.0 6.4 15.7 6.4 17.0 7.3C18.2 8.2 19.8 10.3 19.7 11.7Z" />
      <path d="M16.2 11.2C16.1 11.8 15.1 12.3 14.5 12.9C14.0 13.4 13.4 14.4 12.8 14.4C12.2 14.5 11.1 13.7 10.7 13.2C10.2 12.7 10.2 11.9 10.2 11.2C10.1 10.5 9.9 9.2 10.3 8.8C10.7 8.4 12.0 8.7 12.8 8.7C13.6 8.8 14.4 8.8 14.9 9.2C15.5 9.6 16.2 10.6 16.2 11.2Z" />
    </svg>
  )
}

/**
 * Contorno estructural: la recta de cota constante que se traza sobre una
 * superficie, con la cota escrita al lado —así es como se lee un contorno
 * estructural en el mapa, y así se distingue de una curva de nivel (que sigue
 * el relieve) o de un contacto (que no lleva número—.
 */
export function StructureContourIcon({ size = 24, strokeWidth = 2, className = '', ...rest }) {
  return (
    <svg width={size} height={size} strokeWidth={strokeWidth} className={className} {...base} {...rest}>
      <path d="M2.5 19 12.5 6.5" />
      <text x="13" y="9" fontSize="7.5" fontFamily="system-ui, sans-serif" fill="currentColor" stroke="none">
        40
      </text>
    </svg>
  )
}

/**
 * Falla: una traza con una única espiga en la punta —no una flecha simétrica—,
 * la misma media flecha con la que el mapa marca el sentido de rumbo de una
 * falla de desgarre, y que además se lee como «hacia aquí» sin confundirse con
 * una flecha de dirección corriente.
 */
export function FaultIcon({ size = 24, strokeWidth = 2, className = '', ...rest }) {
  return (
    <svg width={size} height={size} strokeWidth={strokeWidth} className={className} {...base} {...rest}>
      <path d="M9 21 15 4" />
      <path d="M15 4 9.3 8.4" />
    </svg>
  )
}

/**
 * Puntos de perforación (piercing points): el mismo rasgo lineal reconocido a
 * los dos lados de una falla —un punto en cada bloque— unido por el vector de
 * salto. La línea llena es el plano de falla; la segmentada, el salto entre
 * los dos puntos que ese plano separó.
 */
export function PiercingIcon({ size = 24, strokeWidth = 2, className = '', ...rest }) {
  return (
    <svg width={size} height={size} strokeWidth={strokeWidth} className={className} {...base} {...rest}>
      <path d="M12 2.5 12 21.5" />
      <path d="M5.5 8 18.5 16" strokeDasharray="2.4 2.4" strokeWidth={Math.max(strokeWidth - 0.4, 1)} />
      <circle cx="5.5" cy="8" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="16" r="1.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * Cortar una línea en un punto: el trazo partido en dos, con la marca del
 * corte —la recta segmentada perpendicular— y un extremo nuevo a cada lado.
 * Se lee de un vistazo qué deja la herramienta (dos líneas donde había una),
 * cosa que unas tijeras no dicen.
 */
export function CutLineIcon({ size = 24, strokeWidth = 2, className = '', ...rest }) {
  return (
    <svg width={size} height={size} strokeWidth={strokeWidth} className={className} {...base} {...rest}>
      <path d="M2.5 17.5 8.8 13.6" />
      <path d="M15.2 10.4 21.5 6.5" />
      <path d="M12 3.2 12 20.8" strokeDasharray="2.6 2.6" strokeWidth={Math.max(strokeWidth - 0.6, 1)} />
      <circle cx="8.8" cy="13.6" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="15.2" cy="10.4" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  )
}
