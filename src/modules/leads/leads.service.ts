import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Lead } from '@/modules/leads/entities/lead.entity';
import { LeadStatus } from '@/modules/leads/enums/lead-status.enum';
import { Center } from '@/modules/centers/entities/centers.entity';
import { Organization } from '@/modules/organizations/entities/organizations.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { instanceToPlain } from 'class-transformer';
import { CurrentUser } from '@/common/types/current.user';
import { UserRole } from '@/common/enums/user-role.enums';
import { dayjs } from '@/shared/utils/dayjs';
import { ValidationException } from '@/common/exceptions/validation.exception';
import { StudentsService } from '@/modules/students/students.service';
import { CreateStudentDto } from '@/modules/students/dto/create-student.dto';
import { ChangeLeadStatusDto } from '@/modules/leads/dto/change-lead-status.dto';

@Injectable()
export class LeadsService {
  constructor(
    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,
    @InjectRepository(Center)
    private readonly centerRepo: Repository<Center>,
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    private readonly studentsService: StudentsService,
  ) {}

  private async resolveCenterIdOrThrow(
    organizationId: number,
    centerId?: number,
  ): Promise<number> {
    if (!centerId) throw new BadRequestException('centerId is required');

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

  async findAll(
    organizationId: number,
    {
      centerId,
      name,
      phone,
      status,
      page = 1,
      perPage = 10,
      groupId,
    }: {
      centerId?: number;
      name?: string;
      phone?: string;
      status?: LeadStatus;
      page?: number;
      perPage?: number;
      groupId?: number;
    },
    currentUser: CurrentUser,
  ) {
    const skip = (page - 1) * perPage;

    const isAdmin =
      currentUser.role === UserRole.ADMIN ||
      currentUser.role === UserRole.SUPER_ADMIN;

    const resolvedCenterId = centerId
      ? await this.resolveCenterIdOrThrow(organizationId, centerId)
      : !isAdmin
        ? await this.resolveCenterIdOrThrow(organizationId, currentUser.centerId)
        : undefined;

    const query = this.leadRepo
      .createQueryBuilder('lead')
      .loadRelationIdAndMap('lead._groupIds', 'lead.groups')
      .leftJoinAndSelect('lead.center', 'center')
      .leftJoin('lead.organization', 'org')
      .where('org.id = :organizationId', { organizationId });

    if (resolvedCenterId) {
      query.andWhere('lead.centerId = :centerId', { centerId: resolvedCenterId });
    }

    if (name?.trim()) {
      const q = `%${name.trim()}%`;
      query.andWhere('(lead.firstName ILIKE :q OR lead.lastName ILIKE :q)', { q });
    }

    if (phone?.trim()) {
      query.andWhere('lead.phone ILIKE :phone', { phone: `%${phone.trim()}%` });
    }

    if (status) {
      query.andWhere('lead.status = :status', { status });
    } else {
      // Default: hide converted leads from the list
      query.andWhere('lead.status != :st', { st: LeadStatus.CONVERTED });
    }

    if (groupId) {
      query.andWhere(
        `lead.id IN (
          SELECT lg."leadId" FROM "leads_groups_groups" lg
          WHERE lg."groupId" = :groupId
        )`,
        { groupId },
      );
    }

    const [data, total] = await query
      .orderBy('lead.createdAt', 'DESC')
      .skip(skip)
      .take(perPage)
      .getManyAndCount();

    const out = data.map((l: any) => {
      const row: any = {
        ...instanceToPlain(l),
        centerId: l.centerId ?? l.center?.id ?? null,
        groupIds: Array.isArray(l._groupIds)
          ? l._groupIds.map((x: any) => Number(x))
          : [],
        createdAt: l.createdAt?.toISOString?.() ?? String(l.createdAt),
        updatedAt: l.updatedAt?.toISOString?.() ?? String(l.updatedAt),
        birthDate: l.birthDate ? dayjs(l.birthDate).format('YYYY-MM-DD') : null,
      };

      if (!isAdmin) {
        delete row.passportSeries;
        delete row.passportNumber;
        delete row.jshshir;
      }
      return row;
    });

    return {
      data: out,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  async create(
    dto: any,
    currentUser: CurrentUser,
  ) {
    const isAdmin =
      currentUser.role === UserRole.ADMIN ||
      currentUser.role === UserRole.SUPER_ADMIN;

    const effectiveCenterId = isAdmin
      ? dto.centerId ?? currentUser.centerId
      : currentUser.centerId;

    const centerId = await this.resolveCenterIdOrThrow(
      currentUser.organizationId,
      effectiveCenterId,
    );

    const org = await this.orgRepo.findOne({ where: { id: currentUser.organizationId } });
    if (!org) throw new NotFoundException('Organization not found');

    if (dto.phone?.trim?.()) dto.phone = dto.phone.trim();
    if (!dto.phone) throw new ValidationException({ phone: 'phone is required' });

    const groups =
      Array.isArray(dto.groupIds) && dto.groupIds.length
        ? await this.groupRepo.findBy({ id: In(dto.groupIds) })
        : [];

    const lead = this.leadRepo.create({
      phone: dto.phone,
      firstName: dto.firstName ?? null,
      lastName: dto.lastName ?? null,
      secondPhone: dto.secondPhone ?? null,
      birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
      monthlyFee: dto.monthlyFee ?? null,
      discountPercent: dto.discountPercent ?? 0,
      discountReason: dto.discountReason ?? null,
      comment: dto.comment ?? null,
      heardAboutUs: dto.heardAboutUs ?? null,
      preferredTime: dto.preferredTime ?? null,
      preferredDays: dto.preferredDays ?? null,
      passportSeries: dto.passportSeries ?? null,
      passportNumber: dto.passportNumber ?? null,
      jshshir: dto.jshshir ?? null,
      status: dto.status ?? LeadStatus.NEW,
      studentId: null,
      centerId,
      center: { id: centerId } as any,
      organizationId: org.id,
      organization: org as any,
      groups,
    });

    const saved = await this.leadRepo.save(lead);
    return instanceToPlain(saved);
  }

  async update(
    organizationId: number,
    id: number,
    dto: any,
    currentUser: CurrentUser,
  ) {
    const lead = await this.leadRepo.findOne({
      where: { id },
      relations: ['organization', 'center', 'groups'],
    });
    if (!lead || (lead as any).organizationId !== organizationId) {
      throw new NotFoundException('Lead not found');
    }

    if (lead.status === LeadStatus.CONVERTED) {
      throw new BadRequestException('Converted lead cannot be edited');
    }

    // center scoping: non-admin cannot change center
    const isAdmin =
      currentUser.role === UserRole.ADMIN ||
      currentUser.role === UserRole.SUPER_ADMIN;
    if (!isAdmin && dto.centerId !== undefined) {
      throw new BadRequestException('centerId cannot be changed');
    }
    if (dto.centerId !== undefined) {
      lead.centerId = await this.resolveCenterIdOrThrow(organizationId, dto.centerId);
    }

    if (dto.phone !== undefined) {
      const p = String(dto.phone ?? '').trim();
      if (!p) throw new ValidationException({ phone: 'phone is required' });
      lead.phone = p;
    }
    if (dto.firstName !== undefined) lead.firstName = dto.firstName ?? null;
    if (dto.lastName !== undefined) lead.lastName = dto.lastName ?? null;
    if (dto.secondPhone !== undefined) lead.secondPhone = dto.secondPhone ?? null;
    if (dto.birthDate !== undefined) {
      lead.birthDate = dto.birthDate ? new Date(dto.birthDate) : null;
    }
    if (dto.monthlyFee !== undefined) lead.monthlyFee = dto.monthlyFee ?? null;
    if (dto.discountPercent !== undefined) lead.discountPercent = dto.discountPercent ?? 0;
    if (dto.discountReason !== undefined) lead.discountReason = dto.discountReason ?? null;
    if (dto.comment !== undefined) lead.comment = dto.comment ?? null;
    if (dto.heardAboutUs !== undefined) lead.heardAboutUs = dto.heardAboutUs ?? null;
    if (dto.preferredTime !== undefined) lead.preferredTime = dto.preferredTime ?? null;
    if (dto.preferredDays !== undefined) lead.preferredDays = dto.preferredDays ?? null;
    if (dto.passportSeries !== undefined) lead.passportSeries = dto.passportSeries ?? null;
    if (dto.passportNumber !== undefined) lead.passportNumber = dto.passportNumber ?? null;
    if (dto.jshshir !== undefined) lead.jshshir = dto.jshshir ?? null;
    if (dto.status !== undefined) lead.status = dto.status ?? LeadStatus.NEW;

    if (dto.groupIds !== undefined) {
      lead.groups =
        Array.isArray(dto.groupIds) && dto.groupIds.length
          ? await this.groupRepo.findBy({ id: In(dto.groupIds) })
          : [];
    }

    const saved = await this.leadRepo.save(lead);
    return instanceToPlain(saved);
  }

  async changeStatus(
    organizationId: number,
    id: number,
    dto: ChangeLeadStatusDto,
  ) {
    const lead = await this.leadRepo.findOne({
      where: { id },
      relations: ['organization'],
    });
    if (!lead || (lead as any).organizationId !== organizationId) {
      throw new NotFoundException('Lead not found');
    }

    if (lead.status === LeadStatus.CONVERTED) {
      throw new BadRequestException('Converted lead cannot be edited');
    }

    lead.status = dto.status;

    if (dto.reason?.trim()) {
      const reason = dto.reason.trim();
      lead.comment = lead.comment ? `${lead.comment}\n${reason}` : reason;
    }

    const saved = await this.leadRepo.save(lead);
    return instanceToPlain(saved);
  }

  async remove(organizationId: number, id: number) {
    const lead = await this.leadRepo.findOne({
      where: { id },
      relations: ['organization'],
    });
    if (!lead || (lead as any).organizationId !== organizationId) {
      throw new NotFoundException('Lead not found');
    }
    await this.leadRepo.delete({ id });
    return { success: true };
  }

  async transferToStudent(
    organizationId: number,
    leadId: number,
    currentUser: CurrentUser,
    dto: CreateStudentDto,
  ) {
    const lead = await this.leadRepo.findOne({
      where: { id: leadId },
      relations: ['organization', 'groups'],
    });
    if (!lead || (lead as any).organizationId !== organizationId) {
      throw new NotFoundException('Lead not found');
    }
    if (lead.status === LeadStatus.CONVERTED && lead.studentId) {
      return { success: true, studentId: lead.studentId };
    }

    // Transfer should accept the same body as POST /students.
    // For safety, we always keep centerId from the lead (no cross-center transfers via this endpoint).
    const merged: any = {
      ...(dto as any),
      phone: (dto as any).phone ?? lead.phone,
      centerId: lead.centerId,
    };

    // Create student (will create user/student)
    const student = await this.studentsService.create(
      merged,
      currentUser.centerId,
      organizationId,
      currentUser.role,
    );

    // mark lead converted
    lead.status = LeadStatus.CONVERTED;
    lead.studentId = (student as any).id ?? null;
    await this.leadRepo.save(lead);

    return { success: true, studentId: lead.studentId };
  }
}

