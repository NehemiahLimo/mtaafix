# MtaaFix API Contracts

These contracts define the first AWS backend version of MtaaFix. The first implementation intentionally avoids Bedrock and expensive AI/vector infrastructure. Triage and duplicate detection start as deterministic Lambda logic behind a stable interface, so Bedrock can be added later without changing the frontend.

## Conventions

Base path:

```text
/v1
```

Content type:

```text
application/json
```

Timestamps:

```text
ISO-8601 UTC, for example 2026-09-29T10:15:30.000Z
```

IDs:

- Incident ID: `MTF-YYYY-00001`
- Report ID: `RPT-YYYY-00001`
- Event ID: UUID

Enums:

```text
Category:
ROAD_DAMAGE | STREETLIGHT | WATER_LEAK | DRAINAGE | WASTE | PUBLIC_INFRASTRUCTURE | OTHER

Priority:
LOW | MEDIUM | HIGH

Status:
REPORTED | VERIFIED | ASSIGNED | IN_PROGRESS | RESOLVED
```

## Shared DTOs

### LocationInput

```json
{
  "label": "Ngong Road, Nairobi",
  "lat": -1.3001,
  "lng": 36.7854
}
```

### PublicIncident

Public-safe incident shape. This must not include reporter contact details, internal notes, raw private reports, or private S3 object keys.

```json
{
  "incidentId": "MTF-2026-00182",
  "category": "ROAD_DAMAGE",
  "summary": "Large pothole creating a traffic hazard near a road junction.",
  "priority": "HIGH",
  "status": "IN_PROGRESS",
  "location": {
    "label": "Ngong Road, Nairobi",
    "lat": -1.3001,
    "lng": 36.7854
  },
  "reportCount": 7,
  "createdAt": "2026-09-25T10:24:00.000Z",
  "updatedAt": "2026-09-27T14:30:00.000Z",
  "lastPublicUpdate": "Road maintenance team assigned."
}
```

### PublicIncidentEvent

```json
{
  "eventId": "b23f7e1e-8f7a-4ff1-9359-8f2306f00641",
  "label": "Assigned",
  "detail": "Assigned to Roads Team.",
  "status": "ASSIGNED",
  "at": "2026-09-26T09:15:00.000Z"
}
```

### AdminIncident

Admin shape includes operational fields, but citizen contact details still live on report records.

```json
{
  "incidentId": "MTF-2026-00182",
  "category": "ROAD_DAMAGE",
  "summary": "Large pothole creating a traffic hazard near a road junction.",
  "priority": "HIGH",
  "status": "IN_PROGRESS",
  "location": {
    "label": "Ngong Road, Nairobi",
    "lat": -1.3001,
    "lng": 36.7854
  },
  "reportCount": 7,
  "assignedTo": "Roads Team",
  "resolution": null,
  "createdAt": "2026-09-25T10:24:00.000Z",
  "updatedAt": "2026-09-27T14:30:00.000Z"
}
```

### AdminReport

```json
{
  "reportId": "RPT-2026-00031",
  "incidentId": "MTF-2026-00182",
  "description": "Large pothole near the junction. Cars are swerving into the opposite lane.",
  "contactEmail": "resident@example.com",
  "contactPhone": null,
  "photoKey": "reports/RPT-2026-00031/photo.jpg",
  "location": {
    "label": "Ngong Road, Nairobi",
    "lat": -1.3001,
    "lng": 36.7854
  },
  "triage": {
    "mode": "RULES",
    "category": "ROAD_DAMAGE",
    "summary": "Large pothole creating a traffic hazard near a road junction.",
    "priority": "HIGH"
  },
  "createdAt": "2026-09-29T08:10:00.000Z"
}
```

