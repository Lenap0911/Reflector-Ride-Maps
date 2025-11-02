# 🚴 Reflector Ride Maps

A bike sensor data visualization tool that processes GPS and wheel rotation data to display bike trips with speed-colored routes on an interactive map.

## 📊 Overview

This project takes raw CSV files from bike sensors and transforms them into:
- **Individual trip visualizations** with speed-colored segments
- **Aggregated route maps** showing average speeds across multiple trips
- **Interactive web visualization** powered by MapLibre GL JS

## 🗂️ Project Structure

```
Reflector-Ride-Maps/
├── csv_data/                       # Raw CSV files from sensors (you create this)
├── sensor_data/                    # Cleaned GeoJSON files (generated)
├── processed_sensor_data/          # Speed-calculated trips (generated)
├── trips.pmtiles                   # Compressed trip data for map
├── csv_to_geojson_converter.py     # Step 1: Convert CSVs to GeoJSON
├── combined_processor.py           # Step 2: Calculate speeds from sensor data
├── build_pmtiles.py                # Step 3: Build PMTiles for web
├── index.html                      # Main visualization page
├── app.js                          # Map logic and interactions
├── config.js                       # Configuration (uses .env)
└── styles.css                      # Styling
```

## 🚀 Quick Start

### Prerequisites

- **Python 3.x** for data processing
- **Tippecanoe** for PMTiles generation:
  ```bash
  brew install tippecanoe  # macOS
  ```

## 📋 Data Processing Workflow

### Step 1: Convert Raw CSVs to GeoJSON

Place your CSV files in a `csv_data/` folder, then run:

```bash
python csv_to_geojson_converter.py
```

**What it does:**
- Reads CSV files with GPS coordinates and sensor data
- Converts to GeoJSON format with LineString geometries
- Organizes by sensor ID (e.g., `602B3`, `604F0`)
- Extracts metadata from CSV footers
- **Output:** `sensor_data/{sensor_id}/{sensor_id}_Trip{N}_clean.geojson`

**Input CSV format:**
```csv
latitude,longitude,HH:mm:ss,SSS,marker,HRot Count,Samples,Speed
52.3644,4.9130,14:23:45,123,2,100,1000,
52.3645,4.9131,14:23:46,123,3,102,1050,234
...
Bike: Trek 820
Distance: 5.2 km
```

### Step 2: Calculate Speeds from Sensor Data

```bash
python combined_processor.py
```

