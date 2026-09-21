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
import { ValidationException } from '@/common/exceptions/validation.exception';
import { dayjs } from '@/shared/utils/dayjs';
import { MoreThan } from 'typeorm';

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

  /** Normalize 'HH:mm' or 'HH:mm:ss' to 'HH:mm:ss' for reliable comparison. */
  private normalizeTime(t: string): string {
    const [h = '00', m = '00', s = '00'] = String(t).split(':');
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}`;
  }

  /**
   * Prevents double-booking a room: a room cannot host two (non-finished)
   * groups on the same weekday at the same start time.
   */
  private async assertRoomScheduleAvailable(args: {
    roomId?: number | null;
    days?: { day: WeekDay; startTime: string }[];
    excludeGroupId?: number;
  }) {
    const { roomId, days, excludeGroupId } = args;
    if (!roomId || !days?.length) return;

    const qb = this.scheduleRepo
      .createQueryBuilder('sch')
      .innerJoin('sch.group', 'g')
      .innerJoin('g.room', 'r')
      .where('r.id = :roomId', { roomId })
      .andWhere('g.status != :finished', { finished: GroupStatus.FINISHED })
      .select('sch.day', 'day')
      .addSelect('sch.startTime', 'startTime')
      .addSelect('g.name', 'groupName');
    if (excludeGroupId) {
      qb.andWhere('g.id != :excludeGroupId', { excludeGroupId });
    }

    const existing = await qb.getRawMany<{
      day: WeekDay;
      startTime: string;
      groupName: string;
    }>();

    const taken = new Map<string, string>();
    for (const e of existing) {
      taken.set(`${e.day}|${this.normalizeTime(e.startTime)}`, e.groupName);
    }

    for (const d of days) {
      const conflictGroup = taken.get(
        `${d.day}|${this.normalizeTime(d.startTime)}`,
      );
      if (conflictGroup) {
        throw new BadRequestException(
          `Xona band: bu xona "${conflictGroup}" guruhiga ${d.day} kuni ${this.normalizeTime(d.startTime).slice(0, 5)} da biriktirilgan`,
        );
      }
    }
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

    await this.assertRoomScheduleAvailable({
      roomId: dto.roomId,
      days: dto.days,
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
      relations: ['room', 'schedules', 'center'],
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
    if (dto.roomId) {
      group.room = await this.roomRepo.findOneBy({
        id: dto.roomId,
      });
      if (!group.room) throw new NotFoundException('Room not found');
    }
    if (dto.teacherId) {
      group.teacher = await this.userRepo.findOneBy({
        id: dto.teacherId,
      });
      if (!group.teacher) throw new NotFoundException('Teacher not found');
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

    // Re-check room availability against the effective room + schedule.
    const effectiveDays =
      dto.days ??
      (group.schedules ?? []).map((s) => ({
        day: s.day,
        startTime: s.startTime,
      }));
    await this.assertRoomScheduleAvailable({
      roomId: group.room?.id,
      days: effectiveDays,
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
      relations: ['center'],
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

    if (!group.endDate) {
      throw new ValidationException({
        endDate:
          "Statusni o'zgartirishdan oldin guruh darslari tugash sanasini kiriting",
      });
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
