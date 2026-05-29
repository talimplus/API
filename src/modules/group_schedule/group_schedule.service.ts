import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GroupSchedule } from './entities/group-schedule.entity';
import { CreateGroupScheduleDto } from './dto/create-group-schedule.dto';
import { UpdateGroupScheduleDto } from './dto/update-group-schedule.dto';
import { Group } from '@/modules/groups/entities/groups.entity';

@Injectable()
export class GroupScheduleService {
  constructor(
    @InjectRepository(GroupSchedule)
    private scheduleRepo: Repository<GroupSchedule>,
    @InjectRepository(Group)
    private groupRepo: Repository<Group>,
  ) {}

  private async findGroupOrThrow(
    groupId: number,
    organizationId: number,
  ): Promise<Group> {
    const group = await this.groupRepo.findOne({
      where: {
        id: groupId,
        center: { organization: { id: organizationId } },
      },
    });
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  async create(dto: CreateGroupScheduleDto, organizationId: number) {
    const group = await this.findGroupOrThrow(dto.groupId, organizationId);

    await this.scheduleRepo.delete({ group: { id: dto.groupId } });

    const scheduleEntities = dto.days.map((day) =>
      this.scheduleRepo.create({
        day: day.day,
        startTime: day.startTime,
        group,
      }),
    );

    return this.scheduleRepo.save(scheduleEntities);
  }

  findAll(organizationId: number) {
    return this.scheduleRepo.find({
      where: {
        group: { center: { organization: { id: organizationId } } },
      },
      relations: ['group'],
    });
  }

  async findOne(id: number, organizationId: number) {
    const schedule = await this.scheduleRepo.findOne({
      where: {
        id,
        group: { center: { organization: { id: organizationId } } },
      },
      relations: ['group'],
    });
    if (!schedule) throw new NotFoundException('Schedule not found');
    return schedule;
  }

  async update(groupId: number, dto: UpdateGroupScheduleDto, organizationId: number) {
    const group = await this.findGroupOrThrow(groupId, organizationId);

    await this.scheduleRepo.delete({ group: { id: groupId } });

    const newSchedules = dto.days.map((day) =>
      this.scheduleRepo.create({
        day: day.day,
        startTime: day.startTime,
        group,
      }),
    );

    return this.scheduleRepo.save(newSchedules);
  }

  async remove(id: number, organizationId: number) {
    const schedule = await this.scheduleRepo.findOne({
      where: {
        id,
        group: { center: { organization: { id: organizationId } } },
      },
    });
    if (!schedule) throw new NotFoundException('Schedule not found');

    return this.scheduleRepo.remove(schedule);
  }
}
