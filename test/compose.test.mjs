// node --test   (no dependencies)
import assert from 'node:assert/strict';
import test from 'node:test';
import { keyframeExpr } from '../src/compose.mjs';

// ffmpeg's expression functions, so a generated expression can be evaluated here as plain JS
const clip = (a, b, c) => Math.min(Math.max(a, b), c);
const lt = (a, b) => (a < b ? 1 : 0);
const gte = (a, b) => (a >= b ? 1 : 0);
const iff = (a, b, c) => (a ? b : c);
const evalAt = (expr, on) =>
  new Function('on', 'clip', 'lt', 'gte', 'iff', `return ${expr.replaceAll('if(', 'iff(')};`)(on, clip, lt, gte, iff);

// what the camera path used to compile to: one if() per interval, each nested inside the last
const nested = (kf, get, fps) => {
  let e = String(get(kf.at(-1)));
  for (let i = kf.length - 2; i >= 0; i--) {
    const t0 = kf[i][0], t1 = kf[i + 1][0], v0 = get(kf[i]), v1 = get(kf[i + 1]);
    const p = `clip((T-${t0.toFixed(3)})/${Math.max(1e-3, t1 - t0).toFixed(3)},0,1)`;
    const body = v0 === v1 ? `${v0}` : `(${v0}+(${(v1 - v0).toFixed(4)})*${p}*${p}*(3-2*${p}))`;
    e = `if(lt(T,${t1.toFixed(3)}),${body},${e})`;
  }
  return e.replaceAll('T', `(on/${fps})`);
};

const depth = (s) => {
  let d = 0, max = 0;
  for (const ch of s) {
    if (ch === '(') max = Math.max(max, ++d);
    else if (ch === ')') d--;
  }
  return max;
};

// one zoom = four keyframes: rise, hold, hold, fall
const film = (zooms) => {
  const kf = [[0, 1, [960, 540]]];
  for (let k = 0; k < zooms; k++) {
    const s = 2 + k * 8;
    kf.push([s, 1, [960, 540]], [s + 0.5, 1.9, [300 + k, 700 - k]], [s + 5.5, 1.9, [300 + k, 700 - k]], [s + 6, 1, [960, 540]]);
  }
  kf.push([2 + zooms * 8 + 4, 1, [960, 540]]);
  return kf;
};

test('the camera path is the same function it always was, written flat', () => {
  const kf = film(5), FPS = 30;
  for (const get of [(k) => k[1], (k) => +(k[2][0] * 2).toFixed(1), (k) => +(k[2][1] * 2).toFixed(1)]) {
    const flat = keyframeExpr(kf, get, FPS), old = nested(kf, get, FPS);
    // every frame of the film, plus each keyframe boundary exactly
    const ts = [...Array(Math.ceil(kf.at(-1)[0] * FPS) + 20).keys()].concat(kf.map((k) => k[0] * FPS));
    for (const on of ts) assert.ok(Math.abs(evalAt(flat, on) - evalAt(old, on)) < 1e-9, `on=${on}`);
  }
});

test('a film with 30-odd zooms still compiles to something ffmpeg can parse', () => {
  // ffmpeg's av_expr_parse protects itself with a 100-deep recursion guard, and a tutorial written
  // to "one job per step" has this many zooms: the nested form overflowed it and the compose died
  // with "Missing ')' or too many args".
  const kf = film(33), get = (k) => k[1];
  assert.ok(depth(nested(kf, get, 30)) > 100, 'the nested form should be the thing that overflows');
  const flat = keyframeExpr(kf, get, 30);
  assert.ok(depth(flat) < 12, `flat depth ${depth(flat)}`);
  // and it is still the right function: 1 outside a zoom, the full scale in the middle of one
  assert.equal(evalAt(flat, 1 * 30), 1);
  assert.ok(Math.abs(evalAt(flat, (2 + 32 * 8 + 3) * 30) - 1.9) < 1e-9);
  assert.equal(evalAt(flat, kf.at(-1)[0] * 30 + 100), 1); // past the end, it holds
});
