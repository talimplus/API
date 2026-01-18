import {
  BadRequestException,
  Injectable,
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
import { ValidationException } from '@/common/exceptions/validation.exception';

@Injectable()
export class GroupsService {
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
  ) {}

  private async finishExpiredGroups(organizationId: number, centerId?: number) {
    // Update in DB directly (fast, idempotent).
    // Only affects groups within the organization (and optional center).
    const params: any[] = [organizationId];
    let centerFilterSql = '';
    if (centerId) {
      params.push(centerId);
      centerFilterSql = ` AND g."centerId" = $2`;
    }

    await this.groupRepo.query(
      `
      UPDATE "groups" g
      SET "status" = $${params.length + 1}
      WHERE g."status" = $${params.length + 2}
        AND g."durationMonths" IS NOT NULL
        AND g."startedAt" IS NOT NULL
        AND (g."startedAt" + (g."durationMonths" || ' months')::interval) <= NOW()
        AND g."centerId" IN (
          SELECT c."id" FROM "centers" c
          WHERE c."organizationId" = $1
        )
        ${centerFilterSql}
    `,
      [...params, GroupStatus.FINISHED, GroupStatus.STARTED],
    );
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

    const group = this.groupRepo.create({
      name: dto.name,
      monthlyFee: dto.monthlyFee,
      center,
      subject,
      teacher,
      room,
      timezone: dto.timezone,
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      status: GroupStatus.NEW,
      durationMonths: dto.durationMonths ?? null,
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

    return savedGroup;
  }

  async update(id: number, dto: UpdateGroupDto) {
    const group = await this.groupRepo.findOneBy({ id });

    if (!group) throw new NotFoundException('Group not found');

    if (dto.name) group.name = dto.name;
    if (dto.timezone) group.timezone = dto.timezone;
    if (dto.startDate) group.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) {
      group.endDate = dto.endDate ? new Date(dto.endDate) : null;
    }
    // Status should be changed via changeStatus API to enforce transition rules.
    if (dto.durationMonths !== undefined) {
      group.durationMonths = dto.durationMonths;
    }
    if (dto.monthlyFee !== undefined) group.monthlyFee = dto.monthlyFee;
    if (dto.subjectId) {
      group.subject = await this.subjectRepo.findOneBy({
        id: dto.subjectId,
      });
      if (!group.subject) throw new NotFoundException('Subject not found');
    }
    if (dto.centerId) {
      group.center = await this.centerRepo.findOneBy({
        id: dto.centerId,
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
    }

    return savedGroup;
  }

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
    if ((group as any)?.center?.organizationId !== organizationId) {
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

    // Disallow changing finished groups (keep simple & safe)
    if (current === GroupStatus.FINISHED) {
      throw new BadRequestException('Finished gurux statusini o‘zgartirib bo‘lmaydi');
    }

    if (nextStatus === GroupStatus.STARTED) {
      group.startedAt = new Date();
    }

    if (nextStatus === GroupStatus.NEW) {
      // allow rollback to NEW only if it was STARTED (optional)
      if (current !== GroupStatus.STARTED) {
        throw new BadRequestException('Invalid status transition');
      }
      group.startedAt = null;
    }

    group.status = nextStatus;
    return this.groupRepo.save(group);
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
  ): Promise<Group[]> {
    await this.finishExpiredGroups(organizationId, centerId);
    return this.groupRepo.find({
      where: {
        center: {
          id: centerId,
          organization: {
            id: organizationId,
          },
        },
      },
      relations: ['center', 'teacher', 'subject', 'room', 'schedules'],
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async getAllByOrganization(organizationId: number): Promise<Group[]> {
    await this.finishExpiredGroups(organizationId);
    return this.groupRepo
      .createQueryBuilder('group')
      .leftJoinAndSelect('group.center', 'center')
      .leftJoinAndSelect('group.subject', 'subject')
      .leftJoinAndSelect('group.teacher', 'teacher')
      .leftJoinAndSelect('group.room', 'room')
      .leftJoinAndSelect('group.schedules', 'schedule')
      .leftJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId })
      .orderBy('group.createdAt', 'DESC')
      .getMany();
  }

  async findOne(id: number) {
    // Best-effort: finish expired groups (no org scope here, so run global update)
    // This keeps single-fetch consistent without requiring the cron job to have run.
    await this.groupRepo.query(
      `
      UPDATE "groups" g
      SET "status" = $1
      WHERE g."status" = $2
        AND g."durationMonths" IS NOT NULL
        AND g."startedAt" IS NOT NULL
        AND (g."startedAt" + (g."durationMonths" || ' months')::interval) <= NOW()
    `,
      [GroupStatus.FINISHED, GroupStatus.STARTED],
    );
    return this.groupRepo.findOne({
      where: { id },
      relations: ['center', 'teacher', 'subject', 'students', 'room', 'schedules'],
    });
  }

  async remove(id: number) {
    const group = await this.groupRepo.findOneByOrFail({ id });
    return this.groupRepo.remove(group);
  }
}
