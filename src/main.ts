import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, VersioningType, RequestMethod } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import compression from '@fastify/compress';
import helmet from '@fastify/helmet';
import { AppModule } from './app.module';
import { PublicApiModule } from './public-api/public-api.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const adapter = new FastifyAdapter({
    logger: process.env.NODE_ENV !== 'production',
    bodyLimit: 5 * 1024 * 1024, // 5 MB — accommodate base64-encoded logos
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);

  const config = app.get(ConfigService);

  // CORS before helmet — @fastify/cors must be registered first
  app.enableCors({
    origin: [
      config.get('FRONTEND_URL', 'http://localhost:3000'),
      config.get('PASSENGER_URL', 'http://localhost:3002'),
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Security
  await app.register(helmet as any, { contentSecurityPolicy: false });
  await app.register(compression as any);

  // Global pipes, filters, interceptors
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());

  // API versioning
  app.enableVersioning({ type: VersioningType.URI });
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'passenger/payment/success', method: RequestMethod.GET },
      { path: 'passenger/payment/error',   method: RequestMethod.GET },
    ],
  });

  // Swagger interne (toute l'API) — désactivé en production
  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('TransPro API')
      .setDescription('API de gestion des compagnies de transport - Côte d\'Ivoire')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  // ── Doc développeur publique (API tierce /ext uniquement) ───────────────────
  // Exposée dans tous les environnements : c'est la doc destinée aux partenaires.
  const frontendUrl = config.get('FRONTEND_URL', 'http://localhost:3000');
  const devDocConfig = new DocumentBuilder()
    .setTitle('TransPro — API Partenaires')
    .setDescription(
      [
        'API publique TransPro pour les applications tierces.',
        '',
        `**Démarrer** : créez un compte développeur sur [${frontendUrl}/developer/register](${frontendUrl}/developer/register) ` +
          `puis générez vos clés dans la [console développeur](${frontendUrl}/developer/console). ` +
          `Déjà inscrit ? [Connexion](${frontendUrl}/developer/login).`,
        '',
        '**Authentification** : envoyez votre clé dans le header `X-API-Key`.',
        '**Quotas** : voir les headers `X-RateLimit-*` de chaque réponse.',
        '**Scopes** : chaque endpoint requiert un scope (ex. `trips:read`) couvert par votre plan.',
        '',
        'Les données cross-compagnie ne couvrent que les compagnies ayant activé l’API publique.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .setExternalDoc('Espace développeur (inscription & clés)', `${frontendUrl}/developer/register`)
    .addApiKey(
      { type: 'apiKey', name: 'X-API-Key', in: 'header' },
      'X-API-Key',
    )
    .addServer('/api/v1', 'Base TransPro API v1')
    .build();
  const devDocument = SwaggerModule.createDocument(app, devDocConfig, {
    include: [PublicApiModule],
  });
  SwaggerModule.setup('developers', app, devDocument);

  // Remplace le parser JSON de NestJS/Fastify pour accepter les bodies vides
  // (ex: POST sans payload — Dio envoie Content-Type: application/json sans body).
  // Doit être fait après app.init() qui est déclenché par app.listen().
  await app.init();
  const fastify = app.getHttpAdapter().getInstance();
  fastify.removeContentTypeParser('application/json');
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req: any, body: string, done: any) => {
      if (!body || body.trim() === '') { done(null, {}); return; }
      try {
        const parsed = JSON.parse(body);
        (req as any).rawBody = body; // pour la vérification de signature webhook
        done(null, parsed);
      } catch (err: any) {
        err.statusCode = 400;
        done(err, undefined);
      }
    },
  );

  const port = parseInt(process.env.PORT ?? '', 10) || config.get<number>('API_PORT', 3001);
  await app.listen(port, '0.0.0.0');
  console.log(`TransPro API running on http://localhost:${port}`);
  console.log(`Swagger docs: http://localhost:${port}/docs`);
}

bootstrap();
