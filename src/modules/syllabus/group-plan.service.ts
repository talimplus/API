import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Group } from '@/modules/groups/entities/groups.entity';
import { AttendanceLessonOverride } from '@/modules/attendance/entities/attendance-lesson-override.entity';
import { computeLessonDates } from '@/modules/attendance/utils/lesson-dates';
import { UserRole } from '@/common/enums/user-role.enums';
import { WeekDay } from '@/common/enums/group-schedule.enum';
import { dayjs } from '@/shared/utils/dayjs';
import { Syllabus } from './entities/syllabus.entity';
import { SyllabusTopic } from './entities/syllabus-topic.entity';
import { GroupLessonTopic } from './entities/group-lesson-topic.entity';
import { SetLessonTopicsDto } from './dto/set-lesson-topics.dto';
import { DistributePlanDto } from './dto/distribute-plan.dto';
import { LessonAiService } from './lesson-ai.service';

const weekDayToDow: Record<WeekDay, number> = {
  [WeekDay.SUNDAY]: 0,
  [WeekDay.MONDAY]: 1,
  [WeekDay.TUESDAY]: 2,
  [WeekDay.WEDNESDAY]: 3,
  [WeekDay.THURSDAY]: 4,
  [WeekDay.FRIDAY]: 5,
  [WeekDay.SATURDAY]: 6,
};

@Injectable()
export class GroupPlanService {
  constructor(
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    @InjectRepository(Syllabus)
    private readonly syllabusRepo: Repository<Syllabus>,
    @InjectRepository(SyllabusTopic)
    private readonly topicRepo: Repository<SyllabusTopic>,
    @InjectRepository(GroupLessonTopic)
    private readonly lessonTopicRepo: Repository<GroupLessonTopic>,
    @InjectRepository(AttendanceLessonOverride)
    private readonly overrideRepo: Repository<AttendanceLessonOverride>,
    private readonly lessonAiService: LessonAiService,
  ) {}

  private async getGroupOrThrow(groupId: number): Promise<Group> {
    const group = await this.groupRepo.findOne({
      where: { id: groupId },
      relations: ['schedules', 'center', 'subject', 'room', 'teacher', 'syllabus'],
    });
    if (!group) throw new NotFoundException('Guruh topilmadi');
    return group;
  }

  private assertCanAccessGroup(user: any, group: Group) {
    if (
      user?.role !== UserRole.SUPER_ADMIN &&
      user?.centerId &&
      group.center?.id &&
      group.center.id !== user.centerId
    ) {
      throw new ForbiddenException('Not allowed to access this group');
    }
  }

  /**
   * Reja tahriri: o'qituvchi faqat o'zi dars beradigan guruh rejasini o'zgartira oladi.
   */
  private assertCanEditGroupPlan(user: any, group: Group) {
    this.assertCanAccessGroup(user, group);
    if (
      user?.role === UserRole.TEACHER &&
      group.teacher?.id !== user.userId
    ) {
      throw new ForbiddenException(
        "Faqat o'zingiz dars beradigan guruh rejasini o'zgartira olasiz",
      );
    }
  }

  private formatDateOnly(input: Date | string): string {
    return dayjs.utc(input).format('YYYY-MM-DD');
  }

  /**
   * Jadval + ko'chirishlar (override) hisobga olingan haqiqiy dars sanalari.
   * Natija tartiblangan — indeks + 1 = dars tartib raqami.
   */
  private async effectiveLessonDates(
    group: Group,
    toDate: string,
  ): Promise<string[]> {
    const timezone = group.timezone || 'Asia/Tashkent';
    const startDate = dayjs(group.startDate).format('YYYY-MM-DD');
    const endDate = group.endDate
      ? dayjs(group.endDate).format('YYYY-MM-DD')
      : null;

    const scheduled = computeLessonDates({
      timezone,
      groupStartDate: startDate,
      groupEndDate: endDate,
      schedules: group.schedules ?? [],
      window: { mode: 'range', from: startDate, to: toDate },
    });

    const overrides = await this.overrideRepo.find({
      where: { groupId: group.id },
    });

    const dates = new Set(scheduled);
    for (const o of overrides) {
      const from = this.formatDateOnly(o.fromDate);
      const to = this.formatDateOnly(o.toDate);
      dates.delete(from);
      if (to <= toDate) dates.add(to);
    }

    return Array.from(dates).sort();
  }

  /**
   * Guruh darslari uchun ufq (oxirgi sana): endDate, bo'lmasa
   * startDate + durationMonths. Ikkalasi ham bo'lmasa null.
   */
  private getHorizonDate(group: Group): string | null {
    if (group.endDate) return dayjs(group.endDate).format('YYYY-MM-DD');
    if (group.durationMonths) {
      return dayjs(group.startDate)
        .add(group.durationMonths, 'month')
        .format('YYYY-MM-DD');
    }
    return null;
  }

