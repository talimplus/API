import { BadRequestException } from '@nestjs/common';

export class ValidationException extends BadRequestException {
  constructor(public validationErrors: Record<string, string[]>) {
    super({
      statusCode: 422,
      message: 'Validation Failed',
      errors: validationErrors,
    });
  }
}
