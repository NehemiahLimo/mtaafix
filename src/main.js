const STORAGE_KEY = "mtaafix.mvp.store";
const DEPLOYED_API_BASE_URL = "https://se8ispcqr9.execute-api.eu-west-1.amazonaws.com";
const COGNITO_REGION = "eu-west-1";
const COGNITO_CLIENT_ID = "1ivmiaevho085a7kardun9ekij";
const statusOrder = ["REPORTED", "VERIFIED", "ASSIGNED", "IN_PROGRESS", "RESOLVED"];
const reportCategories = [
  ["ROAD_DAMAGE", "Road Damage", "Potholes, cracked roads", "〽"],
  ["STREETLIGHT", "Streetlight", "Not working", "☼"],
  ["WATER_LEAK", "Water Leak", "Pipe leaks, water waste", "♒"],
  ["DRAINAGE", "Drainage", "Blocked drains", "▱"],
  ["WASTE", "Waste", "Illegal dumping", "♲"],
  ["PUBLIC_INFRASTRUCTURE", "Public Infrastructure", "Parks, sidewalks, signs", "⌂"],
  ["OTHER", "Other", "Something else", "□"],
];

let state = {
  view: "home",
  store: loadStore(),
  lastTriage: null,
  lastDuplicate: null,
  pendingReport: null,
  selectedIncidentId: "",
  adminAuthed: false,
  selectedCategory: "ROAD_DAMAGE",
  successIncidentId: "",
  apiOnline: false,
  isBusy: false,
  uploadStatus: "",
  selectedPhotoName: "",
  selectedPhotoPreviewUrl: "",
  reportLocation: {
    label: "Ngong Road, Nairobi",
    lat: -1.2862,
    lng: 36.8222,
    status: "Drop the pin on the issue location or use your current position.",
  },
  adminReportsByIncident: {},
  trackingPhotosByIncident: {},
  adminLoadingIncidentId: "",
  adminFilters: {
    query: "",
    status: "ALL",
    priority: "ALL",
    category: "ALL",
  },
  mapFilters: {
    category: "ALL",
    statuses: ["OPEN", "IN_PROGRESS", "RESOLVED"],
    priorities: ["HIGH", "MEDIUM", "LOW"],
  },
  selectedAdminReportId: "",
  adminToken: sessionStorage.getItem("mtaafix.admin.token") || "",
};

const app = document.querySelector("#app");
if (!app) throw new Error("App root not found");

let adminFilterRenderTimer = 0;

init();

function init() {
  if (state.adminToken) state.adminAuthed = true;
  render();
  refreshPublicIncidents().then(() => render());
}

function loadStore() {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return JSON.parse(existing);

  const now = new Date().toISOString();
  const store = {
    nextIncidentNumber: 183,
    nextReportNumber: 9,
    incidents: [
      {
        id: "MTF-2026-00182",
        category: "ROAD_DAMAGE",
        summary: "Large pothole near the junction creating a traffic hazard.",
        priority: "HIGH",
        status: "IN_PROGRESS",
        location: "Moi Avenue junction, Nairobi",
        lat: -1.2864,
        lng: 36.8219,
        assignedTo: "Road maintenance team",
        reportIds: ["R001", "R002", "R003", "R004", "R005"],
        createdAt: "2026-09-25T08:00:00.000Z",
        updatedAt: now,
        events: [
          makeEvent("Reported", "First citizen report received.", "2026-09-25T08:00:00.000Z"),
          makeEvent("Verified", "Authority confirmed the road damage.", "2026-09-25T12:30:00.000Z"),
          makeEvent("Assigned", "Road maintenance team assigned.", "2026-09-26T09:20:00.000Z"),
          makeEvent("In progress", "Repair work scheduled and cones placed.", "2026-09-27T11:15:00.000Z"),
        ],
      },
      {
        id: "MTF-2026-00181",
        category: "STREETLIGHT",
        summary: "Streetlight outage leaving a residential lane dark at night.",
        priority: "MEDIUM",
        status: "VERIFIED",
        location: "Kilimani, Kindaruma Road",
        lat: -1.2942,
        lng: 36.7897,
        reportIds: ["R006", "R007"],
        createdAt: "2026-09-24T18:20:00.000Z",
        updatedAt: "2026-09-26T10:10:00.000Z",
        events: [
          makeEvent("Reported", "Resident reported a broken streetlight.", "2026-09-24T18:20:00.000Z"),
          makeEvent("Verified", "Electrical fault confirmed.", "2026-09-26T10:10:00.000Z"),
        ],
      },
      {
        id: "MTF-2026-00180",
        category: "WATER_LEAK",
        summary: "Water leak flowing onto the road near a bus stop.",
        priority: "HIGH",
        status: "REPORTED",
        location: "Westlands, Waiyaki Way",
        lat: -1.2642,
        lng: 36.8025,
        reportIds: ["R008"],
        createdAt: "2026-09-23T07:45:00.000Z",
        updatedAt: "2026-09-23T07:45:00.000Z",
        events: [makeEvent("Reported", "Citizen report received with photo.", "2026-09-23T07:45:00.000Z")],
      },
    ],
    reports: [],
  };
  saveStore(store);
  return store;
}

