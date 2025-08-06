import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { Student } from '@/modules/students/entities/students.entity';
import { Group } from '@/modules/groups/entities/groups.entity';

@Entity('attendance')
export class Attendance {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'date' })
  date: Date;

  @Column({ default: true })
  isPresent: boolean;

  @Column({ nullable: true })
  reason?: string; // sabab (faqat yo‘qlarga)

  @ManyToOne(() => Student, (student) => student.attendance, {
    onDelete: 'CASCADE',
  })
  student: Student;

  @ManyToOne(() => Group, (group) => group.attendance, { onDelete: 'CASCADE' })
  group: Group;
}
