require([
  "esri/Map",
  "esri/views/MapView",
  "esri/layers/FeatureLayer",
  "esri/layers/GraphicsLayer",
  "esri/Graphic",
  "esri/geometry/support/webMercatorUtils"
], function (Map, MapView, FeatureLayer, GraphicsLayer, Graphic, webMercatorUtils) {

  // ---------------------------------------------------------------
  // DOM elements
  // ---------------------------------------------------------------
  const statusEl          = document.getElementById("status");
  const mapHintEl         = document.getElementById("mapHint");
  const selectionListEl   = document.getElementById("selectionList");
  const selectionCountEl  = document.getElementById("selectionCount");

  const saveSelectedBtn   = document.getElementById("saveSelectedBtn");
  const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");
  const clearSelectionBtn = document.getElementById("clearSelectionBtn");
  const restoreHiddenBtn  = document.getElementById("restoreHiddenBtn");

  const addFireBtn        = document.getElementById("addFireBtn");
  const newFireForm       = document.getElementById("newFireForm");
  const newFireType       = document.getElementById("newFireType");
  const newFireDescription= document.getElementById("newFireDescription");
  const newFireCoords     = document.getElementById("newFireCoords");
  const cancelAddFireBtn  = document.getElementById("cancelAddFireBtn");

  const actionButtons = [
    saveSelectedBtn, deleteSelectedBtn, clearSelectionBtn, restoreHiddenBtn, addFireBtn
  ];

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------
  function setStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = "status" + (type ? " status--" + type : "");
  }

  function setBusy(isBusy) {
    actionButtons.forEach(function (btn) { btn.disabled = isBusy; });
  }

  // eventtype is a coded value on the ESRI layer — turn it into a readable label
  const FIRE_TYPE_LABELS = {};
  CONFIG.FIRE_TYPES.forEach(function (type) {
    FIRE_TYPE_LABELS[type.value] = type.label;
  });

  function typeLabel(value) {
    if (value == null || value === "") return "—";
    return FIRE_TYPE_LABELS[value] || String(value);
  }

  // eventdate arrives as epoch milliseconds from the FeatureServer and as an
  // ISO string from our own backend — handle both.
  function formatDate(value) {
    if (value == null || value === "") return "—";
    const date = typeof value === "number" ? new Date(value) : new Date(String(value));
    return isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  // Convert any geometry to WGS84 (lon/lat). Returns null when that is not
  // possible, so we never POST { x: null, y: null } to the API — the C#
  // GeometryModel expects non-nullable doubles and would reject it.
  function toLonLat(geometry) {
    if (!geometry) return null;

    if (geometry.longitude != null && geometry.latitude != null) {
      return { x: geometry.longitude, y: geometry.latitude };
    }

    const geo = webMercatorUtils.webMercatorToGeographic(geometry);
    if (geo && geo.longitude != null && geo.latitude != null) {
      return { x: geo.longitude, y: geo.latitude };
    }
    return null;
  }

  // ---------------------------------------------------------------
  // Popup templates
  // ---------------------------------------------------------------
  // The content is built by hand for both layers, because `eventtype` has no
  // coded-value domain on this service — a plain "fields" popup would show the
  // raw code (12) instead of a label ("Hot Spot"), and `eventdate` would show
  // epoch milliseconds.
  function fireFieldsContent(sourceLabel) {
    return function (event) {
      const attributes = (event.graphic && event.graphic.attributes) || {};

      const rows = [
        ["OBJECTID",    attributes.objectid],
        ["Description", attributes.description || "—"],
        ["Event Type",  typeLabel(attributes.eventtype)],
        ["Date",        formatDate(attributes.eventdate)],
        ["Source",      sourceLabel]
      ];

      const table = document.createElement("table");
      table.className = "popup-fields";

      rows.forEach(function (row) {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        const td = document.createElement("td");
        th.textContent = row[0];
        td.textContent = row[1] == null ? "—" : String(row[1]); // no HTML injection
        tr.appendChild(th);
        tr.appendChild(td);
        table.appendChild(tr);
      });

      return table;
    };
  }

  // Fires coming from the ESRI FeatureServer.
  const firePopupTemplate = {
    title: "Fire #{objectid}",
    outFields: ["*"],
    content: fireFieldsContent("ArcGIS Wildfire FeatureServer (read-only)")
  };

  // Points added by the user live on a GraphicsLayer, which has no popupTemplate
  // property — the template has to be set on every Graphic instead.
  function newFirePopupTemplate() {
    return {
      title: "New Fire #{objectid}",
      outFields: ["*"],
      content: fireFieldsContent("Added locally · saved to saved_fires.json")
    };
  }

  // ---------------------------------------------------------------
  // Layers
  // ---------------------------------------------------------------
  const fireLayer = new FeatureLayer({
    url: CONFIG.WILDFIRE_LAYER_URL,
    outFields: ["objectid", "description", "eventtype", "eventdate", "rotation"],
    popupTemplate: firePopupTemplate
  });

  const newPointsLayer = new GraphicsLayer({
    title: "Fires added locally"
  });

  const map = new Map({
    basemap: CONFIG.MAP_BASEMAP || "topo-vector",
    layers: [fireLayer, newPointsLayer]
  });

  const view = new MapView({
    container: "viewDiv",
    map: map,
    center: CONFIG.MAP_CENTER,
    zoom: CONFIG.MAP_ZOOM
  });

  // The popup is opened by the click handler below. Without this the SDK opens
  // its own popup first and this app opens a second one on top of it.
  view.popup.autoOpenEnabled = false;
  view.highlightOptions = {
    color: CONFIG.HIGHLIGHT_COLOR || [255, 212, 0],
    haloOpacity: 0.95,
    fillOpacity: 0.35
  };

  // ---------------------------------------------------------------
  // State
  // ---------------------------------------------------------------
  let selectedGraphics = [];   // graphics currently selected, from either layer
  let fireLayerView    = null; // used for the view-only filter and the highlight
  let highlightHandle  = null; // handle of the current ESRI highlight
  let addPointMode     = false;
  let pendingPoint     = null;
  let hiddenIds        = [];   // objectids hidden from the view (never deleted)
  const persistedIds   = new Set(); // ids already present in saved_fires.json

  // ---------------------------------------------------------------
  // Populate fire types <select>
  // ---------------------------------------------------------------
  CONFIG.FIRE_TYPES.forEach(function (type) {
    const opt = document.createElement("option");
    opt.value = type.value;
    opt.textContent = type.label;
    newFireType.appendChild(opt);
  });

  // ---------------------------------------------------------------
  // Map load
  // ---------------------------------------------------------------
  view.when(function () {
    setStatus("Map loaded. Click a fire to select it.", "success");
    // Loaded after the view is ready, otherwise whichever promise settles last
    // wins and this message would overwrite the "restored" one.
    loadSavedFires();
  }, function (err) {
    setStatus("Failed to load the map.", "error");
    console.error(err);
  });

  view.whenLayerView(fireLayer)
    .then(function (layerView) {
      fireLayerView = layerView;
      refreshHighlight();
    })
    .catch(function (err) {
      console.error("The wildfire layer view could not be created:", err);
      setStatus("The wildfire layer failed to load — Delete Selected cannot hide features.", "error");
    });

  // ---------------------------------------------------------------
  // Symbol for a new fire point (selected points get a brighter symbol)
  // ---------------------------------------------------------------
  function newFireSymbol(isSelected) {
    return {
      type: "simple-marker",
      style: "diamond",
      color: isSelected ? "#ffd400" : "orangered",
      size: isSelected ? 18 : 14,
      outline: {
        color: isSelected ? "#0f62fe" : "black",
        width: isSelected ? 3 : 1.5
      }
    };
  }

  // ---------------------------------------------------------------
  // Load previously saved fires (avoid duplicates)
  // ---------------------------------------------------------------
  async function loadSavedFires() {
    let savedFires;

    try {
      const response = await fetch(CONFIG.API_BASE_URL);
      if (!response.ok) {
        console.warn("GET " + CONFIG.API_BASE_URL + " returned " + response.status);
        return;
      }
      savedFires = await response.json();
    } catch (err) {
      console.error("Could not load saved fires:", err);
      setStatus("The API is not reachable — Save and Delete will not work yet.", "error");
      return;
    }

    if (!Array.isArray(savedFires)) {
      console.warn("The API did not return an array of fires.", savedFires);
      return;
    }

    let restored = 0;

    savedFires.forEach(function (fire) {
      if (!fire || !fire.attributes) return;

      // Remember every id already in the file, so saving the same fire twice
      // cannot create two records with the same id — DELETE /api/fires/{id}
      // only removes the first match.
      const savedId = fire.id != null ? fire.id : fire.attributes.objectid;
      if (savedId != null) persistedIds.add(savedId);

      // Only the points this app created are drawn again; ESRI fires already
      // come from the FeatureServer.
      if (fire.attributes.isNew !== true) return;
      if (!fire.geometry || fire.geometry.x == null || fire.geometry.y == null) return;

      const exists = newPointsLayer.graphics.some(function (g) {
        return g.attributes.objectid === fire.attributes.objectid;
      });
      if (exists) return;

      newPointsLayer.add(new Graphic({
        geometry: {
          type: "point",
          longitude: fire.geometry.x,
          latitude:  fire.geometry.y
        },
        symbol: newFireSymbol(false),
        attributes: fire.attributes,
        popupTemplate: newFirePopupTemplate()
      }));
      restored++;
    });

    if (restored > 0) {
      setStatus(restored + " previously saved fire point(s) restored from the server.", "success");
    }
  }

  // ---------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------
  // A key that is unique across both layers — an ESRI objectid and a local
  // objectid could otherwise collide.
  function keyOf(graphic) {
    const prefix = graphic.layer === newPointsLayer ? "new:" : "esri:";
    return prefix + graphic.attributes.objectid;
  }

  function indexOfSelection(graphic) {
    const key = keyOf(graphic);
    return selectedGraphics.findIndex(function (g) { return keyOf(g) === key; });
  }

  function toggleSelection(graphic) {
    const index = indexOfSelection(graphic);

    if (index === -1) {
      selectedGraphics.push(graphic);
    } else {
      selectedGraphics.splice(index, 1);
    }
    onSelectionChanged();
  }

  function clearSelection() {
    selectedGraphics = [];
    onSelectionChanged();
  }

  function onSelectionChanged() {
    renderSelectionList();
    refreshHighlight();
    refreshNewPointSymbols();
  }

  // ESRI features are highlighted through the layer view, by objectid.
  function refreshHighlight() {
    if (highlightHandle) {
      highlightHandle.remove();
      highlightHandle = null;
    }
    if (!fireLayerView) return;

    const esriIds = selectedGraphics
      .filter(function (g) { return g.layer === fireLayer; })
      .map(function (g) { return g.attributes.objectid; });

    if (esriIds.length > 0) {
      highlightHandle = fireLayerView.highlight(esriIds);
    }
  }

  // Locally added points are graphics we own, so we simply swap their symbol.
  function refreshNewPointSymbols() {
    newPointsLayer.graphics.forEach(function (graphic) {
      graphic.symbol = newFireSymbol(indexOfSelection(graphic) !== -1);
    });
  }

  function renderSelectionList() {
    selectionListEl.innerHTML = "";
    selectionCountEl.textContent = selectedGraphics.length
      ? "(" + selectedGraphics.length + ")"
      : "";

    if (selectedGraphics.length === 0) {
      const li = document.createElement("li");
      li.className = "selection-list__empty";
      li.textContent = "No fires selected yet.";
      selectionListEl.appendChild(li);
      return;
    }

    selectedGraphics.forEach(function (g) {
      const isNew = g.layer === newPointsLayer;
      const li = document.createElement("li");

      const label = document.createElement("span");
      label.className = "selection-list__label";
      label.textContent = "#" + g.attributes.objectid + " · " + typeLabel(g.attributes.eventtype) +
        (g.attributes.description ? " — " + g.attributes.description : "");
      label.title = label.textContent;

      const badge = document.createElement("span");
      badge.className = "badge " + (isNew ? "badge--local" : "badge--esri");
      badge.textContent = isNew ? "local" : "esri";

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "selection-list__remove";
      removeBtn.textContent = "✕";
      removeBtn.title = "Remove from selection";
      removeBtn.setAttribute("aria-label",
        "Remove fire " + g.attributes.objectid + " from the selection");
      removeBtn.addEventListener("click", function () {
        toggleSelection(g);
      });

      li.appendChild(label);
      li.appendChild(badge);
      li.appendChild(removeBtn);
      selectionListEl.appendChild(li);
    });
  }

  // ---------------------------------------------------------------
  // "Add new fire point" mode
  // ---------------------------------------------------------------
  addFireBtn.addEventListener("click", function () {
    addPointMode = true;
    addFireBtn.classList.add("active");
    addFireBtn.textContent = "Click on the map…";
    mapHintEl.textContent = "Click anywhere on the map to place the new fire point (Esc to cancel).";
    mapHintEl.hidden = false;
  });

  cancelAddFireBtn.addEventListener("click", exitAddMode);

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && (addPointMode || !newFireForm.hidden)) {
      exitAddMode();
    }
  });

  function exitAddMode() {
    addPointMode = false;
    pendingPoint = null;
    addFireBtn.classList.remove("active");
    addFireBtn.textContent = "Add Fire Point";
    mapHintEl.hidden = true;
    newFireForm.hidden = true;
    newFireForm.reset();
    newFireCoords.textContent = "";
  }

  newFireForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!pendingPoint) return;

    const eventtype   = parseInt(newFireType.value, 10);
    const description = newFireDescription.value.trim() || "New Fire Event";

    const newGraphic = new Graphic({
      geometry: pendingPoint,
      symbol: newFireSymbol(false),
      popupTemplate: newFirePopupTemplate(),
      attributes: {
        objectid:    Date.now(),
        description: description,
        eventtype:   eventtype,
        eventdate:   new Date().toISOString(),
        rotation:    0,
        isNew:       true
      }
    });

    newPointsLayer.add(newGraphic);

    view.popup.open({
      features: [newGraphic],
      location: pendingPoint
    });

    setBusy(true);
    const result = await saveGraphicsToApi([newGraphic]);
    setBusy(false);

    if (result.ok) {
      setStatus(result.message, "success");
    } else {
      // The point stays on the map so nothing is lost, but say it is not persisted.
      setStatus(result.message + " The point is on the map but not in saved_fires.json.", "error");
    }

    exitAddMode();
  });

  // ---------------------------------------------------------------
  // Map click handler
  // ---------------------------------------------------------------
  view.on("click", function (event) {

    if (addPointMode) {
      pendingPoint = event.mapPoint;

      const lonLat = toLonLat(pendingPoint);
      newFireCoords.textContent = lonLat
        ? "Longitude: " + lonLat.x.toFixed(5) + " | Latitude: " + lonLat.y.toFixed(5)
        : "Coordinates unavailable for this location.";

      newFireForm.hidden = false;
      mapHintEl.hidden = true;
      addFireBtn.classList.remove("active");
      addFireBtn.textContent = "Add Fire Point";
      addPointMode = false;
      newFireType.focus();
      return;
    }

    view.hitTest(event).then(function (response) {
      const results = response.results.filter(function (r) {
        return r.graphic &&
          (r.graphic.layer === fireLayer || r.graphic.layer === newPointsLayer);
      });

      if (results.length > 0) {
        const graphic = results[0].graphic;   // topmost hit
        toggleSelection(graphic);
        view.popup.open({
          features: [graphic],
          location: event.mapPoint
        });
      } else {
        view.popup.close();
      }
    });
  });

  // ---------------------------------------------------------------
  // Control buttons
  // ---------------------------------------------------------------
  clearSelectionBtn.addEventListener("click", function () {
    if (selectedGraphics.length === 0) {
      setStatus("Nothing is selected.", "error");
      return;
    }
    clearSelection();
    setStatus("Selection cleared.");
  });

  restoreHiddenBtn.addEventListener("click", function () {
    if (hiddenIds.length === 0) {
      setStatus("No hidden fires to restore.", "error");
      return;
    }
    const restored = hiddenIds.length;
    hiddenIds = [];
    if (fireLayerView) fireLayerView.filter = null;
    updateRestoreButton();
    setStatus(restored + " hidden fire(s) restored.", "success");
  });

  function updateRestoreButton() {
    restoreHiddenBtn.textContent = hiddenIds.length
      ? "Restore Hidden (" + hiddenIds.length + ")"
      : "Restore Hidden";
  }

  deleteSelectedBtn.addEventListener("click", async function () {
    if (selectedGraphics.length === 0) {
      setStatus("Nothing selected to delete.", "error");
      return;
    }

    // Separate newly-added graphics (local) from the ESRI ones
    const newGraphicsToDelete = selectedGraphics.filter(function (g) {
      return g.layer === newPointsLayer;
    });

    const esriGraphicsToHide = selectedGraphics.filter(function (g) {
      return g.layer === fireLayer;
    });

    // 1) Remove new graphics from the map
    newGraphicsToDelete.forEach(function (g) {
      newPointsLayer.remove(g);
    });

    // 2) Delete new graphics from the JSON file via the API
    let deletedFromServer = 0;
    if (newGraphicsToDelete.length > 0) {
      setBusy(true);
      setStatus("Deleting…");
      const ids = newGraphicsToDelete.map(function (g) { return g.attributes.objectid; });
      const deletedIds = await deleteFiresFromApi(ids);
      deletedFromServer = deletedIds.length;
      deletedIds.forEach(function (id) { persistedIds.delete(id); });
      setBusy(false);
    }

    // 3) Hide ESRI features from the view only. This is a FeatureLayerView
    //    filter — the ArcGIS FeatureServer is never modified.
    const esriIds = esriGraphicsToHide.map(function (g) {
      return g.attributes.objectid;
    });

    esriIds.forEach(function (id) {
      if (!hiddenIds.includes(id)) hiddenIds.push(id);
    });

    if (fireLayerView && hiddenIds.length) {
      fireLayerView.filter = {
        where: "objectid NOT IN (" + hiddenIds.join(",") + ")"
      };
    }
    updateRestoreButton();

    // 4) Status message
    const parts = [];
    if (esriIds.length > 0) {
      parts.push(esriIds.length + " hidden from view");
    }
    if (newGraphicsToDelete.length > 0) {
      parts.push(deletedFromServer + "/" + newGraphicsToDelete.length + " removed from JSON");
    }
    const failed = newGraphicsToDelete.length - deletedFromServer;
    setStatus("Delete Selected: " + parts.join(" | "), failed > 0 ? "error" : "success");

    clearSelection();
  });

  saveSelectedBtn.addEventListener("click", async function () {
    if (selectedGraphics.length === 0) {
      setStatus("Nothing selected to save.", "error");
      return;
    }

    // Saving the same id twice would put two records with the same id into
    // saved_fires.json, and DELETE /api/fires/{id} only removes one of them.
    const alreadySaved = selectedGraphics.filter(function (g) {
      return persistedIds.has(g.attributes.objectid);
    });
    const toSave = selectedGraphics.filter(function (g) {
      return !persistedIds.has(g.attributes.objectid);
    });

    if (toSave.length === 0) {
      setStatus("All " + alreadySaved.length +
        " selected fire(s) are already in saved_fires.json.", "error");
      return;
    }

    setBusy(true);
    const result = await saveGraphicsToApi(toSave);
    setBusy(false);

    if (result.ok) {
      let message = result.message;
      if (alreadySaved.length > 0) {
        message += " (" + alreadySaved.length + " already on the server, skipped.)";
      }
      setStatus(message, "success");
      clearSelection();
    } else {
      setStatus(result.message, "error");
    }
  });

  // ---------------------------------------------------------------
  // POST /api/fires — save graphics. Returns { ok, message }.
  // ---------------------------------------------------------------
  async function saveGraphicsToApi(graphicsArray) {
    const payload  = [];
    const skipped  = [];
    const savedIds = [];

    graphicsArray.forEach(function (g) {
      const lonLat = toLonLat(g.geometry);
      if (!lonLat) {
        // Never send null coordinates: the C# GeometryModel expects doubles.
        skipped.push(g.attributes.objectid);
        return;
      }
      payload.push({
        id: g.attributes.objectid,
        attributes: g.attributes,
        geometry: { x: lonLat.x, y: lonLat.y }
      });
      savedIds.push(g.attributes.objectid);
    });

    if (payload.length === 0) {
      return { ok: false, message: "None of the selected fires has a usable location." };
    }

    setStatus("Saving…");

    try {
      const response = await fetch(CONFIG.API_BASE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        return {
          ok: false,
          message: "Server rejected the save request (" +
            response.status + " " + response.statusText + ")."
        };
      }

      savedIds.forEach(function (id) { persistedIds.add(id); });

      let message = payload.length + " fire(s) saved successfully — تم حفظ البيانات بنجاح.";
      if (skipped.length > 0) {
        message += " " + skipped.length + " skipped (no valid coordinates).";
      }
      return { ok: true, message: message };
    } catch (err) {
      console.error(err);
      return {
        ok: false,
        message: "Could not reach the API at " + CONFIG.API_BASE_URL + "."
      };
    }
  }

  // ---------------------------------------------------------------
  // DELETE /api/fires/{id} — remove local fires from the JSON file.
  // Returns the ids that are no longer in the file.
  // ---------------------------------------------------------------
  async function deleteFiresFromApi(ids) {
    const deleted = [];

    for (const id of ids) {
      try {
        const response = await fetch(CONFIG.API_BASE_URL + "/" + id, {
          method: "DELETE"
        });
        // 404 means it is not in the file anyway — the end state is the same.
        if (response.ok || response.status === 404) deleted.push(id);
      } catch (err) {
        console.error("Could not delete fire #" + id + ":", err);
      }
    }

    return deleted;
  }

  // ---------------------------------------------------------------
  // Initial render
  // ---------------------------------------------------------------
  renderSelectionList();
  updateRestoreButton();
});