### ErrorResponse

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Description is required.",
    "requestId": "req-123"
  }
}
```

Common error codes:

- `VALIDATION_ERROR`
- `NOT_FOUND`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `CONFLICT`
- `RATE_LIMITED`
- `INTERNAL_ERROR`

## Public Endpoints

### POST /v1/reports/analyze

Runs low-cost rule-based triage and duplicate detection before report submission.

Authentication:

- none

Request:

```json
{
  "description": "Large pothole near the junction. Cars are swerving into the opposite lane.",
  "categoryHint": "ROAD_DAMAGE",
  "location": {
    "label": "Ngong Road, Nairobi",
    "lat": -1.3001,
    "lng": 36.7854
  }
}
```

Response `200`:

```json
{
  "triage": {
    "mode": "RULES",
    "category": "ROAD_DAMAGE",
    "summary": "Large pothole creating a traffic hazard near a road junction.",
    "priority": "HIGH",
    "confidence": 0.78,
    "signals": [
      "keyword:pothole",
      "keyword:swerving",
      "categoryHint:ROAD_DAMAGE"
    ]
  },
  "duplicate": {
    "found": true,
    "incident": {
      "incidentId": "MTF-2026-00182",
      "category": "ROAD_DAMAGE",
      "summary": "Large pothole creating a traffic hazard near a road junction.",
      "priority": "HIGH",
      "status": "IN_PROGRESS",
      "location": {
        "label": "Ngong Road, Nairobi",
        "lat": -1.3002,
        "lng": 36.7853
      },
      "reportCount": 7,
      "createdAt": "2026-09-25T10:24:00.000Z",
      "updatedAt": "2026-09-27T14:30:00.000Z",
      "lastPublicUpdate": "Road maintenance team assigned."
    },
    "distanceMeters": 45,
    "similarity": 0.91,
    "reasons": [
      "same category",
      "within 300 meters",
      "shared keywords: pothole, junction"
    ]
  }
}
```

Response `200` when no duplicate is found:

```json
{
  "triage": {
    "mode": "RULES",
    "category": "WASTE",
    "summary": "Illegal dumping reported near a residential lane.",
    "priority": "MEDIUM",
    "confidence": 0.66,
    "signals": ["keyword:dumping"]
  },
  "duplicate": {
    "found": false
  }
}
```

Validation:

- `description` required, 10 to 1000 characters.
- `location.lat` and `location.lng` required for duplicate detection.
- `categoryHint` optional.

### POST /v1/uploads/presign

Creates a presigned S3 upload URL for a report photo.

Authentication:

- none for MVP

Request:

```json
{
  "contentType": "image/jpeg",
  "fileName": "pothole.jpg",
  "contentLength": 734003
}
```

Response `200`:

```json
{
  "uploadUrl": "https://s3-presigned-url.example",
  "photoKey": "uploads/tmp/2c04eebf-8127-4f30-9d38-12e7129a32d1.jpg",
  "expiresInSeconds": 900,
  "requiredHeaders": {
    "Content-Type": "image/jpeg"
  }
}
```

Validation:

- Supported content types: `image/jpeg`, `image/png`, `image/webp`.
- Max size: 5 MB for MVP.

### POST /v1/reports

Creates a report and either attaches it to an existing incident or creates a new incident.

Authentication:

- none

Request, attach to duplicate:

```json
{
  "description": "Large pothole near the junction. Cars are swerving into the opposite lane.",
  "location": {
    "label": "Ngong Road, Nairobi",
    "lat": -1.3001,
    "lng": 36.7854
  },
  "contact": {
    "email": "resident@example.com",
    "phone": null,
    "notify": true
  },
  "photoKey": "uploads/tmp/2c04eebf-8127-4f30-9d38-12e7129a32d1.jpg",
  "triage": {
    "category": "ROAD_DAMAGE",
    "summary": "Large pothole creating a traffic hazard near a road junction.",
    "priority": "HIGH"
  },
  "duplicateDecision": {
    "action": "ATTACH_TO_EXISTING",
    "incidentId": "MTF-2026-00182"
  }
}
```

Request, create new incident:

```json
{
  "description": "Streetlight is not working on the lane behind the school.",
  "location": {
    "label": "Kilimani, Nairobi",
    "lat": -1.2921,
    "lng": 36.7891
  },
  "contact": {
    "email": null,
    "phone": null,
    "notify": false
  },
  "photoKey": null,
  "triage": {
    "category": "STREETLIGHT",
    "summary": "Streetlight outage near a school lane.",
    "priority": "MEDIUM"
  },
  "duplicateDecision": {
    "action": "CREATE_NEW"
  }
}
```

Response `201`:

```json
{
  "reportId": "RPT-2026-00031",
  "incidentId": "MTF-2026-00182",
  "attachedToExisting": true,
  "publicIncident": {
    "incidentId": "MTF-2026-00182",
    "category": "ROAD_DAMAGE",
    "summary": "Large pothole creating a traffic hazard near a road junction.",
    "priority": "HIGH",
    "status": "IN_PROGRESS",
    "location": {
      "label": "Ngong Road, Nairobi",
      "lat": -1.3002,
      "lng": 36.7853
    },
    "reportCount": 8,
    "createdAt": "2026-09-25T10:24:00.000Z",
    "updatedAt": "2026-09-29T08:10:00.000Z",
    "lastPublicUpdate": "Additional citizen report received."
  }
}
```

Validation:

- `description` required.
- `location` required.
- `triage.category`, `triage.summary`, and `triage.priority` required.
- If `duplicateDecision.action` is `ATTACH_TO_EXISTING`, `incidentId` is required.

### GET /v1/incidents/public

Lists public-safe incidents for the community map.

Authentication:

- none

Query parameters:

```text
status=REPORTED,VERIFIED,ASSIGNED,IN_PROGRESS
category=ROAD_DAMAGE
priority=HIGH
limit=50
cursor=opaqueCursor
```

Response `200`:

```json
{
  "items": [
    {
      "incidentId": "MTF-2026-00182",
      "category": "ROAD_DAMAGE",
      "summary": "Large pothole creating a traffic hazard near a road junction.",
      "priority": "HIGH",
      "status": "IN_PROGRESS",
      "location": {
        "label": "Ngong Road, Nairobi",
        "lat": -1.3002,
        "lng": 36.7853
      },
      "reportCount": 8,
      "createdAt": "2026-09-25T10:24:00.000Z",
      "updatedAt": "2026-09-29T08:10:00.000Z",
      "lastPublicUpdate": "Additional citizen report received."
    }
  ],
  "nextCursor": null
}
```

### GET /v1/incidents/public/{incidentId}

Returns public-safe incident details and public-visible timeline.

Authentication:

- none

Response `200`:

```json
{
  "incident": {
    "incidentId": "MTF-2026-00182",
    "category": "ROAD_DAMAGE",
    "summary": "Large pothole creating a traffic hazard near a road junction.",
    "priority": "HIGH",
    "status": "IN_PROGRESS",
    "location": {
      "label": "Ngong Road, Nairobi",
      "lat": -1.3002,
      "lng": 36.7853
    },
    "reportCount": 8,
    "createdAt": "2026-09-25T10:24:00.000Z",
    "updatedAt": "2026-09-29T08:10:00.000Z",
    "lastPublicUpdate": "Additional citizen report received."
  },
  "timeline": [
    {
      "eventId": "b23f7e1e-8f7a-4ff1-9359-8f2306f00641",
      "label": "Reported",
      "detail": "Your report has been received.",
      "status": "REPORTED",
      "at": "2026-09-25T10:24:00.000Z"
    }
  ]
}
```

### GET /v1/tracking/{incidentId}

Alias for public incident detail. The frontend can use this route for the citizen tracking screen.

Authentication:

- none

Response:

- same as `GET /v1/incidents/public/{incidentId}`

## Admin Endpoints

All admin endpoints require a Cognito JWT.

Authorization header:

```text
Authorization: Bearer <cognito-jwt>
```

### GET /v1/admin/incidents

Lists incidents for the admin queue.

Query parameters:

```text
status=REPORTED,VERIFIED,ASSIGNED,IN_PROGRESS
category=ROAD_DAMAGE
priority=HIGH
assignedTo=Roads Team
limit=50
cursor=opaqueCursor
```

Response `200`:

```json
{
  "items": [
    {
      "incidentId": "MTF-2026-00182",
      "category": "ROAD_DAMAGE",
      "summary": "Large pothole creating a traffic hazard near a road junction.",
      "priority": "HIGH",
      "status": "IN_PROGRESS",
      "location": {
        "label": "Ngong Road, Nairobi",
        "lat": -1.3002,
        "lng": 36.7853
      },
      "reportCount": 8,
      "assignedTo": "Roads Team",
      "resolution": null,
      "createdAt": "2026-09-25T10:24:00.000Z",
      "updatedAt": "2026-09-29T08:10:00.000Z"
    }
  ],
  "nextCursor": null
}
```

### GET /v1/admin/incidents/{incidentId}

Returns full admin incident details, reports, and timeline.

Response `200`:

```json
{
  "incident": {
    "incidentId": "MTF-2026-00182",
    "category": "ROAD_DAMAGE",
    "summary": "Large pothole creating a traffic hazard near a road junction.",
    "priority": "HIGH",
    "status": "IN_PROGRESS",
    "location": {
      "label": "Ngong Road, Nairobi",
      "lat": -1.3002,
      "lng": 36.7853
    },
    "reportCount": 8,
    "assignedTo": "Roads Team",
    "resolution": null,
    "createdAt": "2026-09-25T10:24:00.000Z",
    "updatedAt": "2026-09-29T08:10:00.000Z"
  },
  "reports": [
    {
      "reportId": "RPT-2026-00031",
      "incidentId": "MTF-2026-00182",
      "description": "Large pothole near the junction. Cars are swerving into the opposite lane.",
      "contactEmail": "resident@example.com",
      "contactPhone": null,
      "photoKey": "reports/RPT-2026-00031/photo.jpg",
      "location": {
        "label": "Ngong Road, Nairobi",
        "lat": -1.3001,
        "lng": 36.7854
      },
      "triage": {
        "mode": "RULES",
        "category": "ROAD_DAMAGE",
        "summary": "Large pothole creating a traffic hazard near a road junction.",
        "priority": "HIGH"
      },
      "createdAt": "2026-09-29T08:10:00.000Z"
    }
  ],
  "timeline": [
    {
      "eventId": "b23f7e1e-8f7a-4ff1-9359-8f2306f00641",
      "label": "Assigned",
      "detail": "Assigned to Roads Team.",
      "status": "ASSIGNED",
      "publicVisible": true,
      "actorType": "ADMIN",
      "actorId": "admin-user-id",
      "at": "2026-09-26T09:15:00.000Z"
    }
  ]
}
```

### PATCH /v1/admin/incidents/{incidentId}

Updates admin-managed incident fields and creates timeline events when status changes.

Request:

```json
{
  "status": "IN_PROGRESS",
  "priority": "HIGH",
  "assignedTo": "Roads Team",
  "resolution": null,
  "publicUpdate": "Roads Team has started repair work.",
  "publicVisible": true
}
```

Response `200`:

```json
{
  "incident": {
    "incidentId": "MTF-2026-00182",
    "category": "ROAD_DAMAGE",
    "summary": "Large pothole creating a traffic hazard near a road junction.",
    "priority": "HIGH",
    "status": "IN_PROGRESS",
    "location": {
      "label": "Ngong Road, Nairobi",
      "lat": -1.3002,
      "lng": 36.7853
    },
    "reportCount": 8,
    "assignedTo": "Roads Team",
    "resolution": null,
    "createdAt": "2026-09-25T10:24:00.000Z",
    "updatedAt": "2026-09-29T09:00:00.000Z"
  }
}
```

Validation:

- Status transitions should follow `REPORTED -> VERIFIED -> ASSIGNED -> IN_PROGRESS -> RESOLVED`.
- Admin may override priority.
- `resolution` is recommended when status becomes `RESOLVED`.

### GET /v1/admin/incidents/{incidentId}/reports

Returns reports attached to an incident.

Response `200`:

```json
{
  "items": [
    {
      "reportId": "RPT-2026-00031",
      "incidentId": "MTF-2026-00182",
      "description": "Large pothole near the junction. Cars are swerving into the opposite lane.",
      "contactEmail": "resident@example.com",
      "contactPhone": null,
      "photoKey": "reports/RPT-2026-00031/photo.jpg",
      "location": {
        "label": "Ngong Road, Nairobi",
        "lat": -1.3001,
        "lng": 36.7854
      },
      "triage": {
        "mode": "RULES",
        "category": "ROAD_DAMAGE",
        "summary": "Large pothole creating a traffic hazard near a road junction.",
        "priority": "HIGH"
      },
      "createdAt": "2026-09-29T08:10:00.000Z"
    }
  ]
}
```

## Rule-Based Triage Contract

Phase-one triage runs inside Lambda with no external AI calls.

Input:

```json
{
  "description": "Large pothole near the junction. Cars are swerving into the opposite lane.",
  "categoryHint": "ROAD_DAMAGE",
  "location": {
    "label": "Ngong Road, Nairobi",
    "lat": -1.3001,
    "lng": 36.7854
  }
}
```

Output:

```json
{
  "mode": "RULES",
  "category": "ROAD_DAMAGE",
  "summary": "Large pothole creating a traffic hazard near a road junction.",
  "priority": "HIGH",
  "confidence": 0.78,
  "signals": [
    "keyword:pothole",
    "keyword:swerving"
  ]
}
```

Implementation rules:

- Keyword classification maps phrases to categories.
- Priority rules look for danger words such as `danger`, `accident`, `flood`, `burst`, `huge`, `blocked`, and `swerving`.
- Summary can be template-based for MVP.
- Keep the response shape compatible with a future `mode: "BEDROCK"` response.

## Duplicate Detection Contract

Phase-one duplicate detection is also rules-only.

Algorithm:

1. Query open incidents in the same category.
2. Filter by distance, default radius 300 meters.
3. Score simple text similarity between report description and incident summary.
4. Return the strongest candidate above threshold.

Output:

```json
{
  "found": true,
  "incident": {
    "incidentId": "MTF-2026-00182",
    "category": "ROAD_DAMAGE",
    "summary": "Large pothole creating a traffic hazard near a road junction.",
    "priority": "HIGH",
    "status": "IN_PROGRESS",
    "location": {
      "label": "Ngong Road, Nairobi",
      "lat": -1.3002,
      "lng": 36.7853
    },
    "reportCount": 7,
    "createdAt": "2026-09-25T10:24:00.000Z",
    "updatedAt": "2026-09-27T14:30:00.000Z",
    "lastPublicUpdate": "Road maintenance team assigned."
  },
  "distanceMeters": 45,
  "similarity": 0.91,
  "reasons": [
    "same category",
    "within 300 meters",
    "shared keywords: pothole, junction"
  ]
}
```

## DynamoDB Item Shapes

### Incident Item

```json
{
  "incidentId": "MTF-2026-00182",
  "category": "ROAD_DAMAGE",
  "summary": "Large pothole creating a traffic hazard near a road junction.",
  "priority": "HIGH",
  "status": "IN_PROGRESS",
  "locationLabel": "Ngong Road, Nairobi",
  "lat": -1.3002,
  "lng": 36.7853,
  "geohash": "kzf0s",
  "reportCount": 8,
  "assignedTo": "Roads Team",
  "resolution": null,
  "createdAt": "2026-09-25T10:24:00.000Z",
  "updatedAt": "2026-09-29T08:10:00.000Z"
}
```

### Report Item

```json
{
  "reportId": "RPT-2026-00031",
  "incidentId": "MTF-2026-00182",
  "description": "Large pothole near the junction. Cars are swerving into the opposite lane.",
  "contactEmail": "resident@example.com",
  "contactPhone": null,
  "notify": true,
  "photoKey": "reports/RPT-2026-00031/photo.jpg",
  "locationLabel": "Ngong Road, Nairobi",
  "lat": -1.3001,
  "lng": 36.7854,
  "triageMode": "RULES",
  "triageCategory": "ROAD_DAMAGE",
  "triageSummary": "Large pothole creating a traffic hazard near a road junction.",
  "triagePriority": "HIGH",
  "duplicateCandidateIncidentId": "MTF-2026-00182",
  "createdAt": "2026-09-29T08:10:00.000Z"
}
```

### Incident Event Item

```json
{
  "incidentId": "MTF-2026-00182",
  "eventKey": "2026-09-29T09:00:00.000Z#b23f7e1e-8f7a-4ff1-9359-8f2306f00641",
  "eventId": "b23f7e1e-8f7a-4ff1-9359-8f2306f00641",
  "eventType": "STATUS_CHANGED",
  "label": "In Progress",
  "detail": "Roads Team has started repair work.",
  "status": "IN_PROGRESS",
  "actorType": "ADMIN",
  "actorId": "admin-user-id",
  "publicVisible": true,
  "at": "2026-09-29T09:00:00.000Z"
}
```

## First Backend Build Order

1. Implement DTO validation helpers.
2. Implement rule-based triage module.
3. Implement duplicate detection helper.
4. Implement public Lambda handlers.
5. Implement admin Lambda handlers.
6. Add DynamoDB repositories.
7. Add CDK infrastructure.
8. Wire frontend from localStorage to API calls.
