export function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

export function parseJsonBody(event) {
  if (!event?.body) return {};
  if (typeof event.body === "object") return event.body;
  try {
    return JSON.parse(event.body);
  } catch {
    throw httpError(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }
}

export function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

export function handleError(error, requestId = "local") {
  return json(error.statusCode || 500, {
    error: {
      code: error.code || "INTERNAL_ERROR",
      message: error.statusCode ? error.message : "Unexpected server error.",
      requestId,
    },
  });
}

export function requireString(value, name, min = 1, max = 1000) {
  if (typeof value !== "string" || value.trim().length < min) {
    throw httpError(400, "VALIDATION_ERROR", `${name} is required.`);
  }
  if (value.trim().length > max) {
    throw httpError(400, "VALIDATION_ERROR", `${name} must be ${max} characters or fewer.`);
  }
  return value.trim();
}

export function requireLocation(location) {
  if (!location || typeof location !== "object") {
    throw httpError(400, "VALIDATION_ERROR", "Location is required.");
  }
  const label = requireString(location.label, "location.label", 2, 180);
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw httpError(400, "VALIDATION_ERROR", "location.lat must be a valid latitude.");
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw httpError(400, "VALIDATION_ERROR", "location.lng must be a valid longitude.");
  }
  return { label, lat, lng };
}
