# MapTeaching

**App en vivo:** https://mauricespinoza.github.io/mapteaching/

App web de **docencia en geología estructural**: digitaliza un mapa geológico o
topográfico escaneado y resuelve, con los mismos pasos que se hacen a mano en el
papel, los **contornos estructurales**, el **rumbo y manteo** de cada contacto,
los **perfiles estructurales**, un **modelo 3D** y la **columna esperada en un
pozo**.

Está pensada para trabajar con **lápiz sobre tablet** (Apple Pencil: el lápiz
dibuja, los dedos navegan) y también con **ratón y teclado** en el computador.
Todo corre en el navegador: las imágenes y los proyectos nunca salen del equipo
(se guardan en IndexedDB).

---

## Funcionalidades

### 1. Importar y calibrar el mapa

- **Imagen base**: cualquier imagen (foto o escaneo del mapa, carta geológica,
  captura de pantalla). Se dibuja sobre ella con el lápiz.
- **Escala gráfica**: se traza una línea sobre la barra de escala del mapa y se
  indica su largo real; de ahí sale la relación metros/píxel que usa todo el
  cálculo.
- **Norte**: si el mapa no está orientado al norte, se traza una flecha hacia el
  Norte y los azimuts se corrigen automáticamente.
- Sin imagen también se puede trabajar: la app dibuja un **sombreado de relieve**
  reconstruido desde las curvas digitalizadas.

### 2. Digitalización

| Elemento | Cómo |
| --- | --- |
| **Curvas de nivel** | Se traza la curva y se indica su cota. La equidistancia se autocompleta y la siguiente curva propone la cota siguiente. |
| **Contactos geológicos** | Se definen primero las **unidades** de base a techo; entre unidades consecutivas se crea un contacto (concordante, discordante, intrusivo o inferido) cuya traza se digitaliza, en tantos tramos como haga falta. |
| **Fallas** | Traza + **cinemática** (normal, inversa, dextral, sinestral y sus combinaciones oblicuas). Se dibujan con su simbología (garrapatas en el bloque colgante, triángulos en las inversas, medias flechas en las de rumbo). |
| **Trazas de perfil** | Línea A–A′ que abre la vista de perfil. |
| **Pozos** | Un toque sobre el mapa; luego profundidad medida, *trend* y *plunge*. |

**Trazo híbrido**: un toque coloca un vértice; mantener apretado y arrastrar
dibuja un trazo continuo (suavizado Douglas–Peucker al soltar). Ambos se mezclan
en la misma línea. El botón «Sólo lápiz» activa el rechazo de palma: los dedos
desplazan y hacen zoom, y un toque limpio selecciona.

**Edición con curvas Bézier**: al seleccionar una línea aparecen sus nodos.
Arrastrar un nodo lo mueve, tocar la línea inserta uno nuevo, y los manejadores
del nodo activo controlan la curvatura; «Suave / pico» alterna entre nodo suave
y vértice anguloso. La polilínea que consume el motor se regenera a partir de
las curvas, así que la edición no altera ningún cálculo.

**Gestos en tablet**: doble toque con dos dedos deshace, con tres dedos rehace.
Una **pulsación larga** sobre una línea entra directamente en edición de
vértices. El **modo enfoque** oculta la interfaz y deja el mapa a pantalla
completa (no depende de la API del navegador, así que no se cae al arrastrar).

**Capas**: la imagen base, las curvas, los contactos, las fallas y los modelos
tienen control de **opacidad** y un **candado** que impide seleccionarlos y
editarlos. Las unidades nuevas toman por defecto los colores de la tabla
cronoestratigráfica internacional (CGMW/ICS), del Precámbrico al Cuaternario.

### 3. Modelos estructurales sintéticos

El camino inverso: en vez de deducir la estructura desde el mapa, se define la
estructura y la app dibuja **la traza que produciría en planta**. Se marca un
punto y se elige el modelo:

| Modelo | Parámetros | Qué enseña |
| --- | --- | --- |
| **Plano único** | rumbo y manteo (regla de la mano derecha) | La **regla de la V**: cómo un contacto se desvía valle arriba según su manteo. |
| **Serie de capas** | n capas, espesor, rumbo y manteo | Bandas repetidas separadas `espesor / sen(manteo)`. |
| **Pliegues** | trend y plunge del eje, ángulo interlimbo, longitud de onda (cresta a cresta), grado de asimetría, perfil redondeado o angular | Con eje horizontal, trazas rectas; al darle inmersión aparecen las **narices cerradas** de un pliegue que se sumerge. |

El modelo pinta además el mapa geológico resultante y reparte símbolos de rumbo
y manteo calculados punto a punto (en un pliegue, el manteo de cada flanco y la
inmersión del eje en la charnela).

Al crear un modelo se **aplica al mapa** automáticamente: sus capas y contactos
se materializan como unidades y contactos reales, así que el resto de la app
—contornos estructurales, perfiles, 3D y pozos— trabaja con él. El botón
**Recalcular el mapa** de la tarjeta regenera esas entidades tras cambiar los
parámetros, y **Recalcular** en la barra del mapa rehace todos los cálculos.

Todo funciona **sin necesidad de importar nada**: sobre terreno plano ya se ven
los patrones de afloramiento. Si hay curvas de nivel digitalizadas, las trazas
se calculan cortando la topografía real.

En planta se pinta además el **mapa geológico**: recorriendo una grilla se
evalúa qué unidad aflora en cada punto (la topografía queda por encima de su
contacto basal y por debajo del que la limita arriba), de modo que los polígonos
definidos por contactos sucesivos aparecen rellenos con el color de su unidad.

