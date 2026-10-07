// The Leaflet map and its OSM tiles. Other modules import `map` and add layers to it.
import { SUTD, START_ZOOM, MAX_ZOOM, TILE_URL } from './config.js';

export const map = L.map('map', { zoomControl: false }).setView(SUTD, START_ZOOM);
map.attributionControl.setPosition('bottomleft');   // keep the OSM credit clear of the recentre button
L.tileLayer(TILE_URL, {
  maxZoom: MAX_ZOOM,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
