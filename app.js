/**
 * Visualizador Coroplético de Temperaturas de Minas Gerais (853 municípios)
 * Utiliza MapLibre GL JS, malha IBGE com generalização cartográfica estadual e rampa contínua Viridis.
 */

const VIRIDIS_STOPS = [
  "#440154", // 0.00
  "#3b528b", // 0.25
  "#21918c", // 0.50
  "#5ec962", // 0.75
  "#fde725"  // 1.00
];

const METRIC_LABELS = {
  temp_atual: "Temperatura Atual (°C)",
  temp_min: "Temperatura Mínima (°C)",
  temp_max: "Temperatura Máxima (°C)"
};

const BASEMAP_TILES = {
  darkBase: [
    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
  ],
  darkLabels: [
    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
  ],
  lightBase: [
    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
  ],
  lightLabels: [
    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
  ]
};

// Serviço público de Modelo Digital de Elevação (AWS Registry of Open Data - Mapzen Terrarium DEM, sem API key)
const TERRARIUM_DEM_TILES = [
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
];

let currentTheme = "dark";
let currentMetric = "temp_atual";
let reliefEnabled = true;
let reliefExaggeration = 2.2;
let geojsonData = null;
let selectedCodIbge = null;

// Estilo inicial com mapas base públicos Esri Canvas (sem API key) e fontes de relevo DEM (Hillshade + Terrain 3D)
const initialStyle = {
  version: 8,
  sources: {
    "esri-dark-base": {
      type: "raster",
      tiles: BASEMAP_TILES.darkBase,
      tileSize: 256,
      maxzoom: 16,
      attribution: "Tiles &copy; Esri, HERE, Garmin, OpenStreetMap contributors"
    },
    "esri-dark-labels": {
      type: "raster",
      tiles: BASEMAP_TILES.darkLabels,
      tileSize: 256,
      maxzoom: 16
    },
    "esri-light-base": {
      type: "raster",
      tiles: BASEMAP_TILES.lightBase,
      tileSize: 256,
      maxzoom: 16,
      attribution: "Tiles &copy; Esri, HERE, Garmin, OpenStreetMap contributors"
    },
    "esri-light-labels": {
      type: "raster",
      tiles: BASEMAP_TILES.lightLabels,
      tileSize: 256,
      maxzoom: 16
    },
    "terrain-dem": {
      type: "raster-dem",
      tiles: TERRARIUM_DEM_TILES,
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 15,
      attribution: "Relevo: Mapzen Terrarium / AWS Open Data"
    },
    "hillshade-dem": {
      type: "raster-dem",
      tiles: TERRARIUM_DEM_TILES,
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 15
    }
  },
  terrain: {
    source: "terrain-dem",
    exaggeration: 2.2
  },
  layers: [
    {
      id: "basemap-dark",
      type: "raster",
      source: "esri-dark-base",
      layout: { visibility: "visible" }
    },
    {
      id: "basemap-light",
      type: "raster",
      source: "esri-light-base",
      layout: { visibility: "none" }
    },
    {
      id: "relief-hillshade",
      type: "hillshade",
      source: "hillshade-dem",
      layout: { visibility: "visible" },
      paint: {
        "hillshade-exaggeration": 0.65,
        "hillshade-shadow-color": "#020617",
        "hillshade-highlight-color": "#ffffff",
        "hillshade-accent-color": "#334155",
        "hillshade-illumination-direction": 315
      }
    },
    {
      id: "basemap-dark-labels",
      type: "raster",
      source: "esri-dark-labels",
      layout: { visibility: "visible" }
    },
    {
      id: "basemap-light-labels",
      type: "raster",
      source: "esri-light-labels",
      layout: { visibility: "none" }
    }
  ]
};

// Centro, zoom e inclinação (pitch) ajustados para destacar o relevo de Minas Gerais
const map = new maplibregl.Map({
  container: "map",
  style: initialStyle,
  center: [-44.55, -18.55],
  zoom: 5.6,
  pitch: 32,
  minZoom: 4.5,
  maxZoom: 12,
  maxPitch: 75
});

map.addControl(
  new maplibregl.NavigationControl({ visualizePitch: true }),
  "bottom-right"
);
map.addControl(
  new maplibregl.TerrainControl({
    source: "terrain-dem",
    exaggeration: 2.2
  }),
  "bottom-right"
);