function saveStore(store = state.store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

async function apiFetch(pathValue, options = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), options.timeoutMs || 8000);
  try {
    const response = await fetch(`${apiBaseUrl()}${pathValue}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || payload.error || `Request failed with ${response.status}`);
    }
    return payload;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function apiBaseUrl() {
  const hostname = window.location.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname.includes("s3-website")) {
    return DEPLOYED_API_BASE_URL;
  }
  return "";
}

async function uploadReportPhoto(file) {
  if (!file || !file.name) return null;
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Photo must be 5 MB or smaller.");
  }

  const presign = await apiFetch("/v1/uploads/presign", {
    method: "POST",
    body: JSON.stringify({
      contentType: file.type || "application/octet-stream",
      contentLength: file.size,
    }),
  });

  const uploadResponse = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: presign.requiredHeaders || { "Content-Type": file.type },
    body: file,
  });
  if (!uploadResponse.ok) {
    throw new Error(`Photo upload failed with ${uploadResponse.status}.`);
  }
  return presign.photoKey;
}

async function refreshPublicIncidents() {
  try {
    const payload = await apiFetch("/v1/incidents/public");
    const incidents = (payload.items || []).map((item) => apiIncidentToLocal(item));
    if (incidents.length) {
      state.store.incidents = incidents;
      state.selectedIncidentId ||= incidents[0].id;
      saveStore();
    }
    state.apiOnline = true;
  } catch (error) {
    state.apiOnline = false;
  }
}

async function loadTrackingIncident(incidentId) {
  if (!incidentId) return null;
  try {
    const payload = await apiFetch(`/v1/tracking/${encodeURIComponent(incidentId)}`);
    const incident = apiIncidentToLocal(payload.incident, payload.timeline || []);
    upsertIncident(incident);
    state.trackingPhotosByIncident[incident.id] = payload.photos || [];
    state.apiOnline = true;
    return incident;
  } catch (error) {
    state.apiOnline = false;
    return state.store.incidents.find((item) => item.id === incidentId) || null;
  }
}

function upsertIncident(incident) {
  const existingIndex = state.store.incidents.findIndex((item) => item.id === incident.id);
  if (existingIndex >= 0) state.store.incidents.splice(existingIndex, 1, incident);
  else state.store.incidents.unshift(incident);
  saveStore();
}

function apiIncidentToLocal(incident, timeline = []) {
  const reportCount = Number(incident.reportCount || 0);
  return {
    id: incident.incidentId,
    category: incident.category,
    summary: incident.summary,
    priority: incident.priority,
    status: incident.status,
    location: incident.location?.label || "Nairobi, Kenya",
    lat: Number(incident.location?.lat || -1.2862),
    lng: Number(incident.location?.lng || 36.8222),
    assignedTo: incident.assignedTo,
    reportIds: Array.from({ length: Math.max(reportCount, 1) }, (_, index) => `R${String(index + 1).padStart(3, "0")}`),
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
    resolution: incident.resolution,
    events: timeline.length
      ? timeline.map((event) => makeEvent(event.label, event.detail, event.at))
      : [makeEvent("Reported", "Citizen report received.", incident.createdAt)],
  };
}

function apiDuplicateToLocal(duplicate) {
  if (!duplicate?.found || !duplicate.incident) return null;
  return {
    incident: apiIncidentToLocal(duplicate.incident),
    distance: duplicate.distanceMeters || duplicate.distance || 0,
    similarity: Math.round(Number(duplicate.similarity || 0) * 100),
  };
}

async function cognitoSignIn(email, password) {
  const response = await fetch(`https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Unable to sign in.");
  return payload.AuthenticationResult?.IdToken;
}

async function adminFetch(pathValue, options = {}) {
  return apiFetch(pathValue, {
    ...options,
    headers: {
      authorization: `Bearer ${state.adminToken}`,
      ...(options.headers || {}),
    },
  });
}

async function refreshAdminIncidents() {
  if (!state.adminToken) return;
  const payload = await adminFetch("/v1/admin/incidents");
  state.store.incidents = (payload.items || []).map((item) => apiIncidentToLocal(item));
  state.selectedIncidentId ||= state.store.incidents[0]?.id || "";
  saveStore();
}

async function loadAdminIncidentDetails(incidentId) {
  if (!state.adminToken || !incidentId) return;
  state.adminLoadingIncidentId = incidentId;
  try {
    const payload = await adminFetch(`/v1/admin/incidents/${encodeURIComponent(incidentId)}`);
    const incident = apiIncidentToLocal(payload.incident, payload.timeline || []);
    upsertIncident(incident);
    state.adminReportsByIncident[incidentId] = await Promise.all((payload.reports || []).map(withAdminPhotoUrl));
  } finally {
    state.adminLoadingIncidentId = "";
  }
}

async function withAdminPhotoUrl(report) {
  if (!report.photoKey) return report;
  try {
    const payload = await adminFetch(`/v1/admin/photos?key=${encodeURIComponent(report.photoKey)}`);
    return { ...report, photoUrl: payload.viewUrl };
  } catch (error) {
    return report;
  }
}

function filteredAdminIncidents() {
  const query = state.adminFilters.query.trim().toLowerCase();
  return state.store.incidents.filter((incident) => {
    if (state.adminFilters.status === "OPEN" && incident.status !== "REPORTED") return false;
    if (state.adminFilters.status === "ACTIVE" && !["ASSIGNED", "IN_PROGRESS"].includes(incident.status)) return false;
    if (!["ALL", "OPEN", "ACTIVE"].includes(state.adminFilters.status) && incident.status !== state.adminFilters.status) return false;
    if (state.adminFilters.priority !== "ALL" && incident.priority !== state.adminFilters.priority) return false;
    if (state.adminFilters.category !== "ALL" && incident.category !== state.adminFilters.category) return false;
    if (query) {
      const haystack = [incident.id, incident.summary, incident.location, incident.category, incident.status, incident.priority, incident.assignedTo]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  }).sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function selectedAdminReport() {
  const reports = state.adminReportsByIncident[state.selectedIncidentId] || [];
  return reports.find((report) => (report.reportId || report.id) === state.selectedAdminReportId) || null;
}

function adminUserProfile() {
  const payload = decodeJwtPayload(state.adminToken);
  const email = payload.email || payload["cognito:username"] || "admin@mtaafix";
  const name = payload.name || payload.given_name || email.split("@")[0] || "Admin user";
  const initials = name
    .split(/[.\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "AU";
  return { name, email, initials };
}

function decodeJwtPayload(token) {
  try {
    const [, payload] = String(token || "").split(".");
    if (!payload) return {};
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    return JSON.parse(json);
  } catch (error) {
    return {};
  }
}

function unresolvedAgeDays(incident) {
  if (incident.status === "RESOLVED") return 0;
  const created = new Date(incident.createdAt).getTime();
  if (!Number.isFinite(created)) return 0;
  return Math.max(0, Math.floor((Date.now() - created) / 86400000));
}

function makeEvent(label, detail, at = new Date().toISOString()) {
  return { id: crypto.randomUUID(), label, detail, at };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setSelectedPhoto(file) {
  if (state.selectedPhotoPreviewUrl) URL.revokeObjectURL(state.selectedPhotoPreviewUrl);
  state.selectedPhotoName = file?.name || "";
  state.selectedPhotoPreviewUrl = file?.name ? URL.createObjectURL(file) : "";
}

function render() {
  const routeView = new URLSearchParams(window.location.search).get("view");
  if (routeView === "admin" && state.view !== "admin") state.view = "admin";
  const adminConsole = state.view === "admin" && state.adminAuthed;
  app.innerHTML = `
    ${adminConsole ? "" : `<header class="topbar">
      <a class="brand nav-brand" href="#" data-view="home" aria-label="MtaaFix home">
        <img class="brand-logo" src="/public/mtaafix-logo-web.png" alt="MtaaFix" />
      </a>
      <nav aria-label="Primary navigation">
        ${navButton("home", "Home")}
        ${navButton("map", "Map")}
        ${navButton("report", "Report")}
        ${navButton("track", "Track")}
        ${navButton("about", "About")}
      </nav>
      <button class="nav-cta" data-view="report">Report an Issue</button>
    </header>`}
    <main>
      ${state.view === "home" ? homeView() : ""}
      ${state.view === "report" ? reportView() : ""}
      ${state.view === "track" ? trackView() : ""}
      ${state.view === "map" ? mapView() : ""}
      ${state.view === "admin" ? adminView() : ""}
      ${state.view === "about" ? aboutView() : ""}
      ${state.view === "success" ? successView() : ""}
    </main>
    ${adminConsole ? "" : footerView()}
  `;

  bindNavigation();
  bindPublicIncidentLinks();
  if (state.view === "report") bindReport();
  if (state.view === "track") bindTrack();
  if (state.view === "map") bindMapFilters();
  if (state.view === "admin") bindAdmin();
  if (state.view === "admin" && state.adminAuthed) initAdminMap();
  if (state.view === "home") bindHome();
  if (state.view === "success") bindSuccess();
  if (state.view === "map") initLeafletMap();
}

function navButton(view, label) {
  return `<button class="${state.view === view ? "active" : ""}" data-view="${view}">${label}</button>`;
}

function footerView() {
  const open = state.store.incidents.filter((incident) => incident.status !== "RESOLVED").length;
  return `
    <footer class="site-footer">
      <div class="footer-inner">
        <div class="footer-brand">
          <a class="brand" href="#" data-view="home" aria-label="MtaaFix home footer">
            <img class="brand-logo footer-logo" src="/public/mtaafix-logo-web.png" alt="MtaaFix" />
          </a>
          <p>Rules-based reporting that turns resident submissions into structured, trackable incidents.</p>
        </div>
        <div class="footer-links" aria-label="Footer navigation">
          <button data-view="report">Report</button>
          <button data-view="map">Community Map</button>
          <button data-view="track">Track</button>
          <button data-view="admin">Authority Portal</button>
        </div>
        <div class="footer-status">
          <span>${open} open incidents</span>
          <span>Community issue tracking</span>
        </div>
      </div>
    </footer>
  `;
}

function bindNavigation() {
  app.querySelectorAll("[data-view]").forEach((el) => {
    el.addEventListener("click", (event) => {
      event.preventDefault();
      state.view = el.dataset.view;
      if (state.view === "admin") {
        history.replaceState(null, "", "?view=admin");
      } else {
        history.replaceState(null, "", window.location.pathname);
      }
      state.lastTriage = null;
      state.lastDuplicate = null;
      render();
    });
  });
}

function homeView() {
  const open = state.store.incidents.filter((incident) => incident.status !== "RESOLVED").length;
  const resolved = state.store.incidents.filter((incident) => incident.status === "RESOLVED").length;
  return `
    <section class="hero-shell">
      <div class="hero-card">
        <div class="hero-copy">
          <h1>See it.<br><span>Report it.</span><br><span>Fix it.</span></h1>
          <p>A cleaner, safer and better community for everyone.</p>
          <div class="hero-actions">
            <button class="primary" data-view="report">⌂ Report an Issue</button>
            <button class="light-button" data-view="map">◇ View Community Map</button>
          </div>
          <form id="home-track" class="home-track">
            <strong>Track an existing report</strong>
            <input name="tracking" placeholder="e.g. MTF-2026-00182" />
            <button class="primary">Track</button>
          </form>
        </div>
      </div>
      <div class="home-benefits">
        ${benefit("Cleaner Towns", "Less litter and waste")}
        ${benefit("Safer Communities", "Well-maintained infrastructure")}
        ${benefit("Stronger Together", "Community powered")}
        ${benefit("Transparent Progress", "Track issues from report to resolution")}
      </div>
      <div class="home-stats">
        ${metric("Open Incidents", String(open))}
        ${metric("Citizen Reports", String(state.store.incidents.reduce((sum, item) => sum + item.reportIds.length, 0)))}
        ${metric("Resolved", String(resolved))}
      </div>
    </section>
  `;
}

function bindHome() {
  app.querySelector("#home-track")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const tracking = String(new FormData(event.currentTarget).get("tracking") || "").trim().toUpperCase();
    state.selectedIncidentId = tracking || "MTF-2026-00182";
    await loadTrackingIncident(state.selectedIncidentId);
    state.view = "track";
    render();
  });
}

function benefit(title, text) {
  return `<div class="benefit"><span>✦</span><strong>${title}</strong><small>${text}</small></div>`;
}

function aboutView() {
  return `
    <section class="workspace about-grid">
      <div class="panel about-panel">
        <div class="section-title"><span>About MtaaFix</span><strong>Community reports, consolidated into action.</strong></div>
        <p>MtaaFix helps residents report infrastructure issues without creating an account, while giving authorities a structured queue of incidents to verify, assign, and resolve.</p>
        <div class="stat-row">
          ${metric("Rules triage", "Classification, priority, duplicates")}
          ${metric("Privacy", "Public-safe incident views")}
          ${metric("Reliable updates", "Track progress as teams respond")}
          ${metric("Workflow", "Reported to resolved")}
        </div>
      </div>
      <div class="panel about-panel">
        <div class="section-title"><span>Core model</span><strong>Reports attach to incidents.</strong></div>
        <p>Multiple residents can report the same pothole, leak, or streetlight outage. MtaaFix keeps every report and links them to the shared incident so demand and impact remain visible.</p>
        <button class="primary full" data-view="report">Report an Issue</button>
      </div>
    </section>
  `;
}

function reportView() {
  const duplicate = state.lastDuplicate;
  const triage = state.lastTriage;
  const pendingPhotoName = state.pendingReport?.photoName || state.selectedPhotoName;
  const previewUrl = state.selectedPhotoPreviewUrl;
  const reportLocation = state.reportLocation;

  return `
    <section class="workspace report-layout">
      <div class="panel report-panel">
        ${stepper(triage ? 4 : 1)}
        <div class="section-title"><span>Report an Issue</span><strong>What type of issue are you reporting?</strong></div>
        <div class="category-grid">
          ${reportCategories
            .map(
              ([value, label, hint, icon]) => `
                <button class="category-card ${state.selectedCategory === value ? "selected" : ""}" data-category="${value}">
                  <b>${icon}</b>
                  <strong>${label}</strong>
                  <small>${hint}</small>
                </button>
              `,
            )
            .join("")}
        </div>
        <form id="report-form" class="stack">
          <div class="photo-uploader">
            <div class="photo-preview ${previewUrl ? "has-image" : ""}">
              ${previewUrl ? `<img src="${previewUrl}" alt="Selected issue photo preview" />` : ""}
              <span>${escapeHtml(pendingPhotoName || "Add a clear issue photo")}</span>
            </div>
            <label class="file-button">Take or choose photo<input name="photo" type="file" accept="image/*" /></label>
            <small>Supported: JPG, PNG, WEBP. Max 5 MB.</small>
          </div>
          <label>Describe the issue<textarea name="description" required rows="5" placeholder="There is a huge pothole near the junction and cars keep swerving around it."></textarea></label>
          <div class="grid two">
            <label>Location name<input name="location" required value="${escapeHtml(reportLocation.label)}" /></label>
            <label>Contact for updates<input name="contact" placeholder="email or phone, optional" /></label>
          </div>
          <div class="location-picker">
            <div class="location-picker-head">
              <div>
                <strong>Issue pin</strong>
                <small id="location-status">${escapeHtml(reportLocation.status)}</small>
              </div>
              <button class="light-button" type="button" id="use-current-location">Use current location</button>
            </div>
            <div id="report-location-map" class="report-location-map" aria-label="Choose issue location on map"></div>
            <div class="coordinate-summary">
              <span>Latitude <strong data-lat-display>${reportLocation.lat.toFixed(5)}</strong></span>
              <span>Longitude <strong data-lng-display>${reportLocation.lng.toFixed(5)}</strong></span>
            </div>
            <input name="lat" type="hidden" value="${reportLocation.lat}" />
            <input name="lng" type="hidden" value="${reportLocation.lng}" />
          </div>
          <button class="primary" type="submit" ${state.isBusy ? "disabled" : ""}>${state.isBusy ? "Checking..." : "Continue →"}</button>
        </form>
      </div>

      <aside class="panel result-panel">
        <div class="section-title"><span>Details & Submit</span><strong>${triage ? "Review complete" : "Review appears here"}</strong></div>
        ${
          triage
            ? `
              <div class="ai-banner">✣ We've checked category, priority, and possible duplicates</div>
              ${pendingPhotoName ? `<p class="upload-note">Photo ready: <strong>${escapeHtml(pendingPhotoName)}</strong></p>` : ""}
              ${state.uploadStatus ? `<p class="upload-note">${state.uploadStatus}</p>` : ""}
              <div class="triage-grid">
                ${metric("Category", triage.category)}
                ${metric("Priority", triage.priority)}
                ${metric("Summary", triage.summary)}
              </div>
              ${
                duplicate
                  ? `
                    <div class="duplicate">
                      <span>Possible duplicate</span>
                      <strong>${duplicate.incident.id}</strong>
                      <p>${duplicate.incident.summary}</p>
                      <div class="inline-metrics">
                        <b>${Math.round(duplicate.distance)} m</b>
                        <b>${duplicate.similarity}% similar</b>
                        <b>${duplicate.incident.reportIds.length} reports</b>
                      </div>
                    </div>
                    <div class="actions">
                      <button class="primary" id="same-issue" ${state.isBusy ? "disabled" : ""}>${state.isBusy ? "Submitting..." : "✓ Yes, add my report"}</button>
                      <button id="new-issue" ${state.isBusy ? "disabled" : ""}>◇ No, create new issue</button>
                    </div>
                  `
                  : `<p class="empty">No likely duplicate found nearby.</p><button class="primary full" id="new-issue" ${state.isBusy ? "disabled" : ""}>${state.isBusy ? "Submitting..." : "Submit report"}</button>`
              }
            `
            : `<p class="empty">${state.isBusy ? "Checking category, priority, and duplicate reports..." : "Choose a category, add a photo, provide the location, and describe what happened. The duplicate check runs before submission."}</p>`
        }
      </aside>
    </section>
  `;
}

function stepper(active) {
  return `
    <div class="stepper">
      ${["Category", "Photo", "Location", "Details"].map((label, index) => `
        <span class="${index + 1 <= active ? "active" : ""}">
          <b>${index + 1}</b>${label}
        </span>
      `).join("")}
    </div>
  `;
}

function bindReport() {
  app.querySelectorAll("[data-category]").forEach((el) => {
    el.addEventListener("click", (event) => {
      event.preventDefault();
      state.selectedCategory = el.dataset.category;
      render();
    });
  });

  const form = app.querySelector("#report-form");
  initReportLocationPicker(form);

  form?.querySelector('input[name="photo"]')?.addEventListener("change", (event) => {
    const file = event.currentTarget.files?.[0];
    setSelectedPhoto(file);
    const preview = form.querySelector(".photo-preview");
    if (!preview) return;
    preview.classList.toggle("has-image", Boolean(state.selectedPhotoPreviewUrl));
    preview.innerHTML = `
      ${state.selectedPhotoPreviewUrl ? `<img src="${state.selectedPhotoPreviewUrl}" alt="Selected issue photo preview" />` : ""}
      <span>${escapeHtml(state.selectedPhotoName || "Add a clear issue photo")}</span>
    `;
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const description = String(formData.get("description") || "").trim();
    const location = String(formData.get("location") || "").trim();
    const contact = String(formData.get("contact") || "").trim();
    const lat = Number(formData.get("lat") || form.querySelector("[data-lat-display]")?.textContent || state.reportLocation.lat);
    const lng = Number(formData.get("lng") || form.querySelector("[data-lng-display]")?.textContent || state.reportLocation.lng);
    const file = formData.get("photo");
    if (file?.name) setSelectedPhoto(file);
    updateReportLocation(lat, lng, location || "Pinned issue location", "Pin selected for this report.");

    state.pendingReport = {
      description,
      location,
      contact: contact || undefined,
      lat,
      lng,
      photoName: file?.name || undefined,
      photoFile: file?.name ? file : null,
    };
    state.uploadStatus = "";
    state.isBusy = true;
    render();

    try {
      const analysis = await apiFetch("/v1/reports/analyze", {
        method: "POST",
        body: JSON.stringify({
          description,
          categoryHint: state.selectedCategory,
          location: { label: location, lat, lng },
        }),
      });
      state.lastTriage = analysis.triage;
      state.lastDuplicate = apiDuplicateToLocal(analysis.duplicate);
      state.apiOnline = true;
    } catch (error) {
      const triage = classifyReport(description);
      triage.category = state.selectedCategory;
      state.lastTriage = triage;
      state.lastDuplicate = findDuplicate(description, triage.category, lat, lng);
      state.apiOnline = false;
    } finally {
      state.isBusy = false;
    }
    render();
  });

  app.querySelector("#same-issue")?.addEventListener("click", async () => {
    if (state.lastDuplicate) await completeReport(state.lastDuplicate.incident.id);
  });
  app.querySelector("#new-issue")?.addEventListener("click", async () => completeReport());
}

function initReportLocationPicker(form) {
  if (!form) return;
  const mapEl = form.querySelector("#report-location-map");
  const locationInput = form.querySelector('input[name="location"]');
  const latDisplay = form.querySelector("[data-lat-display]");
  const lngDisplay = form.querySelector("[data-lng-display]");
  const statusEl = form.querySelector("#location-status");

  const setCoordinateInputs = (lat, lng) => {
    form.querySelectorAll('input[name="lat"]').forEach((input) => {
      input.value = String(lat);
      input.setAttribute("value", String(lat));
    });
    form.querySelectorAll('input[name="lng"]').forEach((input) => {
      input.value = String(lng);
      input.setAttribute("value", String(lng));
    });
  };

  setCoordinateInputs(state.reportLocation.lat, state.reportLocation.lng);

  const syncLocation = (lat, lng, status) => {
    updateReportLocation(lat, lng, locationInput?.value || state.reportLocation.label, status);
    setCoordinateInputs(lat, lng);
    if (latDisplay) latDisplay.textContent = lat.toFixed(5);
    if (lngDisplay) lngDisplay.textContent = lng.toFixed(5);
    if (statusEl) statusEl.textContent = status;
  };

  let movePin = syncLocation;

  if (!mapEl || typeof window.L === "undefined") {
    mapEl?.classList.add("map-unavailable");
    if (mapEl) mapEl.innerHTML = "<p>Map picker is loading. You can still use current location.</p>";
  } else {
    const map = window.L.map(mapEl, {
      center: [state.reportLocation.lat, state.reportLocation.lng],
      zoom: 15,
      scrollWheelZoom: false,
    });

    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const marker = window.L.marker([state.reportLocation.lat, state.reportLocation.lng], {
      draggable: true,
      icon: reportLocationIcon(),
    }).addTo(map);

    movePin = (lat, lng, status) => {
      marker.setLatLng([lat, lng]);
      map.panTo([lat, lng]);
      syncLocation(lat, lng, status);
    };

    map.on("click", (event) => {
      movePin(event.latlng.lat, event.latlng.lng, "Pin moved to selected map point.");
    });
    marker.on("dragend", () => {
      const point = marker.getLatLng();
      syncLocation(point.lat, point.lng, "Pin adjusted manually.");
    });
    window.setTimeout(() => map.invalidateSize(), 0);
  }

  form.querySelector("#use-current-location")?.addEventListener("click", () => {
    if (!navigator.geolocation) {
      if (statusEl) statusEl.textContent = "Current location is not available in this browser.";
      return;
    }
    if (statusEl) statusEl.textContent = "Waiting for browser location permission...";
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        movePin(latitude, longitude, "Using your current browser location.");
      },
      () => {
        if (statusEl) statusEl.textContent = "Could not access current location. Drop the pin manually.";
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });

  locationInput?.addEventListener("input", () => {
    state.reportLocation.label = locationInput.value;
  });
}

function updateReportLocation(lat, lng, label, status) {
  state.reportLocation = {
    label,
    lat,
    lng,
    status,
  };
}

function reportLocationIcon() {
  return window.L.divIcon({
    className: "",
    html: '<span class="leaflet-issue-marker report-pin"><span>!</span></span>',
    iconSize: [34, 42],
    iconAnchor: [17, 40],
    popupAnchor: [0, -36],
  });
}

function classifyReport(description) {
  const text = description.toLowerCase();
  const rules = [
    ["ROAD_DAMAGE", ["pothole", "road", "swerving", "junction", "crater", "tarmac"]],
    ["STREETLIGHT", ["streetlight", "light", "dark", "lamp", "electric"]],
    ["WATER_LEAK", ["water", "leak", "pipe", "burst", "flood"]],
    ["DRAINAGE", ["drain", "drainage", "blocked", "sewer", "stormwater"]],
    ["WASTE", ["dump", "garbage", "trash", "waste", "rubbish"]],
    ["PUBLIC_INFRASTRUCTURE", ["bench", "sign", "guardrail", "bridge", "public"]],
  ];
  const category = rules.find(([, words]) => words.some((word) => text.includes(word)))?.[0] || "OTHER";
  const dangerWords = ["huge", "massive", "danger", "hazard", "swerving", "flood", "burst", "blocked"];
  const priority = dangerWords.some((word) => text.includes(word)) ? "HIGH" : category === "OTHER" ? "LOW" : "MEDIUM";
  return { category, priority, summary: summarize(description, category) };
}

function summarize(description, category) {
  const cleaned = description.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 96) return cleaned;
  const label = category.replace("_", " ").toLowerCase();
  return `${capitalize(label)} issue reported: ${cleaned.slice(0, 86).trim()}...`;
}

function findDuplicate(description, category, lat, lng) {
  const candidates = state.store.incidents
    .filter((incident) => incident.status !== "RESOLVED")
    .filter((incident) => incident.category === category)
    .map((incident) => {
      const distance = distanceMeters(lat, lng, incident.lat, incident.lng);
      const semantic = similarity(description, incident.summary);
      const proximityBoost = distance < 60 ? 25 : distance < 150 ? 12 : 0;
      return { incident, distance, similarity: Math.min(99, semantic + proximityBoost) };
    })
    .filter((candidate) => candidate.distance <= 300 && candidate.similarity >= 45)
    .sort((a, b) => b.similarity - a.similarity);
  return candidates[0] || null;
}

async function completeReport(existingIncidentId) {
  if (!state.pendingReport || !state.lastTriage) return;
  state.isBusy = true;
  state.uploadStatus = state.pendingReport.photoFile ? "Uploading photo..." : "";
  render();

  let photoKey = null;
  try {
    photoKey = await uploadReportPhoto(state.pendingReport.photoFile);
    state.uploadStatus = photoKey ? "Photo uploaded successfully." : "";
  } catch (error) {
    state.isBusy = false;
    state.uploadStatus = "";
    alert(error.message);
    render();
    return;
  }

  try {
    const contact = contactPayload(state.pendingReport.contact);
    const payload = await apiFetch("/v1/reports", {
      method: "POST",
      body: JSON.stringify({
        description: state.pendingReport.description,
        location: {
          label: state.pendingReport.location,
          lat: state.pendingReport.lat,
          lng: state.pendingReport.lng,
        },
        contact,
        photoKey,
        triage: state.lastTriage,
        duplicateDecision: existingIncidentId
          ? { action: "ATTACH_TO_EXISTING", incidentId: existingIncidentId }
          : { action: "CREATE_NEW" },
      }),
    });
    const incident = apiIncidentToLocal(payload.publicIncident);
    upsertIncident(incident);
    state.selectedIncidentId = payload.incidentId;
    state.successIncidentId = payload.incidentId;
    state.lastTriage = null;
    state.lastDuplicate = null;
    state.pendingReport = null;
    state.apiOnline = true;
    state.isBusy = false;
    state.uploadStatus = "";
    state.view = "success";
    render();
    return;
  } catch (error) {
    state.apiOnline = false;
    state.isBusy = false;
    state.uploadStatus = "";
  }
  completeReportLocally(existingIncidentId);
}

function completeReportLocally(existingIncidentId) {
  if (!state.pendingReport || !state.lastTriage) return;
  const createdAt = new Date().toISOString();
  const reportId = `R${String(state.store.nextReportNumber++).padStart(3, "0")}`;
  let incidentId = existingIncidentId;

  if (!incidentId) {
    incidentId = `MTF-2026-${String(state.store.nextIncidentNumber++).padStart(5, "0")}`;
    state.store.incidents.unshift({
      id: incidentId,
      category: state.lastTriage.category,
      summary: state.lastTriage.summary,
      priority: state.lastTriage.priority,
      status: "REPORTED",
      location: state.pendingReport.location,
      lat: state.pendingReport.lat,
      lng: state.pendingReport.lng,
      reportIds: [],
      createdAt,
      updatedAt: createdAt,
      events: [makeEvent("Reported", "Citizen report received and incident created.", createdAt)],
    });
  }

  const incident = state.store.incidents.find((item) => item.id === incidentId);
  if (!incident) return;
  const { photoFile, ...pendingReport } = state.pendingReport;
  const report = { id: reportId, incidentId, createdAt, ...pendingReport };

  incident.reportIds.push(reportId);
  incident.updatedAt = createdAt;
  if (existingIncidentId) incident.events.push(makeEvent("Additional report", `Citizen report ${reportId} attached to this incident.`, createdAt));
  state.store.reports.unshift(report);
  state.selectedIncidentId = incidentId;
  state.successIncidentId = incidentId;
  state.lastTriage = null;
  state.lastDuplicate = null;
  state.pendingReport = null;
  state.isBusy = false;
  state.uploadStatus = "";
  state.view = "success";
  saveStore();
  render();
}

function contactPayload(value) {
  if (!value) return {};
  const trimmed = String(value).trim();
  if (!trimmed) return {};
  if (trimmed.includes("@")) return { email: trimmed, notify: true };
  return { phone: trimmed, notify: true };
}

function successView() {
  const incident = state.store.incidents.find((item) => item.id === state.successIncidentId) || state.store.incidents[0];
  return `
    <section class="success-shell">
      <div class="panel success-card">
        <div class="success-confetti" aria-hidden="true"></div>
        <div class="success-check">✓</div>
        <h1>Report Received!</h1>
        <p>Thank you for helping improve your community.</p>
        <div class="success-summary">
          ${metric("Tracking Number", incident.id)}
          ${metric("Category", titleCase(incident.category))}
          ${metric("Status", incident.status)}
          ${metric("Reports", `${incident.reportIds.length} so far`)}
        </div>
        <button class="primary full" id="track-success">Track This Report</button>
        <button class="light-button full" id="report-again">Report Another Issue</button>
      </div>
    </section>
  `;
}

function bindSuccess() {
  app.querySelector("#track-success")?.addEventListener("click", async () => {
    state.selectedIncidentId = state.successIncidentId;
    await loadTrackingIncident(state.successIncidentId);
    state.view = "track";
    render();
  });
  app.querySelector("#report-again")?.addEventListener("click", () => {
    state.view = "report";
    render();
  });
}

function trackView() {
  const selected = state.store.incidents.find((incident) => incident.id === state.selectedIncidentId) || state.store.incidents[0];
  return `
    <section class="workspace track-page">
      <div class="panel track-search">
        <div class="section-title"><span>Citizen tracking</span><strong>Track an issue</strong></div>
        <form id="track-form" class="track-form">
          <input name="tracking" value="${selected?.id || ""}" placeholder="MTF-2026-00182" />
          <button class="primary">Track</button>
        </form>
      </div>
      ${
        selected
          ? `
            <div class="track-content">
              ${trackingSummary(selected)}
              ${trackingTimeline(selected)}
            </div>
          `
          : `<p class="empty">No incidents yet.</p>`
      }
    </section>
  `;
}

function bindTrack() {
  app.querySelector("#track-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const tracking = String(new FormData(event.currentTarget).get("tracking") || "").trim().toUpperCase();
    state.selectedIncidentId = tracking;
    await loadTrackingIncident(tracking);
    render();
  });
}

function mapView() {
  const incidents = filteredMapIncidents();
  const total = state.store.incidents.length;
  return `
    <section class="workspace map-layout">
      <aside class="panel map-filter">
        <div class="map-filter-head">
          <div>
            <span>Filter Issues</span>
            <strong>${incidents.length} of ${total}</strong>
          </div>
          <button type="button" data-map-reset>Reset</button>
        </div>
        <fieldset>
          <legend>Category</legend>
          ${mapCategoryOption("ALL", "All Issues", total)}
          ${reportCategories.map(([value, label]) => mapCategoryOption(value, label, state.store.incidents.filter((incident) => incident.category === value).length)).join("")}
        </fieldset>
        <fieldset>
          <legend>Status</legend>
          ${mapCheckboxOption("status", "OPEN", "Open", mapStatusMatches("OPEN").length)}
          ${mapCheckboxOption("status", "IN_PROGRESS", "In Progress", mapStatusMatches("IN_PROGRESS").length)}
          ${mapCheckboxOption("status", "RESOLVED", "Resolved", mapStatusMatches("RESOLVED").length)}
        </fieldset>
        <fieldset>
          <legend>Priority</legend>
          ${["HIGH", "MEDIUM", "LOW"].map((priority) => mapCheckboxOption("priority", priority, titleCase(priority), state.store.incidents.filter((incident) => incident.priority === priority).length)).join("")}
        </fieldset>
      </aside>
      <div class="map-surface panel">
        <div id="community-map" class="leaflet-map" aria-label="Public community map"></div>
        <div class="map-legend" aria-label="Map legend">
          <span><b class="legend-dot high"></b>High</span>
          <span><b class="legend-dot medium"></b>Medium</span>
          <span><b class="legend-dot low"></b>Low / Resolved</span>
        </div>
      </div>
      <div class="panel map-list-panel">
        <div class="section-title"><span>Public incidents</span><strong>Community view</strong><p>${incidents.length ? "Filtered reports sorted by newest first." : "No incidents match these filters."}</p></div>
        <div class="incident-list">${incidents.length ? incidents.map((incident) => incidentCard(incident, false)).join("") : `<p class="empty">Try resetting filters or selecting another category.</p>`}</div>
      </div>
    </section>
  `;
}

function mapCategoryOption(value, label, count) {
  return `
    <label>
      <input type="radio" name="map-category" value="${escapeHtml(value)}" ${state.mapFilters.category === value ? "checked" : ""} />
      <span>${escapeHtml(label)}</span>
      <b>${count}</b>
    </label>
  `;
}

function mapCheckboxOption(type, value, label, count) {
  const selected = type === "status" ? state.mapFilters.statuses.includes(value) : state.mapFilters.priorities.includes(value);
  return `
    <label>
      <input type="checkbox" name="map-${escapeHtml(type)}" value="${escapeHtml(value)}" ${selected ? "checked" : ""} />
      <span>${escapeHtml(label)}</span>
      <b>${count}</b>
    </label>
  `;
}

function mapStatusMatches(statusGroup) {
  return state.store.incidents.filter((incident) => mapStatusGroup(incident.status) === statusGroup);
}

function mapStatusGroup(status) {
  if (status === "RESOLVED") return "RESOLVED";
  if (["ASSIGNED", "IN_PROGRESS"].includes(status)) return "IN_PROGRESS";
  return "OPEN";
}

function filteredMapIncidents() {
  return state.store.incidents
    .filter((incident) => {
      if (state.mapFilters.category !== "ALL" && incident.category !== state.mapFilters.category) return false;
      if (!state.mapFilters.statuses.includes(mapStatusGroup(incident.status))) return false;
      if (!state.mapFilters.priorities.includes(incident.priority)) return false;
      return true;
    })
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function bindMapFilters() {
  app.querySelector(".map-filter")?.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.name === "map-category") {
      state.mapFilters.category = input.value;
    }
    if (input.name === "map-status") {
      state.mapFilters.statuses = selectedMapCheckboxValues("map-status");
    }
    if (input.name === "map-priority") {
      state.mapFilters.priorities = selectedMapCheckboxValues("map-priority");
    }
    render();
  });

  app.querySelector("[data-map-reset]")?.addEventListener("click", () => {
    state.mapFilters = {
      category: "ALL",
      statuses: ["OPEN", "IN_PROGRESS", "RESOLVED"],
      priorities: ["HIGH", "MEDIUM", "LOW"],
    };
    render();
  });
}

