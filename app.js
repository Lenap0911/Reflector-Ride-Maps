// app.js - Enhanced with Road Quality Layer, Trip Search, and Traffic Light Analysis
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
let showTrafficLights = false;
let analysisMode = 'safety'; // 'safety', 'efficiency', 'overall'

// Default orange color for routes
const DEFAULT_COLOR = '#FF6600';

// Traffic light analysis parameters
const ANALYSIS_RADIUS = 25; // meters - diameter zone around traffic light
const SUDDEN_BRAKE_THRESHOLD = -3; // m/s² - deceleration rate
const EXTENDED_STOP_THRESHOLD = 5; // seconds - time stopped or very slow
const SLOW_SPEED_THRESHOLD = 2; // km/h - considered "stopped"

// Show info popup about traffic light analysis
function showTrafficLightInfoPopup() {
  // Create overlay
  const overlay = document.createElement('div');
  overlay.id = 'trafficLightInfoOverlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  // Create popup
  const popup = document.createElement('div');
  popup.style.cssText = `
    background: white;
    padding: 30px;
    border-radius: 8px;
    max-width: 500px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  `;
  
  popup.innerHTML = `
    <h3 style="margin-top: 0; color: #333;">🚦 Traffic Light Analysis</h3>
    <p style="color: #666; line-height: 1.6;">
      This layer analyzes cyclist behavior at traffic lights within a <strong>${ANALYSIS_RADIUS}m radius</strong> of each light.
    </p>
    <div style="margin: 20px 0;">
      <h4 style="color: #DC2626; margin-bottom: 10px;">🛑 Sudden Braking</h4>
      <p style="color: #666; margin: 0; line-height: 1.6;">
        Detected when a cyclist <strong>enters the ${ANALYSIS_RADIUS}m zone from outside</strong> and their speed 
        is below <strong>5 km/h at the first point inside the zone</strong>. This indicates they had to brake 
        suddenly or stop abruptly when approaching the traffic light.
      </p>
    </div>
    <div style="margin: 20px 0;">
      <h4 style="color: #F97316; margin-bottom: 10px;">⏱️ Extended Stops</h4>
      <p style="color: #666; margin: 0; line-height: 1.6;">
        Measured by counting <strong>all data points</strong> within the zone where speed is below <strong>${SLOW_SPEED_THRESHOLD} km/h</strong>. 
        More stopped points = longer waits. The score reflects the percentage of time spent stopped or nearly stopped.
      </p>
    </div>
    <button id="closeTrafficInfoBtn" style="
      width: 100%;
      padding: 12px;
      background: #3B82F6;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 16px;
      font-weight: 500;
      margin-top: 10px;
    ">Got it!</button>
  `;
  
  overlay.appendChild(popup);
  document.body.appendChild(overlay);
  
  // Close button handler
  document.getElementById('closeTrafficInfoBtn').addEventListener('click', () => {
    overlay.remove();
  });
  
  // Click outside to close
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
    }
  });
}

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

// Traffic light analysis color expression
function getTrafficLightAnalysisColor(score, mode) {
  // Score ranges from 0 (safe/efficient) to 100 (dangerous/inefficient)
  if (score < 20) return '#22C55E'; // Green - excellent
  if (score < 40) return '#84CC16'; // Light green - good
  if (score < 60) return '#FACC15'; // Yellow - moderate
  if (score < 80) return '#F97316'; // Orange - poor
  return '#DC2626'; // Red - critical
}

