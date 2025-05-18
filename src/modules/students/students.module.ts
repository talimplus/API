import { OrganizationsModule } from '@/modules/organizations/organizations.module';
import { ReferralsModule } from '@/modules/referrals/referrals.module';
import { Student } from '@/modules/students/entities/students.entity';
import { StudentsService } from '@/modules/students/students.service';
import { CentersModule } from '@/modules/centers/centers.module';
import { Group } from '@/modules/groups/entities/groups.entity';
import { GroupsModule } from '@/modules/groups/groups.module';
import { StudentsController } from './students.controller';
import { UsersModule } from '@/modules/users/users.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { forwardRef, Module } from '@nestjs/common';

@Module({
  imports: [
    TypeOrmModule.forFeature([Student, Group]),
    CentersModule,
    UsersModule,
    OrganizationsModule,
    GroupsModule,
    ReferralsModule,
    forwardRef(() => ReferralsModule),
  ],
  controllers: [StudentsController],
  providers: [StudentsService],
  exports: [StudentsService],
})
export class StudentsModule {}