function selectedMapCheckboxValues(name) {
  return Array.from(app.querySelectorAll(`input[name="${name}"]:checked`)).map((input) => input.value);
}

function initLeafletMap() {
  const mapEl = document.querySelector("#community-map");
  if (!mapEl || typeof window.L === "undefined") {
    mapEl?.classList.add("map-unavailable");
    if (mapEl) mapEl.innerHTML = "<p>Map is loading. Please refresh if it does not appear.</p>";
    return;
  }

  const validIncidents = filteredMapIncidents().filter((incident) => Number.isFinite(incident.lat) && Number.isFinite(incident.lng));
  const incidents = validIncidents.filter(isNairobiCoordinate);
  const center = incidents.length ? [incidents[0].lat, incidents[0].lng] : [-1.2864, 36.8219];
  const map = window.L.map(mapEl, {
    center,
    zoom: 12,
    scrollWheelZoom: false,
  });

  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const markers = incidents.map((incident) => {
    const marker = window.L.marker([incident.lat, incident.lng], { icon: incidentMarkerIcon(incident) }).addTo(map);
    marker.bindPopup(mapPopupContent(incident), { maxWidth: 280 });
    marker.on("click", () => {
      state.selectedIncidentId = incident.id;
    });
    return marker;
  });

  if (markers.length > 1) {
    const group = window.L.featureGroup(markers);
    map.fitBounds(group.getBounds().pad(0.18), { maxZoom: 14 });
  } else if (!markers.length) {
    mapEl.insertAdjacentHTML("beforeend", `<div class="map-empty-state">No mapped incidents match the selected filters.</div>`);
  }

  mapEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-map-track]");
    if (!button) return;
    state.selectedIncidentId = button.dataset.mapTrack;
    state.view = "track";
    render();
  });

  window.setTimeout(() => map.invalidateSize(), 0);
}

