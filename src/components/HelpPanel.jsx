import { inputCls } from './ui.jsx'

/** Guía de trabajo y enunciado del ejercicio. */
export default function HelpPanel({ project, dispatch }) {
  return (
    <div className="h-full overflow-y-auto bg-white p-4 text-sm text-slate-700">
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
          su traza (puedes dibujar varios tramos y a ambos lados de una falla).
        </li>
        <li>
          <b>Digitaliza las fallas</b> e indica su cinemática. Las fallas parten el mapa en bloques: cada contacto
          se resuelve por separado en cada bloque, y así aparece el desplazamiento.
        </li>
        <li>
          Revisa los <b>contornos estructurales</b> y la tabla de <b>rumbo y manteo</b> por pares de contornos
          consecutivos.
        </li>
        <li>
          Traza <b>perfiles</b> y ábrelos para ver la geometría en profundidad, y ubica <b>pozos</b> (con
          profundidad, trend y plunge) para predecir la columna que cortarían.
        </li>
      </ol>

      <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-800">Modelos sintéticos</h3>
      <p className="mb-2 text-[13px] leading-relaxed">
        En la pestaña <b>Modelos</b> puedes ir en la dirección contraria: en vez de deducir la estructura a
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
        <li>R · escala</li>
        <li>S · perfil</li>
        <li>W · pozo</li>
        <li>E · borrar</li>
        <li>M · modelo</li>
        <li>Ctrl+Z / Ctrl+Y</li>
        <li>Enter · cerrar trazo</li>
        <li>Esc · cancelar trazo</li>
      </ul>
    </div>
  )
}
