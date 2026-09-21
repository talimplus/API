import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Group } from './entities/groups.entity';
import { Repository } from 'typeorm';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { Center } from '@/modules/centers/entities/centers.entity';
import { Subject } from '@/modules/subjects/entities/subjects.entity';
import { User } from '@/modules/users/entities/user.entity';
import { Room } from '@/modules/rooms/entities/rooms.entity';
import { GroupSchedule } from '@/modules/group_schedule/entities/group-schedule.entity';
import { UserRole } from '@/common/enums/user-role.enums';
import { WeekDay } from '@/common/enums/group-schedule.enum';
import { GroupStatus } from '@/modules/groups/enums/group-status.enum';
import { AttendanceLessonOverride } from '@/modules/attendance/entities/attendance-lesson-override.entity';
import { Student } from '@/modules/students/entities/students.entity';
import { StudentStatus } from '@/common/enums/students-status.enums';
import { PaymentsService } from '@/modules/payments/payments.service';
import { GroupFeeService } from '@/modules/groups/group-fee.service';
import { ScheduleBoardService } from '@/modules/group_schedule/schedule-board.service';
import { ValidationException } from '@/common/exceptions/validation.exception';
import { dayjs } from '@/shared/utils/dayjs';
import { MoreThan } from 'typeorm';