function initAdminMap() {
  const mapEl = document.querySelector("#admin-map");
  if (!mapEl || typeof window.L === "undefined") {
    mapEl?.classList.add("map-unavailable");
    if (mapEl) mapEl.innerHTML = "<p>Map is loading. Please refresh if it does not appear.</p>";
    return;
  }

  const incidents = state.store.incidents
    .filter((incident) => Number.isFinite(incident.lat) && Number.isFinite(incident.lng))
    .filter(isNairobiCoordinate);
  const center = incidents.length ? [incidents[0].lat, incidents[0].lng] : [-1.2864, 36.8219];
  const map = window.L.map(mapEl, {
    center,
    zoom: 12,
    scrollWheelZoom: false,
  });

  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const markers = incidents.map((incident) => {
    const marker = window.L.marker([incident.lat, incident.lng], { icon: incidentMarkerIcon(incident) }).addTo(map);
    marker.bindPopup(mapPopupContent(incident), { maxWidth: 280 });
    marker.on("click", () => {
      state.selectedIncidentId = incident.id;
    });
    return marker;
  });

  if (markers.length > 1) {
    const group = window.L.featureGroup(markers);
    map.fitBounds(group.getBounds().pad(0.2), { maxZoom: 13 });
  }

  mapEl.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-map-track]");
    if (!button) return;
    await selectAdminIncident(button.dataset.mapTrack, { scrollToDetail: true });
  });

  window.setTimeout(() => map.invalidateSize(), 0);
}

