// app.js
import { CONFIG } from './config.js';

console.log('🚀 Starting bike visualization...');

mapboxgl.accessToken = pk.eyJ1IjoibGF1cmFwb25vcmFuIiwiYSI6ImNtaGRzeGNpcTA2YjQyaXNqbGw5Z21jMGQifQ.o2DvN6MoLC9JNvCr_GOrKg;

const map = new mapboxgl.Map({
  container: 'map',
  style: CONFIG.MAP_STYLE,
  center: CONFIG.MAP_CENTER,
  zoom: CONFIG.MAP_ZOOM
});

// Make map accessible for debugging
window.map = map;

let tripLayers = [];
let speedMode = 'gradient';
let showSpeedColors = false;
let selectedTrip = null;
let tripStatsCalculated = false;
let allTripData = {}; // Store complete trip stats for each layer

// Default orange color for routes
const DEFAULT_COLOR = '#FF6600';

// Speed color functions
function getSpeedColorExpression(mode) {
  if (mode === 'gradient') {
    return [
      'interpolate',
      ['linear'],
      ['to-number', ['coalesce', ['get', 'Speed'], 0]],
      0, '#808080',
      2, '#DC2626',
      5, '#F97316',
      10, '#FACC15',
      15, '#22C55E',
      20, '#3B82F6',
      25, '#6366F1'
    ];
  } else {
    return [
      'step',
      ['to-number', ['coalesce', ['get', 'Speed'], 0]],
      '#808080',
      2, '#DC2626',
      5, '#F97316',
      10, '#FACC15',
      15, '#22C55E',
      20, '#3B82F6',
      25, '#6366F1'
    ];
  }
}

map.on('error', (e) => {
  console.error('❌ Map error:', e);
});

map.on('load', async () => {
  console.log('✅ Map loaded');

  try {
    console.log('📡 Loading bike trips from:', CONFIG.PMTILES_URL);

    // Setup PMTiles
    const protocol = new pmtiles.Protocol();
    mapboxgl.addProtocol('pmtiles', protocol.tile);

    const pmtilesUrl = `${window.location.origin}${CONFIG.PMTILES_URL}`;
    const p = new pmtiles.PMTiles(pmtilesUrl);
    protocol.add(p);

    const metadata = await p.getMetadata();
    console.log('✅ PMTiles loaded:', metadata);

    const layers = metadata.vector_layers || [];
    tripLayers = layers.map(l => l.id);

    console.log('📊 Found', tripLayers.length, 'trips');

    map.addSource('trips', {
      type: 'vector',
      url: `pmtiles://${pmtilesUrl}`,
      attribution: 'Bike sensor data'
    });

    tripLayers.forEach(layerId => {
      map.addLayer({
        id: layerId,
        type: 'line',
        source: 'trips',
        'source-layer': layerId,
        paint: {
          'line-color': DEFAULT_COLOR,
          'line-width': 3,
          'line-opacity': 0.7
        }
      });
    });

    console.log('✅ All trips loaded and visible');

    map.setCenter([4.9041, 52.3676]); // Amsterdam
    map.setZoom(13);

    setupControls();
    setupClickHandlers();

    // Calculate all trip stats once map is idle
    map.once('idle', () => {
      console.log('Map idle, calculating all trip stats');
      calculateAllTripStats();
    });

  } catch (err) {
    console.error('❌ Error loading trips:', err);
  }
});

function setupControls() {
  const speedColorsCheckbox = document.getElementById('speedColorsCheckbox');
  if (!speedColorsCheckbox) {
    console.error('Missing speedColorsCheckbox element');
    return;
  }

  speedColorsCheckbox.addEventListener('change', (e) => {
    showSpeedColors = e.target.checked;
    console.log('Speed colors toggled:', showSpeedColors);

    const speedLegend = document.getElementById('speedLegend');
    const speedModeGroup = document.getElementById('speedModeGroup');

    if (showSpeedColors) {
      const colorExpression = getSpeedColorExpression(speedMode);
      tripLayers.forEach(layerId => {
        map.setPaintProperty(layerId, 'line-color', colorExpression);
      });
      speedLegend.style.display = 'block';
      speedModeGroup.style.display = 'block';
    } else {
      tripLayers.forEach(layerId => {
        map.setPaintProperty(layerId, 'line-color', DEFAULT_COLOR);
      });
      speedLegend.style.display = 'none';
      speedModeGroup.style.display = 'none';
    }
  });

  document.querySelectorAll('input[name="speedMode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      speedMode = e.target.value;
      if (showSpeedColors) {
        tripLayers.forEach(layerId => {
          map.setPaintProperty(layerId, 'line-color', getSpeedColorExpression(speedMode));
        });
      }
    });
  });
}

// ✅ New helper: get full-trip stats (not limited to visible segments)
async function getFullTripStats(layerId) {
  if (allTripData[layerId]) return allTripData[layerId];

  const features = map.querySourceFeatures('trips', { sourceLayer: layerId });
  let totalDistance = 0;
  let totalTime = 0;

  features.forEach(f => {
    totalDistance += f.properties.gps_distance_m || 0;
    totalTime += f.properties.time_diff_s || 0;
  });

  const distanceKm = totalDistance / 1000;
  const avgSpeed = totalTime > 0 ? (distanceKm / (totalTime / 3600)) : 0;

  const stats = {
    distanceKm: distanceKm.toFixed(2),
    avgSpeed: avgSpeed.toFixed(1),
    totalTime
  };

  allTripData[layerId] = stats;
  return stats;
}