/** To'qnashuv xabarini o'zbekcha yozish uchun (xabar backendda yig'iladi). */
const DAY_LABELS_UZ: Record<WeekDay, string> = {
  [WeekDay.MONDAY]: 'Dushanba',
  [WeekDay.TUESDAY]: 'Seshanba',
  [WeekDay.WEDNESDAY]: 'Chorshanba',
  [WeekDay.THURSDAY]: 'Payshanba',
  [WeekDay.FRIDAY]: 'Juma',
  [WeekDay.SATURDAY]: 'Shanba',
  [WeekDay.SUNDAY]: 'Yakshanba',
};

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    @InjectRepository(Center)
    private readonly centerRepo: Repository<Center>,
    @InjectRepository(Subject)
    private readonly subjectRepo: Repository<Subject>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Room)
    private readonly roomRepo: Repository<Room>,
    @InjectRepository(GroupSchedule)
    private readonly scheduleRepo: Repository<GroupSchedule>,
    @InjectRepository(AttendanceLessonOverride)
    private readonly overrideRepo: Repository<AttendanceLessonOverride>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
    private readonly groupFeeService: GroupFeeService,
    private readonly scheduleBoardService: ScheduleBoardService,
  ) {}

  /**
   * Muddati o'tgan guruhlarni yopadi (tez, idempotent, to'g'ridan-to'g'ri DB'da).
   * Faqat shu organization (va ixtiyoriy center) guruhlariga ta'sir qiladi.
   *
   * Yagona mezon — endDate (guruh timezone'ida, inclusive). Yopilgan guruhlar
   * bo'lsa, ularning o'quvchilari statusi ham qayta hisoblanadi.
   */
  private async finishExpiredGroups(organizationId: number, centerId?: number) {
    const params: any[] = [organizationId];
    let centerFilterSql = '';
    if (centerId) {
      params.push(centerId);
      centerFilterSql = ` AND g."centerId" = $2`;
    }

    const finished: { id: number }[] = await this.groupRepo.query(
      `
      UPDATE "groups" g
      SET "status" = $${params.length + 1}
      WHERE g."status" = $${params.length + 2}
        AND g."endDate" IS NOT NULL
        AND g."endDate" < (NOW() AT TIME ZONE COALESCE(g."timezone", 'Asia/Tashkent'))::date
        AND g."centerId" IN (
          SELECT c."id" FROM "centers" c
          WHERE c."organizationId" = $1
        )
        ${centerFilterSql}
      RETURNING g."id"
    `,
      [...params, GroupStatus.FINISHED, GroupStatus.STARTED],
    );

    if (finished?.length) {
      await this.syncStudentStatusesForGroups(finished.map((r) => r.id));
    }
  }

  /**
   * Guruh statusi o'zgargandan keyin o'sha guruh o'quvchilarining statusini
   * moslaydi:
   * - barcha guruhlari tugagan ACTIVE o'quvchi -> FINISHED;
   * - kamida bitta davom etayotgan guruhi bor FINISHED o'quvchi -> ACTIVE.
   *
   * Ya'ni o'quvchi ikkita fanda o'qiyotgan bo'lsa va faqat bittasi tugasa,
   * uning statusi o'zgarmaydi (ikkinchi guruhda darsi davom etadi).
   */
  async syncStudentStatusesForGroups(groupIds: number[]) {
    const ids = Array.from(
      new Set((groupIds ?? []).filter((id) => Number.isFinite(id))),
    );
    if (!ids.length) return;

    // 1) Hamma guruhi tugagan o'quvchilarni yopamiz.
    await this.studentRepo.query(
      `
      UPDATE "students" s
      SET "status" = $2
      WHERE s."status" = $1
        AND EXISTS (
          SELECT 1 FROM "students_groups_groups" sg
          WHERE sg."studentsId" = s."id" AND sg."groupsId" = ANY($3::int[])
        )
        AND NOT EXISTS (
          SELECT 1 FROM "students_groups_groups" sg
          JOIN "groups" g ON g."id" = sg."groupsId"
          WHERE sg."studentsId" = s."id" AND g."status" <> $4
        )
      `,
      [StudentStatus.ACTIVE, StudentStatus.FINISHED, ids, GroupStatus.FINISHED],
    );

    // 2) Guruhi qayta ochilgan (yoki yangi guruhga biriktirilgan) o'quvchilarni
    //    qaytaramiz.
    await this.studentRepo.query(
      `
      UPDATE "students" s
      SET "status" = $1
      WHERE s."status" = $2
        AND EXISTS (
          SELECT 1 FROM "students_groups_groups" sg
          WHERE sg."studentsId" = s."id" AND sg."groupsId" = ANY($3::int[])
        )
        AND EXISTS (
          SELECT 1 FROM "students_groups_groups" sg
          JOIN "groups" g ON g."id" = sg."groupsId"
          WHERE sg."studentsId" = s."id" AND g."status" <> $4
        )
      `,
      [StudentStatus.ACTIVE, StudentStatus.FINISHED, ids, GroupStatus.FINISHED],
    );
  }

  /** DATE qiymatini 'YYYY-MM-DD' ga keltiradi (timezone siljishisiz). */
  private toDateOnly(value?: Date | string | null): string | null {
    if (!value) return null;
    return dayjs(value).format('YYYY-MM-DD');
  }

  /** Guruh timezone'idagi bugungi sana. */
  private todayInGroupTz(group: Group): string {
    return dayjs()
      .tz(group.timezone || 'Asia/Tashkent')
      .format('YYYY-MM-DD');
  }

  /**
   * endDate <-> status mosligi:
   * - tugash sanasi o'tib ketgan `started` guruh -> `finished`;
   * - tugash sanasi kelajakka surilgan `finished` guruh -> qayta `started`.
   * `new` guruh esa hech qachon avtomatik yopilmaydi (hali boshlanmagan).
   */
  private applyEndDateStatusRules(group: Group): boolean {
    const endDate = this.toDateOnly(group.endDate);
    const today = this.todayInGroupTz(group);

    if (endDate && endDate < today) {
      if (group.status === GroupStatus.STARTED) {
        group.status = GroupStatus.FINISHED;
        return true;
      }
      return false;
    }

    if (group.status === GroupStatus.FINISHED) {
      group.status = GroupStatus.STARTED;
      if (!group.startedAt) group.startedAt = new Date();
      return true;
    }

    return false;
  }

  /**
   * Guruh sanasi/jadvali/narxi o'zgargach shu guruhning ochiq to'lovlarini
   * qayta hisoblaydi: tugash sanasidan keyingi oylar o'chadi, guruh oy
   * o'rtasida tugasa o'sha oy faqat haqiqiy dars kunlari uchun hisoblanadi.
   */
  private async recalcGroupPayments(groupId: number) {
    try {
      await this.paymentsService.recalculateOpenPaymentsForGroup(groupId, {
        maxMonthsBack: 3,
      });
    } catch (e) {
      this.logger.warn(
        `Guruh ${groupId} to'lovlarini qayta hisoblashda xato: ${
          (e as any)?.message ?? e
        }`,
      );
    }
  }

  /**
   * Xona va o'qituvchi bandligi.
   *
   * Bitta xonada (va bitta o'qituvchida) bir vaqtning o'zida ikkita dars
   * bo'lolmaydi. Kesishish haqiqiy vaqt oralig'i bo'yicha hisoblanadi:
   * `[startTime .. startTime + lessonDurationMinutes)`. Ya'ni 09:00–10:30 va
   * 10:30–12:00 to'qnashmaydi, 09:00–10:30 va 10:00–11:30 esa to'qnashadi.
   *
   * Xato 422 bo'lib qaytadi va aynan tegishli maydonga (`roomId` /
   * `teacherId`) bog'lanadi — formada shu input ostida ko'rinadi.
   */
  private async assertScheduleAvailable(args: {
    organizationId: number;
    roomId?: number | null;
    teacherId?: number | null;
    days?: { day: WeekDay; startTime: string }[];
    durationMinutes?: number | null;
    excludeGroupId?: number;
  }) {
    const conflicts = await this.scheduleBoardService.findConflicts({
      organizationId: args.organizationId,
      days: args.days ?? [],
      durationMinutes: args.durationMinutes,
      roomId: args.roomId ?? null,
      teacherId: args.teacherId ?? null,
      excludeGroupId: args.excludeGroupId ?? null,
    });
    if (!conflicts.length) return;

    const describe = (c: (typeof conflicts)[number]) =>
      `"${c.groupName}" — ${DAY_LABELS_UZ[c.day] ?? c.day} ${c.startTime}–${c.endTime}`;

    const errors: Record<string, string> = {};

    const roomConflicts = conflicts.filter((c) => c.reason === 'room');
    if (roomConflicts.length) {
      errors.roomId = `Xona band: ${roomConflicts.map(describe).join('; ')}`;
    }

    const teacherConflicts = conflicts.filter((c) => c.reason === 'teacher');
    if (teacherConflicts.length) {
      errors.teacherId = `O'qituvchi band: ${teacherConflicts
        .map(describe)
        .join('; ')}`;
    }

    throw new ValidationException(errors);
  }

  async create(dto: CreateGroupDto, centerId: number, role: UserRole) {
    if (role === UserRole.ADMIN && !dto.centerId) {
      throw new BadRequestException('Admin uchun centerId bo‘lishi kerak');
    }
    const center = await this.centerRepo.findOne({
      where: { id: centerId || dto.centerId },
    });
    if (!center) throw new NotFoundException('Bunday center mavjud emas');

    let room;
    if (dto.roomId) {
      room = await this.roomRepo.findOne({
        where: { id: dto.roomId, center: { id: centerId } },
      });
      if (!room) throw new NotFoundException('Bunday xona mavjud emas');
    }

    const subject = await this.subjectRepo.findOne({
      where: {
        id: dto.subjectId,
        center: { id: centerId || dto.centerId },
      },
    });

    if (!subject) {
      throw new BadRequestException(
        'Subject bu markazga tegishli emas yoki mavjud emas',
      );
    }

    let teacher: User = null;
    if (dto.teacherId) {
      teacher = await this.userRepo.findOne({
        where: {
          id: dto.teacherId,
          center: { id: centerId || dto.centerId },
        },
      });

      if (!teacher) {
        throw new BadRequestException(
          'Ushbu o‘qituvchi bu markazga tegishli emas yoki mavjud emas',
        );
      }
    }

    await this.assertScheduleAvailable({
      organizationId: center.organizationId,
      roomId: dto.roomId,
      teacherId: dto.teacherId,
      days: dto.days,
      durationMinutes: dto.lessonDurationMinutes,
    });

    const startDate = dto.startDate
      ? dayjs(dto.startDate).format('YYYY-MM-DD')
      : null;
    const endDate = dto.endDate
      ? dayjs(dto.endDate).format('YYYY-MM-DD')
      : null;
    if (startDate && endDate && endDate < startDate) {
      throw new ValidationException({
        endDate: `Tugash sanasi boshlanish sanasidan (${startDate}) oldin bo'lishi mumkin emas`,
      });
    }

    const group = this.groupRepo.create({
      name: dto.name,
      monthlyFee: dto.monthlyFee,
      center,
      subject,
      teacher,
      room,
      timezone: dto.timezone,
      lessonDurationMinutes: dto.lessonDurationMinutes ?? 90,
      // DATE ustunlariga string yoziladi — timezone siljishining oldini oladi.
      startDate: (startDate ?? undefined) as unknown as Date,
      endDate: (endDate ?? null) as unknown as Date | null,
      status: GroupStatus.NEW,
      startedAt: null,
    });

    const savedGroup = await this.groupRepo.save(group);

    if (dto.days && dto.days.length > 0) {
      const schedules = dto.days.map((day) =>
        this.scheduleRepo.create({
          day: day.day,
          startTime: day.startTime,
          group: savedGroup,
        }),
      );
      await this.scheduleRepo.save(schedules);
    }

    // Narx tarixining birinchi qatori — keyingi barcha hisob-kitob shundan.
    await this.groupFeeService.initFeeForGroup(savedGroup);

    return savedGroup;
  }

  /**
   * Guruhni tahrirlash.
   *
   * Tugash sanasi (endDate) shu yerda o'zgaradi — alohida API yo'q. Sana
   * o'zgarsa: guruh statusi moslanadi (o'tgan sana -> finished, kelajakka
   * surilsa -> qayta started) va shu guruhning ochiq to'lovlari qayta
   * hisoblanadi.
   */
  async update(
    id: number,
    dto: UpdateGroupDto,
    organizationId: number,
    centerId?: number,
  ) {
    const group = await this.groupRepo.findOne({
      where: { id },
      // `teacher` ham kerak: o'qituvchi o'zgartirilmasa ham uning bandligi
      // yangi jadval bo'yicha qayta tekshiriladi.
      relations: ['room', 'teacher', 'schedules', 'center'],
    });

    if (!group) throw new NotFoundException('Group not found');
    if (group.center?.organizationId !== organizationId) {
      throw new NotFoundException('Group not found');
    }
    if (centerId && group.center?.id !== centerId) {
      throw new NotFoundException('Group not found');
    }

    const prevStartDate = this.toDateOnly(group.startDate);
    const prevEndDate = this.toDateOnly(group.endDate);
    const prevStatus = group.status;

    if (dto.name) group.name = dto.name;
    if (dto.timezone) group.timezone = dto.timezone;
    if (dto.startDate) {
      group.startDate = dayjs(dto.startDate).format(
        'YYYY-MM-DD',
      ) as unknown as Date;
    }
    if (dto.endDate !== undefined) {
      group.endDate = dto.endDate
        ? (dayjs(dto.endDate).format('YYYY-MM-DD') as unknown as Date)
        : null;
    }
    // Statusni to'g'ridan-to'g'ri o'zgartirish uchun changeStatus API ishlatiladi;
    // bu yerda status faqat endDate'ga qarab moslanadi.
    //
    // DIQQAT: `monthlyFee` bu yerda o'zgartirilmaydi. Narx oyga bog'langan
    // (`group_fee_periods`) va guruh saqlangandan keyin `GroupFeeService`
    // orqali yoziladi — default holatda KEYINGI OYDAN kuchga kiradi.
    if (dto.subjectId) {
      group.subject = await this.subjectRepo.findOneBy({
        id: dto.subjectId,
      });
      if (!group.subject) throw new NotFoundException('Subject not found');
    }
    if (dto.centerId) {
      // Guruhni faqat shu organization ichidagi markazga ko'chirish mumkin.
      group.center = await this.centerRepo.findOneBy({
        id: dto.centerId,
        organizationId,
      });
      if (!group.center) throw new NotFoundException('Center not found');
    }
    // MUHIM: xona va o'qituvchi guruhning **o'z filialidan** bo'lishi shart.
    // Ilgari bu tekshirilmasdi va boshqa filialning xonasi biriktirilib
    // qolardi — foydalanuvchi o'z filialidan xonani o'chirsa ham guruhda
    // o'sha xona nomi ko'rinib turardi.
    const effectiveCenterId = group.center?.id;

    if (dto.roomId) {
      group.room = await this.roomRepo.findOneBy({
        id: dto.roomId,
        center: { id: effectiveCenterId },
      });
      if (!group.room) {
        throw new ValidationException({
          roomId: 'Xona topilmadi yoki boshqa filialga tegishli',
        });
      }
    }
    if (dto.teacherId) {
      group.teacher = await this.userRepo.findOneBy({
        id: dto.teacherId,
        center: { id: effectiveCenterId },
      });
      if (!group.teacher) {
        throw new ValidationException({
          teacherId: "O'qituvchi topilmadi yoki boshqa filialga tegishli",
        });
      }
    }
    if (dto.lessonDurationMinutes !== undefined) {
      group.lessonDurationMinutes = dto.lessonDurationMinutes;
    }

    const nextStartDate = this.toDateOnly(group.startDate);
    const nextEndDate = this.toDateOnly(group.endDate);
    if (nextEndDate && nextStartDate && nextEndDate < nextStartDate) {
      throw new ValidationException({
        endDate: `Tugash sanasi boshlanish sanasidan (${nextStartDate}) oldin bo'lishi mumkin emas`,
      });
    }

    const endDateChanged = nextEndDate !== prevEndDate;
    if (endDateChanged) {
      this.applyEndDateStatusRules(group);
    }

    // Xona/o'qituvchi bandligi yangi holat bo'yicha qayta tekshiriladi
    // (jadval berilmagan bo'lsa guruhning mavjud jadvali olinadi).
    const effectiveDays =
      dto.days ??
      (group.schedules ?? []).map((s) => ({
        day: s.day,
        startTime: s.startTime,
      }));
    await this.assertScheduleAvailable({
      organizationId,
      roomId: group.room?.id,
      teacherId: group.teacher?.id,
      days: effectiveDays,
      durationMinutes: group.lessonDurationMinutes,
      excludeGroupId: id,
    });

    const savedGroup = await this.groupRepo.save(group);

    if (dto.days && dto.days.length > 0) {
      await this.scheduleRepo.delete({ group: { id } });

      const newSchedules = dto.days.map((day) =>
        this.scheduleRepo.create({
          day: day.day,
          startTime: day.startTime,
          group,
        }),
      );
      await this.scheduleRepo.save(newSchedules);

      const today = dayjs().format('YYYY-MM-DD');
      await this.overrideRepo.delete({
        groupId: id,
        fromDate: MoreThan(today) as any,
      });
    }

    // Status o'zgargan bo'lsa — o'quvchilar statusini ham moslaymiz.
    if (group.status !== prevStatus) {
      await this.syncStudentStatusesForGroups([id]);
    }

    // Narx: oyga bog'langan tarixga yoziladi.
    // - default (`next_month`) — keyingi oydan kuchga kiradi, joriy oy
    //   to'lovlari (to'langan ham, to'lanmagan ham) tegilmaydi;
    // - `current_month` — xatoni tuzatish uchun, shu oydan kuchga kiradi va
    //   joriy oyning ochiq to'lovlari qayta hisoblanadi.
    let feeAppliedNow = false;
    let feeEffectiveFrom: string | null = null;
    if (dto.monthlyFee !== undefined) {
      const res = await this.groupFeeService.setFee(
        savedGroup,
        Number(dto.monthlyFee),
        dto.applyFeeFrom ?? 'next_month',
      );
      feeAppliedNow = res.appliedNow;
      feeEffectiveFrom = res.effectiveFrom;
    }

    // Sana / jadval / narx o'zgarsa — to'lovlarni qayta hisoblaymiz.
    const daysChanged = Boolean(dto.days && dto.days.length);
    if (
      endDateChanged ||
      daysChanged ||
      feeAppliedNow ||
      nextStartDate !== prevStartDate
    ) {
      await this.recalcGroupPayments(id);
    }

    await this.groupFeeService.attachFeeInfo([savedGroup]);
    (savedGroup as any).feeEffectiveFrom = feeEffectiveFrom;

    return savedGroup;
  }

  /**
   * Guruh statusini o'zgartirish.
   *
   * Tugash sanasi (endDate) bu yerda MAJBURIY: status va sana doim mos
   * bo'lishi kerak, aks holda darslar/to'lovlar cheksiz hisoblanadi.
   * - `started` qilish uchun **xona** ham tanlangan bo'lishi shart (darslar
   *   qayerda bo'lishi jadvalda ko'rinishi kerak). Yetishmagan maydonlar
   *   bitta 422 xatosida qaytadi (`endDate`, `roomId`) — front tahrirlash
   *   formasini ochib, xatoni aynan shu maydonlarga qo'yadi;
   * - `started` qilish uchun tugash sanasi o'tmagan bo'lishi kerak;
   * - `finished` qilinganda tugash sanasi bugundan keyin bo'lsa, bugunga
   *   tortiladi — shunda bugundan keyingi darslarga to'lov hisoblanmaydi;
   * - tugagan guruhni qayta boshlash faqat tugash sanasi kelajakka
   *   surilgandan keyin mumkin.
   */
  async changeStatus(
    organizationId: number,
    id: number,
    nextStatus: GroupStatus,
    centerId?: number,
  ) {
    if (!nextStatus) {
      throw new ValidationException({ status: 'status is required' });
    }
    if (!Object.values(GroupStatus).includes(nextStatus)) {
      throw new ValidationException({ status: 'status is invalid' });
    }

    // Ensure expired groups are closed first (keeps state consistent)
    await this.finishExpiredGroups(organizationId, centerId);

    const group = await this.groupRepo.findOne({
      where: { id },
      // `room` ham kerak: guruhni boshlash uchun xona majburiy.
      relations: ['center', 'room'],
    });
    if (!group) throw new NotFoundException('Group not found');
    if (group.center?.organizationId !== organizationId) {
      throw new NotFoundException('Group not found');
    }
    if (centerId && group.center?.id !== centerId) {
      throw new NotFoundException('Group not found');
    }

    const current = group.status;

    if (current === nextStatus) return group;

    // Disallow NEW -> FINISHED directly
    if (current === GroupStatus.NEW && nextStatus === GroupStatus.FINISHED) {
      throw new BadRequestException(
        "Guruxni new holatdan to'g'ridan-to'g'ri finished qilib bo'lmaydi",
      );
    }

    // Guruhni boshlash uchun ikkala shart ham bajarilishi kerak: darslar
    // tugash sanasi va xona. Ikkalasi bir xatoda qaytadi — foydalanuvchi
    // tahrirlash formasida ikkalasini bir marta to'ldiradi.
    const missing: Record<string, string> = {};
    if (!group.endDate) {
      missing.endDate =
        "Statusni o'zgartirishdan oldin guruh darslari tugash sanasini kiriting";
    }
    if (nextStatus === GroupStatus.STARTED && !group.room?.id) {
      missing.roomId = 'Guruhni boshlash uchun xona tanlang';
    }
    if (Object.keys(missing).length) {
      throw new ValidationException(missing);
    }

    const endDate = this.toDateOnly(group.endDate) as string;
    const today = this.todayInGroupTz(group);

    if (nextStatus === GroupStatus.STARTED) {
      if (endDate < today) {
        throw new ValidationException({
          endDate: `Darslar tugash sanasi (${endDate}) o'tib ketgan — avval yangi sanani kiriting`,
        });
      }
      // Qayta boshlanganda dastlabki boshlanish vaqti saqlanadi.
      if (!group.startedAt) group.startedAt = new Date();
    }

    if (nextStatus === GroupStatus.FINISHED && endDate > today) {
      // Guruh bugun yopiladi: darslar ham, to'lovlar ham bugundan keyin
      // hisoblanmasligi uchun tugash sanasini bugunga tortamiz.
      group.endDate = today as unknown as Date;
    }

    if (nextStatus === GroupStatus.NEW) {
      // allow rollback to NEW only if it was STARTED (optional)
      if (current !== GroupStatus.STARTED) {
        throw new BadRequestException('Invalid status transition');
      }
      group.startedAt = null;
    }

    group.status = nextStatus;
    const saved = await this.groupRepo.save(group);

    await this.syncStudentStatusesForGroups([id]);
    await this.recalcGroupPayments(id);

    return saved;
  }

  async findAll(
    role: UserRole,
    organizationId: number,
    centerId?: number,
    name?: string,
    teacherId?: number,
    roomId?: number,
    days?: WeekDay[],
    page?: number,
    perPage?: number,
  ) {
    await this.finishExpiredGroups(organizationId, centerId);

    const currentPage = Number(page) || 1;
    const itemsPerPage = Number(perPage) || 10;
    const skip = (currentPage - 1) * itemsPerPage;

    const query = this.groupRepo
      .createQueryBuilder('group')
      .leftJoinAndSelect('group.center', 'center')
      .leftJoinAndSelect('group.subject', 'subject')
      .leftJoinAndSelect('group.teacher', 'teacher')
      .leftJoinAndSelect('group.room', 'room')
      .leftJoinAndSelect('group.schedules', 'schedule')
      .leftJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId });

    if (role === UserRole.TEACHER && teacherId) {
      query.andWhere('teacher.id = :teacherId', { teacherId });
    }

    const isAdmin = role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;
    if (centerId) {
      query.andWhere('center.id = :centerId', { centerId });
    } else if (!isAdmin) {
      throw new BadRequestException('centerId is required');
    }

    if (name) {
      query.andWhere('group.name ILIKE :name', { name: `%${name}%` });
    }

    if (teacherId) {
      query.andWhere('teacher.id = :teacherId', { teacherId });
    }

    if (roomId) {
      query.andWhere('room.id = :roomId', { roomId });
    }

    if (days?.length) {
      query.andWhere('schedule.day IN (:...days)', { days });
    }

    const [data, total] = await query
      .orderBy('group.createdAt', 'DESC')
      .skip(skip)
      .take(itemsPerPage)
      .getManyAndCount();

    await this.groupFeeService.attachFeeInfo(data);

    return {
      data,
      meta: {
        total,
        page: currentPage,
        perPage: itemsPerPage,
        totalPages: Math.ceil(total / itemsPerPage),
      },
    };
  }

  async getAllByOrganizationAndCenter(
    organizationId: number,
    centerId: number,
    teacherId?: number,
  ): Promise<Group[]> {
    await this.finishExpiredGroups(organizationId, centerId);
    const groups = await this.groupRepo.find({
      where: {
        center: {
          id: centerId,
          organization: {
            id: organizationId,
          },
        },
        ...(teacherId ? { teacher: { id: teacherId } } : {}),
      },
      relations: ['center', 'teacher', 'subject', 'room', 'schedules'],
      order: {
        createdAt: 'DESC',
      },
    });
    return this.groupFeeService.attachFeeInfo(groups);
  }

  async getAllByOrganization(
    organizationId: number,
    teacherId?: number,
  ): Promise<Group[]> {
    await this.finishExpiredGroups(organizationId);
    const query = this.groupRepo
      .createQueryBuilder('group')
      .leftJoinAndSelect('group.center', 'center')
      .leftJoinAndSelect('group.subject', 'subject')
      .leftJoinAndSelect('group.teacher', 'teacher')
      .leftJoinAndSelect('group.room', 'room')
      .leftJoinAndSelect('group.schedules', 'schedule')
      .leftJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId });

    if (teacherId) {
      query.andWhere('teacher.id = :teacherId', { teacherId });
    }

    const groups = await query.orderBy('group.createdAt', 'DESC').getMany();
    return this.groupFeeService.attachFeeInfo(groups);
  }

  async findOne(id: number, organizationId: number) {
    await this.finishExpiredGroups(organizationId);
    const group = await this.groupRepo.findOne({
      where: {
        id,
        center: { organization: { id: organizationId } },
      },
      relations: [
        'center',
        'teacher',
        'subject',
        'students',
        'room',
        'schedules',
      ],
    });
    if (group) await this.groupFeeService.attachFeeInfo([group]);
    return group;
  }

  async remove(id: number) {
    const group = await this.groupRepo.findOneByOrFail({ id });
    return this.groupRepo.remove(group);
  }
}
