# Blissfest Assets

Asset tools for Blissfest.

## Pixel tile generator

Open `index.html` in a browser (no build step), or run `npm start` to serve the folder.

Draw on a pixel grid and export an SVG that matches the **Tile patterns** sheet in the Blissfest Figma file:

- Ink colour `#231F20`, 6×6 grid by default, 40 px per pixel on export.
- Pixels that touch side by side fuse into one solid shape. Outer corners are rounded (18% of a pixel), inner corners stay crisp.
- Pixels that touch only at a corner stay separate pieces.

### Tools

| Tool | Key | What it does |
| --- | --- | --- |
| Draw | `B` | Touching pixels of the same colour fuse into one shape. |
| Piece | `P` | Each stroke is its own shape, separated from neighbours by the gap. Start a stroke on a piece to grow it. |
| Erase | `E` | Removes pixels. Right-click or Alt-drag erases with any tool. |

Mirror left/right and top/bottom for symmetric tiles. Undo/redo with `Ctrl/⌘ Z` and `Ctrl/⌘ Shift Z`.

### Style controls

Corner radius, inner corner radius, gap between pieces and inset are all set as a fraction of one pixel, so the look stays the same at any export size. **Reset to Blissfest style** restores the defaults.

### Export

- **Download SVG**: one `<path>` per colour, ready for Figma or Illustrator.
- **Copy SVG**: paste straight onto the Figma canvas.
- **PNG**: 2× raster of the same SVG.
- **Save grid / Open grid**: keep an editable JSON of the drawing. Your current drawing is also kept in the browser between visits.

### Code

- `src/geometry.js`: turns the grid into rounded vector outlines (works in the browser and Node).
- `src/app.js`: the editor.
- `test/`: geometry tests, run with `npm test`.
