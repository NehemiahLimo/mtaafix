const categoryRules = [
  ["ROAD_DAMAGE", ["pothole", "road", "tarmac", "junction", "crater", "swerving", "lane"]],
  ["STREETLIGHT", ["streetlight", "street light", "lamp", "dark", "lighting", "electric pole"]],
  ["WATER_LEAK", ["water", "leak", "pipe", "burst", "flood", "flowing"]],
  ["DRAINAGE", ["drain", "drainage", "sewer", "blocked drain", "stormwater", "culvert"]],
  ["WASTE", ["garbage", "trash", "rubbish", "waste", "dump", "dumping"]],
  ["PUBLIC_INFRASTRUCTURE", ["bench", "sign", "guardrail", "bridge", "sidewalk", "park"]],
];

const prioritySignals = {
  HIGH: ["danger", "accident", "flood", "burst", "huge", "massive", "blocked road", "swerving", "traffic hazard"],
  MEDIUM: ["broken", "blocked", "leak", "not working", "damaged", "dumping"],
};

export function analyzeReport({ description, categoryHint }) {
  const normalized = normalize(description);
  const classification = classify(normalized, categoryHint);
  const priority = suggestPriority(normalized, classification.category);

  return {
    mode: "RULES",
    category: classification.category,
    summary: summarize(description, classification.category),
    priority: priority.priority,
    confidence: round2(Math.min(0.95, classification.confidence + priority.confidenceBoost)),
    signals: [...classification.signals, ...priority.signals],
  };
}

export function tokenize(value) {
  return normalize(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !stopWords.has(word));
}

export function textSimilarity(left, right) {
  const a = new Set(tokenize(left));
  const b = new Set(tokenize(right));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((word) => b.has(word)).length;
  const union = new Set([...a, ...b]).size;
  return round2(intersection / union);
}

function classify(normalized, categoryHint) {
  const matches = categoryRules.map(([category, keywords]) => {
    const matched = keywords.filter((keyword) => normalized.includes(keyword));
    return { category, matched, score: matched.length };
  });
  const best = matches.sort((a, b) => b.score - a.score)[0];

  if (categoryHint && categoryHint !== "OTHER") {
    return {
      category: categoryHint,
      confidence: best?.category === categoryHint && best.score > 0 ? 0.78 : 0.62,
      signals: [`categoryHint:${categoryHint}`, ...((best?.matched || []).map((word) => `keyword:${word}`))],
    };
  }

  if (!best || best.score === 0) {
    return { category: "OTHER", confidence: 0.4, signals: [] };
  }

  return {
    category: best.category,
    confidence: Math.min(0.82, 0.5 + best.score * 0.12),
    signals: best.matched.map((word) => `keyword:${word}`),
  };
}

function suggestPriority(normalized, category) {
  const high = prioritySignals.HIGH.filter((word) => normalized.includes(word));
  if (high.length) {
    return { priority: "HIGH", confidenceBoost: 0.1, signals: high.map((word) => `priority:${word}`) };
  }
  const medium = prioritySignals.MEDIUM.filter((word) => normalized.includes(word));
  if (medium.length || category !== "OTHER") {
    return { priority: "MEDIUM", confidenceBoost: 0.05, signals: medium.map((word) => `priority:${word}`) };
  }
  return { priority: "LOW", confidenceBoost: 0, signals: [] };
}

function summarize(description, category) {
  const cleaned = description.replace(/\s+/g, " ").trim();
  const lower = normalize(cleaned);

  if (category === "ROAD_DAMAGE" && (lower.includes("pothole") || lower.includes("crater"))) {
    return "Large pothole creating a traffic hazard near a road junction.";
  }
  if (category === "STREETLIGHT") {
    return "Streetlight outage affecting visibility and safety.";
  }
  if (category === "WATER_LEAK") {
    return "Water leak reported near a public road or walkway.";
  }
  if (category === "DRAINAGE") {
    return "Drainage issue reported with possible blockage or overflow.";
  }
  if (category === "WASTE") {
    return "Waste dumping reported in a public area.";
  }
  if (cleaned.length <= 120) return cleaned;
  return `${cleaned.slice(0, 116).trim()}...`;
}

function normalize(value) {
  return String(value || "").toLowerCase();
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

const stopWords = new Set([
  "there",
  "this",
  "that",
  "with",
  "from",
  "near",
  "road",
  "issue",
  "reported",
  "around",
  "into",
]);
