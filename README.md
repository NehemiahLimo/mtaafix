# MtaaFix

MtaaFix is a hackathon MVP for AI-assisted community infrastructure reporting.

The first increment is a local, browser-based prototype that demonstrates the product loop:

- Citizens submit reports without an account.
- The app classifies and summarizes the report, suggests priority, and checks for duplicates.
- Duplicate reports attach to the existing incident instead of being discarded.
- Citizens receive and track a public-safe incident number.
- Admins can sign in with demo credentials, review incidents, update priority/status, assign teams, and record resolution details.

## Run Locally

```bash
npm run dev
```

Then open `http://127.0.0.1:5173/`.

No package install is required for the current static prototype.

Run the local backend logic tests:

```bash
npm run api:test
```

The AWS backend scaffold lives in `api/` and `infra/`.

For deployment work, install dependencies in the two backend workspaces:

```bash
npm --prefix api install
npm --prefix infra install
```

Then synthesize the low-cost AWS stack:

```bash
npm run infra:synth
```

## Demo Notes

The app seeds a duplicate candidate:

`MTF-2026-00182` is a high-priority road-damage incident near Moi Avenue junction.

Try reporting:

> There is a huge pothole near the junction and cars keep swerving around it.

The local triage module should classify it as `ROAD_DAMAGE`, mark it `HIGH`, and offer `MTF-2026-00182` as a likely duplicate.

## Architecture Direction

This prototype keeps product boundaries close to the intended AWS design:

- `Report` is an individual citizen submission.
- `Incident` is the consolidated infrastructure problem.
- Public views expose only safe incident data.
- Admin views expose citizen report details and workflow controls.
- Local triage is intentionally shaped so it can move behind an API later.

Target AWS MVP:

- CloudFront + S3 or Amplify Hosting for the web app.
- API Gateway + Lambda for report, incident, admin, and tracking APIs.
- DynamoDB for reports, incidents, and incident events.
- S3 for uploaded photos.
- Rule-based Lambda triage for classification, summarization, priority, and duplicate assistance.
- Cognito for administrator authentication.
- EventBridge + SES/SNS for citizen updates.
- CloudWatch for logs and metrics.

See [docs/aws-architecture.md](docs/aws-architecture.md) for the full AWS solution architecture.
See [docs/api-contracts.md](docs/api-contracts.md) for the first backend API contracts.
See [docs/deployment.md](docs/deployment.md) for the AWS deployment runbook.

## Next Increment

1. Move the local data model into a small API contract.
2. Add AWS CDK for DynamoDB, S3, API Gateway, Lambda, and Cognito.
3. Replace the local triage module with low-cost rule-based Lambda logic.
4. Add pre-signed S3 upload flow for photos.
