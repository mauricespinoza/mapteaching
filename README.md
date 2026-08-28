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
| **Contornos estructurales** | Se trazan a mano cuando hace falta corregir o completar lo que calcula la app: una recta de cota constante sobre una superficie. También se editan arrastrando los que la app dibuja. |
| **Trazas de perfil** | Línea A–A′ que abre la vista de perfil. |
| **Pozos** | Un toque sobre el mapa; luego profundidad medida, *trend* y *plunge*. |
| **Regla** | Mide distancias sobre el mapa. Con el **imán** activo los extremos se pegan a las trazas digitalizadas y la medida se toma **perpendicular** a la traza en la que se ancla; si el manteo de ese contacto está resuelto, añade el espesor verdadero `e = L·sen δ`. |
| **Área de trabajo** | Rectángulo que acota el ejercicio: los polígonos del mapa geológico, el modelo 3D, las trazas drapeadas y los planos de falla y de perfil se recortan a él. Se dibuja arrastrando y se quita desde el panel de capas. |

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
Una **pulsación larga** sobre cualquier rasgo —o el **clic derecho** con ratón—
entra en edición de vértices y abre su **menú de opciones**, que es la vía para lo que no cabe en el lienzo y
en tablet no tiene ni clic derecho ni teclas:

| Rasgo | Qué ofrece el menú |
| --- | --- |
| **Contacto** | Reasignarlo a otro **par de unidades** (arriba y abajo), cambiar el tipo de contacto, añadir un contorno estructural, borrar la traza o el contacto entero. |
| **Falla** | Cambiar su **cinemática**, añadir un contorno estructural, borrar la traza o la falla entera. |
| **Curva de nivel** | Corregir su **cota** (a mano o de equidistancia en equidistancia) y borrarla. |
| **Contorno estructural** | Cambiar su **cota estructural**, fijarlo para editarlo, borrarlo y devolver el mando al cálculo. |
| **Perfil, pozo, modelo** | Borrarlos. |

El **modo enfoque** oculta la interfaz y deja el mapa a pantalla completa (no
depende de la API del navegador, así que no se cae al arrastrar).

**Capas**: la imagen base, las curvas, los contactos, las fallas y los modelos
tienen control de **opacidad** y un **candado** que impide seleccionarlos y
editarlos. Las unidades nuevas toman por defecto los colores de la tabla
cronoestratigráfica internacional (CGMW/ICS), del Precámbrico al Cuaternario.

### 3. Modelos sintéticos

El panel **Modelos** tiene dos mitades, que responden a preguntas distintas: en
**Capas** se define la estructura, y en **Curvas de nivel** el terreno sobre el
que esa estructura aflora.

#### Capas: estructuras sintéticas

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

En planta se pinta además el **mapa geológico**, y lo delimitan las trazas, no el
modelo: las trazas de contactos y fallas se rasterizan como muros, se etiquetan
las regiones que dejan entre sí, y cada región recibe **una sola** unidad —la que
más veces gana al comparar la topografía con la pila estratigráfica dentro de
ella—. Así el color sólo puede cambiar sobre una traza, que es lo que se ve en un
mapa geológico, y una unidad que topa con una falla se detiene en la falla. El
modelo sigue mandando en *qué* unidad es cada región, que es lo que no se puede
leer del mapa sin resolver la estructura, pero ya no en dónde acaba: antes el
borde entre dos colores caía donde dijera la superficie ajustada, a decenas de
metros de la línea dibujada.

#### Curvas de nivel: el relieve de partida

Sin curvas de nivel no hay cota del terreno, y sin cota no hay contornos
estructurales, ni perfil, ni relieve 3D. Digitalizarlas sobre una carta
escaneada es lento, y para practicar la lectura del relieve basta con un terreno
de laboratorio del que se conoce la respuesta. La app genera las curvas de siete
**topografías típicas** —cerro, cuenca cerrada, valle en V, valle meandriforme,
dos valles separados por una cuchilla, meseta con escarpe y ladera uniforme—,
cada una con su miniatura, y con cota de base, desnivel, equidistancia y
orientación ajustables. Las curvas que salen son las **isolíneas exactas** de
ese relieve, no un dibujo aproximado, así que el alumno puede contrastar su
lectura contra la verdad.

