import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

// Helper to clone a docx and inject custom text into word/document.xml
export function cloneDocxWithInjectedText(
  sourceDocxPath: string,
  targetDocxPath: string,
  injectedParagraphs: string[]
) {
  const zip = new AdmZip(sourceDocxPath);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) {
    throw new Error(`word/document.xml not found in ${sourceDocxPath}`);
  }

  let xml = zip.readAsText(entry);

  // Construct XML paragraphs
  const xmlParagraphs = injectedParagraphs
    .map(
      (text) =>
        `<w:p><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">${escapeXml(
          text
        )}</w:t></w:r></w:p>`
    )
    .join('');

  // Insert before </w:body>
  if (xml.includes('</w:body>')) {
    xml = xml.replace('</w:body>', `${xmlParagraphs}</w:body>`);
  }

  zip.updateFile('word/document.xml', Buffer.from(xml, 'utf-8'));
  fs.mkdirSync(path.dirname(targetDocxPath), { recursive: true });
  zip.writeZip(targetDocxPath);
}

// Minimal valid JPEG binary buffer
export function createSampleJpeg(width = 400, height = 300): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
    0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
    0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
    0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
    0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
    0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
    0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
    0x00, 0x7f, 0x00, 0xff, 0xd9,
  ]);
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function run() {
  const baseDir = path.resolve('test/docs');
  console.log(`Building ready-to-test manual documents in: ${baseDir}`);

  // 1. Teacher 1: Доц. Іваненко О.В. (High achiever with publications, patents, jpeg)
  const dir1 = path.join(baseDir, '01_Викладач_Іваненко_О_В');
  fs.mkdirSync(dir1, { recursive: true });

  cloneDocxWithInjectedText(
    path.resolve('templates/addons/Додаток_3.docx'),
    path.join(dir1, 'Додаток_3_Публікації_Іваненко.docx'),
    [
      'Виконавець: доцент Іваненко Олександр Васильович',
      '1. Ivanenko O., Petrenko V. Neural network optimization in edge computing // IEEE Access. 2026. Vol. 14. P. 110-120. (Scopus, WoS)',
      '2. Ivanenko O. Cloud-native microservices architecture // International Journal of Computer Science. 2026. Vol. 5. P. 45-56. (Scopus)',
      '3. Іваненко О.В., Сидоренко А.П. Інтелектуальні методи аналізу даних у вищій освіті // Науковий вісник Університету. 2026. № 2. С. 88-95. (Фахове видання категорії Б)',
      '4. Іваненко О.В. Практичні аспекти впровадження хмарних систем // Матеріали Міжнародної наук.-практ. конф. "ІТ-Технології 2026". Львів, 2026. С. 12-15.',
    ]
  );

  cloneDocxWithInjectedText(
    path.resolve('templates/addons/Додаток_10.docx'),
    path.join(dir1, 'Додаток_10_Патенти_Іваненко.docx'),
    [
      'Виконавець: доцент Іваненко Олександр Васильович',
      '1. Патент на корисну модель № 154321 "Спосіб адаптивного розподілу мережевого навантаження у хмарних сховищах". Дата видачі: 15.03.2026. Автори: Іваненко О.В., Ковальчук І.І.',
    ]
  );

  fs.writeFileSync(
    path.join(dir1, 'Сертифікат_конференції_Scopus_2026.jpeg'),
    createSampleJpeg()
  );

  // 2. Teacher 2: Проф. Петренко В.М. (Full Professor, grants, monographs, blank xlsx)
  const dir2 = path.join(baseDir, '02_Професор_Петренко_В_М');
  fs.mkdirSync(dir2, { recursive: true });

  cloneDocxWithInjectedText(
    path.resolve('templates/addons/Додаток_1.docx'),
    path.join(dir2, 'Додаток_1_Монографії_Петренко.docx'),
    [
      'Виконавець: професор Петренко Василь Миколайович',
      '1. Петренко В.М. Сучасні концепції кіберфізичних систем: монографія. Київ: Наукова думка, 2026. 380 с. (обсяг: 21.5 др. арк., частка автора: 14.2 др. арк.)',
    ]
  );

  cloneDocxWithInjectedText(
    path.resolve('templates/addons/Додаток_18.docx'),
    path.join(dir2, 'Додаток_18_Гранти_Петренко.docx'),
    [
      'Виконавець: професор Петренко Василь Миколайович',
      '1. Міжнародний грант Horizon Europe № 101089201 "Secure Distributed Artificial Intelligence for Smart Cities". Термін виконання: 2026-2028. Обсяг фінансування: 120 000 EUR.',
    ]
  );

  // Copy official blank xlsx for Petrenko
  fs.copyFileSync(
    path.resolve('templates/2_Інформ._про_наук.роб_(бланк)_2026.xlsx'),
    path.join(dir2, '2_Інформ._про_наук.роб_(заповнений_Петренко).xlsx')
  );

  fs.writeFileSync(
    path.join(dir2, 'Диплом_наукового_керівника_Петренко.jpeg'),
    createSampleJpeg()
  );

  // 3. Teacher 3: Доц. Сидоренко А.П. (Edge cases: dashes "-", "інформація відсутня", "0")
  const dir3 = path.join(baseDir, '03_Доцент_Сидоренко_А_П_нулі_та_прочерки');
  fs.mkdirSync(dir3, { recursive: true });

  cloneDocxWithInjectedText(
    path.resolve('templates/addons/Додаток_3.docx'),
    path.join(dir3, 'Додаток_3_Публікації_Сидоренко_прочерки.docx'),
    [
      'Виконавець: доцент Сидоренко Андрій Петрович',
      'Статті Scopus: -',
      'Статті Web of Science: інформація відсутня',
      'Монографії: немає',
      'Патенти: 0',
      'Фахові видання категорії Б: 1 (Сидоренко А.П. Методи оптимізації баз даних // Вісник НТУУ "КПІ". 2026. № 4. С. 33-39)',
    ]
  );

  cloneDocxWithInjectedText(
    path.resolve('templates/addons/Додаток_10.docx'),
    path.join(dir3, 'Додаток_10_Патенти_Сидоренко_відсутні.docx'),
    [
      'Виконавець: доцент Сидоренко Андрій Петрович',
      'Інформація відсутня. У 2026 році охоронних документів не отримувалось.',
    ]
  );

  // 4. Teacher 4: Асистент Ковальчук І.І. (Unstructured narrative report for Groq AI)
  const dir4 = path.join(baseDir, '04_Асистент_Ковальчук_І_І_текстовий_звіт_ШІ');
  fs.mkdirSync(dir4, { recursive: true });

  const kovalchukNarrative = `ЗВІТ ПРО НАУКОВО-ДОСЛІДНУ РОБОТУ ЗА 2026 РІК
Асистент кафедри: Ковальчук Ігор Іванович

За звітний 2026 календарний рік мною досягнуто такі наукові результати:
1. Опубліковано 2 статті у вітчизняних фахових виданнях категорії "Б":
   - Ковальчук І.І. Аналіз протоколів бездротового зв'язку для IoT // Наукові праці Донецького національного технічного університету. 2026. № 1(32). С. 112-119.
   - Ковальчук І.І., Іваненко О.В. Розробка мікросервісного шлюзу // Комп'ютерні системи та мережні технології. 2026. № 3. С. 45-52.
2. Взято участь та опубліковано тези у 3 міжнародних та всеукраїнських наукових конференціях:
   - "Сучасні комп'ютерні системи", Харків, 2026.
   - "Інформаційні технології та кібербезпека", Київ, 2026.
   - "Штучний інтелект у промисловості", Одеса, 2026.
3. Отримано 1 патент на корисну модель (у співавторстві з доц. Іваненком О.В.): № 154321 від 15.03.2026.
4. Керував науковою роботою 2 студентів, які зайняли 2 місце на внутрішньоуніверситетській олімпіаді з програмування.

Монографій, закордонних статей Scopus/WoS та грантів у цьому році немає (-).`;

  cloneDocxWithInjectedText(
    path.resolve('templates/addons/Додаток_28.docx'),
    path.join(dir4, 'Звіт_Ковальчук_наукова_робота_2026.docx'),
    kovalchukNarrative.split('\n')
  );

  fs.writeFileSync(
    path.join(dir4, 'Звіт_Ковальчук_наукова_робота_2026.txt'),
    kovalchukNarrative,
    'utf-8'
  );

  fs.writeFileSync(
    path.join(dir4, 'Фото_доповіді_на_семінарі.jpeg'),
    createSampleJpeg()
  );

  // 5. Static Department Plans (matching STATIC_PLAN_SHEET_ID and STATIC_SCI_PLAN_SHEET_ID)
  const dir5 = path.join(baseDir, '05_Статичні_плани_кафедри');
  fs.mkdirSync(dir5, { recursive: true });

  fs.copyFileSync(
    path.resolve('templates/2_Інформ._про_наук.роб_(бланк)_2026.xlsx'),
    path.join(dir5, 'План_роботи_кафедри_(статичний).xlsx')
  );

  fs.copyFileSync(
    path.resolve('templates/2_Інформ._про_наук.роб_(бланк)_2026.xlsx'),
    path.join(dir5, 'План_наукової_роботи_кафедри_(статичний).xlsx')
  );

  // 6. Ready-to-Upload Bundle for Classroom
  const dir6 = path.join(baseDir, '06_Зразки_для_Google_Classroom_швидке_завантаження');
  fs.mkdirSync(dir6, { recursive: true });

  fs.copyFileSync(
    path.join(dir1, 'Додаток_3_Публікації_Іваненко.docx'),
    path.join(dir6, 'Іваненко_Додаток_3_Публікації.docx')
  );
  fs.copyFileSync(
    path.join(dir1, 'Сертифікат_конференції_Scopus_2026.jpeg'),
    path.join(dir6, 'Іваненко_Сертифікат_Scopus.jpeg')
  );
  fs.copyFileSync(
    path.join(dir2, 'Додаток_18_Гранти_Петренко.docx'),
    path.join(dir6, 'Петренко_Додаток_18_Гранти.docx')
  );
  fs.copyFileSync(
    path.join(dir2, 'Диплом_наукового_керівника_Петренко.jpeg'),
    path.join(dir6, 'Петренко_Диплом.jpeg')
  );
  fs.copyFileSync(
    path.join(dir3, 'Додаток_3_Публікації_Сидоренко_прочерки.docx'),
    path.join(dir6, 'Сидоренко_Додаток_3_прочерки_та_нулі.docx')
  );
  fs.copyFileSync(
    path.join(dir4, 'Звіт_Ковальчук_наукова_робота_2026.docx'),
    path.join(dir6, 'Ковальчук_Звіт_для_ШІ.docx')
  );

  // 7. Create Documentation README.md
  const readmeContent = `# Тестові документи для ручного та автоматичного тестування кафедральної системи

Ця папка містить комплект готових документів різних форматів (\`.docx\`, \`.xlsx\`, \`.jpeg\`, \`.txt\`), сформованих відповідно до вимог офіційних бланкових додатків МОН/Університету та вимог технічного завдання \`AGENTS.md\`.

---

## 📁 Структура тестових матеріалів

### 1. \`01_Викладач_Іваненко_О_В/\`
* **Сценарій:** Викладач із високою активністю (публікації Scopus/WoS, фахові статті, патент, фотосертифікат).
* **Файли:**
  - \`Додаток_3_Публікації_Іваненко.docx\`: містить 2 статті Scopus/WoS, 1 фахову статтю категорії Б, 1 тези конференції.
  - \`Додаток_10_Патенти_Іваненко.docx\`: містить зареєстрований патент на корисну модель.
  - \`Сертифікат_конференції_Scopus_2026.jpeg\`: валідний JPEG-файл для тестування передачі фотозвітів до наукового відділу (\`SCI_DEPT_EMAIL\`).

### 2. \`02_Професор_Петренко_В_М/\`
* **Сценарій:** Професор кафедри (монографія, міжнародний грант Horizon Europe, заповнений Excel-бланк, диплом).
* **Файли:**
  - \`Додаток_1_Монографії_Петренко.docx\`: монографія з розрахунком авторських аркушів (14.2 др. арк.).
  - \`Додаток_18_Гранти_Петренко.docx\`: міжнародний науковий проєкт Horizon Europe.
  - \`2_Інформ._про_наук.роб_(заповнений_Петренко).xlsx\`: таблична форма за 28 офіційними розділами.
  - \`Диплом_наукового_керівника_Петренко.jpeg\`: валідне графічне підтвердження.

### 3. \`03_Доцент_Сидоренко_А_П_нулі_та_прочерки/\`
* **Сценарій:** Перевірка обов'язкового правила ТЗ (прочерки \`-\` та рядок \`"інформація відсутня"\` повинні зараховуватись як \`0\`).
* **Файли:**
  - \`Додаток_3_Публікації_Сидоренко_прочерки.docx\`: містить дефіси, ен-деші, написи "інформація відсутня", "немає", "0" та 1 фахову статтю.
  - \`Додаток_10_Патенти_Сидоренко_відсутні.docx\`: повна відсутність охоронних документів ("інформація відсутня").

### 4. \`04_Асистент_Ковальчук_І_І_текстовий_звіт_ШІ/\`
* **Сценарій:** Неструктурований звіт довільної форми для тестування екстракції метрик нейромережею Groq AI (\`qwen/qwen3.8-27b\`).
* **Файли:**
  - \`Звіт_Ковальчук_наукова_робота_2026.docx\` та \`Звіт_Ковальчук_наукова_робота_2026.txt\`: текстовий опис досягнень (2 статті категорії Б, 3 тези конференцій, 1 патент, керівництво олімпіадою).
  - \`Фото_доповіді_на_семінарі.jpeg\`: доданий графічний файл доповіді.

### 5. \`05_Статичні_плани_кафедри/\`
* **Сценарій:** Файли-зразки для імітації статичних Google Таблиць кафедри:
  - \`План_роботи_кафедри_(статичний).xlsx\` (відповідає \`STATIC_PLAN_SHEET_ID\`).
  - \`План_наукової_роботи_кафедри_(статичний).xlsx\` (відповідає \`STATIC_SCI_PLAN_SHEET_ID\`).
  - За правилами ТЗ рядки з цих планів переносяться в підсумковий звіт "як є" (as-is).

### 6. \`06_Зразки_для_Google_Classroom_швидке_завантаження/\`
* Зручна єдина папка, звідки можна швидко перетягнути (drag-and-drop) тестові файли для викладачів у Google Classroom при тестуванні в реальному курсі:
  - \`Іваненко_Додаток_3_Публікації.docx\`
  - \`Іваненко_Сертифікат_Scopus.jpeg\`
  - \`Петренко_Додаток_18_Гранти.docx\`
  - \`Петренко_Диплом.jpeg\`
  - \`Сидоренко_Додаток_3_прочерки_та_нулі.docx\`
  - \`Ковальчук_Звіт_для_ШІ.docx\`

---

## 🚀 Як тестувати вручну через CLI

1. **Повний локальний симуляційний прогін (без завантаження у хмару):**
   \`\`\`bash
   npm run dry-run
   \`\`\`

2. **Запуск тестового набору парсера офіційних додатків:**
   \`\`\`bash
   npm run test:parser
   \`\`\`

3. **Запуск тесту Groq AI з генерацією резюме:**
   \`\`\`bash
   npm run test:ai
   \`\`\`

4. **Запуск усіх автоматизованих тестів:**
   \`\`\`bash
   npm test
   \`\`\`
`;

  fs.writeFileSync(path.join(baseDir, 'README.md'), readmeContent, 'utf-8');
  console.log(`✅ Successfully generated test documents in: ${baseDir}`);
}

run().catch((err) => {
  console.error('Failed to prepare test docs:', err);
  process.exit(1);
});
