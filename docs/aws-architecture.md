# MtaaFix AWS Solution Architecture

## Executive Summary

MtaaFix is an AI-assisted community infrastructure reporting platform. Citizens report public issues such as potholes, water leaks, broken streetlights, drainage problems, waste dumping, and damaged public infrastructure. The system uses AI to classify, summarize, prioritize, and detect likely duplicates, then creates or updates a consolidated incident that authorities can verify, assign, track, and resolve.

The recommended AWS architecture is serverless-first:

- low operational overhead for a hackathon MVP;
- clear separation between public citizen APIs and protected admin APIs;
- managed authentication for administrators;
- durable photo storage;
- scalable event-driven notifications;
- meaningful triage through low-cost rule-based Lambda logic first, with a clean path to Bedrock later.

## Architecture Goals

- Citizens can report and track issues without an account.
- Administrators authenticate before accessing sensitive report and workflow data.
- Reports and incidents are modeled separately.
- Duplicate reports are associated with an existing incident instead of discarded.
- Public APIs never expose private citizen contact information.
- Triage is useful, explainable, and overridable by administrators.
- The MVP can be deployed quickly and evolved without changing the product model.

## High-Level Architecture

Visual diagram: [AWS architecture diagram](aws-architecture-diagram.html)

```text
Citizens / Administrators
        |
        v
Amazon CloudFront
        |
        +---------------------------+
        |                           |
        v                           v
S3 / Amplify Hosting          Amazon Cognito
React / Static Web App        Admin Authentication
        |
        v
Amazon API Gateway
        |
        +-----------------------------+-----------------------------+
        |                             |                             |
        v                             v                             v
Public Lambda APIs             Admin Lambda APIs              Upload Lambda
Report / Track / Map           Verify / Assign / Resolve      Presigned URLs
        |                             |                             |
        +-------------+---------------+                             v
                      |                                          Amazon S3
                      v                                          Photos
                Amazon DynamoDB
        Reports / Incidents / IncidentEvents
                      |
                      +------------------+
                      |                  |
                      v                  v
              Rules Triage         Amazon EventBridge
              Lambda               Status Events
                      |                  |
                      v                  v
              Similarity Rules     Notification Lambda
                                         |
                                         v
                                  Amazon SES / SNS
```

## AWS Services

| Concern | AWS service | Purpose |
| --- | --- | --- |
| Web hosting | S3 + CloudFront or AWS Amplify Hosting | Host the citizen and admin web app globally with HTTPS. |
| Public API | API Gateway HTTP API + Lambda | Citizen reporting, tracking, map, and public incident endpoints. |
| Admin API | API Gateway JWT authorizer + Lambda | Protected authority workflows. |
| Admin auth | Amazon Cognito | Administrator sign-in, JWTs, password policies, future groups. |
| Data store | DynamoDB | Serverless storage for reports, incidents, and events. |
| Photo storage | S3 | Store uploaded issue photos using presigned upload URLs. |
| Triage | Lambda rule engine | Low-cost classification, summarization, priority suggestion, and duplicate assistance for phase one. |
| Future AI upgrade | Amazon Bedrock | Optional later enhancement for richer classification, summarization, and duplicate reasoning. |
| Async events | EventBridge | Decouple status changes and notifications from write APIs. |
| Notifications | SES and/or SNS | Email/SMS updates to citizens who opt in. |
| Observability | CloudWatch | Logs, metrics, dashboards, alarms. |
| Secrets/config | SSM Parameter Store | Store model IDs and notification sender configuration. |
| Infrastructure | AWS CDK | Repeatable infrastructure as code. |

## User Domains

### Public Citizen Experience

Citizens do not need an account to:

- view community incidents;
- submit a report;
- upload a photo;
- receive a tracking number;
- track public incident progress.

Public APIs return only safe incident information.

### Administrator Experience

Administrators authenticate through Cognito and can:

- view the full incident queue;
- inspect citizen reports and uploaded photos;
- verify incidents;
- override AI priority;
- assign teams;
- update status;
- add resolution details;
- view incident timelines.

## Report vs Incident Model

This distinction is central to the architecture.

