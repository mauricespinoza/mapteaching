import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { toWorldList, toImage } from '../lib/georef.js'
import { kinematicsOf } from '../lib/model.js'
import { buildWellModel } from '../lib/wells.js'

/**
 * Vista 3D: topografía reconstruida desde las curvas de nivel, trazas
 * geológicas drapeadas, superficies de contacto y falla, pozos y perfiles.
 */
export default function ThreeView({ project, scene, image }) {
  const mountRef = useRef(null)
  const stateRef = useRef(null)
  const [vExag, setVExag] = useState(1.6)
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
      for (let j = 0; j < dem.ny; j++) {
        for (let i = 0; i < dem.nx; i++) {
          const idx = j * dem.nx + i
          // PlaneGeometry recorre de arriba a abajo: fila 0 = y máximo.
          const vi = (dem.ny - 1 - j) * dem.nx + i
          const x = bbox.minX + i * dem.cell
          const y = bbox.minY + j * dem.cell
          const z = dem.z[idx]
          pos.setXYZ(vi, x - cx, y - cy, (z - cz) * vExag)
          const t = (z - dem.zmin) / zRange
          color.setHSL(0.32 - 0.28 * t, 0.42, 0.34 + 0.34 * t)
          colors[vi * 3] = color.r
          colors[vi * 3 + 1] = color.g
          colors[vi * 3 + 2] = color.b
          if (image && project.image) {
            const px = toImage(scene.georef, [x, y])
            uv.setXY(vi, px[0] / project.image.width, 1 - px[1] / project.image.height)
          }
        }
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      geo.computeVertexNormals()
      const useTex = show.texture && image && project.image
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: !useTex,
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
        const pts = c.pts.map((p) => P(p[0], p[1], c.elevation + zRange * 0.002))
        content.add(lineFrom(pts, 0xb45309, 0.85))
      }
    }

    // Trazas de contactos y fallas sobre la topografía
    if (show.traces) {
      for (const cw of scene.contactWorld) {
        const color = new THREE.Color(cw.contact.color || '#0f172a')
        for (const tr of cw.traces) {
          const pts = tr.map((p) => P(p[0], p[1], dem.elevationAt(p[0], p[1]) + zRange * 0.004))
          content.add(lineFrom(pts, color.getHex(), 1, 2))
        }
      }
      for (const fw of scene.faultWorld) {
        const color = new THREE.Color(kinematicsOf(fw.fault.kinematics).color)
        for (const tr of fw.traces) {
          const pts = tr.map((p) => P(p[0], p[1], dem.elevationAt(p[0], p[1]) + zRange * 0.006))
          content.add(lineFrom(pts, color.getHex(), 1, 3))
        }
      }
    }

    // Superficies de contacto por bloque
    if (show.surfaces) {
      for (const c of scene.contacts) {
        const byBlock = scene.contactSurfaces.get(c.id)
        if (!byBlock) continue
        const unit = scene.units.find((u) => u.id === c.upperUnitId)
        const color = new THREE.Color(unit?.color || c.color || '#38bdf8')
        for (const [blockId, surf] of byBlock) {
          if (!surf.defined) continue
          const mesh = surfaceMesh(scene, surf, blockId, P, zBottom, dem)
          if (!mesh) continue
          mesh.material = new THREE.MeshStandardMaterial({
            color,
            transparent: true,
            opacity: 0.62,
            side: THREE.DoubleSide,
            roughness: 0.8,
          })
          content.add(mesh)
        }
      }
    }

    // Planos de falla
    if (show.faults) {
      for (const fw of scene.faultWorld) {
        const surf = scene.faultSurfaces.get(fw.id)
        const att = surf?.mean
        const color = new THREE.Color(kinematicsOf(fw.fault.kinematics).color)
        for (const tr of fw.traces) {
          const geo = faultRibbon(tr, att, dem, P, zBottom)
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

    // Pozos
    if (show.wells) {
      for (const w of project.wells) {
        const wm = buildWellModel(w, scene)
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
        const [a, b] = toWorldList(scene.georef, [s.a, s.b])
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

    // Encuadre inicial
    const spanX = bbox.maxX - bbox.minX
    const spanY = bbox.maxY - bbox.minY
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

function lineFrom(points, color, opacity = 1, width = 1) {
  const geo = new THREE.BufferGeometry().setFromPoints(points)
  const mat = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, linewidth: width })
  return new THREE.Line(geo, mat)
}

/** Malla de una superficie geológica, limitada al bloque que le corresponde. */
function surfaceMesh(scene, surf, blockId, P, zMin, dem) {
  const { bbox } = scene
  const N = 46
  const dx = (bbox.maxX - bbox.minX) / N
  const dy = (bbox.maxY - bbox.minY) / N
  const verts = []
  // Sólo se dibuja la parte de la superficie que está bajo la topografía:
  // lo que quedaría por encima ya está erosionado.
  const push = (x, y) => {
    const z = surf.elevationAt(x, y)
    if (!Number.isFinite(z)) return null
    if (z > dem.elevationAt(x, y)) return null
    if (z < zMin) return null
    return P(x, y, z)
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x0 = bbox.minX + i * dx
      const y0 = bbox.minY + j * dy
      const x1 = x0 + dx
      const y1 = y0 + dy
      const inside = [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ].every((p) => scene.blocks.blockAt(p[0], p[1]) === blockId)
      if (!inside) continue
      const a = push(x0, y0)
      const b = push(x1, y0)
      const c = push(x1, y1)
      const d = push(x0, y1)
      if (!a || !b || !c || !d) continue
      verts.push(...a.toArray(), ...b.toArray(), ...c.toArray(), ...a.toArray(), ...c.toArray(), ...d.toArray())
    }
  }
  if (!verts.length) return null
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.computeVertexNormals()
  return new THREE.Mesh(geo)
}

/** Cinta que representa el plano de falla desde la traza hacia la profundidad. */
function faultRibbon(trace, att, dem, P, zBottom) {
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
    const run = k > 1e-6 ? drop / k : 0
    cols.push([P(p[0], p[1], zTop), P(p[0] + dirX * run, p[1] + dirY * run, zBottom)])
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

function disposeGroup(group) {
  for (const child of [...group.children]) {
    group.remove(child)
    child.geometry?.dispose?.()
    if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose())
    else child.material?.dispose?.()
  }
}
