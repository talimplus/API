import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  ManyToMany,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { GroupSchedule } from '@/modules/group_schedule/entities/group-schedule.entity';
import { Attendance } from '@/modules/attendance/entities/attendance.entity';
import { Subject } from '@/modules/subjects/entities/subjects.entity';
import { Student } from '@/modules/students/entities/students.entity';
import { Center } from '@/modules/centers/entities/centers.entity';
import { Room } from '@/modules/rooms/entities/rooms.entity';
import { User } from '@/modules/users/entities/user.entity';
import { GroupStatus } from '@/modules/groups/enums/group-status.enum';
import { Syllabus } from '@/modules/syllabus/entities/syllabus.entity';

@Entity('groups')
export class Group {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  /**
   * IANA timezone name, used for all lessonDate calculations and "today" comparisons.
   * Example: Asia/Tashkent
   */
  @Column({ default: 'Asia/Tashkent' })
  timezone: string;

  /**
   * Group start boundary in local group timezone.
   * Lesson existence is computed only within [startDate..endDate?].
   */
  @Column({ type: 'date', default: () => 'CURRENT_DATE' })
  startDate: Date;

  /**
   * Guruh darslari tugash sanasi (guruh timezone'ida, inclusive).
   * Yagona manba: darslar ro'yxati, to'lovlar, syllabus rejasi va guruhning
   * avtomatik yopilishi — hammasi shu sanaga qarab ishlaydi.
   * null bo'lsa guruh muddatsiz (faqat status bilan boshqariladi).
   */
  @Column({ type: 'date', nullable: true })
  endDate?: Date | null;

  /**
   * Bitta darsning davomiyligi (daqiqa). Guruhning barcha darslari bir xil
   * uzunlikda deb hisoblanadi — xona/o'qituvchi bandligi va dars jadvali
   * panjarasi shu qiymatga tayanadi (`startTime` + shu daqiqa = tugash vaqti).
   */
  @Column({ type: 'int', default: 90 })
  lessonDurationMinutes: number;

  @Column({ type: 'enum', enum: GroupStatus, default: GroupStatus.NEW })
  status: GroupStatus;

  /**
   * Timestamp when group was marked as STARTED.
   */
  @Column({ type: 'timestamp', nullable: true })
  startedAt?: Date | null;

  @ManyToOne(() => Subject, { onDelete: 'CASCADE' })
  subject: Subject;

  @Column({ type: 'numeric', nullable: true })
  monthlyFee: number;

  @ManyToOne(() => Center, { onDelete: 'CASCADE' })
  center: Center;

  /**
   * Guruh xonasi. Xona o'chirilsa guruh o'chmaydi — faqat xona uziladi
   * (`SET NULL`), guruh esa "xonasiz" bo'lib qoladi va jadvalda shunday
   * ko'rinadi. Xona har doim guruhning **o'z filialidan** bo'lishi kerak.
   */
  @ManyToOne(() => Room, { onDelete: 'SET NULL', nullable: true })
  room?: Room | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  teacher: User;

  /**
   * Guruh amal qiladigan kurs rejasi (mavzular banki).
   */
  @ManyToOne(() => Syllabus, { onDelete: 'SET NULL', nullable: true })
  syllabus?: Syllabus | null;

  @ManyToMany(() => Student, (student) => student.groups)
  students: Student[];

  @OneToMany(() => GroupSchedule, (schedule) => schedule.group)
  schedules: GroupSchedule[];

  @OneToMany(() => Attendance, (a) => a.group)
  attendance: Attendance[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
