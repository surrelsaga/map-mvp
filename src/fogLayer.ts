// The fog on the map: owns the set of cleared cells and draws them as a canvas over the tiles.
// Which cells clear is decided in fog.ts; this file is state + drawing.
import L from 'leaflet';
import { map } from './map.ts';
import { CELL } from './config.ts';
import * as fog from './fog.ts';
import type { LatLng } from './types.ts';

const FOG_COLOR = 'rgba(30, 38, 52, 0.9)';
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

// A soft round blob that erases fog. Overlapping blobs on neighbouring cells merge into one cleared area with a feathered edge.
// The drawn edge can extend a few metres past the logical one (isRevealed), well under one cell.
let blob: HTMLCanvasElement | null = null;
function blobOfSize(size: number) {
  if (blob?.width !== size) {
    blob = document.createElement('canvas'); blob.width = blob.height = size;
    const g = blob.getContext('2d')!, r = size / 2, grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(0.65, 'rgba(0,0,0,1)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, size, size);
  }
  return blob;
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
    const ev: Record<string, L.LeafletEventHandlerFn> = { move: this.redraw, moveend: this.reset, resize: this.reset };
    if (this._zoomAnimated) ev.zoomanim = this.onZoomAnim as L.LeafletEventHandlerFn;
    return ev;
  }
  redraw() {                                          // coalesce bursts of events into one draw per frame
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (!this._map._animatingZoom) this.reset();    // mid-zoom, the scale transform must stay; moveend redraws afterwards
    });
  }
  private reset() {                                   // canvas = visible map plus padding, redrawn at the current view
    const m = this._map, size = m.getSize(), pad = L.point(Math.round(size.x * PAD), Math.round(size.y * PAD));
    const w = size.x + 2 * pad.x, h = size.y + 2 * pad.y;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
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
    const b = blobOfSize(Math.max(2, Math.ceil(2.2 * Math.max(Math.abs(xs[1] - xs[0]), Math.abs(ys[1] - ys[0])))));
    const half = b.width / 2;
    ctx.globalCompositeOperation = 'destination-out';
    // ponytail: scans every cell in the padded view (~200k lookups at the zoom-15 limit). Iterate `cells` instead if that gets slow on old phones.
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++)
      if (cells.has(fog.key(i, j))) ctx.drawImage(b, xs[j - j0] - half, ys[i - i0] - half);
  }
}
const layer = new FogCanvas().addTo(map);