function getAnalysisLabel(score, mode) {
  if (mode === 'safety') {
    if (score < 20) return 'Very Safe';
    if (score < 40) return 'Safe';
    if (score < 60) return 'Moderate Risk';
    if (score < 80) return 'Unsafe';
    return 'Very Unsafe';
  } else if (mode === 'efficiency') {
    if (score < 20) return 'Very Efficient';
    if (score < 40) return 'Efficient';
    if (score < 60) return 'Moderate';
    if (score < 80) return 'Inefficient';
    return 'Very Inefficient';
  } else { // overall
    if (score < 20) return 'Excellent';
    if (score < 40) return 'Good';
    if (score < 60) return 'Moderate';
    if (score < 80) return 'Poor';
    return 'Critical';
  }
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
    return null;
  }
  
  const meta = tripData.metadata || tripData;
  const gnssLine = meta['GNSS'];
  
  if (!gnssLine) {
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

// Analyze traffic light zones for safety/efficiency
async function analyzeTrafficLights() {
  console.log('🔍 Starting traffic light zone analysis...');
  
  // Show loading bar
  const loadingBar = document.getElementById('analysisLoadingBar');
  const loadingProgress = document.getElementById('analysisLoadingProgress');
  const loadingText = document.getElementById('analysisLoadingText');
  
  if (loadingBar) {
    loadingBar.style.display = 'block';
    loadingProgress.style.width = '0%';
    loadingText.textContent = 'Initializing...';
  }
  
  // Wait a moment for layers to fully render
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const trafficLightsSource = map.getSource('verkeerslichten');
  if (!trafficLightsSource) {
    console.warn('⚠️ No traffic lights source found');
    if (loadingBar) loadingBar.style.display = 'none';
    return;
  }
  
  const trafficLightsData = trafficLightsSource._data;
  if (!trafficLightsData || !trafficLightsData.features) {
    console.warn('⚠️ No traffic lights data');
    if (loadingBar) loadingBar.style.display = 'none';
    return;
  }
  
  console.log('📊 Analyzing', trafficLightsData.features.length, 'traffic lights...');
  console.log('🗺️ Available trip layers:', tripLayers.length);
  
  trafficLightAnalysis = {};
  const totalLights = trafficLightsData.features.length;
  
  // For each traffic light
  trafficLightsData.features.forEach((light, index) => {
    const lightCoords = light.geometry.coordinates;
    const lightPoint = turf.point(lightCoords);
    // Round coordinates to 7 decimal places for consistent key matching
    const key = `${lightCoords[0].toFixed(7)},${lightCoords[1].toFixed(7)}`;
    
    let suddenBrakeCount = 0;
    let extendedStopCount = 0;
    let totalPointsChecked = 0;
    
    // Check all trips for points near this traffic light
    tripLayers.forEach(layerId => {
      try {
        const features = map.querySourceFeatures('trips', {
          sourceLayer: layerId
        });
        
        if (index === 0 && features.length > 0) {
          console.log(`   📍 Sample layer "${layerId}" has ${features.length} features`);
        }
        
        features.forEach(feature => {
          if (feature.geometry.type === 'LineString') {
            const coords = feature.geometry.coordinates;
            const props = feature.properties;
            
            // Check each point in the line
            for (let i = 0; i < coords.length; i++) {
              const point = turf.point(coords[i]);
              const distance = turf.distance(lightPoint, point, { units: 'meters' });
              
              // If within analysis radius
              if (distance <= ANALYSIS_RADIUS) {
                totalPointsChecked++;
                
                // Get speed at this point
                const speed = parseFloat(props.Speed || props.speed || 0);
                
                // Check for sudden braking (speed dropped significantly)
                if (i > 0) {
                  const prevPoint = turf.point(coords[i - 1]);
                  const prevDistance = turf.distance(lightPoint, prevPoint, { units: 'meters' });
                  
                  // If we just entered the zone and speed is low, it's a brake event
                  if (prevDistance > ANALYSIS_RADIUS && speed < 5) {
                    suddenBrakeCount++;
                  }
                }
                
                // Check for extended stop (very low speed)
                if (speed < SLOW_SPEED_THRESHOLD) {
                  extendedStopCount++;
                }
              }
            }
          }
        });
      } catch (err) {
        // Layer might not be loaded yet, skip silently
      }
    });
    
    // Calculate scores (0-100) with more aggressive weighting
    // More events = higher score (worse)
    const suddenScore = Math.min(100, suddenBrakeCount * 15); // Increased from 5 to 15
    const extendedScore = Math.min(100, (extendedStopCount / Math.max(1, totalPointsChecked)) * 200); // Increased from 100 to 200
    const overallScore = (suddenScore * 0.6 + extendedScore * 0.4);
    
    trafficLightAnalysis[key] = {
      coords: lightCoords,
      suddenBrakeCount,
      extendedStopCount,
      totalPointsChecked,
      suddenScore,
      extendedScore,
      overallScore
    };
    
    // Update progress bar
    if (loadingBar && (index + 1) % 10 === 0) {
      const progress = ((index + 1) / totalLights) * 100;
      loadingProgress.style.width = `${progress}%`;
      loadingText.textContent = `Analyzing ${index + 1}/${totalLights}`;
    }
    
    if ((index + 1) % 50 === 0) {
      console.log(`   Analyzed ${index + 1}/${trafficLightsData.features.length} traffic lights...`);
    }
  });
  
  // Complete loading bar
  if (loadingBar) {
    loadingProgress.style.width = '100%';
    loadingText.textContent = 'Complete!';
    setTimeout(() => {
      loadingBar.style.display = 'none';
    }, 1000);
  }
  
  console.log('✅ Traffic light analysis complete!');
  console.log('📈 Analysis summary:', {
    totalLights: Object.keys(trafficLightAnalysis).length,
    lightsWithData: Object.values(trafficLightAnalysis).filter(a => a.totalPointsChecked > 0).length,
    exampleLight: Object.values(trafficLightAnalysis)[0],
    sampleKeys: Object.keys(trafficLightAnalysis).slice(0, 10)
  });
}

function updateTrafficLightColors() {
  console.log('🎨 Updating traffic light colors, mode:', analysisMode);
  
  if (!map.getSource('verkeerslichten') || !trafficLightAnalysis) {
    console.warn('⚠️ Cannot update colors - missing source or analysis');
    return;
  }
  
  const trafficLightsSource = map.getSource('verkeerslichten');
  const data = trafficLightsSource._data;
  
  if (!data || !data.features) {
    console.warn('⚠️ No traffic lights data to update');
    return;
  }
  
  console.log('📊 Updating colors for', data.features.length, 'traffic lights');
  
  // Update colors based on analysis mode
  data.features.forEach(feature => {
    const coords = feature.geometry.coordinates;
    // Round coordinates to 7 decimal places to match storage key
    const key = `${coords[0].toFixed(7)},${coords[1].toFixed(7)}`;
    const analysis = trafficLightAnalysis[key];
    
    if (analysis && analysis.totalPointsChecked > 0) {
      let score;
      if (analysisMode === 'safety') {
        score = analysis.suddenScore;
      } else if (analysisMode === 'efficiency') {
        score = analysis.extendedScore;
      } else {
        score = analysis.overallScore;
      }
      
      feature.properties.analysisColor = getTrafficLightAnalysisColor(score, analysisMode);
      feature.properties.analysisScore = score;
      feature.properties.hasData = true;
    } else {
      feature.properties.analysisColor = '#FFFFFF'; // White for no data
      feature.properties.analysisScore = 0;
      feature.properties.hasData = false;
    }
  });
  
  // Update the source
  trafficLightsSource.setData(data);
  
  // Update paint property
  if (showTrafficLights) {
    map.setPaintProperty('verkeerslichten', 'circle-color', [
      'coalesce',
      ['get', 'analysisColor'],
      '#FFFFFF'
    ]);
    map.setPaintProperty('verkeerslichten', 'circle-radius', 6);
    map.setPaintProperty('verkeerslichten', 'circle-stroke-width', 2);
    map.setPaintProperty('verkeerslichten', 'circle-stroke-color', '#333333');
    console.log('✅ Traffic light colors updated (analysis mode)');
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

        // Add the layer (initially hidden)
        map.addLayer({
          id: 'verkeerslichten',
          type: 'circle',
          source: 'verkeerslichten',
          layout: {
            'visibility': 'none'
          },
          paint: {
            'circle-radius': 6,
            'circle-color': '#f4071bff',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#333333',
            'circle-opacity': 0.9
          }
        });

        console.log('✅ Traffic lights layer added with', trafficLightsData.features.length, 'points');
        
        // NOW analyze traffic light zones after data is loaded
        await analyzeTrafficLights();

        // Click handler for traffic lights
        map.on('click', 'verkeerslichten', (e) => {
          e.preventDefault();
          if (e.originalEvent) {
            e.originalEvent.stopPropagation();
          }
          
          const props = e.features[0].properties;
          const coords = e.features[0].geometry.coordinates;
          
          console.log('🚦 Clicked traffic light at:', coords);
          console.log('🚦 Traffic light properties:', props);
          
          // Get analysis data for this traffic light
          let analysisHTML = '';
          if (trafficLightAnalysis) {
            // Use the ORIGINAL coordinates from the feature, not the click location
            // Round to 7 decimals to match how we stored them
            const originalCoords = e.features[0].geometry.coordinates;
            const key = `${originalCoords[0].toFixed(7)},${originalCoords[1].toFixed(7)}`;
            
            console.log('🔍 Looking for analysis with key:', key);
            
            const analysis = trafficLightAnalysis[key];
            console.log('📊 Found analysis:', analysis);
            
            if (!analysis) {
              console.log('❌ No analysis found. Checking if key exists anywhere...');
              const similarKeys = Object.keys(trafficLightAnalysis).filter(k => {
                const [lon, lat] = k.split(',').map(Number);
                const [searchLon, searchLat] = key.split(',').map(Number);
                return Math.abs(lon - searchLon) < 0.0001 && Math.abs(lat - searchLat) < 0.0001;
              });
              console.log('🔎 Similar keys within 0.0001 degrees:', similarKeys);
              
              // Try to use closest match if available
              if (similarKeys.length > 0) {
                const closestAnalysis = trafficLightAnalysis[similarKeys[0]];
                if (closestAnalysis) {
                  console.log('✅ Using closest match:', similarKeys[0]);
                  
                  let displayScore, displayLabel;
                  if (analysisMode === 'safety') {
                    displayScore = closestAnalysis.suddenScore;
                    displayLabel = getAnalysisLabel(displayScore, 'safety');
                  } else if (analysisMode === 'efficiency') {
                    displayScore = closestAnalysis.extendedScore;
                    displayLabel = getAnalysisLabel(displayScore, 'efficiency');
                  } else {
                    displayScore = closestAnalysis.overallScore;
                    displayLabel = getAnalysisLabel(displayScore, 'overall');
                  }
                  
                  const displayColor = getTrafficLightAnalysisColor(displayScore, analysisMode);
                  
                  analysisHTML = `
                    <br><br><strong>📊 Traffic Light Analysis:</strong>
                    <br>🛑 Sudden braking events: ${closestAnalysis.suddenBrakeCount}
                    <br>⏱️ Extended stop points: ${closestAnalysis.extendedStopCount}
                    <br>📍 Total points checked: ${closestAnalysis.totalPointsChecked}
                    <br>📈 Safety score: ${closestAnalysis.suddenScore.toFixed(0)}/100
                    <br>🕐 Efficiency score: ${closestAnalysis.extendedScore.toFixed(0)}/100
                    <br>🎯 Overall score: ${closestAnalysis.overallScore.toFixed(0)}/100
                    <br><br><strong>Current View (${analysisMode}):</strong>
                    <br><span style="color: ${displayColor}; font-size: 20px;">●</span> <strong>${displayLabel}</strong> (Score: ${displayScore.toFixed(0)})
                  `;
                }
              }
            }
            
            console.log('📋 Available keys (first 5):', Object.keys(trafficLightAnalysis).slice(0, 5));
            
            if (analysis) {
              let displayScore, displayLabel;
              if (analysisMode === 'safety') {
                displayScore = analysis.suddenScore;
                displayLabel = getAnalysisLabel(displayScore, 'safety');
              } else if (analysisMode === 'efficiency') {
                displayScore = analysis.extendedScore;
                displayLabel = getAnalysisLabel(displayScore, 'efficiency');
              } else {
                displayScore = analysis.overallScore;
                displayLabel = getAnalysisLabel(displayScore, 'overall');
              }
              
              const displayColor = getTrafficLightAnalysisColor(displayScore, analysisMode);
              
              analysisHTML = `
                <br><br><strong>📊 Traffic Light Analysis:</strong>
                <br>🛑 Sudden braking events: ${analysis.suddenBrakeCount}
                <br>⏱️ Extended stop points: ${analysis.extendedStopCount}
                <br>📍 Total points checked: ${analysis.totalPointsChecked}
                <br>📈 Safety score: ${analysis.suddenScore.toFixed(0)}/100
                <br>🕐 Efficiency score: ${analysis.extendedScore.toFixed(0)}/100
                <br>🎯 Overall score: ${analysis.overallScore.toFixed(0)}/100
                <br><br><strong>Current View (${analysisMode}):</strong>
                <br><span style="color: ${displayColor}; font-size: 20px;">●</span> <strong>${displayLabel}</strong> (Score: ${displayScore.toFixed(0)})
              `;
            } else if (!analysisHTML) {
              analysisHTML = '<br><br><em>No trip data near this traffic light</em>';
            }
          } else {
            analysisHTML = '<br><br><em>Analysis not yet complete</em>';
          }
          
          new mapboxgl.Popup()
            .setLngLat(e.lngLat)
            .setHTML(`<strong>🚦 Verkeerslicht</strong><br>${props.Kruispunt || 'Geen locatie beschikbaar'}${analysisHTML}`)
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

  // Traffic lights toggle (merged with analysis)
  const trafficLightsCheckbox = document.getElementById('trafficLightsCheckbox');
  if (trafficLightsCheckbox) {
    trafficLightsCheckbox.addEventListener('change', (e) => {
      showTrafficLights = e.target.checked;
      const analysisModeGroup = document.getElementById('analysisModeGroup');
      const analysisLegend = document.getElementById('trafficLightLegend');
      
      if (showTrafficLights) {
        // Show traffic lights and analysis
        if (map.getLayer('verkeerslichten')) {
          map.setLayoutProperty('verkeerslichten', 'visibility', 'visible');
        }
        if (analysisModeGroup) analysisModeGroup.style.display = 'flex';
        if (analysisLegend) analysisLegend.style.display = 'block';
        updateTrafficLightColors();
        
        // Show info popup
        showTrafficLightInfoPopup();
        
        console.log('🚦 Traffic lights analysis ON');
      } else {
        // Hide traffic lights
        if (map.getLayer('verkeerslichten')) {
          map.setLayoutProperty('verkeerslichten', 'visibility', 'none');
        }
        if (analysisModeGroup) analysisModeGroup.style.display = 'none';
        if (analysisLegend) analysisLegend.style.display = 'none';
        console.log('🚦 Traffic lights OFF');
      }
    });
  }

  // Analysis mode radio buttons
  document.querySelectorAll('input[name="analysisMode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      analysisMode = e.target.value;
      if (showTrafficLights) {
        updateTrafficLightColors();
      }
    });
  });
}

function setupClickHandlers() {
  tripLayers.forEach(layerId => {
    map.on('click', layerId, async (e) => {
      // Don't show trip popups if traffic lights mode is active
      if (showTrafficLights) {
        return;
      }
      
      console.log('Layer clicked:', layerId);
      e.preventDefault();
      if (e.originalEvent) {
        e.originalEvent.stopPropagation();
      }
      
      if (currentPopup) {
        currentPopup.remove();
      }
      
      const props = e.features[0].properties;
      const speed = parseFloat(props.Speed || props.speed || 0);
      const roadQuality = parseInt(props.road_quality || props.roadQuality || 0);
      
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
        distanceKm = stats.distance.toFixed(2);
        avgSpeed = stats.avgSpeed.toFixed(1);
        maxSpeed = stats.maxSpeed.toFixed(1);
        durationFormatted = stats.duration;
      } else {
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
      if (!showTrafficLights) {
        map.getCanvas().style.cursor = 'pointer';
      }
    });

    map.on('mouseleave', layerId, () => {
      map.getCanvas().style.cursor = '';
    });
  });
  
  // Click anywhere on map to deselect trip
  map.on('click', (e) => {
    if (!e.defaultPrevented && selectedTrip && !showTrafficLights) {
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
window.searchTrip = searchAndHighlightTrip