```text
Report R001 ─┐
Report R002 ─┤
Report R003 ─┤
Report R004 ─┼──> Incident MTF-2026-00182
Report R005 ─┘
```

A report is one citizen submission.

An incident is the consolidated infrastructure issue.

Duplicate reports increase the incident report count and strengthen prioritization signals.

## Data Model

For the MVP, use three DynamoDB tables. This is simpler for a hackathon than a single-table design and keeps access patterns easy to explain.

### Incidents Table

Partition key:

- `incidentId`, such as `MTF-2026-00182`

Attributes:

- `category`
- `summary`
- `priority`
- `status`
- `locationLabel`
- `lat`
- `lng`
- `geohash`
- `reportCount`
- `assignedTo`
- `resolution`
- `createdAt`
- `updatedAt`

Indexes:

- `status-updatedAt-index`
- `category-status-index`
- `geohash-category-index`

### Reports Table

Partition key:

- `reportId`

Attributes:

- `incidentId`
- `description`
- `contactEmail`
- `contactPhone`
- `photoKey`
- `locationLabel`
- `lat`
- `lng`
- `aiCategory`
- `aiSummary`
- `aiPriority`
- `duplicateCandidateIncidentId`
- `createdAt`

Indexes:

- `incidentId-createdAt-index`

### IncidentEvents Table

Partition key:

- `incidentId`

Sort key:

- `eventAt#eventId`

Attributes:

- `eventType`
- `label`
- `detail`
- `actorType`
- `actorId`
- `publicVisible`

## API Design

### Public APIs

```text
POST /reports/analyze
POST /reports
GET  /incidents/public
GET  /incidents/public/{incidentId}
GET  /tracking/{incidentId}
POST /uploads/presign
```

Public response fields:

- incident ID;
- category;
- public summary;
- priority;
- status;
- public location;
- report count;
- public timeline;
- last update.

Do not return:

- reporter email;
- reporter phone;
- internal notes;
- admin-only assignment metadata beyond public status;
- raw private report details.

### Admin APIs

Protected by Cognito JWT authorizer:

```text
GET   /admin/incidents
GET   /admin/incidents/{incidentId}
PATCH /admin/incidents/{incidentId}
GET   /admin/incidents/{incidentId}/reports
POST  /admin/incidents/{incidentId}/events
```

Admin-only fields may include:

- reporter contact;
- original descriptions;
- photo object keys;
- assignment details;
- internal status management;
- resolution notes.

## Triage Design

Phase one triage must solve the product problem without expensive infrastructure: turning noisy citizen reports into structured incidents using deterministic Lambda logic.

### Report Analysis

Input:

- citizen description;
- selected or detected location;
- optional image metadata;
- nearby candidate incidents.

Output:

- category;
- concise summary;
- suggested priority;
- duplicate candidate;
- confidence or similarity score;
- explanation suitable for admin review.

### Phase-One Rule-Based Usage

Recommended MVP approach:

1. Use keyword and phrase rules for category classification.
2. Use danger-word rules for priority suggestion.
3. Use template-based summaries for the first backend.
4. Use deterministic proximity filtering in Lambda.
5. Compare only nearby same-category incidents.
6. Use simple text similarity for the first demo.

Optional future path:

- Add `TRIAGE_MODE=BEDROCK` behind the same response contract.
- Use Bedrock for richer summaries and explanation text.
- Add embeddings only after real usage shows rule-based duplicate detection is insufficient.
- Avoid OpenSearch or vector infrastructure until there is clear need.

## Duplicate Detection Flow

```text
Citizen submits report details
        |
        v
AnalyzeReport Lambda
        |
        +--> Rules engine: classify, summarize, priority
        |
        +--> DynamoDB: query open incidents by category / geohash
        |
        +--> Lambda: distance filter
        |
        +--> Similarity comparison
        |
        v
Return possible duplicate:
incidentId, distance, similarity, summary, report count
```

If the citizen confirms the duplicate, the new report is attached to the existing incident.

If the citizen says it is new, a new incident is created.

## Photo Upload Flow

```text
Browser
  |
  | POST /uploads/presign
  v
Upload Lambda
  |
  | creates restricted presigned URL
  v
S3 Issue Photos Bucket
  ^
  |
Browser uploads image directly to S3
```

