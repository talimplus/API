import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { AuditLogsService } from '@/modules/audit-logs/audit-logs.service';
import { AuditAction } from '@/modules/audit-logs/audit-log.enums';
import {
  actionForMethod,
  decodeJwtPayload,
  isReadOnlyMutation,
  resolveAuditModule,
  sanitizeForAudit,
  sanitizeRecord,
  toPositiveInt,
} from '@/modules/audit-logs/audit-log.utils';
import { getClientIp } from '@/shared/utils/request-ip';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SWAGGER_OPERATION = 'swagger/apiOperation';
const HTTP_CODE_METADATA = '__httpCode__';
export const SKIP_AUDIT_KEY = 'skipAudit';

/**
 * Hech narsa o'zgartirmaydigan POST/PUT endpoint uchun: jurnalga yozilmaydi.
 * (`preview` va `/group-schedule/conflicts` avtomatik o'tkazib yuboriladi.)
 */
export const SkipAudit = () => SetMetadata(SKIP_AUDIT_KEY, true);

/**
 * Global harakatlar jurnali: ma'lumotni o'zgartiradigan har bir so'rov
 * (POST/PUT/PATCH/DELETE) — muvaffaqiyatli ham, xato bilan tugagan ham —
 * `audit_logs` ga yoziladi. GET'lar yozilmaydi.
 *
 * Guard'lardan keyin ishlaydi: 401/403 bilan rad etilgan so'rov jurnalga
 * tushmaydi, validatsiya (422) va biznes xatolari (400) esa tushadi.
 * Login — `@Public()`: xodim javobdagi tokendan aniqlanadi.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditLogs: AuditLogsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const method = String(req.method ?? '').toUpperCase();
    if (!MUTATING.has(method)) return next.handle();

    const path: string = req.route?.path ?? req.path ?? '';
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip || isReadOnlyMutation(path)) return next.handle();

    const startedAt = Date.now();
    return next.handle().pipe(
      tap((result) =>
        this.write(context, req, method, path, startedAt, result),
      ),
      catchError((err) => {
        this.write(context, req, method, path, startedAt, undefined, err);
        return throwError(() => err);
      }),
    );
  }

  private write(
    context: ExecutionContext,
    req: any,
    method: string,
    path: string,
    startedAt: number,
    result: unknown,
    error?: unknown,
  ): void {
    try {
      let action = actionForMethod(method);
      let organizationId = toPositiveInt(req.user?.organizationId);
      let actorId = toPositiveInt(req.user?.userId);
      let centerId = toPositiveInt(req.user?.centerId);

      if (path === '/auth/login') {
        // Muvaffaqiyatsiz login — tashkilot noma'lum, yozilmaydi.
        const payload = decodeJwtPayload((result as any)?.access_token);
        organizationId = toPositiveInt(payload?.organizationId);
        actorId = toPositiveInt(payload?.sub);
        centerId = toPositiveInt(payload?.centerId);
        action = AuditAction.LOGIN;
      } else if (path === '/auth/logout') {
        action = AuditAction.LOGOUT;
      }
      if (!organizationId) return;

      const body = req.body ?? {};
      const centerFromRequest =
        toPositiveInt(body?.centerId) ?? toPositiveInt(req.query?.centerId);

      const handler = context.getHandler();
      const operation = this.reflector.get<{ summary?: string }>(
        SWAGGER_OPERATION,
        handler,
      );
      const params = (req.params ?? {}) as Record<string, unknown>;
      const resultId =
        result && typeof result === 'object' && !Array.isArray(result)
          ? (result as any).id
          : undefined;
      const entity = params.id ?? resultId;

      this.auditLogs.record({
        organizationId,
        centerId: centerFromRequest ?? centerId,
        actorId,
        module: resolveAuditModule(path),
        action,
        method,
        path: path.slice(0, 255),
        // Query string `query` ustunida (niqoblangan) — bu yerda faqat yo'l.
        url: String(req.originalUrl ?? req.url ?? path).split('?')[0],
        handler: `${context.getClass().name}.${handler.name}`.slice(0, 160),
        summary: operation?.summary ?? null,
        entityId:
          entity === undefined || entity === null
            ? null
            : String(entity).slice(0, 64),
        params: sanitizeRecord(params),
        query: sanitizeRecord(req.query),
        body: path === '/auth/login' ? null : sanitizeForAudit(body),
        statusCode: error
          ? statusOf(error)
          : (this.reflector.get<number>(HTTP_CODE_METADATA, handler) ??
            (method === 'POST' ? 201 : 200)),
        success: !error,
        errorMessage: error ? messageOf(error) : null,
        ip: getClientIp(req),
        userAgent: req.headers?.['user-agent']
          ? String(req.headers['user-agent']).slice(0, 500)
          : null,
        durationMs: Date.now() - startedAt,
      });
    } catch {
      // Jurnal — ikkinchi darajali: hech qachon so'rovni buzmaydi.
    }
  }
}

function statusOf(error: unknown): number {
  if (error instanceof HttpException) return error.getStatus();
  // `TypeOrmExceptionFilter` unique xatosini 422 ga aylantiradi.
  return (error as any)?.code === '23505' ? 422 : 500;
}

function messageOf(error: unknown): string {
  if (error instanceof HttpException) {
    const res = error.getResponse() as any;
    if (res && typeof res === 'object') {
      if (res.errors) {
        return `${res.message ?? error.message}: ${JSON.stringify(
          res.errors,
        )}`.slice(0, 1000);
      }
      const msg = Array.isArray(res.message)
        ? res.message.join('; ')
        : res.message;
      if (msg) return String(msg).slice(0, 1000);
    }
    return error.message.slice(0, 1000);
  }
  if ((error as any)?.code === '23505') return 'Unique constraint';
  // 500 — ichki xato matni foydalanuvchiga ko'rsatilmaydi.
  return 'Internal server error';
}
