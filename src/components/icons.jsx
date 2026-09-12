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
 * Traza de perfil: una recta —no una curva— entre sus dos extremos, rotulados
 * A y A′ como se rotula cualquier perfil geológico. Antes se usaba el icono
 * genérico «spline», que sugiere una curva y no dice nada de los extremos.
 */
export function SectionLineIcon({ size = 24, strokeWidth = 2, className = '', ...rest }) {
  return (
    <svg width={size} height={size} strokeWidth={strokeWidth} className={className} {...base} {...rest}>
      <path d="M4 20 20 6" />
      <circle cx="4" cy="20" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="20" cy="6" r="1.6" fill="currentColor" stroke="none" />
      <text x="0.5" y="23.5" fontSize="7.5" fontFamily="system-ui, sans-serif" fill="currentColor" stroke="none">
        A
      </text>
      <text x="14.3" y="5" fontSize="7.5" fontFamily="system-ui, sans-serif" fill="currentColor" stroke="none">
        A′
      </text>
    </svg>
  )
}

/**
 * Dique: la banda entre sus **dos paredes**, que es como se dibuja en un mapa
 * y como se digitaliza aquí —una línea por borde—, y no una línea sola. Se
 * estrecha hacia la punta porque eso es lo que hace un dique: acuñarse.
 */
export function DikeIcon({ size = 24, strokeWidth = 2, className = '', ...rest }) {
  return (
    <svg width={size} height={size} strokeWidth={strokeWidth} className={className} {...base} {...rest}>
      <path d="M6.2 21.5 13.4 3.2" />
      <path d="M12.6 21.5 15.4 3.2" />
      <path d="M13.4 3.2 15.4 3.2" strokeWidth={Math.max(strokeWidth - 0.6, 0.9)} />
    </svg>
  )
}

/**
 * Ejes de pliegues: el cierre en horquilla de un contacto plegado visto en
 * planta, con su traza axial pasando por la charnela. Es la figura con la que
 * se reconoce un pliegue en el mapa —lo que dibuja esta capa—, y no se
 * confunde con nada.
 *
 * La otra opción, el símbolo de flechas divergentes del mapa geológico, a los
 * 17 px de la barra se lee como el icono de «mover»; la horquilla, no.
 */
export function FoldAxisIcon({ size = 24, strokeWidth = 2, className = '', ...rest }) {
  return (
    <svg width={size} height={size} strokeWidth={strokeWidth} className={className} {...base} {...rest}>
      <path d="M3.5 21.5C3.5 11.5 7.4 4 12 4s8.5 7.5 8.5 17.5" />
      <path d="M12 2 12 21.5" />
    </svg>
  )
}

// Logo de la app. Una serie de capas paralelas inclinadas, cortada por una
// falla que las desplaza. Dos decisiones lo gobiernan, y las dos son
// geológicas:
//
// 1. **Espesor constante.** Cada franja se dibuja como una banda de la misma
//    anchura en un sistema girado, así que el techo de una es exactamente el
//    muro de la siguiente. No hay huecos ni solapes —la versión anterior
//    definía cada banda con su propia curva y entre dos de ellas se abría una
//    cuña clara que ninguna capa habría dejado— y ninguna capa se acuña.
// 2. **Un solo salto.** El bloque de la izquierda es el mismo dibujo bajado
//    `THROW`, igual para todas las capas: una falla desplaza la serie entera,
//    no capa a capa.
//
// Geometría recta a propósito: a 16 px, que es como se ve en la pestaña del
// navegador, una ondulación no se lee y sólo ensucia el contorno.
const LOGO_DIP = -27 // inclinación aparente de las capas, en grados
const LOGO_THROW = 6 // salto de la falla, en unidades del viewBox
// Muro de cada capa en el sistema girado, de techo a base, y su color. Las
// bandas se pasan del borde del icono a propósito: lo que se ve es un recorte
// del mapa, no una lámina suelta.
const LOGO_BEDS = [
  [-8, '#fbbf24'],
  [-1.8, '#a3e635'],
  [4.4, '#34d399'],
  [10.6, '#38bdf8'],
  [16.8, '#a78bfa'],
  [23, '#f472b6'],
  [29.2, null],
]
// Traza de la falla: recta, de borde a borde.
const LOGO_FAULT = [
  [16.6, -2],
  [8.6, 26],
]

function LogoBeds() {
  return (
    <g transform={`rotate(${LOGO_DIP} 12 12)`}>
      {LOGO_BEDS.slice(0, -1).map(([y, color], i) => (
        <rect key={y} x="-16" y={y} width="56" height={LOGO_BEDS[i + 1][0] - y} fill={color} />
      ))}
    </g>
  )
}

/**
 * Logo de la app: un mapa geológico esquemático —capas inclinadas de espesor
 * constante cortadas por una falla con un salto único—, no un icono genérico.
 * Es también el favicon: `index.html` lleva el mismo dibujo como data URI.
 */
export function GeoMapLogo({ size = 24, className = '', ...rest }) {
  const [a, b] = LOGO_FAULT
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...rest}
    >
      <defs>
        <clipPath id="mtlogo-card">
          <rect width="24" height="24" rx="5.5" />
        </clipPath>
        <clipPath id="mtlogo-up">
          <path d={`M${a[0]} ${a[1]} H26 V26 H${b[0]} Z`} />
        </clipPath>
        <clipPath id="mtlogo-down">
          <path d={`M${a[0]} ${a[1]} H-2 V26 H${b[0]} Z`} />
        </clipPath>
      </defs>
      <g clipPath="url(#mtlogo-card)">
        <rect width="24" height="24" fill="#e0f2fe" />
        <g clipPath="url(#mtlogo-up)">
          <LogoBeds />
        </g>
        <g clipPath="url(#mtlogo-down)" transform={`translate(0 ${LOGO_THROW})`}>
          <LogoBeds />
        </g>
        <path
          d={`M${a[0]} ${a[1]} L${b[0]} ${b[1]}`}
          stroke="#0f172a"
          strokeWidth="1.7"
          fill="none"
        />
      </g>
      <rect x="0.6" y="0.6" width="22.8" height="22.8" rx="5" fill="none" stroke="#0f172a" strokeOpacity="0.35" strokeWidth="1.2" />
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
