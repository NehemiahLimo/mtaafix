# MtaaFix AWS Deployment Runbook

This deploys the low-cost AWS MVP. Bedrock, OpenSearch, VPCs, NAT Gateway, RDS, ECS, and EKS are intentionally not used.

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
- `WebsiteBucketName`
- `CloudFrontUrl`
- `CloudFrontDomainName`

## 6. Upload Frontend Assets

CloudFront serves the frontend from the private S3 website bucket and forwards `/v1/*` to API Gateway.

```bash
aws s3 cp index.html "s3://$WebsiteBucketName/index.html" \
  --content-type text/html \
  --cache-control no-cache
aws s3 sync src "s3://$WebsiteBucketName/src" --delete
aws s3 sync public "s3://$WebsiteBucketName/public" --delete
```

After uploading, invalidate CloudFront:

```bash
DistributionId=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?DomainName=='$CloudFrontDomainName'].Id | [0]" \
  --output text)

aws cloudfront create-invalidation \
  --distribution-id "$DistributionId" \
  --paths "/*"
```

## 7. Seed Demo Data

After deployment, get table names from CloudFormation or the AWS Console and run:

```bash
INCIDENTS_TABLE=<incidents-table-name> \
REPORTS_TABLE=<reports-table-name> \
EVENTS_TABLE=<events-table-name> \
npm --prefix api run seed:demo
```

## 8. Smoke Test Public API

```bash
curl "$ApiUrl/v1/incidents/public"
curl "$ApiUrl/v1/tracking/MTF-2026-00182"
curl "$CloudFrontUrl/v1/incidents/public"
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

## 9. Smoke Test Photo Upload

Presign:

```bash
curl -X POST "$CloudFrontUrl/v1/uploads/presign" \
  -H "content-type: application/json" \
  -d '{
    "contentType": "image/png",
    "contentLength": 68
  }'
```

The browser report form uses this endpoint to PUT the selected image directly to S3, then submits the returned `photoKey` with `/v1/reports`.

## 10. GitHub Actions Setup

The workflow at `.github/workflows/deploy.yml` runs checks, deploys CDK, uploads frontend assets to S3, invalidates CloudFront, and smoke-tests the deployed app.

Create a GitHub OIDC IAM role and save its ARN as the repository secret:

```text
AWS_ROLE_TO_ASSUME=arn:aws:iam::<account-id>:role/<github-actions-deploy-role>
```

The role needs enough permissions for:

- CloudFormation/CDK deploy for this stack.
- Lambda, API Gateway, DynamoDB, S3, Cognito, IAM, and CloudFront resources created by the stack.
- S3 object upload to the website bucket.
- CloudFront invalidation.

Recommended trust policy shape:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:<github-owner>/<github-repo>:*"
        }
      }
    }
  ]
}
```

## 11. Next After Automated Deploy

1. Add a custom domain and ACM certificate.
2. Add budget alerts and CloudWatch alarms.
3. Tighten production data retention and removal policies.
