#!/usr/bin/env python3
"""
Road Quality Data Processor
Extracts acceleration data from trip GeoJSON files, calculates road quality,
and adds it back to the GeoJSON properties for visualization.

Road Quality Scale (from Alex's calculator):
1 = Perfect road surface (top 5%)
2 = Just a normal road (5-30%)
3 = "Outdated" road (30-55%)
4 = Pretty bad road (55-75%)
5 = No road at all (worst 25%)
"""

import os
import json
import numpy as np
from pathlib import Path
from typing import Dict, List, Tuple
import sys

# Import the road quality calculator
try:
    from road_quality_calculator import calculate_road_quality
except ImportError:
    print("❌ Error: road_quality_calculator.py not found in the same directory")
    print("   Please place the road quality calculator script in the same folder.")
    sys.exit(1)


def extract_acceleration_data(geojson_path: str) -> Tuple[np.ndarray, List[int]]:
    """
    Extract Y-axis acceleration data from a GeoJSON file.
    
    Returns:
        Tuple of (acceleration_array, feature_indices)
        - acceleration_array: numpy array of acc_y values in g-forces
        - feature_indices: list of feature indices that had valid acc_y data
    """
    with open(geojson_path, 'r') as f:
        data = json.load(f)
    
    acc_y_values = []
    feature_indices = []
    
    for idx, feature in enumerate(data['features']):
        acc_y = feature['properties'].get('Acc Y (g)', '')
        
        # Skip empty values
        if acc_y and acc_y != '':
            try:
                acc_y_values.append(float(acc_y))
                feature_indices.append(idx)
            except ValueError:
                continue
    
    return np.array(acc_y_values), feature_indices


def map_road_quality_to_features(
    geojson_data: dict,
    road_quality_results: Dict[str, np.ndarray],
    feature_indices: List[int]
) -> dict:
    """
    Map calculated road quality scores back to GeoJSON features.
    
    Uses the time_windows to match quality scores to the original features.
    Each feature gets the quality score from its nearest window center.
    """
    road_quality_scores = road_quality_results['road_quality']
    time_windows = road_quality_results['time_windows']
    
    # Create a mapping from sample index to road quality score
    quality_map = {}
    for i, window_center in enumerate(time_windows):
        quality_map[int(window_center)] = int(road_quality_scores[i])
    
    # Add road quality to each feature
    for idx, feature in enumerate(geojson_data['features']):
        if idx in feature_indices:
            # Find the closest window center
            data_idx = feature_indices.index(idx)
            
            # Find nearest quality score
            if quality_map:
                closest_window = min(quality_map.keys(), 
                                    key=lambda x: abs(x - data_idx))
                road_quality = quality_map[closest_window]
            else:
                road_quality = 0
            
            # Add to properties
            feature['properties']['road_quality'] = road_quality
        else:
            # No acceleration data, mark as unknown
            feature['properties']['road_quality'] = 0
    
    return geojson_data


def process_trip_file(
    input_path: str,
    output_path: str,
    window_size: int = 100,
    overlap: float = 0.5
) -> Dict:
    """
    Process a single trip GeoJSON file:
    1. Extract acceleration data
    2. Calculate road quality using Alex's algorithm
    3. Add quality scores to features
    4. Save enhanced GeoJSON
    
    Returns statistics about the processing.
    """
    print(f"Processing: {input_path}")
    
    # Extract acceleration data
    acc_y_data, feature_indices = extract_acceleration_data(input_path)
    
    if len(acc_y_data) == 0:
        print(f"  ⚠️  No acceleration data found")
        return {
            'status': 'no_data',
            'samples': 0,
            'quality_windows': 0
        }
    
    if len(acc_y_data) < window_size:
        print(f"  ⚠️  Not enough samples ({len(acc_y_data)} < {window_size})")
        return {
            'status': 'insufficient_data',
            'samples': len(acc_y_data),
            'quality_windows': 0
        }
    
    print(f"  📊 Extracted {len(acc_y_data)} acceleration samples")
    
    # Calculate road quality using Alex's algorithm
    try:
        quality_results = calculate_road_quality(
            acc_y_data,
            window_size=window_size,
            overlap=overlap
        )
        
        num_windows = len(quality_results['road_quality'])
        print(f"  ✅ Calculated {num_windows} road quality windows")
        
        # Distribution of quality scores
        unique, counts = np.unique(quality_results['road_quality'], return_counts=True)
        dist = dict(zip([int(x) for x in unique], [int(c) for c in counts]))
        
        # Show distribution with descriptions
        quality_labels = {
            1: "Perfect",
            2: "Normal",
            3: "Outdated",
            4: "Bad",
            5: "No road"
        }
        print(f"  📈 Quality distribution:")
        for quality in sorted(dist.keys()):
            label = quality_labels.get(quality, "Unknown")
            print(f"     {quality} ({label}): {dist[quality]} windows")
        
    except Exception as e:
        print(f"  ❌ Error calculating quality: {e}")
        return {
            'status': 'calculation_error',
            'error': str(e),
            'samples': len(acc_y_data)
        }
    
    # Load original GeoJSON and add quality data
    with open(input_path, 'r') as f:
        geojson_data = json.load(f)
    
    enhanced_geojson = map_road_quality_to_features(
        geojson_data,
        quality_results,
        feature_indices
    )
    
    # Save enhanced GeoJSON
    with open(output_path, 'w') as f:
        json.dump(enhanced_geojson, f)
    
    print(f"  💾 Saved to: {output_path}")
    
    return {
        'status': 'success',
        'samples': len(acc_y_data),
        'quality_windows': num_windows,
        'distribution': dist,
        'input_path': input_path,
        'output_path': output_path
    }


