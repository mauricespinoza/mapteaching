// Iconos propios, con la misma interfaz que los de lucide (`size`,
// `strokeWidth`, `className`) para poder mezclarlos en las mismas listas.

/**
 * Falla: el símbolo con el que se explica en clase, una capa guía cortada y
 * desplazada por un plano inclinado. El icono genérico de «bifurcación» que
 * había antes no dice nada de eso; aquí se lee de un vistazo el plano y el
 * salto, que es justo lo que la herramienta dibuja.
 */
export function FaultIcon({ size = 24, strokeWidth = 2, className = '', ...rest }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {/* Plano de falla */}
      <path d="M15 4 9 20" />
      {/* Capa guía, cortada y desplazada a un lado y otro del plano */}
      <path d="M2.5 15h8.4" />
      <path d="M13.1 9h8.4" />
    </svg>
  )
}
