import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import { CustomValidationPipe } from './common/pipes/custom-validation.pipe';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new CustomValidationPipe());
  app.enableCors();

  const config = new DocumentBuilder()
    .setTitle('Learning Center CRM')
    .setDescription('API documentation')
    .setVersion('1.0')
    .addBearerAuth() // agar JWT token ishlatsa, kerak bo‘lmasa olib tashlang
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document); // Swagger UI shu yerga chiqadi

  await app.listen(process.env.PORT ?? 3004);
}
bootstrap().then();