También se puede **importar un modelo de elevación** y sacarle las curvas:
malla ASCII de ESRI (`.asc`, la exportación estándar de un SIG), volcado `XYZ` o
`CSV` de x y z, o una imagen en escala de grises como mapa de alturas. El modelo
se encaja en el área de la imagen **conservando su proporción** —estirarlo
deformaría el relieve y con él los manteos que se midan después—, y si trae
tamaño de celda se puede tomar de ahí también **la escala del mapa**, que es lo
que hace que manteos, espesores y la barra de escala salgan en metros de verdad.

Generar sustituye las curvas que hubiera, en un solo paso de deshacer.

### 4. Contornos estructurales, rumbo y manteo

Un contacto aflora donde su superficie corta la topografía, así que **cada
intersección de la traza con una curva de nivel es un punto de la superficie con
las tres coordenadas conocidas**. La app:

1. calcula esas intersecciones,
2. **reparte los puntos en dominios estructurales** — ver más abajo—, de modo que
   nunca se mezclen datos de dos limbos ni de dos ondas de un tren de pliegues,
3. dentro de cada dominio agrupa los puntos por cota y ajusta a cada grupo una
   recta por mínimos cuadrados totales — el **contorno estructural** de esa cota,
4. para cada **par de contornos consecutivos del mismo limbo** entrega el rumbo
   (dirección de las rectas) y el manteo `arctan(Δcota / separación horizontal)`,
   con la dirección de manteo hacia el contorno de menor cota,
5. y promedia los polos para dar la actitud media de la superficie. En una
   superficie plegada no se promedia entre limbos: el panel lista la actitud de
   cada uno.

#### Superficies que cambian de manteo: limbos y ondas

Un contacto plegado no es un plano, y unir los puntos de igual cota «como si lo
fuera» promedia a través de la charnela y produce un contorno estructural que no
existe en el mapa. Lo mismo pasa entre dos ondas de un tren de pliegues: dos
limbos homólogos mantean igual pero están desplazados, así que tampoco pueden
compartir contorno.

El criterio para separarlos es el de la **regla de las V**: la forma en que la
traza cruza el relieve da la dirección de manteo local, y ésa es exactamente la
pendiente del plano que ajusta a los puntos de intersección. El motor extrae, uno
tras otro, los conjuntos máximos de puntos compatibles con un mismo plano
(RANSAC), exigiendo además que

- el conjunto tenga **al menos dos cotas** —tres puntos de la misma cota no
  definen un plano—,
- esté **espacialmente conectado**, y
- **no se salte datos**: si entre los contornos extremos de un panel cae una cota
  que no encaja, es que ahí dentro la superficie cambia de pendiente y el panel
  está uniendo dos limbos.

Los puntos que sobran se agregan al dominio que mejor los explica si queda cerca;
si ninguno lo hace, forman dominio propio (una cota suelta sigue siendo un
contorno estructural válido, aunque no dé manteo). La superficie en profundidad
se reconstruye después apoyándose en el plano del dominio de cada zona, no en un
plano global, así que cada limbo conserva su manteo y sólo la charnela queda
redondeada.

Los resultados salen en el mapa (contornos punteados con su cota y símbolos de
rumbo/manteo) y en la tabla del panel **Resultados**, exportable a CSV en las dos
notaciones habituales: cuadrante (`N45°E / 30° SE`) y dirección de manteo
(`135/30`).

Si una superficie tiene pocas intersecciones (una sola cota resuelta, un punto
por cota), la app lo advierte y permite **imponer la actitud a mano**.

#### Rumbo y separación medios, y contornos inferidos

Los contornos salen de los cruces de la traza con las curvas de nivel y llevan el
ruido de la digitalización: dos contornos consecutivos de una superficie plana
salen con unos grados de diferencia y con separaciones que bailan. Dos botones en
**Datos → Contornos estructurales** lo arreglan con la misma cuenta:

- **Rumbo y separación medios** sustituye cada tramo por contornos paralelos y
  equiespaciados, con el rumbo medio y la separación media del tramo.
- **Inferir en las demás cotas** prolonga ese mismo patrón a las cotas de curva
  de nivel donde la traza no llegó a cortar.

