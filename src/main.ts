import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import { CustomValidationPipe } from './common/pipes/custom-validation.pipe';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { TypeOrmExceptionFilter } from '@/common/filters/typeorm-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new CustomValidationPipe());
  app.useGlobalFilters(new TypeOrmExceptionFilter());
  app.enableCors();

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
