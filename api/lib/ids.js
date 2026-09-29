export function incidentId(sequence, date = new Date()) {
  return `MTF-${date.getUTCFullYear()}-${String(sequence).padStart(5, "0")}`;
}

export function reportId(sequence, date = new Date()) {
  return `RPT-${date.getUTCFullYear()}-${String(sequence).padStart(5, "0")}`;
}

export function eventId() {
  return crypto.randomUUID();
}