Lo que impide que esto se coma la geología es el **umbral**, ajustable: sólo se
promedian contornos que ya se parecían. Donde el rumbo gira más de lo tolerado, o
la separación cambia de golpe o de signo, la serie se corta y cada trozo se
promedia por su cuenta — promediar por encima de ese salto fundiría en una sola
geometría inventada dos que son distintas, que es justo lo que pasa entre
unidades discordantes. Los limbos de un pliegue ya iban por separado y lo siguen
haciendo. Un contorno suelto se queda como está.

#### Estereograma

En **Datos → Estereograma**: red de Schmidt equiareal, hemisferio inferior, con
el plano (círculo máximo) y el **polo** de cada unidad en el color de su unidad,
y las fallas punteadas. Los limbos de una superficie plegada van por separado.
Es la forma de ver de un vistazo qué es concordante —polos agrupados— y qué no:
un polo apartado del racimo es una discordancia, y polos repartidos a lo largo de
un círculo máximo delatan un pliegue cuyo eje es el polo de ese círculo.

#### Corregir y añadir contornos estructurales

Los contornos que salen del ajuste son una **hipótesis**, no un dato: con tres
puntos mal repartidos, o con una traza digitalizada a la ligera, la recta puede
quedar donde el mapa no la pondría. Por eso se pueden **corregir a mano**, que es
lo que se hace en el papel.

- **Mover uno**: con la herramienta *Seleccionar*, se toca el contorno y se
  arrastra —por el medio para desplazarlo entero, por un extremo para girarlo—.
  Al soltarlo queda fijado como dato del proyecto.
- **Añadir uno**: la herramienta **Contorno estr.** (`G`) traza una recta de cota
  constante; al soltar se elige a qué superficie pertenece y qué cota
  representa. Sirve para dar una cota que la traza no llegó a cruzar.
- **Cambiar su cota**: desde el menú de pulsación larga, a mano o de
  equidistancia en equidistancia.
- **Volver atrás**: «Restaurar los contornos calculados» devuelve el mando al
  motor, en el panel de capas o en el propio menú.

Cada contorno lleva su **rótulo con el rasgo al que pertenece y su cota
estructural** (`Fm. Cerro Blanco… · 800 m`), que es lo que permite distinguirlos
cuando se cruzan varios en el mapa; los rótulos se reparten sin pisarse y se
pueden apagar con el botón *Rótulos estr.*. Los contornos calculados se dibujan
punteados; los puestos a mano, en trazo continuo y con sus extremos como manijas.

Un contorno dibujado a mano **sustituye a lo calculado en esa cota** —y sólo en
esa cota, y sólo en su bloque de falla—: los cruces de la traza con esa curva de
nivel se descartan y en su lugar entra la recta del estudiante, con el mismo peso
que tendría un dato del mapa. Todo lo demás sigue igual, así que el resultado se
ve enseguida en el rumbo y manteo, en el perfil, en el 3D y en la columna del
pozo. Al fijar una cota se fijan **todos sus contornos en ese bloque** —los dos
limbos de un pliegue, si los hay—, para que corregir uno no borre el otro. En la
tabla de resultados, los manteos calculados con un contorno puesto a mano quedan
marcados con «✎».

#### Cuando dos superficies se cortan: manda la joven

Cada contacto se ajusta a sus propios datos, así que lejos de ellos extrapola a
su aire y dos superficies acaban cruzándose — en el ejercicio de prueba, en la
cuarta parte del mapa. Eso no existe en una serie estratigráfica, y hay una sola
manera de deshacerlo que sea geología: **la superficie más joven pasa entera por
encima y las antiguas se limitan contra ella**. Una capa depositada después no
la deforma la que tiene debajo; en una discordancia angular las capas plegadas
quedan cortadas contra el techo de la discordancia, y el mapa de subafloramiento
es justo el rastro de ese corte.

Así que antes de usarlas, las cotas de los contactos de un punto se recorren de
techo a muro y cada uno se baja hasta el de encima si lo sobrepasa. La
superficie joven no se mueve ni un metro y la antigua se acuña contra ella;
donde queda cortada, el contacto antiguo **deja de existir**: no se dibuja ni su
línea en el perfil ni su superficie en el 3D, aunque su cota siga haciendo falta
para saber dónde termina la unidad de debajo.

