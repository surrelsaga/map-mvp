// The Leaflet map and its OSM tiles. Other modules import `map` and add layers to it.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { SUTD, START_ZOOM, MIN_ZOOM, MAX_ZOOM, TILE_URL } from './config.ts';

// With reduced motion on, the map itself stops animating too (zoom, fades, and the pan that follows you), not just our own flourishes.
export const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const map = L.map('map', { zoomControl: false, minZoom: MIN_ZOOM, zoomAnimation: !calm, fadeAnimation: !calm, markerZoomAnimation: !calm }).setView(SUTD, START_ZOOM);
map.attributionControl.setPosition('bottomleft');   // keep the OSM credit clear of the recentre button
L.tileLayer(TILE_URL, {
  maxZoom: MAX_ZOOM,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

// Layer order, bottom to top: tiles (200), fog (450), quest spot (470), the wisp (475), discovered places (480), player dot (500), popups (700).
// The quest spot has its own pane, so it looks different from discovered places and sits above the fog that hides its place.
map.createPane('fog').style.zIndex = '450';
map.createPane('quest').style.zIndex = '470';
map.createPane('wisp').style.zIndex = '475';
map.createPane('places').style.zIndex = '480';
map.createPane('player').style.zIndex = '500';
