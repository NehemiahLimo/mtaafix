import { handleError, httpError, json, parseJsonBody } from "../lib/http.js";
import { getStore } from "./context.js";

export async function listAdminIncidentsHandler(event) {
  try {
    const query = event?.queryStringParameters || {};
    const store = await getStore();
    return json(200, {
      items: await store.listAdminIncidents(query),
      nextCursor: null,
    });
  } catch (error) {
    return handleError(error, event?.requestContext?.requestId);
  }
}

export async function getAdminIncidentHandler(event) {
  try {
    const incidentId = event?.pathParameters?.incidentId;
    const store = await getStore();
    const incident = await store.getIncident(incidentId);
    if (!incident) throw httpError(404, "NOT_FOUND", "Incident not found.");
    return json(200, {
      incident: (await store.listAdminIncidents()).find((item) => item.incidentId === incidentId),
      reports: await store.getReports(incidentId),
      timeline: await store.getEvents(incidentId),
    });
  } catch (error) {
    return handleError(error, event?.requestContext?.requestId);
  }
}

export async function updateAdminIncidentHandler(event) {
  try {
    const incidentId = event?.pathParameters?.incidentId;
    const body = parseJsonBody(event);
    const store = await getStore();
    const incident = await store.updateIncident(incidentId, {
      status: body.status,
      priority: body.priority,
      assignedTo: body.assignedTo,
      resolution: body.resolution,
      publicUpdate: body.publicUpdate,
      publicVisible: body.publicVisible,
    });
    if (!incident) throw httpError(404, "NOT_FOUND", "Incident not found.");
    return json(200, {
      incident: (await store.listAdminIncidents()).find((item) => item.incidentId === incidentId),
    });
  } catch (error) {
    return handleError(error, event?.requestContext?.requestId);
  }
}

export async function listAdminReportsHandler(event) {
  try {
    const incidentId = event?.pathParameters?.incidentId;
    const store = await getStore();
    if (!(await store.getIncident(incidentId))) throw httpError(404, "NOT_FOUND", "Incident not found.");
    return json(200, {
      items: await store.getReports(incidentId),
    });
  } catch (error) {
    return handleError(error, event?.requestContext?.requestId);
  }
}
