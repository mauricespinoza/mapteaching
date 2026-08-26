// Aviso de versión nueva.
//
// La app se despliega en GitHub Pages, que sirve el `index.html` con diez
// minutos de caché. Los archivos de la app llevan un hash en el nombre, así que
// basta con volver a leer el `index.html` para saber si hay una versión nueva:
// si el script al que apunta ya no es el que esta pestaña cargó, es que se ha
// desplegado otra cosa.
//
// Importa porque la usan estudiantes con la pestaña abierta toda una clase: sin
// esto, una corrección publicada por la mañana no les llega hasta que cierran el
// navegador. Se comprueba cada cuarto de hora y al volver a la pestaña, nunca
// mientras se trabaja sin parar, y no se recarga sola: recargar sin avisar en
// mitad de un ejercicio sería peor que la versión vieja.

export const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev'

const CHECK_MS = 15 * 60 * 1000

/** Nombre del script principal al que apunta un `index.html`. */
const entryOf = (html) => (html.match(/<script[^>]+src="([^"]+\.js)"/i) || [])[1] || null

/**
 * Vigila si se ha desplegado una versión nueva y llama a `onUpdate` una sola
 * vez cuando la hay. Devuelve la función para dejar de vigilar.
 */
export function watchForUpdate(onUpdate) {
  // En desarrollo el HTML no lleva assets con hash y Vite ya recarga solo.
  if (import.meta.env?.DEV) return () => {}
  const here = document.querySelector('script[type="module"][src]')?.getAttribute('src')
  if (!here) return () => {}
  let done = false
  let timer = null

  const check = async () => {
    if (done || document.hidden) return
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}?v=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) return
      const entry = entryOf(await res.text())
      if (entry && entry !== here) {
        done = true
        onUpdate()
      }
    } catch {
      // Sin red no hay nada que avisar; se reintenta en la siguiente vuelta.
    }
  }

  const onVisible = () => {
    if (!document.hidden) check()
  }
  timer = setInterval(check, CHECK_MS)
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
