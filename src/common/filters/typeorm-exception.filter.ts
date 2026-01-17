import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { ValidationException } from '@/common/exceptions/validation.exception';

@Catch(QueryFailedError)
export class TypeOrmExceptionFilter implements ExceptionFilter {
  catch(exception: QueryFailedError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<any>();

    const driver: any = (exception as any)?.driverError ?? {};
    const code = driver?.code;

    // Postgres unique violation
    if (code === '23505') {
      const constraint = driver?.constraint as string | undefined;
      const detail = driver?.detail as string | undefined;

      // Try to extract column from detail: Key (phone)=(...) already exists.
      const match = detail?.match(/Key\s+\(([^)]+)\)=\(/i);
      const columnFromDetail = match?.[1];

      const column =
        columnFromDetail ??
        (constraint === 'UQ_a000cca60bcf04454e727699490'
          ? 'phone'
          : constraint === 'UQ_2d443082eccd5198f95f2a36e2c'
            ? 'login'
            : undefined);

      const messageByColumn: Record<string, string> = {
        phone: 'Bunday phone allaqachon mavjud',
        login: 'Bunday login allaqachon mavjud',
      };

      const errors: Record<string, string> = {
        [(column ?? 'unique') as string]:
          (column && messageByColumn[column]) ||
          'Bu qiymat allaqachon mavjud (unique constraint)',
      };

      const body = new ValidationException(errors).getResponse();
      return response.status(HttpStatus.UNPROCESSABLE_ENTITY).json(body);
    }

    // Fallback for other query errors
    return response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      message: 'Database Error',
    });
  }
}

