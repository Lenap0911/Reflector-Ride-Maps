// app.js - Updated with analytics integration
import { CONFIG } from './config.js';

console.log('🚀 Starting bike visualization...');

mapboxgl.accessToken = CONFIG.MAPBOX_TOKEN;

const map = new mapboxgl.Map({
  container: 'map',
  style: CONFIG.MAP_STYLE,
  center: CONFIG.MAP_CENTER,
  zoom: CONFIG.MAP_ZOOM
});

window.map = map;

let tripLayers = [];
let speedMode = 'gradient';
let showSpeedColors = false;
let selectedTrip = null;
let tripsMetadata = null;
let currentPopup = null;

const DEFAULT_COLOR = '#FF6600';

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

async function loadMetadata() {
  const possiblePaths = [
    `${CONFIG.DATA_URL}/trips_metadata.json`,
    '/trips_metadata.json',
    './trips_metadata.json',
    'trips_metadata.json'
  ];
  
  for (const path of possiblePaths) {
    try {
      console.log('Trying to load metadata from:', path);
      const response = await fetch(path);
      if (response.ok) {
        tripsMetadata = await response.json();
        console.log('✅ Loaded trip metadata from', path, 'for', Object.keys(tripsMetadata).length, 'trips');
        
        // Update analytics when metadata is loaded
        if (window.updateAnalytics) {
          window.updateAnalytics(tripsMetadata);
        }
        
        return tripsMetadata;
      }
    } catch (err) {
      console.log('❌ Failed to load from', path);
    }
  }
  
  console.warn('⚠️ Could not load metadata');
  return null;
}

function getTripStats(tripId) {
  if (!tripsMetadata) {
    console.warn('No metadata loaded');
    return null;
  }
  
  const cleanTripId = tripId.replace(/_processed$/i, '');
  
  if (!tripsMetadata[cleanTripId]) {
    console.warn('No metadata for trip:', tripId);
    return null;
  }
  
  const tripData = tripsMetadata[cleanTripId];
  const meta = tripData.metadata || tripData;
  
  const gnssLine = meta['GNSS'];
  if (!gnssLine) {
    console.warn('No GNSS data for trip:', cleanTripId);
    return null;
  }
  
  const parts = gnssLine.split(',');
  
  return {
    duration: parts[1],
    stops: parts[2],
    distance: parseFloat(parts[3]) || 0,
    avgSpeed: parseFloat(parts[4]) || 0,
    avgSpeedWOS: parseFloat(parts[5]) || 0,
    maxSpeed: parseFloat(parts[6]) || 0,
    elevation: parseFloat(parts[11]) || 0
  };
}

