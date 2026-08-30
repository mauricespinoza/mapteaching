import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { toWorldList, toImage } from '../lib/georef.js'
import { kinematicsOf } from '../lib/model.js'
import { frameTest, modelExtent } from '../lib/models.js'
import { buildWellModel } from '../lib/wells.js'
import { contactMeshes, faultSheetMesh } from '../lib/surfaces3d.js'

/**
 * Vista 3D: topografía reconstruida desde las curvas de nivel, trazas
 * geológicas drapeadas, superficies de contacto y falla, pozos y perfiles.
 */
export default function ThreeView({ project, scene, image }) {
  const mountRef = useRef(null)
  const stateRef = useRef(null)
  const [vExag, setVExag] = useState(1)
  const [aerialOpacity, setAerialOpacity] = useState(0.28)
  const [picked, setPicked] = useState(null)
  const [show, setShow] = useState({
    topo: true,
    contours: true,
    traces: true,
    surfaces: true,
    aerial: false,
    faults: true,
    faultTop: false,
    wells: true,
    sections: true,
    texture: true,
  })

  // --- Inicialización del render ---
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.appendChild(renderer.domElement)

    const three = new THREE.Scene()
    three.background = new THREE.Color('#0b1020')
    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 1, 1e7)
    camera.up.set(0, 0, 1)
    camera.position.set(0, -1, 0.8)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08

    three.add(new THREE.AmbientLight(0xffffff, 0.55))
    const sun = new THREE.DirectionalLight(0xffffff, 1.0)
    sun.position.set(-1, -1, 1.4)
    three.add(sun)
    const sun2 = new THREE.DirectionalLight(0xffffff, 0.35)
    sun2.position.set(1, 1, 0.6)
    three.add(sun2)

    const content = new THREE.Group()
    three.add(content)

    let raf = 0
    const loop = () => {
      controls.update()
      renderer.render(three, camera)
      raf = requestAnimationFrame(loop)
    }
    loop()

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    })
    ro.observe(mount)

    stateRef.current = { renderer, three, camera, controls, content, mount }
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      stateRef.current = null
    }
  }, [])

  // --- Identificación al tocar una superficie ---
  //
  // Un modelo con seis superficies translúcidas superpuestas no se lee solo: hay
  // que poder señalar una y que diga quién es. Se lanza un rayo desde el punto
  // tocado, se queda con la superficie más cercana y se le pregunta su actitud
  // *en ese punto*, no la media — en un pliegue cada flanco mantea distinto y la
  // media no describe ninguno de los dos.
  useEffect(() => {
    const st = stateRef.current
    if (!st) return
    const el = st.renderer.domElement
    let down = null
    const onDown = (e) => (down = [e.clientX, e.clientY])
    const onUp = (e) => {
      const from = down
      down = null
      // Si el dedo se movió, era una rotación y no una consulta.
      if (!from || Math.hypot(e.clientX - from[0], e.clientY - from[1]) > 5) return
      if (!scene?.ready || !st.toWorld) return
      const r = el.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1
      )
      const ray = new THREE.Raycaster()
      ray.setFromCamera(ndc, st.camera)
      const hits = ray.intersectObjects(st.content.children, false)
      const hit = hits.find((h) => h.object.userData?.kind)
      if (!hit) {
        setPicked(null)
        return
      }
      const { kind, id, name, block, eroded } = hit.object.userData
      const [wx, wy, wz] = st.toWorld(hit.point)
      const surf =
        kind === 'fault'
          ? scene.faultSurfaces.get(id)
          : scene.contactSurfaces.get(id)?.get(block)
      const att = surf?.attitudeAt ? surf.attitudeAt(wx, wy) : surf?.mean
      setPicked({ kind, name, block, eroded, z: wz, att: att || null })
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
    }
  }, [scene])

  // --- Contenido ---
  useEffect(() => {
    const st = stateRef.current
    if (!st || !scene?.ready) return
    const { content, camera, controls } = st
    disposeGroup(content)

    const { bbox, dem } = scene
    // Marco de trabajo: fuera de él no se construye nada, para que el modelo
    // termine exactamente donde el usuario acotó el ejercicio.
    const inFrame = frameTest(scene)
    const cx = (bbox.minX + bbox.maxX) / 2
    const cy = (bbox.minY + bbox.maxY) / 2
    const zRange = Math.max(1, dem.zmax - dem.zmin)
    const cz = dem.zmin
    const P = (x, y, z) => new THREE.Vector3(x - cx, y - cy, (z - cz) * vExag)

    const depth = Math.min(project.settings.sectionDepth || 2000, Math.max(400, zRange * 1.4))
    const zBottom = dem.zmin - depth
    // Techo del modelo: el mismo margen por encima del punto más alto que usan
    // los planos de perfil, para que "hasta el techo" sea un borde reconocible
    // y no un número arbitrario.
    const modelTop = dem.zmax + zRange * 0.05

    // Topografía
    if (show.topo && dem.valid) {
      const geo = new THREE.PlaneGeometry(1, 1, dem.nx - 1, dem.ny - 1)
      const pos = geo.attributes.position
      const uv = geo.attributes.uv
      const colors = new Float32Array(pos.count * 3)
      const color = new THREE.Color()
      const useTexNow = show.texture && image && project.image
      for (let j = 0; j < dem.ny; j++) {
        for (let i = 0; i < dem.nx; i++) {
          const idx = j * dem.nx + i
          // PlaneGeometry recorre de arriba a abajo: fila 0 = y máximo.
          const vi = (dem.ny - 1 - j) * dem.nx + i
          const x = bbox.minX + i * dem.cell
          const y = bbox.minY + j * dem.cell
          const z = dem.z[idx]
          pos.setXYZ(vi, x - cx, y - cy, (z - cz) * vExag)
          // Sombreado del relieve calculado del propio modelo de elevación —el
          // que sale de interpolar las curvas de nivel—, no sólo de las luces
          // de la escena: con la imagen del mapa drapeada encima, la luz sola
          // deja la superficie lavada y el relieve no se lee.
          const s = hillshade(dem, i, j, vExag)
          if (useTexNow) {
            // Multiplica la textura: la imagen se ve, pero con su relieve.
            color.setScalar(0.55 + 0.7 * s)
          } else {
            const t = (z - dem.zmin) / zRange
            color.setHSL(0.32 - 0.28 * t, 0.42, 0.34 + 0.34 * t)
            color.multiplyScalar(0.55 + 0.7 * s)
          }
          colors[vi * 3] = color.r
          colors[vi * 3 + 1] = color.g
          colors[vi * 3 + 2] = color.b
          if (image && project.image) {
            const px = toImage(scene.georef, [x, y])
            uv.setXY(vi, px[0] / project.image.width, 1 - px[1] / project.image.height)
          }
        }
      }
      if (inFrame) {
        // Se descartan los triángulos con algún vértice fuera del marco; así el
        // terreno queda cortado en el borde sin tener que remallar.
        const keep = new Uint8Array(pos.count)
        for (let j = 0; j < dem.ny; j++) {
          for (let i = 0; i < dem.nx; i++) {
            const vi = (dem.ny - 1 - j) * dem.nx + i
            keep[vi] = inFrame(bbox.minX + i * dem.cell, bbox.minY + j * dem.cell) ? 1 : 0
          }
        }
        const src = geo.getIndex().array
        const out = []
        for (let t = 0; t < src.length; t += 3) {
          if (keep[src[t]] && keep[src[t + 1]] && keep[src[t + 2]]) out.push(src[t], src[t + 1], src[t + 2])
        }
        geo.setIndex(out)
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      geo.computeVertexNormals()
      const useTex = useTexNow
      const mat = new THREE.MeshStandardMaterial({
        // El color por vértice lleva el sombreado, así que va siempre: con
        // textura la multiplica, sin ella aporta también el tinte hipsométrico.
        vertexColors: true,
        map: useTex ? new THREE.CanvasTexture(toCanvas(image)) : null,
        roughness: 0.95,
        metalness: 0,
        side: THREE.DoubleSide,
      })
      content.add(new THREE.Mesh(geo, mat))
    }

    // Curvas de nivel drapeadas
    if (show.contours) {
      for (const c of scene.worldContours) {
        for (const run of clipRuns(c.pts, inFrame)) {
          const pts = run.map((p) => P(p[0], p[1], c.elevation + zRange * 0.002))
          content.add(lineFrom(pts, 0xb45309, 0.85))
        }
      }
    }

    // Trazas de contactos y fallas sobre la topografía
    if (show.traces) {
      for (const cw of scene.contactWorld) {
        const color = new THREE.Color(cw.contact.color || '#0f172a')
        for (const tr of cw.traces) {
          for (const run of clipRuns(tr, inFrame)) {
            const pts = run.map((p) => P(p[0], p[1], dem.elevationAt(p[0], p[1]) + zRange * 0.004))
            content.add(lineFrom(pts, color.getHex(), 1, 2))
          }
        }
      }
      for (const fw of scene.faultWorld) {
        const color = new THREE.Color(kinematicsOf(fw.fault.kinematics).color)
        for (const tr of fw.traces) {
          for (const run of clipRuns(tr, inFrame)) {
            const pts = run.map((p) => P(p[0], p[1], dem.elevationAt(p[0], p[1]) + zRange * 0.006))
            content.add(lineFrom(pts, color.getHex(), 1, 3))
          }
        }
      }
    }

    // Superficies de contacto por bloque. Se pueden pedir dos mitades: la que
    // queda bajo el terreno —la geología que aún existe— y, aparte, la que ya
    // se ha erosionado, que enseña hacia dónde seguía el pliegue en el aire.
    const addSurfaces = (opts, opacity, eroded) => {
      for (const { contactIndex: ci, block, tris } of contactMeshes(scene, opts)) {
        const c = scene.contacts[ci]
        const unit = scene.units.find((u) => u.id === c.upperUnitId)
        const color = new THREE.Color(unit?.color || c.color || '#38bdf8')
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(toScene(tris, P), 3))
        geo.computeVertexNormals()
        const mesh = new THREE.Mesh(
          geo,
          new THREE.MeshStandardMaterial({
            color,
            transparent: true,
            opacity,
            side: THREE.DoubleSide,
            roughness: 0.8,
            depthWrite: !eroded,
          })
        )
        // Lo que hace falta para contestar al toque: qué rasgo es y en qué
        // bloque, para poder pedirle su actitud en el punto tocado.
        mesh.userData = { kind: 'contact', id: c.id, name: c.name, block, eroded }
        content.add(mesh)
      }
    }
    if (show.surfaces) addSurfaces({ zMin: zBottom, inFrame }, 0.62, false)
    if (show.aerial) {
      addSurfaces(
        { zMax: dem.zmax + zRange * 0.6, inFrame, eroded: true },
        Math.max(0.04, aerialOpacity),
        true
      )
    }

    // Planos de falla
    if (show.faults) {
      for (const fw of scene.faultWorld) {
        const surf = scene.faultSurfaces.get(fw.id)
        const color = new THREE.Color(kinematicsOf(fw.fault.kinematics).color)
        for (const tr of fw.traces) {
          for (const run of clipRuns(tr, inFrame)) {
            const tris = faultSheetMesh(run, surf, dem, {
              zBottom,
              zTop: show.faultTop ? modelTop : null,
              inFrame,
              side: scene.side,
              rows: show.faultTop ? 22 : 14,
            })
            if (!tris) continue
            const geo = new THREE.BufferGeometry()
            geo.setAttribute('position', new THREE.Float32BufferAttribute(toScene(tris, P), 3))
            geo.computeVertexNormals()
            const mesh = new THREE.Mesh(
              geo,
              new THREE.MeshStandardMaterial({
                color,
                transparent: true,
                opacity: 0.5,
                side: THREE.DoubleSide,
                roughness: 0.6,
              })
            )
            mesh.userData = { kind: 'fault', id: fw.id, name: fw.fault.name, block: null, eroded: false }
            content.add(mesh)
          }
        }
      }
    }

    // Pozos
    if (show.wells) {
      for (const w of project.wells) {
        const wm = buildWellModel(w, scene)
        if (inFrame && !inFrame(wm.surface[0], wm.surface[1])) continue
        const a = P(wm.surface[0], wm.surface[1], wm.surface[2])
        const b = P(wm.bottom.x, wm.bottom.y, wm.bottom.z)
        content.add(lineFrom([a, b], 0xf59e0b, 1, 3))
        const head = new THREE.Mesh(
          new THREE.SphereGeometry(Math.max(zRange * 0.012, scene.side * 0.004), 16, 12),
          new THREE.MeshStandardMaterial({ color: 0xf59e0b })
        )
        head.position.copy(a)
        content.add(head)
        for (const m of wm.markers) {
          const t = m.md / wm.depth
          const p = a.clone().lerp(b, t)
          const dot = new THREE.Mesh(
            new THREE.SphereGeometry(Math.max(zRange * 0.008, scene.side * 0.0025), 12, 10),
            new THREE.MeshStandardMaterial({
              color: new THREE.Color(m.kind === 'falla' ? '#ef4444' : m.color || '#38bdf8'),
            })
          )
          dot.position.copy(p)
          content.add(dot)
        }
      }
    }

    // Trazas de perfil como planos verticales
    if (show.sections) {
      for (const s of project.sections) {
        let [a, b] = toWorldList(scene.georef, [s.a, s.b])
        // El plano del perfil se muestra sólo en el tramo que cruza el área.
        if (inFrame) {
          const seg = clipSegment(a, b, inFrame)
          if (!seg) continue
          ;[a, b] = seg
        }
        const top = dem.zmax + zRange * 0.05
        const bot = dem.zmin - (s.depth || depth)
        const geo = new THREE.BufferGeometry()
        const v = [
          P(a[0], a[1], bot),
          P(b[0], b[1], bot),
          P(b[0], b[1], top),
          P(a[0], a[1], top),
        ]
        geo.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(
            [...v[0].toArray(), ...v[1].toArray(), ...v[2].toArray(), ...v[0].toArray(), ...v[2].toArray(), ...v[3].toArray()],
            3
          )
        )
        geo.computeVertexNormals()
        content.add(
          new THREE.Mesh(
            geo,
            new THREE.MeshBasicMaterial({ color: 0x7c3aed, transparent: true, opacity: 0.16, side: THREE.DoubleSide })
          )
        )
        content.add(lineFrom([v[3], v[2]], 0x7c3aed, 1, 2))
      }
    }

    // Encuadre inicial: con marco definido se encuadra el área de trabajo.
    const view = inFrame ? modelExtent(scene) : bbox
    const spanX = view.maxX - view.minX
    const spanY = view.maxY - view.minY
    const radius = 0.5 * Math.hypot(spanX, spanY, zRange * vExag)
    const centerZ = ((dem.zmin + dem.zmax) / 2 - cz) * vExag
    camera.near = Math.max(1, radius / 2000)
    camera.far = radius * 60
    camera.updateProjectionMatrix()
    // La inversa de P, que hace falta para saber en qué punto del terreno cae un
    // toque sobre una superficie.
    st.toWorld = (v) => [v.x + cx, v.y + cy, v.z / (vExag || 1) + cz]
    if (!st.framed) {
      const d = (radius / Math.tan((camera.fov * Math.PI) / 360)) * 1.15
      camera.position.set(d * 0.12, -d * 0.72, centerZ + d * 0.62)
      controls.target.set(0, 0, centerZ)
      controls.update()
      st.framed = true
    }
  }, [project, scene, image, vExag, show, aerialOpacity])

  return (
    <div className="relative h-full w-full">
      <div ref={mountRef} className="h-full w-full" />
      <div className="absolute left-3 top-3 max-w-[240px] rounded-xl bg-slate-900/85 p-3 text-xs text-slate-100 shadow-lg">
        <div className="mb-2 font-semibold">Vista 3D</div>
        <label className="mb-2 block">
          Exageración vertical ×{vExag.toFixed(1)}
          <input
            type="range"
            min="0.5"
            max="5"
            step="0.1"
            value={vExag}
            onChange={(e) => setVExag(Number(e.target.value))}
            className="w-full"
          />
        </label>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {[
            ['topo', 'Topografía'],
            ['texture', 'Imagen base'],
            ['contours', 'Curvas'],
            ['traces', 'Trazas'],
            ['surfaces', 'Unidades'],
            ['faults', 'Fallas'],
            ['wells', 'Pozos'],
            ['sections', 'Perfiles'],
            ['aerial', 'Sobre el terreno'],
            ['faultTop', 'Falla hasta el techo'],
          ].map(([k, lab]) => (
            <label key={k} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={show[k]}
                onChange={(e) => setShow((s) => ({ ...s, [k]: e.target.checked }))}
              />
              {lab}
            </label>
          ))}
        </div>
        {show.aerial && (
          <label className="mt-2 block">
            Opacidad sobre el terreno {Math.round(aerialOpacity * 100)} %
            <input
              type="range"
              min="0.04"
              max="1"
              step="0.02"
              value={aerialOpacity}
              onChange={(e) => setAerialOpacity(Number(e.target.value))}
              className="w-full"
            />
            <span className="block text-[10px] leading-snug text-slate-400">
              La prolongación de cada superficie por encima del relieve: lo que ya se erosionó.
            </span>
          </label>
        )}
        <p className="mt-2 text-[11px] text-slate-400">
          Arrastra para rotar · dos dedos o rueda para acercar · clic derecho para desplazar. Toca una
          superficie para ver qué es.
        </p>
      </div>
      {picked && (
        <div className="absolute bottom-3 left-3 max-w-[260px] rounded-xl bg-slate-900/90 p-3 text-xs text-slate-100 shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold">{picked.name}</div>
              <div className="text-[11px] text-slate-400">
                {picked.kind === 'falla' || picked.kind === 'fault' ? 'Falla' : 'Contacto'}
                {picked.block != null && ` · bloque ${picked.block}`}
                {picked.eroded && ' · tramo ya erosionado'}
              </div>
            </div>
            <button
              onClick={() => setPicked(null)}
              className="rounded px-1 text-slate-400 hover:bg-white/10 hover:text-white"
            >
              ✕
            </button>
          </div>
          <div className="mt-1.5 border-t border-white/10 pt-1.5">
            {picked.att ? (
              <>
                <div className="font-mono text-[13px]">{picked.att.quadrant}</div>
                <div className="font-mono text-[11px] text-slate-400">{picked.att.dipDirNotation}</div>
              </>
            ) : (
              <div className="text-slate-400">Sin actitud resuelta aquí.</div>
            )}
            <div className="mt-1 text-[11px] text-slate-400">
              Cota en el punto tocado: {picked.z.toFixed(0)} m
            </div>
          </div>
          <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
            La actitud es la del punto tocado, no la media del rasgo: en un pliegue cada flanco mantea
            distinto.
          </p>
        </div>
      )}
      {!scene?.ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/70 text-sm text-slate-200">
          Define la escala del mapa para construir el modelo 3D.
        </div>
      )}
    </div>
  )
}

