/*
 * Pixel grid -> vector geometry.
 *
 * The Blissfest tile patterns are built from grid "pixels" where orthogonally
 * touching cells of the same shape fuse into one solid piece. Outer (convex)
 * corners are rounded, inner (concave) corners stay crisp, and pieces that only
 * touch diagonally stay separate. This module turns a grid of shape ids into
 * SVG path data with exactly that treatment.
 *
 * Works in the browser (window.PixelGeometry) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PixelGeometry = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * @param {object} grid  { width, height, cells } where cells[y*width+x] is a
   *                       shape key (string) or null for empty.
   * @returns {Array<{key:string, cells:number[]}>} 4-connected components that
   *          share the same key.
   */
  function components(grid) {
    const { width, height, cells } = grid;
    const seen = new Uint8Array(width * height);
    const out = [];
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] == null || seen[i]) continue;
      const key = cells[i];
      const stack = [i];
      const list = [];
      seen[i] = 1;
      while (stack.length) {
        const c = stack.pop();
        list.push(c);
        const x = c % width;
        const y = (c - x) / width;
        const nbs = [];
        if (x > 0) nbs.push(c - 1);
        if (x < width - 1) nbs.push(c + 1);
        if (y > 0) nbs.push(c - width);
        if (y < height - 1) nbs.push(c + width);
        for (const n of nbs) {
          if (!seen[n] && cells[n] === key) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
      out.push({ key, cells: list });
    }
    return out;
  }

  /**
   * Trace the boundary loops of one component. Edges run with the filled side
   * on their right (screen coords, y down), so outer loops are clockwise and
   * holes counter-clockwise. Each edge carries `seam`: true when the cell on
   * the other side is filled by a *different* shape.
   */
  function traceLoops(grid, comp) {
    const { width, height, cells } = grid;
    const inComp = new Set(comp.cells);
    const filled = (x, y) =>
      x >= 0 && y >= 0 && x < width && y < height && cells[y * width + x] != null;
    const edges = [];
    for (const c of comp.cells) {
      const x = c % width;
      const y = (c - x) / width;
      const side = (nx, ny) => {
        const inside = nx >= 0 && ny >= 0 && nx < width && ny < height && inComp.has(ny * width + nx);
        return inside ? null : { seam: filled(nx, ny) };
      };
      let s;
      if ((s = side(x, y - 1))) edges.push({ ax: x, ay: y, bx: x + 1, by: y, seam: s.seam });
      if ((s = side(x + 1, y))) edges.push({ ax: x + 1, ay: y, bx: x + 1, by: y + 1, seam: s.seam });
      if ((s = side(x, y + 1))) edges.push({ ax: x + 1, ay: y + 1, bx: x, by: y + 1, seam: s.seam });
      if ((s = side(x - 1, y))) edges.push({ ax: x, ay: y + 1, bx: x, by: y, seam: s.seam });
    }
    const byStart = new Map();
    for (const e of edges) {
      const k = e.ax + ',' + e.ay;
      if (!byStart.has(k)) byStart.set(k, []);
      byStart.get(k).push(e);
    }
    const used = new Set();
    const loops = [];
    for (const start of edges) {
      if (used.has(start)) continue;
      const loop = [];
      let e = start;
      while (e && !used.has(e)) {
        used.add(e);
        loop.push(e);
        const cands = (byStart.get(e.bx + ',' + e.by) || []).filter((n) => !used.has(n));
        if (cands.length <= 1) {
          e = cands[0];
        } else {
          // Pinch point (two cells of the shape touching only at a corner):
          // prefer turning right so the touching corners stay separate.
          const dx = e.bx - e.ax;
          const dy = e.by - e.ay;
          const score = (n) => {
            const cross = dx * (n.by - n.ay) - dy * (n.bx - n.ax);
            return cross > 0 ? 0 : cross === 0 ? 1 : 2;
          };
          cands.sort((a, b) => score(a) - score(b));
          e = cands[0];
        }
      }
      if (loop.length) loops.push(loop);
    }
    return loops;
  }

  /** Merge runs of collinear unit edges that share the same seam flag. */
  function mergeEdges(loop) {
    const out = [];
    for (const e of loop) {
      const dx = Math.sign(e.bx - e.ax);
      const dy = Math.sign(e.by - e.ay);
      const last = out[out.length - 1];
      if (last && last.dx === dx && last.dy === dy && last.seam === e.seam) {
        last.bx = e.bx;
        last.by = e.by;
      } else {
        out.push({ ax: e.ax, ay: e.ay, bx: e.bx, by: e.by, dx, dy, seam: e.seam });
      }
    }
    if (out.length > 1) {
      const first = out[0];
      const last = out[out.length - 1];
      if (last.dx === first.dx && last.dy === first.dy && last.seam === first.seam) {
        first.ax = last.ax;
        first.ay = last.ay;
        out.pop();
      }
    }
    return out;
  }

  /**
   * Build the offset corner points of a loop. Every edge is pushed inward by
   * `inset`, and edges facing a different shape by an extra `gap / 2` so that
   * neighbouring pieces read as separate.
   */
  function loopPoints(loop, inset, gap) {
    const segs = mergeEdges(loop);
    const pts = [];
    const n = segs.length;
    for (let i = 0; i < n; i++) {
      const a = segs[(i + n - 1) % n];
      const b = segs[i];
      const oa = inset + (a.seam ? gap / 2 : 0);
      const ob = inset + (b.seam ? gap / 2 : 0);
      // Right-hand normal points into the filled side.
      const nax = -a.dy, nay = a.dx;
      const nbx = -b.dy, nby = b.dx;
      const px = b.ax, py = b.ay;
      if (a.dx === b.dx && a.dy === b.dy) {
        // Collinear with different offsets: a small jog.
        pts.push({ x: px + nax * oa, y: py + nay * oa });
        pts.push({ x: px + nbx * ob, y: py + nby * ob });
      } else {
        pts.push({ x: px + nax * oa + nbx * ob, y: py + nay * oa + nby * ob });
      }
    }
    return dedupe(pts);
  }

  function dedupe(pts) {
    const out = [];
    for (const p of pts) {
      const l = out[out.length - 1];
      if (!l || Math.abs(l.x - p.x) > 1e-9 || Math.abs(l.y - p.y) > 1e-9) out.push(p);
    }
    while (out.length > 1) {
      const f = out[0], l = out[out.length - 1];
      if (Math.abs(l.x - f.x) < 1e-9 && Math.abs(l.y - f.y) < 1e-9) out.pop();
      else break;
    }
    // Drop collinear points.
    let changed = true;
    while (changed && out.length > 2) {
      changed = false;
      for (let i = 0; i < out.length; i++) {
        const p = out[(i + out.length - 1) % out.length];
        const c = out[i];
        const q = out[(i + 1) % out.length];
        const cross = (c.x - p.x) * (q.y - c.y) - (c.y - p.y) * (q.x - c.x);
        if (Math.abs(cross) < 1e-12) {
          out.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    return out;
  }

  const fmt = (v) => {
    const r = Math.round(v * 1000) / 1000;
    return Object.is(r, -0) ? '0' : String(r);
  };

  /** Path data for one closed loop of points, rounding its corners. */
  function roundedLoopPath(pts, scale, rOuter, rInner) {
    const n = pts.length;
    if (n < 3) return '';
    let d = '';
    for (let i = 0; i < n; i++) {
      const p = pts[(i + n - 1) % n];
      const c = pts[i];
      const q = pts[(i + 1) % n];
      const inX = c.x - p.x, inY = c.y - p.y;
      const outX = q.x - c.x, outY = q.y - c.y;
      const lenIn = Math.hypot(inX, inY);
      const lenOut = Math.hypot(outX, outY);
      const cross = inX * outY - inY * outX;
      const convex = cross > 0;
      let r = Math.min(convex ? rOuter : rInner, lenIn / 2, lenOut / 2);
      if (r < 1e-6) r = 0;
      const sx = c.x - (inX / lenIn) * r, sy = c.y - (inY / lenIn) * r;
      const ex = c.x + (outX / lenOut) * r, ey = c.y + (outY / lenOut) * r;
      d += (i === 0 ? 'M' : 'L') + fmt(sx * scale) + ' ' + fmt(sy * scale);
      if (r > 0) {
        const rr = fmt(r * scale);
        d += 'A' + rr + ' ' + rr + ' 0 0 ' + (convex ? 1 : 0) + ' ' + fmt(ex * scale) + ' ' + fmt(ey * scale);
      }
    }
    return d + 'Z';
  }

  /**
   * @param {object} grid   { width, height, cells }
   * @param {object} style  { cell, radius, innerRadius, inset, gap } where
   *                        radius/innerRadius/inset/gap are fractions of a cell.
   * @param {function} colorOf  maps a shape key to its fill colour.
   * @returns {Array<{key, color, d, cells}>}
   */
  function buildShapes(grid, style, colorOf) {
    const s = Object.assign({ cell: 40, radius: 0.18, innerRadius: 0, inset: 0, gap: 0.1 }, style);
    return components(grid).map((comp) => {
      const loops = traceLoops(grid, comp);
      const d = loops
        .map((loop) => roundedLoopPath(loopPoints(loop, s.inset, s.gap), s.cell, s.radius, s.innerRadius))
        .join('');
      return { key: comp.key, color: colorOf(comp.key), d, cells: comp.cells };
    });
  }

  /** Bounding box of filled cells, or null when the grid is empty. */
  function contentBounds(grid) {
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    grid.cells.forEach((k, i) => {
      if (k == null) return;
      const x = i % grid.width, y = (i - x) / grid.width;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    });
    return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  /**
   * Full SVG document.
   * opts: { crop: boolean, padding: cells, background: colour|null, title }
   */
  function toSVG(grid, style, colorOf, opts) {
    const o = Object.assign({ crop: false, padding: 0, background: null, title: 'Blissfest pixel asset' }, opts);
    const cell = (style && style.cell) || 40;
    const shapes = buildShapes(grid, style, colorOf);
    let box = { x: 0, y: 0, w: grid.width, h: grid.height };
    if (o.crop) {
      const b = contentBounds(grid);
      if (b) box = { x: b.x - o.padding, y: b.y - o.padding, w: b.w + 2 * o.padding, h: b.h + 2 * o.padding };
    }
    const vb = [box.x * cell, box.y * cell, box.w * cell, box.h * cell].map(fmt);
    // One path per colour keeps the file small and easy to recolour.
    const byColor = new Map();
    for (const sh of shapes) {
      if (!sh.d) continue;
      byColor.set(sh.color, (byColor.get(sh.color) || '') + sh.d);
    }
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    let svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + vb[2] + '" height="' + vb[3] +
      '" viewBox="' + vb.join(' ') + '">\n';
    svg += '  <title>' + esc(o.title) + '</title>\n';
    if (o.background) {
      svg += '  <rect x="' + vb[0] + '" y="' + vb[1] + '" width="' + vb[2] + '" height="' + vb[3] + '" fill="' + esc(o.background) + '"/>\n';
    }
    for (const [color, d] of byColor) {
      svg += '  <path fill="' + esc(color) + '" d="' + d + '"/>\n';
    }
    return svg + '</svg>\n';
  }

  return { components, traceLoops, buildShapes, contentBounds, toSVG };
});
