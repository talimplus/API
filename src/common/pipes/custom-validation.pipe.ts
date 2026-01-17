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
        const formattedErrors: Record<string, string> = {};

        const collect = (errs: any[], parentPath = '') => {
          for (const error of errs) {
            const field = parentPath ? `${parentPath}.${error.property}` : error.property;
            const constraints = error?.constraints ? Object.values(error.constraints) : [];
            if (constraints.length > 0) {
              formattedErrors[field] = String(constraints[0]);
            }
            if (Array.isArray(error?.children) && error.children.length > 0) {
              collect(error.children, field);
            }
          }
        };

        collect(errors as any[]);

        return new ValidationException(formattedErrors);
      },
    });
  }
}
