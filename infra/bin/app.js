#!/usr/bin/env node

const cdk = require("aws-cdk-lib");
const { MtaaFixStack } = require("../lib/mtaafix-stack");

const app = new cdk.App();

new MtaaFixStack(app, "MtaaFixStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },
});
