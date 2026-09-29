import { distanceMeters } from "./geo.js";
import { textSimilarity, tokenize } from "./triage.js";

const OPEN_STATUSES = new Set(["REPORTED", "VERIFIED", "ASSIGNED", "IN_PROGRESS"]);

export function findDuplicate({ description, location, triage, incidents, radiusMeters = 300, minSimilarity = 0.25 }) {
  const candidates = incidents
    .filter((incident) => OPEN_STATUSES.has(incident.status))
    .filter((incident) => incident.category === triage.category)
    .map((incident) => {
      const distance = distanceMeters(location, incident.location);
      const similarity = textSimilarity(description, incident.summary);
      const proximityBoost = distance <= 60 ? 0.18 : distance <= 150 ? 0.08 : 0;
      const score = round2(Math.min(0.99, similarity + proximityBoost));
      return {
        incident,
        distanceMeters: Math.round(distance),
        similarity: score,
        reasons: reasons(incident, description, distance, score),
      };
    })
    .filter((candidate) => candidate.distanceMeters <= radiusMeters)
    .filter((candidate) => candidate.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity || a.distanceMeters - b.distanceMeters);

  if (!candidates.length) return { found: false };

  const best = candidates[0];
  return {
    found: true,
    incident: best.incident,
    distanceMeters: best.distanceMeters,
    similarity: best.similarity,
    reasons: best.reasons,
  };
}

function reasons(incident, description, distance, similarity) {
  const shared = [...new Set(tokenize(description))].filter((word) => new Set(tokenize(incident.summary)).has(word));
  return [
    "same category",
    `within ${Math.ceil(distance)} meters`,
    similarity >= 0.5 ? "strong text similarity" : "partial text similarity",
    shared.length ? `shared keywords: ${shared.slice(0, 4).join(", ")}` : null,
  ].filter(Boolean);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
