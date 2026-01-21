import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LeadStatus } from '@/modules/leads/enums/lead-status.enum';
import { WeekDay } from '@/common/enums/group-schedule.enum';
import { StudentPreferredTime } from '@/common/enums/student-preferred-time.enum';
import { Center } from '@/modules/centers/entities/centers.entity';
import { Organization } from '@/modules/organizations/entities/organizations.entity';
import { Group } from '@/modules/groups/entities/groups.entity';

@Entity('leads')
@Index(['organizationId', 'phone'], { unique: true })
export class Lead {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  firstName?: string | null;

  @Column({ nullable: true })
  lastName?: string | null;

  @Column()
  phone: string;

  @Column({ nullable: true })
  secondPhone?: string | null;

  @Column({ type: 'date', nullable: true })
  birthDate?: Date | null;

  @Column({ type: 'numeric', nullable: true })
  monthlyFee?: number | null;

  @Column({ type: 'numeric', default: 0 })
  discountPercent: number;

  @Column({ type: 'text', nullable: true })
  discountReason?: string | null;

  @Column({ type: 'text', nullable: true })
  comment?: string | null;

  @Column({ type: 'text', nullable: true })
  heardAboutUs?: string | null;

  @Column({ type: 'text', nullable: true })
  preferredTime?: StudentPreferredTime | null;

  @Column({ type: 'text', array: true, nullable: true })
  preferredDays?: WeekDay[] | null;

  @Column({ nullable: true })
  passportSeries?: string | null;

  @Column({ nullable: true })
  passportNumber?: string | null;

  @Column({ nullable: true })
  jshshir?: string | null;

  @Column({ type: 'enum', enum: LeadStatus, default: LeadStatus.NEW })
  status: LeadStatus;

  /**
   * If converted to student, store the created student id for reference.
   */
  @Column({ nullable: true })
  studentId?: number | null;

  /**
   * Follow-up date: when to contact the lead again (for follow-up calls).
   */
  @Column({ type: 'date', nullable: true })
  followUpDate?: Date | null;

  @ManyToOne(() => Center, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'centerId' })
  center: Center;

  @Column()
  centerId: number;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @Column()
  organizationId: number;

  @ManyToMany(() => Group, { nullable: true })
  @JoinTable({
    name: 'leads_groups_groups',
    joinColumn: { name: 'leadId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'groupId', referencedColumnName: 'id' },
  })
  groups?: Group[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}