**What it does:**
- Reads cleaned GeoJSON files from `sensor_data/`
- Calculates speed using **wheel rotation (HRot)** data:
  - Uses 660mm (26") wheel diameter
  - Formula: `speed = (wheel_rotations × circumference) / time`
- Creates line segments only where the wheel actually moved
- Filters out stopped periods and anomalies
- **Output:** `processed_sensor_data/{sensor_id}_Trip{N}_processed.geojson`

**Key calculations:**
- Wheel circumference: ~2.073 meters
- Sample rate: 50 Hz (0.02 seconds per sample)
- Speed cap: 50 km/h (to filter unrealistic values)

**Properties added:**
- `Speed`: km/h calculated from wheel rotation
- `hrot_diff`: Wheel rotation difference
- `time_diff_s`: Time between points
- `gps_distance_m`: GPS distance (for validation)

### Step 3: Aggregate Routes Across Trips

```bash
python aggregate_routes.py
```

**What it does:**
- Reads all processed trips
- Groups segments by road location (rounded coordinates)
- Calculates statistics per road segment:
  - Average speed
  - Min/max speeds
  - Sample count (how many trips)
  - Speed variance
- Filters out low-quality segments (stopped, large gaps)
- **Output:** `public/aggregated_routes.geojson`

**Quality filters:**
- Skip speeds < 3 km/h with GPS distance > 50m
- Skip time gaps > 5 seconds
- Require minimum 2 samples per segment

### Step 4: Build PMTiles for Web

```bash
python build_pmtiles.py
```

**What it does:**
- Uses Tippecanoe to compress processed GeoJSON into PMTiles format
- PMTiles = efficient vector tiles for web maps
- Preserves `Speed`, `marker`, and `trip_id` properties
- **Output:** `public/trips.pmtiles`

**Why PMTiles?**
- Efficient: ~90% smaller than GeoJSON
- Fast: Only loads visible tiles
- Standard: Works with MapLibre/Mapbox

## 🌐 Running the Web Visualization

Visit https://tomvanarman.github.io/Reflector-Ride-Maps/

### Features:

**Individual Trips:**
- ✅ View all trips or filter by specific trip
- 🎨 Color segments by speed (gradient or categories)
- 🖱️ Click segments to see speed details

**Aggregated Routes:**
- 📊 See average speeds across all trips
- 🔢 Filter by minimum sample count (2-20 trips)
- 📈 View speed statistics per segment

**Speed Legend:**
- 🟦 Gray: Stopped (0-2 km/h)
- 🔴 Red: Very Slow (2-5 km/h)
- 🟠 Orange: Slow (5-10 km/h)
- 🟡 Yellow: Moderate (10-15 km/h)
- 🟢 Green: Fast (15-20 km/h)
- 🟢 Dark Green: Very Fast (20-25 km/h)
- 🟢 Darkest Green: Extreme (25-30 km/h)
- 🟩 Super Fast (30+ km/h)

## 🛠️ Why We Use Each Technology

### Vite
**Purpose:** Modern development server and build tool

**Benefits:**
- ⚡ Lightning-fast hot module reloading (instant updates)
- 📦 Handles ES modules natively (no webpack config)
- 🔄 Injects `.env` variables into your code
- 🏗️ Optimized production builds
- 🎯 Simple setup, zero configuration needed

**Alternative:** You could use plain HTML + file:// protocol, but:
- ❌ No `.env` file support (token visible in code)
- ❌ No hot reloading (manual refresh needed)
- ❌ Module imports don't work
- ❌ No CORS handling for local files

### MapLibre GL JS
**Purpose:** Open-source map rendering library

**Why not Mapbox GL JS?**
- ✅ MapLibre is free and open source
- ✅ Has `addProtocol` for PMTiles (Mapbox v3 removed it)
- ✅ 100% API-compatible with Mapbox v2
- ✅ No usage limits or pricing tiers

### PMTiles
**Purpose:** Efficient vector tile format

**Benefits:**
- 📦 Single file (no tile server needed)
- 🚀 90% smaller than GeoJSON
- ⚡ Only loads visible map tiles
- 🌐 Works with static hosting (GitHub Pages, S3, etc.)

## 📁 File Explanations

### Python Scripts

- **`csv_to_geojson_converter.py`**: Converts raw sensor CSVs to GeoJSON LineStrings
- **`combined_processor.py`**: Calculates speeds from wheel rotation data (HRot)
- **`aggregate_routes.py`**: Aggregates speeds across trips to show typical speeds per road
- **`build_pmtiles.py`**: Compresses GeoJSON into PMTiles using Tippecanoe

### JavaScript/Web Files

- **`index.html`**: Main webpage with map container and controls
- **`app.js`**: Map initialization, data loading, speed coloring, click handlers
- **`config.js`**: Configuration (Mapbox token, file paths, map style)
- **`styles.css`**: UI styling for controls, legend, and stats panel

## 🔧 Configuration

### Wheel Settings (in `combined_processor.py`):

```python
WHEEL_DIAMETER_MM = 660  # 26 inch wheel
WHEEL_CIRCUMFERENCE_M = (660 / 1000) * math.pi  # ~2.073m
```

### Map Settings (in `config.js`):

```javascript
MAP_CENTER: [4.9, 52.37],  // Amsterdam area [lon, lat]
MAP_ZOOM: 11,              // Initial zoom level
MAP_STYLE: 'https://...'   // CartoDB Dark Matter style
```

### Speed Colors (in `app.js`):

Modify the `getSpeedColorExpression()` function to adjust color thresholds.

## 🐛 Troubleshooting

### "PMTiles shows all gray/red"
- Check that `Speed` property exists in your processed GeoJSON
- Verify wheel diameter is correct for your bike
- Run: `python build_pmtiles.py` to rebuild with `-y Speed` flag

### "Map is blank"
- Check browser console for errors
- Verify `.env` has correct token: `VITE_MAPBOX_TOKEN=pk.ey...`
- Restart Vite: `Ctrl+C` then `npx vite`

### "No data showing"
- Ensure `public/trips.pmtiles` exists
- Check file paths in `config.js`
- Verify trips have coordinates in Amsterdam area

### "Import errors in browser"
- Make sure scripts have `type="module"` in `index.html`
- Check that Vite is running (not just opening HTML file)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Commit changes: `git commit -am 'Add feature'`
4. Push to branch: `git push origin feature-name`
5. Submit a Pull Request

## 📄 License

ISC License - See package.json for details

## 🙏 Acknowledgments

- **MapLibre GL JS**: Open-source mapping library
- **Tippecanoe**: PMTiles generation by Mapbox
- **CartoDB**: Free basemap styles
- **Vite**: Modern build tooling

## 📧 Contact

For questions or issues, please open a GitHub issue or contact the maintainers.

---

**Happy mapping! 🚴‍♀️🗺️**
