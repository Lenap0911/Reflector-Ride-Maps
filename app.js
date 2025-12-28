// app.js - Enhanced with Road Quality Layer, Trip Search, and Traffic Lights
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
let showRoadQuality = false;
let selectedTrip = null;
let tripsMetadata = null;
let currentPopup = null;
let trafficLightAnalysis = null;
let showTrafficLightAnalysis = false;
let analysisMode = 'overall'; // 'sudden', 'extended', 'overall'

// Default orange color for routes
const DEFAULT_COLOR = '#FF6600';

// Traffic light analysis parameters
const ANALYSIS_RADIUS = 25; // meters - diameter zone around traffic light
const SUDDEN_BRAKE_THRESHOLD = -3; // m/s² - deceleration rate
const EXTENDED_STOP_THRESHOLD = 5; // seconds - time stopped or very slow
const SLOW_SPEED_THRESHOLD = 2; // km/h - considered "stopped"

// Speed color functions
function getSpeedColorExpression(mode) {
  const speedValue = [
    'to-number',
    ['coalesce', ['get', 'Speed'], ['get', 'speed'], 0]
  ];
  
  if (mode === 'gradient') {
    return [
      'interpolate',
      ['linear'],
      speedValue,
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
      speedValue,
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

// Road quality color expression
function getRoadQualityColorExpression() {
  return [
    'match',
    ['get', 'road_quality'],
    1, '#22C55E',
    2, '#84CC16',
    3, '#FACC15',
    4, '#F97316',
    5, '#DC2626',
    '#808080'
  ];
}

// Load metadata
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
    console.warn('⚠️ No metadata loaded');
    return null;
  }
  
  const variations = [
    tripId,
    tripId.replace(/_clean_processed$/i, ''),
    tripId.replace(/_clean$/i, ''),
    tripId.replace(/_processed$/i, ''),
    tripId.replace(/_clean/gi, '').replace(/_processed/gi, ''),
    tripId.split('_clean')[0],
    tripId.split('_processed')[0]
  ];
  
  console.log('🔍 Looking for metadata. Layer ID:', tripId);
  console.log('📋 Trying variations:', variations);
  console.log('🗂️ Available metadata keys (first 10):', Object.keys(tripsMetadata).slice(0, 10));
  
  let tripData = null;
  let foundKey = null;
  
  for (const variant of variations) {
    if (tripsMetadata[variant]) {
      tripData = tripsMetadata[variant];
      foundKey = variant;
      break;
    }
  }
  
  if (!tripData) {
    console.warn('❌ No metadata found for any variation of:', tripId);
    return null;
  }
  
  console.log('✅ Found metadata using key:', foundKey);
  
  const meta = tripData.metadata || tripData;
  const gnssLine = meta['GNSS'];
  
  if (!gnssLine) {
    console.warn('❌ No GNSS data in metadata');
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
  if (!tripsMetadata) return null;
  
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
      
      // Reset to appropriate color based on active mode
      if (showSpeedColors) {
        map.setPaintProperty(layerId, 'line-color', getSpeedColorExpression(speedMode));
      } else if (showRoadQuality) {
        map.setPaintProperty(layerId, 'line-color', getRoadQualityColorExpression());
      } else {
        map.setPaintProperty(layerId, 'line-color', DEFAULT_COLOR);
      }
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
  
  const tripName = layerId.replace(/_/g, ' ').replace(/processed/gi, '').replace(/clean/gi, '').trim();
  document.getElementById('selectedTrip').textContent = tripName;
}

// Search and highlight trip
function searchAndHighlightTrip(searchTerm) {
  if (!searchTerm) {
    resetSelection();
    return;
  }
  
  const normalizedSearch = searchTerm.toLowerCase().trim();
  
  // Find matching trip
  const matchingTrip = tripLayers.find(layerId => 
    layerId.toLowerCase().includes(normalizedSearch)
  );
  
  if (matchingTrip) {
    console.log('🎯 Found trip:', matchingTrip);
    
    // Highlight the trip
    selectedTrip = matchingTrip;
    tripLayers.forEach(id => {
      try {
        if (id === matchingTrip) {
          map.setPaintProperty(id, 'line-opacity', 1.0);
          map.setPaintProperty(id, 'line-width', 5);
          map.setPaintProperty(id, 'line-color', '#FF00FF'); // Magenta for search result
        } else {
          map.setPaintProperty(id, 'line-opacity', 0.15);
          map.setPaintProperty(id, 'line-width', 2);
        }
      } catch (err) {
        console.error('Error updating layer:', id, err);
      }
    });
    
    showSelection(matchingTrip);
    
    // Zoom to the trip
    try {
      const features = map.querySourceFeatures('trips', {
        sourceLayer: matchingTrip
      });
      
      if (features.length > 0) {
        const bbox = turf.bbox({
          type: 'FeatureCollection',
          features: features
        });
        
        map.fitBounds(bbox, {
          padding: 50,
          duration: 1000
        });
      }
    } catch (err) {
      console.error('Error zooming to trip:', err);
    }
    
    return true;
  } else {
    console.log('❌ No trip found matching:', searchTerm);
    alert(`No trip found matching: ${searchTerm}`);
    return false;
  }
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
    
    // ==========================================
    // 🚦 TRAFFIC LIGHTS LAYER
    // ==========================================
    console.log('📡 Loading Amsterdam traffic lights...');
    
    try {
      // Try multiple possible paths
      const possiblePaths = [
        './traffic_lights.json',
        'traffic_lights.json',
        '/traffic_lights.json',
        '../traffic_lights.json',
        `${CONFIG.DATA_URL}/traffic_lights.json`
      ];
      
      let trafficLightsData = null;
      
      for (const path of possiblePaths) {
        try {
          console.log('🔍 Trying to load traffic lights from:', path);
          const response = await fetch(path);
          if (response.ok) {
            trafficLightsData = await response.json();
            console.log('✅ Loaded traffic lights from', path);
            console.log(`📍 Found ${trafficLightsData.features.length} traffic lights`);
            break;
          }
        } catch (err) {
          console.log('❌ Failed to load from', path, err.message);
        }
      }
      
      if (!trafficLightsData) {
        console.error('❌ Could not load traffic lights from any path');
      } else {
        // Add source with loaded data
        map.addSource('verkeerslichten', {
          type: 'geojson',
          data: trafficLightsData
        });

        // Add the layer
        map.addLayer({
          id: 'verkeerslichten',
          type: 'circle',
          source: 'verkeerslichten',
          paint: {
            'circle-radius': 4,
            'circle-color': '#f4071bff',
            'circle-stroke-width': 1,
            'circle-opacity': 0.8
          }
        });

        console.log('✅ Traffic lights layer added with', trafficLightsData.features.length, 'points');

        // Click handler for traffic lights
        map.on('click', 'verkeerslichten', (e) => {
          e.preventDefault();
          if (e.originalEvent) {
            e.originalEvent.stopPropagation();
          }
          
          const props = e.features[0].properties;
          new mapboxgl.Popup()
            .setLngLat(e.lngLat)
            .setHTML(`<strong>🚦 Verkeerslicht</strong><br>${props.Kruispunt || 'Geen locatie beschikbaar'}`)
            .addTo(map);
        });

        // Cursor pointer on hover
        map.on('mouseenter', 'verkeerslichten', () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        
        map.on('mouseleave', 'verkeerslichten', () => {
          map.getCanvas().style.cursor = '';
        });
      }

    } catch (err) {
      console.error('❌ Error loading traffic lights:', err);
    }
    // ==========================================
    // END TRAFFIC LIGHTS LAYER
    // ==========================================
    
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
  
  // Trip search
  const searchInput = document.getElementById('tripSearchInput');
  const searchButton = document.getElementById('tripSearchButton');
  
  if (searchInput && searchButton) {
    searchButton.addEventListener('click', () => {
      searchAndHighlightTrip(searchInput.value);
    });
    
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        searchAndHighlightTrip(searchInput.value);
      }
    });
  }
  
  // Speed colors toggle
  const speedColorsCheckbox = document.getElementById('speedColorsCheckbox');
  if (speedColorsCheckbox) {
    speedColorsCheckbox.addEventListener('change', (e) => {
      showSpeedColors = e.target.checked;
      console.log('Speed colors toggled:', showSpeedColors);
      
      if (showSpeedColors && showRoadQuality) {
        showRoadQuality = false;
        document.getElementById('roadQualityCheckbox').checked = false;
        document.getElementById('roadQualityLegend').style.display = 'none';
      }
      
      const speedLegend = document.getElementById('speedLegend');
      const speedModeGroup = document.getElementById('speedModeGroup');
      
      if (showSpeedColors) {
        const colorExpression = getSpeedColorExpression(speedMode);
        tripLayers.forEach(layerId => {
          map.setPaintProperty(layerId, 'line-color', colorExpression);
        });
        speedLegend.style.display = 'block';
        speedModeGroup.style.display = 'flex';
      } else {
        tripLayers.forEach(layerId => {
          map.setPaintProperty(layerId, 'line-color', DEFAULT_COLOR);
        });
        speedLegend.style.display = 'none';
        speedModeGroup.style.display = 'none';
      }
    });
  }

  // Road quality toggle
  const roadQualityCheckbox = document.getElementById('roadQualityCheckbox');
  if (roadQualityCheckbox) {
    roadQualityCheckbox.addEventListener('change', (e) => {
      showRoadQuality = e.target.checked;
      console.log('Road quality toggled:', showRoadQuality);
      
      if (showRoadQuality && showSpeedColors) {
        showSpeedColors = false;
        document.getElementById('speedColorsCheckbox').checked = false;
        document.getElementById('speedLegend').style.display = 'none';
        document.getElementById('speedModeGroup').style.display = 'none';
      }
      
      const roadQualityLegend = document.getElementById('roadQualityLegend');
      
      if (showRoadQuality) {
        const colorExpression = getRoadQualityColorExpression();
        tripLayers.forEach(layerId => {
          map.setPaintProperty(layerId, 'line-color', colorExpression);
        });
        roadQualityLegend.style.display = 'block';
      } else {
        tripLayers.forEach(layerId => {
          map.setPaintProperty(layerId, 'line-color', DEFAULT_COLOR);
        });
        roadQualityLegend.style.display = 'none';
      }
    });
  }

  // Speed mode radio buttons
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

  // Traffic lights toggle
  const trafficLightsCheckbox = document.getElementById('trafficLightsCheckbox');
  if (trafficLightsCheckbox) {
    trafficLightsCheckbox.addEventListener('change', (e) => {
      const visibility = e.target.checked ? 'visible' : 'none';
      if (map.getLayer('verkeerslichten')) {
        map.setLayoutProperty('verkeerslichten', 'visibility', visibility);
        console.log('🚦 Traffic lights visibility:', visibility);
      }
    });
  }
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
      console.log('📍 Clicked feature properties:', props);
      const speed = parseFloat(props.Speed || props.speed || 0);
      const roadQuality = parseInt(props.road_quality || props.roadQuality || 0);
      console.log('🚴 Parsed speed:', speed, 'Road quality:', roadQuality);
      
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
      
      showSelection(layerId);
      
      const stats = getTripStats(layerId);
      
      let distanceKm, avgSpeed, maxSpeed, durationFormatted;
      
      if (stats) {
        console.log('✅ Found stats for trip:', stats);
        distanceKm = stats.distance.toFixed(2);
        avgSpeed = stats.avgSpeed.toFixed(1);
        maxSpeed = stats.maxSpeed.toFixed(1);
        durationFormatted = stats.duration;
      } else {
        console.warn('⚠️ No stats available for trip:', layerId);
        distanceKm = '—';
        avgSpeed = '—';
        maxSpeed = '—';
        durationFormatted = '—';
      }
      
      const qualityLabels = {
        1: 'Perfect',
        2: 'Normal',
        3: 'Outdated',
        4: 'Bad',
        5: 'No road',
        0: 'Unknown'
      };
      const qualityLabel = qualityLabels[roadQuality] || 'Unknown';
      
      const popupTripName = layerId.replace(/_/g, ' ').replace(/processed/gi, '').replace(/clean/gi, '').trim();
      currentPopup = new mapboxgl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`
          <strong>${popupTripName}</strong><br>
          🚴 Speed at point: ${speed} km/h<br>
          🛣️ Road quality: ${roadQuality} (${qualityLabel})<br>
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
  
  // Click anywhere on map to deselect trip
  map.on('click', (e) => {
    if (!e.defaultPrevented && selectedTrip) {
      resetSelection();
    }
  });
}

function updateStatsFromMetadata() {
  if (!tripsMetadata) {
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
  }
}

// Make search function available globally for console testing
window.searchTrip = searchAndHighlightTrip;