const hoverPopup = new maplibregl.Popup({
  closeButton: false,
  closeOnClick: false,
  offset: 12
});

function formatTemp(val) {
  if (val === null || val === undefined || Number.isNaN(Number(val))) {
    return "-- °C";
  }
  return `${Number(val).toFixed(1)} °C`;
}

function computeDomain(geojson, metric) {
  if (!geojson || !geojson.features) return [10, 35];
  const values = [];
  for (const f of geojson.features) {
    const val = f.properties ? f.properties[metric] : null;
    if (typeof val === "number" && !Number.isNaN(val)) {
      values.push(val);
    }
  }
  if (values.length === 0) {
    return [10, 35];
  }
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 2;
    max += 2;
  }
  return [min, max];
}

function buildViridisFillExpression(metric, minVal, maxVal, theme) {
  const nodataColor = theme === "dark" ? "#334155" : "#cbd5e1";
  const span = maxVal - minVal;
  const s0 = minVal;
  const s1 = minVal + span * 0.25;
  const s2 = minVal + span * 0.50;
  const s3 = minVal + span * 0.75;
  const s4 = maxVal;

  return [
    "case",
    ["==", ["typeof", ["get", metric]], "number"],
    [
      "interpolate",
      ["linear"],
      ["get", metric],
      s0, VIRIDIS_STOPS[0],
      s1, VIRIDIS_STOPS[1],
      s2, VIRIDIS_STOPS[2],
      s3, VIRIDIS_STOPS[3],
      s4, VIRIDIS_STOPS[4]
    ],
    nodataColor
  ];
}

function updateLegend(metric, minVal, maxVal) {
  document.getElementById("legend-title").textContent = METRIC_LABELS[metric];
  const span = maxVal - minVal;
  document.getElementById("legend-min").textContent = `${minVal.toFixed(1)} °C`;
  document.getElementById("legend-mid1").textContent = `${(minVal + span * 0.33).toFixed(1)} °C`;
  document.getElementById("legend-mid2").textContent = `${(minVal + span * 0.66).toFixed(1)} °C`;
  document.getElementById("legend-max").textContent = `${maxVal.toFixed(1)} °C`;
}

function addOrUpdateChoroplethLayers() {
  if (!geojsonData) return;

  const [minVal, maxVal] = computeDomain(geojsonData, currentMetric);
  updateLegend(currentMetric, minVal, maxVal);
  const fillColorExpr = buildViridisFillExpression(currentMetric, minVal, maxVal, currentTheme);
  const borderColor = currentTheme === "dark" ? "rgba(15, 23, 42, 0.55)" : "rgba(255, 255, 255, 0.7)";
  const fillOpacity = reliefEnabled ? 0.68 : 0.84;
  const labelLayerId = currentTheme === "dark" ? "basemap-dark-labels" : "basemap-light-labels";
  const beforeLayer = map.getLayer("basemap-dark-labels") ? "basemap-dark-labels" : undefined;

  if (!map.getSource("mg-municipios")) {
    // tolerance: 0.35 aplica simplificação adicional em nível de tile compatível com visualização estadual
    map.addSource("mg-municipios", {
      type: "geojson",
      data: geojsonData,
      tolerance: 0.35
    });
  } else {
    map.getSource("mg-municipios").setData(geojsonData);
  }

  if (!map.getLayer("municipios-fill")) {
    map.addLayer(
      {
        id: "municipios-fill",
        type: "fill",
        source: "mg-municipios",
        paint: {
          "fill-color": fillColorExpr,
          "fill-opacity": fillOpacity
        }
      },
      beforeLayer
    );
  } else {
    map.setPaintProperty("municipios-fill", "fill-color", fillColorExpr);
    map.setPaintProperty("municipios-fill", "fill-opacity", fillOpacity);
  }

  if (!map.getLayer("municipios-outline")) {
    map.addLayer(
      {
        id: "municipios-outline",
        type: "line",
        source: "mg-municipios",
        paint: {
          "line-color": borderColor,
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            5, 0.4,
            8, 1.0,
            11, 1.6
          ]
        }
      },
      beforeLayer
    );
  } else {
    map.setPaintProperty("municipios-outline", "line-color", borderColor);
  }

  if (!map.getLayer("municipios-highlight")) {
    map.addLayer({
      id: "municipios-highlight",
      type: "line",
      source: "mg-municipios",
      filter: ["==", ["get", "cod_ibge"], selectedCodIbge || ""],
      paint: {
        "line-color": "#fde725",
        "line-width": 2.5
      }
    });
  }
}

