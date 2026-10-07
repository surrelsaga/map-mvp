// The fog on the map: owns the set of cleared cells and draws them as a canvas over the tiles.
// Which cells clear is decided in fog.js; this file is state + drawing.
import { map } from './map.js';
import { CELL } from './config.js';
import * as fog from './fog.js';

const FOG_COLOR = 'rgba(30, 38, 52, 0.9)';
const PAD = 0.5;                                      // canvas reaches half a screen past each edge, so it still covers the map mid-pan and mid-zoom-out
const cells = new Set();
let last = null;                                      // previous accepted fix, so a walk leaves a continuous trail

export function reveal({ lat, lng }) {
  const here = { lat, lng, t: performance.now() };
  const added = fog.revealPath(cells, last, here);
  last = here;
  if (added) layer.redraw();
  return added;
}
export const isRevealed = (lat, lng) => fog.isRevealed(cells, lat, lng);
export const snapshot = () => [...cells];             // for saving
export function load(keys) { for (const k of keys) cells.add(k); layer.redraw(); }

// A soft round blob that erases fog. Overlapping blobs on neighbouring cells merge into one cleared area with a feathered edge.
// The drawn edge can extend a few metres past the logical one (isRevealed), well under one cell.
let blob = null;
function blobOfSize(size) {
  if (blob?.width !== size) {
    blob = document.createElement('canvas'); blob.width = blob.height = size;
    const g = blob.getContext('2d'), r = size / 2, grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(0.65, 'rgba(0,0,0,1)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, size, size);
  }
  return blob;
}

const FogCanvas = L.Layer.extend({
  onAdd(m) {
    this._canvas = L.DomUtil.create('canvas', this._zoomAnimated ? 'leaflet-zoom-animated' : 'leaflet-zoom-hide');   // _zoomAnimated is set by Leaflet before getEvents/onAdd
    this._canvas.style.pointerEvents = 'none';        // taps and drags go through to the map
    this._ctx = this._canvas.getContext('2d');
    m.getPane('fog').appendChild(this._canvas);
    this._reset();
  },
  onRemove() { L.DomUtil.remove(this._canvas); },
  getEvents() {
    const ev = { move: this.redraw, moveend: this._reset, resize: this._reset };
    if (this._zoomAnimated) ev.zoomanim = this._onZoomAnim;
    return ev;
  },
  redraw() {                                          // coalesce bursts of events into one draw per frame
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      if (!this._map._animatingZoom) this._reset();   // mid-zoom, the scale transform must stay; moveend redraws afterwards
    });
  },
  _reset() {                                          // canvas = visible map plus padding, redrawn at the current view
    const m = this._map, size = m.getSize(), pad = L.point(Math.round(size.x * PAD), Math.round(size.y * PAD));
    const w = size.x + 2 * pad.x, h = size.y + 2 * pad.y;
    if (this._canvas.width !== w || this._canvas.height !== h) { this._canvas.width = w; this._canvas.height = h; }
    const topLeft = m.containerPointToLayerPoint(pad.multiplyBy(-1));
    L.DomUtil.setPosition(this._canvas, topLeft);
    this._nw = m.layerPointToLatLng(topLeft);
    this._draw(w, h, pad);
  },
  _onZoomAnim(e) {                                    // scale the existing picture while Leaflet animates the zoom
    L.DomUtil.setTransform(this._canvas, this._map._latLngToNewLayerPoint(this._nw, e.zoom, e.center), this._map.getZoomScale(e.zoom));
  },
  _draw(w, h, pad) {
    const ctx = this._ctx, m = this._map, size = m.getSize();
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = FOG_COLOR;
    ctx.fillRect(0, 0, w, h);
    if (!cells.size) return;
    const sw = m.containerPointToLatLng([-pad.x, size.y + pad.y]), ne = m.containerPointToLatLng([size.x + pad.x, -pad.y]);
    const [i0, j0] = fog.cellOf(sw.lat, sw.lng).map((v) => v - 1);       // one extra cell each side: its blob can reach into view
    const [i1, j1] = fog.cellOf(ne.lat, ne.lng).map((v) => v + 1);
    const c = m.getCenter();                                              // a cell's x depends only on its column, y only on its row
    const xs = [], ys = [];
    for (let j = j0; j <= j1; j++) xs.push(m.latLngToContainerPoint([c.lat, (j + 0.5) * CELL]).x + pad.x);
    for (let i = i0; i <= i1; i++) ys.push(m.latLngToContainerPoint([(i + 0.5) * CELL, c.lng]).y + pad.y);
    const b = blobOfSize(Math.max(2, Math.ceil(2.2 * Math.max(Math.abs(xs[1] - xs[0]), Math.abs(ys[1] - ys[0])))));
    const half = b.width / 2;
    ctx.globalCompositeOperation = 'destination-out';
    // ponytail: scans every cell in the padded view (~200k lookups at the zoom-15 limit). Iterate `cells` instead if that gets slow on old phones.
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++)
      if (cells.has(fog.key(i, j))) ctx.drawImage(b, xs[j - j0] - half, ys[i - i0] - half);
  },
});
const layer = new FogCanvas().addTo(map);
