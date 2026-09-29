const path = require("node:path");

const cdk = require("aws-cdk-lib");
const apigwv2 = require("aws-cdk-lib/aws-apigatewayv2");
const authorizers = require("aws-cdk-lib/aws-apigatewayv2-authorizers");
const integrations = require("aws-cdk-lib/aws-apigatewayv2-integrations");
const cloudfront = require("aws-cdk-lib/aws-cloudfront");
const origins = require("aws-cdk-lib/aws-cloudfront-origins");
const cognito = require("aws-cdk-lib/aws-cognito");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const lambda = require("aws-cdk-lib/aws-lambda");
const s3 = require("aws-cdk-lib/aws-s3");
const { Construct } = require("constructs");

class MtaaFixStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const incidentsTable = new dynamodb.Table(this, "IncidentsTable", {
      partitionKey: { name: "incidentId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    incidentsTable.addGlobalSecondaryIndex({
      indexName: "status-updatedAt-index",
      partitionKey: { name: "status", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "updatedAt", type: dynamodb.AttributeType.STRING },
    });

    incidentsTable.addGlobalSecondaryIndex({
      indexName: "category-status-index",
      partitionKey: { name: "category", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "status", type: dynamodb.AttributeType.STRING },
    });

    const reportsTable = new dynamodb.Table(this, "ReportsTable", {
      partitionKey: { name: "reportId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    reportsTable.addGlobalSecondaryIndex({
      indexName: "incidentId-createdAt-index",
      partitionKey: { name: "incidentId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
    });

    const eventsTable = new dynamodb.Table(this, "IncidentEventsTable", {
      partitionKey: { name: "incidentId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "eventKey", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const photosBucket = new s3.Bucket(this, "IssuePhotosBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: ["*"],
          allowedHeaders: ["content-type"],
          maxAge: 300,
        },
      ],
    });

    const websiteBucket = new s3.Bucket(this, "WebsiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const userPool = new cognito.UserPool(this, "AdminUserPool", {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      passwordPolicy: {
        minLength: 10,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const userPoolClient = new cognito.UserPoolClient(this, "AdminUserPoolClient", {
      userPool,
      authFlows: { userPassword: true, userSrp: true },
    });

    const api = new apigwv2.HttpApi(this, "MtaaFixHttpApi", {
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PATCH,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ["authorization", "content-type"],
      },
    });

    const adminAuthorizer = new authorizers.HttpUserPoolAuthorizer("AdminAuthorizer", userPool, {
      userPoolClients: [userPoolClient],
    });

    const env = {
      STORE_TYPE: "dynamodb",
      INCIDENTS_TABLE: incidentsTable.tableName,
      REPORTS_TABLE: reportsTable.tableName,
      EVENTS_TABLE: eventsTable.tableName,
      PHOTOS_BUCKET: photosBucket.bucketName,
    };

    const apiRouter = this.apiFunction("ApiRouterFn", "handlers/router.handler", env);

    incidentsTable.grantReadWriteData(apiRouter);
    reportsTable.grantReadWriteData(apiRouter);
    eventsTable.grantReadWriteData(apiRouter);
    photosBucket.grantPut(apiRouter);
    photosBucket.grantRead(apiRouter);

    addRoute(api, "POST", "/v1/reports/analyze", apiRouter);
    addRoute(api, "POST", "/v1/reports", apiRouter);
    addRoute(api, "POST", "/v1/uploads/presign", apiRouter);
    addRoute(api, "GET", "/v1/incidents/public", apiRouter);
    addRoute(api, "GET", "/v1/incidents/public/{incidentId}", apiRouter);
    addRoute(api, "GET", "/v1/tracking/{incidentId}", apiRouter);

    addRoute(api, "GET", "/v1/admin/incidents", apiRouter, adminAuthorizer);
    addRoute(api, "GET", "/v1/admin/incidents/{incidentId}", apiRouter, adminAuthorizer);
    addRoute(api, "PATCH", "/v1/admin/incidents/{incidentId}", apiRouter, adminAuthorizer);
    addRoute(api, "GET", "/v1/admin/incidents/{incidentId}/reports", apiRouter, adminAuthorizer);
    addRoute(api, "GET", "/v1/admin/photos", apiRouter, adminAuthorizer);

    const websiteOriginAccessIdentity = new cloudfront.OriginAccessIdentity(this, "WebsiteOriginAccessIdentity");
    websiteBucket.grantRead(websiteOriginAccessIdentity);

    const apiDomainName = cdk.Fn.select(2, cdk.Fn.split("/", api.apiEndpoint));
    const distribution = new cloudfront.Distribution(this, "WebDistribution", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: new origins.S3Origin(websiteBucket, { originAccessIdentity: websiteOriginAccessIdentity }),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
      },
      additionalBehaviors: {
        "v1/*": {
          origin: new origins.HttpOrigin(apiDomainName, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          }),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    new cdk.CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new cdk.CfnOutput(this, "AdminUserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "AdminUserPoolClientId", { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, "PhotosBucketName", { value: photosBucket.bucketName });
    new cdk.CfnOutput(this, "WebsiteBucketName", { value: websiteBucket.bucketName });
    new cdk.CfnOutput(this, "CloudFrontDomainName", { value: distribution.distributionDomainName });
    new cdk.CfnOutput(this, "CloudFrontUrl", { value: `https://${distribution.distributionDomainName}` });
  }

  apiFunction(id, handler, environment) {
    return new lambda.Function(this, id, {
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 128,
      timeout: cdk.Duration.seconds(10),
      handler,
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api")),
      environment,
    });
  }
}

function addRoute(api, method, pathValue, fn, authorizer) {
  const integrationId = `${method}${pathValue}`.replace(/[^A-Za-z0-9]/g, "");
  api.addRoutes({
    path: pathValue,
    methods: [apigwv2.HttpMethod[method]],
    integration: new integrations.HttpLambdaIntegration(`${integrationId}Integration`, fn),
    authorizer,
  });
}

module.exports = { MtaaFixStack };
