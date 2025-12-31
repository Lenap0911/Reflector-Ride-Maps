"""
Traffic Light Static Analysis Generator
Analyzes all trip data against traffic light locations and generates
a static JSON file with pre-computed scores for web visualization.

Usage: python generate_traffic_light_analysis.py
"""

import json
import math
from pathlib import Path
from collections import defaultdict

# ANSI color codes
class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    END = '\033[0m'
    BOLD = '\033[1m'

def print_header(text):
    print(f"\n{Colors.HEADER}{Colors.BOLD}{'=' * 70}{Colors.END}")
    print(f"{Colors.HEADER}{Colors.BOLD}{text.center(70)}{Colors.END}")
    print(f"{Colors.HEADER}{Colors.BOLD}{'=' * 70}{Colors.END}\n")

def print_success(text):
    print(f"{Colors.GREEN}✅ {text}{Colors.END}")

def print_error(text):
    print(f"{Colors.RED}❌ {text}{Colors.END}")

def print_info(text):
    print(f"{Colors.BLUE}ℹ️  {text}{Colors.END}")

def haversine_distance(lon1, lat1, lon2, lat2):
    """Calculate distance between two points in meters"""
    R = 6371000  # Earth radius in meters
    
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi/2)**2 + \
        math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    
    return R * c

def load_traffic_lights():
    """Load traffic light GeoJSON data"""
    possible_paths = [
        'traffic_lights.json',
        'verkeerslichten.geojson',
        'traffic_lights.geojson',
        'data/verkeerslichten.geojson',
        'data/traffic_lights.json'
    ]
    
    for path in possible_paths:
        if Path(path).exists():
            print_success(f"Loading traffic lights from: {path}")
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data
    
    print_error("Traffic lights file not found!")
    print_info("Looking for: traffic_lights.json, verkeerslichten.geojson, or traffic_lights.geojson")
    return None

def load_processed_trips():
    """Load all processed trip GeoJSON files"""
    trips = []
    processed_dir = Path('processed_sensor_data')
    
    if not processed_dir.exists():
        print_error(f"Directory not found: {processed_dir}")
        return []
    
    # Look for files in both root and nested sensor folders
    geojson_files = []
    
    # Pattern 1: Files directly in processed_sensor_data/
    geojson_files.extend(list(processed_dir.glob('*_processed.geojson')))
    
    # Pattern 2: Files in sensor subfolders (e.g., processed_sensor_data/602B3/*.geojson)
    geojson_files.extend(list(processed_dir.glob('*/*.geojson')))
    
    # Pattern 3: Files with _processed in sensor subfolders
    geojson_files.extend(list(processed_dir.glob('*/*_processed.geojson')))
    
    # Remove duplicates
    geojson_files = list(set(geojson_files))
    
    print_info(f"Found {len(geojson_files)} processed trip files")
    
    for file_path in geojson_files:
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                trip_data = json.load(f)
                trips.append({
                    'name': file_path.stem,
                    'data': trip_data,
                    'path': str(file_path)
                })
                print_success(f"Loaded: {file_path.relative_to(processed_dir)}")
        except Exception as e:
            print_error(f"Failed to load {file_path.name}: {e}")
    
    return trips

