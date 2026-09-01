import { inputCls } from './ui.jsx'
import { BUILD } from '../lib/version.js'

/** Guía de trabajo y enunciado del ejercicio. */
export default function HelpPanel({ project, dispatch }) {
  return (
    <div className="h-full overflow-y-auto bg-white p-4 text-sm text-slate-700">
      <div className="mb-3 rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-500">
        Versión del <b className="font-semibold text-slate-700">{BUILD}</b>
      </div>

      <h3 className="mb-2 text-sm font-semibold text-slate-800">Enunciado del ejercicio</h3>
      <textarea
        className={`${inputCls} min-h-[140px] font-normal`}
        placeholder="Escribe aquí las instrucciones para los estudiantes…"
        value={project.statement || ''}
        onChange={(e) => dispatch({ type: 'patch', patch: { statement: e.target.value } })}
      />

      <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-800">Flujo de trabajo</h3>
      <ol className="list-decimal space-y-2 pl-5 text-[13px] leading-relaxed">
        <li>
          <b>Importa el mapa</b> (imagen del mapa geológico o de la carta topográfica) y <b>calibra la escala</b>:
          con la herramienta «Escala gráfica» traza una línea sobre la barra de escala del mapa e indica su largo
          real. Si el mapa no está orientado al norte, ajústalo con «Norte».
        </li>
        <li>
          <b>Digitaliza las curvas de nivel</b> asignando la cota de cada una. La equidistancia se autocompleta:
          cada curva nueva propone la cota siguiente.
        </li>
        <li>
          <b>Define las unidades</b> de base a techo. Entre unidades consecutivas se crea un contacto; digitaliza
          su traza (puedes dibujar varios tramos y a ambos lados de una falla). Con «+ Contacto» creas además
          contactos <b>entre unidades cualesquiera</b>, no sólo consecutivas —el par se elige con las selects
          «Abajo»/«Arriba» de su tarjeta—, que es como se digitaliza una discordancia que salta varias unidades.
        </li>
        <li>
          <b>Digitaliza las fallas</b> e indica su cinemática. Las fallas parten el mapa en bloques: cada contacto
          se resuelve por separado en cada bloque, y así aparece el desplazamiento. En el perfil y en el 3D el
          corte entre bloques <b>sigue el plano de la falla</b>, no baja recto desde su traza: el bloque de un
          lado se mete por debajo y el de enfrente se retira, tanto más cuanto menor sea el manteo. El plano que
          se ve en 3D y la línea que se dibuja en el perfil son <b>esa misma superficie</b>, la que resuelven los
          contornos estructurales de la falla, así que las unidades se cortan justo donde se ve la falla.
        </li>
        <li>
          En <b>Datos</b> tienes tres herramientas más: el <b>estereograma</b> (red de Schmidt con el polo y el
          plano de cada unidad, en su color: los polos agrupados son unidades concordantes), el <b>salto de las
          fallas</b> —ojo, la <i>separación</i> que mide el mapa cambia con cada unidad y no es el salto; el
          salto neto es uno solo para toda la falla— y dos botones para <b>promediar el rumbo y la separación</b>
          de los contornos estructurales y para <b>inferirlos en las demás cotas</b>. Esos dos llevan un umbral:
          donde el rumbo o la separación cambian de golpe la serie se corta, para no fundir en una sola geometría
          inventada dos que son distintas.
        </li>
        <li>
          En el <b>perfil</b>, la <b>regla</b> mide con dos toques: separación vertical, corrimiento horizontal y
          distancia real, imantándose a los contactos, las fallas y la topografía. Es el gesto con el que se lee
          el salto de una falla. En el <b>3D</b>, «Sobre el terreno» dibuja la prolongación ya erosionada de cada
          superficie, «Falla hasta el techo» prolonga el plano de cada falla hasta el borde superior del modelo
          en vez de cortarlo justo en la traza, y tocar una superficie dice qué es y con qué rumbo y manteo
          <i>en ese punto</i>.
        </li>
        <li>
          Para el <b>salto real</b> de una falla, la herramienta <b>«Piercing Points»</b> y{' '}
          <b>Datos → Piercing Points</b>. Un contacto desplazado sólo da su <i>separación</i>, y con capas
          paralelas el salto nunca queda determinado. Un rasgo <b>lineal</b> reconocido a los dos lados —la
          charnela de un pliegue, un dique cortando un contacto, el eje de un paleocanal— corta el plano de falla
          en <b>un punto</b>, y el vector entre los dos puntos <b>es</b> el salto neto. Con él, cada contacto
          medido a un lado y no al otro se lleva al otro bloque: si aflora, su traza sale punteada en el mapa; si
          no, el panel dice a qué profundidad quedó <b>enterrado</b>.
        </li>
        <li>
          La capa <b>Ejes de pliegues</b> dibuja el eje de cada antiforme y sinforme con su simbología clásica
          —espigas que se abren hacia fuera del trazo si los limbos bajan alejándose del eje, y se cierran hacia
          dentro si bajan hacia él, más una flecha de inmersión cuando el pliegue se hunde—, calculado
          directamente de los dominios de manteo: uno por paquete de capas concordantes, aunque lo aporten varias.
          Es un buen candidato para el rasgo lineal que piden los Piercing Points.
        </li>
        <li>
          Cuando <b>dos superficies se cruzan</b> —lejos de sus datos cada una extrapola a su aire— manda la más
          joven: <b>pasa entera por encima</b> y las antiguas se limitan contra ella, que es lo que ocurre en una
          discordancia angular. Donde queda cortado, el contacto antiguo deja de dibujarse: el borde que se ve es
          su <b>línea de subafloramiento</b> bajo la discordancia.
        </li>
        <li>
          Revisa los <b>contornos estructurales</b> y la tabla de <b>rumbo y manteo</b> por pares de contornos
          consecutivos. Cuando los puntos no caben en un solo plano —una superficie plegada— se reparten antes
          en <b>limbos</b> y cada uno da su propio rumbo y manteo: nunca se une un punto de un flanco con otro
          del flanco opuesto, ni de una onda del pliegue con la siguiente.
        </li>
        <li>
          <b>Corrige lo que haga falta.</b> Una <b>pulsación larga</b> sobre cualquier rasgo abre su menú: en un
          contacto se reasigna el par de unidades y el tipo de contacto, en una falla su cinemática, en una curva
          de nivel su cota, y en todos ellos el borrado. Los <b>contornos estructurales</b> que calcula la app son
          una hipótesis, no un dato: se arrastran para corregirlos —por el medio para moverlos, por un extremo
          para girarlos— y con la herramienta <b>Contorno estr.</b> (<span className="font-mono">G</span>) se
          añade uno nuevo dándole su cota. Cada contorno lleva su rótulo con el rasgo y la cota que representa.
          Un contorno puesto a mano manda sobre esa cota, así que rumbo y manteo, perfil, 3D y pozos responden al
          momento; «Restaurar los contornos calculados» devuelve el mando al motor.
        </li>
        <li>
          Si una unidad <b>no cruza suficientes curvas de nivel</b> para dar dos contornos estructurales, no se
          queda sin geometría: <b>hereda la de la unidad concordante de encima</b>, <b>manteniendo el espesor
          constante</b>. Así, bajo un pliegue, las capas inferiores se pliegan igual en vez de aplanarse. El
          espesor no se inventa: se ajusta con los pocos datos que la unidad sí tiene. Lo mismo vale para una
          traza que sólo corta curvas en un tramo: da un manteo, pero no cómo varía, así que conserva su medida
          y toma prestada la forma en profundidad. La herencia va <b>sólo hacia abajo</b>, hacia las capas más
          antiguas: un pliegue arrastra consigo a las capas de debajo, pero las de encima pueden estar en
          discordancia sobre él y no seguirlo, así que una unidad que sólo tenga vecinos resueltos por debajo se
          queda sin resolver. También se corta en las discordancias y en los contactos intrusivos, y no cruza
          una falla: a cada lado se ajusta por separado.
        </li>
        <li>
          Con la <b>regla</b> mides distancias sobre el mapa. Con el <b>imán</b> activo los extremos se pegan a
          las trazas digitalizadas y la medida se toma <b>perpendicular</b> a la traza en la que se ancla, que es
          como hay que medir el ancho de un afloramiento; si el manteo de ese contacto está resuelto, la app
          añade el espesor verdadero (<span className="font-mono">e = L · sen δ</span>).
        </li>
        <li>
          Si el ejercicio ocupa sólo una parte de la lámina, define el <b>área de trabajo</b>: arrastra un
          rectángulo con esa herramienta y tanto los polígonos del mapa geológico como el modelo 3D quedan
          recortados a él. Se quita desde la tarjeta «Área de trabajo» del panel de capas.
        </li>
        <li>
          En el computador, el <b>clic derecho</b> abre ese mismo menú, la tecla <b>Supr</b> borra la línea
          seleccionada —de un contacto o una falla quita la traza elegida, no el rasgo entero— y las{' '}
          <b>flechas</b> desplazan el mapa (con <span className="font-mono">Mayús</span>, a zancadas). Todo es
          reversible con <span className="font-mono">Ctrl+Z</span>.
        </li>
        <li>
          Traza <b>perfiles</b> y ábrelos para ver la geometría en profundidad, y ubica <b>pozos</b> (con
          profundidad, trend y plunge) para predecir la columna que cortarían.
        </li>
      </ol>

      <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-800">Modelos sintéticos</h3>
      <p className="mb-2 text-[13px] leading-relaxed">
        La pestaña <b>Modelos</b> tiene dos mitades: en <b>Capas</b> defines la estructura y en{' '}
        <b>Curvas de nivel</b> el terreno sobre el que aflora.
      </p>
      <p className="mb-2 text-[13px] leading-relaxed">
        Con <b>Capas</b> vas en la dirección contraria a lo habitual: en vez de deducir la estructura a
        partir del mapa, defines la estructura y la app dibuja el mapa que produciría. Marca un punto y elige:
      </p>
      <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed">
        <li>
          <b>Plano único</b> — rumbo y manteo (regla de la mano derecha) de un contacto. La traza resultante
          muestra la <i>regla de la V</i>: cómo el contacto se desvía valle arriba según su manteo.
        </li>
        <li>
          <b>Serie de capas</b> — n capas paralelas del mismo espesor con un solo rumbo y manteo. En planta se
          ven las bandas repetidas, separadas <span className="font-mono">espesor / sen(manteo)</span>.
        </li>
        <li>
          <b>Pliegues</b> — un tren de pliegues cilíndricos rectos sobre esa serie, definido por el{' '}
          <b>trend y plunge</b> del eje, el <b>ángulo interlimbo</b>, la <b>longitud de onda</b> (cresta a
          cresta) y el <b>grado de asimetría</b>. Con el eje horizontal las trazas son rectas paralelas; al
          darle inmersión aparecen las narices cerradas características de un pliegue que se sumerge.
        </li>
      </ul>
      <p className="mb-2 mt-2 text-[13px] leading-relaxed">
        Todo funciona incluso sin curvas de nivel (terreno plano). Si las hay, las trazas se calculan cortando
        la topografía real, que es donde el ejercicio se vuelve interesante.
      </p>
      <p className="mb-2 mt-2 text-[13px] leading-relaxed">
        Con <b>Curvas de nivel</b> generas el relieve de partida sin digitalizarlo: siete topografías típicas
        —cerro, cuenca cerrada, valle en V, valle meandriforme, dos valles y una cuchilla, meseta con escarpe
        y ladera uniforme—, cada una con cota de base, desnivel, equidistancia y orientación ajustables. Las
        curvas que salen son las isolíneas <i>exactas</i> de ese relieve, así que puedes contrastar tu lectura
        contra la respuesta. También puedes <b>importar un modelo de elevación</b> (malla ASCII de ESRI{' '}
        <span className="font-mono">.asc</span>, volcado <span className="font-mono">XYZ</span> o{' '}
        <span className="font-mono">CSV</span>, o una imagen en escala de grises) y sacarle las curvas; si trae
        tamaño de celda, la app puede tomar de ahí también la escala del mapa. Generar sustituye las curvas
        que hubiera, en un solo Ctrl+Z.
      </p>
      <p className="mb-2 text-[13px] leading-relaxed">
        Al crear un modelo se <b>aplica al mapa</b> automáticamente: sus capas y contactos pasan a ser
        unidades y contactos reales del ejercicio, de modo que los contornos estructurales, el perfil, la
        vista 3D y los pozos trabajan con él. Si cambias los parámetros, pulsa <b>Recalcular el mapa</b> en la
        tarjeta del modelo para regenerarlos, o <b>Recalcular</b> en la barra del mapa para rehacer todos los
        cálculos.
      </p>

      <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-800">El método</h3>
      <p className="text-[13px] leading-relaxed">
        Un contacto geológico aflora donde la superficie que lo define corta la topografía. Por lo tanto, cada
        intersección de la traza del contacto con una curva de nivel es un punto de esa superficie del que
        conocemos las tres coordenadas. Uniendo los puntos de igual cota se obtienen los{' '}
        <b>contornos estructurales</b> (rectas si la superficie es plana): su dirección es el <b>rumbo</b>, y la
        separación horizontal entre dos contornos consecutivos da el <b>manteo</b>,{' '}
        <span className="font-mono">arctan(Δcota / separación)</span>, con el manteo hacia el contorno de menor
        cota. Es exactamente la construcción que se hace a mano en el papel, aquí calculada por mínimos cuadrados.
      </p>

      <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-800">Tablet y lápiz</h3>
      <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed">
        <li>
          <b>Trazo híbrido</b>: un toque coloca un vértice y otro toque el siguiente; si en cambio mantienes
          apretado y arrastras, dibujas un trazo continuo. Los dos se pueden mezclar en la misma línea.
        </li>
        <li>Con «Sólo lápiz» el Apple Pencil dibuja y los dedos navegan; un toque limpio con el dedo selecciona.</li>
        <li>
          <b>Editar una línea</b>: selecciónala y aparecen sus nodos. Arrastra un nodo para moverlo, toca la
          línea para insertar uno nuevo, y arrastra los manejadores azules del nodo activo para curvarla
          (Bézier). El botón «Suave / pico» convierte el nodo en vértice anguloso y viceversa.
        </li>
        <li>
          <b>Gestos</b>: doble toque con <b>dos dedos</b> deshace; con <b>tres dedos</b>, rehace.
        </li>
        <li>El trazo continuo se suaviza al soltar (simplificación Douglas–Peucker).</li>
      </ul>

      <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-800">Atajos</h3>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-slate-600">
        <li>H · navegar</li>
        <li>V · seleccionar</li>
        <li>C · curva de nivel</li>
        <li>X · contacto</li>
        <li>F · falla</li>
        <li>G · contorno estr.</li>
        <li>R · escala</li>
        <li>S · perfil</li>
        <li>W · pozo</li>
        <li>D · medir</li>
        <li>E · borrar</li>
        <li>B · área de trabajo</li>
        <li>M · modelo</li>
        <li>Ctrl+Z / Ctrl+Y</li>
        <li>Enter · cerrar trazo</li>
        <li>Esc · cancelar trazo</li>
        <li>Supr · borrar selección</li>
        <li>←↑→↓ · desplazar</li>
      </ul>

      <p className="mt-3 text-[11px] text-slate-400">
        Si sale un aviso de versión nueva arriba, pulsa «Actualizar» para traerla. Si sospechas que el
        navegador se quedó con una versión vieja (típico en iPad), compara la fecha de arriba con la del
        ordenador: si no coincide, cierra la pestaña del todo y vuelve a abrirla.
      </p>
    </div>
  )
}
