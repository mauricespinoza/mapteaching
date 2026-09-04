// Español/English switch: la app se escribió en español, así que el español es
// el texto literal en el código y el inglés vive en un diccionario aparte.
// `t(texto)` devuelve la traducción si existe y, si no, el propio texto —así
// un texto que todavía no se tradujo sigue siendo legible en vez de romper la
// interfaz, y se puede ir ampliando el diccionario sin tocar los componentes.

import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'mapteaching:lang'

/**
 * Diccionario español → inglés. Las claves son el texto español tal como
 * aparece en el código: así no hace falta inventar identificadores, y basta
 * copiar el texto de un componente para saber si ya está traducido.
 */
const EN = {
  // --- Cabecera y menú de archivo ---
  'Nombre del ejercicio': 'Exercise name',
  Archivo: 'File',
  'Importar imagen base': 'Import base image',
  'Ejercicio nuevo': 'New exercise',
  'Abrir proyecto…': 'Open project…',
  'Exportar ejercicio': 'Export exercise',
  'Importar ejercicio': 'Import exercise',
  'Borrar todo': 'Clear all',
  Ejemplos: 'Examples',
  'Idioma / Language': 'Idioma / Language',
  Idioma: 'Language',
  'Deshacer (Ctrl+Z)': 'Undo (Ctrl+Z)',
  Rehacer: 'Redo',
  'Pantalla completa (F11)': 'Full screen (F11)',
  'Salir de pantalla completa (F11 o Esc)': 'Exit full screen (F11 or Esc)',
  'Hay una versión nueva de MapTeaching.': 'There is a new version of MapTeaching.',
  Actualizar: 'Update',

  // --- Pestañas de vista ---
  mapa: 'map',
  Mapa: 'Map',
  perfil: 'profile',
  Perfil: 'Profile',
  '3d': '3d',
  '3D': '3D',
  pozos: 'wells',
  Pozos: 'Wells',
  tabla: 'table',
  Tabla: 'Table',
  guía: 'guide',
  Guía: 'Guide',

  // --- Herramientas (Toolbar) ---
  Navegar: 'Pan',
  Seleccionar: 'Select',
  'Curva de nivel': 'Contour line',
  Contacto: 'Contact',
  Falla: 'Fault',
  'Contorno estr.': 'Structure cont.',
  'Escala gráfica': 'Graphic scale',
  Medir: 'Measure',
  Norte: 'North',
  'Área de trabajo': 'Work area',
  'Traza de perfil': 'Section line',
  Pozo: 'Well',
  'Piercing Points': 'Piercing Points',
  Modelo: 'Model',
  'Cortar línea': 'Cut line',
  'Borrar rasgo': 'Erase feature',
  'Toque = vértice': 'Tap = vertex',
  'Arrastrar = trazo': 'Drag = stroke',
  'Un toque coloca un vértice; mantener y arrastrar dibuja un trazo continuo':
    'A tap places a vertex; press and drag draws a continuous stroke',
  'Sólo lápiz': 'Pen only',
  'Dedo dibuja': 'Finger draws',
  'Con el lápiz activo, los dedos sólo navegan (rechazo de palma)':
    'With the pen active, fingers only pan (palm rejection)',

  // --- Capas del mapa ---
  'Curvas de nivel': 'Contour lines',
  'Cotas de las curvas': 'Contour elevations',
  Contactos: 'Contacts',
  Fallas: 'Faults',
  'Contornos estructurales': 'Structure contours',
  'Rótulos de los contornos': 'Contour labels',
  'Contornos estructurales de las fallas': 'Fault structure contours',
  'Rumbo y manteo': 'Strike and dip',
  'Ejes de pliegues': 'Fold axes',
  'Trazas de perfil': 'Section lines',
  'Contactos proyectados': 'Projected contacts',
  'Relieve sombreado': 'Hillshade',
  'Relleno de unidades': 'Unit fill',
  'Modelos sintéticos': 'Synthetic models',

  // --- Diálogos comunes ---
  Cancelar: 'Cancel',
  'Aplicar escala': 'Apply scale',
  'Proyectos guardados': 'Saved projects',
  Abrir: 'Open',
  'Abriendo…': 'Opening…',
  Borrar: 'Delete',
  'No hay proyectos guardados.': 'No saved projects.',
  'Ejercicios de ejemplo': 'Example exercises',
  'Se abre una copia nueva: lo que hagas encima no toca el ejemplo original ni los proyectos que ya tengas guardados.':
    'A new copy is opened: whatever you do to it leaves the original example and your saved projects untouched.',
  'Esto vacía el ejercicio: curvas de nivel, unidades, contactos, fallas, perfiles, pozos y modelos.':
    'This empties the exercise: contour lines, units, contacts, faults, sections, wells and models.',
  'Se conservan la imagen base, la escala y el norte, para que puedas empezar de nuevo sobre el mismo mapa. La acción se puede deshacer con Ctrl+Z.':
    'The base image, scale and north are kept, so you can start over on the same map. The action can be undone with Ctrl+Z.',
  'Cota de la curva': 'Contour elevation',
  'Elevación (m s.n.m.)': 'Elevation (m a.s.l.)',
  'Guardar curva': 'Save contour',
  'Contorno estructural': 'Structure contour',
  'Un contorno estructural es la recta de cota constante sobre la superficie: donde el contacto pasa por esa altura. El motor los calcula desde los cruces de la traza con las curvas de nivel; el que dibujes aquí manda sobre esa cota.':
    'A structure contour is the constant-elevation line on the surface: where the contact passes through that height. The engine computes them from where the trace crosses the contour lines; the one you draw here overrides that elevation.',
  'Superficie a la que pertenece': 'Surface it belongs to',
  falla: 'fault',
  'Cota estructural (m s.n.m.)': 'Structural elevation (m a.s.l.)',
  'Añadir contorno': 'Add contour',
  'Calibrar escala': 'Calibrate scale',
  'La línea trazada mide': 'The traced line measures',
  'píxeles. Indica su longitud real.': 'pixels. Enter its real length.',
  'Longitud real (m)': 'Real length (m)',
  Resultado: 'Result',
  'ancho del mapa': 'map width',
  unidades: 'units',
  curvas: 'contours',
  'Borrar la imagen base': 'Delete the base image',
  'Se quita la imagen del mapa. Todo lo digitalizado encima —curvas, contactos, fallas, perfiles y pozos— se conserva con sus coordenadas.':
    'The image is removed from the map. Everything digitized on top of it —contours, contacts, faults, sections and wells— keeps its coordinates.',
  'El lienzo vuelve al tamaño de la imagen para que nada se mueva de sitio. Se puede deshacer con Ctrl+Z.':
    'The canvas returns to the size of the image so nothing shifts. It can be undone with Ctrl+Z.',
  Aviso: 'Notice',

  // --- Vista 3D ---
  'Vista 3D': '3D view',
  Topografía: 'Topography',
  'Imagen base': 'Base image',
  Curvas: 'Contours',
  Trazas: 'Traces',
  Unidades: 'Units',
  Perfiles: 'Sections',
  'Sobre el terreno': 'Above ground',
  'Falla hasta el techo': 'Fault to the top',
  'Opacidad de las unidades': 'Unit opacity',
  'Cuán transparente se ve cada superficie bajo el terreno: menos opacidad deja ver las de abajo a través de las de arriba.':
    'How transparent each surface looks below ground: lower opacity lets the lower ones show through the upper ones.',
  'Opacidad sobre el terreno': 'Above-ground opacity',
  'La prolongación de cada superficie por encima del relieve: lo que ya se erosionó.':
    'The extension of each surface above the terrain: what has already eroded away.',
  'Arrastra para rotar · dos dedos o rueda para acercar · clic derecho para desplazar. Toca una superficie para ver qué es.':
    'Drag to rotate · pinch or scroll to zoom · right-click to pan. Tap a surface to see what it is.',
  'Define la escala del mapa para construir el modelo 3D.':
    'Set the map scale to build the 3D model.',
  'Sin actitud resuelta aquí.': 'No attitude resolved here.',
  'La actitud es la del punto tocado, no la media del rasgo: en un pliegue cada flanco mantea distinto.':
    'The attitude is that of the tapped point, not the feature average: in a fold each limb dips differently.',

  // --- Aviso de calibración y barra de capas ---
  'Falta la escala.': 'Missing scale.',
  'Usa la herramienta «Escala gráfica» (R): traza una línea de largo conocido sobre el mapa e indica cuántos metros mide.':
    'Use the «Graphic scale» tool (R): trace a line of known length on the map and enter how many metres it measures.',
  visible: 'visible',
  oculta: 'hidden',
  'Recalcular contornos estructurales, perfiles, 3D y pozos': 'Recompute structure contours, sections, 3D and wells',
  Recalcular: 'Recompute',
  'Encuadrar el mapa en la ventana': 'Fit the map to the window',
  Encuadrar: 'Fit',
  'Exportar el mapa como PNG': 'Export the map as PNG',
  'sin escala': 'no scale',
  Reemplazar: 'Replace',
  'Borrar imagen': 'Delete image',
  'Ocultar panel': 'Hide panel',
  'Mostrar panel': 'Show panel',
  Capas: 'Layers',
  Modelos: 'Models',
  Datos: 'Data',
  'Salir del modo enfoque (Esc)': 'Exit focus mode (Esc)',
  Salir: 'Exit',

  // --- Barra de estado (herramienta activa) ---
  'próxima cota': 'next elevation',
  'Trazando contacto': 'Tracing contact',
  'Crea unidades para generar contactos': 'Create units to generate contacts',
  'Trazando falla': 'Tracing fault',
  'Se creará una falla nueva al trazar': 'A new fault will be created when you trace',
  'Traza el contorno estructural de': 'Trace the structure contour of',
  'y dale su cota': 'and give it its elevation',
  'Traza una recta de cota constante: al soltar eliges superficie y cota':
    'Trace a constant-elevation line: on release you pick the surface and elevation',
  'Traza una línea de largo conocido': 'Trace a line of known length',
  'Traza una flecha apuntando al Norte': 'Trace an arrow pointing North',
  'Arrastra el rectángulo del área de trabajo': 'Drag the work-area rectangle',
  'Traza la línea del perfil (A–A′)': 'Trace the section line (A–A′)',
  'Toca el mapa para ubicar el pozo': 'Tap the map to place the well',
  'Toca un rasgo para eliminarlo': 'Tap a feature to delete it',
  'Toca un rasgo para seleccionarlo o moverlo · pulsación larga abre sus opciones':
    'Tap a feature to select or move it · long-press opens its options',
}

const I18nContext = createContext({ lang: 'es', setLang: () => {}, t: (s) => s })

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'es'
    } catch {
      return 'es'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      /* almacenamiento no disponible: el idioma simplemente no persiste */
    }
  }, [lang])
  const setLang = (l) => setLangState(l === 'en' ? 'en' : 'es')
  const value = useMemo(
    () => ({
      lang,
      setLang,
      t: (text) => (lang === 'en' ? EN[text] ?? text : text),
    }),
    [lang]
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useLang() {
  return useContext(I18nContext)
}
