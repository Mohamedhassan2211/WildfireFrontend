// General app config — edit this file only when the API URL changes
const CONFIG = {
  // Original wildfire layer on the ESRI sample server (read-only, never written to)
  WILDFIRE_LAYER_URL:
    "https://sampleserver6.arcgisonline.com/arcgis/rest/services/Wildfire/FeatureServer/0",

  // Your C# Web API base URL (change it when deploying via ngrok / IIS / Azure).
  // Must match the applicationUrl in the API's Properties/launchSettings.json.
  API_BASE_URL: "https://localhost:7286/api/fires",

  // Map starting center, zoom and basemap
  MAP_CENTER: [-118, 34],
  MAP_ZOOM: 5,
  MAP_BASEMAP: "topo-vector",

  // Colour used to highlight the fires selected on the map
  HIGHLIGHT_COLOR: [255, 212, 0],

  // Fire types (matching the original server schema, field `eventtype`)
  FIRE_TYPES: [
    { value: 7,  label: "Fire Origin" },
    { value: 12, label: "Hot Spot" },
    { value: 22, label: "Spot Fire" },
    { value: 25, label: "Water Source" },
    { value: 1,  label: "Aerial Hazard" },
    { value: 4,  label: "Camp" },
    { value: 6,  label: "Drop Point" },
    { value: 8,  label: "Fire Station" },
    { value: 9,  label: "First Aid Station" },
    { value: 10, label: "Helibase" },
    { value: 16, label: "Lookout" },
    { value: 17, label: "Telephone" },
    { value: 18, label: "Mobile Weather Unit" },
    { value: 20, label: "Safety Zone" },
    { value: 26, label: "Wind Speed Direction" }
  ]
};
