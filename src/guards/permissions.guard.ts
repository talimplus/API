import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '@/decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '@/decorators/public.decorator';
import { RolesService } from '@/modules/roles/roles.service';

/**
 * Dinamik ruxsat guard'i.
 *
 * `@RequirePermissions('students.create')` bo'lgan endpoint'da foydalanuvchining
 * roli (`users.userRole`) shu kalitga egaligini tekshiradi. Dekorator qo'yilmagan
 * endpoint'lar bu guard uchun ochiq (autentifikatsiya baribir `JwtAuthGuard` da).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rolesService: RolesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.userId) {
      throw new ForbiddenException('Sizda bu amal uchun ruxsat yo‘q');
    }

    const allowed = await this.rolesService.userHasPermission(user, required);
    if (!allowed) {
      throw new ForbiddenException('Sizda bu amal uchun ruxsat yo‘q');
    }

    return true;
  }
}
