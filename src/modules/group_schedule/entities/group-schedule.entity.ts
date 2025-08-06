import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { WeekDay } from '@/common/enums/group-schedule.enum';
import { Group } from '@/modules/groups/entities/groups.entity';

@Entity('group_schedule')
export class GroupSchedule {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'enum', enum: WeekDay }) // enum qilib ishlatish yaxshi
  day: WeekDay;

  @Column({ type: 'time' }) // HH:mm:ss format
  startTime: string;

  @ManyToOne(() => Group, (group) => group.schedules, { onDelete: 'CASCADE' })
  group: Group;
}
