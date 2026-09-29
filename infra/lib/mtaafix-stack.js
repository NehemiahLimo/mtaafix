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

    const analyzeReports = this.apiFunction("AnalyzeReportsFn", "handlers/reports.analyzeReportHandler", env);
    const createReport = this.apiFunction("CreateReportFn", "handlers/reports.createReportHandler", env);
    const presignUpload = this.apiFunction("PresignUploadFn", "handlers/reports.presignUploadHandler", env);
    const listPublicIncidents = this.apiFunction("ListPublicIncidentsFn", "handlers/incidents.listPublicIncidentsHandler", env);
    const getPublicIncident = this.apiFunction("GetPublicIncidentFn", "handlers/incidents.getPublicIncidentHandler", env);
    const listAdminIncidents = this.apiFunction("ListAdminIncidentsFn", "handlers/admin.listAdminIncidentsHandler", env);
    const getAdminIncident = this.apiFunction("GetAdminIncidentFn", "handlers/admin.getAdminIncidentHandler", env);
    const updateAdminIncident = this.apiFunction("UpdateAdminIncidentFn", "handlers/admin.updateAdminIncidentHandler", env);
    const listAdminReports = this.apiFunction("ListAdminReportsFn", "handlers/admin.listAdminReportsHandler", env);

    for (const fn of [
      analyzeReports,
      createReport,
      listPublicIncidents,
      getPublicIncident,
      listAdminIncidents,
      getAdminIncident,
      updateAdminIncident,
      listAdminReports,
    ]) {
      incidentsTable.grantReadWriteData(fn);
      reportsTable.grantReadWriteData(fn);
      eventsTable.grantReadWriteData(fn);
    }
    photosBucket.grantPut(presignUpload);

    addRoute(api, "POST", "/v1/reports/analyze", analyzeReports);
    addRoute(api, "POST", "/v1/reports", createReport);
    addRoute(api, "POST", "/v1/uploads/presign", presignUpload);
    addRoute(api, "GET", "/v1/incidents/public", listPublicIncidents);
    addRoute(api, "GET", "/v1/incidents/public/{incidentId}", getPublicIncident);
    addRoute(api, "GET", "/v1/tracking/{incidentId}", getPublicIncident);

    addRoute(api, "GET", "/v1/admin/incidents", listAdminIncidents, adminAuthorizer);
    addRoute(api, "GET", "/v1/admin/incidents/{incidentId}", getAdminIncident, adminAuthorizer);
    addRoute(api, "PATCH", "/v1/admin/incidents/{incidentId}", updateAdminIncident, adminAuthorizer);
    addRoute(api, "GET", "/v1/admin/incidents/{incidentId}/reports", listAdminReports, adminAuthorizer);

    const websiteOriginAccessIdentity = new cloudfront.OriginAccessIdentity(this, "WebsiteOriginAccessIdentity");
    websiteBucket.grantRead(websiteOriginAccessIdentity);

    const apiDomainName = cdk.Fn.select(2, cdk.Fn.split("/", api.apiEndpoint));
    const distribution = new cloudfront.Distribution(this, "WebDistribution", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: new origins.S3Origin(websiteBucket, { originAccessIdentity: websiteOriginAccessIdentity }),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
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
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.minutes(1),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.minutes(1),
        },
      ],
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
  api.addRoutes({
    path: pathValue,
    methods: [apigwv2.HttpMethod[method]],
    integration: new integrations.HttpLambdaIntegration(`${fn.node.id}Integration`, fn),
    authorizer,
  });
}

module.exports = { MtaaFixStack };
