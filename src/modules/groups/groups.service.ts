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
      room = await this.centerRepo.findOne({
        where: { id: centerId || dto.roomId },
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
      center,
      subject,
      teacher,
      room,
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

    if (role !== UserRole.ADMIN && centerId) {
      query.andWhere('center.id = :centerId', { centerId });
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
    return this.groupRepo.find({
      where: {
        center: {
          id: centerId,
          organization: {
            id: organizationId,
          },
        },
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async findOne(id: number) {
    return this.groupRepo.findOne({
      where: { id },
      relations: ['center', 'teacher', 'subject', 'students', 'room'],
    });
  }

  async remove(id: number) {
    const group = await this.groupRepo.findOneByOrFail({ id });
    return this.groupRepo.remove(group);
  }
}
