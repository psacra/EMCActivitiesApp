const API = window.EMC_API_BASE;

const els = {
  log: document.getElementById("log"),
  search: document.getElementById("searchInput"),
  typeFilter: document.getElementById("typeFilter"),
  tagFilter: document.getElementById("tagFilter"),
  curatedOnly: document.getElementById("curatedOnly"),
  fromDate: document.getElementById("fromDate"),
  toDate: document.getElementById("toDate"),
  statCount: document.getElementById("statCount"),
  statDistance: document.getElementById("statDistance"),
  statElevation: document.getElementById("statElevation"),
  drawer: document.getElementById("drawer"),
  drawerContent: document.getElementById("drawerContent"),
  drawerClose: document.getElementById("drawerClose"),
  connectStravaBtn: document.getElementById("connectStravaBtn"),
  importStravaBtn: document.getElementById("importStravaBtn"),
  stravaDialog: document.getElementById("stravaDialog"),
  stravaYear: document.getElementById("stravaYear"),
  stravaPerPage: document.getElementById("stravaPerPage"),
  stravaList: document.getElementById("stravaList"),
  stravaLoad: document.getElementById("stravaLoad"),
  stravaLoadMore: document.getElementById("stravaLoadMore"),
  stravaCancel: document.getElementById("stravaCancel"),
  stravaImportSelected: document.getElementById("stravaImportSelected"),
  stravaSelectedCount: document.getElementById("stravaSelectedCount"),
  uploadGpxBtn: document.getElementById("uploadGpxBtn"),
  gpxDialog: document.getElementById("gpxDialog"),
  gpxForm: document.getElementById("gpxForm"),
  gpxCancel: document.getElementById("gpxCancel"),
};

function currentFilters() {
  const params = new URLSearchParams();
  if (els.search.value) params.set("q", els.search.value);
  if (els.typeFilter.value) params.set("type", els.typeFilter.value);
  if (els.tagFilter.value) params.set("tag", els.tagFilter.value);
  if (els.curatedOnly.checked) params.set("curatedOnly", "true");
  if (els.fromDate.value) params.set("from", els.fromDate.value);
  if (els.toDate.value) params.set("to", els.toDate.value);
  return params.toString();
}

async function loadActivities() {
  els.log.innerHTML = `<p class="empty-state">Loading the log…</p>`;
  try {
    const res = await fetch(`${API}/api/activities?${currentFilters()}`);
    const activities = await res.json();
    renderList(activities);
    renderStats(activities);
    renderMap(activities);
  } catch (err) {
    els.log.innerHTML = `<p class="empty-state">Couldn't reach the server. Is the backend running?</p>`;
  }
}

async function loadTags() {
  try {
    const res = await fetch(`${API}/api/activities/tags`);
    const tags = await res.json();
    els.tagFilter.innerHTML =
      `<option value="">All tags</option>` +
      tags.map((t) => `<option value="${t}">${t}</option>`).join("");
  } catch {
    /* tags are a nice-to-have; fail quietly */
  }
}

function km(m) { return (m / 1000).toFixed(1); }

// ---------- Overview map (default view) ----------

const TYPE_COLORS = { hike: "#4b6043", mtb: "#b5651d", ride: "#5b6b73", run: "#7a6a9c", other: "#8a8f85" };

const mainMap = L.map("mainMap");
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
  maxZoom: 18,
}).addTo(mainMap);
mainMap.setView([46.8, 8.2], 6); // neutral default until real data arrives

const mapLayers = L.layerGroup().addTo(mainMap);

// Standard Google/Strava encoded-polyline decoder (precision 5).
function decodePolyline(encoded) {
  let index = 0, lat = 0, lng = 0;
  const points = [];
  while (index < encoded.length) {
    let result = 1, shift = 0, b;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 1; shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lat * 1e-5, lng * 1e-5]);
  }
  return points;
}

function gpxTrackPoints(xmlText) {
  return [...xmlText.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)"/g)].map((m) => [
    parseFloat(m[1]),
    parseFloat(m[2]),
  ]);
}