function isNairobiCoordinate(incident) {
  return incident.lat >= -1.55 && incident.lat <= -1.05 && incident.lng >= 36.55 && incident.lng <= 37.1;
}

function incidentMarkerIcon(incident) {
  const priorityClass = incident.status === "RESOLVED" ? "resolved" : incident.priority.toLowerCase();
  return window.L.divIcon({
    className: "",
    html: `<span class="leaflet-issue-marker ${priorityClass}"><span>${escapeHtml(incident.reportIds.length)}</span></span>`,
    iconSize: [34, 42],
    iconAnchor: [17, 40],
    popupAnchor: [0, -36],
  });
}

function mapPopupContent(incident) {
  return `
    <article class="leaflet-popup-card">
      <strong>${escapeHtml(incident.id)}</strong>
      <span>${escapeHtml(titleCase(incident.category))}</span>
      <small>${escapeHtml(incident.location)}</small>
      <div class="inline-metrics">
        <b>${escapeHtml(titleCase(incident.status))}</b>
        <b>${incident.reportIds.length} reports</b>
        <b>${escapeHtml(incident.priority)} Priority</b>
      </div>
      <button type="button" data-map-track="${escapeHtml(incident.id)}">View Details -></button>
    </article>
  `;
}

function adminView() {
  if (!state.adminAuthed) {
    return `
      <section class="workspace narrow">
        <div class="panel">
          <div class="section-title"><span>Administrator</span><strong>Sign in to manage incidents</strong></div>
          <form id="admin-login" class="stack">
            <label>Email<input name="email" type="email" autocomplete="username" /></label>
            <label>Password<input name="password" type="password" autocomplete="current-password" /></label>
            <button class="primary">Sign in</button>
            <p class="empty">Authorized staff can review, assign, and update community reports.</p>
          </form>
        </div>
      </section>
    `;
  }

  const incidents = filteredAdminIncidents();
  const selected = state.store.incidents.find((incident) => incident.id === state.selectedIncidentId) || incidents[0] || state.store.incidents[0];
  const activeReport = selectedAdminReport();
  const adminUser = adminUserProfile();
  return `
    <section class="admin-console">
      <aside class="admin-nav">
        <a class="admin-nav-brand" href="#" data-view="home" aria-label="MtaaFix home">
          <img src="/public/mtaafix-logo-web.png" alt="MtaaFix" />
        </a>
        <div class="admin-nav-links" aria-label="Admin navigation">
          ${adminNavItem("Dashboard", "dashboard", "dashboard", true)}
          ${adminNavItem("Incidents", "incidents", "incidents")}
          ${adminNavItem("Reports", "reports", "incidents")}
          ${adminNavItem("Map", "map", "map")}
          ${adminNavItem("Analytics", "analytics", "analytics")}
          <button type="button" data-view="home"><span>↗</span>Homepage</button>
        </div>
        <div class="admin-user-card">
          <div class="profile-avatar">${escapeHtml(adminUser.initials)}</div>
          <div>
            <strong>${escapeHtml(adminUser.name)}</strong>
            <small>System Administrator</small>
          </div>
          <button class="admin-user-chevron" type="button" id="admin-logout" aria-label="Logout">›</button>
        </div>
      </aside>
      <div class="admin-workspace">
        <div class="admin-toolbar">
          <label class="admin-global-search">
            <span>⌕</span>
            <input value="${escapeHtml(state.adminFilters.query)}" data-admin-global-search placeholder="Search incidents, tracking number, location or keyword..." />
            <kbd>⌘ K</kbd>
          </label>
          <div class="admin-toolbar-actions">
            <button class="admin-select" type="button" data-admin-jump="map">⌖ Nairobi County⌄</button>
            <button class="admin-select" type="button" data-admin-jump="analytics">□ Last 30 days⌄</button>
            <button class="admin-icon-button" type="button" data-admin-jump="incidents" aria-label="Notifications">♢<span>5</span></button>
            <div class="profile-avatar">${escapeHtml(adminUser.initials)}</div>
          </div>
        </div>
        <div class="admin-main">
          <nav class="admin-breadcrumbs" aria-label="Breadcrumb">
            <button type="button" data-view="home">Home</button>
            <span>/</span>
            <button type="button" data-admin-jump="dashboard">Admin</button>
            <span>/</span>
            <strong>Dashboard</strong>
          </nav>
          <div class="admin-title-row">
            <div>
              <h1>Dashboard</h1>
              <p>Overview of community issues and their resolution progress</p>
            </div>
            <button class="admin-add-button" type="button" data-view="report"><span>+</span> Add Incident <b>⌄</b></button>
          </div>
          <div data-admin-section="dashboard">${adminDashboardSummary()}</div>
          <div class="admin-grid-row" data-admin-section="analytics">
            ${adminCategoryDonut()}
            ${adminTrendPanel()}
            ${adminActivityPanel()}
          </div>
          <div class="admin-lower-grid">
            ${adminIncidentQueue(incidents)}
            <div class="admin-map-card" data-admin-section="map">
              <div class="admin-panel-head">
                <h2>Incident Map</h2>
                <button class="light-button" type="button" data-view="map">View Full Map</button>
              </div>
              <div id="admin-map" class="admin-map" aria-label="Admin map of public reports"></div>
              <div class="admin-map-legend">
                <span><b class="legend-dot high"></b>High Priority</span>
                <span><b class="legend-dot medium"></b>Medium</span>
                <span><b class="legend-dot low"></b>Low</span>
                <span><b class="legend-dot resolved"></b>Resolved</span>
              </div>
            </div>
          </div>
          <div class="admin-detail-drawer" data-admin-section="incident-detail">${selected ? incidentDetail(selected, true) : `<p class="empty">Select an incident.</p>`}</div>
        </div>
      </div>
    </section>
    ${activeReport ? reportModal(activeReport) : ""}
  `;
}

