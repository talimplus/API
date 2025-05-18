import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Payment,
  PaymentStatus,
} from '@/modules/payments/entities/payment.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { instanceToPlain } from 'class-transformer';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StudentsService } from '@/modules/students/students.service';
import { Referral } from '@/modules/referrals/entities/referal.entity';
import * as dayjs from 'dayjs';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Referral)
    private readonly referralRepo: Repository<Referral>,
    private readonly studentService: StudentsService,
  ) {}

  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async generateMonthlyPayments() {
    this.logger.log('Cron: Yangi oylik to‘lovlar yaratilyapti');
    const now = dayjs();
    const forMonth = now.startOf('month').toDate();

    const students = await this.studentService.findByActiveStatus();

    for (const student of students) {
      for (const group of student.groups) {
        // Oldin shu o‘quvchi va guruh uchun shu oyda yozuv bormi?
        const existing = await this.paymentRepo.findOne({
          where: {
            student: { id: student.id },
            group: { id: group.id },
            forMonth,
          },
        });

        if (existing) continue;

        let finalFee = student.monthlyFee ?? group.monthlyFee ?? 0;

        // Referral chegirmasi tekshiruv
        const referral = await this.referralRepo.findOne({
          where: {
            referrerStudent: { id: student.id },
            isDiscountApplied: false,
          },
          relations: ['referredStudent'],
        });

        if (referral) {
          const referredPaid = await this.paymentRepo.findOne({
            where: {
              student: { id: referral.referredStudent.id },
              status: PaymentStatus.PAID,
            },
          });

          if (referredPaid) {
            finalFee *= 0.9;
            referral.isDiscountApplied = true;
            await this.referralRepo.save(referral);
          }
        }

        const payment = this.paymentRepo.create({
          student,
          group,
          forMonth,
          amountDue: finalFee,
          amountPaid: 0,
          status: PaymentStatus.UNPAID,
        });

        await this.paymentRepo.save(payment);
      }
    }

    this.logger.log('Cron: To‘lovlar yaratish yakunlandi');
  }

  // To‘liq to‘lovni tasdiqlash
  async markAsPaid(paymentId: number): Promise<Payment> {
    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('To‘lov topilmadi');

    payment.amountPaid = payment.amountDue;
    payment.status = PaymentStatus.PAID;

    return this.paymentRepo.save(payment);
  }

  // Qisman to‘lov qilish
  async payPartial(paymentId: number, amount: number): Promise<Payment> {
    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('To‘lov topilmadi');
    if (amount <= 0) throw new BadRequestException('To‘lov miqdori noto‘g‘ri');

    payment.amountPaid += amount;

    if (payment.amountPaid >= payment.amountDue) {
      payment.amountPaid = payment.amountDue;
      payment.status = PaymentStatus.PAID;
    } else {
      payment.status = PaymentStatus.PARTIAL;
    }

    return this.paymentRepo.save(payment);
  }

  async findAll(organizationId: number, { page, perPage, status }) {
    const skip = (page - 1) * perPage;
    const query = this.paymentRepo
      .createQueryBuilder('payments')
      .where('organization.id = :organizationId', { organizationId });

    if (status) {
      query.andWhere('(user.status ILIKE :status)', { status: `%${status}%` });
    }

    const [data, total] = await query
      .orderBy('user.createdAt', 'DESC')
      .skip(skip)
      .take(perPage)
      .getManyAndCount();

    return {
      data,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  async findOne(id: number) {
    const payment = await this.paymentRepo.findOne({
      where: { id },
      relations: ['group', 'student'],
    });
    return instanceToPlain(payment);
  }
}
