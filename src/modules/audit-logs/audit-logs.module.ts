import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '@/modules/audit-logs/entities/audit-log.entity';
import { AuditLogsService } from '@/modules/audit-logs/audit-logs.service';
import { AuditLogsController } from '@/modules/audit-logs/audit-logs.controller';
import { AuditLogInterceptor } from '@/modules/audit-logs/audit-log.interceptor';

/**
 * Harakatlar jurnali. Interceptor global (`APP_INTERCEPTOR`) — boshqa
 * modullar hech narsa chaqirmaydi, har bir o'zgartiruvchi so'rov o'zi yoziladi.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  controllers: [AuditLogsController],
  providers: [
    AuditLogsService,
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