En el ejercicio de prueba la discordancia (techo de la Unidad 4) se hundía hasta
174 m arrastrada por el pliegue de debajo; ahora no se mueve, y el contacto
plegado queda truncado en el 22 % del mapa. El perfil pasó a mostrar dos
unidades más, que antes quedaban aplastadas bajo una discordancia hundida.

La regla la usan el mapa en planta, el perfil, el 3D y la columna del pozo, así
que las cuatro vistas cuentan la misma historia.

#### Unidades sin datos propios: geometría heredada

Una unidad que aflora en una franja estrecha —o cuya traza corre entre dos
curvas sin llegar a cruzarlas— no da los dos contornos estructurales que hacen
falta para medirle el manteo. Con esos pocos puntos, el ajuste plano devuelve
una superficie que no tiene nada que ver con la estructura del sector: bajo un
pliegue, la aplana justo donde el pliegue es la respuesta.

En una serie concordante la respuesta geológica es la de siempre: **las capas de
abajo repiten el pliegue de las de arriba**. Cuando un contacto no se puede
resolver solo, la app le da la geometría del contacto concordante resuelto más
próximo **hacia el techo**, construyendo la superficie **paralela** a él
(pliegue paralelo o concéntrico, clase 1B de Ramsay): la misma forma, desplazada
un **espesor verdadero constante** medido perpendicular a las capas. En cota ese
desplazamiento no es constante, vale `e / cos δ` con δ el manteo local, y por
eso el contacto heredado se separa más en los flancos que en las charnelas,
igual que un contacto real.

La herencia va **sólo hacia abajo**, hacia las capas más antiguas, y nunca al
revés. Que un contacto esté plegado obliga a las capas de debajo a repetir ese
pliegue —son las que el pliegue arrastró consigo—, pero no dice nada de las de
encima: una serie más joven puede estar depositada en discordancia sobre el
pliegue ya formado, y entonces no lo sigue. Un contacto sin datos propios que
sólo tenga vecinos resueltos por debajo se queda sin resolver, que es la
respuesta honesta: el mapa no da para saber su forma en profundidad.

El espesor no se inventa: se ajusta por mínimos cuadrados a los pocos datos que
el contacto sí tiene —sus cruces con curvas de nivel y, si no llegan a tres, su
traza leída sobre el relieve, que también son puntos de su superficie—. Con un
solo dato basta, porque la forma ya la pone el contacto de referencia y lo único
que queda por determinar es el espesor. El panel **Resultados** publica de quién
hereda cada contacto, el espesor ajustado, cuántos datos lo sostienen y su
desajuste, y avisa cuando los datos no encajan con un espesor constante.

Hay un segundo caso, más sutil: un contacto cuya traza sólo corta curvas de
nivel en un tramo **sí da un manteo, pero no cómo varía** — se resuelve como un
plano bajo un pliegue. Cuando el contacto vecino está plegado y los datos
propios encajan con un espesor constante (dentro de media equidistancia), el
contacto conserva sus medidas —su rumbo y manteo son datos del mapa— y toma
prestada sólo la **forma en profundidad**. Si sus datos contradicen el pliegue,
mandan ellos: la geometría prestada sería una hipótesis peor que la medida.

Dos límites deliberados: la herencia **se corta en las discordancias y en los
contactos intrusivos** (bajo una inconformidad las capas están truncadas, así
que no son paralelas a ella; sobre ella, en cambio, sí), y **no cruza una
falla** — cada bloque ajusta su propio espesor con sus propios datos. Un
contacto con la actitud impuesta a mano tampoco se toca.

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

Fuera del área de trabajo no hay ejercicio, así que su exterior es **muro** para
ese relleno por inundación, y las trazas de falla se prolongan por sus extremos
hasta salir de ella. Sin las dos cosas, los dos lados de una falla que cruza el
mapa se reencuentran rodeando por el margen vacío y todo sale como un solo
bloque: la falla no corta nada. Bastaba con que el trazo se quedara a 20 m del
borde de la grilla. La prolongación se corta al 25 % del mapa, y eso no es un
detalle: una falla que muere de verdad dentro del mapa no debe llegar al borde,
porque partiría en dos un bloque que es uno solo.

