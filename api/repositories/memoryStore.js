import { roughGeohash } from "../lib/geo.js";
import { eventId, incidentId, reportId } from "../lib/ids.js";

export function createMemoryStore(seed = defaultSeed()) {
  const state = structuredClone(seed);

  return {
    listPublicIncidents(filters = {}) {
      return filterIncidents(state.incidents, filters).map(toPublicIncident);
    },
    listAdminIncidents(filters = {}) {
      return filterIncidents(state.incidents, filters).map(toAdminIncident);
    },
    getIncident(id) {
      return state.incidents.find((incident) => incident.incidentId === id) || null;
    },
    getPublicIncident(id) {
      const incident = this.getIncident(id);
      return incident ? toPublicIncident(incident) : null;
    },
    getEvents(incidentId, { publicOnly = false } = {}) {
      return state.events
        .filter((event) => event.incidentId === incidentId)
        .filter((event) => !publicOnly || event.publicVisible)
        .sort((a, b) => a.at.localeCompare(b.at));
    },
    getReports(incidentId) {
      return state.reports.filter((report) => report.incidentId === incidentId);
    },
    openIncidents() {
      return state.incidents.filter((incident) => incident.status !== "RESOLVED");
    },
    createReport({ description, location, contact, photoKey, triage, duplicateDecision }) {
      const now = new Date().toISOString();
      const nextReportId = reportId(state.nextReportSequence++);
      let incident;
      let attachedToExisting = duplicateDecision?.action === "ATTACH_TO_EXISTING";

      if (attachedToExisting) {
        incident = this.getIncident(duplicateDecision.incidentId);
        if (!incident) throw new Error(`Incident ${duplicateDecision.incidentId} not found.`);
      } else {
        incident = {
          incidentId: incidentId(state.nextIncidentSequence++),
          category: triage.category,
          summary: triage.summary,
          priority: triage.priority,
          status: "REPORTED",
          location,
          geohash: roughGeohash(location),
          reportCount: 0,
          assignedTo: null,
          resolution: null,
          createdAt: now,
          updatedAt: now,
        };
        state.incidents.unshift(incident);
        state.events.push(makeEvent(incident.incidentId, "Reported", "Citizen report received and incident created.", "REPORTED", now));
      }

      const report = {
        reportId: nextReportId,
        incidentId: incident.incidentId,
        description,
        contactEmail: contact?.email || null,
        contactPhone: contact?.phone || null,
        notify: Boolean(contact?.notify),
        photoKey: photoKey || null,
        location,
        triage: { mode: triage.mode || "RULES", category: triage.category, summary: triage.summary, priority: triage.priority },
        createdAt: now,
      };

      state.reports.unshift(report);
      incident.reportCount += 1;
      incident.updatedAt = now;

      if (attachedToExisting) {
        state.events.push(makeEvent(incident.incidentId, "Additional report", "Additional citizen report received.", incident.status, now));
      }

      return { report, incident, attachedToExisting };
    },
    updateIncident(incidentIdValue, patch, actorId = "local-admin") {
      const incident = this.getIncident(incidentIdValue);
      if (!incident) return null;
      const now = new Date().toISOString();
      const oldStatus = incident.status;

      for (const field of ["status", "priority", "assignedTo", "resolution"]) {
        if (field in patch) incident[field] = patch[field];
      }
      incident.updatedAt = now;

      if (patch.status && patch.status !== oldStatus) {
        state.events.push({
          ...makeEvent(incident.incidentId, titleCase(patch.status), patch.publicUpdate || `Status changed from ${oldStatus} to ${patch.status}.`, patch.status, now),
          actorType: "ADMIN",
          actorId,
          publicVisible: patch.publicVisible !== false,
        });
      }
      return incident;
    },
    _state: state,
  };
}

export function toPublicIncident(incident) {
  return {
    incidentId: incident.incidentId,
    category: incident.category,
    summary: incident.summary,
    priority: incident.priority,
    status: incident.status,
    location: incident.location,
    reportCount: incident.reportCount,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
    lastPublicUpdate: incident.lastPublicUpdate || statusCopy(incident.status),
  };
}

export function toAdminIncident(incident) {
  return {
    ...toPublicIncident(incident),
    assignedTo: incident.assignedTo,
    resolution: incident.resolution,
  };
}

function filterIncidents(incidents, filters) {
  return incidents.filter((incident) => {
    if (filters.status && !splitFilter(filters.status).includes(incident.status)) return false;
    if (filters.category && !splitFilter(filters.category).includes(incident.category)) return false;
    if (filters.priority && !splitFilter(filters.priority).includes(incident.priority)) return false;
    return true;
  });
}

function splitFilter(value) {
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function makeEvent(incidentIdValue, label, detail, status, at) {
  const id = eventId();
  return {
    incidentId: incidentIdValue,
    eventKey: `${at}#${id}`,
    eventId: id,
    eventType: "STATUS_CHANGED",
    label,
    detail,
    status,
    actorType: "SYSTEM",
    actorId: "system",
    publicVisible: true,
    at,
  };
}

function statusCopy(status) {
  return {
    REPORTED: "Your report has been received.",
    VERIFIED: "The issue has been verified by the team.",
    ASSIGNED: "The issue has been assigned.",
    IN_PROGRESS: "Work is underway.",
    RESOLVED: "The issue has been resolved.",
  }[status] || "Incident updated.";
}

function titleCase(value) {
  return value.toLowerCase().split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

function defaultSeed() {
  return {
    nextIncidentSequence: 183,
    nextReportSequence: 31,
    incidents: [
      {
        incidentId: "MTF-2026-00182",
        category: "ROAD_DAMAGE",
        summary: "Large pothole creating a traffic hazard near a road junction.",
        priority: "HIGH",
        status: "IN_PROGRESS",
        location: { label: "Ngong Road, Nairobi", lat: -1.3002, lng: 36.7853 },
        geohash: "-1.30:36.79",
        reportCount: 7,
        assignedTo: "Roads Team",
        resolution: null,
        createdAt: "2026-09-25T10:24:00.000Z",
        updatedAt: "2026-09-27T14:30:00.000Z",
      },
    ],
    reports: [],
    events: [
      makeEvent("MTF-2026-00182", "Reported", "Your report has been received.", "REPORTED", "2026-09-25T10:24:00.000Z"),
      makeEvent("MTF-2026-00182", "In Progress", "Work is underway.", "IN_PROGRESS", "2026-09-27T14:30:00.000Z"),
    ],
  };
}
