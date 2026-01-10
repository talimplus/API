import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { dayjs } from '@/shared/utils/dayjs';
import { Repository } from 'typeorm';
import { Payment, PaymentStatus } from '@/modules/payments/entities/payment.entity';
import { Expense } from '@/modules/expenses/entities/expenses.entity';
import { Student } from '@/modules/students/entities/students.entity';
import { StaffSalary } from '@/modules/staff-salaries/entities/staff-salary.entity';
import { StaffSalaryStatus } from '@/modules/staff-salaries/enums/staff-salary-status.enum';
import { Center } from '@/modules/centers/entities/centers.entity';
import { StudentStatus } from '@/common/enums/students-status.enums';

@Injectable()
export class StatisticsService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Expense)
    private readonly expenseRepo: Repository<Expense>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(StaffSalary)
    private readonly staffSalaryRepo: Repository<StaffSalary>,
    @InjectRepository(Center)
    private readonly centerRepo: Repository<Center>,
  ) {}

  private normalizeMonth(ym?: string): string {
    if (!ym) return '';
    const v = ym.trim();
    if (!/^\d{4}-\d{2}$/.test(v)) {
      throw new BadRequestException('Month must be in YYYY-MM format');
    }
    return v;
  }

  private toMonthStart(ym: string): string {
    return `${ym}-01`;
  }

  private async resolveCenterId(
    organizationId: number,
    reqCenterId: number | undefined,
    queryCenterId?: number,
  ): Promise<number> {
    const centerId = queryCenterId ?? reqCenterId;
    if (!centerId) {
      throw new BadRequestException('centerId is required');
    }

    const center = await this.centerRepo
      .createQueryBuilder('center')
      .leftJoin('center.organization', 'org')
      .where('center.id = :centerId', { centerId })
      .andWhere('org.id = :organizationId', { organizationId })
      .getOne();

    if (!center) {
      throw new BadRequestException('centerId is invalid for this organization');
    }

    return centerId;
  }

  async getDashboard(
    organizationId: number,
    reqCenterId: number | undefined,
    query: { centerId?: number; fromMonth?: string; toMonth?: string },
  ) {
    const centerId = await this.resolveCenterId(
      organizationId,
      reqCenterId,
      query.centerId,
    );

    const nowYm = dayjs().format('YYYY-MM');
    const fromYm = this.normalizeMonth(query.fromMonth) || nowYm;
    const toYm = this.normalizeMonth(query.toMonth) || fromYm;

    const fromMonthStart = this.toMonthStart(fromYm); // YYYY-MM-01
    const toMonthStart = this.toMonthStart(toYm); // YYYY-MM-01
    const endExclusive = dayjs(toMonthStart)
      .add(1, 'month')
      .startOf('month')
      .format('YYYY-MM-01');

    if (dayjs(toMonthStart).isBefore(dayjs(fromMonthStart))) {
      throw new BadRequestException('toMonth must be >= fromMonth');
    }

    const paymentsAggQb = this.paymentRepo
      .createQueryBuilder('p')
      .select([
        'COALESCE(SUM(p.amountDue), 0) as "amountDue"',
        'COALESCE(SUM(p.amountPaid), 0) as "amountPaid"',
        'COALESCE(SUM(p.amountDue - p.amountPaid), 0) as "remainingAmount"',
        'COUNT(p.id) as "totalCount"',
        `SUM(CASE WHEN p.status = '${PaymentStatus.PAID}' THEN 1 ELSE 0 END) as "paidCount"`,
        `SUM(CASE WHEN p.status = '${PaymentStatus.PARTIAL}' THEN 1 ELSE 0 END) as "partialCount"`,
        `SUM(CASE WHEN p.status = '${PaymentStatus.UNPAID}' THEN 1 ELSE 0 END) as "unpaidCount"`,
      ])
      .leftJoin('p.student', 's')
      .where('s.centerId = :centerId', { centerId })
      .andWhere('p.forMonth >= :fromMonthStart', { fromMonthStart })
      .andWhere('p.forMonth < :endExclusive', { endExclusive });

    const expensesAggQb = this.expenseRepo
      .createQueryBuilder('e')
      .select([
        'COALESCE(SUM(e.amount), 0) as "totalAmount"',
        'COUNT(e.id) as "totalCount"',
      ])
      .where('e.centerId = :centerId', { centerId })
      .andWhere('e.forMonth >= :fromMonthStart', { fromMonthStart })
      .andWhere('e.forMonth < :endExclusive', { endExclusive });

    const payrollAggQb = this.staffSalaryRepo
      .createQueryBuilder('ss')
      .select([
        'COALESCE(SUM(ss.baseSalary), 0) as "amountDue"',
        'COALESCE(SUM(ss.paidAmount), 0) as "amountPaid"',
        'COALESCE(SUM(ss.baseSalary - ss.paidAmount), 0) as "remainingAmount"',
        'COUNT(ss.id) as "totalCount"',
        `SUM(CASE WHEN ss.status = '${StaffSalaryStatus.PAID}' THEN 1 ELSE 0 END) as "paidCount"`,
        `SUM(CASE WHEN ss.status = '${StaffSalaryStatus.PARTIAL}' THEN 1 ELSE 0 END) as "partialCount"`,
        `SUM(CASE WHEN ss.status = '${StaffSalaryStatus.UNPAID}' THEN 1 ELSE 0 END) as "unpaidCount"`,
      ])
      .leftJoin('ss.user', 'u')
      .leftJoin('u.organization', 'org')
      .where('org.id = :organizationId', { organizationId })
      .leftJoin('u.center', 'uc')
      .andWhere('uc.id = :centerId', { centerId })
      .andWhere('ss.forMonth >= :fromMonthStart', { fromMonthStart })
      .andWhere('ss.forMonth < :endExclusive', { endExclusive });

    const studentsAggQb = this.studentRepo
      .createQueryBuilder('st')
      .select([
        'COUNT(st.id) as "totalCount"',
        `SUM(CASE WHEN st.status = '${StudentStatus.ACTIVE}' THEN 1 ELSE 0 END) as "activeCount"`,
        'SUM(CASE WHEN st.createdAt >= :fromTs AND st.createdAt < :toTs THEN 1 ELSE 0 END) as "addedCount"',
        'SUM(CASE WHEN st.stoppedAt IS NOT NULL AND st.stoppedAt >= :fromTs AND st.stoppedAt < :toTs THEN 1 ELSE 0 END) as "stoppedCount"',
      ])
      .where('st.centerId = :centerId', { centerId })
      .setParameters({ fromTs: fromMonthStart, toTs: endExclusive });

    const [paymentsRaw, expensesRaw, payrollRaw, studentsRaw] =
      await Promise.all([
        paymentsAggQb.getRawOne<any>(),
        expensesAggQb.getRawOne<any>(),
        payrollAggQb.getRawOne<any>(),
        studentsAggQb.getRawOne<any>(),
      ]);

    const n = (v: any) => Number(v ?? 0);

    const payments = {
      statusEnum: PaymentStatus,
      amountDue: n(paymentsRaw?.amountDue),
      amountPaid: n(paymentsRaw?.amountPaid),
      remainingAmount: n(paymentsRaw?.remainingAmount),
      totalCount: n(paymentsRaw?.totalCount),
      paidCount: n(paymentsRaw?.paidCount),
      partialCount: n(paymentsRaw?.partialCount),
      unpaidCount: n(paymentsRaw?.unpaidCount),
    };

    const expenses = {
      totalAmount: n(expensesRaw?.totalAmount),
      totalCount: n(expensesRaw?.totalCount),
    };

    const payroll = {
      statusEnum: StaffSalaryStatus,
      amountDue: n(payrollRaw?.amountDue),
      amountPaid: n(payrollRaw?.amountPaid),
      remainingAmount: n(payrollRaw?.remainingAmount),
      totalCount: n(payrollRaw?.totalCount),
      paidCount: n(payrollRaw?.paidCount),
      partialCount: n(payrollRaw?.partialCount),
      unpaidCount: n(payrollRaw?.unpaidCount),
    };

    const students = {
      totalCount: n(studentsRaw?.totalCount),
      activeCount: n(studentsRaw?.activeCount),
      addedCount: n(studentsRaw?.addedCount),
      stoppedCount: n(studentsRaw?.stoppedCount),
    };

    const netCashflow = n(payments.amountPaid - expenses.totalAmount - payroll.amountPaid);

    return {
      centerId,
      fromMonth: fromYm,
      toMonth: toYm,
      payments,
      expenses,
      payroll,
      students,
      netCashflow,
    };
  }
}

