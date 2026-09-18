# Wildfire Interactive Map — Frontend

An interactive wildfire map built with the **ArcGIS Maps SDK for JavaScript (4.29)**.
It displays the fires of the ESRI sample *Wildfire* FeatureServer, lets the user select
them on the map, hide the selected ones from the view, add new fire points, and send
everything to a **C# ASP.NET Core Web API** that stores the data in `saved_fires.json`.

This repository contains the **frontend only**. The Web API lives in its own solution
(`WildfireApi`) — see [Running the API](#2-running-the-api).

---

## Requirements covered

| # | Requirement (from the task) | Where it is implemented |
|---|---|---|
| 1 | Show the wildfire layer on a zoomable / pannable map | `FeatureLayer` + `MapView` in [js/app.js](js/app.js) |
| 2 | Popup with the feature data (ID + fields) | `firePopupTemplate` (ESRI fires) and `newFirePopupTemplate()` (added points) |
| 3 | Select one or more fires on the map | map `click` → `view.hitTest()` → `toggleSelection()`, highlighted via `FeatureLayerView.highlight()` |
| 4 | `Delete Selected` removes features **from the view only** | `FeatureLayerView.filter` with `objectid NOT IN (…)`. The FeatureServer is never edited. |
| 5 | `Save Selected` sends the selection to the C# API | `saveGraphicsToApi()` — `fetch` + `async/await` → `POST /api/fires` |
| 6 | Data appended to `saved_fires.json` without losing the old data | handled by the API (`FiresController.SaveFires`) |
| — | Extra: add a new fire point and persist it | `Add Fire Point` → click the map → form → `POST /api/fires` |
| — | Extra: remove an added point from the file | `Delete Selected` → `DELETE /api/fires/{id}` for locally added points |

Data source:
<https://sampleserver6.arcgisonline.com/arcgis/rest/services/Wildfire/FeatureServer> (layer `0`).

---

## Project structure

```
WildfireFrontend/
├─ index.html          page layout: map + side panel
├─ css/styles.css      styling
├─ js/
│  ├─ config.js        layer URL, API URL, map center/zoom, fire types  ← the only file to edit per environment
│  └─ app.js           map, popups, selection, delete, add, save
└─ README.md
```

There is **no build step** — no npm, no bundler. The three files are loaded directly by
`index.html` in this order: ArcGIS SDK (CDN) → `config.js` → `app.js`.

---

## How to run

### 1) Running the frontend

The page has to be served over HTTP. Opening `index.html` with `file://` does **not**
work, because the browser blocks the SDK and the `fetch` calls.

```powershell
cd D:\about\GIS\Task\WildfireFrontend

# with Python
python -m http.server 8080

# or with Node
npx serve . -l 8080
```

Then open <http://localhost:8080>.

VS Code's *Live Server* extension (port 5500) works as well.

### 2) Running the API

The API is the `WildfireApi` ASP.NET Core project:

```powershell
cd "D:\about\interntime\Asp.net WebApi\WildfireApi\WildfireApi"
dotnet restore
dotnet run --launch-profile https
```

It listens on:

```
https://localhost:7286     ← used by the frontend
http://localhost:5005
```

If the browser blocks the development certificate, run `dotnet dev-certs https --trust`
once, or open <https://localhost:7286/api/fires> and accept the certificate before using
the page. CORS is already open (`AllowAnyOrigin`) in `Program.cs`, so any local port works.

`saved_fires.json` is created next to the running project (its working directory).

### 3) Pointing the frontend at the API

Only [js/config.js](js/config.js) needs to change if the port is different:

```js
API_BASE_URL: "https://localhost:7286/api/fires",
```

---

## API used

Base URL: `https://localhost:7286/api/fires`

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/fires` | Append the selected fires to `saved_fires.json` |
| `GET` | `/api/fires` | Read everything in the file (used on page load to redraw added points) |
| `DELETE` | `/api/fires/{id}` | Remove one locally added fire from the file |

Request body of `POST /api/fires` — exactly the shape asked for in the task:

```json
[
  {
    "id": 5290349,
    "attributes": {
      "objectid": 5290349,
      "description": "COPY ASSET",
      "eventtype": 12,
      "eventdate": null
    },
    "geometry": { "x": -87.978515625, "y": 41.836827860 }
  }
]
```

Response:

```json
{ "message": "Data saved successfully.", "savedCount": 1 }
```

Coordinates are always converted to WGS84 longitude/latitude before being sent
(`toLonLat()`), because map graphics are in Web Mercator.

---

## Demo scenario

1. Open the page → the map loads with the wildfire points.
2. Click a fire → a popup shows its OBJECTID, description, event type and date, and the
   fire turns yellow (selected) and appears in the *Selection* list.
3. Click more fires to add them to the selection; click a selected fire again, or the ✕
   in the list, to deselect it.
4. **Delete Selected** → the selected ESRI fires disappear from the map.
   They are *not* deleted from the FeatureServer — **Restore Hidden** brings them back.
5. **Save Selected** → the selection is posted to the API and appended to
   `saved_fires.json`; the status shows *"… saved successfully — تم حفظ البيانات بنجاح."*
6. **Add Fire Point** → click a location on the map, choose a type and a description,
   press *Add Fire*. The point is drawn as an orange diamond and saved to the server.
   Reload the page — it is still there (reloaded through `GET /api/fires`).
7. Select an added point and press **Delete Selected** → it is removed from the map *and*
   from `saved_fires.json` via `DELETE /api/fires/{id}`.

---

## Design notes

- **The ArcGIS FeatureServer is never modified.** `Delete Selected` only applies a
  client-side `FeatureLayerView.filter`, which hides features from the view. The sample
  service is shared and read-only by intent here.
- **Two kinds of fires.** Fires from the FeatureServer (`fireLayer`, badge *esri*) and
  points added in this app (`newPointsLayer`, badge *local*). Only the local ones are
  written to, or deleted from, `saved_fires.json`.
- **Selection is highlighted differently per layer.** ESRI features use
  `FeatureLayerView.highlight()`; locally added graphics simply get a brighter symbol,
  because a `GraphicsLayer` has no highlight of its own.
- **Popups on added points are set per graphic.** A `GraphicsLayer` has no
  `popupTemplate` property — the template belongs to each `Graphic`.
- **The popup is opened manually.** `view.popup.autoOpenEnabled = false`, otherwise the
  SDK opens one popup and the click handler opens a second one on top of it.
- **No duplicate ids in the file.** Ids already present in `saved_fires.json` are skipped
  when saving, because `DELETE /api/fires/{id}` removes only the first matching record.
- **New points get a synthetic id** (`Date.now()`); the server does not assign ids.