Esa partición vale en la superficie, porque la traza es justo donde el plano de
falla corta el terreno; en profundidad, no. Por eso el corte entre bloques **no
baja a plomo desde la traza sino que sigue el plano de la falla**: el criterio no
es de qué lado de la traza cae un punto sino de qué lado del plano, es decir si
su cota está por encima o por debajo de `z_falla(x, y)`. Así el bloque de un lado
se mete por debajo de la falla y el de enfrente se retira, tanto en el perfil
como en el 3D. Con una falla de 82° el corte se desplaza 276 m en planta a 2 km
de profundidad; antes se quedaba clavado bajo la traza, como si toda falla fuera
vertical.

Manda **una sola superficie de falla**, la que resuelven sus contornos
estructurales, y la usan por igual el corte de las unidades, la línea del perfil
y el plano que se dibuja en 3D: lo que se ve y lo que corta son el mismo objeto,
curva incluida. Antes el 3D dibujaba en su lugar una rampa con el manteo medio,
que se separaba del corte hasta 39 m.

Esa superficie se ajusta a los cruces de la traza con las curvas de nivel, así
que pasa por esos puntos pero entre ellos se aparta del terreno — hasta 39 m en
el ejercicio de prueba —, y sin embargo la traza *entera* está sobre el plano
por definición: es donde la falla corta el terreno. Ese residuo se mide a lo
largo de la traza y se suma a la superficie, ponderado por la distancia en
planta; como sólo depende de (x, y), se propaga buzamiento abajo igual que hace
un plano. Con la corrección, el plano pasa por su traza con 0,2 m de desvío
medio.

#### Salto de falla: separación no es salto

En **Datos → Salto de las fallas**. La *separación* es lo que el mapa mide —cuánto
se ha corrido el mismo contacto a un lado y otro— y depende de la orientación de
ese contacto, así que cada unidad da un número distinto y ninguno es «el salto».
El *salto neto* es el vector que une dos puntos que antes estaban juntos: es uno
solo para toda la falla, porque los bloques se mueven enteros.

Se calcula con la construcción clásica de las **líneas de corte**: la
intersección de cada contacto con el plano de falla es una línea dentro de ese
plano, y hay una en cada bloque; el salto es el vector del plano que lleva una
sobre la otra. Una sola línea no basta —el salto puede deslizarse a lo largo de
ella sin que cambie nada de lo que se ve—, así que el sistema se resuelve con
todas las unidades a la vez por mínimos cuadrados, y **se publica si está
determinado o no** en vez de dar un número con falsa confianza. Con capas
paralelas nunca lo está: sus líneas de corte también son paralelas, y lo que se
da es la cota inferior. Para fijarlo hace falta un segundo rasgo con otra
orientación —un contacto discordante, un dique, el eje de un pliegue cortado—.

La tabla añade el **residuo** de cada unidad respecto a ese salto único. Un
desplazamiento rígido tiene que explicarlas a todas; si dos unidades piden
saltos que difieren en cientos de metros, eso no lo produce la falla y es que
alguna superficie está mal resuelta junto a ella.

Sobre el ejemplo incorporado, cuyo salto vertical real es 320 m, la componente
vertical del salto neto sale 342 m.

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
hacia el plano del dominio estructural correspondiente, y con datos planos lo
reproduce de forma exacta. Los contornos estructurales se agrupan además **por
limbo** (ver §4), de modo que las rectas de un mismo flanco se ajustan juntas.

Una unidad sólo se rellena donde al menos uno de sus dos contactos está resuelto
en ese bloque —contando los que resuelven **heredando la geometría del contacto
vecino** (§4)—: sin ninguno no se sabe dónde empieza ni dónde acaba, y rellenar
«desde el fondo hasta la topografía» la extendía sobre bloques de falla en los
que no hay dato suyo. Los polígonos toman el color asignado a cada unidad, igual
que en planta.

La **regla** (botón en la barra del perfil) mide sobre el corte: dos toques y
publica la separación vertical, el corrimiento horizontal y la distancia real.
Los toques se imantan a los contactos, las fallas y la topografía, y cuando los
dos caen sobre el mismo contacto lo dice — ése es el gesto con el que se lee el
salto de una falla en un perfil.

### 7. El relieve a partir de las curvas

