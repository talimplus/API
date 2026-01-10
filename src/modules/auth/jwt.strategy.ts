import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import * as dotenv from 'dotenv';
import { BlacklistService } from '@/modules/blacklist/blacklist.service';

dotenv.config();

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly blacklistService: BlacklistService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET,
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
      const isBlacklisted = await this.blacklistService.isTokenBlacklisted(token);
      if (isBlacklisted) {
        throw new UnauthorizedException('Token is blacklisted');
      }
    }

    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      centerId: payload.centerId,
      organizationId: payload.organizationId,
    };
  }
}
