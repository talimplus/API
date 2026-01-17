import { UnprocessableEntityException } from '@nestjs/common';

export class ValidationException extends UnprocessableEntityException {
  constructor(public validationErrors: Record<string, string>) {
    super({
      statusCode: 422,
      message: 'Validation Failed',
      errors: validationErrors,
    });
  }
}
