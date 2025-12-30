#!/usr/bin/env python3
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
    
    Args:
        light_coords: [lon, lat] of traffic light
        trips: List of trip data
        radius: Detection radius in meters (default 25m)
    
    Returns:
        Dictionary with analysis results
    """
    lon, lat = light_coords
    
    total_points = 0
    sudden_brakes = 0
    extended_stop_points = 0
    
    # Speed thresholds
    BRAKE_THRESHOLD = 5.0  # km/h - below this at entry = sudden brake
    STOP_THRESHOLD = 2.0   # km/h - below this = stopped
    
    for trip in trips:
        features = trip['data'].get('features', [])
        
        points_in_zone = []
        
        # Find all points within radius
        for feature in features:
            if feature['geometry']['type'] != 'Point':
                continue
            
            point_coords = feature['geometry']['coordinates']
            point_lon, point_lat = point_coords[0], point_coords[1]
            
            distance = haversine_distance(lon, lat, point_lon, point_lat)
            
            if distance <= radius:
                speed = feature['properties'].get('Speed', 0)
                points_in_zone.append({
                    'speed': speed,
                    'distance': distance,
                    'coords': point_coords
                })
        
        if not points_in_zone:
            continue
        
        # Sort by distance to get entry point
        points_in_zone.sort(key=lambda p: p['distance'])
        
        total_points += len(points_in_zone)
        
        # Check for sudden braking (first point is very slow)
        if points_in_zone[0]['speed'] < BRAKE_THRESHOLD:
            sudden_brakes += 1
        
        # Count extended stops (points with very low speed)
        for point in points_in_zone:
            if point['speed'] < STOP_THRESHOLD:
                extended_stop_points += 1
    
    # Calculate scores (0-100, where 0 is best)
    has_data = total_points > 0
    
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
    
    # Safety score: based on sudden braking events
    # Normalize by number of trip passes
    trip_passes = sudden_brakes + max(1, total_points // 10)  # Estimate passes
    safety_score = min(100, (sudden_brakes / trip_passes) * 100)
    
    # Efficiency score: based on time spent stopped
    efficiency_score = min(100, (extended_stop_points / total_points) * 100)
    
    # Overall score: weighted average (60% safety, 40% efficiency)
    overall_score = (safety_score * 0.6) + (efficiency_score * 0.4)
    
    return {
        'has_data': True,
        'total_points': total_points,
        'sudden_brakes': sudden_brakes,
        'extended_stops': extended_stop_points,
        'safety_score': round(safety_score, 2),
        'efficiency_score': round(efficiency_score, 2),
        'overall_score': round(overall_score, 2)
    }

def generate_analysis():
    """Main function to generate traffic light analysis"""
    print_header("TRAFFIC LIGHT STATIC ANALYSIS GENERATOR")
    
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
    
    # Analyze each traffic light
    analyzed_features = []
    
    for i, feature in enumerate(traffic_lights_data['features'], 1):
        coords = feature['geometry']['coordinates']
        properties = feature['properties'].copy()
        
        # Analyze this traffic light
        analysis = analyze_traffic_light(coords, trips)
        
        # Add analysis results to properties
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
        
        print(f"\n{Colors.BOLD}Top 3 Safety Concerns:{Colors.END}")
        for i, light in enumerate(worst_safety, 1):
            name = light['properties'].get('Kruispunt', 'Unknown')
            score = light['properties']['safety_score']
            brakes = light['properties']['sudden_brakes']
            print(f"  {i}. {name[:40]} - Score: {score:.0f} ({brakes} sudden brakes)")
        
        print(f"\n{Colors.BOLD}Top 3 Efficiency Issues:{Colors.END}")
        for i, light in enumerate(worst_efficiency, 1):
            name = light['properties'].get('Kruispunt', 'Unknown')
            score = light['properties']['efficiency_score']
            stops = light['properties']['extended_stops']
            print(f"  {i}. {name[:40]} - Score: {score:.0f} ({stops} stop points)")
    
    print(f"\n{Colors.GREEN}{Colors.BOLD}✅ Ready for web visualization!{Colors.END}")
    print(f"\n{Colors.CYAN}Next steps:{Colors.END}")
    print(f"  1. The file '{output_file}' is ready to use")
    print(f"  2. Your map will load it automatically")
    print(f"  3. Enable 'Traffic Light Analysis' in the web interface")
    
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