### 4. Contornos estructurales, rumbo y manteo

Un contacto aflora donde su superficie corta la topografía, así que **cada
intersección de la traza con una curva de nivel es un punto de la superficie con
las tres coordenadas conocidas**. La app:

1. calcula esas intersecciones,
2. agrupa los puntos por cota y ajusta a cada grupo una recta por mínimos
   cuadrados totales — el **contorno estructural** de esa cota,
3. para cada **par de contornos consecutivos** entrega el rumbo (dirección de las
   rectas) y el manteo `arctan(Δcota / separación horizontal)`, con la dirección
   de manteo hacia el contorno de menor cota,
4. y promedia los polos para dar la actitud media de la superficie.

Los resultados salen en el mapa (contornos punteados con su cota y símbolos de
rumbo/manteo) y en la tabla del panel **Resultados**, exportable a CSV en las dos
notaciones habituales: cuadrante (`N45°E / 30° SE`) y dirección de manteo
(`135/30`).

Si una superficie tiene pocas intersecciones (una sola cota resuelta, un punto
por cota), la app lo advierte y permite **imponer la actitud a mano**.

El panel **Datos** incluye además una sección didáctica que dibuja, para cada
par de contornos, el **triángulo rectángulo** del que sale el manteo —la
diferencia de cotas Δh como cateto vertical y la separación horizontal d como
cateto horizontal, con la fórmula `tan δ = Δh / d` resuelta con los números del
ejercicio— y explica cómo se pasa de la distancia medida en el mapa al espesor
real (`e = L·sen δ` o `e = V·cos δ`). Sin escala horizontal calibrada avisa de
que el triángulo no se puede resolver.

### 5. Bloques de falla

Las trazas de falla parten el mapa en **bloques estructurales** (relleno por
inundación sobre una grilla). Cada contacto se resuelve **por separado en cada
bloque**, de modo que el desplazamiento a través de la falla aparece por sí solo
en el mapa, en el perfil y en el 3D — no hay que indicar ningún salto a mano.

### 6. Perfil estructural

Para cada traza A–A′: topografía, relleno de las unidades entre sus contactos,
horizontes ya erosionados proyectados sobre la topografía (punteados), líneas de
falla con su **manteo aparente** y flechas de movimiento, y los pozos del
corredor proyectados sobre el perfil. Exageración vertical y profundidad
ajustables; exportación a **SVG** y **PNG**.

La geometría en profundidad sale de un **ajuste local móvil** (moving least
squares) sobre los puntos observados: la superficie interpola exactamente los
datos, sigue los pliegues en vez de promediarlos a través de la charnela y da la
orientación local en cualquier punto. Donde faltan datos degrada suavemente
hacia el plano global, y con datos planos lo reproduce de forma exacta. Los
contornos estructurales se agrupan además **por limbo**, según la dirección de
manteo local, de modo que las rectas de un mismo flanco se ajustan juntas.

### 7. Vista 3D

Topografía reconstruida desde las curvas (con la imagen del mapa drapeada como
textura si la hay), curvas y trazas sobre el terreno, superficies de contacto por
bloque, planos de falla, pozos con sus intersecciones y los planos de los
perfiles. Exageración vertical y capas conmutables.

### 8. Pozos

Con la posición, la profundidad medida (MD), el *trend* y el *plunge* la app
calcula la trayectoria en 3D, sus intersecciones con contactos y fallas
(MD, profundidad vertical y cota), la **columna estratigráfica esperada** y el
**espesor real** de cada unidad, corregido por el ángulo entre el pozo y el polo
del contacto.

### 9. Proyectos

Autoguardado en el navegador, varios proyectos, **exportar/importar** el ejercicio
completo (`.mapteaching.json`, con la imagen embebida) para repartirlo a los
estudiantes, y un campo de **enunciado** para escribir las instrucciones del
ejercicio. El botón **Ejemplo** genera un ejercicio sintético completo —
tres unidades con manteo 25° al ESE cortadas por una falla normal de 70°W con
320 m de salto— útil para practicar y para comprobar que el método recupera la
geometría original.

---

## Atajos

`H` navegar · `V` seleccionar · `C` curva de nivel · `X` contacto · `F` falla ·
`R` escala · `N` norte · `S` perfil · `W` pozo · `M` modelo · `E` borrar ·
`Ctrl+Z` / `Ctrl+Y` deshacer/rehacer · `Enter` cerrar trazo · `Esc` cancelar.

---

## Desarrollo

```bash
npm install
npm run dev      # servidor de desarrollo
npm run build    # producción en dist/
```

### Estructura

```
src/lib/
  geom.js        utilidades geométricas (intersecciones, ajuste de rectas y planos, RDP)
  georef.js      píxeles ↔ metros, azimuts y notación de actitudes
  model.js       entidades del proyecto
  store.js       reducer con historial (deshacer/rehacer)
  db.js          IndexedDB (proyectos e imágenes)
  structure.js   contornos estructurales, rumbo/manteo y modelo de superficie
  blocks.js      partición en bloques por las fallas
  dem.js         modelo de elevación desde las curvas (transformada de distancia)
  scene.js       ensamblaje de la escena geológica
  section.js     construcción de perfiles
  wells.js       trayectoria y columna de pozos
  marching.js    isolíneas (usado por el generador de ejercicios)
  sample.js      ejercicio sintético de demostración
  models.js      modelos sintéticos: plano, serie de capas y tren de pliegues
  render2d.js    dibujo del mapa en canvas
src/components/  interfaz (mapa, perfil, 3D, pozos, paneles)
```

Sin backend ni dependencias de servicios externos: React, Vite, Tailwind y
three.js.
