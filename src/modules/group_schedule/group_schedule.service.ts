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

  async create(dto: CreateGroupScheduleDto) {
    const group = await this.groupRepo.findOneBy({ id: dto.groupId });
    if (!group) throw new NotFoundException('Group not found');

    const scheduleEntities = dto.days.map((day) =>
      this.scheduleRepo.create({
        day: day.day,
        startTime: day.startTime,
        group,
      }),
    );

    return this.scheduleRepo.save(scheduleEntities);
  }

  findAll() {
    return this.scheduleRepo.find({ relations: ['group'] });
  }

  findOne(id: number) {
    return this.scheduleRepo.findOne({ where: { id }, relations: ['group'] });
  }

  async update(groupId: number, dto: UpdateGroupScheduleDto) {
    const group = await this.groupRepo.findOneBy({ id: groupId });
    if (!group) throw new NotFoundException('Group not found');

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

  async remove(id: number) {
    const schedule = await this.scheduleRepo.findOneBy({ id });
    if (!schedule) throw new NotFoundException('Schedule not found');

    return this.scheduleRepo.remove(schedule);
  }
}
