#!/usr/bin/env node

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const incidentsTable = requiredEnv("INCIDENTS_TABLE");
const reportsTable = requiredEnv("REPORTS_TABLE");
const eventsTable = requiredEnv("EVENTS_TABLE");

const incidentId = "MTF-2026-00182";
const now = new Date().toISOString();

await doc.send(
  new PutCommand({
    TableName: incidentsTable,
    Item: {
      incidentId,
      category: "ROAD_DAMAGE",
      summary: "Large pothole creating a traffic hazard near a road junction.",
      priority: "HIGH",
      status: "IN_PROGRESS",
      location: { label: "Ngong Road, Nairobi", lat: -1.3002, lng: 36.7853 },
      geohash: "-1.30:36.79",
      reportCount: 7,
      assignedTo: "Roads Team",
      resolution: null,
      createdAt: "2026-09-25T10:24:00.000Z",
      updatedAt: now,
    },
  }),
);

await doc.send(
  new PutCommand({
    TableName: reportsTable,
    Item: {
      reportId: "RPT-2026-00001",
      incidentId,
      description: "Large pothole near the junction. Cars are swerving into the opposite lane.",
      contactEmail: "demo-resident@example.com",
      contactPhone: null,
      notify: false,
      photoKey: null,
      location: { label: "Ngong Road, Nairobi", lat: -1.3001, lng: 36.7854 },
      triage: {
        mode: "RULES",
        category: "ROAD_DAMAGE",
        summary: "Large pothole creating a traffic hazard near a road junction.",
        priority: "HIGH",
      },
      createdAt: "2026-09-25T10:24:00.000Z",
    },
  }),
);

for (const event of [
  {
    label: "Reported",
    detail: "Your report has been received.",
    status: "REPORTED",
    at: "2026-09-25T10:24:00.000Z",
  },
  {
    label: "In Progress",
    detail: "Roads Team has started repair work.",
    status: "IN_PROGRESS",
    at: now,
  },
]) {
  const eventId = crypto.randomUUID();
  await doc.send(
    new PutCommand({
      TableName: eventsTable,
      Item: {
        incidentId,
        eventKey: `${event.at}#${eventId}`,
        eventId,
        eventType: "STATUS_CHANGED",
        label: event.label,
        detail: event.detail,
        status: event.status,
        actorType: "SYSTEM",
        actorId: "seed-demo",
        publicVisible: true,
        at: event.at,
      },
    }),
  );
}

console.log(`Seeded demo incident ${incidentId}`);

function requiredEnv(name) {
  if (!process.env[name]) {
    console.error(`${name} is required.`);
    process.exit(1);
  }
  return process.env[name];
}
