/**
 * O'qituvchilar davomatini (xodim davomati, "Keldim") o'tgan davr uchun to'ldiradi:
 * har bir o'qituvchining darsi bo'lgan har kuni — bugungacha — "keldi" deb yoziladi.
 * Sheet'da o'qituvchi davomati yuritilmagan; markaz egasi "hammasi kelgan" deb tasdiqlagan.
 *
 * Yozuv kabinetdagi "qo'lda kiritish" bilan bir xil (`manualCheckIn`): source=manual,
 * confidence=high, admin tasdiqlagan. Kelgan vaqt — birinchi darsdan 10 daqiqa oldin,
 * shuning uchun kechikish 0. Kelajakdagi vaqt (bugun hali boshlanmagan dars) yozilmaydi.
 *
 *   npx ts-node -r tsconfig-paths/register --transpile-only \
 *     scripts/legacy-import/litech/staff-attendance.ts --org 4 --admin litech@talimplus.uz
 */
import 'reflect-metadata';
import * as path from 'path';
import { dataSourceOptions } from '../../../db/data-source';

(dataSourceOptions as any).entities = [path.join(__dirname, '../../../src/**/*.entity.ts')];

import type { INestApplicationContext } from '@nestjs/common';

const EARLY_MINUTES = 10;
const NOTE = 'Google Sheet davridan tiklandi (markaz egasi tasdiqlagan)';

export async function fillTeacherAttendance(
  app: INestApplicationContext,
  opts: { orgId: number; adminId: number; to: string },
): Promise<{ teachers: number; days: number; skipped: number }> {
  const { DataSource } = await import('typeorm');
  const { StaffAttendanceService } = await import('@/modules/staff-attendance/staff-attendance.service');
  const ds = app.get(DataSource);
  const service = app.get(StaffAttendanceService);

  const teachers: { id: number; name: string; from: string | null }[] = await ds.query(
    `SELECT u.id, u."firstName" AS name, TO_CHAR(MIN(g."startDate"), 'YYYY-MM-DD') AS "from"
       FROM users u JOIN groups g ON g."teacherId" = u.id
      WHERE u."organizationId" = $1 AND u.role = 'teacher'
      GROUP BY u.id, u."firstName" ORDER BY u.id`,
    [opts.orgId],
  );
  const reqUser = { userId: opts.adminId, organizationId: opts.orgId, role: 'admin' };

  let days = 0;
  let skipped = 0;
  for (const t of teachers) {
    if (!t.from) continue;
    // Hisobot bilan aynan bir xil dars kunlari (jadval + ko'chirilgan darslar)
    const lessons: Map<string, string> = await (service as any).teacherLessonDays(t.id, t.from, opts.to);
    for (const [date, firstLesson] of [...lessons.entries()].sort()) {
      const [h, m] = firstLesson.split(':').map(Number);
      const minutes = Math.max(0, h * 60 + m - EARLY_MINUTES);
      const checkInTime = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      try {
        await service.manualCheckIn({ userId: t.id, workDate: date, checkInTime, note: NOTE } as any, reqUser);
        days++;
      } catch {
        // Bugungi, hali boshlanmagan dars — kelajak vaqti rad etiladi
        skipped++;
      }
    }
    console.log(`  ${t.name}: ${lessons.size} dars kuni (${t.from} … ${opts.to})`);
  }
  return { teachers: teachers.length, days, skipped };
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (require.main === module) {
  (async () => {
    const orgId = Number(argValue('--org') ?? 4);
    const adminLogin = argValue('--admin') ?? 'litech@talimplus.uz';
    const { NestFactory } = await import('@nestjs/core');
    const { DataSource } = await import('typeorm');
    const { TelegramBotService } = await import('@/modules/telegram/telegram-bot.service');
    TelegramBotService.prototype.onApplicationBootstrap = async () => undefined;
    const { AppModule } = await import('@/app.module');
    const { dayjs } = await import('@/shared/utils/dayjs');

    const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
    try {
      const [admin] = await app.get(DataSource).query(
        `SELECT id FROM users WHERE login = $1 AND "organizationId" = $2`,
        [adminLogin, orgId],
      );
      if (!admin) throw new Error(`Admin ${adminLogin} topilmadi`);
      const to = dayjs().tz('Asia/Tashkent').format('YYYY-MM-DD');
      const r = await fillTeacherAttendance(app, { orgId, adminId: admin.id, to });
      console.log(`• O'qituvchilar davomati: ${r.teachers} o'qituvchi, ${r.days} kun yozildi, ${r.skipped} tasi (hali boshlanmagan) o'tkazildi`);
    } finally {
      await app.close();
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