def analyze_traffic_light(light_coords, trips, radius=25):
    """
    Analyze cyclist behavior at a single traffic light across all trips
    Uses the EXACT same logic as app.js analyzeTrafficLights() function
    
    Args:
        light_coords: [lon, lat] of traffic light
        trips: List of trip data
        radius: Detection radius in meters (default 25m - matches app.js ANALYSIS_RADIUS)
    
    Returns:
        Dictionary with analysis results
    """
    lon, lat = light_coords
    
    sudden_brake_count = 0
    extended_stop_count = 0
    total_points_checked = 0
    
    # Speed thresholds - MATCH app.js exactly
    SLOW_SPEED_THRESHOLD = 2  # km/h - considered "stopped" (matches app.js)
    ENTRY_BRAKE_THRESHOLD = 5  # km/h - sudden brake if entering zone at this speed (matches app.js logic)
    
    # Process each trip
    for trip in trips:
        features = trip['data'].get('features', [])
        
        for feature in features:
            # Handle both LineString and Point geometries
            if feature['geometry']['type'] == 'LineString':
                coords = feature['geometry']['coordinates']
                props = feature['properties']
                
                # Check each point in the line
                for i in range(len(coords)):
                    point_lon, point_lat = coords[i][0], coords[i][1]
                    distance = haversine_distance(lon, lat, point_lon, point_lat)
                    
                    # If within analysis radius
                    if distance <= radius:
                        total_points_checked += 1
                        
                        # Get speed at this point
                        speed = props.get('Speed', props.get('speed', 0))
                        
                        # Check for sudden braking (matches app.js logic)
                        # "If we just entered the zone and speed is low, it's a brake event"
                        if i > 0:
                            prev_lon, prev_lat = coords[i-1][0], coords[i-1][1]
                            prev_distance = haversine_distance(lon, lat, prev_lon, prev_lat)
                            
                            # Previous point was outside, current is inside, and speed is low
                            if prev_distance > radius and speed < ENTRY_BRAKE_THRESHOLD:
                                sudden_brake_count += 1
                        
                        # Check for extended stop (very low speed)
                        # Matches app.js: "if (speed < SLOW_SPEED_THRESHOLD)"
                        if speed < SLOW_SPEED_THRESHOLD:
                            extended_stop_count += 1
            
            elif feature['geometry']['type'] == 'Point':
                # Handle Point features (some GeoJSON files use Points)
                point_coords = feature['geometry']['coordinates']
                point_lon, point_lat = point_coords[0], point_coords[1]
                distance = haversine_distance(lon, lat, point_lon, point_lat)
                
                if distance <= radius:
                    total_points_checked += 1
                    props = feature['properties']
                    speed = props.get('Speed', props.get('speed', 0))
                    
                    if speed < SLOW_SPEED_THRESHOLD:
                        extended_stop_count += 1
    
    # Calculate scores (0-100) - MATCH app.js scoring exactly
    # "More events = higher score (worse)"
    has_data = total_points_checked > 0
    
    if not has_data:
        return {
            'has_data': False,
            'total_points': 0,
            'sudden_brakes': 0,
            'extended_stops': 0,
            'safety_score': 0,
            'efficiency_score': 0,
            'overall_score': 0
        }
    
    # Safety score: "const suddenScore = Math.min(100, suddenBrakeCount * 15);"
    safety_score = min(100, sudden_brake_count * 15)
    
    # Efficiency score: "const extendedScore = Math.min(100, (extendedStopCount / Math.max(1, totalPointsChecked)) * 200);"
    efficiency_score = min(100, (extended_stop_count / max(1, total_points_checked)) * 200)
    
    # Overall score: "const overallScore = (suddenScore * 0.6 + extendedScore * 0.4);"
    overall_score = (safety_score * 0.6 + efficiency_score * 0.4)
    
    return {
        'has_data': True,
        'total_points': total_points_checked,
        'sudden_brakes': sudden_brake_count,
        'extended_stops': extended_stop_count,
        'safety_score': round(safety_score, 2),
        'efficiency_score': round(efficiency_score, 2),
        'overall_score': round(overall_score, 2)
    }