function setupClickHandlers() {
  tripLayers.forEach(layerId => {
    map.on('click', layerId, async (e) => {
      console.log('Layer clicked:', layerId);
      e.preventDefault();
      if (e.originalEvent) e.originalEvent.stopPropagation();

      const props = e.features[0].properties;
      const speed = props.Speed || 0;

      selectedTrip = layerId;
      tripLayers.forEach(id => {
        try {
          if (id === layerId) {
            map.setPaintProperty(id, 'line-opacity', 1.0);
            map.setPaintProperty(id, 'line-width', 4);
          } else {
            map.setPaintProperty(id, 'line-opacity', 0.15);
            map.setPaintProperty(id, 'line-width', 2);
          }
        } catch (err) {
          console.error('Error updating layer:', id, err);
        }
      });

      document.getElementById('selectedTripRow').style.display = 'flex';
      const tripName = layerId.replace(/_/g, ' ').replace(/processed/gi, '').trim();
      document.getElementById('selectedTrip').textContent = tripName;

      // ✅ Use full-trip stats
      const stats = await getFullTripStats(layerId);
      const { distanceKm, avgSpeed, totalTime } = stats;

      const durationMinutes = Math.floor(totalTime / 60);
      const durationSeconds = Math.round(totalTime % 60);
      const durationFormatted = `${durationMinutes}:${durationSeconds.toString().padStart(2, '0')}`;

      new mapboxgl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`
          <strong>${tripName}</strong><br>
          🚴 Speed at point: ${speed} km/h<br>
          📊 Average speed: ${avgSpeed} km/h<br>
          📍 Total distance: ${distanceKm} km<br>
          ⏱️ Duration: ${durationFormatted}
        `)
        .addTo(map);
    });

    map.on('mouseenter', layerId, () => {
      map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', layerId, () => {
      map.getCanvas().style.cursor = '';
    });
  });

  // Click map background to reset
  map.on('click', (e) => {
    if (!e.defaultPrevented && selectedTrip) {
      selectedTrip = null;
      tripLayers.forEach(layerId => {
        try {
          map.setPaintProperty(layerId, 'line-opacity', 0.7);
          map.setPaintProperty(layerId, 'line-width', 3);
        } catch (err) {
          console.error('Error resetting layer:', layerId, err);
        }
      });
      document.getElementById('selectedTripRow').style.display = 'none';
    }
  });
}

function calculateAllTripStats() {
  console.log('Calculating stats for all trips...');

  let totalDistance = 0;
  let totalTime = 0;
  let tripCount = 0;

  const originalCenter = map.getCenter();
  const originalZoom = map.getZoom();
  map.setZoom(11);

  setTimeout(() => {
    tripLayers.forEach(layerId => {
      const features = map.querySourceFeatures('trips', { sourceLayer: layerId });

      let tripDistance = 0;
      let tripTime = 0;

      features.forEach(feature => {
        tripDistance += feature.properties.gps_distance_m || 0;
        tripTime += feature.properties.time_diff_s || 0;
      });

      if (tripDistance > 0 || tripTime > 0) {
        totalDistance += tripDistance;
        totalTime += tripTime;
        tripCount++;

        const distanceKm = tripDistance / 1000;
        const avgSpeed = tripTime > 0 ? (distanceKm / (tripTime / 3600)) : 0;

        allTripData[layerId] = {
          distanceKm: distanceKm.toFixed(2),
          avgSpeed: avgSpeed.toFixed(1),
          totalTime: tripTime
        };

        console.log(`${layerId}: ${distanceKm.toFixed(2)} km, ${tripTime}s`);
      }
    });

    console.log(`Total: ${tripCount} trips, ${totalDistance}m, ${totalTime}s`);

    const totalDistanceKm = (totalDistance / 1000).toFixed(1);
    const avgSpeed = totalTime > 0 ? ((totalDistance / 1000) / (totalTime / 3600)).toFixed(1) : 0;

    const totalHours = Math.floor(totalTime / 3600);
    const totalMinutes = Math.floor((totalTime % 3600) / 60);
    const totalTimeFormatted = totalHours > 0
      ? `${totalHours}h ${totalMinutes}m`
      : `${totalMinutes}m`;

    document.getElementById('statTrips').textContent = tripLayers.length;
    document.getElementById('statDistance').textContent = `${totalDistanceKm} km`;
    document.getElementById('statAvgSpeed').textContent = `${avgSpeed} km/h`;
    document.getElementById('statTotalTime').textContent = totalTimeFormatted;

    map.setCenter(originalCenter);
    map.setZoom(originalZoom);

    tripStatsCalculated = true;
  }, 1000);
}

function updateStats() {
  document.getElementById('statTrips').textContent = tripLayers.length;
}