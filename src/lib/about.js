// Ficha de la app: qué versión es, quién la hace, con qué está hecha y qué ha
// ido cambiando.
//
// El registro de cambios vive aquí y no en un archivo aparte porque la app se
// usa desde el navegador, muchas veces en una tablet prestada y sin acceso al
// repositorio: si el historial no está dentro de la propia app, para el que la
// usa no existe. Cada entrada cuenta lo que se nota al usarla, no el commit.

/** Versión publicada. Se mantiene a la par con la de `package.json`. */
export const VERSION = '1.4.0'

export const AUTHOR = {
  name: 'Mauricio Espinoza',
  role: 'Departamento de Ciencias de la Tierra, Universidad de Concepción',
  email: 'mauricespinoza@udec.cl',
  repo: 'https://github.com/mauricespinoza/mapteaching',
  site: 'https://mauricespinoza.github.io/mapteaching/',
}

/**
 * Con qué está hecha. Se listan las piezas de las que depende lo que se ve, no
 * el `package.json` entero: quien pregunta «¿con qué está hecho esto?» quiere
 * saber qué dibuja el 3D y dónde se guardan sus proyectos.
 */
export const TOOLS = [
  { name: 'React 18', what: 'Interfaz y estado de la aplicación.' },
  { name: 'Vite 6', what: 'Empaquetado y publicación en GitHub Pages.' },
  { name: 'Three.js', what: 'Vista 3D: relieve, superficies, planos de falla y diques.' },
  { name: 'Tailwind CSS', what: 'Estilos de la interfaz.' },
  { name: 'lucide-react', what: 'Iconos, junto con los propios de la app.' },
  { name: 'Canvas 2D + SVG', what: 'Mapa y perfil: en pantalla sobre canvas, exportados como SVG vectorial.' },
  { name: 'IndexedDB', what: 'Proyectos e imágenes, guardados en el propio equipo: nada sale del navegador.' },
  {
    name: 'Motor geológico propio',
    what:
      'Contornos estructurales, dominios y ejes de pliegue, superficies por bloque, relieve desde las curvas, ' +
      'diques y exportación a GemPy. Sin dependencias externas.',
  },
]

/**
 * Registro de cambios, del más reciente al más antiguo. `highlights` son frases
 * cortas, en el orden en que se notan al abrir la app.
 */
export const CHANGELOG = [
  {
    version: '1.4.0',
    date: '2026-09-16',
    title: 'Superficies heredadas sin picos, diques cerrados y arranque limpio',
    highlights: [
      'Se acaban los picos de las superficies plegadas heredadas: el desplazamiento de espesor constante usa ahora el manteo de los limbos que midió el mapa, y no la pendiente del dibujo, que en las charnelas se empina más que cualquier limbo. Aparecían sobre todo hacia los bordes del área de trabajo.',
      'El piso de un dique en 3D se dibuja sólo donde el fondo del modelo atraviesa el cuerpo, en vez de tapizar de intrusivo todo el fondo del área.',
      'Los diques se cierran también por las cabeceras, donde los corta el borde del área: ya no se ve su interior desde fuera del modelo.',
      'Al abrir la app se ven sólo las curvas de nivel, las unidades pintadas, las fallas y las trazas de perfil. Los contornos estructurales, los rótulos y los demás símbolos se encienden cuando hacen falta.',
      'Nueva pestaña «About» con la versión, el contacto y este registro de cambios.',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-09-12',
    title: 'Diques, relevo de geometría y exportación vectorial',
    highlights: [
      'Diques: se digitalizan por sus dos paredes y el cuerpo se acuña solo donde las trazas convergen, en el mapa, el perfil, el 3D y la columna de un pozo.',
      'Relevo de geometría: donde un contacto no tiene contornos estructurales propios, sigue al de encima con espesor constante, con una transición suave en medio.',
      'Pestaña «Símbolos»: color de las fallas y de los ejes de pliegue, y grosor de línea.',
      'Exportación del mapa a SVG vectorial.',
      '«Extender hasta el borde» prolonga la traza de una falla siguiendo su propia superficie.',
      'Ejemplo nuevo: «Dike pinch-out».',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-09-11',
    title: 'Discordancias: paquetes estructurales y fallas selladas',
    highlights: [
      'Una discordancia separa la serie en paquetes con geometría propia: la cobertura ya no hereda el pliegue de lo que trunca.',
      'La discordancia decide hasta dónde llega cada falla, leído del mapa, y en el 3D el plano se detiene ahí.',
      'Logo y cabecera nuevos; el estereograma pasa a pestaña propia.',
      'Ejemplo nuevo: «Fold, fault & unconformity».',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-09-09',
    title: 'Digitalización automática, visibilidad por rasgo y GemPy',
    highlights: [
      'Digitalización automática del mapa: separa por tinta las curvas de nivel de la geología y las convierte en trazas.',
      'Ver u ocultar cada unidad y cada contacto por separado; reasignar unidades línea a línea y cortar trazas.',
      'Los contornos de un pliegue dejan de mezclar limbos, y el eje de pliegue deja de salir cruzado.',
      'Exportación del ejercicio a GemPy (.zip) desde la vista 3D.',
      'Mover o escalar una superficie en el 3D cambia sus contornos en el mapa.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-08-30',
    title: 'Primera versión completa',
    highlights: [
      'Los bollos de las charnelas: el pliegue primero —la mezcla de los planos de los dominios— y los datos después.',
      'Puntos de perforación: el salto de falla que sí queda determinado.',
      'Ejes de pliegue en el mapa, estereograma y regla en el perfil.',
      'Contactos entre unidades no consecutivas, y falla hasta el techo en el 3D.',
      'Idioma español/inglés.',
    ],
  },
  {
    version: '0.9.0',
    date: '2026-08-25',
    title: 'Primeras versiones',
    highlights: [
      'Digitalización con lápiz sobre tablet, edición Bézier de las trazas y área de trabajo recortable.',
      'Relieve reconstruido a partir de las curvas de nivel, con interpolación suave y equiespaciada.',
      'Contornos estructurales, rumbo y manteo, pliegues resueltos por limbos y unidades pintadas en el mapa.',
      'Bloques de falla: cada contacto se resuelve por separado a cada lado, y el corte sigue el plano de la falla.',
      'Perfil estructural y vista 3D.',
    ],
  },
]