def generate_analysis():
    """Main function to generate traffic light analysis"""
    print_header("TRAFFIC LIGHT STATIC ANALYSIS GENERATOR")
    print_info("Using exact logic from app.js for consistency")
    
    # Load traffic lights
    traffic_lights_data = load_traffic_lights()
    if not traffic_lights_data:
        return False
    
    # Load processed trips
    trips = load_processed_trips()
    if not trips:
        print_error("No processed trip data found!")
        return False
    
    print_info(f"Analyzing {len(traffic_lights_data['features'])} traffic lights against {len(trips)} trips...")
    print_info("Using 25m radius, 5 km/h brake threshold, 2 km/h stop threshold")
    
    # Analyze each traffic light
    analyzed_features = []
    
    for i, feature in enumerate(traffic_lights_data['features'], 1):
        coords = feature['geometry']['coordinates']
        properties = feature['properties'].copy()
        
        # Analyze this traffic light
        analysis = analyze_traffic_light(coords, trips)
        
        # Add analysis results to properties (match app.js property names)
        properties.update(analysis)
        
        # Create new feature with analysis
        analyzed_feature = {
            'type': 'Feature',
            'geometry': feature['geometry'],
            'properties': properties
        }
        
        analyzed_features.append(analyzed_feature)
        
        if i % 10 == 0:
            print_info(f"Analyzed {i}/{len(traffic_lights_data['features'])} traffic lights...")
    
    # Create output GeoJSON
    output_data = {
        'type': 'FeatureCollection',
        'features': analyzed_features
    }
    
    # Save to file
    output_file = 'traffic_lights_analyzed.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)
    
    print_success(f"Analysis complete! Saved to: {output_file}")
    
    # Print statistics
    print_header("ANALYSIS SUMMARY")
    
    lights_with_data = sum(1 for f in analyzed_features if f['properties']['has_data'])
    lights_without_data = len(analyzed_features) - lights_with_data
    
    print(f"{Colors.BOLD}Traffic Lights:{Colors.END}")
    print(f"  Total: {len(analyzed_features)}")
    print(f"  With trip data: {lights_with_data}")
    print(f"  Without trip data: {lights_without_data}")
    
    if lights_with_data > 0:
        # Calculate average scores
        total_safety = sum(f['properties']['safety_score'] for f in analyzed_features if f['properties']['has_data'])
        total_efficiency = sum(f['properties']['efficiency_score'] for f in analyzed_features if f['properties']['has_data'])
        total_overall = sum(f['properties']['overall_score'] for f in analyzed_features if f['properties']['has_data'])
        
        avg_safety = total_safety / lights_with_data
        avg_efficiency = total_efficiency / lights_with_data
        avg_overall = total_overall / lights_with_data
        
        print(f"\n{Colors.BOLD}Average Scores:{Colors.END}")
        print(f"  Safety: {avg_safety:.1f}/100")
        print(f"  Efficiency: {avg_efficiency:.1f}/100")
        print(f"  Overall: {avg_overall:.1f}/100")
        
        # Find worst performers
        worst_safety = sorted([f for f in analyzed_features if f['properties']['has_data']], 
                             key=lambda x: x['properties']['safety_score'], reverse=True)[:3]
        worst_efficiency = sorted([f for f in analyzed_features if f['properties']['has_data']], 
                                 key=lambda x: x['properties']['efficiency_score'], reverse=True)[:3]
        
        print(f"\n{Colors.BOLD}Top 3 Safety Concerns (Most Sudden Braking):{Colors.END}")
        for i, light in enumerate(worst_safety, 1):
            name = light['properties'].get('Kruispunt', 'Unknown')
            score = light['properties']['safety_score']
            brakes = light['properties']['sudden_brakes']
            print(f"  {i}. {name[:40]} - Score: {score:.0f} ({brakes} sudden brakes)")
        
        print(f"\n{Colors.BOLD}Top 3 Efficiency Issues (Longest Stops):{Colors.END}")
        for i, light in enumerate(worst_efficiency, 1):
            name = light['properties'].get('Kruispunt', 'Unknown')
            score = light['properties']['efficiency_score']
            stops = light['properties']['extended_stops']
            total = light['properties']['total_points']
            pct = (stops / total * 100) if total > 0 else 0
            print(f"  {i}. {name[:40]} - Score: {score:.0f} ({stops}/{total} points = {pct:.1f}% stopped)")
    
    print(f"\n{Colors.GREEN}{Colors.BOLD}✅ Ready for web visualization!{Colors.END}")
    
    return True

def main():
    """Main entry point"""
    success = generate_analysis()
    return success

if __name__ == "__main__":
    try:
        success = main()
        exit(0 if success else 1)
    except KeyboardInterrupt:
        print(f"\n{Colors.YELLOW}Analysis cancelled by user{Colors.END}")
        exit(1)
    except Exception as e:
        print_error(f"Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        exit(1)