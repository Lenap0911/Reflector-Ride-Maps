import csv
import json
import os
import re

INPUT_ROOT = "csv_data"       # where CSVs live
OUTPUT_ROOT = "sensor_data"   # where cleaned GeoJSONs + metadata go

def get_next_trip_number(sensor_id_folder):
    """Find the next available trip number inside a sensor_data/{sensor_id} folder."""
    if not os.path.exists(sensor_id_folder):
        return 1
    existing = [
        int(m.group(1))
        for f in os.listdir(sensor_id_folder)
        if (m := re.match(r".*_Trip(\d+)_clean\.geojson", f))
    ]
    return max(existing, default=0) + 1

def process_csv(input_path, sensor_id, trip_num):
    features = []
    coords = []
    last_lat, last_lon = None, None

    with open(input_path, newline='') as csvfile:
        reader = list(csv.DictReader(csvfile))

        for row in reader:
            lat, lon = row.get('latitude'), row.get('longitude')
            try:
                lat_f, lon_f = float(lat), float(lon)
                last_lat, last_lon = lat_f, lon_f
                coords.append((lat_f, lon_f))
            except (ValueError, TypeError):
                coords.append((last_lat, last_lon) if last_lat and last_lon else None)

        for i in range(len(reader) - 1):
            row1, row2 = reader[i], reader[i + 1]
            coord1, coord2 = coords[i], coords[i + 1]
            if coord1 and coord2:
                props = {k: v for k, v in row1.items() if k not in ['latitude', 'longitude']}
                props["trip_id"] = f"{sensor_id}_Trip{trip_num}"
                feature = {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [
                            [coord1[1], coord1[0]],
                            [coord2[1], coord2[0]]
                        ]
                    },
                    "properties": props
                }
                features.append(feature)

    metadata = {}
    with open(input_path, "r") as f:
        lines = f.readlines()

    last_gps_line = 0
    for i, line in enumerate(lines):
        parts = line.strip().split(',')
        if len(parts) >= 2:
            try:
                float(parts[0]); float(parts[1])
                last_gps_line = i
            except ValueError:
                continue

    for line in lines[last_gps_line + 1:]:
        line = line.strip()
        if not line:
            continue
        if ':' in line:
            key, val = line.split(':', 1)
            metadata[key.strip()] = val.strip()
        else:
            metadata[line] = line

    return features, metadata

def main():
    os.makedirs(OUTPUT_ROOT, exist_ok=True)

    metadata_index_file = os.path.join(OUTPUT_ROOT, "trips_metadata.json")
    if os.path.exists(metadata_index_file):
        with open(metadata_index_file, "r", encoding="utf-8") as f:
            all_metadata = json.load(f)
    else:
        all_metadata = {}

    for entry in os.listdir(INPUT_ROOT):
        entry_path = os.path.join(INPUT_ROOT, entry)

        # If it's a folder, look for CSVs inside it
        if os.path.isdir(entry_path):
            csv_files = [os.path.join(entry_path, f) for f in os.listdir(entry_path) if f.lower().endswith(".csv")]
        # If it's a CSV directly in csv_data/, process it directly
        elif entry.lower().endswith(".csv"):
            csv_files = [entry_path]
        else:
            continue

        for input_file in csv_files:
            file = os.path.basename(input_file)
            sensor_id = file[:5]

            # Create output folder per sensor ID
            sensor_output = os.path.join(OUTPUT_ROOT, sensor_id)
            os.makedirs(sensor_output, exist_ok=True)

            trip_num = get_next_trip_number(sensor_output)
            trip_id = f"{sensor_id}_Trip{trip_num}"

            features, metadata = process_csv(input_file, sensor_id, trip_num)

            geojson = {"type": "FeatureCollection", "features": features}
            out_geojson = os.path.join(sensor_output, f"{trip_id}_clean.geojson")
            with open(out_geojson, "w", encoding="utf-8") as f:
                json.dump(geojson, f, indent=2)

            all_metadata[trip_id] = {
                "source_file": file,
                "metadata": metadata
            }
            with open(metadata_index_file, "w", encoding="utf-8") as f:
                json.dump(all_metadata, f, indent=2)

            print(f"✅ {file} → {trip_id}_clean.geojson in {sensor_output}")

if __name__ == "__main__":
    main()