  private topicToView(topic: SyllabusTopic) {
    return {
      id: topic.id,
      orderIndex: topic.orderIndex,
      title: topic.title,
      description: topic.description ?? null,
      difficulty: topic.difficulty,
      estimatedLessons: topic.estimatedLessons,
      guide: topic.guide ?? null,
      lessonOutline: topic.lessonOutline ?? null,
      homework: topic.homework ?? null,
    };
  }

  // ---------- Guruh rejasi ----------

  async getPlan(groupId: number, user: any) {
    const group = await this.getGroupOrThrow(groupId);
    this.assertCanAccessGroup(user, group);

    const timezone = group.timezone || 'Asia/Tashkent';
    const today = dayjs().tz(timezone).format('YYYY-MM-DD');
    const horizon = this.getHorizonDate(group);

    const lessonDates = await this.effectiveLessonDates(
      group,
      horizon ?? today,
    );

    const bindings = await this.lessonTopicRepo.find({
      where: { groupId },
      relations: ['topic'],
      order: { lessonNumber: 'ASC' },
    });

    const syllabus = group.syllabus
      ? await this.syllabusRepo.findOne({
          where: { id: group.syllabus.id },
          relations: ['topics', 'subject'],
        })
      : null;

    const topicsByLesson: Record<number, any[]> = {};
    const assignedTopicIds = new Set<number>();
    for (const b of bindings) {
      if (!topicsByLesson[b.lessonNumber]) topicsByLesson[b.lessonNumber] = [];
      if (b.topic) {
        topicsByLesson[b.lessonNumber].push(this.topicToView(b.topic));
        assignedTopicIds.add(b.topicId);
      }
    }

    const maxBoundNumber = bindings.length
      ? Math.max(...bindings.map((b) => b.lessonNumber))
      : 0;
    const totalLessons = Math.max(lessonDates.length, maxBoundNumber);

    const lessons = Array.from({ length: totalLessons }, (_, i) => {
      const lessonNumber = i + 1;
      const date = lessonDates[i] ?? null;
      return {
        lessonNumber,
        date,
        isPast: date ? date < today : false,
        isToday: date === today,
        topics: (topicsByLesson[lessonNumber] ?? []).sort(
          (a, b) => a.orderIndex - b.orderIndex,
        ),
      };
    });

    const sortedTopics = (syllabus?.topics ?? []).sort(
      (a, b) => a.orderIndex - b.orderIndex,
    );

    return {
      group: {
        id: group.id,
        name: group.name,
        status: group.status,
        startDate: dayjs(group.startDate).format('YYYY-MM-DD'),
        endDate: group.endDate
          ? dayjs(group.endDate).format('YYYY-MM-DD')
          : null,
        durationMonths: group.durationMonths ?? null,
        subject: group.subject
          ? { id: group.subject.id, name: group.subject.name }
          : null,
      },
      syllabus: syllabus
        ? {
            id: syllabus.id,
            name: syllabus.name,
            description: syllabus.description ?? null,
            topics: sortedTopics.map((t) => ({
              ...this.topicToView(t),
              isAssigned: assignedTopicIds.has(t.id),
            })),
          }
        : null,
      timezone,
      today,
      totalLessons,
      /**
       * Ufq aniqlanmagan bo'lsa (endDate ham, durationMonths ham yo'q),
       * darslar faqat bugungacha hisoblanadi.
       */
      horizonDate: horizon,
      lessons,
    };
  }

  async attachSyllabus(
    groupId: number,
    syllabusId: number | null | undefined,
    user: any,
  ) {
    const group = await this.getGroupOrThrow(groupId);
    this.assertCanAccessGroup(user, group);

    if (!syllabusId) {
      group.syllabus = null;
      await this.lessonTopicRepo.delete({ groupId });
      await this.groupRepo.save(group);
      return this.getPlan(groupId, user);
    }

    const syllabus = await this.syllabusRepo.findOne({
      where: { id: syllabusId },
      relations: ['center'],
    });
    if (!syllabus) throw new NotFoundException('Kurs rejasi topilmadi');
    if (group.center?.id && syllabus.center?.id !== group.center.id) {
      throw new ForbiddenException(
        'Kurs rejasi boshqa markazga tegishli',
      );
    }

    // Boshqa syllabusga o'tishda eski biriktirishlar ma'nosini yo'qotadi
    if (group.syllabus && group.syllabus.id !== syllabusId) {
      await this.lessonTopicRepo.delete({ groupId });
    }

    group.syllabus = syllabus;
    await this.groupRepo.save(group);

    return this.getPlan(groupId, user);
  }

