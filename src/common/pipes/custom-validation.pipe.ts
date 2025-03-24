import { Injectable, ValidationPipe } from '@nestjs/common';
import { ValidationException } from '@/common/exceptions/validation.exception';

@Injectable()
export class CustomValidationPipe extends ValidationPipe {
  constructor() {
    super({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) => {
        const formattedErrors: Record<string, string[]> = {};

        for (const error of errors) {
          const field = error.property;
          formattedErrors[field] = Object.values(error.constraints || {});
        }

        return new ValidationException(formattedErrors);
      },
    });
  }
}