function showCityCard(props) {
  const card = document.getElementById("city-details");
  card.classList.remove("hidden");
  document.getElementById("card-city-name").textContent = props.nome || "Município";
  document.getElementById("card-city-code").textContent = props.cod_ibge || "-";
  const coordsEl = document.getElementById("card-city-coords");
  if (coordsEl) {
    coordsEl.textContent =
      props.lat !== undefined && props.lon !== undefined
        ? `${Number(props.lat).toFixed(2)}°, ${Number(props.lon).toFixed(2)}°`
        : "-";
  }
  document.getElementById("card-temp-atual").textContent = formatTemp(props.temp_atual);
  document.getElementById("card-temp-min").textContent = formatTemp(props.temp_min);
  document.getElementById("card-temp-max").textContent = formatTemp(props.temp_max);
}

function bindMapEvents() {
  map.on("mousemove", "municipios-fill", (e) => {
    map.getCanvas().style.cursor = "pointer";
    if (!e.features || e.features.length === 0) return;
    const props = e.features[0].properties;
    const html = `
      <div style="font-size:0.82rem;line-height:1.4">
        <strong>${props.nome}</strong> <span style="opacity:0.7">(${props.cod_ibge})</span><br/>
        Atual: <b>${formatTemp(props.temp_atual)}</b> &bull;
        Mín: <b>${formatTemp(props.temp_min)}</b> &bull;
        Máx: <b>${formatTemp(props.temp_max)}</b>
      </div>
    `;
    hoverPopup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  });

  map.on("mouseleave", "municipios-fill", () => {
    map.getCanvas().style.cursor = "";
    hoverPopup.remove();
  });

  map.on("click", "municipios-fill", (e) => {
    if (!e.features || e.features.length === 0) return;
    const props = e.features[0].properties;
    selectedCodIbge = String(props.cod_ibge);
    if (map.getLayer("municipios-highlight")) {
      map.setFilter("municipios-highlight", ["==", ["get", "cod_ibge"], selectedCodIbge]);
    }
    showCityCard(props);
  });
}

