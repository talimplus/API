import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Payment } from '@/modules/payments/entities/payment.entity';
import { User } from '@/modules/users/entities/user.entity';

export enum PaymentReceiptStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  REJECTED = 'rejected',
}

export enum PaymentMethod {
  CASH = 'cash',
  CARD = 'card',
  BANK_TRANSFER = 'bank_transfer',
  ONLINE = 'online',
}

@Entity('payment_receipts')
@Index(['paymentId', 'status'])
export class PaymentReceipt {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Payment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'paymentId' })
  payment: Payment;

  @Column()
  paymentId: number;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount: number;

  /**
   * Chek/invoice bazaviy raqami (payment.invoiceNo dan nusxa). Bir oyning barcha
   * receiptlari uchun bir xil bo'ladi (masalan 1).
   */
  @Column({ type: 'int', nullable: true })
  invoiceNo?: number | null;

  /**
   * Shu oy (payment) uchun nechanchi qisman to'lov (1, 2, 3...). Harf suffikslari
   * shu indeksdan hosil qilinadi: 1 -> A, 2 -> B, ...
   */
  @Column({ type: 'int', nullable: true })
  installmentIndex?: number | null;

  /**
   * Chekda chiqadigan to'liq raqam. To'liq bir martalik to'lov -> "1".
   * Qisman to'lovlar -> "1-A", "1-A-B", "1-A-B-C" ...
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  checkNo?: string | null;

  /**
   * Global yagona tranzaktsiya raqami — har bir to'lov (receipt) uchun ALOHIDA
   * (checkNo dan farqli, u markaz ichida takrorlanadi). Format:
   * TRX-YYYYMMDD-NNNNNN (sana + butun tizim bo'yicha ketma-ket raqam). Chek
   * chop etilganda ko'rsatiladi; chek qaytib kelganda shu raqam orqali aynan
   * qaysi to'lov ekanini aniqlab olish uchun ishlatiladi.
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32, nullable: true })
  transactionNo?: string | null;

  /**
   * To'lovdan oldingi o'quvchi umumiy qoldig'i (qarzi) — chek uchun snapshot.
   */
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  balanceBefore?: number | null;

  /**
   * To'lovdan keyingi o'quvchi umumiy qoldig'i (qarzi) — chek uchun snapshot.
   */
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  balanceAfter?: number | null;

  /**
   * To'lov haqiqatda amalga oshirilgan sana (asosan KARTA uchun — reception
   * qo'lda kiritadigan sana). Bo'sh bo'lsa receivedAt/createdAt ishlatiladi.
   */
  @Column({ type: 'date', nullable: true })
  paidAt?: Date | null;

  /**
   * Snapshot of receiver commission percent at confirmation time.
   * Applied only for MANAGER/RECEPTION if they have commissionPercentage.
   */
  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  receiverCommissionPercentSnapshot?: number | null;

  /**
   * Snapshot of receiver commission amount (amount * percent / 100) at confirmation time.
   */
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  receiverCommissionAmountSnapshot?: number | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'receivedById' })
  receivedBy?: User | null;

  @Column({ type: 'int', nullable: true })
  receivedById?: number | null;

  @Column({ type: 'timestamp', nullable: true })
  receivedAt?: Date | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'confirmedById' })
  confirmedBy?: User | null;

  @Column({ type: 'int', nullable: true })
  confirmedById?: number | null;

  @Column({ type: 'timestamp', nullable: true })
  confirmedAt?: Date | null;

  @Column({
    type: 'enum',
    enum: PaymentReceiptStatus,
    default: PaymentReceiptStatus.PENDING,
  })
  status: PaymentReceiptStatus;

  @Column({ type: 'enum', enum: PaymentMethod, nullable: true })
  paymentMethod?: PaymentMethod | null;

  /**
   * Bu chek yangi pul emas, boshqa guruh to'lovidan **ko'chirilgan** pul
   * bo'lsa — o'sha to'lovning id'si. O'quvchi guruhini almashtirganda eski
   * guruhga ortiqcha to'langan summa shu yo'l bilan yangi guruhga o'tadi.
   * Bunday chekda `paymentMethod` bo'sh bo'ladi va qabul qiluvchi
   * komissiyasi hisoblanmaydi (kassaga yangi pul tushmagan).
   */
  @Column({ type: 'int', nullable: true })
  transferFromPaymentId?: number | null;

  @Column({ type: 'text', nullable: true })
  comment?: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
