// Run with: node --test
const test = require('node:test');
const assert = require('node:assert');
const G = require('../src/geometry.js');

const grid = (rows, map = (c) => (c === '.' ? null : c)) => ({
  width: rows[0].length,
  height: rows.length,
  cells: rows.join('').split('').map(map),
});
const ink = () => '#231f20';

test('orthogonal neighbours fuse, diagonal neighbours stay separate', () => {
  const comps = G.components(grid(['XX.', '..X', '..X']));
  assert.strictEqual(comps.length, 2);
  assert.deepStrictEqual(comps.map((c) => c.cells.length).sort(), [2, 2]);
});

test('different shape keys never fuse', () => {
  assert.strictEqual(G.components(grid(['AB'])).length, 2);
});

test('single pixel is a rounded square with four convex arcs', () => {
  const [s] = G.buildShapes(grid(['X']), { cell: 40, radius: 0.18 }, ink);
  assert.strictEqual((s.d.match(/A/g) || []).length, 4);
  assert.match(s.d, /A7\.2 7\.2 0 0 1/);
});

test('inner corners stay sharp by default and round when asked', () => {
  const L = grid(['X.', 'XX']);
  const [sharp] = G.buildShapes(L, { cell: 10, radius: 0.2 }, ink);
  assert.strictEqual((sharp.d.match(/A/g) || []).length, 5);
  const [round] = G.buildShapes(L, { cell: 10, radius: 0.2, innerRadius: 0.2 }, ink);
  assert.strictEqual((round.d.match(/ 0 0 0 /g) || []).length, 1);
});

test('gap only opens between different touching shapes', () => {
  const [a, b] = G.buildShapes(grid(['AB']), { cell: 10, radius: 0, gap: 0.2 }, ink);
  assert.match(a.d, /L9 0/);  // right edge pulled in by gap/2
  assert.match(b.d, /M11 0/); // left edge pulled in by gap/2
});

test('rings keep their hole', () => {
  const [s] = G.buildShapes(grid(['XXX', 'X.X', 'XXX']), { cell: 10, radius: 0 }, ink);
  assert.strictEqual((s.d.match(/Z/g) || []).length, 2);
});

test('toSVG crops to content', () => {
  const svg = G.toSVG(grid(['...', '.X.', '...']), { cell: 40 }, ink, { crop: true });
  assert.match(svg, /viewBox="40 40 40 40"/);
  assert.match(svg, /fill="#231f20"/);
});
