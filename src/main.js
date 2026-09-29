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
  adminReportsByIncident: {},
  adminLoadingIncidentId: "",
  adminToken: sessionStorage.getItem("mtaafix.admin.token") || "",
};

const app = document.querySelector("#app");
if (!app) throw new Error("App root not found");

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
  app.innerHTML = `
    <header class="topbar">
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
    </header>
    <main>
      ${state.view === "home" ? homeView() : ""}
      ${state.view === "report" ? reportView() : ""}
      ${state.view === "track" ? trackView() : ""}
      ${state.view === "map" ? mapView() : ""}
      ${state.view === "admin" ? adminView() : ""}
      ${state.view === "about" ? aboutView() : ""}
      ${state.view === "success" ? successView() : ""}
    </main>
    ${footerView()}
  `;

  bindNavigation();
  if (state.view === "report") bindReport();
  if (state.view === "track") bindTrack();
  if (state.view === "admin") bindAdmin();
  if (state.view === "home") bindHome();
  if (state.view === "success") bindSuccess();
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
            <label>Location<input name="location" required value="Ngong Road, Nairobi" /></label>
            <label>Contact for updates<input name="contact" placeholder="email or phone, optional" /></label>
          </div>
          <div class="grid two">
            <label>Latitude<input name="lat" type="number" step="0.0001" value="-1.2862" /></label>
            <label>Longitude<input name="lng" type="number" step="0.0001" value="36.8222" /></label>
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
    const lat = Number(formData.get("lat") || -1.2862);
    const lng = Number(formData.get("lng") || 36.8222);
    const file = formData.get("photo");
    if (file?.name) setSelectedPhoto(file);

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
  app.querySelector("#track-success")?.addEventListener("click", () => {
    state.selectedIncidentId = state.successIncidentId;
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
  const incidents = state.store.incidents;
  const highlighted = incidents[0];
  return `
    <section class="workspace map-layout">
      <aside class="panel map-filter">
        <strong>Filter Issues</strong>
        <label><input type="radio" checked /> All Issues</label>
        <label><input type="radio" /> Road Damage</label>
        <label><input type="radio" /> Streetlight</label>
        <label><input type="radio" /> Water Leak</label>
        <label><input type="radio" /> Drainage</label>
        <label><input type="radio" /> Waste</label>
        <strong>Status</strong>
        <label><input type="checkbox" checked /> Open</label>
        <label><input type="checkbox" checked /> In Progress</label>
        <label><input type="checkbox" checked /> Resolved</label>
        <strong>Priority</strong>
        <label><input type="checkbox" checked /> High</label>
        <label><input type="checkbox" checked /> Medium</label>
        <label><input type="checkbox" /> Low</label>
      </aside>
      <div class="map-surface panel" aria-label="Public community map">
        ${incidents.map((incident, index) => `
          <button class="pin ${incident.priority.toLowerCase()} ${incident.status === "RESOLVED" ? "resolved" : ""}"
            style="--x:${18 + ((index * 27) % 68)}%;--y:${22 + ((index * 19) % 58)}%"
            data-incident="${incident.id}">
            <span>${incident.id}</span>
          </button>
        `).join("")}
        <div class="map-popup">
          <div class="mini-photo"></div>
          <div>
            <strong>${highlighted.id}</strong>
            <span>${titleCase(highlighted.category)}</span>
            <small>${highlighted.location}</small>
            <div class="inline-metrics">
              <b>${titleCase(highlighted.status)}</b>
              <b>${highlighted.reportIds.length} reports</b>
              <b>${highlighted.priority} Priority</b>
            </div>
            <button data-view="track">View Details →</button>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="section-title"><span>Public incidents</span><strong>Community view</strong></div>
        <div class="incident-list">${incidents.map((incident) => incidentCard(incident, false)).join("")}</div>
      </div>
    </section>
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

  const selected = state.store.incidents.find((incident) => incident.id === state.selectedIncidentId) || state.store.incidents[0];
  return `
    <section class="admin-shell">
      <aside class="panel admin-sidebar">
        <div class="section-title"><span>Queue</span><strong>${state.store.incidents.length} incidents</strong></div>
        <div class="stat-row">
          ${metric("Open", String(state.store.incidents.filter((i) => i.status !== "RESOLVED").length))}
          ${metric("High", String(state.store.incidents.filter((i) => i.priority === "HIGH").length))}
        </div>
        <div class="incident-list">${state.store.incidents.map((incident) => incidentCard(incident, true)).join("")}</div>
      </aside>
      <section class="admin-detail">${selected ? incidentDetail(selected, true) : `<p class="empty">Select an incident.</p>`}</section>
    </section>
  `;
}

function bindAdmin() {
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
    el.addEventListener("click", async () => {
      state.selectedIncidentId = el.dataset.selectIncident || "";
      render();
      try {
        await loadAdminIncidentDetails(state.selectedIncidentId);
      } catch (error) {
        alert("Unable to load report details right now.");
      }
      render();
    });
  });

  app.querySelector("#admin-update")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const incident = state.store.incidents.find((item) => item.id === String(formData.get("incidentId")));
    if (!incident) return;
    const status = String(formData.get("status"));
    const priority = String(formData.get("priority"));
    const assignedTo = String(formData.get("assignedTo") || "").trim();
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
            publicUpdate: resolution || `Status changed from ${incident.status} to ${status}.`,
            publicVisible: true,
          }),
        });
        upsertIncident(apiIncidentToLocal(payload.incident));
        render();
        return;
      } catch (error) {
        alert(error.message);
      }
    }

    if (status !== incident.status) incident.events.push(makeEvent(titleCase(status), `Status changed from ${incident.status} to ${status}.`, changedAt));
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

function incidentCard(incident, admin) {
  return `
    <button class="incident-card" ${admin ? `data-select-incident="${incident.id}"` : ""}>
      <span class="status-dot ${incident.status.toLowerCase()}"></span>
      <span><strong>${incident.id}</strong><small>${incident.summary}</small></span>
      <b>${incident.reportIds.length}</b>
    </button>
  `;
}

function trackingSummary(incident) {
  return `
    <article class="panel tracking-card">
      <div class="tracking-hero">
        <div class="mini-photo"></div>
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
      <button class="light-button track-map-button" data-view="map">View on Map</button>
    </article>
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
      ${report.photoUrl ? `<img class="report-photo" src="${report.photoUrl}" alt="Attached issue photo for ${escapeHtml(reportId)}" />` : `<div class="report-photo empty-photo">No photo</div>`}
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
      </div>
    </article>
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