function adminNavItem(label, icon, target, active = false) {
  const icons = {
    dashboard: "▣",
    incidents: "⌂",
    reports: "▧",
    map: "⌖",
    analytics: "▥",
    users: "♙",
    teams: "☷",
    settings: "⚙",
  };
  return `<button class="${active ? "active" : ""}" type="button" data-admin-jump="${escapeHtml(target)}"><span>${icons[icon] || "•"}</span>${escapeHtml(label)}</button>`;
}

function adminDashboardSummary() {
  const incidents = state.store.incidents;
  const open = incidents.filter((incident) => incident.status !== "RESOLVED").length;
  const high = incidents.filter((incident) => incident.priority === "HIGH").length;
  const inProgress = incidents.filter((incident) => ["ASSIGNED", "IN_PROGRESS"].includes(incident.status)).length;
  const resolved = incidents.filter((incident) => incident.status === "RESOLVED").length;
  return `
    <div class="admin-kpis">
      ${adminKpi("Open Incidents", String(open), "vs previous 30 days", "-12%", "shield")}
      ${adminKpi("High Priority", String(high), "vs previous 30 days", "+6%", "alert")}
      ${adminKpi("In Progress", String(inProgress), "vs previous 30 days", "-8%", "tools")}
      ${adminKpi("Resolved", String(resolved), "vs previous 30 days", "+24%", "resolved")}
    </div>
  `;
}

function adminKpi(label, value, hint, delta, type) {
  const positive = delta.startsWith("+");
  return `
    <div class="admin-kpi ${escapeHtml(type)}">
      <div class="admin-kpi-icon">${adminKpiIcon(type)}</div>
      <div>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <small>${escapeHtml(hint)}</small>
      </div>
      <div class="admin-kpi-delta ${positive ? "up" : "down"}">${positive ? "↑" : "↓"} ${escapeHtml(delta)}</div>
      <svg viewBox="0 0 120 42" aria-hidden="true"><path d="M2 28 C14 12 24 34 36 18 S58 30 68 20 S86 10 96 24 S110 18 118 12" /></svg>
    </div>
  `;
}

function adminKpiIcon(type) {
  return {
    shield: "⬟",
    alert: "△",
    tools: "✣",
    resolved: "▧",
  }[type] || "•";
}

function adminCategoryData() {
  const colors = ["#2f80ed", "#ff7a1a", "#12b76a", "#f5bd22", "#8b5cf6", "#8ecbff", "#94a3b8"];
  return reportCategories.map(([value, label], index) => ({
    label,
    value: state.store.incidents.filter((incident) => incident.category === value).length,
    className: value.toLowerCase(),
    color: colors[index % colors.length],
  })).filter((item) => item.value > 0);
}

function adminCategoryDonut() {
  const items = adminCategoryData();
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
  let cursor = 0;
  const gradient = items.map((item) => {
    const start = cursor;
    cursor += (item.value / total) * 100;
    return `${item.color} ${start}% ${cursor}%`;
  }).join(", ");
  return `
    <div class="admin-chart-card admin-category-card">
      <div class="admin-panel-head"><h2>Incidents by Category</h2></div>
      <div class="category-donut-layout">
        <div class="category-donut" style="background: conic-gradient(${gradient});">
          <div><strong>${total}</strong><span>Total</span></div>
        </div>
        <div class="category-legend">
        ${items.map((item) => `
          <span><b style="background:${item.color}"></b>${escapeHtml(item.label)} <strong>${Math.round((item.value / total) * 100)}%</strong></span>
        `).join("")}
        </div>
      </div>
    </div>
  `;
}

function adminTrendPanel() {
  const trend = adminTrendData();
  return `
    <div class="admin-chart-card admin-trend-card">
      <div class="admin-panel-head">
        <h2>Incident Status Trend</h2>
        <button class="admin-select compact" type="button">Last 30 days⌄</button>
      </div>
      <div class="trend-legend">
        <span><b class="reported"></b>Reported</span>
        <span><b class="progress"></b>In Progress</span>
        <span><b class="resolved"></b>Resolved</span>
      </div>
      <svg class="trend-chart" viewBox="0 0 640 230" role="img" aria-label="Incident status trend chart">
        <g class="trend-grid">
          <path d="M50 20 H620 M50 70 H620 M50 120 H620 M50 170 H620 M50 220 H620" />
          <path d="M50 20 V220 M160 20 V220 M270 20 V220 M380 20 V220 M490 20 V220 M620 20 V220" />
        </g>
        <g class="trend-axis">
          ${trend.axisLabels.map((label) => `<text x="${label.x}" y="${label.y}">${escapeHtml(label.text)}</text>`).join("")}
        </g>
        <path class="trend-fill resolved" d="${trend.fillPath}" />
        <path class="trend-line reported" d="${trend.reportedPath}" />
        <path class="trend-line progress" d="${trend.progressPath}" />
        <path class="trend-line resolved" d="${trend.resolvedPath}" />
      </svg>
    </div>
  `;
}

function adminTrendData() {
  const days = Array.from({ length: 30 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (29 - index));
    return date;
  });
  const counts = days.map((day) => {
    const end = new Date(day);
    end.setHours(23, 59, 59, 999);
    const created = state.store.incidents.filter((incident) => new Date(incident.createdAt).getTime() <= end.getTime());
    return {
      reported: created.length,
      progress: created.filter((incident) => ["ASSIGNED", "IN_PROGRESS"].includes(incident.status)).length,
      resolved: created.filter((incident) => incident.status === "RESOLVED").length,
    };
  });
  const max = Math.max(1, ...counts.flatMap((item) => [item.reported, item.progress, item.resolved]));
  const xFor = (index) => 50 + (index / 29) * 570;
  const yFor = (value) => 220 - (value / max) * 200;
  const points = (key) => counts.map((item, index) => [xFor(index), yFor(item[key])]);
  const path = (items) => items.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const resolvedPoints = points("resolved");
  const axisLabels = [
    { x: 20, y: 224, text: "0" },
    { x: 18, y: 174, text: String(Math.round(max * 0.25)) },
    { x: 18, y: 124, text: String(Math.round(max * 0.5)) },
    { x: 18, y: 74, text: String(Math.round(max * 0.75)) },
    { x: 18, y: 24, text: String(max) },
    ...[0, 7, 14, 21, 29].map((index) => ({ x: xFor(index) - 8, y: 246, text: days[index].toLocaleDateString("en-KE", { month: "short", day: "numeric" }) })),
  ];
  return {
    axisLabels,
    reportedPath: path(points("reported")),
    progressPath: path(points("progress")),
    resolvedPath: path(resolvedPoints),
    fillPath: `${path(resolvedPoints)} L620 220 L50 220 Z`,
  };
}

