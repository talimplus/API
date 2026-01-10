import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('blacklisted_tokens')
export class BlacklistedToken {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  tokenHash: string; // sha256 hex

  @Column({ type: 'int', nullable: true })
  userId?: number | null;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}

