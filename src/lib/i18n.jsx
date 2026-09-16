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
  Dique: 'Dike',
  'Contorno estr.': 'Structure cont.',
  'Escala gráfica': 'Graphic scale',
  Espesor: 'Thickness',
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
  'Unidades de los contactos': 'Contact unit labels',
  Fallas: 'Faults',
  Diques: 'Dikes',
  'Contornos estructurales': 'Structure contours',
  'Rótulos de los contornos': 'Contour labels',
  'Rumbo y manteo': 'Strike and dip',
  // «Fold axes» va en inglés en las dos lenguas: es el término con el que se
  // rotula el eje de un pliegue en cualquier mapa, y así lo pidió la cátedra.
  'Trazas de perfil': 'Section lines',
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
  Estereograma: 'Stereonet',
  'Símbolos': 'Symbols',
  'Salir del modo enfoque (Esc)': 'Exit focus mode (Esc)',
  Salir: 'Exit',

  // --- Barra de estado (herramienta activa) ---
  'próxima cota': 'next elevation',
  'Trazando contacto': 'Tracing contact',
  'Crea unidades para generar contactos': 'Create units to generate contacts',
  'Trazando falla': 'Tracing fault',
  'Se creará una falla nueva al trazar': 'A new fault will be created when you trace',
  Trazando: 'Tracing',
  trazas: 'traces',
  'Se creará un dique nuevo al trazar: una línea por cada pared':
    'A new dike will be created when you trace: one line per wall',
  'Traza el contorno estructural de': 'Trace the structure contour of',
  'y dale su cota': 'and give it its elevation',
  'Traza una recta de cota constante: al soltar eliges superficie y cota':
    'Trace a constant-elevation line: on release you pick the surface and elevation',
  'Traza una línea de largo conocido': 'Trace a line of known length',
  'Traza una flecha apuntando al Norte': 'Trace an arrow pointing North',
  'Arrastra el rectángulo del área de trabajo': 'Drag the work-area rectangle',
  'Traza la línea del perfil (A–A′)': 'Trace the section line (A–A′)',
  'Toca el mapa para ubicar el pozo': 'Tap the map to place the well',
  'Toca una línea donde quieras partirla en dos: cada trozo queda editable por separado':
    'Tap a line where you want to cut it in two: each piece stays editable on its own',
  'Toca un rasgo para eliminarlo': 'Tap a feature to delete it',
  'Toca un rasgo para seleccionarlo o moverlo · pulsación larga abre sus opciones':
    'Tap a feature to select or move it · long-press opens its options',

  // --- Pestaña About ---
  About: 'About',
  'App web de docencia en geología estructural: digitaliza un mapa y resuelve contornos estructurales, rumbo y manteo, perfiles, un modelo 3D y la columna esperada en un pozo.':
    'Web app for teaching structural geology: digitise a map and it solves structure contours, strike and dip, sections, a 3D model and the column expected in a borehole.',
  'Compilada el': 'Built on',
  Creador: 'Created by',
  'Departamento de Ciencias de la Tierra, Universidad de Concepción':
    'Departamento de Ciencias de la Tierra, Universidad de Concepción',
  'App en vivo': 'Live app',
  'Código fuente': 'Source code',
  'Principales herramientas': 'Main tools',
  'Interfaz y estado de la aplicación.': 'User interface and application state.',
  'Empaquetado y publicación en GitHub Pages.': 'Bundling and deployment to GitHub Pages.',
  'Vista 3D: relieve, superficies, planos de falla y diques.':
    '3D view: relief, surfaces, fault planes and dikes.',
  'Estilos de la interfaz.': 'Interface styling.',
  'Iconos, junto con los propios de la app.': "Icons, alongside the app's own.",
  'Mapa y perfil: en pantalla sobre canvas, exportados como SVG vectorial.':
    'Map and section: drawn on canvas, exported as vector SVG.',
  'Proyectos e imágenes, guardados en el propio equipo: nada sale del navegador.':
    'Projects and images, stored on the device itself: nothing leaves the browser.',
  'Motor geológico propio': 'In-house geological engine',
  'Contornos estructurales, dominios y ejes de pliegue, superficies por bloque, relieve desde las curvas, diques y exportación a GemPy. Sin dependencias externas.':
    'Structure contours, structural domains and fold axes, surfaces per fault block, relief from the contour lines, dikes and GemPy export. No external dependencies.',
  'Todo corre en el navegador: las imágenes y los proyectos se guardan en el propio equipo y no se envían a ningún servidor.':
    'Everything runs in the browser: images and projects are stored on the device and never sent to a server.',
  'Registro de cambios': 'Changelog',

  'Superficies heredadas sin picos, diques cerrados y arranque limpio':
    'Inherited surfaces without spikes, closed dikes and a clean start',
  'Se acaban los picos de las superficies plegadas heredadas: el desplazamiento de espesor constante usa ahora el manteo de los limbos que midió el mapa, y no la pendiente del dibujo, que en las charnelas se empina más que cualquier limbo. Aparecían sobre todo hacia los bordes del área de trabajo.':
    'No more spikes on inherited folded surfaces: the constant-thickness offset now uses the dip of the limbs the map measured, not the slope of the drawn surface, which in the hinges steepens beyond any limb. They showed up mostly towards the edges of the work area.',
  'El piso de un dique en 3D se dibuja sólo donde el fondo del modelo atraviesa el cuerpo, en vez de tapizar de intrusivo todo el fondo del área.':
    "A dike's floor in 3D is now drawn only where the bottom of the model cuts through the body, instead of carpeting the whole floor of the work area with intrusive rock.",
  'Los diques se cierran también por las cabeceras, donde los corta el borde del área: ya no se ve su interior desde fuera del modelo.':
    'Dikes are now closed at their ends too, where the edge of the work area cuts them: you can no longer see inside them from outside the model.',
  'Al abrir la app se ven sólo las curvas de nivel, las unidades pintadas, las fallas y las trazas de perfil. Los contornos estructurales, los rótulos y los demás símbolos se encienden cuando hacen falta.':
    'The app now opens showing only the contour lines, the filled units, the faults and the section lines. Structure contours, labels and the other symbols are switched on when needed.',
  'Nueva pestaña «About» con la versión, el contacto y este registro de cambios.':
    'New "About" tab with the version, the contact address and this changelog.',

  'Diques, relevo de geometría y exportación vectorial':
    'Dikes, geometry handover and vector export',
  'Diques: se digitalizan por sus dos paredes y el cuerpo se acuña solo donde las trazas convergen, en el mapa, el perfil, el 3D y la columna de un pozo.':
    'Dikes: digitised by their two walls, and the body pinches out on its own where the traces converge — on the map, the section, in 3D and in a borehole column.',
  'Relevo de geometría: donde un contacto no tiene contornos estructurales propios, sigue al de encima con espesor constante, con una transición suave en medio.':
    'Geometry handover: where a contact has no structure contours of its own, it follows the one above it at constant thickness, with a smooth transition in between.',
  'Pestaña «Símbolos»: color de las fallas y de los ejes de pliegue, y grosor de línea.':
    '"Symbols" tab: colour of faults and fold axes, and line thickness.',
  'Exportación del mapa a SVG vectorial.': 'Map export to vector SVG.',
  '«Extender hasta el borde» prolonga la traza de una falla siguiendo su propia superficie.':
    '"Extend to the edge" prolongs a fault trace following its own surface.',
  'Ejemplo nuevo: «Dike pinch-out».': 'New example: "Dike pinch-out".',

  'Discordancias: paquetes estructurales y fallas selladas':
    'Unconformities: structural packages and sealed faults',
  'Una discordancia separa la serie en paquetes con geometría propia: la cobertura ya no hereda el pliegue de lo que trunca.':
    'An unconformity splits the series into packages with geometry of their own: the cover no longer inherits the fold of what it truncates.',
  'La discordancia decide hasta dónde llega cada falla, leído del mapa, y en el 3D el plano se detiene ahí.':
    'The unconformity decides how far each fault reaches, read from the map, and in 3D the plane stops there.',
  'Logo y cabecera nuevos; el estereograma pasa a pestaña propia.':
    'New logo and header; the stereonet moves to a tab of its own.',
  'Ejemplo nuevo: «Fold, fault & unconformity».': 'New example: "Fold, fault & unconformity".',

  'Digitalización automática, visibilidad por rasgo y GemPy':
    'Automatic digitising, per-feature visibility and GemPy',
  'Digitalización automática del mapa: separa por tinta las curvas de nivel de la geología y las convierte en trazas.':
    'Automatic map digitising: separates contour lines from geology by ink colour and turns them into traces.',
  'Ver u ocultar cada unidad y cada contacto por separado; reasignar unidades línea a línea y cortar trazas.':
    'Show or hide each unit and each contact separately; reassign units line by line and cut traces.',
  'Los contornos de un pliegue dejan de mezclar limbos, y el eje de pliegue deja de salir cruzado.':
    "A fold's structure contours no longer mix limbs, and the fold axis stops coming out askew.",
  'Exportación del ejercicio a GemPy (.zip) desde la vista 3D.':
    'Exercise export to GemPy (.zip) from the 3D view.',
  'Mover o escalar una superficie en el 3D cambia sus contornos en el mapa.':
    'Moving or scaling a surface in 3D changes its structure contours on the map.',

  'Primera versión completa': 'First complete release',
  'Los bollos de las charnelas: el pliegue primero —la mezcla de los planos de los dominios— y los datos después.':
    'The bumps in the hinges: the fold first — the blend of the domain planes — and the data afterwards.',
  'Puntos de perforación: el salto de falla que sí queda determinado.':
    'Piercing points: the fault slip that really is determined.',
  'Ejes de pliegue en el mapa, estereograma y regla en el perfil.':
    'Fold axes on the map, stereonet and a ruler in the section.',
  'Contactos entre unidades no consecutivas, y falla hasta el techo en el 3D.':
    'Contacts between non-consecutive units, and fault-to-the-top in 3D.',
  'Idioma español/inglés.': 'Spanish/English switch.',

  'Primeras versiones': 'Earliest releases',
  'Digitalización con lápiz sobre tablet, edición Bézier de las trazas y área de trabajo recortable.':
    'Pen digitising on a tablet, Bézier editing of the traces and a croppable work area.',
  'Relieve reconstruido a partir de las curvas de nivel, con interpolación suave y equiespaciada.':
    'Relief reconstructed from the contour lines, with smooth evenly spaced interpolation.',
  'Contornos estructurales, rumbo y manteo, pliegues resueltos por limbos y unidades pintadas en el mapa.':
    'Structure contours, strike and dip, folds solved limb by limb and units painted on the map.',
  'Bloques de falla: cada contacto se resuelve por separado a cada lado, y el corte sigue el plano de la falla.':
    'Fault blocks: each contact is solved separately on each side, and the cut follows the fault plane.',
  'Perfil estructural y vista 3D.': 'Structural section and 3D view.',
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