function adminActivityPanel() {
  const items = state.store.incidents.slice(0, 4);
  const activityLabels = ["Incident resolved", "Work in progress", "Assigned to Roads Team", "Incident verified"];
  return `
    <div class="admin-activity-card">
      <div class="admin-panel-head"><h2>Recent Activity</h2><button type="button">View all</button></div>
      <div class="activity-list">
        ${items.map((incident, index) => `
          <div class="activity-item">
            <span class="activity-dot type-${index}">${["✓", "✣", "●", "↗"][index] || "•"}</span>
            <div>
              <strong>${escapeHtml(activityLabels[index] || "Incident updated")}</strong>
              <small>${escapeHtml(incident.id)}</small>
              <span>${index ? `${index + 1} hours ago` : "2 hours ago"}</span>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function adminFiltersView() {
  const categoryOptions = [["ALL", "All categories"], ...reportCategories.map(([value, label]) => [value, label])];
  return `
    <form id="admin-filters" class="admin-filters">
      <label class="admin-search">Search
        <input name="query" value="${escapeHtml(state.adminFilters.query)}" placeholder="Search ID, location, summary..." />
      </label>
      <label>Status
        <select name="status">
          ${[
            ["ALL", "All statuses"],
            ["OPEN", "Open"],
            ["ACTIVE", "In Progress"],
            ["RESOLVED", "Resolved"],
            ["VERIFIED", "Verified"],
            ["ASSIGNED", "Assigned"],
          ].map(([status, label]) => `<option value="${status}" ${state.adminFilters.status === status ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </label>
      <label>Priority
        <select name="priority">
          ${["ALL", "HIGH", "MEDIUM", "LOW"].map((priority) => `<option value="${priority}" ${state.adminFilters.priority === priority ? "selected" : ""}>${priority === "ALL" ? "All priorities" : titleCase(priority)}</option>`).join("")}
        </select>
      </label>
      <label>Category
        <select name="category">
          ${categoryOptions.map(([value, label]) => `<option value="${value}" ${state.adminFilters.category === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </label>
    </form>
  `;
}

function bindAdmin() {
  app.querySelector("#admin-logout")?.addEventListener("click", () => {
    sessionStorage.removeItem("mtaafix.admin.token");
    state.adminToken = "";
    state.adminAuthed = false;
    state.adminReportsByIncident = {};
    state.selectedAdminReportId = "";
    render();
  });

  app.querySelector("[data-admin-global-search]")?.addEventListener("input", (event) => {
    state.adminFilters.query = event.currentTarget.value;
    window.clearTimeout(adminFilterRenderTimer);
    adminFilterRenderTimer = window.setTimeout(() => {
      const incidents = filteredAdminIncidents();
      if (!incidents.some((incident) => incident.id === state.selectedIncidentId)) {
        state.selectedIncidentId = incidents[0]?.id || "";
      }
      state.selectedAdminReportId = "";
      render();
    }, 220);
  });

  app.querySelectorAll("[data-admin-jump]").forEach((el) => {
    el.addEventListener("click", () => {
      const section = app.querySelector(`[data-admin-section="${el.dataset.adminJump}"]`);
      section?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  app.querySelectorAll("[data-admin-status-filter]").forEach((el) => {
    el.addEventListener("click", () => {
      state.adminFilters.status = el.dataset.adminStatusFilter || "ALL";
      const incidents = filteredAdminIncidents();
      state.selectedIncidentId = incidents[0]?.id || "";
      state.selectedAdminReportId = "";
      render();
    });
  });

  app.querySelector("#admin-filters")?.addEventListener("change", (event) => {
    const formData = new FormData(event.currentTarget);
    state.adminFilters = {
      status: String(formData.get("status") || "ALL"),
      priority: String(formData.get("priority") || "ALL"),
      category: String(formData.get("category") || "ALL"),
      query: String(formData.get("query") || ""),
    };
    const incidents = filteredAdminIncidents();
    if (!incidents.some((incident) => incident.id === state.selectedIncidentId)) {
      state.selectedIncidentId = incidents[0]?.id || "";
    }
    state.selectedAdminReportId = "";
    render();
  });

  app.querySelector("#admin-filters")?.addEventListener("input", (event) => {
    const formData = new FormData(event.currentTarget);
    state.adminFilters = {
      status: String(formData.get("status") || "ALL"),
      priority: String(formData.get("priority") || "ALL"),
      category: String(formData.get("category") || "ALL"),
      query: String(formData.get("query") || ""),
    };
    window.clearTimeout(adminFilterRenderTimer);
    adminFilterRenderTimer = window.setTimeout(() => {
      const incidents = filteredAdminIncidents();
      if (!incidents.some((incident) => incident.id === state.selectedIncidentId)) {
        state.selectedIncidentId = incidents[0]?.id || "";
      }
      state.selectedAdminReportId = "";
      render();
    }, 220);
  });

  app.querySelector("[data-admin-focus-filter]")?.addEventListener("click", () => {
    app.querySelector("#admin-filters input[name='query']")?.focus();
  });

  app.querySelector("[data-admin-export]")?.addEventListener("click", () => {
    exportAdminIncidents(filteredAdminIncidents());
  });

  app.querySelectorAll("[data-open-report]").forEach((el) => {
    el.addEventListener("click", () => {
      state.selectedAdminReportId = el.dataset.openReport || "";
      render();
    });
  });

  app.querySelector("[data-close-report]")?.addEventListener("click", () => {
    state.selectedAdminReportId = "";
    render();
  });

  app.querySelector("#admin-login")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      const token = await cognitoSignIn(String(formData.get("email") || ""), String(formData.get("password") || ""));
      if (!token) throw new Error("Sign-in was not completed. Please try again.");
      state.adminToken = token;
      sessionStorage.setItem("mtaafix.admin.token", token);
      state.adminAuthed = true;
      await refreshAdminIncidents();
      try {
        await loadAdminIncidentDetails(state.selectedIncidentId);
      } catch (error) {
        console.warn(error);
      }
      render();
    } catch (error) {
      alert(error.message);
    }
  });

  app.querySelectorAll("[data-select-incident]").forEach((el) => {
    el.addEventListener("click", () => selectAdminIncident(el.dataset.selectIncident || "", { scrollToDetail: true }));
  });

  app.querySelector("#admin-update")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const incident = state.store.incidents.find((item) => item.id === String(formData.get("incidentId")));
    if (!incident) return;
    const status = String(formData.get("status"));
    const priority = String(formData.get("priority"));
    const assignedTo = String(formData.get("assignedTo") || "").trim();
    const publicUpdate = String(formData.get("publicUpdate") || "").trim();
    const resolution = String(formData.get("resolution") || "").trim();
    const changedAt = new Date().toISOString();

    if (state.adminToken) {
      try {
        const payload = await adminFetch(`/v1/admin/incidents/${encodeURIComponent(incident.id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            status,
            priority,
            assignedTo: assignedTo || null,
            resolution: resolution || null,
            publicUpdate: publicUpdate || resolution || `Status changed from ${incident.status} to ${status}.`,
            publicVisible: true,
          }),
        });
        upsertIncident(apiIncidentToLocal(payload.incident));
        await loadAdminIncidentDetails(incident.id);
        render();
        return;
      } catch (error) {
        alert(error.message);
      }
    }

    if (status !== incident.status) incident.events.push(makeEvent(titleCase(status), `Status changed from ${incident.status} to ${status}.`, changedAt));
    if (publicUpdate) incident.events.push(makeEvent(titleCase(status), publicUpdate, changedAt));
    if (resolution && resolution !== incident.resolution) incident.events.push(makeEvent("Resolution update", resolution, changedAt));

    incident.status = status;
    incident.priority = priority;
    incident.assignedTo = assignedTo || undefined;
    incident.resolution = resolution || undefined;
    incident.updatedAt = changedAt;
    saveStore();
    render();
  });
}

async function selectAdminIncident(incidentId, { scrollToDetail = false } = {}) {
  if (!incidentId) return;
  state.selectedIncidentId = incidentId;
  state.selectedAdminReportId = "";
  render();
  try {
    await loadAdminIncidentDetails(incidentId);
  } catch (error) {
    console.warn(error);
  }
  render();
  if (scrollToDetail) {
    window.setTimeout(() => app.querySelector("[data-admin-section='incident-detail']")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }
}

function exportAdminIncidents(incidents) {
  const rows = [
    ["Tracking No.", "Summary", "Location", "Category", "Priority", "Status", "Reports", "Reported", "Assigned To"],
    ...incidents.map((incident) => [
      incident.id,
      incident.summary,
      incident.location,
      titleCase(incident.category),
      incident.priority,
      titleCase(incident.status),
      String(incident.reportIds.length),
      formatDate(incident.createdAt),
      incident.assignedTo || "",
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mtaafix-incidents-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function incidentCard(incident, admin) {
  return `
    <button class="incident-card" ${admin ? `data-select-incident="${incident.id}"` : `data-track-incident="${incident.id}"`}>
      <span class="status-dot ${incident.status.toLowerCase()}"></span>
      <span><strong>${incident.id}</strong><small>${incident.summary}</small></span>
      <b>${incident.reportIds.length}</b>
    </button>
  `;
}

function bindPublicIncidentLinks() {
  app.querySelectorAll("[data-track-incident]").forEach((el) => {
    el.addEventListener("click", async () => {
      state.selectedIncidentId = el.dataset.trackIncident || "";
      state.view = "track";
      await loadTrackingIncident(state.selectedIncidentId);
      render();
    });
  });
}

function adminIncidentQueue(incidents) {
  return `
    <div class="admin-table-card" data-admin-section="incidents">
      <div class="admin-panel-head">
        <h2>Recent Incidents</h2>
        <div class="admin-table-actions">
          <button class="light-button" type="button" data-admin-focus-filter>≡ Filters</button>
          <button class="light-button" type="button" data-admin-export>⇩ Export</button>
        </div>
      </div>
      <div class="admin-table-tabs">
        ${adminTableTab("ALL", `All (${state.store.incidents.length})`)}
        ${adminTableTab("OPEN", `Open (${state.store.incidents.filter((incident) => incident.status === "REPORTED").length})`)}
        ${adminTableTab("ACTIVE", `In Progress (${state.store.incidents.filter((incident) => ["ASSIGNED", "IN_PROGRESS"].includes(incident.status)).length})`)}
        ${adminTableTab("RESOLVED", `Resolved (${state.store.incidents.filter((incident) => incident.status === "RESOLVED").length})`)}
      </div>
      ${adminFiltersView()}
      <div class="admin-table-wrap" role="region" aria-label="Incident queue">
      <table class="admin-table">
        <thead>
          <tr>
            <th><input type="checkbox" aria-label="Select all incidents" /></th>
            <th>Tracking No.</th>
            <th>Photo</th>
            <th>Title / Location</th>
            <th>Category</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Reports</th>
            <th>Reported</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${incidents.length ? incidents.map(adminIncidentRow).join("") : `<tr><td colspan="10"><p class="empty">No incidents match these filters.</p></td></tr>`}
        </tbody>
      </table>
      </div>
    </div>
  `;
}

function adminTableTab(status, label) {
  return `<button class="${state.adminFilters.status === status ? "active" : ""}" type="button" data-admin-status-filter="${status}">${escapeHtml(label)}</button>`;
}

function adminIncidentRow(incident) {
  const isSelected = incident.id === state.selectedIncidentId;
  const photoUrl = adminIncidentPhotoUrl(incident.id);
  return `
    <tr class="${isSelected ? "selected" : ""}">
      <td><input type="checkbox" aria-label="Select ${escapeHtml(incident.id)}" /></td>
      <td><button type="button" class="tracking-link" data-select-incident="${escapeHtml(incident.id)}">${escapeHtml(incident.id)}</button></td>
      <td>${photoUrl ? `<img class="incident-thumb" src="${escapeHtml(photoUrl)}" alt="Attached photo for ${escapeHtml(incident.id)}" />` : `<div class="incident-thumb ${incident.category.toLowerCase()}"></div>`}</td>
      <td>
        <button type="button" class="table-incident-button" data-select-incident="${escapeHtml(incident.id)}">
          <span>${escapeHtml(incident.summary)}</span>
          <small>⌖ ${escapeHtml(incident.location)}</small>
        </button>
      </td>
      <td><span class="badge category ${incident.category.toLowerCase()}">${escapeHtml(titleCase(incident.category))}</span></td>
      <td><span class="badge ${incident.priority.toLowerCase()}">${incident.priority}</span></td>
      <td><span class="badge ${incident.status.toLowerCase()}">${titleCase(incident.status)}</span></td>
      <td>${incident.reportIds.length}</td>
      <td><span class="reported-date">${formatDate(incident.createdAt)}</span></td>
      <td><button type="button" class="row-menu" data-select-incident="${escapeHtml(incident.id)}">•••</button></td>
    </tr>
  `;
}

function adminIncidentPhotoUrl(incidentId) {
  const reports = state.adminReportsByIncident[incidentId] || [];
  return reports.find((report) => report.photoUrl)?.photoUrl || "";
}

function adminAgeBadge(incident) {
  if (incident.status === "RESOLVED") return `<span class="age-badge resolved">Closed</span>`;
  const days = unresolvedAgeDays(incident);
  if (days >= 14) return `<span class="age-badge overdue">${days}d overdue</span>`;
  if (days >= 7) return `<span class="age-badge aging">${days}d aging</span>`;
  return `<span class="age-badge fresh">${days}d open</span>`;
}

function trackingSummary(incident) {
  const photos = state.trackingPhotosByIncident[incident.id] || [];
  const primaryPhoto = photos.find((photo) => photo.viewUrl);
  return `
    <article class="panel tracking-card">
      <div class="tracking-hero">
        ${
          primaryPhoto
            ? `<img class="mini-photo" src="${escapeHtml(primaryPhoto.viewUrl)}" alt="Attached issue photo for ${escapeHtml(incident.id)}" />`
            : `<div class="mini-photo empty-photo">No photo yet</div>`
        }
        <div>
          <span class="eyebrow">Incident Details</span>
          <h1>${incident.id}</h1>
          <p>${incident.summary}</p>
          <div class="tracking-pills">
            <span class="badge ${incident.status.toLowerCase()}">${titleCase(incident.status)}</span>
            <span class="badge ${incident.priority.toLowerCase()}">${incident.priority} Priority</span>
          </div>
        </div>
      </div>
      <div class="tracking-facts">
        ${fact("⌖", "Reports", String(incident.reportIds.length))}
        ${fact("◷", "Reported", formatDate(incident.createdAt))}
        ${fact("♙", "Assigned", incident.assignedTo || "Pending")}
      </div>
      ${trackingPhotosView(incident, photos)}
      <button class="light-button track-map-button" data-view="map">View on Map</button>
    </article>
  `;
}

function trackingPhotosView(incident, photos) {
  const viewablePhotos = photos.filter((photo) => photo.viewUrl);
  if (!viewablePhotos.length) return "";
  return `
    <div class="tracking-photos" aria-label="Attached issue photos">
      ${viewablePhotos.slice(0, 4).map((photo, index) => `
        <figure>
          <img src="${escapeHtml(photo.viewUrl)}" alt="Submitted issue photo ${index + 1} for ${escapeHtml(incident.id)}" />
          <figcaption>${formatDate(photo.createdAt)}</figcaption>
        </figure>
      `).join("")}
    </div>
  `;
}

function trackingTimeline(incident) {
  return `
    <aside class="panel timeline-panel">
      <div class="section-title"><span>Progress</span><strong>Incident Timeline</strong></div>
      <ol class="status-timeline">
        ${statusOrder.map((status) => timelineStep(incident, status)).join("")}
      </ol>
    </aside>
  `;
}

function timelineStep(incident, status) {
  const event = incident.events.find((item) => normalizeStatus(item.label) === status) || statusFallback(incident, status);
  const currentIndex = statusOrder.indexOf(incident.status);
  const itemIndex = statusOrder.indexOf(status);
  const isDone = itemIndex <= currentIndex;
  const isCurrent = itemIndex === currentIndex;
  return `
    <li class="${isDone ? "done" : ""} ${isCurrent ? "current" : ""}">
      <span class="timeline-node">${isDone ? "✓" : ""}</span>
      <div>
        <strong>${titleCase(status)}</strong>
        <small>${event?.at ? formatDate(event.at) : "Will be updated once reached."}</small>
        <p>${event?.detail || statusCopy(status)}</p>
      </div>
    </li>
  `;
}

function statusFallback(incident, status) {
  if (status === "REPORTED") {
    return incident.events[0] || { detail: "Your report has been received.", at: incident.createdAt };
  }
  return null;
}

function fact(icon, label, value) {
  return `
    <div class="tracking-fact">
      <b>${icon}</b>
      <span>${value}</span>
      <small>${label}</small>
    </div>
  `;
}

function incidentDetail(incident, admin) {
  const reports = admin
    ? state.adminReportsByIncident[incident.id] || state.store.reports.filter((report) => report.incidentId === incident.id)
    : state.store.reports.filter((report) => report.incidentId === incident.id);
  const loadingReports = state.adminLoadingIncidentId === incident.id;
  return `
    <article class="panel incident-detail">
      <div class="detail-head">
        <div>
          <span class="eyebrow">${incident.category}</span>
          <h1>${incident.id}</h1>
          <p>${incident.summary}</p>
        </div>
        <span class="badge ${incident.priority.toLowerCase()}">${incident.priority}</span>
      </div>
      <div class="stat-row">
        ${metric("Status", incident.status)}
        ${metric("Reports", String(incident.reportIds.length))}
        ${metric("Location", incident.location)}
        ${metric("Updated", formatDate(incident.updatedAt))}
      </div>
      <div class="progress">
        ${statusOrder.map((status) => `<span class="${statusOrder.indexOf(status) <= statusOrder.indexOf(incident.status) ? "done" : ""}">${titleCase(status)}</span>`).join("")}
      </div>
      <h2>Timeline</h2>
      <ol class="timeline">
        ${incident.events.map((item) => `
          <li><strong>${item.label}</strong><span>${item.detail}</span><small>${formatDate(item.at)}</small></li>
        `).join("")}
      </ol>
      ${
        admin
          ? `
            <form id="admin-update" class="admin-form">
              <input type="hidden" name="incidentId" value="${incident.id}" />
              <label>Status<select name="status">${statusOrder.map((status) => `<option ${status === incident.status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
              <label>Priority<select name="priority">${["LOW", "MEDIUM", "HIGH"].map((priority) => `<option ${priority === incident.priority ? "selected" : ""}>${priority}</option>`).join("")}</select></label>
              <label>Assigned team<input name="assignedTo" value="${incident.assignedTo || ""}" placeholder="Road maintenance team" /></label>
              <label>Progress note<textarea name="publicUpdate" rows="3" placeholder="Short update visible on the public timeline."></textarea></label>
              <label>Resolution information<textarea name="resolution" rows="3" placeholder="Repair completed, area reopened.">${incident.resolution || ""}</textarea></label>
              <button class="primary">Update incident</button>
            </form>
            <h2>Citizen reports</h2>
            <div class="reports">
              ${
                loadingReports
                  ? `<p class="empty">Loading report details...</p>`
                  : reports.length
                    ? reports.map(adminReportCard).join("")
                    : `<p class="empty">No detailed citizen reports are available yet.</p>`
              }
            </div>
          `
          : ""
      }
    </article>
  `;
}

function adminReportCard(report) {
  const reportId = report.reportId || report.id || "Report";
  const location = typeof report.location === "string" ? report.location : report.location?.label || "Location not provided";
  const contact = report.contactEmail || report.contactPhone || report.contact || "No contact provided";
  return `
    <article class="report-card">
      ${report.photoUrl ? `<img class="report-photo" src="${escapeHtml(report.photoUrl)}" alt="Attached issue photo for ${escapeHtml(reportId)}" />` : `<div class="report-photo empty-photo">No photo</div>`}
      <div class="report-copy">
        <div class="report-head">
          <strong>${escapeHtml(reportId)}</strong>
          <span>${formatDate(report.createdAt)}</span>
        </div>
        <p>${escapeHtml(report.description || "No description provided.")}</p>
        <div class="report-meta">
          <span>${escapeHtml(location)}</span>
          <span>${escapeHtml(contact)}</span>
          ${report.photoKey ? `<span>Photo attached</span>` : `<span>No photo attached</span>`}
        </div>
        <button class="light-button report-open" type="button" data-open-report="${escapeHtml(reportId)}">View report</button>
      </div>
    </article>
  `;
}

function reportModal(report) {
  const reportId = report.reportId || report.id || "Report";
  const location = typeof report.location === "string" ? report.location : report.location?.label || "Location not provided";
  const contact = report.contactEmail || report.contactPhone || report.contact || "No contact provided";
  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Report details">
      <article class="panel report-modal">
        <button class="modal-close" type="button" data-close-report aria-label="Close report details">×</button>
        <div class="report-modal-media">
          ${report.photoUrl ? `<img src="${escapeHtml(report.photoUrl)}" alt="Attached issue photo for ${escapeHtml(reportId)}" />` : `<div class="empty-photo">No photo attached</div>`}
        </div>
        <div class="report-modal-body">
          <span class="eyebrow">Citizen report</span>
          <h2>${escapeHtml(reportId)}</h2>
          <p>${escapeHtml(report.description || "No description provided.")}</p>
          <div class="stat-row">
            ${metric("Submitted", formatDate(report.createdAt))}
            ${metric("Contact", escapeHtml(contact))}
            ${metric("Location", escapeHtml(location))}
            ${metric("Attachment", report.photoKey ? "Photo attached" : "No photo")}
          </div>
        </div>
      </article>
    </div>
  `;
}

function metric(label, value) {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const earth = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function similarity(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  const intersection = [...left].filter((word) => right.has(word)).length;
  const union = new Set([...left, ...right]).size || 1;
  return Math.round((intersection / union) * 100);
}

function tokenSet(value) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((word) => word.length > 3),
  );
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date not available";
  return new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function titleCase(value) {
  return value.toLowerCase().split("_").map(capitalize).join(" ");
}

function normalizeStatus(value) {
  const normalized = String(value || "").toUpperCase().replace(/\s+/g, "_");
  return normalized === "IN_PROGRESS" ? "IN_PROGRESS" : normalized;
}

function statusCopy(status) {
  return {
    REPORTED: "Your report has been received.",
    VERIFIED: "The issue has been verified by the team.",
    ASSIGNED: "Assigned to the responsible team.",
    IN_PROGRESS: "Work is currently underway.",
    RESOLVED: "Will be updated once resolved.",
  }[status] || "Status update pending.";
}
