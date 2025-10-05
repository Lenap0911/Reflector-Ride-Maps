import os
import json

# Path to your sensor_data folder
sensor_data_path = 'sensor_data'

geojson_files = []

# Walk through all sensor folders
for sensor in os.listdir(sensor_data_path):
    sensor_folder = os.path.join(sensor_data_path, sensor)
    if not os.path.isdir(sensor_folder):
        continue
    # Find all *_clean.geojson files
    for f in os.listdir(sensor_folder):
        if f.endswith('_clean.geojson'):
            geojson_files.append(f"{sensor_folder}/{f}")

# Save to a JS file
with open('geojson_files.js', 'w') as f:
    f.write("const geojsonFiles = [\n")
    for file in geojson_files:
        f.write(f"  '{file}',\n")
    f.write("];\n")

print(f"Generated geojson_files.js with {len(geojson_files)} entries.")