Recommended controls:

- allow only image MIME types;
- restrict max size;
- use object keys such as `reports/{reportId}/{uuid}.jpg`;
- keep bucket private;
- serve admin photo access through signed URLs;
- optionally scan or moderate images before admin display.

## Status Workflow

MVP statuses:

```text
REPORTED -> VERIFIED -> ASSIGNED -> IN_PROGRESS -> RESOLVED
```

Every status change creates an `IncidentEvent`.

Events can be public or admin-only.

The citizen tracking page displays only public-visible events.

## Notifications

Citizen contact is optional.

When a citizen opts in:

1. Admin updates incident status.
2. Admin Lambda writes the update and emits an EventBridge event.
3. Notification Lambda loads reports attached to the incident.
4. SES or SNS sends updates to citizens with contact details.

Use SES first for MVP because email setup is simpler to demo than SMS in many hackathon accounts.

## Security and Privacy

### Public Access

Allowed:

- submit reports;
- upload photos through time-limited presigned URLs;
- view public incident data;
- track by incident ID.

Not allowed:

- list citizen contacts;
- read raw reporter data;
- read internal admin notes;
- update incident workflow state.

### Admin Access

- Cognito user pool for administrators.
- API Gateway JWT authorizer validates Cognito tokens.
- Future groups: `AuthorityAdmin`, `Dispatcher`, `ReadOnly`.

### Data Protection

- S3 bucket private by default.
- DynamoDB encryption at rest enabled by default.
- HTTPS through CloudFront and API Gateway.
- Least-privilege IAM roles for each Lambda.
- Separate public DTOs from admin DTOs in Lambda response mapping.

## Observability

CloudWatch dashboards should track:

- API latency;
- Lambda errors;
- report submission count;
- duplicate detection rate;
- incidents by status;
- triage analysis failures;
- notification delivery failures.

Recommended alarms:

- high Lambda error rate;
- API 5xx spike;
- DynamoDB throttling;
- failed EventBridge notification processing;
- rule-based triage failures.

## Deployment Plan

Use AWS CDK with separate stacks:

```text
MtaaFixWebStack
  CloudFront
  S3 web bucket or Amplify Hosting

MtaaFixAuthStack
  Cognito User Pool
  Cognito App Client

MtaaFixDataStack
  DynamoDB tables
  S3 photos bucket

MtaaFixApiStack
  API Gateway
  Lambda functions
  IAM roles

MtaaFixEventsStack
  EventBridge rules
  Notification Lambda
  SES/SNS permissions
```

For the hackathon MVP, these can be combined into fewer stacks if speed matters.

## MVP Implementation Phases

### Phase 1: Current Prototype

- Static web app.
- Local storage data model.
- Local AI-style triage.
- Demoable citizen/admin flows.

### Phase 2: Low-Cost Serverless Backend

- API Gateway + Lambda.
- DynamoDB tables.
- S3 photo upload with presigned URLs.
- Cognito admin login.
- Rule-based triage Lambda.
- Rule-based duplicate detection.

### Phase 3: Notifications and Observability

- EventBridge status events.
- SES email updates.
- CloudWatch dashboard and alarms.

### Phase 4: Optional Bedrock Upgrade

- Bedrock classification.
- Bedrock summarization.
- Duplicate candidate reasoning.
- Keep the same API contract using `triage.mode`.

### Phase 5: Production Hardening

- WAF on CloudFront/API Gateway.
- Image scanning or moderation.
- Admin roles/groups.
- Audit logs.
- Backup/restore policy.
- More robust geospatial search.

## Why This Architecture Fits MtaaFix

This architecture keeps the MVP focused while demonstrating meaningful AWS usage:

- CloudFront/S3 or Amplify provides fast public access.
- API Gateway and Lambda keep backend cost low and scale automatically.
- DynamoDB matches the report/incident access patterns.
- S3 is the natural store for photos.
- Cognito protects only the admin experience, keeping citizen reporting frictionless.
- Rule-based Lambda triage keeps the first deployment inexpensive while preserving a future Bedrock path.
- EventBridge cleanly separates workflow updates from notifications.

The result is practical for a hackathon demo and credible as the foundation for a real civic reporting platform.
