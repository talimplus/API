import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '@/decorators/public.decorator';
import { OrganizationsService } from '@/modules/organizations/organizations.service';

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.organizationId) {
      throw new UnauthorizedException('Tizimga kira olmaysiz');
    }

    const organization =
      await this.organizationsService.findByIdWithSubscription(
        user.organizationId,
      );

    const now = new Date();

    const hasActiveSubscription =
      organization?.subscriptions?.some(
        (s) => s.status === 'active' && new Date(s.endDate) > now,
      ) ?? false;

    if (!organization?.isVip && !hasActiveSubscription) {
      throw new UnauthorizedException('Obuna muddati tugagan yoki mavjud emas');
    }

    return true;
  }
}
