import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Syllabus } from './entities/syllabus.entity';
import { SyllabusTopic } from './entities/syllabus-topic.entity';
import { Subject } from '@/modules/subjects/entities/subjects.entity';
import { CreateSyllabusDto } from './dto/create-syllabus.dto';
import { UpdateSyllabusDto } from './dto/update-syllabus.dto';
import { CreateTopicDto } from './dto/create-topic.dto';
import { UpdateTopicDto } from './dto/update-topic.dto';
import { ReorderTopicsDto } from './dto/reorder-topics.dto';
import { GenerateTopicContentDto } from './dto/generate-topic-content.dto';
import { LessonAiService } from './lesson-ai.service';

@Injectable()
export class SyllabusService {
  constructor(
    @InjectRepository(Syllabus)
    private readonly syllabusRepo: Repository<Syllabus>,
    @InjectRepository(SyllabusTopic)
    private readonly topicRepo: Repository<SyllabusTopic>,
    @InjectRepository(Subject)
    private readonly subjectRepo: Repository<Subject>,
    private readonly lessonAiService: LessonAiService,
  ) {}

  /**
   * Fanni foydalanuvchi ko'lami (tashkilot, mavjud bo'lsa markaz) ichida topadi.
   * Kurs rejasining markazi fandan olinadi — token'da centerId bo'lishi shart emas.
   */
  private async getScopedSubject(subjectId: number, user: any) {
    const query = this.subjectRepo
      .createQueryBuilder('subject')
      .leftJoinAndSelect('subject.center', 'center')
      .leftJoin('center.organization', 'organization')
      .where('subject.id = :subjectId', { subjectId })
      .andWhere('organization.id = :organizationId', {
        organizationId: user.organizationId,
      });

    if (user.centerId) {
      query.andWhere('center.id = :centerId', { centerId: user.centerId });
    }

    const subject = await query.getOne();
    if (!subject) {
      throw new NotFoundException('Fan topilmadi');
    }
    return subject;
  }

  async create(dto: CreateSyllabusDto, user: any) {
    const subject = await this.getScopedSubject(dto.subjectId, user);

    const syllabus = this.syllabusRepo.create({
      name: dto.name,
      description: dto.description ?? null,
      subject,
      center: subject.center,
      createdBy: user.userId ? ({ id: user.userId } as any) : null,
    });

    return this.syllabusRepo.save(syllabus);
  }

