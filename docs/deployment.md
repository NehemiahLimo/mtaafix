# MtaaFix AWS Deployment Runbook

This deploys the low-cost AWS MVP backend. Bedrock, OpenSearch, VPCs, NAT Gateway, RDS, ECS, and EKS are intentionally not used.

## 1. Authenticate AWS

The local AWS CLI session must be active.

```bash
aws login
aws sts get-caller-identity
aws configure get region
```

Current intended region:

```text
eu-west-1
```

## 2. Install Dependencies

```bash
npm --prefix api install
npm --prefix infra install
```

## 3. Validate Locally

```bash
npm run build
npm run api:test
npm run api:check
npm run infra:synth
```

## 4. Bootstrap CDK If Needed

Only needed once per AWS account and region.

```bash
npm --prefix infra exec -- cdk bootstrap
```

## 5. Deploy

```bash
npm --prefix infra run deploy
```

Record the stack outputs:

- `ApiUrl`
- `AdminUserPoolId`
- `AdminUserPoolClientId`
- `PhotosBucketName`

## 6. Seed Demo Data

After deployment, get table names from CloudFormation or the AWS Console and run:

```bash
INCIDENTS_TABLE=<incidents-table-name> \
REPORTS_TABLE=<reports-table-name> \
EVENTS_TABLE=<events-table-name> \
npm --prefix api run seed:demo
```

## 7. Smoke Test Public API

```bash
curl "$ApiUrl/v1/incidents/public"
curl "$ApiUrl/v1/tracking/MTF-2026-00182"
```

Analyze duplicate:

```bash
curl -X POST "$ApiUrl/v1/reports/analyze" \
  -H "content-type: application/json" \
  -d '{
    "description": "Large pothole near the junction. Cars are swerving into the opposite lane.",
    "categoryHint": "ROAD_DAMAGE",
    "location": {
      "label": "Ngong Road, Nairobi",
      "lat": -1.3001,
      "lng": 36.7854
    }
  }'
```

## 8. Next After Backend Deploy

1. Add frontend runtime config for `ApiUrl`.
2. Replace localStorage calls with API calls.
3. Add Cognito admin login.
4. Deploy frontend to S3 static hosting.
