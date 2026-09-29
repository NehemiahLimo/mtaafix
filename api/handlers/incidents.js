import { handleError, httpError, json } from "../lib/http.js";
import { getStore } from "./context.js";

export async function listPublicIncidentsHandler(event) {
  try {
    const query = event?.queryStringParameters || {};
    const store = await getStore();
    return json(200, {
      items: await store.listPublicIncidents(query),
      nextCursor: null,
    });
  } catch (error) {
    return handleError(error, event?.requestContext?.requestId);
  }
}

export async function getPublicIncidentHandler(event) {
  try {
    const incidentId = event?.pathParameters?.incidentId;
    const store = await getStore();
    const incident = await store.getPublicIncident(incidentId);
    if (!incident) throw httpError(404, "NOT_FOUND", "Incident not found.");
    return json(200, {
      incident,
      timeline: (await store.getEvents(incidentId, { publicOnly: true })).map(toPublicEvent),
    });
  } catch (error) {
    return handleError(error, event?.requestContext?.requestId);
  }
}

export const trackingHandler = getPublicIncidentHandler;

function toPublicEvent(event) {
  return {
    eventId: event.eventId,
    label: event.label,
    detail: event.detail,
    status: event.status,
    at: event.at,
  };
}
