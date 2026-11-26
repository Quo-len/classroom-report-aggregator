import AdmZip from 'adm-zip';
import { mapToOfficialKey, sectionForLabel, SHEETS_SUFFIX } from '../core/metric-mapping';

export interface ParsedDocxResult {
  paragraphs: string[];
  tables: string[][][]; // table -> row -> cells
  fullText: string;
}

export interface DigestedTeacherEvidence {
  publications: string[];
  patents: string[];
  grants: string[];
  studentsWork: string[];
  photos: string[];
  rawNotes: string[];
}

export class DocParserService {
  public static decodeXml(text: string): string {
    return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, name: string) => {
      const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
      if (named[name]) return named[name];
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    });
  }

  private static readXml(zip: AdmZip, name: string): string {
    const entry = zip.getEntry(name);
    if (!entry) return '';
    if (entry.header.size > 10 * 1024 * 1024) throw new Error('XML перевищує ліміт 10 МБ');
    return entry.getData().toString('utf8');
  }

  /**
   * Helper to convert Excel column letters (e.g. 'A', 'B', 'Z', 'AA') to 0-based index
   */
  public static colLetterToIndex(col: string): number {
    let index = 0;
    const upper = col.toUpperCase();
    for (let i = 0; i < upper.length; i++) {
      index = index * 26 + (upper.charCodeAt(i) - 64);
    }
    return Math.max(0, index - 1);
  }

  /**
   * CRITICAL Business Rule:
   * Parse numeric value from cell or string.
   * If a value is "-", "–", "—", or "інформація відсутня" (including Cyrillic/Latin homoglyphs),
   * it MUST be returned as 0.
   */
  public static parseNumber(val: any): number {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return Number.isFinite(val) && val >= 0 ? val : 0;
    const text = String(val).trim();
    const normalized = text.toLowerCase().replace(/[iaoec]/g, char => ({ i: 'і', a: 'а', o: 'о', e: 'е', c: 'с' }[char]!));
    if (/відсутн|немає|отсутств|інформація/.test(normalized)) return 0;
    if (/^[-−]\s*\d/.test(text)) { console.warn('Від’ємний показник відхилено'); return 0; }
    const count = text.split('/')[0].trim();
    const withUnit = count.match(/^(\d+(?:[.,]\d+)?)\s*(?:шт\.?|од\.?|статей|публікац\p{L}*)$/iu);
    const cleaned = (withUnit ? withUnit[1] : count).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
    if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return 0;
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : 0;
  }

  /**
   * CRITICAL Parser Awareness:
   * Returns true if a string is a Table caption, Figure caption, Table of Contents (TOC),
   * metadata line, author attribution, column header, or document boilerplate that must
   * NEVER be treated as an official scientific indicator in the master report grid.
   */
  public static isNonIndicatorOrGarbage(text: string): boolean {
    if (!text) return true;
    const trimmed = text.trim();
    if (trimmed.length < 2) return true;

    const lower = trimmed.toLowerCase();

    // 1. Table captions & column titles
    if (/^(таблиця|табл\.?|таблица|table)(\s|$|\d|\.)/i.test(lower)) return true;
    if (/^(№|№\s*п\/?п|п\/п|номер|вихідні дані|назва публікації|бібліографічні дані|тип опублікованого|тип документу|др\.?\s*арк|обсяг|частка автора)(\s|$|:)/i.test(lower)) return true;

    // 2. Figure, picture, illustration, chart, diagram captions
    if (/^(рис(\.|унок)?|рисунок|мал(\.|юнок)?|малюнок|фото(графія)?|зображення|ілюстрація|схема|діаграма|графік|figure|fig\.|image|picture|photo)(\s|$|\d|\.|\:)/i.test(lower)) return true;

    // 3. Table of contents (TOC) and document structure
    if (/^(зміст|оглавление|table of contents|toc|перелік розділів|план)(\s|$|\.|\:)/i.test(lower)) return true;
    if (/^(вступ|висновки|список|джерела|література|додаток|додатки|примітка|примітки)(\s|$|\.|\:)/i.test(lower)) return true;

    // 4. Metadata, signatory, author and administrative labels
    if (/^(виконавець|автор|співавтор|керівник|п[іi]б|п\.і\.б|посада|науковий ступінь|вчене звання|кафедра|факультет|інститут|університет|дата|рік|підпис|телефон|мобільний|стаціонарний|електронна адреса|email|e-mail)(\s|$|\.|\:)/i.test(lower)) return true;
    if (/^(вказати інформацію|обов'язково|обов’язково|за календарний|звітний період|звіт про|інформація про)(\s|$|\.|\:|\!)/i.test(lower)) return true;

    // 5. Bare column numberings or symbols
    if (/^[\d\s\.,;:/\-–—\(\)]+$/.test(trimmed)) return true;

    return false;
  }

  /**
   * Parses a Word document (.docx) Buffer into paragraphs and table matrices
   */
  public static parseDocxBuffer(buffer: Buffer): ParsedDocxResult {
    try {
      const zip = new AdmZip(buffer);
      const xmlEntry = zip.getEntry('word/document.xml');
      if (!xmlEntry) {
        return { paragraphs: [], tables: [], fullText: '' };
      }

      const xml = this.readXml(zip, 'word/document.xml');

      // 1. Extract paragraphs
      const paragraphs: string[] = [];
      const pRegex = /<w:p(?:[\s>][\s\S]*?<\/w:p>|\/>)/g;
      let pMatch: RegExpExecArray | null;

      while ((pMatch = pRegex.exec(xml)) !== null) {
        const pXml = pMatch[0];
        const tMatches = pXml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
        const text = tMatches.map((t) => this.decodeXml(t.replace(/<[^>]+>/g, ''))).join('').trim();
        if (text) {
          paragraphs.push(text);
        }
      }

      // 2. Extract tables
      const tables: string[][][] = [];
      const stack: { rows: string[][]; row: string[]; cell: string; inCell: boolean }[] = [];
      const tokens = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<(\/?)w:(tbl|tr|tc|p)\b[^>]*>/g;
      let token: RegExpExecArray | null;
      while ((token = tokens.exec(xml)) !== null) {
        const current = stack[stack.length - 1];
        if (token[1] !== undefined) {
          if (current?.inCell) current.cell += this.decodeXml(token[1]);
          continue;
        }
        const closing = token[2] === '/';
        const tag = token[3];
        if (tag === 'tbl') {
          if (!closing) stack.push({ rows: [], row: [], cell: '', inCell: false });
          else {
            const table = stack.pop();
            if (table?.rows.length) tables.push(table.rows);
          }
        } else if (current) {
          if (tag === 'tr' && !closing) current.row = [];
          if (tag === 'tc' && !closing) { current.cell = ''; current.inCell = true; }
          if (tag === 'p' && closing && current.inCell) current.cell += ' ';
          if (tag === 'tc' && closing) { current.row.push(current.cell.trim()); current.inCell = false; }
          if (tag === 'tr' && closing && current.row.some(Boolean)) current.rows.push(current.row);
        }
      }

      return {
        paragraphs,
        tables,
        fullText: paragraphs.join('\n'),
      };
    } catch (err) {
      console.warn('⚠️ DocParserService: Failed to parse .docx buffer:', err);
      return { paragraphs: [], tables: [], fullText: '' };
    }
  }

  /**
   * Parses an Excel spreadsheet (.xlsx) Buffer into a 2D string matrix,
   * properly aligning cells by their actual column letter coordinates.
   */
  public static parseXlsxBuffer(buffer: Buffer): string[][] {
    try {
      const zip = new AdmZip(buffer);

      // 1. Shared Strings Table
      const sharedStrings: string[] = [];
      const ssEntry = zip.getEntry('xl/sharedStrings.xml');
      if (ssEntry) {
        const ssXml = this.readXml(zip, 'xl/sharedStrings.xml');
        const siRegex = /<si[\s\S]*?<\/si>/g;
        let m: RegExpExecArray | null;
        while ((m = siRegex.exec(ssXml)) !== null) {
          const tMatches = m[0].match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
          const text = tMatches.map((t) => this.decodeXml(t.replace(/<[^>]+>/g, ''))).join('');
          sharedStrings.push(text);
        }
      }

      // 2. Worksheet 1
      const workbook = this.readXml(zip, 'xl/workbook.xml');
      const firstId = workbook.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
      const relations = this.readXml(zip, 'xl/_rels/workbook.xml.rels');
      const relation = (relations.match(/<Relationship\b[^>]*\/>/g) || []).find(tag => tag.includes(`Id="${firstId}"`));
      const target = relation?.match(/Target="([^"]+)"/)?.[1];
      const sheetPath = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target}`) : 'xl/worksheets/sheet1.xml';
      if (sheetPath.includes('..')) throw new Error('Неприпустимий шлях аркуша');
      const sheetEntry = zip.getEntry(sheetPath);
      if (!sheetEntry) return [];

      const sheetXml = this.readXml(zip, sheetPath);
      const grid: string[][] = [];

      const rowRegex = /<row[\s\S]*?<\/row>/g;
      let rowMatch: RegExpExecArray | null;

      while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
        const rowXml = rowMatch[0];
        const rowCells: string[] = [];
        const cRegex = /<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;
        let cMatch: RegExpExecArray | null;

        while ((cMatch = cRegex.exec(rowXml)) !== null) {
          const cXml = cMatch[0];
          const rAttrMatch = cXml.match(/r="([A-Z]+)\d+"/i);
          const colLetter = rAttrMatch ? rAttrMatch[1] : '';
          const colIdx = colLetter ? this.colLetterToIndex(colLetter) : rowCells.length;

          const isShared = /t="s"/i.test(cXml);
          const isInline = /t="inlineStr"/i.test(cXml);
          let val = '';

          if (isInline) {
            const isMatch = cXml.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/);
            val = isMatch ? this.decodeXml(isMatch[1]) : '';
          } else {
            const vMatch = cXml.match(/<v>([\s\S]*?)<\/v>/);
            val = vMatch ? vMatch[1].trim() : '';
            if (isShared && val !== '') {
              const idx = parseInt(val, 10);
              val = sharedStrings[idx] || '';
            }
          }

          // Pad rowCells if necessary
          while (rowCells.length < colIdx) {
            rowCells.push('');
          }
          rowCells[colIdx] = val;
        }

        const rowNumber = Number(rowXml.match(/^<row\b[^>]*\br="(\d+)"/)?.[1] || grid.length + 1);
        if (rowNumber > 10000) throw new Error('Завелика кількість рядків');
        while (grid.length < rowNumber) grid.push([]);
        grid[rowNumber - 1] = rowCells;
      }

      return grid;
    } catch (err) {
      console.warn('⚠️ DocParserService: Failed to parse .xlsx buffer:', err);
      return [];
    }
  }

  /**
   * Intelligently extracts metric key-value pairs from .docx files (including official Додаток_*.docx)
   */
  public static extractMetricsFromDocx(buffer: Buffer, filename: string): Map<string, number> {
    const metrics = new Map<string, number>();
    const parsed = this.parseDocxBuffer(buffer);
    const lowerName = filename.toLowerCase();

    // Specialize for Додаток 1 (Staff Roster)
    if (!/монограф/i.test(lowerName) && parsed.fullText.includes('Список професорсько-викладацького складу')) {
      let totalStaff = 0;
      let fullTime = 0;
      let doctors = 0;
      let candidates = 0;

      for (const tbl of parsed.tables) {
        for (let r = 1; r < tbl.length; r++) {
          const row = tbl[r];
          // Skip column index headers "1 | 2 | 3..."
          if (row.length > 2 && /^[1-9]$/.test(row[0].trim()) && /^[1-9]$/.test(row[1].trim())) continue;
          if (!row[1] && !row[2]) continue;

          totalStaff++;
          const rowText = row.join(' ').toLowerCase();
          if (rowText.includes('штатн')) fullTime++;
          if (rowText.includes('докт.') || rowText.includes('д.т.н') || rowText.includes('доктор наук')) doctors++;
          if (rowText.includes('канд.') || rowText.includes('к.т.н') || rowText.includes('к.ф.-м.н') || rowText.includes('філософії') || rowText.includes('phd')) candidates++;
        }
      }

      // Also check paragraphs (e.g. numbered list of teachers)
      for (const p of parsed.paragraphs.filter(p => !parsed.tables.some(table => table.some(row => row.some(cell => cell.includes(p)))))) {
        if (/^\d+[\.\)]\s+([А-ЯІЇЄ][а-яіїє\']+\s+[А-ЯІЇЄ]\.?\s*[А-ЯІЇЄ]\.?|[А-ЯІЇЄ][а-яіїє\']+\s+[А-ЯІЇЄ][а-яіїє\']+\s+[А-ЯІЇЄ][а-яіїє\']+)/.test(p)) {
          totalStaff++;
          const pLower = p.toLowerCase();
          if (pLower.includes('штатн')) fullTime++;
          if (pLower.includes('докт.') || pLower.includes('д.т.н') || pLower.includes('доктор наук') || pLower.includes('професор')) doctors++;
          if (pLower.includes('канд.') || pLower.includes('к.т.н') || pLower.includes('к.ф.-м.н') || pLower.includes('філософії') || pLower.includes('phd') || pLower.includes('доцент')) candidates++;
        }
      }

      if (totalStaff > 0) metrics.set('Розділ 1. Кількісний та якісний склад професорсько-викладацьких кадрів — всього', totalStaff);
      if (fullTime > 0) metrics.set('Розділ 1. Кількісний та якісний склад професорсько-викладацьких кадрів — із них - штатних викладачів', fullTime);
      if (doctors > 0) metrics.set('Розділ 1. Кількісний та якісний склад професорсько-викладацьких кадрів — докт.н.', doctors);
      if (candidates > 0) metrics.set('Розділ 1. Кількісний та якісний склад професорсько-викладацьких кадрів — канд.н., доктор філософії', candidates);
      return metrics;
    }

    // Specialize for Додаток 3 (Publications list)
    if (/додаток[_ ](?:3|1)(?!\d)/i.test(lowerName) || parsed.fullText.includes('Список опублікованих монографій')) {
      let monographs = 0;
      let textbooks = 0;
      let manuals = 0;
      let scopusArticles = 0;
      let wosArticles = 0;
      let fakhoviArticles = 0;
      let theses = 0;
      let printedSheets = 0;
      const publicationSheets = new Map<string, number>();
      const addSheets = (label: string, sheets: number) => {
        const key = mapToOfficialKey(label, 3);
        if (key) publicationSheets.set(key + SHEETS_SUFFIX, (publicationSheets.get(key + SHEETS_SUFFIX) || 0) + sheets);
      };

      // 1. Parse tables
      for (const tbl of parsed.tables) {
        for (let r = 1; r < tbl.length; r++) {
          const row = tbl[r];
          if (row.length > 2 && /^[1-9]$/.test(row[0].trim()) && /^[1-9]$/.test(row[1].trim())) continue;
          if (!row[1] && !row[2]) continue;

          const rowText = row.join(' ').toLowerCase();
          if (row.slice(1).every(cell => !cell.trim() || /^(?:[-–—]|інформація відсутня|немає)$/i.test(cell.trim()))) continue;

          if (rowText.includes('монограф')) monographs++;
          else if (rowText.includes('підручник')) textbooks++;
          else if (rowText.includes('посібник')) manuals++;
          else if (rowText.includes('тези')) theses++;
          else fakhoviArticles++;

          if (rowText.includes('scopus')) scopusArticles++;
          if (rowText.includes('wos') || rowText.includes('web of science')) wosArticles++;

          const lastCell = row[row.length - 1];
          const sheetNum = this.parseNumber(lastCell);
          if (sheetNum > 0) {
            printedSheets += sheetNum;
            addSheets(rowText.includes('монограф') ? 'монографії' : rowText.includes('підручник') ? 'підручники' : rowText.includes('посібник') ? 'посібники' : rowText.includes('тези') ? 'тези доповідей' : 'статті із них у фахових виданнях', sheetNum);
            if (rowText.includes('scopus')) addSheets('статті в журналах Scopus', sheetNum);
            if (rowText.includes('wos') || rowText.includes('web of science')) addSheets('статті в журналах Web of Science', sheetNum);
          }
        }
      }

      // 2. Also parse numbered publication paragraphs (e.g., "1. Author ... // Journal ...")
      for (const p of parsed.paragraphs.filter(p => !parsed.tables.some(table => table.some(row => row.some(cell => cell.includes(p)))))) {
        const trimmed = p.trim();
        if (/^\d+[\.\)]\s+/.test(trimmed) && (trimmed.includes('//') || trimmed.includes('№') || trimmed.includes('Vol.') || trimmed.includes('С.') || trimmed.includes('P.') || /монограф/i.test(trimmed))) {
          const pLower = trimmed.toLowerCase();
          if (pLower.includes('монограф')) monographs++;
          else if (pLower.includes('підручник')) textbooks++;
          else if (pLower.includes('посібник')) manuals++;
          else if (pLower.includes('тези') || pLower.includes('конференц')) theses++;
          else fakhoviArticles++;

          if (pLower.includes('scopus')) scopusArticles++;
          if (pLower.includes('wos') || pLower.includes('web of science')) wosArticles++;

          const sheetMatch = trimmed.match(/(\d+(?:[.,]\d+)?)\s*др\.?\s*арк/i);
          if (sheetMatch) {
            const sheets = this.parseNumber(sheetMatch[1]);
            printedSheets += sheets;
            addSheets(pLower.includes('монограф') ? 'монографії' : pLower.includes('підручник') ? 'підручники' : pLower.includes('посібник') ? 'посібники' : pLower.includes('тези') || pLower.includes('конференц') ? 'тези доповідей' : 'статті із них у фахових виданнях', sheets);
            if (pLower.includes('scopus')) addSheets('статті в журналах Scopus', sheets);
            if (pLower.includes('wos') || pLower.includes('web of science')) addSheets('статті в журналах Web of Science', sheets);
          }
        }
      }

      if (monographs > 0) metrics.set('Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — монографії', monographs);
      if (textbooks > 0) metrics.set('Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — підручники', textbooks);
      if (manuals > 0) metrics.set('Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — посібники', manuals);
      if (scopusArticles > 0) metrics.set('Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — статті в журналах Scopus', scopusArticles);
      if (wosArticles > 0) metrics.set('Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — статті в журналах Web of Science', wosArticles);
      if (fakhoviArticles > 0) metrics.set('Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — статті із них у фахових виданнях', fakhoviArticles);
      if (theses > 0) metrics.set('Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — тези доповідей', theses);
      const totalKey = 'Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — всього:';
      metrics.set(totalKey, monographs + textbooks + manuals + fakhoviArticles + theses);
      metrics.set(totalKey + SHEETS_SUFFIX, printedSheets);
      const articlesKey = 'Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — статті в журналах: всього';
      metrics.set(articlesKey, fakhoviArticles);
      metrics.set(articlesKey + SHEETS_SUFFIX, publicationSheets.get(mapToOfficialKey('статті із них у фахових виданнях', 3)! + SHEETS_SUFFIX) || 0);
      for (const [key, value] of publicationSheets) metrics.set(key, value);

      return metrics;
    }

    // Specialize for Додаток 10 (Patents and licenses)
    if (lowerName.includes('додаток_10') || lowerName.includes('додаток 10')) {
      let count = 0;
      for (const tbl of parsed.tables) {
        for (let r = 1; r < tbl.length; r++) {
          const row = tbl[r];
          const rowText = row.join(' ').toLowerCase();
          if (row.filter((cell, index) => cell.trim() && !(index === 0 && /^\d+$/.test(cell.trim()))).every(cell => /^(?:[-–—]|інформація відсутня|відсутн[яіє]|немає)$/i.test(cell.trim()))) continue;
          if (row.some((c) => c.trim().length > 2)) count++;
        }
      }
      for (const p of parsed.paragraphs.filter(p => !parsed.tables.some(table => table.some(row => row.some(cell => cell.includes(p)))))) {
        const trimmed = p.trim();
        if (/^\d+[\.\)]\s+.*(патент|корисну модель|авторськ)/i.test(trimmed)) {
          count++;
        }
      }
      if (count > 0) {
        metrics.set('Розділ 10. Інформація про авторські свідоцтва, патенти, ліцензії, отримані в 2026 р. — вказати кількість', count);
      }
      return metrics;
    }

    // Specialize for Додаток 18 (Grants and international projects)
    if (lowerName.includes('додаток_18') || lowerName.includes('додаток 18')) {
      let count = 0;
      for (const tbl of parsed.tables) {
        for (let r = 1; r < tbl.length; r++) {
          const row = tbl[r];
          // Skip header row repeats or column index rows
          if (row.length > 2 && /^[1-9]$/.test(row[0].trim()) && /^[1-9]$/.test(row[1].trim())) continue;
          const rowText = row.join(' ').toLowerCase();
          if (rowText.includes('відсутн') || rowText.includes('немає') || rowText.includes('інформація відсутня')) continue;
          // Only count if row has substantive grant details
          if (row.some((c) => c.trim().length > 3 && !/^\d+$/.test(c.trim()))) count++;
        }
      }
      for (const p of parsed.paragraphs.filter(p => !parsed.tables.some(table => table.some(row => row.some(cell => cell.includes(p)))))) {
        const trimmed = p.trim();
        if (/^\d+[\.\)]\s+.*(грант|horizon|європа|проєкт|фонд)/i.test(trimmed)) {
          count++;
        }
      }
      if (count > 0) {
        metrics.set('Розділ 18. Кількість грантів від міжнародних фондів та міжнародних проєктів — кількість міжнародних проєктів з участю науковців', count);
      }
      return metrics;
    }

    let section: number | undefined;
    for (const table of parsed.tables) {
      for (const row of table) {
        if (!row.length) continue;
        const numbered = /^\d+$/.test(row[0].trim());
        const name = String(row[numbered ? 1 : 0] || '').trim();
        const detectedSection = sectionForLabel(name);
        if (detectedSection) { section = detectedSection; continue; }
        if (this.isNonIndicatorOrGarbage(name)) continue;
        const key = mapToOfficialKey(name, section) || name;
        const raw = row[numbered ? 2 : 1];
        const value = this.parseNumber(raw);
        if (value) metrics.set(key, (metrics.get(key) || 0) + value);
        if (raw?.includes('/')) metrics.set(key + SHEETS_SUFFIX, this.parseNumber(raw.split('/')[1]));
      }
    }

    // Generic paragraph text parsing: "Показник: 5" or "Scopus - 2"
    section = undefined;
    for (const line of parsed.paragraphs.filter(line => !parsed.tables.some(table => table.some(row => row.includes(line))))) {
      const detectedSection = sectionForLabel(line);
      if (detectedSection) { section = detectedSection; continue; }
      if (this.isNonIndicatorOrGarbage(line)) continue;

      const match = line.match(/^(.+)(?::|\t|\s[–—-]\s)\s*(.+)$/);
      if (match) {
        const ind = mapToOfficialKey(match[1].trim(), section) || match[1].trim();
        if (this.isNonIndicatorOrGarbage(ind)) continue;

        const raw = match[2].trim();
        const num = this.parseNumber(raw);
        if (num > 0) {
          const current = metrics.get(ind) || 0;
          metrics.set(ind, current + num);
          if (raw.includes('/')) metrics.set(ind + SHEETS_SUFFIX, this.parseNumber(raw.split('/')[1]));
        }
      }
    }

    return metrics;
  }

  /**
   * Extracts qualitative evidence (titles of papers, journals, patents, grants, students achievements)
   * from a teacher's report text or docx buffer to feed into Groq AI.
   */
  public static extractQualitativeEvidence(fullText: string, paragraphs: string[], filename: string): Partial<DigestedTeacherEvidence> {
    const evidence: Partial<DigestedTeacherEvidence> = {
      publications: [],
      patents: [],
      grants: [],
      studentsWork: [],
      rawNotes: [],
    };

    const lines = paragraphs.length > 0 ? paragraphs : fullText.split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.length < 5) continue;
      if (this.isNonIndicatorOrGarbage(line)) continue;

      const lower = line.toLowerCase();

      // Publications
      if (
        (line.includes('//') || lower.includes('scopus') || lower.includes('wos') || lower.includes('фахов') || lower.includes('монограф') || lower.includes('стаття') || lower.includes('тези')) &&
        !lower.startsWith('список') &&
        !lower.startsWith('додаток')
      ) {
        evidence.publications?.push(line.replace(/^\d+[\.\)]\s*/, ''));
      }
      // Patents
      else if (lower.includes('патент') || lower.includes('корисн') || lower.includes('авторськ')) {
        evidence.patents?.push(line.replace(/^\d+[\.\)]\s*/, ''));
      }
      // Grants & Projects
      else if (lower.includes('грант') || lower.includes('horizon') || lower.includes('європа') || lower.includes('нфду') || lower.includes('erasmus')) {
        evidence.grants?.push(line.replace(/^\d+[\.\)]\s*/, ''));
      }
      // Students
      else if (lower.includes('студент') || lower.includes('олімпіад') || lower.includes('керував') || lower.includes('конкурс')) {
        evidence.studentsWork?.push(line.replace(/^\d+[\.\)]\s*/, ''));
      }
    }

    return evidence;
  }
}
