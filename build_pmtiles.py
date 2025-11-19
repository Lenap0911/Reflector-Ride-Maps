import os
import subprocess

DATA_ROOT = "processed_sensor_data"  # Use processed data!
PMTILES_FILE = "trips.pmtiles"

# Gather all processed GeoJSON files
geojson_files = []
for root, dirs, files in os.walk(DATA_ROOT):
    for f in files:
        if f.endswith("_processed.geojson"):
            geojson_files.append(os.path.join(root, f))

if geojson_files:
    print(f"Building PMTiles from {len(geojson_files)} trips…")
    cmd = [
        "tippecanoe",
        "-o", PMTILES_FILE,
        "-zg",
        "-pk",
        "-pC"
    ] + geojson_files

    subprocess.run(cmd, check=True)
    print(f"✅ PMTiles saved to {PMTILES_FILE}")
else:
    print("⚠️ No processed GeoJSON files found.")