// Exportación a GemPy, sobre los ejercicios de ejemplo: lo que GemPy 3 no
// perdona. Se corre con `npm test` (node --test, sin dependencias).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildScene } from '../src/lib/scene.js'
import { buildGempyBundle, demGrid } from '../src/lib/gempy.js'

const EJEMPLOS = ['falla-normal-serie-inclinada', 'fold-fault-unconformity', 'dike-pinch-out']

function bundle(id) {
  const url = new URL(`../public/examples/${id}.mapteaching.json`, import.meta.url)
  const project = JSON.parse(fs.readFileSync(url, 'utf8'))
  const files = buildGempyBundle(project, buildScene(project))
  return Object.fromEntries(files.map((f) => [f.name, f.text]))
}

const header = (csv) => csv.split('\n')[0].split(',')

for (const id of EJEMPLOS) {
  const files = bundle(id)
  const model = JSON.parse(files['model.json'])

  test(`${id}: dem.asc sin NODATA y justo sobre el extent`, () => {
    const lines = files['dem.asc'].trim().split('\n')
    const cab = Object.fromEntries(lines.slice(0, 6).map((l) => l.split(/\s+/)).map(([k, v]) => [k.toLowerCase(), Number(v)]))
    const [xmin, xmax, ymin, ymax] = model.extent
    assert.equal(cab.xllcorner, xmin)
    assert.equal(cab.yllcorner, ymin)
    assert.ok(Math.abs(cab.xllcorner + cab.ncols * cab.cellsize - xmax) < 0.01)
    assert.ok(Math.abs(cab.yllcorner + cab.nrows * cab.cellsize - ymax) < cab.cellsize / 2)
    const rows = lines.slice(6)
    assert.equal(rows.length, cab.nrows)
    for (const r of rows) {
      const vals = r.split(' ').map(Number)
      assert.equal(vals.length, cab.ncols)
      assert.ok(vals.every((v) => Number.isFinite(v) && v !== cab.nodata_value))
    }
  })

  test(`${id}: CSV con una sola columna de nombre`, () => {
    assert.deepEqual(header(files['surface_points.csv']), ['X', 'Y', 'Z', 'formation'])
    assert.deepEqual(header(files['orientations.csv']), ['X', 'Y', 'Z', 'azimuth', 'dip', 'polarity', 'formation', 'origen'])
  })

  test(`${id}: nombres de GemPy coherentes entre CSV y model.json`, () => {
    const enCsv = new Set(files['surface_points.csv'].trim().split('\n').slice(1).map((l) => l.split(',')[3]))
    const elementos = model.superficies.map((s) => s.elemento_gempy)
    assert.equal(new Set(elementos).size, elementos.length)
    assert.ok(!elementos.includes('basement'))
    assert.deepEqual(new Set(elementos), enCsv)
    assert.deepEqual(new Set(model.series.flatMap((s) => s.superficies)), enCsv)
    assert.equal(model.version_formato, 2)
    assert.ok(model.basamento?.unidad)
  })
}

test('falla-normal-serie-inclinada: superficies con nombre de unidad', () => {
  const model = JSON.parse(bundle('falla-normal-serie-inclinada')['model.json'])
  const estrat = model.series.find((s) => !s.es_falla)
  assert.deepEqual(estrat.superficies, ['Unidad 7', 'Unidad 6', 'Unidad 5', 'Unidad 4', 'Unidad 3', 'Unidad 2'])
  assert.equal(model.basamento.unidad, 'Unidad 1')
})

test('demGrid cierra el ancho exacto', () => {
  const g = demGrid(1613, 1098, 6.77)
  assert.ok(Math.abs(g.ncols * g.cell - 1613) < 1e-9)
  assert.ok(Math.abs(g.nrows * g.cell - 1098) < g.cell / 2)
})
