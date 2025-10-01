import folium
import glob
import json

# Create a black basemap centered on Amsterdam (adjust if needed)
m = folium.Map(location=[52.35, 4.91], zoom_start=15, tiles=None)
folium.TileLayer('CartoDB dark_matter').add_to(m)

# Loop through all GeoJSON files
for file in glob.glob("*.geojson"):  # change path if needed
    with open(file, "r") as f:
        data = json.load(f)
        folium.GeoJson(
            data,
            style_function=lambda feature: {
                "color": "red",   # line color
                "weight": 2,
                "opacity": 0.8,
            }
        ).add_to(m)

# Save map
m.save("overlay_map.html")
print("✅ Map saved as overlay_map.html, open it in your browser.")