  async findAll(
    organizationId: number,
    {
      centerId,
      subjectId,
      name,
      page = 1,
      perPage = 10,
    }: {
      centerId?: number;
      subjectId?: number;
      name?: string;
      page?: number;
      perPage?: number;
    },
  ) {
    const skip = (page - 1) * perPage;

    const query = this.syllabusRepo
      .createQueryBuilder('syllabus')
      .leftJoinAndSelect('syllabus.subject', 'subject')
      .leftJoinAndSelect('syllabus.center', 'center')
      .leftJoin('center.organization', 'organization')
      .loadRelationCountAndMap('syllabus.topicsCount', 'syllabus.topics')
      .where('organization.id = :organizationId', { organizationId });

    if (centerId) {
      query.andWhere('center.id = :centerId', { centerId });
    }

    if (subjectId) {
      query.andWhere('subject.id = :subjectId', { subjectId });
    }

    if (name) {
      query.andWhere('syllabus.name ILIKE :name', { name: `%${name}%` });
    }

    const [data, total] = await query
      .orderBy('syllabus.createdAt', 'DESC')
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

  async findOne(id: number, user: any) {
    const query = this.syllabusRepo
      .createQueryBuilder('syllabus')
      .leftJoinAndSelect('syllabus.subject', 'subject')
      .leftJoinAndSelect('syllabus.center', 'center')
      .leftJoin('center.organization', 'organization')
      .leftJoinAndSelect('syllabus.topics', 'topics')
      .where('syllabus.id = :id', { id })
      .andWhere('organization.id = :organizationId', {
        organizationId: user.organizationId,
      })
      .orderBy('topics.orderIndex', 'ASC');

    if (user.centerId) {
      query.andWhere('center.id = :centerId', { centerId: user.centerId });
    }

    const syllabus = await query.getOne();
    if (!syllabus) throw new NotFoundException('Kurs rejasi topilmadi');
    return syllabus;
  }

  async update(id: number, dto: UpdateSyllabusDto, user: any) {
    const syllabus = await this.findOne(id, user);

    if (dto.subjectId) {
      const subject = await this.subjectRepo.findOne({
        where: { id: dto.subjectId, center: { id: syllabus.center.id } },
      });
      if (!subject) throw new NotFoundException('Fan topilmadi');
      syllabus.subject = subject;
    }

    if (dto.name !== undefined) syllabus.name = dto.name;
    if (dto.description !== undefined) syllabus.description = dto.description;

    return this.syllabusRepo.save(syllabus);
  }

  async remove(id: number, user: any) {
    const syllabus = await this.findOne(id, user);
    return this.syllabusRepo.remove(syllabus);
  }

  // ---------- Mavzular ----------

  async addTopic(syllabusId: number, dto: CreateTopicDto, user: any) {
    const syllabus = await this.findOne(syllabusId, user);

    const maxOrder = await this.topicRepo
      .createQueryBuilder('topic')
      .select('COALESCE(MAX(topic.orderIndex), -1)', 'max')
      .where('topic.syllabusId = :syllabusId', { syllabusId })
      .getRawOne();

    const topic = this.topicRepo.create({
      syllabusId: syllabus.id,
      orderIndex: Number(maxOrder.max) + 1,
      title: dto.title,
      description: dto.description ?? null,
      difficulty: dto.difficulty,
      estimatedLessons: dto.estimatedLessons ?? 1,
      guide: dto.guide ?? null,
      lessonOutline: dto.lessonOutline ?? null,
      homework: dto.homework ?? null,
    });

    return this.topicRepo.save(topic);
  }

  async getTopicOrThrow(syllabusId: number, topicId: number, user: any) {
    const syllabus = await this.findOne(syllabusId, user);
    const topic = await this.topicRepo.findOne({
      where: { id: topicId, syllabusId: syllabus.id },
    });
    if (!topic) throw new NotFoundException('Mavzu topilmadi');
    return { syllabus, topic };
  }

  async updateTopic(
    syllabusId: number,
    topicId: number,
    dto: UpdateTopicDto,
    user: any,
  ) {
    const { topic } = await this.getTopicOrThrow(syllabusId, topicId, user);
    Object.assign(topic, dto);
    return this.topicRepo.save(topic);
  }

  async removeTopic(syllabusId: number, topicId: number, user: any) {
    const { topic } = await this.getTopicOrThrow(syllabusId, topicId, user);
    return this.topicRepo.remove(topic);
  }

  async reorderTopics(syllabusId: number, dto: ReorderTopicsDto, user: any) {
    const syllabus = await this.findOne(syllabusId, user);
    const topics = syllabus.topics ?? [];

    const existingIds = new Set(topics.map((t) => t.id));
    const requestedIds = new Set(dto.topicIds);

    if (
      existingIds.size !== requestedIds.size ||
      dto.topicIds.some((id) => !existingIds.has(id))
    ) {
      throw new BadRequestException(
        "topicIds ro'yxati kurs rejasidagi barcha mavzularni o'z ichiga olishi kerak",
      );
    }

    await this.topicRepo.manager.transaction(async (manager) => {
      for (let i = 0; i < dto.topicIds.length; i++) {
        await manager.update(SyllabusTopic, dto.topicIds[i], {
          orderIndex: i,
        });
      }
    });

    return this.findOne(syllabusId, user);
  }

  // ---------- AI kontent ----------

  /**
   * Mavzu uchun AI qoralama yaratadi. Bazaga saqlamaydi —
   * o'qituvchi ko'rib chiqib, tahrirlab, PUT orqali saqlaydi.
   */
  async generateTopicContent(
    syllabusId: number,
    topicId: number,
    dto: GenerateTopicContentDto,
    user: any,
  ) {
    const { syllabus, topic } = await this.getTopicOrThrow(
      syllabusId,
      topicId,
      user,
    );

    return this.lessonAiService.generateTopicContent({
      subjectName: syllabus.subject?.name ?? '',
      syllabusName: syllabus.name,
      topicTitle: topic.title,
      topicDescription: topic.description,
      audience: dto.audience,
      instructions: dto.instructions,
    });
  }
}
