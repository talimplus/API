import { OrganizationsModule } from '@/modules/organizations/organizations.module';
import { Student } from '@/modules/students/entities/students.entity';
import { CentersModule } from '@/modules/centers/centers.module';
import { GroupsModule } from '@/modules/groups/groups.module';
import { StudentsController } from './students.controller';
import { UsersModule } from '@/modules/users/users.module';
import { StudentsService } from './students.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Module } from '@nestjs/common';

@Module({
  imports: [
    TypeOrmModule.forFeature([Student]),
    CentersModule,
    UsersModule,
    OrganizationsModule,
    GroupsModule,
  ],
  providers: [StudentsService],
  controllers: [StudentsController],
})
export class StudentsModule {}
