// config.js
export const CONFIG = {
  MAPBOX_TOKEN: '', // Not needed for OSM
  MAP_STYLE: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  MAP_CENTER: [4.9041, 52.3676], // Amsterdam
  MAP_ZOOM: 13,
  PMTILES_URL: '/Reflector-Ride-Maps-V2/trips.pmtiles'
};

// Also make available globally for non-module scripts
window.CONFIG = CONFIG;