function calculateAggregateStats() {
  if (!tripsMetadata) {
    console.warn('No metadata available for aggregate stats');
    return null;
  }
  
  let totalDistance = 0;
  let totalTime = 0;
  let totalAvgSpeed = 0;
  let tripCount = 0;
  
  Object.keys(tripsMetadata).forEach(tripId => {
    const stats = getTripStats(tripId);
    if (stats) {
      totalDistance += stats.distance;
      
      const [part1, part2] = stats.duration.split(':').map(Number);
      const durationSeconds = (part1 * 60 + part2) * 60;
      totalTime += durationSeconds;
      
      totalAvgSpeed += stats.avgSpeed;
      
      tripCount++;
    }
  });
  
  const avgSpeed = tripCount > 0 ? (totalAvgSpeed / tripCount) : 0;
  
  return {
    tripCount,
    totalDistance: totalDistance.toFixed(1),
    totalTime: formatDuration(totalTime),
    avgSpeed: avgSpeed.toFixed(1)
  };
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function parseDurationToSeconds(duration) {
  if (!duration) return 0;
  const [part1, part2] = duration.split(':').map(Number);
  return part1 * 60 + part2;
}

function resetSelection() {
  console.log('Resetting selection');
  selectedTrip = null;
  
  if (currentPopup) {
    currentPopup.remove();
    currentPopup = null;
  }
  
  tripLayers.forEach(layerId => {
    try {
      map.setPaintProperty(layerId, 'line-opacity', 0.7);
      map.setPaintProperty(layerId, 'line-width', 3);
    } catch (err) {
      console.error('Error resetting layer:', layerId, err);
    }
  });
  
  document.getElementById('resetButton').style.display = 'none';
  document.getElementById('selectedTripRow').style.display = 'none';
  document.getElementById('statTripRow').style.display = 'flex';
  document.getElementById('statDistanceRow').style.display = 'flex';
  document.getElementById('statAvgSpeedRow').style.display = 'flex';
  document.getElementById('statTotalTimeRow').style.display = 'flex';
}

function showSelection(layerId) {
  console.log('Showing selection for:', layerId);
  
  document.getElementById('resetButton').style.display = 'block';
  document.getElementById('statTripRow').style.display = 'none';
  document.getElementById('statDistanceRow').style.display = 'none';
  document.getElementById('statAvgSpeedRow').style.display = 'none';
  document.getElementById('statTotalTimeRow').style.display = 'none';
  document.getElementById('selectedTripRow').style.display = 'flex';
  
  const tripName = layerId.replace(/_/g, ' ').replace(/processed/gi, '').trim();
  document.getElementById('selectedTrip').textContent = tripName;
}

map.on('error', (e) => {
  console.error('❌ Map error:', e);
});

map.on('load', async () => {
  console.log('✅ Map loaded');
  
  await loadMetadata();
  
  try {
    console.log('📡 Loading bike trips from:', CONFIG.PMTILES_URL);
    
    const protocol = new pmtiles.Protocol();
    mapboxgl.addProtocol('pmtiles', protocol.tile);
    
    const pmtilesUrl = CONFIG.PMTILES_URL;
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
    
    map.setCenter([4.9041, 52.3676]);
    map.setZoom(13);
    
    setupControls();
    setupClickHandlers();
    updateStatsFromMetadata();

  } catch (err) {
    console.error('❌ Error loading trips:', err);
  }
});

function setupControls() {
  const resetButton = document.getElementById('resetButton');
  if (resetButton) {
    resetButton.addEventListener('click', () => {
      resetSelection();
    });
  }
  
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
      console.log('Applying color expression:', colorExpression);
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

function setupClickHandlers() {
  tripLayers.forEach(layerId => {
    map.on('click', layerId, async (e) => {
      console.log('Layer clicked:', layerId);
      e.preventDefault();
      if (e.originalEvent) {
        e.originalEvent.stopPropagation();
      }
      
      if (currentPopup) {
        currentPopup.remove();
      }
      
      const props = e.features[0].properties;
      const speed = props.Speed || 0;
      
      selectedTrip = layerId;
      tripLayers.forEach(id => {
        try {
          if (id === layerId) {
            map.setPaintProperty(id, 'line-opacity', 1.0);
            map.setPaintProperty(id, 'line-width', 4);
            console.log('Highlighted:', id);
          } else {
            map.setPaintProperty(id, 'line-opacity', 0.15);
            map.setPaintProperty(id, 'line-width', 2);
            console.log('Faded:', id);
          }
        } catch (err) {
          console.error('Error updating layer:', id, err);
        }
      });
      
      showSelection(layerId);
      
      const stats = getTripStats(layerId);
      
      let distanceKm, avgSpeed, maxSpeed, durationFormatted;
      
      if (stats) {
        distanceKm = stats.distance.toFixed(2);
        avgSpeed = stats.avgSpeed.toFixed(1);
        maxSpeed = stats.maxSpeed.toFixed(1);
        durationFormatted = stats.duration;
        console.log(`Using metadata for ${layerId}:`, stats);
      } else {
        distanceKm = '—';
        avgSpeed = '—';
        maxSpeed = '—';
        durationFormatted = '—';
        console.warn('No metadata available for', layerId);
      }
      
      const popupTripName = layerId.replace(/_/g, ' ').replace(/processed/gi, '').trim();
      currentPopup = new mapboxgl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`
          <strong>${popupTripName}</strong><br>
          🚴 Speed at point: ${speed} km/h<br>
          📊 Average speed: ${avgSpeed} km/h<br>
          🏁 Max speed: ${maxSpeed} km/h<br>
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
  
  map.on('click', (e) => {
    console.log('Map background clicked, defaultPrevented:', e.defaultPrevented);
    if (!e.defaultPrevented && selectedTrip) {
      resetSelection();
    }
  });
}

function updateStatsFromMetadata() {
  if (!tripsMetadata) {
    console.warn('No metadata available');
    document.getElementById('statTrips').textContent = tripLayers.length;
    return;
  }
  
  const aggregateStats = calculateAggregateStats();
  
  if (aggregateStats) {
    document.getElementById('statTrips').textContent = aggregateStats.tripCount;
    document.getElementById('statDistance').textContent = `${aggregateStats.totalDistance} km`;
    document.getElementById('statAvgSpeed').textContent = `${aggregateStats.avgSpeed} km/h`;
    document.getElementById('statTotalTime').textContent = aggregateStats.totalTime;
    console.log('✅ Stats updated from metadata:', aggregateStats);
  } else {
    document.getElementById('statTrips').textContent = tripLayers.length;
    console.warn('Could not calculate aggregate stats');
  }
}

// Fullscreen functionality
const fullscreenBtn = document.getElementById('fullscreenBtn');
const mapContainer = document.getElementById('mapContainer');

fullscreenBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    if (mapContainer.requestFullscreen) {
      mapContainer.requestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
});