Casi todo lo demás se apoya en saber la cota del terreno en cualquier punto: el
mapa geológico en planta, la topografía del perfil, el drapeado en 3D y la
columna del pozo. Ese relieve se reconstruye como se hace a mano, dibujando
**curvas intermedias equiespaciadas** entre una curva de nivel y la siguiente
—310, 320, … 390 entre la de 300 y la de 400—, que van pasando gradualmente de
la forma de una a la de la otra. La app no dibuja unas cuantas curvas sueltas
sino el campo continuo del que salen: en cada punto mide la distancia a la curva
de abajo y a la de arriba y reparte la cota entre ambas, de modo que las curvas
intermedias son las curvas de nivel de ese campo y el paso de una a otra es
gradual por construcción. Sólo entran en este cálculo las curvas de nivel
topográficas: los contactos y las fallas son trazas geológicas, no isohipsas, y
no dicen nada de la cota del terreno.

Ese reparto **no es lineal**. Con el reparto lineal la ladera es un plano dentro
de cada banda —baja con pendiente equidistancia/ancho-de-banda, constante— y al
cruzar la curva siguiente cambia de golpe a la pendiente de la banda de al lado:
la cota es continua, pero la pendiente no, y el sombreado lee justo la
pendiente, así que cada curva salía dibujada como una arista, una franja de
terraza. Dentro de cada banda el reparto es una **cúbica de Hermite monótona**
que llega a cada curva con la pendiente promedio —media armónica— de las dos
bandas que allí se juntan; como las dos bandas vecinas calculan esa misma media,
la ladera cruza la curva sin quiebre. Al ser monótona no se pasa de las cotas de
sus curvas: entre la de 300 y la de 400 no puede haber ni un pico de 410 ni un
hoyo de 290, y las curvas intermedias salen repartidas de verdad.

Lo que decide el resultado es **con qué par de curvas se interpola**. Tomar las
dos cotas más cercanas no vale: junto a un collado la segunda más próxima salta
de la de arriba a la de abajo de un punto al siguiente, y la cota da un brinco
de casi dos equidistancias — ésos eran los saltos. Por eso las curvas se
rasterizan primero y se etiquetan las **regiones** que delimitan; dentro de una
región las dos curvas que la encierran no cambian, las distancias se miden sin
salir de ella y el campo no puede saltar.

Para que ese etiquetado signifique algo, las curvas tienen que cerrar el paso de
verdad. Si entre el final de una curva y el borde de la lámina queda un pasillo
abierto, las dos laderas que separaba se reencuentran rodeando por fuera y pasan
a ser la misma región; con unos pocos pasillos el mapa entero acaba siendo una
sola región, sin par de curvas que mande en ningún sitio. Por eso los extremos
que se salen de la lámina se prolongan hasta salir de ella, y **lo que queda
fuera del área de trabajo es barrera**: ahí no hay curvas que digitalizar, así
que el margen vacío es el pasillo más ancho de todos. El relieve se prolonga
hacia ese margen copiando el nodo válido más cercano, para que el borde del
recorte no abra un escalón en la vista 3D.

Las regiones que sólo tocan una curva son el interior de una curva cerrada: una
**cumbre o una depresión**. Ahí no hay nada que interpolar y hay que prolongar.
Se levanta (o se hunde) una bóveda que arranca con la misma pendiente que trae
la ladera de fuera y se aplana en el centro, acotada a una equidistancia —por
encima ya tocaría otra curva dibujada—. Es lo que se lee en el mapa, y evita
tanto la meseta plana como el pico inventado.

Donde falta una curva, una región puede tocar tres cotas o más y no haber un par
que mande. Ahí no se promedian las cotas sueltas —hacerlo por inverso del
cuadrado de la distancia deja pegado a su cota todo el entorno de cada curva, y
vuelve el aterrazado— sino **parejas** de curvas: cada pareja propone el mismo
reparto que en una banda y pesa según lo estrecho que sea el paso entre sus dos
curvas por allí, de modo que la pareja que de verdad encierra al punto manda y
las demás apenas cuentan.

Sobre superficies sintéticas de cota conocida (un cono, dos cerros con su
collado, un valle meandriforme, una cuenca cerrada) el relieve reconstruido no
supera en más de 1–2° la pendiente máxima real, y en el ejercicio de ejemplo la
aspereza baja de 0,68 a 0,23 m y el mayor pico local de 8,7 a 2,6 m. Midiendo
en qué parte de la banda cae cada nodo —0 sobre una curva, 0,5 a medio camino—
el reparto pasó de amontonar el 29 % de los nodos pegados a las curvas a
repartirlos parejo, 10 % en cada décimo de banda, que es lo que significa
«curvas intermedias equiespaciadas».

