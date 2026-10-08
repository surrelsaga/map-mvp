// The fog on the map: owns the set of cleared cells and draws them as a canvas over the tiles.
// Which cells clear is decided in fog.ts; this file is state + drawing.
import L from 'leaflet';
import { map } from './map.ts';
import { CELL, MAX_FOG_PIXELS } from './config.ts';
import { rgb } from './theme.ts';
import * as fog from './fog.ts';
import type { LatLng } from './types.ts';

const FOG_COLOR = `rgba(${rgb('--fog')}, 0.95)`;         // pre-dawn blue: dark enough to hide the streets, light enough to keep a faint sense of them
const FIRST_LIGHT = rgb('--first-light');               // the gold that means "discovered": the glow on the cleared edge
const PAD = 0.5;                                      // canvas reaches half a screen past each edge, so it still covers the map mid-pan and mid-zoom-out
const cells: fog.Cells = new Set();
let last: fog.Timed | null = null;                                      // previous accepted fix, so a walk leaves a continuous trail

export function reveal({ lat, lng }: LatLng) {
  const here = { lat, lng, t: performance.now() };
  const added = fog.revealPath(cells, last, here);
  last = here;
  if (added) layer.redraw();
  return added;
}
export const isRevealed = (lat: number, lng: number) => fog.isRevealed(cells, lat, lng);
export const snapshot = () => [...cells];             // for saving
export function countIn(area: fog.Cells) {            // how many cleared cells fall inside `area` (for % explored)
  let n = 0;
  for (const k of cells) if (area.has(k)) n++;
  return n;
}
export function load(keys: unknown) {                // untrusted: saved data can be missing, old or corrupted
  if (!Array.isArray(keys)) return;
  for (const k of keys) if (Number.isSafeInteger(k)) cells.add(k);
  layer.redraw();
}

// Two soft round sprites drawn once per cleared cell. Overlapping sprites on neighbouring cells merge into one smooth shape.
// - the blob erases fog, with a feathered edge (it reaches about 1 cell, ~11 m, past the logical edge that isRevealed uses);
// - the glow tints the fog gold just outside it, so the cleared area has a warm rim.
const sprites = new Map<string, HTMLCanvasElement>();
function sprite(kind: 'blob' | 'glow', size: number) {
  const key = `${kind}${size}`;
  let c = sprites.get(key);
  if (!c) {
    if (sprites.size > 12) sprites.clear();           // zoom changes make new sizes; don't keep them all
    c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d')!, r = size / 2, grad = g.createRadialGradient(r, r, 0, r, r, r);
    const stops = kind === 'blob'
      ? [[0, 1], [0.55, 1], [0.72, 0.7], [0.86, 0.3], [1, 0]].map(([at, a]) => [at, `rgba(0,0,0,${a})`] as const)
      : [[0, 0.36], [0.4, 0.24], [0.7, 0.09], [1, 0]].map(([at, a]) => [at, `rgba(${FIRST_LIGHT},${a})`] as const);
    for (const [at, color] of stops) grad.addColorStop(at, color);
    g.fillStyle = grad; g.fillRect(0, 0, size, size);
    sprites.set(key, c);
  }
  return c;
}

// Leaflet members the typings don't declare (stable across 1.9.x; Leaflet is pinned).
interface LeafletInternals { _animatingZoom: boolean; _latLngToNewLayerPoint(ll: L.LatLng, zoom: number, center: L.LatLng): L.Point }

class FogCanvas extends L.Layer {
  declare _map: L.Map & LeafletInternals;            // `declare`: typing only, so Leaflet's own assignments aren't overwritten
  declare _zoomAnimated: boolean;                     // set by Leaflet before getEvents/onAdd
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private nw!: L.LatLng;                              // geographic top-left of the canvas, used to place it during a zoom animation
  private raf = 0;
  private at: number[] = [];                         // reused every frame, so drawing allocates nothing
  private edge: number[] = [];
  private pad = L.point(0, 0);                      // how far the canvas reaches past each screen edge, in CSS pixels
  private zoom = 0;                                 // the zoom the canvas was last drawn at
  private scale = 1;                                // canvas pixels per CSS pixel (screen density, capped by MAX_FOG_PIXELS)

