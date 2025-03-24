import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import { CustomValidationPipe } from './common/pipes/custom-validation.pipe';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new CustomValidationPipe());
  app.enableCors();
  await app.listen(process.env.PORT ?? 3004);
}
bootstrap().then();