En la **vista 3D** el terreno se dibuja con su sombreado calculado del propio
modelo de elevación (sol al NO, 45° de altura), que multiplica la imagen del
mapa cuando está drapeada: con la luz de la escena sola, un escaneo claro deja
la superficie lavada y el relieve no se lee.

### 8. Vista 3D

Topografía reconstruida desde las curvas (con la imagen del mapa drapeada como
textura si la hay), curvas y trazas sobre el terreno, superficies de contacto por
bloque, planos de falla, pozos con sus intersecciones y los planos de los
perfiles. Exageración vertical y capas conmutables.

La casilla **«Sobre el terreno»**, con su control de opacidad, dibuja además la
prolongación de cada superficie por encima del relieve: lo que ya se erosionó, y
lo que enseña hacia dónde seguía el pliegue. Sale del mismo recorte exacto, con
el criterio de la topografía invertido y con un techo para que no se dispare.

**Tocar una superficie** dice qué rasgo es, en qué bloque, su cota en ese punto y
su **actitud ahí mismo** — no la media del rasgo: en un pliegue cada flanco
mantea distinto y la media no describe a ninguno de los dos.

Cada superficie de contacto se recorta **en el punto exacto** en que la limita
cada cosa, no en el borde de la celda de la malla: la topografía (por encima ya
está erosionada, y el borde que queda es su traza en el mapa), el plano de cada
falla que limita el bloque y la superficie joven que la trunca. El recorte es un
Sutherland–Hodgman sobre cada celda en el que se interpolan a la vez la posición
y cada criterio, así que los bordes salen curvos y limpios en vez de aserrados
al tamaño de la celda. Medido sobre el ejercicio de prueba: ningún vértice se
sale de la topografía más de 0,7 m ni del plano de falla más de 0,6 m, sobre un
relieve de 942 m.

### 9. Pozos

Con la posición, la profundidad medida (MD), el *trend* y el *plunge* la app
calcula la trayectoria en 3D, sus intersecciones con contactos y fallas
(MD, profundidad vertical y cota), la **columna estratigráfica esperada** y el
**espesor real** de cada unidad, corregido por el ángulo entre el pozo y el polo
del contacto.

### 10. Proyectos

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
`G` contorno estructural · `R` escala · `D` medir · `N` norte · `S` perfil ·
`W` pozo · `M` modelo · `B` área de trabajo · `E` borrar ·
`Supr` borrar lo seleccionado · `←↑→↓` desplazar el mapa (con `Mayús`, a
zancadas) · `Ctrl+Z` / `Ctrl+Y` deshacer/rehacer · `Enter` cerrar trazo ·
`Esc` cancelar.

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
  domains.js     reparto de una superficie en limbos y ondas (RANSAC)
  parallel.js    geometría heredada: superficies paralelas de espesor constante
  measure.js     regla del mapa: imán a las trazas y medida ortogonal
  structure.js   contornos estructurales, rumbo/manteo y modelo de superficie
  blocks.js      partición en bloques por las fallas
  dem.js         relieve desde las curvas (regiones, cúbica monótona, bóvedas)
  scene.js       ensamblaje de la escena geológica
  surfaces3d.js  mallas 3D de contactos y planos de falla, con sus recortes
  slip.js        salto de falla por líneas de corte: separación y salto neto
  scregular.js   contornos estructurales regularizados e inferidos
  section.js     construcción de perfiles
  wells.js       trayectoria y columna de pozos
  marching.js    isolíneas (usado por el generador de ejercicios)
  sample.js      ejercicio sintético de demostración
  models.js      modelos sintéticos: plano, serie de capas y tren de pliegues
  terrain.js     curvas de nivel de topografías típicas y de un DEM importado
  render2d.js    dibujo del mapa en canvas
src/components/  interfaz (mapa, perfil, 3D, pozos, paneles, iconos propios)
```

Sin backend ni dependencias de servicios externos: React, Vite, Tailwind y
three.js.