function toCanvas(img) {
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  c.getContext('2d').drawImage(img, 0, 0)
  return c
}

/**
 * Parte una polilínea en los tramos que caen dentro del marco de trabajo.
 * Sin marco devuelve la línea completa.
 */
function clipRuns(pts, inFrame) {
  if (!inFrame) return pts.length > 1 ? [pts] : []
  const runs = []
  let run = []
  for (const p of pts) {
    if (inFrame(p[0], p[1])) run.push(p)
    else {
      if (run.length > 1) runs.push(run)
      run = []
    }
  }
  if (run.length > 1) runs.push(run)
  return runs
}

function lineFrom(points, color, opacity = 1, width = 1) {
  const geo = new THREE.BufferGeometry().setFromPoints(points)
  const mat = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, linewidth: width })
  return new THREE.Line(geo, mat)
}

/** Malla de una superficie geológica, limitada al bloque que le corresponde. */
/**
 * Sombreado del relieve en un nodo del modelo de elevación: la iluminación
 * clásica de un MED, con el sol al NO y 45° de altura. Devuelve 0..1.
 */
function hillshade(dem, i, j, vExag = 1) {
  const { nx, ny, cell, z } = dem
  const i0 = Math.max(0, i - 1)
  const i1 = Math.min(nx - 1, i + 1)
  const j0 = Math.max(0, j - 1)
  const j1 = Math.min(ny - 1, j + 1)
  const dzdx = (vExag * (z[j * nx + i1] - z[j * nx + i0])) / ((i1 - i0) * cell)
  const dzdy = (vExag * (z[j1 * nx + i] - z[j0 * nx + i])) / ((j1 - j0) * cell)
  const slope = Math.atan(Math.hypot(dzdx, dzdy))
  const aspect = Math.atan2(dzdy, -dzdx)
  const az = ((360 - 315 + 90) * Math.PI) / 180
  const alt = (45 * Math.PI) / 180
  const hs = Math.cos(alt) * Math.sin(slope) * Math.cos(az - aspect) + Math.sin(alt) * Math.cos(slope)
  return Math.max(0, Math.min(1, hs))
}

/**
 * Lleva a la escena una tira de triángulos en coordenadas de terreno: los
 * módulos de geología trabajan en metros y con z hacia arriba, y aquí se
 * aplican el centrado y la exageración vertical de la vista.
 */
function toScene(tris, P) {
  const out = new Float32Array(tris.length)
  for (let i = 0; i < tris.length; i += 3) {
    const v = P(tris[i], tris[i + 1], tris[i + 2])
    out[i] = v.x
    out[i + 1] = v.y
    out[i + 2] = v.z
  }
  return out
}

/** Tramo de un segmento que queda dentro del marco, o null si no cruza. */
function clipSegment(a, b, inFrame) {
  const N = 200
  let first = -1
  let last = -1
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const x = a[0] + (b[0] - a[0]) * t
    const y = a[1] + (b[1] - a[1]) * t
    if (!inFrame(x, y)) continue
    if (first < 0) first = t
    last = t
  }
  if (first < 0 || last <= first) return null
  const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  return [at(first), at(last)]
}

function disposeGroup(group) {
  for (const child of [...group.children]) {
    group.remove(child)
    child.geometry?.dispose?.()
    if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose())
    else child.material?.dispose?.()
  }
}
