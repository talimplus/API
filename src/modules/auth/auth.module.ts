import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from '@/modules/users/users.module';
import { JwtStrategy } from '@/modules/auth/jwt.strategy';
import { JwtAuthGuard } from '@/guards/auth.guard';
import { SubscriptionsModule } from '@/modules/subscriptions/subscriptions.module';
import { CentersModule } from '@/modules/centers/centers.module';
import { OrganizationsModule } from '@/modules/organizations/organizations.module';
import { BlacklistModule } from '@/modules/blacklist/blacklist.module';
import * as dotenv from 'dotenv';

dotenv.config();

@Module({
  imports: [
    SubscriptionsModule,
    OrganizationsModule,
    ConfigModule,
    UsersModule,
    CentersModule,
    BlacklistModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '24h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard],
})
export class AuthModule {}
