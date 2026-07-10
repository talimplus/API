import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { SyllabusTopic } from './entities/syllabus-topic.entity';

export type DistributedLesson = {
  lessonNumber: number;
  topicIds: number[];
};

export type GeneratedTopicContent = {
  guide: string;
  lessonOutline: string;
  homework: string;
};

@Injectable()
export class LessonAiService {
  private readonly logger = new Logger(LessonAiService.name);
  private readonly client: OpenAI | null;
  private readonly model: string;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
    this.model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  }

  private getClient(): OpenAI {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'AI xizmati sozlanmagan (OPENAI_API_KEY topilmadi)',
      );
    }
    return this.client;
  }

  private async completeJson(system: string, user: string): Promise<any> {
    const client = this.getClient();
    const response = await client.chat.completions.create({
      model: this.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? '';
    try {
      return JSON.parse(raw);
    } catch (e) {
      this.logger.error(`AI JSON parse xatosi: ${raw.slice(0, 500)}`);
      throw new ServiceUnavailableException(
        'AI javobini o\'qib bo\'lmadi, qayta urinib ko\'ring',
      );
    }
  }

  /**
   * Mavzularni guruhning jami darslariga taqsimlaydi.
   * Qiyin mavzularga ko'proq dars, oson/kichik mavzularni bitta darsga birlashtiradi.
   */
  async distributeTopics(params: {
    syllabusName: string;
    subjectName: string;
    totalLessons: number;
    topics: SyllabusTopic[];
    instructions?: string;
  }): Promise<DistributedLesson[]> {
    const { syllabusName, subjectName, totalLessons, topics, instructions } =
      params;

    const topicList = topics.map((t) => ({
      id: t.id,
      title: t.title,
      difficulty: t.difficulty,
      estimatedLessons: t.estimatedLessons,
      description: t.description ?? undefined,
    }));

    const system = [
      "Sen o'quv markazi uchun dars rejalashtiruvchi yordamchisan.",
      'Berilgan kurs mavzularini belgilangan darslar soniga teng va mantiqiy taqsimlab berasan.',
      'Qoidalar:',
      '- Mavzular tartibini saqla (id tartibi emas, berilgan ro\'yxat tartibi).',
      "- Qiyin (hard) mavzularga ko'proq dars ajrat, oson (easy) va kichik mavzularni bitta darsga birlashtirishing mumkin.",
      '- estimatedLessons maydoni mavzu odatda nechta dars egallashiga ishora, lekin jami darslar soniga sig\'dirish uchun moslashtir.',
      '- Har bir dars kamida bitta mavzuga ega bo\'lishi shart emas (takrorlash/imtihon darslari bo\'sh qolishi mumkin), lekin barcha mavzular qamrab olinishi shart.',
      'Faqat quyidagi JSON formatda javob ber:',
      '{"lessons": [{"lessonNumber": 1, "topicIds": [12]}, {"lessonNumber": 2, "topicIds": [13, 14]}]}',
    ].join('\n');

    const user = JSON.stringify({
      subject: subjectName,
      course: syllabusName,
      totalLessons,
      topics: topicList,
      additionalInstructions: instructions ?? null,
    });

    const parsed = await this.completeJson(system, user);

    const validTopicIds = new Set(topics.map((t) => t.id));
    const lessons: DistributedLesson[] = Array.isArray(parsed?.lessons)
      ? parsed.lessons
      : [];

    const cleaned: DistributedLesson[] = [];
    const usedTopicIds = new Set<number>();
    for (const l of lessons) {
      const lessonNumber = Number(l?.lessonNumber);
      if (!Number.isInteger(lessonNumber)) continue;
      if (lessonNumber < 1 || lessonNumber > totalLessons) continue;

      const topicIds = (Array.isArray(l?.topicIds) ? l.topicIds : [])
        .map((id: any) => Number(id))
        .filter(
          (id: number) => validTopicIds.has(id) && !usedTopicIds.has(id),
        );
      topicIds.forEach((id: number) => usedTopicIds.add(id));

      if (topicIds.length) cleaned.push({ lessonNumber, topicIds });
    }

    // AI tashlab ketgan mavzularni oxirgi darslarga qo'shib qo'yamiz
    const missing = topics.filter((t) => !usedTopicIds.has(t.id));
    if (missing.length) {
      const lastNumber = cleaned.length
        ? Math.max(...cleaned.map((l) => l.lessonNumber))
        : 0;
      missing.forEach((t, i) => {
        const lessonNumber = Math.min(totalLessons, lastNumber + i + 1);
        const existing = cleaned.find((l) => l.lessonNumber === lessonNumber);
        if (existing) existing.topicIds.push(t.id);
        else cleaned.push({ lessonNumber, topicIds: [t.id] });
      });
    }

    return cleaned.sort((a, b) => a.lessonNumber - b.lessonNumber);
  }

  /**
   * Mavzu uchun qo'llanma, dars rejasi va uy vazifasi qoralamasini yaratadi.
   */
  async generateTopicContent(params: {
    subjectName: string;
    syllabusName: string;
    topicTitle: string;
    topicDescription?: string | null;
    audience?: string;
    instructions?: string;
  }): Promise<GeneratedTopicContent> {
    const system = [
      "Sen tajribali o'qituvchi-metodist yordamchisan.",
      "Berilgan mavzu uchun o'zbek tilida, markdown formatida uchta material tayyorlaysan:",
      "1. guide — o'qituvchi uchun qo'llanma: mavzuni qanday tushuntirish, e'tibor beriladigan nuqtalar, ko'p uchraydigan xatolar.",
      "2. lessonOutline — dars rejasi: darsning bosqichma-bosqich borishi (kirish, yangi mavzu, mashqlar, yakun).",
      '3. homework — uyga vazifa: aniq topshiriqlar.',
      'Faqat quyidagi JSON formatda javob ber:',
      '{"guide": "...", "lessonOutline": "...", "homework": "..."}',
    ].join('\n');

    const user = JSON.stringify({
      subject: params.subjectName,
      course: params.syllabusName,
      topic: params.topicTitle,
      topicDescription: params.topicDescription ?? null,
      audience: params.audience ?? null,
      additionalInstructions: params.instructions ?? null,
    });

    const parsed = await this.completeJson(system, user);

    return {
      guide: String(parsed?.guide ?? ''),
      lessonOutline: String(parsed?.lessonOutline ?? ''),
      homework: String(parsed?.homework ?? ''),
    };
  }
}
