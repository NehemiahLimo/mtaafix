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
      photos: await publicPhotosForIncident(store, incidentId),
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

async function publicPhotosForIncident(store, incidentId) {
  const reports = await store.getReports(incidentId);
  const photoReports = reports.filter((report) => report.photoKey);
  if (!photoReports.length || !process.env.PHOTOS_BUCKET) {
    return photoReports.map((report) => publicPhotoSummary(report));
  }

  const { GetObjectCommand, S3Client } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const client = new S3Client({});

  return Promise.all(
    photoReports.map(async (report) => ({
      ...publicPhotoSummary(report),
      viewUrl: await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: process.env.PHOTOS_BUCKET,
          Key: report.photoKey,
        }),
        { expiresIn: 900 },
      ),
    })),
  );
}

function publicPhotoSummary(report) {
  return {
    reportId: report.reportId,
    hasPhoto: true,
    createdAt: report.createdAt,
    location: report.location,
  };
}
