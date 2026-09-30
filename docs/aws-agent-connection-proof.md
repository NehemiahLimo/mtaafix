# AWS Agent Connection Proof

This document supports the qualification requirement: a coding agent connected to AWS with documented proof of the connection.

## Summary

MtaaFix is deployed to AWS by a coding-agent-managed GitHub Actions workflow. The workflow uses GitHub OpenID Connect to assume an AWS IAM role, runs validation, deploys the AWS CDK stack, uploads the frontend to S3, invalidates CloudFront, and smoke-tests the live AWS URL.

## Live AWS Application

- Live app: <https://dh02fvmqx87zk.cloudfront.net/>
- Public API through CloudFront: <https://dh02fvmqx87zk.cloudfront.net/v1/incidents/public>
- AWS region: `eu-west-1`
- Stack name: `MtaaFixStack`

## Coding Agent to AWS Connection

The deployment workflow is defined in [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).

Evidence in the workflow:

- `permissions.id-token: write` enables GitHub OIDC.
- `aws-actions/configure-aws-credentials@v4` assumes the AWS deployment role from the repository secret `AWS_ROLE_TO_ASSUME`.
- CDK deploy runs with `npm --prefix infra run deploy -- --require-approval never`.
- Stack outputs are read from CloudFormation.
- Frontend assets are uploaded to the private website S3 bucket.
- CloudFront is invalidated after upload.
- The deployed CloudFront URL and public API are smoke-tested.

Latest successful deployment proof:

- Workflow run: <https://github.com/NehemiahLimo/mtaafix/actions/runs/36682413343>
- Commit deployed: `5c8d48de1993188d14d8f72d22995ad675a40428`
- Run status: completed successfully on 2026-09-30

## AWS Resources Provisioned by IaC

The AWS resources are defined in [`infra/lib/mtaafix-stack.js`](../infra/lib/mtaafix-stack.js) and deployed through AWS CDK:

- Amazon CloudFront distribution for the public web app and `/v1/*` API routing.
- Private Amazon S3 bucket for frontend assets.
- Amazon API Gateway HTTP API.
- AWS Lambda API router.
- Amazon DynamoDB tables for incidents, reports, and incident events.
- Private Amazon S3 bucket for issue photos.
- Amazon Cognito user pool for admin authentication.
- IAM permissions scoped to the deployment and runtime resources.

## Reviewer Verification Steps

1. Open the live app: <https://dh02fvmqx87zk.cloudfront.net/>
2. Open the public API smoke endpoint: <https://dh02fvmqx87zk.cloudfront.net/v1/incidents/public>
3. Open the successful workflow run: <https://github.com/NehemiahLimo/mtaafix/actions/runs/36682413343>
4. In the workflow, verify the steps named:
   - Configure AWS credentials
   - Deploy infrastructure
   - Upload frontend assets
   - Invalidate CloudFront
   - Smoke test CloudFront

## AWS Console Screenshot Checklist

If the submission form requires screenshots instead of links, capture these from the AWS Console:

- CloudFormation stack `MtaaFixStack` showing `CREATE_COMPLETE` or `UPDATE_COMPLETE`.
- CloudFront distribution showing the domain `dh02fvmqx87zk.cloudfront.net`.
- API Gateway HTTP API routes for `/v1/*`.
- Lambda function `ApiRouterFn`.
- DynamoDB tables for incidents, reports, and events.
- S3 buckets for website assets and issue photos.
- Cognito user pool for the admin portal.

Do not include secret values, full IAM role credentials, access keys, or private bucket object listings in screenshots.
