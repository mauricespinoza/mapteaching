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
 * clase, no las líneas onduladas genéricas del icono de lucide. Tres anillos
 * cerrados, cada vez más chicos y desplazados hacia la cumbre, son la lectura
 * en planta de una elevación —exactamente lo que se digitaliza con esta
 * herramienta—.
 */
export function ContourIcon({ size = 24, strokeWidth = 2, className = '', ...rest }) {
  return (
    <svg width={size} height={size} strokeWidth={strokeWidth} className={className} {...base} {...rest}>
      <ellipse cx="11.5" cy="16" rx="8.5" ry="4.6" />
      <ellipse cx="13" cy="12.3" rx="5.4" ry="3" />
      <ellipse cx="14.3" cy="9" rx="2.6" ry="1.5" />
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
