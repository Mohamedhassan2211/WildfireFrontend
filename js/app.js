require([
  "esri/Map",
  "esri/views/MapView",
  "esri/layers/FeatureLayer",
  "esri/layers/GraphicsLayer",
  "esri/Graphic",
  "esri/geometry/support/webMercatorUtils"
], function (Map, MapView, FeatureLayer, GraphicsLayer, Graphic, webMercatorUtils) {

  const el = (id) => document.getElementById(id);

  const statusEl = el("status");
  const listEl = el("selection");
  const countEl = el("count");
  const hintEl = el("hint");
  const formEl = el("addForm");
  const descEl = el("addDesc");

  const selected = [];   // graphics picked on the map
  const hidden = [];     // objectids hidden from the view
  let layerView = null;
  let highlight = null;
  let placing = false;
  let newPoint = null;

  const popupTemplate = {
    title: "Fire #{objectid}",
    content: [{
      type: "fields",
      fieldInfos: [
        { fieldName: "objectid", label: "ID" },
        { fieldName: "description", label: "Description" },
        { fieldName: "eventdate", label: "Date", format: { dateFormat: "short-date-short-time" } }
      ]
    }]
  };

  const fireLayer = new FeatureLayer({
    url: CONFIG.LAYER_URL,
    outFields: ["objectid", "description", "eventdate"],
    popupTemplate: popupTemplate
  });

  const addedLayer = new GraphicsLayer();

  const view = new MapView({
    container: "viewDiv",
    map: new Map({ basemap: "topo-vector", layers: [fireLayer, addedLayer] }),
    center: CONFIG.CENTER,
    zoom: CONFIG.ZOOM
  });

  // The click handler below opens the popup, so the default one is turned off.
  view.popup.autoOpenEnabled = false;
  view.highlightOptions = { color: "#f0a020" };

  view.when(() => setStatus("Click a fire to select it."));
  view.whenLayerView(fireLayer).then((lv) => { layerView = lv; });

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = kind ? "status " + kind : "status";
  }

  function marker(isSelected) {
    return {
      type: "simple-marker",
      style: "diamond",
      size: isSelected ? 16 : 12,
      color: isSelected ? "#f0a020" : "#d9480f",
      outline: { color: "#333", width: 1 }
    };
  }

  function indexOf(graphic) {
    return selected.findIndex((g) =>
      g.layer === graphic.layer && g.attributes.objectid === graphic.attributes.objectid);
  }

  function toggle(graphic) {
    const i = indexOf(graphic);
    if (i === -1) {
      selected.push(graphic);
    } else {
      selected.splice(i, 1);
    }
    render();
  }

  function render() {
    countEl.textContent = selected.length;
    listEl.innerHTML = "";

    if (!selected.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Nothing selected.";
      listEl.appendChild(li);
    }

    selected.forEach((g) => {
      const li = document.createElement("li");
      li.textContent = "#" + g.attributes.objectid +
        (g.attributes.description ? " — " + g.attributes.description : "");
      listEl.appendChild(li);
    });

    // Features from the service can only be highlighted through the layer view;
    // the points we added are our own graphics, so we just change their symbol.
    if (highlight) highlight.remove();
    const ids = selected.filter((g) => g.layer === fireLayer).map((g) => g.attributes.objectid);
    highlight = ids.length && layerView ? layerView.highlight(ids) : null;
    addedLayer.graphics.forEach((g) => { g.symbol = marker(indexOf(g) !== -1); });
  }

  view.on("click", (event) => {
    if (placing) {
      placing = false;
      hintEl.hidden = true;
      newPoint = event.mapPoint;
      formEl.hidden = false;
      descEl.focus();
      return;
    }

    view.hitTest(event).then((response) => {
      const hit = response.results.find((r) => r.graphic &&
        (r.graphic.layer === fireLayer || r.graphic.layer === addedLayer));

      if (!hit) {
        view.popup.close();
        return;
      }
      toggle(hit.graphic);
      view.popup.open({ features: [hit.graphic], location: event.mapPoint });
    });
  });

  el("deleteBtn").addEventListener("click", () => {
    if (!selected.length) {
      setStatus("Select a fire first.", "error");
      return;
    }

    selected.filter((g) => g.layer === addedLayer).forEach((g) => addedLayer.remove(g));

    // Service features are only filtered out of the view — the FeatureServer
    // itself is never edited.
    selected.filter((g) => g.layer === fireLayer).forEach((g) => {
      if (!hidden.includes(g.attributes.objectid)) hidden.push(g.attributes.objectid);
    });
    if (layerView) {
      layerView.filter = hidden.length ? { where: "objectid NOT IN (" + hidden.join(",") + ")" } : null;
    }

    setStatus(selected.length + " fire(s) removed from the map view.");
    selected.length = 0;
    render();
  });

  el("restoreBtn").addEventListener("click", () => {
    hidden.length = 0;
    if (layerView) layerView.filter = null;
    setStatus("Hidden fires restored.");
  });

  el("saveBtn").addEventListener("click", async () => {
    if (!selected.length) {
      setStatus("Select a fire first.", "error");
      return;
    }

    const fires = selected.map(toFire).filter(Boolean);
    if (!fires.length) {
      setStatus("The selected fires have no usable location.", "error");
      return;
    }

    setStatus("Saving…");
    try {
      await save(fires);
      setStatus(fires.length + " fire(s) saved — تم حفظ البيانات بنجاح.", "ok");
      selected.length = 0;
      render();
    } catch (err) {
      setStatus("Could not save: " + err.message, "error");
    }
  });

  el("addBtn").addEventListener("click", () => {
    placing = true;
    hintEl.hidden = false;
  });

  el("cancelBtn").addEventListener("click", () => {
    formEl.hidden = true;
    formEl.reset();
    newPoint = null;
  });

  formEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!newPoint) return;

    const graphic = new Graphic({
      geometry: newPoint,
      symbol: marker(false),
      popupTemplate: popupTemplate,
      attributes: {
        objectid: Date.now(),
        description: descEl.value.trim() || "New fire",
        eventdate: Date.now()
      }
    });

    addedLayer.add(graphic);
    formEl.hidden = true;
    formEl.reset();
    newPoint = null;

    try {
      await save([toFire(graphic)]);
      setStatus("New point saved — تم حفظ البيانات بنجاح.", "ok");
    } catch (err) {
      setStatus("Point added to the map but not saved: " + err.message, "error");
    }
  });

  // { id, attributes, geometry } in WGS84, as the API expects.
  function toFire(graphic) {
    const point = graphic.geometry.longitude != null
      ? graphic.geometry
      : webMercatorUtils.webMercatorToGeographic(graphic.geometry);

    if (!point) return null;

    return {
      id: graphic.attributes.objectid,
      attributes: graphic.attributes,
      geometry: { x: point.longitude, y: point.latitude }
    };
  }

  async function save(fires) {
    const response = await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fires)
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
  }

  render();
});
