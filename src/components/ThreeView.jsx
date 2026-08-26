import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { toWorldList, toImage } from '../lib/georef.js'
import { kinematicsOf } from '../lib/model.js'
import { frameTest, modelExtent } from '../lib/models.js'
import { buildWellModel } from '../lib/wells.js'

/**
 * Vista 3D: topografía reconstruida desde las curvas de nivel, trazas
 * geológicas drapeadas, superficies de contacto y falla, pozos y perfiles.
 */
export default function ThreeView({ project, scene, image }) {
  const mountRef = useRef(null)
  const stateRef = useRef(null)
  const [vExag, setVExag] = useState(1)
  const [show, setShow] = useState({
    topo: true,
    contours: true,
    traces: true,
    surfaces: true,
    faults: true,
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

    // Superficies de contacto por bloque
    if (show.surfaces) {
      for (const { contactIndex: ci, verts } of contactMeshes(scene, P, zBottom, dem, inFrame)) {
        const c = scene.contacts[ci]
        const unit = scene.units.find((u) => u.id === c.upperUnitId)
        const color = new THREE.Color(unit?.color || c.color || '#38bdf8')
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
        geo.computeVertexNormals()
        content.add(
          new THREE.Mesh(
            geo,
            new THREE.MeshStandardMaterial({
              color,
              transparent: true,
              opacity: 0.62,
              side: THREE.DoubleSide,
              roughness: 0.8,
            })
          )
        )
      }
    }

    // Planos de falla
    if (show.faults) {
      for (const fw of scene.faultWorld) {
        const surf = scene.faultSurfaces.get(fw.id)
        const att = surf?.mean
        const color = new THREE.Color(kinematicsOf(fw.fault.kinematics).color)
        for (const tr of fw.traces) {
          for (const run of clipRuns(tr, inFrame)) {
            const geo = faultRibbon(run, att, dem, P, zBottom, inFrame)
            if (!geo) continue
            content.add(
              new THREE.Mesh(
                geo,
                new THREE.MeshStandardMaterial({
                  color,
                  transparent: true,
                  opacity: 0.5,
                  side: THREE.DoubleSide,
                  roughness: 0.6,
                })
              )
            )
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
    if (!st.framed) {
      const d = (radius / Math.tan((camera.fov * Math.PI) / 360)) * 1.15
      camera.position.set(d * 0.12, -d * 0.72, centerZ + d * 0.62)
      controls.target.set(0, 0, centerZ)
      controls.update()
      st.framed = true
    }
  }, [project, scene, image, vExag, show])

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
        <p className="mt-2 text-[11px] text-slate-400">
          Arrastra para rotar · dos dedos o rueda para acercar · clic derecho para desplazar.
        </p>
      </div>
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
 * Superficies de contacto en 3D, todas de una pasada.
 *
 * Se recorre la malla una sola vez y en cada nodo se pide la **pila
 * estratigráfica completa** (scene.stackAt), no cada contacto por su cuenta:
 * así ninguna superficie acaba por debajo de la que tiene debajo —cada contacto
 * se ajusta a sus propios datos y, lejos de ellos, se cruzaban— y además sale
 * más barato, porque la pila se calcula una vez para todos.
 *
 * Una celda que cruza una falla no se dibuja: cada bloque es un cuerpo aparte y
 * las unidades tienen que detenerse en la estructura, no atravesarla.
 */
function contactMeshes(scene, P, zMin, dem, inFrame) {
  const { bbox } = scene
  // Malla fina: el borde de la superficie se recorta contra la topografía, y
  // con pocas celdas ese recorte se ve escalonado.
  const N = 110
  const dx = (bbox.maxX - bbox.minX) / N
  const dy = (bbox.maxY - bbox.minY) / N
  const nc = scene.contacts.length
  const nn = (N + 1) * (N + 1)

  // Rejilla común: coordenadas, topografía y —lo que decide el corte— la cota
  // del plano de cada falla en cada nodo. Se calcula una sola vez porque cada
  // superficie de contacto se prueba contra ella muchas veces.
  const gx = new Float64Array(nn)
  const gy = new Float64Array(nn)
  const gz = new Float64Array(nn).fill(NaN)
  const cuts = scene.faultCuts || []
  const zf = cuts.map(() => new Float64Array(nn).fill(NaN))
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const k = j * (N + 1) + i
      const x = bbox.minX + i * dx
      const y = bbox.minY + j * dy
      gx[k] = x
      gy[k] = y
      if (inFrame && !inFrame(x, y)) continue
      gz[k] = dem.elevationAt(x, y)
      for (let c = 0; c < cuts.length; c++) zf[c][k] = cuts[c].surf.elevationAt(x, y)
    }
  }

  // Bloques que tienen alguna superficie resuelta.
  const blockIds = new Set()
  for (const byBlock of scene.contactSurfaces.values()) for (const b of byBlock.keys()) blockIds.add(b)

  const byKey = new Map()
  for (const block of blockIds) {
    // De qué lado de cada falla vive este bloque. Un 0 quiere decir que esa
    // falla no lo limita (se acaba dentro de él) y entonces no lo corta.
    const want = cuts.map((c) => scene.blockSideOf(block, c.id))
    /**
     * ¿Le toca a este bloque el punto (nodo k, cota z)? El criterio es de qué
     * lado del *plano* de falla queda, no de qué lado de su traza: así el
     * bloque de abajo se mete por debajo de la falla y el de arriba se retira,
     * en vez de cortarse los dos a plomo bajo la traza.
     */
    const mine = (k, z) => {
      for (let c = 0; c < cuts.length; c++) {
        if (!want[c]) continue
        const v = zf[c][k]
        if (!Number.isFinite(v)) continue
        if ((z > v ? 1 : -1) !== want[c]) return false
      }
      return true
    }

    // Pila de este bloque en cada nodo, extrapolada más allá de su extensión en
    // planta: es lo que ocupa el hueco que la falla inclinada deja debajo.
    const stacks = new Array(nn)
    for (let k = 0; k < nn; k++) {
      if (!Number.isFinite(gz[k])) continue
      stacks[k] = scene.stackAt(gx[k], gy[k], block).z.slice()
    }

    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const ka = j * (N + 1) + i
        const kb = ka + 1
        const kc = (j + 1) * (N + 1) + i + 1
        const kd = (j + 1) * (N + 1) + i
        const sa = stacks[ka]
        const sb = stacks[kb]
        const sc = stacks[kc]
        const sd = stacks[kd]
        if (!sa || !sb || !sc || !sd) continue
        for (let ci = 0; ci < nc; ci++) {
          const za = sa[ci]
          const zb = sb[ci]
          const zc = sc[ci]
          const zd = sd[ci]
          if (za == null || zb == null || zc == null || zd == null) continue
          // Sólo la parte que queda bajo la topografía: lo de arriba ya está
          // erosionado.
          if (za > gz[ka] || zb > gz[kb] || zc > gz[kc] || zd > gz[kd]) continue
          // Y sólo la que queda del lado de la falla que le toca a este bloque.
          if (!mine(ka, za) || !mine(kb, zb) || !mine(kc, zc) || !mine(kd, zd)) continue
          const key = `${ci}|${block}`
          let verts = byKey.get(key)
          if (!verts) byKey.set(key, (verts = { contactIndex: ci, verts: [] }))
          const pa = P(gx[ka], gy[ka], Math.max(zMin, za))
          const pb = P(gx[kb], gy[kb], Math.max(zMin, zb))
          const pc = P(gx[kc], gy[kc], Math.max(zMin, zc))
          const pd = P(gx[kd], gy[kd], Math.max(zMin, zd))
          verts.verts.push(
            ...pa.toArray(), ...pb.toArray(), ...pc.toArray(),
            ...pa.toArray(), ...pc.toArray(), ...pd.toArray()
          )
        }
      }
    }
  }
  return [...byKey.values()].filter((v) => v.verts.length)
}

/** Cinta que representa el plano de falla desde la traza hacia la profundidad. */
function faultRibbon(trace, att, dem, P, zBottom, inFrame) {
  if (trace.length < 2) return null
  const RAD = Math.PI / 180
  const dip = att ? att.dip : 90
  const dipDir = att ? att.dipDir : 0
  const k = Math.tan(Math.min(89, dip) * RAD)
  const dirX = Math.sin(dipDir * RAD)
  const dirY = Math.cos(dipDir * RAD)
  const verts = []
  const step = Math.max(1, Math.floor(trace.length / 60))
  const cols = []
  for (let i = 0; i < trace.length; i += step) {
    const p = trace[i]
    const zTop = dem.elevationAt(p[0], p[1])
    const drop = zTop - zBottom
    let run = k > 1e-6 ? drop / k : 0
    // Con marco definido el plano no puede asomar por el costado: se acorta la
    // proyección buzamiento abajo hasta donde deja de estar dentro del área.
    if (inFrame && run > 0) run = clipRun(p, dirX, dirY, run, inFrame)
    const zEnd = k > 1e-6 ? zTop - run * k : zBottom
    cols.push([P(p[0], p[1], zTop), P(p[0] + dirX * run, p[1] + dirY * run, zEnd)])
  }
  for (let i = 1; i < cols.length; i++) {
    const [a0, a1] = cols[i - 1]
    const [b0, b1] = cols[i]
    verts.push(...a0.toArray(), ...b0.toArray(), ...b1.toArray(), ...a0.toArray(), ...b1.toArray(), ...a1.toArray())
  }
  if (!verts.length) return null
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.computeVertexNormals()
  return geo
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

/** Mayor avance buzamiento abajo que sigue dentro del marco de trabajo. */
function clipRun(p, dirX, dirY, run, inFrame) {
  if (inFrame(p[0] + dirX * run, p[1] + dirY * run)) return run
  let lo = 0
  let hi = run
  for (let it = 0; it < 22; it++) {
    const mid = (lo + hi) / 2
    if (inFrame(p[0] + dirX * mid, p[1] + dirY * mid)) lo = mid
    else hi = mid
  }
  return lo
}

function disposeGroup(group) {
  for (const child of [...group.children]) {
    group.remove(child)
    child.geometry?.dispose?.()
    if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose())
    else child.material?.dispose?.()
  }
}
