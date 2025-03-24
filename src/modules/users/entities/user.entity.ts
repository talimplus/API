import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { Center } from '@/modules/centers/entities/centers.entity';
import { Organization } from '@/modules/organizations/entities/organizations.entity';
import { UserRole } from '@/common/enums/user-role.enums';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  firstName: string;

  @Column()
  lastName: string;

  @Column({ unique: true })
  email: string;

  @Column({ unique: true })
  phone: string;

  @Column()
  password: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.ADMIN })
  role: UserRole;

  @Column({ nullable: true })
  salary: number;

  @Column({ nullable: true })
  commissionPercentage: number;

  @ManyToOne(() => Center, (center) => center.users, { onDelete: 'CASCADE' })
  center: Center;

  @ManyToOne(() => Organization, (org) => org.users, { onDelete: 'CASCADE' })
  organization: Organization;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