  onAdd(m: L.Map) {
    this.canvas = L.DomUtil.create('canvas', this._zoomAnimated ? 'leaflet-zoom-animated' : 'leaflet-zoom-hide');
    this.canvas.style.pointerEvents = 'none';         // taps and drags go through to the map
    this.ctx = this.canvas.getContext('2d')!;
    m.getPane('fog')!.appendChild(this.canvas);
    this.reset();
    return this;
  }
  onRemove() { L.DomUtil.remove(this.canvas); return this; }
  getEvents() {
    const ev: Record<string, L.LeafletEventHandlerFn> = { move: this.onMove, moveend: this.reset, resize: this.reset };
    if (this._zoomAnimated) ev.zoomanim = this.onZoomAnim as L.LeafletEventHandlerFn;
    return ev;
  }
  // The canvas travels with the map pane, so panning needs no redraw until the view gets near the edge of the padded canvas.
  // A change of zoom (a pinch fires `move` every frame, at fractional zooms) always redraws: the picture is only right at the zoom it was drawn at.
  private onMove() {
    const m = this._map, o = m.latLngToContainerPoint(this.nw), pad = this.pad;   // where the canvas's top-left sits on screen; at rest it is at (-pad.x, -pad.y)
    if (m.getZoom() !== this.zoom || Math.max(Math.abs(o.x + pad.x) / pad.x, Math.abs(o.y + pad.y) / pad.y) > 0.6) this.redraw();
  }
  redraw() {                                          // coalesce bursts of events into one draw per frame
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (!this._map._animatingZoom) this.reset();    // mid-zoom, the scale transform must stay; moveend redraws afterwards
    });
  }
  private reset() {                                   // canvas = visible map plus padding, redrawn at the current view
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }   // a queued redraw would just repeat this one
    this.zoom = this._map.getZoom();
    const m = this._map, size = m.getSize(), pad = L.point(Math.round(size.x * PAD), Math.round(size.y * PAD));
    const w = size.x + 2 * pad.x, h = size.y + 2 * pad.y;
    this.pad = pad;
    this.scale = Math.max(0.25, Math.min(devicePixelRatio || 1, Math.sqrt(MAX_FOG_PIXELS / (w * h))));   // crisp on 2x/3x phones, softer on huge windows, always within the pixel budget
    const pw = Math.round(w * this.scale), ph = Math.round(h * this.scale);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw; this.canvas.height = ph;
      this.canvas.style.width = `${w}px`; this.canvas.style.height = `${h}px`;
    }
    this.ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);   // everything below is drawn in CSS pixels
    const topLeft = m.containerPointToLayerPoint(pad.multiplyBy(-1));
    L.DomUtil.setPosition(this.canvas, topLeft);
    this.nw = m.layerPointToLatLng(topLeft);
    this.draw(w, h, pad);
  }
  private onZoomAnim(e: L.ZoomAnimEvent) {            // scale the existing picture while Leaflet animates the zoom
    L.DomUtil.setTransform(this.canvas, this._map._latLngToNewLayerPoint(this.nw, e.zoom, e.center), this._map.getZoomScale(e.zoom));
  }
  private draw(w: number, h: number, pad: L.Point) {
    const ctx = this.ctx, m = this._map, size = m.getSize();
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = FOG_COLOR;
    ctx.fillRect(0, 0, w, h);
    if (!cells.size) return;
    const sw = m.containerPointToLatLng([-pad.x, size.y + pad.y]), ne = m.containerPointToLatLng([size.x + pad.x, -pad.y]);
    const [i0, j0] = fog.cellOf(sw.lat, sw.lng).map((v) => v - 1);       // one extra cell each side: its blob can reach into view
    const [i1, j1] = fog.cellOf(ne.lat, ne.lng).map((v) => v + 1);
    const c = m.getCenter();                                              // a cell's x depends only on its column, y only on its row
    const xs: number[] = [], ys: number[] = [];
    for (let j = j0; j <= j1; j++) xs.push(m.latLngToContainerPoint([c.lat, (j + 0.5) * CELL]).x + pad.x);
    for (let i = i0; i <= i1; i++) ys.push(m.latLngToContainerPoint([(i + 0.5) * CELL, c.lng]).y + pad.y);
    const cellPx = Math.max(Math.abs(xs[1] - xs[0]), Math.abs(ys[1] - ys[0]));
    const blob = sprite('blob', Math.max(2, Math.ceil(2.5 * cellPx))), glow = sprite('glow', Math.max(2, Math.ceil(5.5 * cellPx)));
    const hb = blob.width / 2, hg = glow.width / 2;
    const at = this.at, edge = this.edge;                                 // screen positions of the cleared cells in view, and of those on the boundary
    at.length = edge.length = 0;
    // ponytail: scans every cell in the padded view (~200k lookups at the zoom-15 limit). Iterate `cells` instead if that gets slow on old phones.
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      if (!cells.has(fog.key(i, j))) continue;
      at.push(xs[j - j0], ys[i - i0]);
      if (!(cells.has(fog.key(i + 1, j)) && cells.has(fog.key(i - 1, j)) && cells.has(fog.key(i, j + 1)) && cells.has(fog.key(i, j - 1)))) edge.push(xs[j - j0], ys[i - i0]);
    }
    ctx.globalCompositeOperation = 'source-atop';                         // gold, but only onto fog that is still there (only the boundary cells can reach it) ...
    for (let k = 0; k < edge.length; k += 2) ctx.drawImage(glow, edge[k] - hg, edge[k + 1] - hg);
    ctx.globalCompositeOperation = 'destination-out';                     // ... then clear the cells, which leaves the glow as a rim just outside them
    for (let k = 0; k < at.length; k += 2) ctx.drawImage(blob, at[k] - hb, at[k + 1] - hb);
    ctx.globalCompositeOperation = 'source-over';
  }
}
const layer = new FogCanvas().addTo(map);
