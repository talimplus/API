import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import * as dotenv from 'dotenv';
import { BlacklistService } from '@/modules/blacklist/blacklist.service';
import { UsersService } from '@/modules/users/users.service';

dotenv.config();

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error('JWT_SECRET environment variable is not set');
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly blacklistService: BlacklistService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: jwtSecret,
      passReqToCallback: true,
    });
  }

  async validate(req: any, payload: any) {
    const auth = req?.headers?.authorization;
    const token =
      typeof auth === 'string' && auth.startsWith('Bearer ')
        ? auth.slice('Bearer '.length).trim()
        : null;

    if (token) {
      const isBlacklisted =
        await this.blacklistService.isTokenBlacklisted(token);
      if (isBlacklisted) {
        throw new UnauthorizedException('Token is blacklisted');
      }
    }

    // Bloklangan xodimning amaldagi tokeni ham darhol ishlamay qoladi
    // (UsersService'da qisqa kesh — har so'rovda DB'ga bormaydi).
    if (
      payload?.sub &&
      !(await this.usersService.isActiveCached(payload.sub))
    ) {
      throw new UnauthorizedException('Akkaunt bloklangan');
    }

    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      roleId: payload.roleId ?? null,
      centerId: payload.centerId,
      organizationId: payload.organizationId,
    };
  }
}
