import json
from pathlib import Path

def is_coordinate_data(key):
    """Check if a key represents coordinate/sensor data that should be removed"""
    if not isinstance(key, str):
        return False
    
    # Pattern 1: Starts with ",," and has digits in first 15 chars
    if key.startswith(",,") and any(c.isdigit() for c in key[:15]):
        return True
    
    # Pattern 2: Very long key (>50 chars) with lots of commas
    if len(key) > 50 and key.count(",") > 5:
        return True
    
    # Pattern 3: Contains pattern like ",,N," where N is a digit
    for digit in "0123456789":
        if f",,{digit}," in key:
            return True
    
    return False

def is_metadata_field(key):
    """Check if a key is a valid metadata field"""
    metadata_fields = {
        "source_file",
        "Charge(start | stop)",
        "WheelDiam",
        "Frequency",
        "Trip stop code",
        "BLE Device Information Service",
        "Hardware",
        "Firmware",
        "SystemID",
        "App version",
        "Sensor's connection",
        "Trip start/end",
        ",Duration,Stops,Dist km,AVG km/h,AVGWOS km/h,MAX km/h,MAX- m/s²,MAX+ m/s²,Falls,Bamps,Elevation m",
        "SENSOR",
        "GNSS"
    }
    return key in metadata_fields

def flatten_trip_structure(trip_data):
    """
    Flatten trip data to simple structure:
    {
        "source_file": "...",
        "Charge(start | stop)": "...",
        ...
    }
    """
    flattened = {}
    
    # If nested structure (has source_file and metadata keys)
    if "source_file" in trip_data and "metadata" in trip_data:
        # Add source_file
        flattened["source_file"] = trip_data["source_file"]
        
        # Flatten metadata into main level
        for key, value in trip_data["metadata"].items():
            if is_metadata_field(key) and not is_coordinate_data(key):
                flattened[key] = value
    else:
        # Already flat, just clean it
        for key, value in trip_data.items():
            if is_metadata_field(key) and not is_coordinate_data(key):
                flattened[key] = value
    
    return flattened

def clean_and_flatten_metadata(input_file="trips_metadata.json", output_file="trips_metadata_clean.json"):
    """Clean and flatten metadata file structure"""
    
    print(f"🧹 Cleaning and flattening metadata file: {input_file}")
    
    # Load the metadata
    with open(input_file, 'r') as f:
        metadata = json.load(f)
    
    print(f"   Found {len(metadata)} trips")
    
    # Process each trip
    cleaned_metadata = {}
    stats = {
        "nested_flattened": 0,
        "already_flat": 0,
        "coordinate_fields_removed": 0
    }
    
    for trip_id, trip_data in metadata.items():
        # Check original structure
        has_nested = "source_file" in trip_data and "metadata" in trip_data
        
        # Count keys before
        if has_nested:
            keys_before = len(trip_data.get("metadata", {}))
        else:
            keys_before = len(trip_data)
        
        # Flatten
        flattened_trip = flatten_trip_structure(trip_data)
        
        # Count keys after
        keys_after = len(flattened_trip)
        
        cleaned_metadata[trip_id] = flattened_trip
        
        # Update stats
        removed = keys_before - keys_after
        if removed > 0:
            stats["coordinate_fields_removed"] += removed
        
        if has_nested:
            stats["nested_flattened"] += 1
            print(f"   ✓ {trip_id}: flattened nested structure")
        else:
            stats["already_flat"] += 1
    
    # Save cleaned metadata
    with open(output_file, 'w') as f:
        json.dump(cleaned_metadata, f, indent=2)
    
    print(f"\n✅ Processing complete!")
    print(f"   Nested → flattened: {stats['nested_flattened']}")
    print(f"   Already flat: {stats['already_flat']}")
    print(f"   Coordinate fields removed: {stats['coordinate_fields_removed']}")
    print(f"   Saved to: {output_file}")
    
    # Show sample
    if cleaned_metadata:
        sample_trip_id = next(iter(cleaned_metadata.keys()))
        sample_trip = cleaned_metadata[sample_trip_id]
        print(f"\n📋 Sample trip structure ({sample_trip_id}):")
        for key in list(sample_trip.keys())[:5]:
            print(f"   {key}: {sample_trip[key]}")
        if len(sample_trip) > 5:
            print(f"   ... and {len(sample_trip) - 5} more fields")
    
    print(f"\n💡 Review '{output_file}' - if good, replace '{input_file}'")

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) >= 2:
        input_file = sys.argv[1]
    else:
        input_file = "trips_metadata.json"
    
    if len(sys.argv) >= 3:
        output_file = sys.argv[2]
    else:
        output_file = "trips_metadata_clean.json"
    
    # Check if input file exists
    if not Path(input_file).exists():
        print(f"❌ File not found: {input_file}")
        print(f"   Please make sure the metadata file exists in the current directory")
    else:
        clean_and_flatten_metadata(input_file, output_file)