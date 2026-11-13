import AdmZip from 'adm-zip';

export interface ParsedDocxResult {
  paragraphs: string[];
  tables: string[][][]; // table -> row -> cells
  fullText: string;
}

export class DocParserService {
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
    if (typeof val === 'number') return isNaN(val) ? 0 : val;

    let str = String(val).trim();
    if (!str) return 0;

    // Check dashes (hyphen, en-dash, em-dash, minus, horizontal bar)
    if (str === '-' || str === '–' || str === '—' || str === '−' || str === '―') {
      return 0;
    }

    // Normalize homoglyphs for Ukrainian/Russian/English (e.g. English 'i' vs Ukrainian 'і', 'o', 'a', 'e')
    const normalized = str
      .toLowerCase()
      .replace(/[\u0456\u0457\u0406\u0407]/g, 'i') // Cyrillic і, ї -> i
      .replace(/[\u0430\u0410]/g, 'a')             // Cyrillic а -> a
      .replace(/[\u043E\u041E]/g, 'o')             // Cyrillic о -> o
      .replace(/[\u0435\u0415]/g, 'e');            // Cyrillic е -> e

    // Check absence phrases
    if (
      normalized.includes('informatsi') || // інформація
      normalized.includes('vidsutn') ||    // відсутня / відсутнє / відсутні
      normalized.includes('nemae') ||      // немає
      normalized.includes('n/d') ||
      normalized.includes('n/a') ||
      normalized.includes('none') ||
      normalized.includes('nil') ||
      normalized.includes('brak') ||
      normalized === '0'
    ) {
      return 0;
    }

    // Handle compound format like "3 / 12.5" (count / printed sheets) -> take first number as count
    const slashMatch = str.match(/^(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)$/);
    if (slashMatch) {
      const firstNum = parseFloat(slashMatch[1].replace(/,/g, '.'));
      return isNaN(firstNum) ? 0 : firstNum;
    }

    // Clean thousand separators (spaces, non-breaking spaces, narrow NBSP) and convert commas to dots
    const cleaned = str
      .replace(/[\s\u00A0\u202F]/g, '')
      .replace(/,/g, '.');

