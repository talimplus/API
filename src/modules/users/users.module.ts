import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './entities/user.entity';
import { Center } from '@/modules/centers/entities/centers.entity';
import { Organization } from '@/modules/organizations/entities/organizations.entity';
import { OrganizationsModule } from '@/modules/organizations/organizations.module';
import { RolesModule } from '@/modules/roles/roles.module';
import { UserPayModule } from '@/modules/users/user-pay.module';

@Module({
  imports: [
    OrganizationsModule,
    RolesModule,
    UserPayModule,
    TypeOrmModule.forFeature([User, Center, Organization]),
  ],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
