import { expect, test } from 'vitest'
import * as THREE from 'three'
import { makeStage } from './stageFloor'

test('makeStage: floor width×depth centred on origin, audience strip on +X', () => {
  const g = makeStage(8, 5, { floor: '#2B3038', line: '#3B424D', edge: '#8d96a3', front: '#F0A43A' })
  const box = new THREE.Box3().setFromObject(g.getObjectByName('floor')!)
  expect(box.min.x).toBeCloseTo(-2.5); expect(box.max.x).toBeCloseTo(2.5)
  expect(box.min.y).toBeCloseTo(-4); expect(box.max.y).toBeCloseTo(4)
  const f = new THREE.Box3().setFromObject(g.getObjectByName('front')!)
  expect(f.min.x).toBeGreaterThanOrEqual(2.5)
  expect(f.max.y - f.min.y).toBeCloseTo(8)
})
