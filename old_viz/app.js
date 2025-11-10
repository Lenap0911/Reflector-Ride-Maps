// app.js
import { CONFIG } from './config.js';

console.log('🚀 Starting bike visualization...');

mapboxgl.accessToken = CONFIG.MAPBOX_TOKEN;

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
let tripsMetadata = null; // Store metadata
let currentPopup = null; // Track the current popup

// Default orange color for routes
const DEFAULT_COLOR = '#FF6600';

// Speed color functions
function getSpeedColorExpression(mode) {
  if (mode === 'gradient') {
    return [
      'interpolate',
      ['linear'],
      ['to-number', ['coalesce', ['get', 'Speed'], 0]],
      0, '#808080',   // Gray - stopped
      2, '#DC2626',   // Red - very slow
      5, '#F97316',   // Orange - slow
      10, '#FACC15',  // Yellow - moderate
      15, '#22C55E',  // Green - fast
      20, '#3B82F6',  // Blue - very fast
      25, '#6366F1'   // Indigo - extreme
    ];
  } else {
    return [
      'step',
      ['to-number', ['coalesce', ['get', 'Speed'], 0]],
      '#808080',  // Gray - stopped (0-2)
      2, '#DC2626',   // Red (2-5)
      5, '#F97316',   // Orange (5-10)
      10, '#FACC15',  // Yellow (10-15)
      15, '#22C55E',  // Green (15-20)
      20, '#3B82F6',  // Blue (20-25)
      25, '#6366F1'   // Indigo (25+)
    ];
  }
}

// Load metadata
async function loadMetadata() {
  // Try multiple possible paths
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
  
  console.warn('⚠️ Could not load metadata from any path. Please place trips_metadata.json in your project root or /Reflector-Ride-Maps-V2/ directory');
  return null;
}

// Parse metadata for a specific trip
function getTripStats(tripId) {
  if (!tripsMetadata) {
    console.warn('No metadata loaded');
    return null;
  }
  
  // Remove "_processed" suffix if present
  const cleanTripId = tripId.replace(/_processed$/i, '');
  
  if (!tripsMetadata[cleanTripId]) {
    console.warn('No metadata for trip:', tripId, '(cleaned:', cleanTripId + ')');
    return null;
  }
  
  // Handle nested metadata structure
  const tripData = tripsMetadata[cleanTripId];
  const meta = tripData.metadata || tripData; // Support both nested and flat structures
  
  // Parse the GNSS line which has the actual stats
  // Format: ",Duration,Stops,Dist km,AVG km/h,AVGWOS km/h,MAX km/h,..."
  // Example: ",14:50,01:12,4.196,17,18,29,,,,,0"
  const gnssLine = meta['GNSS'];
  if (!gnssLine) {
    console.warn('No GNSS data for trip:', cleanTripId);
    return null;
  }
  
  const parts = gnssLine.split(',');
  
  return {
    duration: parts[1], // "14:50"
    stops: parts[2], // "01:12"
    distance: parseFloat(parts[3]) || 0, // 4.196 km
    avgSpeed: parseFloat(parts[4]) || 0, // 17 km/h
    avgSpeedWOS: parseFloat(parts[5]) || 0, // 18 km/h (without stops)
    maxSpeed: parseFloat(parts[6]) || 0, // 29 km/h
    elevation: parseFloat(parts[11]) || 0 // 0 m
  };
}

// Calculate aggregate stats from all trips
function calculateAggregateStats() {
  if (!tripsMetadata) {
    console.warn('No metadata available for aggregate stats');
    return null;
  }
  
  let totalDistance = 0;
  let totalTime = 0; // in seconds
  let totalAvgSpeed = 0;
  let tripCount = 0;
  
  Object.keys(tripsMetadata).forEach(tripId => {
    const stats = getTripStats(tripId);
    if (stats) {
      totalDistance += stats.distance;
      
      // Parse duration "HH:MM" or "MM:SS" format
      const [part1, part2] = stats.duration.split(':').map(Number);
      const durationSeconds = (part1 * 60 + part2) * 60; // Assuming MM:SS format
      totalTime += durationSeconds;
      
      // Sum up the average speeds from metadata
      totalAvgSpeed += stats.avgSpeed;
      
      tripCount++;
    }
  });
  
  // Average of the individual trip average speeds
  const avgSpeed = tripCount > 0 ? (totalAvgSpeed / tripCount) : 0;
  
  return {
    tripCount,
    totalDistance: totalDistance.toFixed(1),
    totalTime: formatDuration(totalTime),
    avgSpeed: avgSpeed.toFixed(1)
  };
}

// Format seconds into readable duration
function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

// Parse duration string to seconds
function parseDurationToSeconds(duration) {
  if (!duration) return 0;
  const [part1, part2] = duration.split(':').map(Number);
  // Assuming format is MM:SS
  return part1 * 60 + part2;
}

