// Un .zip escrito a mano, sin comprimir.
//
// La exportación a GemPy no es un archivo sino un juego de archivos —dos tablas,
// el relieve, los vectores, el guion de Python— que sólo sirven juntos. Bajarlos
// de uno en uno son seis diálogos de descarga y seis ocasiones de que uno se
// quede atrás; en un .zip van juntos o no van.
//
// Se guardan sin comprimir (método «store»). Comprimir exigiría implementar
// deflate, que es la única parte pesada del formato, y no hace falta: son unos
// pocos cientos de kilobytes de texto. Lo demás son tres cabeceras bien
// documentadas y un CRC.

const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Fecha y hora en el formato MS-DOS que usa el zip (segundos de dos en dos). */
function dosStamp(d = new Date()) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/**
 * @param files [{ name, text }] o [{ name, bytes }]
 * @returns Blob listo para descargar
 */
export function zipBlob(files) {
  const enc = new TextEncoder()
  const { time, date } = dosStamp()
  const entries = files.map((f) => {
    const name = enc.encode(f.name)
    const data = f.bytes ? f.bytes : enc.encode(f.text ?? '')
    return { name, data, crc: crc32(data), offset: 0 }
  })

  // Tamaño exacto: por entrada, cabecera local (30) + nombre + datos, y entrada
  // de directorio (46) + nombre; al final, el cierre (22).
  const total =
    entries.reduce((s, e) => s + 30 + e.name.length + e.data.length + 46 + e.name.length, 0) + 22
  const buf = new Uint8Array(total)
  const view = new DataView(buf.buffer)
  let at = 0
  const u16 = (v) => {
    view.setUint16(at, v, true)
    at += 2
  }
  const u32 = (v) => {
    view.setUint32(at, v >>> 0, true)
    at += 4
  }
  const raw = (b) => {
    buf.set(b, at)
    at += b.length
  }

  for (const e of entries) {
    e.offset = at
    u32(0x04034b50)
    u16(20) // versión necesaria para extraer
    u16(0x0800) // nombres en UTF-8
    u16(0) // sin comprimir
    u16(time)
    u16(date)
    u32(e.crc)
    u32(e.data.length)
    u32(e.data.length)
    u16(e.name.length)
    u16(0) // sin campo extra
    raw(e.name)
    raw(e.data)
  }

  const dirAt = at
  for (const e of entries) {
    u32(0x02014b50)
    u16(20) // versión con la que se creó
    u16(20)
    u16(0x0800)
    u16(0)
    u16(time)
    u16(date)
    u32(e.crc)
    u32(e.data.length)
    u32(e.data.length)
    u16(e.name.length)
    u16(0) // extra
    u16(0) // comentario
    u16(0) // disco
    u16(0) // atributos internos
    u32(0) // atributos externos
    u32(e.offset)
    raw(e.name)
  }

  // El tamaño del directorio se toma **antes** de escribir el cierre: `at` va
  // avanzando con cada campo, y leerlo más abajo lo daría doce bytes más largo.
  const dirSize = at - dirAt
  u32(0x06054b50)
  u16(0) // número de disco
  u16(0) // disco donde empieza el directorio
  u16(entries.length)
  u16(entries.length)
  u32(dirSize)
  u32(dirAt)
  u16(0) // sin comentario

  return new Blob([buf], { type: 'application/zip' })
}