    if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? 0 : parsed;
    }

    return 0;
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

      const xml = xmlEntry.getData().toString('utf8');

      // 1. Extract paragraphs
      const paragraphs: string[] = [];
      const pRegex = /<w:p(?:[\s>][\s\S]*?<\/w:p>|\/>)/g;
      let pMatch: RegExpExecArray | null;

      while ((pMatch = pRegex.exec(xml)) !== null) {
        const pXml = pMatch[0];
        const tMatches = pXml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
        const text = tMatches.map((t) => t.replace(/<[^>]+>/g, '')).join('').trim();
        if (text) {
          paragraphs.push(text);
        }
      }

      // 2. Extract tables
      const tables: string[][][] = [];
      const tblRegex = /<w:tbl[\s\S]*?<\/w:tbl>/g;
      let tblMatch: RegExpExecArray | null;

      while ((tblMatch = tblRegex.exec(xml)) !== null) {
        const tblXml = tblMatch[0];
        const rows: string[][] = [];
        const trRegex = /<w:tr[\s\S]*?<\/w:tr>/g;
        let trMatch: RegExpExecArray | null;

        while ((trMatch = trRegex.exec(tblXml)) !== null) {
          const trXml = trMatch[0];
          const cells: string[] = [];
          const tcRegex = /<w:tc[\s\S]*?<\/w:tc>/g;
          let tcMatch: RegExpExecArray | null;

          while ((tcMatch = tcRegex.exec(trXml)) !== null) {
            const tcXml = tcMatch[0];
            const tMatches = tcXml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
            const cellText = tMatches.map((t) => t.replace(/<[^>]+>/g, '')).join(' ').trim();
            cells.push(cellText);
          }
          if (cells.some((c) => c !== '')) {
            rows.push(cells);
          }
        }
        if (rows.length > 0) {
          tables.push(rows);
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
        const ssXml = ssEntry.getData().toString('utf8');
        const siRegex = /<si[\s\S]*?<\/si>/g;
        let m: RegExpExecArray | null;
        while ((m = siRegex.exec(ssXml)) !== null) {
          const tMatches = m[0].match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
          const text = tMatches.map((t) => t.replace(/<[^>]+>/g, '')).join('');
          sharedStrings.push(text);
        }
      }

      // 2. Worksheet 1
      const sheetEntry = zip.getEntry('xl/worksheets/sheet1.xml');
      if (!sheetEntry) return [];

      const sheetXml = sheetEntry.getData().toString('utf8');
      const grid: string[][] = [];

      const rowRegex = /<row[\s\S]*?<\/row>/g;
      let rowMatch: RegExpExecArray | null;

      while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
        const rowXml = rowMatch[0];
        const rowCells: string[] = [];
        const cRegex = /<c[\s\S]*?<\/c>/g;
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
            val = isMatch ? isMatch[1] : '';
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

        if (rowCells.some((c) => c !== '')) {
          grid.push(rowCells);
        }
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
    if (lowerName.includes('додаток_1.') || lowerName.includes('додаток 1.') || parsed.fullText.includes('Список професорсько-викладацького складу')) {
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

      if (totalStaff > 0) metrics.set('Розділ 1. Кількісний та якісний склад професорсько-викладацьких кадрів — всього', totalStaff);
      if (fullTime > 0) metrics.set('Розділ 1. Кількісний та якісний склад професорсько-викладацьких кадрів — із них - штатних викладачів', fullTime);
      if (doctors > 0) metrics.set('Розділ 1. Кількісний та якісний склад професорсько-викладацьких кадрів — докт.н.', doctors);
      if (candidates > 0) metrics.set('Розділ 1. Кількісний та якісний склад професорсько-викладацьких кадрів — канд.н., доктор філософії', candidates);
      return metrics;
    }

    // Specialize for Додаток 3 (Publications list)
    if (lowerName.includes('додаток_3') || lowerName.includes('додаток 3') || parsed.fullText.includes('Список опублікованих монографій')) {
      let monographs = 0;
      let textbooks = 0;
      let manuals = 0;
      let scopusArticles = 0;
      let wosArticles = 0;
      let fakhoviArticles = 0;
      let theses = 0;
      let printedSheets = 0;

      for (const tbl of parsed.tables) {
        for (let r = 1; r < tbl.length; r++) {
          const row = tbl[r];
          if (row.length > 2 && /^[1-9]$/.test(row[0].trim()) && /^[1-9]$/.test(row[1].trim())) continue;
          if (!row[1] && !row[2]) continue;

          const rowText = row.join(' ').toLowerCase();

          if (rowText.includes('монограф')) monographs++;
          else if (rowText.includes('підручник')) textbooks++;
          else if (rowText.includes('посібник')) manuals++;
          else if (rowText.includes('тези')) theses++;
          else fakhoviArticles++;

          if (rowText.includes('scopus')) scopusArticles++;
          if (rowText.includes('wos') || rowText.includes('web of science')) wosArticles++;

          const lastCell = row[row.length - 1];
          const sheetNum = this.parseNumber(lastCell);
          if (sheetNum > 0) printedSheets += sheetNum;
        }
      }

      if (monographs > 0) metrics.set('Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — монографії', monographs);
      if (textbooks > 0) metrics.set('Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — підручники', textbooks);
      if (manuals > 0) metrics.set('Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — посібники', manuals);
      if (scopusArticles > 0) metrics.set('Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — статті в журналах Scopus', scopusArticles);
      if (wosArticles > 0) metrics.set('Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — статті в журналах Web of Science', wosArticles);
      if (fakhoviArticles > 0) metrics.set('Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — статті із них у фахових виданнях', fakhoviArticles);
      if (theses > 0) metrics.set('Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — тези доповідей', theses);
      if (printedSheets > 0) metrics.set('Розділ 3. Публікації — др. аркуші (всього)', printedSheets);

      return metrics;
    }

    // Specialize for Додаток 10 (Patents and licenses)
    if (lowerName.includes('додаток_10') || lowerName.includes('додаток 10') || parsed.fullText.includes('авторські свідоцтва, патенти')) {
      let count = 0;
      for (const tbl of parsed.tables) {
        for (let r = 1; r < tbl.length; r++) {
          const row = tbl[r];
          if (row.some((c) => c.trim().length > 2)) count++;
        }
      }
      metrics.set('Розділ 10. Інформація про авторські свідоцтва, патенти, ліцензії, отримані в 2026 р. — вказати кількість', count);
      return metrics;
    }

    // Specialize for Додаток 18 (Grants and international projects)
    if (lowerName.includes('додаток_18') || lowerName.includes('додаток 18') || parsed.fullText.includes('Гранти, отримані від міжнародних фондів')) {
      let count = 0;
      for (const tbl of parsed.tables) {
        for (let r = 1; r < tbl.length; r++) {
          const row = tbl[r];
          if (row.some((c) => c.trim().length > 2)) count++;
        }
      }
      metrics.set('Розділ 18. Кількість грантів від міжнародних фондів та міжнародних проєктів — кількість міжнародних проєктів з участю науковців', count);
      return metrics;
    }

    // Generic table parsing: Indicator Name in col 0, value in col 1+
    for (const tbl of parsed.tables) {
      for (const row of tbl) {
        if (!row || row.length < 2) continue;
        const indName = row[0].trim();
        if (!indName || /^(№|показник|п\/п|номер)/i.test(indName)) continue;

        for (let c = 1; c < row.length; c++) {
          const val = row[c];
          if (val !== undefined && val !== null && val.trim() !== '') {
            const num = this.parseNumber(val);
            const current = metrics.get(indName) || 0;
            metrics.set(indName, current + num);
            break;
          }
        }
      }
    }

    // Generic paragraph text parsing: "Показник: 5" or "Scopus - 2"
    for (const line of parsed.paragraphs) {
      const match = line.match(/^([^:\-\t–]+)[:\t–\-]\s*(.+)$/);
      if (match) {
        const ind = match[1].trim();
        const raw = match[2].trim();
        const num = this.parseNumber(raw);
        const current = metrics.get(ind) || 0;
        metrics.set(ind, current + num);
      }
    }

    return metrics;
  }
}