async function renderMap(activities) {
  mapLayers.clearLayers();
  const bounds = [];

  const drawTrack = (a, points) => {
    if (!points.length) return;
    const line = L.polyline(points, {
      color: TYPE_COLORS[a.activity_type] || TYPE_COLORS.other,
      weight: 4,
      opacity: 0.85,
    })
      .bindTooltip(a.name, { sticky: true })
      .on("click", () => openDrawer(a.id))
      .addTo(mapLayers);
    bounds.push(...points);
    return line;
  };

  const fetches = [];
  for (const a of activities) {
    if (a.summary_polyline) {
      drawTrack(a, decodePolyline(a.summary_polyline));
    } else if (a.gpx_path) {
      fetches.push(
        fetch(`${API}/api/gpx/${a.id}/file`)
          .then((r) => r.text())
          .then((xml) => drawTrack(a, gpxTrackPoints(xml)))
          .catch(() => {})
      );
    }
  }
  await Promise.all(fetches);

  if (bounds.length) {
    mainMap.fitBounds(L.latLngBounds(bounds), { padding: [30, 30] });
  }
}

function renderStats(activities) {
  const totalDistance = activities.reduce((s, a) => s + Number(a.distance_m || 0), 0);
  const totalElevation = activities.reduce((s, a) => s + Number(a.elevation_gain_m || 0), 0);
  els.statCount.textContent = activities.length;
  els.statDistance.textContent = km(totalDistance);
  els.statElevation.textContent = Math.round(totalElevation);
}

function renderList(activities) {
  if (!activities.length) {
    els.log.innerHTML = `<p class="empty-state">No activities match — widen the filters, or add the first one.</p>`;
    return;
  }
  els.log.innerHTML = activities
    .map((a) => {
      const who = a.first_name ? `${a.first_name} ${a.last_name || ""}`.trim() : "GPX import";
      return `
      <article class="card type-${a.activity_type}" data-id="${a.id}">
        <h3 class="card-title">${escapeHtml(a.name)}</h3>
        <span class="card-badge">${a.is_curated ? '<span class="curated-flag">★ curated</span> · ' : ""}${a.activity_type}</span>
        <div class="card-meta">
          <span>${a.start_date || "no date"}</span>
          <span>${km(a.distance_m || 0)} km</span>
          <span>${Math.round(a.elevation_gain_m || 0)} m ↑</span>
          <span>${who}</span>
        </div>
        <div class="card-tags">
          ${(a.tags || []).map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("")}
        </div>
      </article>`;
    })
    .join("");

  els.log.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("click", () => openDrawer(card.dataset.id));
  });
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Drawer: view + curate a single activity ----------

async function openDrawer(id) {
  const res = await fetch(`${API}/api/activities/${id}`);
  const a = await res.json();

  els.drawerContent.innerHTML = `
    <h3>${escapeHtml(a.name)}</h3>
    <p style="color:var(--slate); font-family:var(--font-mono); font-size:0.85rem;">
      ${a.start_date || "no date"} · ${km(a.distance_m || 0)} km · ${Math.round(a.elevation_gain_m || 0)} m climb
    </p>
    ${a.gpx_path || a.summary_polyline ? `<div class="map" id="drawerMap"></div>` : ""}

    <label>Name</label>
    <input type="text" id="editName" value="${escapeHtml(a.name)}" />

    <label>Type</label>
    <select id="editType">
      ${["hike", "mtb", "ride", "run", "other"].map((t) => `<option value="${t}" ${t === a.activity_type ? "selected" : ""}>${t}</option>`).join("")}
    </select>

    <label>Description</label>
    <textarea id="editDescription">${escapeHtml(a.description || "")}</textarea>

    <label>Tags (comma-separated)</label>
    <input type="text" id="editTags" value="${(a.tags || []).join(", ")}" />

    <label>Participants (comma-separated)</label>
    <input type="text" id="editParticipants" value="${(a.participants || []).join(", ")}" />

    <label class="checkbox-field" style="margin-top:14px;">
      <input type="checkbox" id="editCurated" ${a.is_curated ? "checked" : ""} />
      <span>Mark as curated (shown by default)</span>
    </label>

    <div class="drawer-actions">
      <button class="btn btn-accent" id="saveBtn">Save changes</button>
      <button class="btn btn-ghost" id="deleteBtn">Delete</button>
    </div>
  `;

  els.drawer.hidden = false;

  if (a.gpx_path || a.summary_polyline) {
    const drawIn = (coords) => {
      const map = L.map("drawerMap");
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);
      if (coords.length) {
        const line = L.polyline(coords, { color: TYPE_COLORS[a.activity_type] || TYPE_COLORS.other }).addTo(map);
        map.fitBounds(line.getBounds());
      } else {
        map.setView([0, 0], 2);
      }
    };

    if (a.summary_polyline) {
      drawIn(decodePolyline(a.summary_polyline));
    } else {
      fetch(`${API}/api/gpx/${a.id}/file`)
        .then((r) => r.text())
        .then((xml) => drawIn(gpxTrackPoints(xml)));
    }
  }

  document.getElementById("saveBtn").addEventListener("click", () => saveActivity(a.id));
  document.getElementById("deleteBtn").addEventListener("click", () => deleteActivity(a.id));
}

