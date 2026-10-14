import { INestApplication, ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { json, urlencoded } from "express";
import { Express, NextFunction, Request, Response } from "express";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { AppEnvironment } from "./config/env.schema";

type ApplicationConfig = Pick<
  AppEnvironment,
  | "NODE_ENV"
  | "API_PREFIX"
  | "FRONTEND_ORIGIN"
  | "TRUST_PROXY_HOPS"
  | "SWAGGER_ENABLED"
>;

export function configureApplication(
  app: INestApplication,
  environment: ApplicationConfig,
): void {
  const docsPath = `/${environment.API_PREFIX}/docs`;
  app.use((request: Request, response: Response, next: NextFunction) => {
    const docsRequest =
      environment.NODE_ENV !== "production" &&
      environment.SWAGGER_ENABLED &&
      request.path.startsWith(docsPath);
    const securityHeaders = helmet(
      docsRequest
        ? {
            contentSecurityPolicy: {
              directives: {
                defaultSrc: ["'self'"],
                baseUri: ["'self'"],
                connectSrc: ["'self'"],
                fontSrc: ["'self'", "data:"],
                imgSrc: ["'self'", "data:"],
                objectSrc: ["'none'"],
                scriptSrc: ["'self'", "'unsafe-inline'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
              },
            },
          }
        : undefined,
    );
    securityHeaders(request, response, next);
  });

  const expressApp = app.getHttpAdapter().getInstance() as Express;
  expressApp.set("trust proxy", environment.TRUST_PROXY_HOPS || false);
  const adminApiPrefix = `/${environment.API_PREFIX}/admin`;
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (
      request.path === adminApiPrefix ||
      request.path.startsWith(`${adminApiPrefix}/`)
    ) {
      response.setHeader("Cache-Control", "no-store");
    }
    next();
  });
  const defaultJson = json({ limit: "64kb" });
  const cmsJson = json({ limit: "512kb" });
  const uploadJson = json({ limit: "12mb" });
  app.use((request: Request, response: Response, next: NextFunction) => {
    const path = request.path;
    const parser =
      path === `${adminApiPrefix}/cms/media` && request.method === "POST"
        ? uploadJson
        : path.startsWith(`${adminApiPrefix}/cms/`)
          ? cmsJson
          : defaultJson;
    parser(request, response, next);
  });
  app.use(urlencoded({ limit: "64kb", extended: true }));
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: string | boolean) => void,
    ) => {
      callback(null, origin === environment.FRONTEND_ORIGIN ? origin : false);
    },
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Accept", "Authorization", "Content-Type"],
    credentials: false,
  });
  app.setGlobalPrefix(environment.API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: { target: false, value: false },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  if (environment.NODE_ENV !== "production" && environment.SWAGGER_ENABLED) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("VidSave API").setVersion("1.0.0").build(),
    );
    SwaggerModule.setup(`${environment.API_PREFIX}/docs`, app, document, {
      jsonDocumentUrl: `${environment.API_PREFIX}/docs-json`,
    });
  }
}
