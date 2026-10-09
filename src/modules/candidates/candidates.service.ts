import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Candidate } from '@/modules/candidates/entities/candidate.entity';
import {
  CreateCandidateDto,
  QueryCandidatesDto,
  UpdateCandidateDto,
} from '@/modules/candidates/dto/candidate.dto';
import { CurrentUser } from '@/common/types/current.user';
import { UserRole } from '@/common/enums/user-role.enums';
import { ValidationException } from '@/common/exceptions/validation.exception';

/**
 * Ishga nomzodlar (HR bazasi).
 *
 * - Har bir nomzod bitta filialga tegishli. Admin filialni tanlaydi (yoki
 *   "barcha filiallar"), qolgan xodim faqat o'z filialida ishlaydi.
 * - Fan ixtiyoriy, lekin tanlansa — nomzod filialining fani bo'lishi shart.
 */
@Injectable()
export class CandidatesService {
  constructor(
    @InjectRepository(Candidate)
    private readonly repo: Repository<Candidate>,
  ) {}

  private isAdmin(user: CurrentUser): boolean {
    return user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN;
  }

  private toView(c: Candidate) {
    return {
      id: c.id,
      centerId: c.centerId,
      firstName: c.firstName,
      lastName: c.lastName,
      phone: c.phone,
      experience: c.experience,
      birthYear: c.birthYear,
      subjectId: c.subjectId ?? null,
      subject: c.subject ? { id: c.subject.id, name: c.subject.name } : null,
      address: c.address ?? null,
      comment: c.comment ?? null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  /** Filial shu tashkilotniki ekanini tekshiradi. */
  private async assertCenter(organizationId: number, centerId: number) {
    const [c] = await this.repo.manager.query(
      `SELECT 1 FROM "centers" WHERE "id" = $1 AND "organizationId" = $2`,
      [centerId, organizationId],
    );
    if (!c) throw new NotFoundException('Filial topilmadi');
  }

  private async assertSubject(subjectId: number, centerId: number) {
    const [s] = await this.repo.manager.query(
      `SELECT 1 FROM "subjects" WHERE "id" = $1 AND "centerId" = $2`,
      [subjectId, centerId],
    );
    if (!s) {
      throw new ValidationException({
        subjectId: 'Fan topilmadi yoki bu filialga tegishli emas',
      });
    }
  }

  private async getOwned(user: CurrentUser, id: number) {
    const row = await this.repo.findOne({
      where: { id, organizationId: user.organizationId },
      relations: ['subject'],
    });
    // Filial xodimi boshqa filial nomzodini ko'rmaydi.
    if (
      !row ||
      (!this.isAdmin(user) && row.centerId !== (user.centerId ?? null))
    ) {
      throw new NotFoundException('Nomzod topilmadi');
    }
    return row;
  }

  async list(user: CurrentUser, query: QueryCandidatesDto) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 10;
    const centerId = this.isAdmin(user) ? query.centerId : user.centerId;
    if (!this.isAdmin(user) && !centerId) {
      throw new ForbiddenException('Xodim filialga biriktirilmagan');
    }

    const qb = this.repo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.subject', 'subject')
      .where('c.organizationId = :organizationId', {
        organizationId: user.organizationId,
      });
    if (centerId) qb.andWhere('c.centerId = :centerId', { centerId });
    if (query.subjectId) {
      qb.andWhere('c.subjectId = :subjectId', { subjectId: query.subjectId });
    }
    const search = query.search?.trim();
    if (search) {
      // Telefon bazada har xil yozilishi mumkin — raqamlar raqamlar bilan.
      const digits = search.replace(/\D/g, '');
      qb.andWhere(
        `(c.firstName ILIKE :q OR c.lastName ILIKE :q
          OR CONCAT(c.lastName, ' ', c.firstName) ILIKE :q
          OR CONCAT(c.firstName, ' ', c.lastName) ILIKE :q
          OR c.phone ILIKE :q` +
          (digits.length >= 3
            ? ` OR regexp_replace(c.phone, '\\D', '', 'g') LIKE :digits`
            : '') +
          ')',
        { q: `%${search}%`, digits: `%${digits}%` },
      );
    }

    const [rows, total] = await qb
      .orderBy('c.createdAt', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .skip((page - 1) * perPage)
      .take(perPage)
      .getManyAndCount();

    return {
      data: rows.map((c) => this.toView(c)),
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  async findOne(user: CurrentUser, id: number) {
    return this.toView(await this.getOwned(user, id));
  }

  async create(user: CurrentUser, dto: CreateCandidateDto) {
    const centerId = this.isAdmin(user)
      ? (dto.centerId ?? user.centerId)
      : user.centerId;
    if (!centerId) {
      throw new ValidationException({ centerId: 'Filialni tanlang' });
    }
    this.assertBirthYear(dto.birthYear);
    await this.assertCenter(user.organizationId, centerId);
    if (dto.subjectId) await this.assertSubject(dto.subjectId, centerId);

    const saved = await this.repo.save(
      this.repo.create({
        organizationId: user.organizationId,
        centerId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        experience: dto.experience,
        birthYear: dto.birthYear,
        subjectId: dto.subjectId ?? null,
        address: dto.address ?? null,
        comment: dto.comment ?? null,
        createdById: user.userId,
      }),
    );
    return this.findOne(user, saved.id);
  }

  /** Tug'ilgan yil — joriy yildan katta bo'lmaydi (DTO'da `@Max` faqat
   *  server ishga tushgan yilni bilardi). */
  private assertBirthYear(year: number | undefined) {
    if (year !== undefined && year > new Date().getFullYear()) {
      throw new ValidationException({
        birthYear: "Tug'ilgan yil noto'g'ri",
      });
    }
  }

  async update(user: CurrentUser, id: number, dto: UpdateCandidateDto) {
    // PartialType maydonni ixtiyoriy qiladi va `null` ni ham o'tkazib yuboradi —
    // majburiy ustunga `null` DB xatosi bo'lmasin, 422 bo'lsin.
    const required = [
      'firstName',
      'lastName',
      'phone',
      'experience',
      'birthYear',
    ] as const;
    const nulls = required.filter((k) => dto[k] === null);
    if (nulls.length) {
      throw new ValidationException(
        Object.fromEntries(nulls.map((k) => [k, 'Majburiy maydon'])),
      );
    }
    this.assertBirthYear(dto.birthYear);
    const row = await this.getOwned(user, id);

    if (dto.centerId !== undefined && dto.centerId !== row.centerId) {
      if (!this.isAdmin(user)) {
        throw new ForbiddenException("Filialni o'zgartirib bo'lmaydi");
      }
      await this.assertCenter(user.organizationId, dto.centerId);
      row.centerId = dto.centerId;
    }

    if (dto.firstName !== undefined) row.firstName = dto.firstName;
    if (dto.lastName !== undefined) row.lastName = dto.lastName;
    if (dto.phone !== undefined) row.phone = dto.phone;
    if (dto.experience !== undefined) row.experience = dto.experience;
    if (dto.birthYear !== undefined) row.birthYear = dto.birthYear;
    if (dto.address !== undefined) row.address = dto.address ?? null;
    if (dto.comment !== undefined) row.comment = dto.comment ?? null;
    if (dto.subjectId !== undefined) row.subjectId = dto.subjectId ?? null;
    // Filial o'zgarsa eski fan ham qayta tekshiriladi.
    if (row.subjectId) await this.assertSubject(row.subjectId, row.centerId);

    // `subject` relation yuklangan — uni tozalamasak, TypeORM `subjectId`
    // o'rniga eski relation'ni yozib qo'yadi.
    row.subject = undefined;
    await this.repo.save(row);
    return this.findOne(user, id);
  }

  async remove(user: CurrentUser, id: number) {
    const row = await this.getOwned(user, id);
    await this.repo.delete({ id: row.id });
    return { success: true };
  }
}
