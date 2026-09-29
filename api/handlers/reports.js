import { findDuplicate } from "../lib/duplicates.js";
import { handleError, httpError, json, parseJsonBody, requireLocation, requireString } from "../lib/http.js";
import { analyzeReport } from "../lib/triage.js";
import { getStore } from "./context.js";

export async function analyzeReportHandler(event) {
  try {
    const body = parseJsonBody(event);
    const description = requireString(body.description, "description", 10, 1000);
    const location = requireLocation(body.location);
    const triage = analyzeReport({ description, categoryHint: body.categoryHint });
    const store = await getStore();
    const duplicate = findDuplicate({
      description,
      location,
      triage,
      incidents: (await store.openIncidents()).map((incident) => ({
        ...incident,
        location: incident.location,
      })),
    });

    return json(200, {
      triage,
      duplicate: duplicate.found
        ? { ...duplicate, incident: await store.getPublicIncident(duplicate.incident.incidentId) }
        : { found: false },
    });
  } catch (error) {
    return handleError(error, event?.requestContext?.requestId);
  }
}

export async function createReportHandler(event) {
  try {
    const body = parseJsonBody(event);
    const description = requireString(body.description, "description", 10, 1000);
    const location = requireLocation(body.location);
    const triage = validateTriage(body.triage);
    const duplicateDecision = validateDuplicateDecision(body.duplicateDecision);
    const store = await getStore();

    const result = await store.createReport({
      description,
      location,
      contact: body.contact || {},
      photoKey: body.photoKey || null,
      triage,
      duplicateDecision,
    });

    return json(201, {
      reportId: result.report.reportId,
      incidentId: result.incident.incidentId,
      attachedToExisting: result.attachedToExisting,
      publicIncident: await store.getPublicIncident(result.incident.incidentId),
    });
  } catch (error) {
    return handleError(error, event?.requestContext?.requestId);
  }
}

export async function presignUploadHandler(event) {
  try {
    const body = parseJsonBody(event);
    const contentType = requireString(body.contentType, "contentType", 5, 80);
    const supported = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!supported.has(contentType)) {
      throw httpError(400, "VALIDATION_ERROR", "Unsupported image content type.");
    }
    if (Number(body.contentLength || 0) > 5 * 1024 * 1024) {
      throw httpError(400, "VALIDATION_ERROR", "Photo must be 5 MB or smaller.");
    }

    const extension = contentType.split("/")[1].replace("jpeg", "jpg");
    const photoKey = `uploads/tmp/${crypto.randomUUID()}.${extension}`;

    if (process.env.PHOTOS_BUCKET) {
      const { PutObjectCommand, S3Client } = await import("@aws-sdk/client-s3");
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
      const command = new PutObjectCommand({
        Bucket: process.env.PHOTOS_BUCKET,
        Key: photoKey,
        ContentType: contentType,
      });
      const uploadUrl = await getSignedUrl(new S3Client({}), command, { expiresIn: 900 });
      return json(200, {
        uploadUrl,
        photoKey,
        expiresInSeconds: 900,
        requiredHeaders: { "Content-Type": contentType },
      });
    }

    return json(200, {
      uploadUrl: `https://example-presigned-upload.local/${photoKey}`,
      photoKey,
      expiresInSeconds: 900,
      requiredHeaders: { "Content-Type": contentType },
    });
  } catch (error) {
    return handleError(error, event?.requestContext?.requestId);
  }
}

function validateTriage(triage) {
  if (!triage || typeof triage !== "object") {
    throw httpError(400, "VALIDATION_ERROR", "triage is required.");
  }
  return {
    mode: triage.mode || "RULES",
    category: requireString(triage.category, "triage.category", 2, 40),
    summary: requireString(triage.summary, "triage.summary", 5, 240),
    priority: requireString(triage.priority, "triage.priority", 3, 10),
  };
}

function validateDuplicateDecision(decision = { action: "CREATE_NEW" }) {
  if (decision.action === "ATTACH_TO_EXISTING") {
    return {
      action: "ATTACH_TO_EXISTING",
      incidentId: requireString(decision.incidentId, "duplicateDecision.incidentId", 5, 40),
    };
  }
  return { action: "CREATE_NEW" };
}