def process_all_trips(
    sensor_data_root: str = "sensor_data",
    output_root: str = "processed_sensor_data",
    window_size: int = 100,
    overlap: float = 0.5
):
    """
    Process all trip GeoJSON files in the sensor_data directory structure.
    Maintains the folder hierarchy: sensor_data/SENSOR_ID/trip_files.geojson
    """
    sensor_data_path = Path(sensor_data_root)
    output_path = Path(output_root)
    
    if not sensor_data_path.exists():
        print(f"❌ Error: {sensor_data_root} directory not found")
        print(f"   Current directory: {os.getcwd()}")
        return
    
    # Create output directory
    output_path.mkdir(exist_ok=True)
    
    # Find all GeoJSON files
    geojson_files = list(sensor_data_path.rglob("*.geojson"))
    
    if not geojson_files:
        print(f"⚠️  No GeoJSON files found in {sensor_data_root}")
        return
    
    print(f"🚴 Road Quality Processor")
    print(f"🚀 Found {len(geojson_files)} GeoJSON files to process\n")
    
    # Process statistics
    stats = {
        'total': len(geojson_files),
        'success': 0,
        'no_data': 0,
        'insufficient_data': 0,
        'errors': 0
    }
    
    results = []
    
    for geojson_file in geojson_files:
        # Maintain directory structure
        rel_path = geojson_file.relative_to(sensor_data_path)
        
        # Create output filename with _processed suffix
        output_file = output_path / rel_path.parent / f"{rel_path.stem}_processed.geojson"
        output_file.parent.mkdir(parents=True, exist_ok=True)
        
        # Process the file
        result = process_trip_file(
            str(geojson_file),
            str(output_file),
            window_size=window_size,
            overlap=overlap
        )
        
        results.append(result)
        
        # Update statistics
        if result['status'] == 'success':
            stats['success'] += 1
        elif result['status'] == 'no_data':
            stats['no_data'] += 1
        elif result['status'] == 'insufficient_data':
            stats['insufficient_data'] += 1
        else:
            stats['errors'] += 1
        
        print()  # Blank line between files
    
    # Print summary
    print("=" * 60)
    print("PROCESSING COMPLETE")
    print("=" * 60)
    print(f"Total files: {stats['total']}")
    print(f"✅ Successfully processed: {stats['success']}")
    print(f"⚠️  No acceleration data: {stats['no_data']}")
    print(f"⚠️  Insufficient samples: {stats['insufficient_data']}")
    print(f"❌ Errors: {stats['errors']}")
    print(f"\nProcessed files saved to: {output_root}/")
    
    # Save processing log
    log_file = output_path / "processing_log.json"
    with open(log_file, 'w') as f:
        json.dump({
            'statistics': stats,
            'results': results,
            'parameters': {
                'window_size': window_size,
                'overlap': overlap
            }
        }, f, indent=2)
    
    print(f"📋 Processing log saved to: {log_file}")
    print(f"\n💡 Next steps:")
    print(f"   1. Run the PMTiles builder script to include processed files")
    print(f"   2. Update the web app to display road quality layer")


if __name__ == "__main__":
    # Configuration
    SENSOR_DATA_ROOT = "sensor_data"
    OUTPUT_ROOT = "processed_sensor_data"
    WINDOW_SIZE = 100  # Samples per window (at 50 Hz = 2 seconds)
    OVERLAP = 0.5      # 50% overlap between windows
    
    # Run processing
    process_all_trips(
        sensor_data_root=SENSOR_DATA_ROOT,
        output_root=OUTPUT_ROOT,
        window_size=WINDOW_SIZE,
        overlap=OVERLAP
    )