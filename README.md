# Wildfire Map

Interactive map of wildfire data built with the ArcGIS Maps SDK for JavaScript and an
ASP.NET Core Web API. Fires are loaded from the ESRI sample Wildfire FeatureServer, and
the fires selected on the map are sent to the API, which appends them to
`saved_fires.json`.

## Structure

```
frontend/     HTML, CSS and JavaScript (no build step)
backend/      ASP.NET Core Web API
```

## Requirements

- .NET SDK 10
- Python 3 or Node.js, to serve the frontend
- Internet access (the ArcGIS SDK and the wildfire layer are loaded online)

## Running

### 1. API

```
cd backend/WildfireApi
dotnet run --launch-profile https
```

It listens on `https://localhost:7286`. If the browser rejects the development
certificate, run `dotnet dev-certs https --trust` once.

You can also open `backend/WildfireApi.slnx` in Visual Studio, choose the **https**
profile and press F5.

### 2. Frontend

The page has to be served over HTTP. Opening `index.html` from disk does not work,
because the browser blocks the SDK and the API requests.

```
cd frontend
python -m http.server 8080
```

Then open <http://localhost:8080>.

If the API runs on a different port, change `API_URL` in `frontend/js/config.js`.

## API

Base URL: `https://localhost:7286/api/fires`

| Method | Route | Description |
| --- | --- | --- |
| POST | `/api/fires` | Appends the received fires to `saved_fires.json` |
| GET | `/api/fires` | Returns everything stored in the file |

Body of `POST /api/fires`:

```json
[
  {
    "id": 5286139,
    "attributes": { "objectid": 5286139, "description": "sss", "eventdate": null },
    "geometry": { "x": -117.1, "y": 34.2 }
  }
]
```

Old records are kept; new ones are appended to the existing file.

## Features

- The wildfire layer is shown on a map that can be zoomed and panned.
- Clicking a fire selects it and opens a popup with its ID, description and date.
- More than one fire can be selected; clicking a selected fire again deselects it.
- **Delete Selected** hides the selected fires from the map through a `FeatureLayerView`
  filter. The ArcGIS FeatureServer is never modified, and *Restore hidden fires* brings
  them back.
- **Save Selected** posts the selection to the API with `fetch` and `async/await`, then
  reports the result.
- **Add Fire Point** places a new point on the map and saves it to the API as well.