async function loadGeoJSON() {
  const statusBanner = document.getElementById("status-banner");
  const lastUpdated = document.getElementById("last-updated");
  try {
    const resp = await fetch(`data/minas_gerais_municipios.geojson?t=${Date.now()}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    geojsonData = await resp.json();

    const meta = geojsonData.metadata || {};
    const total = geojsonData.features ? geojsonData.features.length : 0;
    const okCount = meta.municipios_atualizados_com_sucesso ?? total;

    statusBanner.textContent = `${okCount}/${total} municípios de MG atualizados (Open-Meteo)`;

    if (meta.atualizado_em) {
      const dt = new Date(meta.atualizado_em);
      lastUpdated.textContent = `Última atualização: ${dt.toLocaleString("pt-BR")}`;
    }

    addOrUpdateChoroplethLayers();
  } catch (err) {
    statusBanner.textContent = `Erro ao carregar GeoJSON: ${err.message}`;
  }
}

map.on("load", () => {
  bindMapEvents();
  loadGeoJSON();
});

// Alternância de métrica (Atual / Mínima / Máxima)
document.querySelectorAll(".metric-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".metric-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentMetric = btn.dataset.metric;
    addOrUpdateChoroplethLayers();
  });
});

// Alternância de tema (Claro / Escuro) sem destruir o style nem as camadas GeoJSON
document.getElementById("theme-toggle").addEventListener("click", () => {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", currentTheme);
  document.getElementById("theme-icon").textContent = currentTheme === "dark" ? "☀️" : "🌙";

  const isDark = currentTheme === "dark";
  if (map.getLayer("basemap-dark")) {
    map.setLayoutProperty("basemap-dark", "visibility", isDark ? "visible" : "none");
  }
  if (map.getLayer("basemap-dark-labels")) {
    map.setLayoutProperty("basemap-dark-labels", "visibility", isDark ? "visible" : "none");
  }
  if (map.getLayer("basemap-light")) {
    map.setLayoutProperty("basemap-light", "visibility", !isDark ? "visible" : "none");
  }
  if (map.getLayer("basemap-light-labels")) {
    map.setLayoutProperty("basemap-light-labels", "visibility", !isDark ? "visible" : "none");
  }

  addOrUpdateChoroplethLayers();
});

// Função centralizada para atualizar o estado visual do botão, slider e camadas de relevo
function syncReliefUI(enabled) {
  reliefEnabled = enabled;
  const btn = document.getElementById("relief-toggle");
  const label = document.getElementById("relief-label");
  const exagGroup = document.getElementById("exaggeration-group");
  if (btn && label) {
    btn.classList.toggle("active", reliefEnabled);
    btn.setAttribute("aria-pressed", String(reliefEnabled));
    label.textContent = reliefEnabled
      ? "Relevo Ativado (3D + Sombreado)"
      : "Relevo Desativado (Mapa Plano)";
  }
  if (exagGroup) {
    exagGroup.classList.toggle("disabled", !reliefEnabled);
  }

  if (map.getLayer("relief-hillshade")) {
    map.setLayoutProperty(
      "relief-hillshade",
      "visibility",
      reliefEnabled ? "visible" : "none"
    );
  }
  if (map.getLayer("municipios-fill")) {
    map.setPaintProperty("municipios-fill", "fill-opacity", reliefEnabled ? 0.68 : 0.84);
  }
}

// Aplica o valor de exagero vertical tanto no Terreno 3D quanto proporcionalmente no sombreado Hillshade
function applyReliefExaggeration(value) {
  reliefExaggeration = Number(value);
  const valOutput = document.getElementById("relief-exaggeration-val");
  if (valOutput) {
    valOutput.textContent = `${reliefExaggeration.toFixed(1)}x`;
  }

  if (reliefEnabled) {
    map.setTerrain({ source: "terrain-dem", exaggeration: reliefExaggeration });
  }
  if (map.getLayer("relief-hillshade")) {
    const hillshadeExag = Math.min(1.0, Math.max(0.15, (reliefExaggeration / 6.0) * 0.9 + 0.1));
    map.setPaintProperty("relief-hillshade", "hillshade-exaggeration", hillshadeExag);
  }
}

// Alternância de Relevo (Terrain 3D + Hillshade) pelo painel de controle
document.getElementById("relief-toggle").addEventListener("click", () => {
  const nextState = !reliefEnabled;
  if (nextState) {
    map.setTerrain({ source: "terrain-dem", exaggeration: reliefExaggeration });
    if (map.getPitch() < 15) {
      map.easeTo({ pitch: 32, duration: 700 });
    }
  } else {
    map.setTerrain(null);
    map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
  }
  syncReliefUI(nextState);
});

// Barra deslizante de exagero vertical do relevo
document.getElementById("relief-exaggeration").addEventListener("input", (e) => {
  applyReliefExaggeration(e.target.value);
});

// Sincroniza o botão do painel caso o usuário clique no TerrainControl nativo do MapLibre
map.on("terrain", () => {
  const terrain = map.getTerrain();
  const isTerrainActive = Boolean(terrain);
  if (isTerrainActive !== reliefEnabled) {
    syncReliefUI(isTerrainActive);
    if (isTerrainActive && terrain.exaggeration !== reliefExaggeration) {
      map.setTerrain({ source: "terrain-dem", exaggeration: reliefExaggeration });
    }
  }
});

// Busca por nome ou código IBGE com centralização no município encontrado
document.getElementById("city-search").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  if (!q || !geojsonData || !geojsonData.features) return;

  const match = geojsonData.features.find((f) => {
    const nome = (f.properties.nome || "").toLowerCase();
    const cod = String(f.properties.cod_ibge || "");
    return nome.includes(q) || cod === q;
  });

  if (match) {
    selectedCodIbge = String(match.properties.cod_ibge);
    if (map.getLayer("municipios-highlight")) {
      map.setFilter("municipios-highlight", ["==", ["get", "cod_ibge"], selectedCodIbge]);
    }
    showCityCard(match.properties);
    if (match.properties.lon !== undefined && match.properties.lat !== undefined) {
      map.flyTo({
        center: [Number(match.properties.lon), Number(match.properties.lat)],
        zoom: 7.5,
        duration: 900
      });
    }
  }
});
