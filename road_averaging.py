import json
import glob
from collections import defaultdict
import math
from pathlib import Path

def haversine_distance(lon1, lat1, lon2, lat2):
    """Calculate distance between two points in meters"""
    R = 6371000  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    
    a = math.sin(dphi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    
    return R * c

def snap_to_grid(lon, lat, grid_size=0.0001):
    """Snap coordinates to a grid to group nearby points"""
    return (round(lon / grid_size) * grid_size, 
            round(lat / grid_size) * grid_size)

def create_segment_key(coord1, coord2):
    """Create a unique key for a road segment (order-independent)"""
    snapped1 = snap_to_grid(coord1[0], coord1[1])
    snapped2 = snap_to_grid(coord2[0], coord2[1])
    
    # Sort to make it direction-independent
    if snapped1 < snapped2:
        return (snapped1, snapped2)
    return (snapped2, snapped1)

def process_trip_files(input_pattern="processed_sensor_data/**/*_processed.geojson"):
    """Process all trip files and aggregate road segment data"""
    
    # Dictionary to store aggregated data per segment
    # Key: (snapped_coord1, snapped_coord2)
    # Value: list of {speed, quality, count}
    segments = defaultdict(lambda: {
        'speeds': [],
        'qualities': [],
        'coords': [],
        'trip_count': 0,
        'trips': set()
    })
    
    files = glob.glob(input_pattern, recursive=True)
    print(f"Found {len(files)} trip files to process")
    
    if len(files) == 0:
        print("\n❌ No files found!")
        print("Looking for pattern:", input_pattern)
        print("Current directory:", Path.cwd())
        print("\nTrying alternative patterns...")
        
        # Try different patterns
        alternatives = [
            "**/*_processed.geojson",
            "*/*_processed.geojson",
            "*/processed_sensor_data/**/*_processed.geojson",
            "**/*_clean_processed.json",
            "*_processed.geojson"
        ]
        
        for alt in alternatives:
            files = glob.glob(alt, recursive=True)
            if files:
                print(f"✅ Found {len(files)} files with pattern: {alt}")
                break
        
        if not files:
            print("\n❌ Still no files found. Please check your directory structure.")
            return None
    
    for file_path in files:
        trip_id = Path(file_path).stem
        print(f"Processing {trip_id}...")
        
        try:
            with open(file_path, 'r') as f:
                data = json.load(f)
            
            features = data.get('features', [])
            
            for feature in features:
                if feature['geometry']['type'] != 'LineString':
                    continue
                    
                coords = feature['geometry']['coordinates']
                props = feature['properties']
                
                speed = props.get('Speed', props.get('speed', 0))
                quality = props.get('road_quality', 0)
                
                # Process each line segment
                for i in range(len(coords) - 1):
                    coord1 = coords[i]
                    coord2 = coords[i + 1]
                    
                    # Create segment key
                    segment_key = create_segment_key(coord1, coord2)
                    
                    # Add data to this segment
                    segments[segment_key]['speeds'].append(float(speed))
                    if quality > 0:  # Only include if quality is known
                        segments[segment_key]['qualities'].append(int(quality))
                    segments[segment_key]['coords'].append((coord1, coord2))
                    segments[segment_key]['trips'].add(trip_id)
                    
        except Exception as e:
            print(f"Error processing {file_path}: {e}")
    
    print(f"\nFound {len(segments)} unique road segments")
    
    # Calculate averages and create output GeoJSON
    features = []
    
    for segment_key, data in segments.items():
        if len(data['speeds']) < 2:  # Skip segments with less than 2 observations
            continue
        
        # Calculate statistics
        avg_speed = sum(data['speeds']) / len(data['speeds'])
        min_speed = min(data['speeds'])
        max_speed = max(data['speeds'])
        
        avg_quality = sum(data['qualities']) / len(data['qualities']) if data['qualities'] else 0
        
        # Get representative coordinates (use first occurrence)
        coord1, coord2 = data['coords'][0]
        
        # Calculate distance
        distance = haversine_distance(coord1[0], coord1[1], coord2[0], coord2[1])
        
        # Calculate composite score (lower is better)
        # Speed score: normalize to 0-100 (slower = worse)
        speed_score = max(0, 100 - (avg_speed * 4))  # 25 km/h = 0, 0 km/h = 100
        
        # Quality score: already 1-5, convert to 0-100
        quality_score = (avg_quality - 1) * 25 if avg_quality > 0 else 50
        
        # Weighted composite (60% quality, 40% speed)
        composite_score = (quality_score * 0.6) + (speed_score * 0.4)
        
        feature = {
            'type': 'Feature',
            'geometry': {
                'type': 'LineString',
                'coordinates': [coord1, coord2]
            },
            'properties': {
                'avg_speed': round(avg_speed, 2),
                'min_speed': round(min_speed, 2),
                'max_speed': round(max_speed, 2),
                'speed_variance': round(max_speed - min_speed, 2),
                'avg_quality': round(avg_quality, 2) if avg_quality > 0 else None,
                'observation_count': len(data['speeds']),
                'trip_count': len(data['trips']),
                'distance_m': round(distance, 2),
                'composite_score': round(composite_score, 2),
                'trips': list(data['trips'])
            }
        }
        
        features.append(feature)
    
    print(f"Created {len(features)} averaged road segments")
    
    if len(features) == 0:
        print("\n❌ No segments created. This could mean:")
        print("  - Files don't contain valid LineString geometries")
        print("  - No segments had 2+ observations")
        print("  - Speed/quality data is missing")
        return None
    
    # Create output GeoJSON
    output = {
        'type': 'FeatureCollection',
        'features': features
    }
    
    # Save to file
    output_file = 'road_segments_averaged.json'
    with open(output_file, 'w') as f:
        json.dump(output, f)
    
    print(f"\n✅ Saved averaged segments to {output_file}")
    
    # Print statistics
    all_speeds = [f['properties']['avg_speed'] for f in features]
    all_qualities = [f['properties']['avg_quality'] for f in features if f['properties']['avg_quality']]
    all_composites = [f['properties']['composite_score'] for f in features]
    
    if all_speeds:
        print(f"\nStatistics:")
        print(f"  Speed range: {min(all_speeds):.1f} - {max(all_speeds):.1f} km/h")
        print(f"  Avg speed across all segments: {sum(all_speeds)/len(all_speeds):.1f} km/h")
        if all_qualities:
            print(f"  Quality range: {min(all_qualities):.1f} - {max(all_qualities):.1f}")
            print(f"  Avg quality: {sum(all_qualities)/len(all_qualities):.1f}")
        print(f"  Composite score range: {min(all_composites):.1f} - {max(all_composites):.1f}")
    
    return output

if __name__ == "__main__":
    # Process all trip files
    result = process_trip_files()
    
    if result:
        print("\n🎉 Processing complete!")
        print("You can now load 'road_segments_averaged.json' in your map application")
    else:
        print("\n❌ Processing failed. Please check the error messages above.")