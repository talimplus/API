import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Expense } from '@/modules/expenses/entities/expenses.entity';
import { Center } from '@/modules/centers/entities/centers.entity';
import { dayjs } from '@/shared/utils/dayjs';
import { instanceToPlain } from 'class-transformer';

@Injectable()
export class ExpensesService {
  constructor(
    @InjectRepository(Expense)
    private readonly expenseRepo: Repository<Expense>,
    @InjectRepository(Center)
    private readonly centerRepo: Repository<Center>,
  ) {}

  private normalizeForMonth(forMonth?: string): string {
    const ym = (forMonth?.trim() || dayjs().format('YYYY-MM')) as string;
    if (!/^\d{4}-\d{2}$/.test(ym)) {
      throw new BadRequestException('forMonth must be in YYYY-MM format');
    }
    return `${ym}-01`;
  }

  private async resolveCenterId(
    organizationId: number,
    reqCenterId?: number,
    dtoCenterId?: number,
  ): Promise<number> {
    const centerId = dtoCenterId ?? reqCenterId;
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
      throw new NotFoundException('Center not found');
    }

    return centerId;
  }

  async create(
    organizationId: number,
    reqCenterId: number | undefined,
    dto: {
      centerId?: number;
      name: string;
      amount: number;
      description?: string;
      forMonth?: string;
    },
  ) {
    const centerId = await this.resolveCenterId(
      organizationId,
      reqCenterId,
      dto.centerId,
    );
    const forMonth = this.normalizeForMonth(dto.forMonth);

    const expense = this.expenseRepo.create({
      centerId,
      name: dto.name,
      amount: dto.amount,
      description: dto.description ?? null,
      forMonth: forMonth as any,
    });

    const saved = await this.expenseRepo.save(expense);
    return instanceToPlain(saved);
  }

  async findAll(
    organizationId: number,
    reqCenterId: number | undefined,
    {
      page = 1,
      perPage = 10,
      forMonth,
      centerId,
      search,
    }: {
      page?: number;
      perPage?: number;
      forMonth?: string;
      centerId?: number;
      search?: string;
    },
  ) {
    const skip = (page - 1) * perPage;
    const month = this.normalizeForMonth(forMonth);
    const effectiveCenterId = centerId ?? reqCenterId;

    const query = this.expenseRepo
      .createQueryBuilder('expense')
      .leftJoinAndSelect('expense.center', 'center')
      .leftJoin('center.organization', 'org')
      .where('org.id = :organizationId', { organizationId })
      .andWhere('expense.forMonth = :forMonth', { forMonth: month });

    if (effectiveCenterId) {
      query.andWhere('center.id = :centerId', { centerId: effectiveCenterId });
    }

    if (search?.trim()) {
      const q = `%${search.trim()}%`;
      query.andWhere(
        '(expense.name ILIKE :q OR expense.description ILIKE :q)',
        { q },
      );
    }

    const [data, total] = await query
      .orderBy('expense.createdAt', 'DESC')
      .skip(skip)
      .take(perPage)
      .getManyAndCount();

    return {
      data: instanceToPlain(data),
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  async findOne(organizationId: number, id: number) {
    const row = await this.expenseRepo
      .createQueryBuilder('expense')
      .leftJoinAndSelect('expense.center', 'center')
      .leftJoin('center.organization', 'org')
      .where('expense.id = :id', { id })
      .andWhere('org.id = :organizationId', { organizationId })
      .getOne();
    if (!row) throw new NotFoundException('Expense not found');
    return instanceToPlain(row);
  }

  async update(
    organizationId: number,
    reqCenterId: number | undefined,
    id: number,
    dto: {
      centerId?: number;
      name?: string;
      amount?: number;
      description?: string;
      forMonth?: string;
    },
  ) {
    const expense = await this.findOne(organizationId, id);

    const patch: any = {};

    if (dto.centerId !== undefined) {
      patch.centerId = await this.resolveCenterId(
        organizationId,
        reqCenterId,
        dto.centerId,
      );
    }
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.amount !== undefined) patch.amount = dto.amount;
    if (dto.description !== undefined) patch.description = dto.description ?? null;
    if (dto.forMonth !== undefined) patch.forMonth = this.normalizeForMonth(dto.forMonth) as any;

    await this.expenseRepo.update({ id }, patch);
    return this.findOne(organizationId, id);
  }

  async remove(organizationId: number, id: number) {
    // ensure ownership
    await this.findOne(organizationId, id);
    await this.expenseRepo.delete({ id });
    return { success: true };
  }
}

