import { describe, expect, test } from 'vitest';
import { evalCurve, makeKey } from './curve';

describe('evalCurve', () => {
  test('empty → fallback', () => expect(evalCurve({ keys: [] }, 5, 0.7)).toBe(0.7));
  test('single key constant', () => expect(evalCurve({ keys: [makeKey(10, 2)] }, 0, 0)).toBe(2));
  test('linear midpoint', () => expect(evalCurve({ keys: [makeKey(0,0,'linear'), makeKey(10,1)] }, 5, 0)).toBeCloseTo(0.5));
  test('hold', () => expect(evalCurve({ keys: [makeKey(0,0,'hold'), makeKey(10,1)] }, 9, 0)).toBe(0));
  test('bezier flat tangents: ends exact, mid 0.5, symmetric ease', () => {
    const c = { keys: [makeKey(0,0), makeKey(30,1)] };
    expect(evalCurve(c, 0, 0)).toBeCloseTo(0); expect(evalCurve(c, 30, 0)).toBeCloseTo(1);
    expect(evalCurve(c, 15, 0)).toBeCloseTo(0.5, 3);
    expect(evalCurve(c, 3, 0)).toBeLessThan(0.1);
  });
  test('past last key holds last', () => expect(evalCurve({ keys: [makeKey(0,0), makeKey(10,1)] }, 99, 0)).toBe(1));
  test('oversized handle clamped, no NaN', () => {
    const k0 = { ...makeKey(0,0), outTan: { df: 500, dv: 50 } };
    const v = evalCurve({ keys: [k0, makeKey(10,1)] }, 5, 0);
    expect(Number.isFinite(v)).toBe(true);
  });
});