// Reset selection - show all trips normally
function resetSelection() {
  console.log('Resetting selection');
  selectedTrip = null;
  
  // Close any open popup
  if (currentPopup) {
    currentPopup.remove();
    currentPopup = null;
  }
  
  // Reset all layers to normal appearance
  tripLayers.forEach(layerId => {
    try {
      map.setPaintProperty(layerId, 'line-opacity', 0.7);
      map.setPaintProperty(layerId, 'line-width', 3);
    } catch (err) {
      console.error('Error resetting layer:', layerId, err);
    }
  });
  
  // Hide reset button
  document.getElementById('resetButton').style.display = 'none';
  
  // Hide selected trip row
  document.getElementById('selectedTripRow').style.display = 'none';
  
  // Show aggregate stats rows
  document.getElementById('statTripRow').style.display = 'flex';
  document.getElementById('statDistanceRow').style.display = 'flex';
  document.getElementById('statAvgSpeedRow').style.display = 'flex';
  document.getElementById('statTotalTimeRow').style.display = 'flex';
}

// Show selection UI
function showSelection(layerId) {
  console.log('Showing selection for:', layerId);
  
  // Show reset button
  document.getElementById('resetButton').style.display = 'block';
  
  // Hide aggregate stats
  document.getElementById('statTripRow').style.display = 'none';
  document.getElementById('statDistanceRow').style.display = 'none';
  document.getElementById('statAvgSpeedRow').style.display = 'none';
  document.getElementById('statTotalTimeRow').style.display = 'none';
  
  // Show selected trip row
  document.getElementById('selectedTripRow').style.display = 'flex';
  const tripName = layerId.replace(/_/g, ' ').replace(/processed/gi, '').trim();
  document.getElementById('selectedTrip').textContent = tripName;
}

map.on('error', (e) => {
  console.error('❌ Map error:', e);
});

map.on('load', async () => {
  console.log('✅ Map loaded');
  
  // Load metadata first
  await loadMetadata();
  
  try {
    console.log('📡 Loading bike trips from:', CONFIG.PMTILES_URL);
    
    // Setup PMTiles
    const protocol = new pmtiles.Protocol();
    mapboxgl.addProtocol('pmtiles', protocol.tile);
    
    // Use relative path for GitHub Pages
    const pmtilesUrl = CONFIG.PMTILES_URL;
    const p = new pmtiles.PMTiles(pmtilesUrl);
    protocol.add(p);
    
    // Get metadata
    const metadata = await p.getMetadata();
    console.log('✅ PMTiles loaded:', metadata);
    
    // Get layer names
    const layers = metadata.vector_layers || [];
    tripLayers = layers.map(l => l.id);
    
    console.log('📊 Found', tripLayers.length, 'trips');
    
    // Add source
    map.addSource('trips', {
      type: 'vector',
      url: `pmtiles://${pmtilesUrl}`,
      attribution: 'Bike sensor data'
    });
    
    // Add layer for each trip - all visible by default
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
    
    // Set initial view centered on Amsterdam
    map.setCenter([4.9041, 52.3676]); // Amsterdam coordinates
    map.setZoom(13); // Closer zoom level
    
    setupControls();
    setupClickHandlers();
    
    // Update stats from metadata
    updateStatsFromMetadata();

  } catch (err) {
    console.error('❌ Error loading trips:', err);
  }
});

function setupControls() {
  // Reset button handler
  const resetButton = document.getElementById('resetButton');
  if (resetButton) {
    resetButton.addEventListener('click', () => {
      resetSelection();
    });
  }
  
  // Speed colors toggle
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
}

function setupClickHandlers() {

  // Click handlers for trip layers - highlight on click
  tripLayers.forEach(layerId => {
    map.on('click', layerId, async (e) => {
      console.log('Layer clicked:', layerId);
      e.preventDefault();
      if (e.originalEvent) {
        e.originalEvent.stopPropagation();
      }
      
      // Close any existing popup
      if (currentPopup) {
        currentPopup.remove();
      }
      
      const props = e.features[0].properties;
      const speed = props.Speed || 0;
      
      // Set selected trip and fade others
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
      
      // Update UI to show selection
      showSelection(layerId);
      
      // Get stats from metadata
      const stats = getTripStats(layerId);
      
      let distanceKm, avgSpeed, maxSpeed, durationFormatted;
      
      if (stats) {
        // Use metadata stats
        distanceKm = stats.distance.toFixed(2);
        avgSpeed = stats.avgSpeed.toFixed(1);
        maxSpeed = stats.maxSpeed.toFixed(1);
        durationFormatted = stats.duration;
        console.log(`Using metadata for ${layerId}:`, stats);
      } else {
        // Fallback to basic display
        distanceKm = '—';
        avgSpeed = '—';
        maxSpeed = '—';
        durationFormatted = '—';
        console.warn('No metadata available for', layerId);
      }
      
      // Show popup and store reference
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
  
  // Click map background to reset
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