function curatorHeaders() {
  const pwd = window.EMC_CURATOR_PASSWORD || "";
  return pwd ? { "x-curator-password": pwd } : {};
}

async function saveActivity(id) {
  const body = {
    name: document.getElementById("editName").value,
    activity_type: document.getElementById("editType").value,
    description: document.getElementById("editDescription").value,
    tags: document.getElementById("editTags").value.split(",").map((s) => s.trim()).filter(Boolean),
    participants: document.getElementById("editParticipants").value.split(",").map((s) => s.trim()).filter(Boolean),
    is_curated: document.getElementById("editCurated").checked,
  };
  const res = await fetch(`${API}/api/activities/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...curatorHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    alert("Couldn't save — check the curator password in config.js if one is set.");
    return;
  }
  closeDrawer();
  loadTags();
  loadActivities();
}

async function deleteActivity(id) {
  if (!confirm("Remove this activity from the log?")) return;
  const res = await fetch(`${API}/api/activities/${id}`, {
    method: "DELETE",
    headers: curatorHeaders(),
  });
  if (!res.ok) {
    alert("Couldn't delete — check the curator password in config.js if one is set.");
    return;
  }
  closeDrawer();
  loadActivities();
}

function closeDrawer() {
  els.drawer.hidden = true;
  els.drawerContent.innerHTML = "";
}

els.drawerClose.addEventListener("click", closeDrawer);

// ---------- Filters ----------

[els.search, els.typeFilter, els.tagFilter, els.curatedOnly, els.fromDate, els.toDate].forEach((el) => {
  el.addEventListener("input", debounce(loadActivities, 250));
  el.addEventListener("change", loadActivities);
});

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---------- Connect Strava ----------

els.connectStravaBtn.addEventListener("click", () => {
  window.location.href = `${API}/api/auth/strava/connect`;
});

// ---------- Browse & selectively import from Strava ----------

let stravaAthleteId = localStorage.getItem("emc_athlete_id") || null;
let stravaPage = 1;
const stravaSelected = new Set();

// Pick up ?connected=Name&athleteId=123 after the OAuth redirect back from the server.
(function captureConnectRedirect() {
  const params = new URLSearchParams(window.location.search);
  const athleteId = params.get("athleteId");
  const connectedName = params.get("connected");
  if (athleteId) {
    stravaAthleteId = athleteId;
    localStorage.setItem("emc_athlete_id", athleteId);
    window.history.replaceState({}, "", window.location.pathname);
    openStravaDialog();
    if (connectedName) {
      // Small nudge so it's clear the connection worked before they start picking.
      setTimeout(() => alert(`Connected as ${connectedName}. Choose which activities to import below.`), 50);
    }
  }
})();

els.importStravaBtn.addEventListener("click", () => {
  if (!stravaAthleteId) {
    alert("Connect a Strava account first.");
    return;
  }
  openStravaDialog();
});

els.stravaCancel.addEventListener("click", () => els.stravaDialog.close());

function openStravaDialog() {
  stravaSelected.clear();
  updateSelectedCount();
  els.stravaList.innerHTML = `<p class="empty-state">Choose a year and click Load.</p>`;
  els.stravaDialog.showModal();
}

els.stravaLoad.addEventListener("click", () => {
  stravaPage = 1;
  els.stravaList.innerHTML = "";
  loadStravaPage();
});
els.stravaLoadMore.addEventListener("click", () => {
  stravaPage += 1;
  loadStravaPage();
});

async function loadStravaPage() {
  const year = els.stravaYear.value;
  const perPage = els.stravaPerPage.value;
  const params = new URLSearchParams({ page: stravaPage, per_page: perPage });
  if (year) params.set("year", year);

  els.stravaLoad.disabled = true;
  els.stravaLoadMore.disabled = true;
  try {
    const res = await fetch(`${API}/api/auth/athletes/${stravaAthleteId}/strava-activities?${params}`);
    if (!res.ok) throw new Error("fetch failed");
    const items = await res.json();

    if (stravaPage === 1) els.stravaList.innerHTML = "";
    if (!items.length && stravaPage === 1) {
      els.stravaList.innerHTML = `<p class="empty-state">No activities found for that range.</p>`;
      return;
    }

    for (const item of items) {
      const row = document.createElement("label");
      row.className = "strava-row" + (item.already_imported ? " imported" : "");
      row.innerHTML = `
        <input type="checkbox" data-id="${item.id}" ${item.already_imported ? "disabled" : ""} />
        <div class="strava-row-main">
          <div class="strava-row-name">${escapeHtml(item.name)}${item.already_imported ? " (already imported)" : ""}</div>
          <div class="strava-row-meta">${item.start_date || "no date"} · ${item.type} · ${km(item.distance || 0)} km · ${Math.round(item.elevation_gain || 0)} m ↑</div>
        </div>`;
      const checkbox = row.querySelector("input");
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) stravaSelected.add(item.id);
        else stravaSelected.delete(item.id);
        updateSelectedCount();
      });
      els.stravaList.appendChild(row);
    }
  } catch (err) {
    els.stravaList.innerHTML = `<p class="empty-state">Couldn't load activities from Strava.</p>`;
  } finally {
    els.stravaLoad.disabled = false;
    els.stravaLoadMore.disabled = false;
  }
}

