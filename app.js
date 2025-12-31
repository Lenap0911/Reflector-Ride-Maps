// app.js 
import { CONFIG } from './config.js';

console.log('🚀 Starting bike visualization...');

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
let showTrafficLights = false;
let analysisMode = 'safety'; // 'safety', 'efficiency', 'overall'

// Default orange color for routes
const DEFAULT_COLOR = '#FF6600';

// Show info popup about traffic light analysis
function showTrafficLightInfoPopup() {
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
  
  const popup = document.createElement('div');
  popup.style.cssText = `
    background: white;
    padding: 30px;
    border-radius: 8px;
    max-width: 500px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  `;
  
  popup.innerHTML = `
    <h3 style="margin-top: 0; color: #333;">Traffic Light Analysis</h3>
    <p style="color: #666; line-height: 1.6;">
      This layer shows a pre-computed analysis of cyclist behavior at traffic lights.
    </p>
    <div style="margin: 20px 0;">
      <h4 style="color: #FF6600; margin-bottom: 10px;">Sudden Braking</h4>
      <p style="color: #666; margin: 0; line-height: 1.6;">
        Detected when a cyclist enters a 25m zone around a traffic light and their speed 
        is below 5 km/h at the first point inside the zone, indicating sudden braking.
      </p>
    </div>
    <div style="margin: 20px 0;">
      <h4 style="color: #FF6600; margin-bottom: 10px;">Extended Stops</h4>
      <p style="color: #666; margin: 0; line-height: 1.6;">
        Measured by counting data points within the zone where speed is below 2 km/h. 
        The score reflects the percentage of time spent stopped or nearly stopped.
      </p>
    </div>
    <button id="closeTrafficInfoBtn" style="
      width: 100%;
      padding: 12px;
      background: #FF6600;
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
  
  document.getElementById('closeTrafficInfoBtn').addEventListener('click', () => {
    overlay.remove();
  });
  
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

// Traffic light analysis color based on pre-computed scores
function getTrafficLightColorExpression(mode) {
  const scoreKey =
    mode === 'safety' ? 'safety_score' :
    mode === 'efficiency' ? 'efficiency_score' :
    'overall_score';

  return [
    'case',
    ['==', ['get', 'has_data'], false], '#FFFFFF',
    [
      'step',
      ['to-number', ['get', scoreKey]],
      '#16A34A',   // < 10
      10, '#22C55E',
      20, '#4ADE80',
      30, '#84CC16',
      40, '#FDE047',
      50, '#FACC15',
      60, '#FB923C',
      70, '#F97316',
      80, '#DC2626'
    ]
  ];
}

function getAnalysisLabel(score) {
  if (score < 10) return 'Excellent+';
  if (score < 20) return 'Excellent';
  if (score < 30) return 'Good+';
  if (score < 40) return 'Good';
  if (score < 50) return 'Moderate+';
  if (score < 60) return 'Moderate';
  if (score < 70) return 'Poor+';
  if (score < 80) return 'Poor';
  return 'Critical';
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
  
  for (const variant of variations) {
    if (tripsMetadata[variant]) {
      tripData = tripsMetadata[variant];
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
  
  const matchingTrip = tripLayers.find(layerId => 
    layerId.toLowerCase().includes(normalizedSearch)
  );
  
  if (matchingTrip) {
    console.log('🎯 Found trip:', matchingTrip);
    
    selectedTrip = matchingTrip;
    tripLayers.forEach(id => {
      try {
        if (id === matchingTrip) {
          map.setPaintProperty(id, 'line-opacity', 1.0);
          map.setPaintProperty(id, 'line-width', 5);
          map.setPaintProperty(id, 'line-color', '#FF00FF');
        } else {
          map.setPaintProperty(id, 'line-opacity', 0.15);
          map.setPaintProperty(id, 'line-width', 2);
        }
      } catch (err) {
        console.error('Error updating layer:', id, err);
      }
    });
    
    showSelection(matchingTrip);
    
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

function updateTrafficLightColors() {
  console.log('🎨 Updating traffic light colors, mode:', analysisMode);
  
  if (!map.getLayer('verkeerslichten')) {
    console.warn('⚠️ Traffic lights layer not found');
    return;
  }
  
  map.setPaintProperty('verkeerslichten', 'circle-color', getTrafficLightColorExpression(analysisMode));
  console.log('✅ Traffic light colors updated');
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
    
    // Load pre-computed traffic light analysis
    console.log('📡 Loading traffic light analysis...');
    
    try {
      const possiblePaths = [
        './traffic_lights_analyzed.json',
        'traffic_lights_analyzed.json',
        '/traffic_lights_analyzed.json',
        `${CONFIG.DATA_URL}/traffic_lights_analyzed.json`
      ];
      
      let trafficLightsData = null;
      
      for (const path of possiblePaths) {
        try {
          console.log('🔍 Trying to load from:', path);
          const response = await fetch(path);
          if (response.ok) {
            trafficLightsData = await response.json();
            console.log('✅ Loaded analyzed traffic lights from', path);
            console.log(`📍 Found ${trafficLightsData.features.length} traffic lights with analysis`);
            break;
          }
        } catch (err) {
          console.log('❌ Failed to load from', path, err.message);
        }
      }
      
      if (!trafficLightsData) {
        console.error('❌ Could not load traffic light analysis');
      } else {
        map.addSource('verkeerslichten', {
          type: 'geojson',
          data: trafficLightsData
        });

        map.addLayer({
          id: 'verkeerslichten',
          type: 'circle',
          source: 'verkeerslichten',
          layout: {
            'visibility': 'none'
          },
          paint: {
            'circle-radius': 6,
            'circle-color': getTrafficLightColorExpression('safety'),
            'circle-stroke-width': 2,
            'circle-stroke-color': '#333333',
            'circle-opacity': 0.9
          }
        });

        console.log('✅ Traffic lights layer added');

        // Click handler for traffic lights
        map.on('click', 'verkeerslichten', (e) => {
          e.preventDefault();
          if (e.originalEvent) {
            e.originalEvent.stopPropagation();
          }
          
          const props = e.features[0].properties;
          const coords = e.features[0].geometry.coordinates;
          
          console.log('🚦 Clicked traffic light:', props);
          
          let analysisHTML = '';
          
          if (props.has_data === 'true' || props.has_data === true) {
            const safetyScore = parseFloat(props.safety_score || 0);
            const efficiencyScore = parseFloat(props.efficiency_score || 0);
            const overallScore = parseFloat(props.overall_score || 0);
            const suddenBrakes = parseInt(props.sudden_brakes || 0);
            const extendedStops = parseInt(props.extended_stops || 0);
            const totalPoints = parseInt(props.total_points || 0);
            
            let displayScore = analysisMode === 'safety' ? safetyScore : 
                               analysisMode === 'efficiency' ? efficiencyScore : 
                               overallScore;
            
            const displayLabel = getAnalysisLabel(displayScore);
            const displayColor = displayScore < 20 ? '#22C55E' :
                                displayScore < 40 ? '#84CC16' :
                                displayScore < 60 ? '#FACC15' :
                                displayScore < 80 ? '#F97316' : '#DC2626';
            
            analysisHTML = `
              <br><br><strong>📊 Traffic Light Analysis:</strong>
              <br>🛑 Sudden braking events: ${suddenBrakes}
              <br>⏱️ Extended stop points: ${extendedStops}
              <br>📍 Total points checked: ${totalPoints}
              <br>📈 Safety score: ${safetyScore.toFixed(0)}/100
              <br>🕐 Efficiency score: ${efficiencyScore.toFixed(0)}/100
              <br>🎯 Overall score: ${overallScore.toFixed(0)}/100
              <br><br><strong>Current View (${analysisMode}):</strong>
              <br><span style="color: ${displayColor}; font-size: 20px;">●</span> <strong>${displayLabel}</strong> (Score: ${displayScore.toFixed(0)})
            `;
          } else {
            analysisHTML = '<br><br><em>No trip data near this traffic light</em>';
          }
          
          new mapboxgl.Popup()
            .setLngLat(e.lngLat)
            .setHTML(`<strong>🚦 Verkeerslicht</strong><br>${props.Kruispunt || 'Geen locatie beschikbaar'}${analysisHTML}`)
            .addTo(map);
        });

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

  const trafficLightsCheckbox = document.getElementById('trafficLightsCheckbox');
  if (trafficLightsCheckbox) {
    trafficLightsCheckbox.addEventListener('change', (e) => {
      showTrafficLights = e.target.checked;
      const analysisModeGroup = document.getElementById('analysisModeGroup');
      const analysisLegend = document.getElementById('trafficLightLegend');
      
      if (showTrafficLights) {
        if (map.getLayer('verkeerslichten')) {
          map.setLayoutProperty('verkeerslichten', 'visibility', 'visible');
        }
        if (analysisModeGroup) analysisModeGroup.style.display = 'flex';
        if (analysisLegend) analysisLegend.style.display = 'block';
        updateTrafficLightColors();
        
        showTrafficLightInfoPopup();
        
        console.log('🚦 Traffic lights analysis ON');
      } else {
        if (map.getLayer('verkeerslichten')) {
          map.setLayoutProperty('verkeerslichten', 'visibility', 'none');
        }
        if (analysisModeGroup) analysisModeGroup.style.display = 'none';
        if (analysisLegend) analysisLegend.style.display = 'none';
        console.log('🚦 Traffic lights OFF');
      }
    });
  }

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