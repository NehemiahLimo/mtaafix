import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import { roughGeohash } from "../lib/geo.js";
import { eventId, incidentId, reportId } from "../lib/ids.js";
import { toAdminIncident, toPublicIncident } from "./memoryStore.js";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export function createDynamoStore({
  incidentsTable = env("INCIDENTS_TABLE"),
  reportsTable = env("REPORTS_TABLE"),
  eventsTable = env("EVENTS_TABLE"),
} = {}) {
  return {
    async listPublicIncidents(filters = {}) {
      const incidents = await scanIncidents(incidentsTable, filters);
      return incidents.map(toPublicIncident);
    },
    async listAdminIncidents(filters = {}) {
      const incidents = await scanIncidents(incidentsTable, filters);
      return incidents.map(toAdminIncident);
    },
    async getIncident(id) {
      if (!id) return null;
      const result = await client.send(new GetCommand({ TableName: incidentsTable, Key: { incidentId: id } }));
      return result.Item || null;
    },
    async getPublicIncident(id) {
      const incident = await this.getIncident(id);
      return incident ? toPublicIncident(incident) : null;
    },
    async getEvents(incidentId, { publicOnly = false } = {}) {
      const result = await client.send(
        new QueryCommand({
          TableName: eventsTable,
          KeyConditionExpression: "incidentId = :incidentId",
          ExpressionAttributeValues: { ":incidentId": incidentId },
          ScanIndexForward: true,
        }),
      );
      return (result.Items || []).filter((event) => !publicOnly || event.publicVisible);
    },
    async getReports(incidentIdValue) {
      const result = await client.send(
        new QueryCommand({
          TableName: reportsTable,
          IndexName: "incidentId-createdAt-index",
          KeyConditionExpression: "incidentId = :incidentId",
          ExpressionAttributeValues: { ":incidentId": incidentIdValue },
          ScanIndexForward: false,
        }),
      );
      return result.Items || [];
    },
    async openIncidents() {
      const result = await client.send(new ScanCommand({ TableName: incidentsTable }));
      return (result.Items || []).filter((incident) => incident.status !== "RESOLVED");
    },
    async createReport({ description, location, contact, photoKey, triage, duplicateDecision }) {
      const now = new Date().toISOString();
      const nextReportId = reportId(randomSequence());
      const attachedToExisting = duplicateDecision?.action === "ATTACH_TO_EXISTING";
      let incident;

      if (attachedToExisting) {
        incident = await this.getIncident(duplicateDecision.incidentId);
        if (!incident) throw new Error(`Incident ${duplicateDecision.incidentId} not found.`);
      } else {
        incident = {
          incidentId: incidentId(randomSequence()),
          category: triage.category,
          summary: triage.summary,
          priority: triage.priority,
          status: "REPORTED",
          location,
          geohash: roughGeohash(location),
          reportCount: 0,
          assignedTo: null,
          resolution: null,
          createdAt: now,
          updatedAt: now,
        };
        await client.send(new PutCommand({ TableName: incidentsTable, Item: incident }));
        await putEvent(eventsTable, incident.incidentId, "Reported", "Citizen report received and incident created.", "REPORTED", now);
      }

      const report = {
        reportId: nextReportId,
        incidentId: incident.incidentId,
        description,
        contactEmail: contact?.email || null,
        contactPhone: contact?.phone || null,
        notify: Boolean(contact?.notify),
        photoKey: photoKey || null,
        location,
        triage: { mode: triage.mode || "RULES", category: triage.category, summary: triage.summary, priority: triage.priority },
        createdAt: now,
      };

      await client.send(new PutCommand({ TableName: reportsTable, Item: report }));
      const updated = await client.send(
        new UpdateCommand({
          TableName: incidentsTable,
          Key: { incidentId: incident.incidentId },
          UpdateExpression: "SET reportCount = if_not_exists(reportCount, :zero) + :one, updatedAt = :now",
          ExpressionAttributeValues: { ":zero": 0, ":one": 1, ":now": now },
          ReturnValues: "ALL_NEW",
        }),
      );

      if (attachedToExisting) {
        await putEvent(eventsTable, incident.incidentId, "Additional report", "Additional citizen report received.", incident.status, now);
      }

      return { report, incident: updated.Attributes, attachedToExisting };
    },
    async updateIncident(incidentIdValue, patch, actorId = "cognito-admin") {
      const existing = await this.getIncident(incidentIdValue);
      if (!existing) return null;
      const now = new Date().toISOString();
      const names = {};
      const values = { ":now": now };
      const sets = ["updatedAt = :now"];

      for (const field of ["status", "priority", "assignedTo", "resolution"]) {
        if (field in patch) {
          names[`#${field}`] = field;
          values[`:${field}`] = patch[field] ?? null;
          sets.push(`#${field} = :${field}`);
        }
      }

      const result = await client.send(
        new UpdateCommand({
          TableName: incidentsTable,
          Key: { incidentId: incidentIdValue },
          UpdateExpression: `SET ${sets.join(", ")}`,
          ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
          ExpressionAttributeValues: values,
          ReturnValues: "ALL_NEW",
        }),
      );

      if (patch.status && patch.status !== existing.status) {
        await putEvent(
          eventsTable,
          incidentIdValue,
          titleCase(patch.status),
          patch.publicUpdate || `Status changed from ${existing.status} to ${patch.status}.`,
          patch.status,
          now,
          { actorType: "ADMIN", actorId, publicVisible: patch.publicVisible !== false },
        );
      }

      return result.Attributes;
    },
  };
}

async function scanIncidents(tableName, filters) {
  const result = await client.send(new ScanCommand({ TableName: tableName }));
  return (result.Items || []).filter((incident) => {
    if (filters.status && !splitFilter(filters.status).includes(incident.status)) return false;
    if (filters.category && !splitFilter(filters.category).includes(incident.category)) return false;
    if (filters.priority && !splitFilter(filters.priority).includes(incident.priority)) return false;
    return true;
  });
}

async function putEvent(tableName, incidentIdValue, label, detail, status, at, overrides = {}) {
  const id = eventId();
  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        incidentId: incidentIdValue,
        eventKey: `${at}#${id}`,
        eventId: id,
        eventType: "STATUS_CHANGED",
        label,
        detail,
        status,
        actorType: "SYSTEM",
        actorId: "system",
        publicVisible: true,
        at,
        ...overrides,
      },
    }),
  );
}

function splitFilter(value) {
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function randomSequence() {
  return Math.floor(10000 + Math.random() * 89999);
}

function titleCase(value) {
  return value.toLowerCase().split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

function env(name) {
  if (!process.env[name]) throw new Error(`${name} environment variable is required.`);
  return process.env[name];
}
