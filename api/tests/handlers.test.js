import assert from "node:assert/strict";
import test from "node:test";

import { resetStore } from "../handlers/context.js";
import { getPublicIncidentHandler } from "../handlers/incidents.js";
import { analyzeReportHandler, createReportHandler } from "../handlers/reports.js";

test("analyze report handler returns triage and duplicate candidate", async () => {
  resetStore();
  const response = await analyzeReportHandler(event({
    description: "Large pothole near the junction. Cars are swerving into the opposite lane.",
    categoryHint: "ROAD_DAMAGE",
    location: { label: "Ngong Road, Nairobi", lat: -1.3001, lng: 36.7854 },
  }));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.triage.category, "ROAD_DAMAGE");
  assert.equal(body.duplicate.found, true);
});

test("create report can attach duplicate report to existing incident", async () => {
  resetStore();
  const response = await createReportHandler(event({
    description: "Large pothole near the junction. Cars are swerving into the opposite lane.",
    location: { label: "Ngong Road, Nairobi", lat: -1.3001, lng: 36.7854 },
    contact: { email: "resident@example.com", notify: true },
    triage: {
      mode: "RULES",
      category: "ROAD_DAMAGE",
      summary: "Large pothole creating a traffic hazard near a road junction.",
      priority: "HIGH",
    },
    duplicateDecision: { action: "ATTACH_TO_EXISTING", incidentId: "MTF-2026-00182" },
  }));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 201);
  assert.equal(body.attachedToExisting, true);
  assert.equal(body.publicIncident.reportCount, 8);
});

test("tracking handler returns public-safe incident and timeline", async () => {
  resetStore();
  const response = await getPublicIncidentHandler({
    pathParameters: { incidentId: "MTF-2026-00182" },
    requestContext: { requestId: "test" },
  });
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.incident.incidentId, "MTF-2026-00182");
  assert.ok(Array.isArray(body.timeline));
  assert.equal("contactEmail" in body.incident, false);
});

function event(body) {
  return {
    body: JSON.stringify(body),
    requestContext: { requestId: "test" },
  };
}
