import { json } from "../lib/http.js";
import {
  getAdminIncidentHandler,
  getAdminPhotoUrlHandler,
  listAdminIncidentsHandler,
  listAdminReportsHandler,
  updateAdminIncidentHandler,
} from "./admin.js";
import { getPublicIncidentHandler, listPublicIncidentsHandler } from "./incidents.js";
import { analyzeReportHandler, createReportHandler, presignUploadHandler } from "./reports.js";

const routes = {
  "POST /v1/reports/analyze": analyzeReportHandler,
  "POST /v1/reports": createReportHandler,
  "POST /v1/uploads/presign": presignUploadHandler,
  "GET /v1/incidents/public": listPublicIncidentsHandler,
  "GET /v1/incidents/public/{incidentId}": getPublicIncidentHandler,
  "GET /v1/tracking/{incidentId}": getPublicIncidentHandler,
  "GET /v1/admin/incidents": listAdminIncidentsHandler,
  "GET /v1/admin/incidents/{incidentId}": getAdminIncidentHandler,
  "PATCH /v1/admin/incidents/{incidentId}": updateAdminIncidentHandler,
  "GET /v1/admin/incidents/{incidentId}/reports": listAdminReportsHandler,
  "GET /v1/admin/photos": getAdminPhotoUrlHandler,
};

export async function handler(event, context) {
  const routeKey = event?.routeKey || `${event?.requestContext?.http?.method || ""} ${event?.rawPath || ""}`;
  const route = routes[routeKey];
  if (!route) {
    return json(404, {
      code: "NOT_FOUND",
      message: "Route not found.",
    });
  }
  return route(event, context);
}