  async setLessonTopics(
    groupId: number,
    lessonNumber: number,
    dto: SetLessonTopicsDto,
    user: any,
  ) {
    const group = await this.getGroupOrThrow(groupId);
    this.assertCanEditGroupPlan(user, group);

    if (!Number.isInteger(lessonNumber) || lessonNumber < 1) {
      throw new BadRequestException("Dars raqami 1 dan boshlanadi");
    }
    if (!group.syllabus) {
      throw new BadRequestException(
        'Avval guruhga kurs rejasini biriktiring',
      );
    }

    const uniqueIds = Array.from(new Set(dto.topicIds));
    if (uniqueIds.length) {
      const topics = await this.topicRepo.find({
        where: { id: In(uniqueIds), syllabusId: group.syllabus.id },
      });
      if (topics.length !== uniqueIds.length) {
        throw new BadRequestException(
          "Ba'zi mavzular guruh kurs rejasiga tegishli emas",
        );
      }
    }

    await this.lessonTopicRepo.manager.transaction(async (manager) => {
      await manager.delete(GroupLessonTopic, { groupId, lessonNumber });
      if (uniqueIds.length) {
        await manager.insert(
          GroupLessonTopic,
          uniqueIds.map((topicId) => ({ groupId, lessonNumber, topicId })),
        );
      }
    });

    return this.getPlan(groupId, user);
  }

  // ---------- AI taqsimlash ----------

  async distribute(groupId: number, dto: DistributePlanDto, user: any) {
    const group = await this.getGroupOrThrow(groupId);
    this.assertCanEditGroupPlan(user, group);

    if (!group.syllabus) {
      throw new BadRequestException(
        'Avval guruhga kurs rejasini biriktiring',
      );
    }
    if (!group.schedules?.length && !dto.totalLessons) {
      throw new BadRequestException('Guruh jadvali sozlanmagan');
    }

    const syllabus = await this.syllabusRepo.findOne({
      where: { id: group.syllabus.id },
      relations: ['topics', 'subject'],
    });
    const topics = (syllabus?.topics ?? []).sort(
      (a, b) => a.orderIndex - b.orderIndex,
    );
    if (!topics.length) {
      throw new BadRequestException('Kurs rejasida mavzular yo\'q');
    }

    let totalLessons = dto.totalLessons;
    if (!totalLessons) {
      const horizon = this.getHorizonDate(group);
      if (!horizon) {
        throw new BadRequestException(
          "Jami darslar sonini aniqlab bo'lmadi: guruhda endDate yoki durationMonths yo'q. totalLessons yuboring",
        );
      }
      const dates = await this.effectiveLessonDates(group, horizon);
      totalLessons = dates.length;
    }
    if (!totalLessons) {
      throw new BadRequestException("Jami darslar soni 0 chiqdi");
    }

    const distributed = await this.lessonAiService.distributeTopics({
      syllabusName: syllabus.name,
      subjectName: syllabus.subject?.name ?? '',
      totalLessons,
      topics,
      instructions: dto.instructions,
    });

    await this.lessonTopicRepo.manager.transaction(async (manager) => {
      await manager.delete(GroupLessonTopic, { groupId });
      const rows = distributed.flatMap((l) =>
        l.topicIds.map((topicId) => ({
          groupId,
          lessonNumber: l.lessonNumber,
          topicId,
        })),
      );
      if (rows.length) {
        await manager.insert(GroupLessonTopic, rows);
      }
    });

    return this.getPlan(groupId, user);
  }

  // ---------- O'qituvchining bugungi darslari ----------

  async getTeacherToday(user: any) {
    const groups = await this.groupRepo.find({
      where: { teacher: { id: user.userId } },
      relations: ['schedules', 'center', 'subject', 'room', 'syllabus'],
    });

    const result = [];

    for (const group of groups) {
      const timezone = group.timezone || 'Asia/Tashkent';
      const today = dayjs().tz(timezone).format('YYYY-MM-DD');

      const dates = await this.effectiveLessonDates(group, today);
      const index = dates.indexOf(today);
      if (index === -1) continue;

      const lessonNumber = index + 1;

      const bindings = await this.lessonTopicRepo.find({
        where: [
          { groupId: group.id, lessonNumber },
          { groupId: group.id, lessonNumber: lessonNumber - 1 },
        ],
        relations: ['topic'],
      });

      const todayTopics = bindings
        .filter((b) => b.lessonNumber === lessonNumber && b.topic)
        .map((b) => this.topicToView(b.topic))
        .sort((a, b) => a.orderIndex - b.orderIndex);
      const previousTopics = bindings
        .filter((b) => b.lessonNumber === lessonNumber - 1 && b.topic)
        .map((b) => this.topicToView(b.topic))
        .sort((a, b) => a.orderIndex - b.orderIndex);

      const todayDow = dayjs.tz(today, timezone).day();
      const schedule = (group.schedules ?? []).find(
        (s) => weekDayToDow[s.day] === todayDow,
      );

      result.push({
        group: {
          id: group.id,
          name: group.name,
          status: group.status,
          subject: group.subject
            ? { id: group.subject.id, name: group.subject.name }
            : null,
          room: group.room
            ? { id: group.room.id, name: group.room.name }
            : null,
        },
        date: today,
        startTime: schedule?.startTime ?? null,
        lessonNumber,
        hasSyllabus: !!group.syllabus,
        topics: todayTopics,
        previousTopics,
      });
    }

    return {
      date: dayjs().format('YYYY-MM-DD'),
      lessons: result.sort((a, b) =>
        String(a.startTime ?? '').localeCompare(String(b.startTime ?? '')),
      ),
    };
  }
}
