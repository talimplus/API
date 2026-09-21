import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import { CustomValidationPipe } from './common/pipes/custom-validation.pipe';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { TypeOrmExceptionFilter } from '@/common/filters/typeorm-exception.filter';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Express standarti 100kb — tashkilot logotipi/favicon'i data URL bo'lib
  // kelgani uchun yetmaydi (413 qaytardi). 2mb hamma joyga yetadi.
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ limit: '2mb', extended: true }));

  app.useGlobalPipes(new CustomValidationPipe());
  app.useGlobalFilters(new TypeOrmExceptionFilter());
  // Content-Disposition — frontend excel export fayl nomini o'qiy olishi uchun
  app.enableCors({ exposedHeaders: ['Content-Disposition'] });

  const config = new DocumentBuilder()
    .setTitle('Learning Center CRM')
    .setDescription('API documentation')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        in: 'header',
      },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document); // Swagger UI shu yerga chiqadi

  await app.listen(process.env.PORT ?? 3004);
}
bootstrap().then();