function updateSelectedCount() {
  els.stravaSelectedCount.textContent = stravaSelected.size ? `${stravaSelected.size} selected` : "";
}

els.stravaImportSelected.addEventListener("click", async () => {
  if (!stravaSelected.size) {
    alert("Select at least one activity first.");
    return;
  }
  els.stravaImportSelected.disabled = true;
  els.stravaImportSelected.textContent = "Importing…";
  try {
    const res = await fetch(`${API}/api/auth/athletes/${stravaAthleteId}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activityIds: Array.from(stravaSelected) }),
    });
    if (!res.ok) throw new Error("import failed");
    const { imported } = await res.json();
    els.stravaDialog.close();
    stravaSelected.clear();
    updateSelectedCount();
    loadTags();
    loadActivities();
    alert(`Imported ${imported} activit${imported === 1 ? "y" : "ies"}.`);
  } catch (err) {
    alert("Import failed — check the server logs.");
  } finally {
    els.stravaImportSelected.disabled = false;
    els.stravaImportSelected.textContent = "Import selected";
  }
});

// ---------- GPX upload ----------

els.uploadGpxBtn.addEventListener("click", () => els.gpxDialog.showModal());
els.gpxCancel.addEventListener("click", () => els.gpxDialog.close());

els.gpxForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(els.gpxForm);
  try {
    const res = await fetch(`${API}/api/gpx`, { method: "POST", body: formData });
    if (!res.ok) throw new Error("Upload failed");
    els.gpxDialog.close();
    els.gpxForm.reset();
    loadActivities();
  } catch (err) {
    alert("GPX upload failed. Check the server logs.");
  }
});

// ---------- Init ----------

loadTags();
loadActivities();
