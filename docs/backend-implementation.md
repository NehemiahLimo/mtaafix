# Backend Implementation Notes

This is the current low-cost backend build path.

## What Exists

- `api/lib/triage.js`: rule-based classification, summary, priority, and signal generation.
- `api/lib/duplicates.js`: category + distance + text similarity duplicate detection.
- `api/repositories/memoryStore.js`: local repository used by tests.
- `api/repositories/dynamoStore.js`: DynamoDB repository for Lambda.
- `api/handlers/*`: Lambda-style handlers matching `docs/api-contracts.md`.
- `POST /v1/uploads/presign`: returns a real S3 presigned URL when `PHOTOS_BUCKET` is configured.
- `infra/`: AWS CDK scaffold for the first deployable backend.

## Cost-Conscious Choices

- API Gateway HTTP API instead of REST API.
- Lambda ARM64, 128 MB memory.
- DynamoDB on-demand tables.
- Private S3 bucket for issue photos.
- Cognito only for admin users.
- No VPC, NAT Gateway, RDS, OpenSearch, Bedrock, ECS, or EKS.
- No frontend CloudFront/S3 hosting in the first backend stack; local/static frontend deployment can be added separately.

## CDK Stack

The CDK stack provisions:

- `IncidentsTable`
- `ReportsTable`
- `IncidentEventsTable`
- private `IssuePhotosBucket`
- Cognito admin user pool and client
- API Gateway HTTP API
- Lambda handlers for public and admin endpoints

## Before Synth or Deploy

Install workspace dependencies:

```bash
npm --prefix api install
npm --prefix infra install
```

Then run:

```bash
npm run api:test
npm run infra:synth
```

## Important Deployment Note

The Lambda asset is the `api/` directory. For deployment, `api/node_modules` must exist because `dynamoStore.js` uses AWS SDK v3 packages declared in `api/package.json`.

## Next Implementation Tasks

1. Add a seed script for demo incidents in DynamoDB.
2. Wire the frontend to call the API URL from CDK output.
3. Add a simple Cognito admin login flow to the frontend.
4. Add route-level smoke tests after deploy.
5. Add frontend S3 upload integration using the presigned URL.
