import assert from "node:assert/strict";
import test from "node:test";

import { findDuplicate } from "../lib/duplicates.js";
import { analyzeReport } from "../lib/triage.js";

test("classifies pothole report as road damage with high priority", () => {
  const triage = analyzeReport({
    description: "There is a huge pothole near the junction and cars keep swerving around it.",
  });

  assert.equal(triage.mode, "RULES");
  assert.equal(triage.category, "ROAD_DAMAGE");
  assert.equal(triage.priority, "HIGH");
  assert.match(triage.summary, /pothole/i);
});

test("finds nearby duplicate by category, distance, and text similarity", () => {
  const triage = analyzeReport({
    description: "Large pothole near the junction. Cars are swerving into the opposite lane.",
    categoryHint: "ROAD_DAMAGE",
  });
  const duplicate = findDuplicate({
    description: "Large pothole near the junction. Cars are swerving into the opposite lane.",
    location: { label: "Ngong Road", lat: -1.3001, lng: 36.7854 },
    triage,
    incidents: [
      {
        incidentId: "MTF-2026-00182",
        category: "ROAD_DAMAGE",
        summary: "Large pothole creating a traffic hazard near a road junction.",
        priority: "HIGH",
        status: "IN_PROGRESS",
        location: { label: "Ngong Road", lat: -1.3002, lng: 36.7853 },
        reportCount: 7,
      },
    ],
  });

  assert.equal(duplicate.found, true);
  assert.equal(duplicate.incident.incidentId, "MTF-2026-00182");
  assert.ok(duplicate.distanceMeters < 50);
});
