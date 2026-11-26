import { OFFICIAL_INDICATORS } from '../config/official-template';
import https from 'https';
import { DocParserService, DigestedTeacherEvidence } from './doc-parser.service';
import { env } from '../config/env';

export interface AISummaryInput {
  assignmentTitle: string;
  totalSubmitted: number;
  totalTeachers: number;
  missingTeachers: string[];
  totalsByIndicator: Map<string, number>;
  statusLabel: string;
  digestedEvidence?: DigestedTeacherEvidence[];
}

export class AIService {
  public static get model(): string { return process.env.GROQ_MODEL || ''; }

  /**
   * Checks if Groq AI service is enabled and configured
   */
  public static isAvailable(): boolean {
    return Boolean(process.env.GROQ_API_KEY?.trim() && this.model);
  }

  /**
   * Performs an HTTPS chat completion to Groq API with IPv4 enforcement
   */
  private static async callGroqChat(
    messages: { role: string; content: string }[],
    options: { max_tokens?: number; json_mode?: boolean } = {}
  ): Promise<string | null> {
    if (!this.isAvailable()) return null;

    return new Promise((resolve) => {
      const payload: any = {
        model: this.model,
        messages,
        max_tokens: options.max_tokens || 400,
        temperature: 0.2,
      };

      if (options.json_mode) {
        payload.response_format = { type: 'json_object' };
      }

      const postData = JSON.stringify(payload);

      const req = https.request(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          family: 4,
          timeout: 15000,
          headers: {
            Authorization: `Bearer ${env.GROQ_API_KEY}`,
            'Content-Type': 'application/json',
            'User-Agent': 'ai-bird-secretary/1.0',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            try {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                const data = JSON.parse(body);
                const text = data.choices?.[0]?.message?.content || null;
                resolve(text);
              } else {
                console.warn(`⚠️ Groq API returned status ${res.statusCode}:`, body.slice(0, 200));
                resolve(null);
              }
            } catch (e) {
              console.warn('⚠️ Error parsing Groq JSON response:', e);
              resolve(null);
            }
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        console.warn('⚠️ Groq API request timed out (15s limit).');
        resolve(null);
      });

      req.on('error', (err) => {
        console.warn('⚠️ Groq API network error:', err.message);
        resolve(null);
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Uses Groq LLM to intelligently extract structured metric key-value pairs
   * from arbitrary, unstructured teacher reports or notes.
   */
  public static async extractMetricsFromText(
    text: string,
    teacherName: string = 'Викладач'
  ): Promise<Map<string, number>> {
    const metrics = new Map<string, number>();

    if (!this.isAvailable() || !text || text.trim().length < 20) {
      return metrics;
    }

    try {
      console.log(`🤖 [Groq AI] Extracting scientific metrics from unstructured text for ${teacherName}...`);

      const prompt = `
Ви — аналітичний помічник кафедри університету. Проаналізуйте звіт викладача (${teacherName}) та витягніть числові показники наукової діяльності.
Текст звіту викладача:
"""
${text.slice(0, 8000)}
"""

ПРАВИЛА:
1. Якщо викладач прямо чи опосередковано згадує кількість публікацій, монографій, статей (Scopus, WoS, фахові категорії Б), тез, патентів, грантів чи друкованих аркушів — вкажіть відповідне число.
2. Якщо у тексті є слова "немає", "інформація відсутня", "відсутні", "не публікував", прочерки "-" — показник дорівнює 0.
3. Поверніть результат ВИКЛЮЧНО як валідний JSON-об'єкт, де ключі — це точні назви показників із списку нижче, а значення — числа (int або float):

Доступні назви показників:
- "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — монографії"
- "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — підручники"
- "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — посібники"
- "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — статті в журналах Scopus"
- "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — статті в журналах Web of Science"
- "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — статті із них у фахових виданнях"
- "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — тези доповідей"
- "Розділ 3. Публікації — др. аркуші (всього)"
- "Розділ 10. Інформація про авторські свідоцтва, патенти, ліцензії, отримані в 2026 р. — вказати кількість"
- "Розділ 18. Кількість грантів від міжнародних фондів та міжнародних проєктів — кількість міжнародних проєктів з участю науковців"
- "Розділ 12. Науково-дослідна робота студентів — чисельність студентів, які беруть участь у НДР"
      `.trim();

      const rawJson = await this.callGroqChat(
        [
          { role: 'system', content: 'You are an academic data extraction engine that outputs only valid JSON.' },
          { role: 'user', content: prompt },
        ],
        { max_tokens: 500, json_mode: true }
      );

      if (rawJson) {
        const parsedObj = JSON.parse(rawJson);
        for (const [key, val] of Object.entries(parsedObj)) {
          const num = DocParserService.parseNumber(val);
          if (num > 0 && OFFICIAL_INDICATORS.includes(key)) {
            metrics.set(key, num);
          }
        }
        console.log(`✅ [Groq AI] Extracted ${metrics.size} metrics for ${teacherName}`);
      }
    } catch (err) {
      console.warn(`⚠️ [Groq AI] Failed to extract metrics via Groq for ${teacherName}:`, err);
    }

    return metrics;
  }

  /**
   * Generates a concise Executive Summary of the departmental scientific report.
   * Uses Groq LLM if API key is present, otherwise produces a structured deterministic summary.
   */
  public static async generateExecutiveSummary(input: AISummaryInput): Promise<string> {
    // Top non-zero indicators for summary
    const highlights: string[] = [];
    input.totalsByIndicator.forEach((val, ind) => {
      if (val > 0) {
        highlights.push(`${ind}: ${val}`);
      }
    });

    // Compile digested qualitative evidence from actual teacher files
    const allEvidence = input.digestedEvidence || [];
    const samplePubs = allEvidence.flatMap((e) => e.publications).filter(Boolean).slice(0, 4);
    const samplePatents = allEvidence.flatMap((e) => e.patents).filter(Boolean).slice(0, 3);
    const sampleGrants = allEvidence.flatMap((e) => e.grants).filter(Boolean).slice(0, 3);
    const sampleStudents = allEvidence.flatMap((e) => e.studentsWork).filter(Boolean).slice(0, 2);

    const evidenceSummaryParts: string[] = [];
    if (samplePubs.length > 0) {
      evidenceSummaryParts.push(`Публікації звітного періоду: ${samplePubs.join('; ')}`);
    }
    if (samplePatents.length > 0) {
      evidenceSummaryParts.push(`Патенти та охоронні документи: ${samplePatents.join('; ')}`);
    }
    if (sampleGrants.length > 0) {
      evidenceSummaryParts.push(`Гранти та проєкти: ${sampleGrants.join('; ')}`);
    }
    if (sampleStudents.length > 0) {
      evidenceSummaryParts.push(`Студентська наука: ${sampleStudents.join('; ')}`);
    }

    const qualitativeEvidenceText = evidenceSummaryParts.join('\n');

    // 1. Fallback deterministic summary if Groq is not available
    if (!this.isAvailable()) {
      const pendingText =
        input.missingTeachers.length > 0
          ? `Очікується подання від ${input.missingTeachers.length} викладачів (${input.missingTeachers.slice(0, 3).join(', ')}${input.missingTeachers.length > 3 ? ' та ін.' : ''}).`
          : 'Усі викладачі кафедри успішно подали звіти.';

      const highlightsPreview =
        highlights.length > 0
          ? `Ключові показники кафедри: ${highlights.slice(0, 4).join('; ')}.`
          : 'Наразі зафіксовано попередні зведені показники.';

      const qualitativePreview = samplePubs.length > 0 || sampleGrants.length > 0 || samplePatents.length > 0
        ? ` Серед результатів: ${[sampleGrants[0], samplePatents[0], samplePubs[0]].filter(Boolean).join('; ')}.`
        : '';

      return `Зведений звіт за напрямом «${input.assignmentTitle}» (статус: ${input.statusLabel}). Здано ${input.totalSubmitted} з ${input.totalTeachers} звітів. ${highlightsPreview}${qualitativePreview} ${pendingText}`;
    }

    // 2. Groq AI Generated Summary
    try {
      console.log(`🤖 [Groq AI] Generating Executive Summary for Head of Dept and Scientific Office...`);

      const prompt = `
Складіть стисле, офіційне аналітичне резюме (Executive Summary) для завідувача кафедри та науково-дослідного відділу університету за такими даними:
- Завдання: «${input.assignmentTitle}»
- Етап / Статус: ${input.statusLabel}
- Подано звітів: ${input.totalSubmitted} з ${input.totalTeachers} викладачів
- Викладачі, які ще не подали: ${input.missingTeachers.join(', ') || 'усі подали'}
- Загальні числові показники кафедри:
${highlights.slice(0, 15).join('\n') || 'Числові дані відсутні або попередні'}

- Фактичні наукові результати, витягнуті безпосередньо з оброблених файлів викладачів:
${qualitativeEvidenceText || 'Фактичні текстові описи відсутні'}

Вимоги:
1. Текст українською мовою, 2-3 зв'язних речення (до 75 слів).
2. Діловий академічний стиль.
3. Продемонструйте обізнаність зі змістом файлів: обов'язково конкретно згадайте ключові досягнення (наприклад, конкретні назви міжнародних грантів, журналів Scopus, теми монографій або номер/назву патенту) та стан дедлайну.
      `.trim();

      const summary = await this.callGroqChat(
        [
          { role: 'system', content: 'Ви — секретар-аналітик наукового підрозділу університету.' },
          { role: 'user', content: prompt },
        ],
        { max_tokens: 300 }
      );

      if (summary) {
        console.log(`✅ [Groq AI] Executive Summary generated successfully.`);
        return summary.trim();
      }
    } catch (err) {
      console.warn(`⚠️ [Groq AI] Failed to generate Executive Summary with Groq, falling back to template:`, err);
    }

    // Fallback if API fails
    return `Зведений звіт за напрямом «${input.assignmentTitle}» (${input.statusLabel}). Подано: ${input.totalSubmitted}/${input.totalTeachers}. Зафіксовано ${highlights.length} ненульових показників.`;
  }
}
