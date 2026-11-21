/**
 * Exact 1-to-1 Blueprint of official blank templates/2_Інформ._про_наук.роб_(бланк)_2026.xlsx
 * Total 129 rows (Row 2 to Row 132), preserving all labels, formatting and cell references.
 */

export interface OfficialRowBlueprint {
  row: number;
  colA: string;
  colB: string;
  defaultColC: string;
  isHeader?: boolean;
  isSectionTitle?: boolean;
  isNotice?: boolean;
  indicatorKey?: string;
  format?: '/' | 'number';
}

export const OFFICIAL_TEMPLATE_ROWS: OfficialRowBlueprint[] = [
  { row: 2, colA: "", colB: "ІНФОРМАЦІЯ", defaultColC: "", isHeader: true },
  { row: 3, colA: "", colB: "про науково-дослідну роботу за 2026 рік", defaultColC: "", isHeader: true },
  { row: 4, colA: "", colB: "кафедри_____________________________________________________", defaultColC: "", isHeader: true },
  { row: 6, colA: "", colB: "Вказати інформацію (ОБОВ’ЯЗКОВО!!!):", defaultColC: "", isHeader: true },
  { row: 7, colA: "", colB: "кафедральна електронна адреса (або адреса, на яку можна надсилати інформацію для кафедри)", defaultColC: "", isHeader: true },
  { row: 8, colA: "", colB: "П.І.Б. лаборанта кафедри", defaultColC: "", isHeader: true },
  { row: 9, colA: "", colB: "Мобільний телефон лаборанта", defaultColC: "", isHeader: true },
  { row: 10, colA: "", colB: "Стаціонарний телефон кафедри", defaultColC: "", isHeader: true },
  { row: 12, colA: "1", colB: "Кількісний  та  якісний  склад  професорсько-викладацьких  кадрів:", defaultColC: "", isSectionTitle: true },
  { row: 13, colA: "", colB: "всього", defaultColC: "", indicatorKey: "Розділ 1. Кількісний та якісний склад професорсько-викладацьких кадрів — всього", format: 'number' },
  { row: 14, colA: "", colB: "із них - штатних викладачів", defaultColC: "", indicatorKey: "Розділ 1. Кількісний та якісний склад професорсько-викладацьких кадрів — із них - штатних викладачів", format: 'number' },
  { row: 15, colA: "", colB: "докт.н.", defaultColC: "", indicatorKey: "Розділ 1. Кількісний та якісний склад професорсько-викладацьких кадрів — докт.н.", format: 'number' },
  { row: 16, colA: "", colB: "канд.н., доктор філософії", defaultColC: "", indicatorKey: "Розділ 1. Кількісний та якісний склад професорсько-викладацьких кадрів — канд.н., доктор філософії", format: 'number' },
  { row: 17, colA: "", colB: "Додаток 1.", defaultColC: "", isNotice: true },
  { row: 18, colA: "2", colB: "Подати заявки до аспірантури та докторантури на 2027 р. (затверджені засіданням кафедри)", defaultColC: "", isSectionTitle: true },
  { row: 19, colA: "", colB: "вказати кількість", defaultColC: "", indicatorKey: "Розділ 2. Подати заявки до аспірантури та докторантури на 2027 р. — вказати кількість", format: 'number' },
  { row: 20, colA: "", colB: "Додаток 2.", defaultColC: "", isNotice: true },
  { row: 21, colA: "3", colB: "Публікації (до кожного пункту зазначити к-сть публікацій / к-сть др. аркушів.)", defaultColC: "", isSectionTitle: true },
  { row: 22, colA: "", colB: "(один друкований аркуш=40 000 знаків із пробілами або 24 ст. А4 через півтора інтервали 14-м кеглем)", defaultColC: "" },
  { row: 23, colA: "", colB: "всього:", defaultColC: "/", indicatorKey: "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — всього:", format: '/' },
  { row: 24, colA: "", colB: "монографії", defaultColC: "/", indicatorKey: "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — монографії", format: '/' },
  { row: 25, colA: "", colB: "підручники", defaultColC: "/", indicatorKey: "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — підручники", format: '/' },
  { row: 26, colA: "", colB: "посібники", defaultColC: "/", indicatorKey: "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — посібники", format: '/' },
  { row: 27, colA: "", colB: "словники", defaultColC: "/", indicatorKey: "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — словники", format: '/' },
  { row: 28, colA: "", colB: "довідники", defaultColC: "/", indicatorKey: "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — довідники", format: '/' },
  { row: 29, colA: "", colB: "збірники законодавства", defaultColC: "/", indicatorKey: "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — збірники законодавства", format: '/' },
  { row: 30, colA: "", colB: "збірники наукових праць", defaultColC: "/", indicatorKey: "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — збірники наукових праць", format: '/' },
  { row: 31, colA: "", colB: "із них фахові", defaultColC: "/", indicatorKey: "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — із них фахові", format: '/' },
  { row: 32, colA: "", colB: "методичні розробки", defaultColC: "/", indicatorKey: "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — методичні розробки", format: '/' },
  { row: 33, colA: "", colB: "статті в  журналах  та  наукових  збірниках:", defaultColC: "" },
  { row: 34, colA: "", colB: "всього:", defaultColC: "/", indicatorKey: "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — статті в журналах: всього", format: '/' },
  { row: 35, colA: "", colB: "що входять до наукометричної бази даних Scopus", defaultColC: "/", indicatorKey: "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — статті в журналах Scopus", format: '/' },
  { row: 36, colA: "", colB: "що входять до наукометричної бази даних Web of Science", defaultColC: "/", indicatorKey: "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — статті в журналах Web of Science", format: '/' },
  { row: 37, colA: "", colB: "закордонні", defaultColC: "/", indicatorKey: "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — статті в журналах закордонні", format: '/' },
  { row: 38, colA: "", colB: "що входять до наукометричної бази даних Index Copernicus (у т.ч. вітчизняні)", defaultColC: "/", indicatorKey: "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — статті в журналах Index Copernicus", format: '/' },
  { row: 39, colA: "", colB: "українських наукових виданнях", defaultColC: "/", indicatorKey: "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — статті в українських наукових виданнях", format: '/' },
  { row: 40, colA: "", colB: "із них у фахових виданнях", defaultColC: "/", indicatorKey: "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — статті із них у фахових виданнях", format: '/' },
  { row: 41, colA: "", colB: "тези доповідей", defaultColC: "/", indicatorKey: "Розділ 3. Публікації (к-сть публікацій / к-сть др. аркушів) — тези доповідей", format: '/' },
  { row: 42, colA: "", colB: "Додаток 3.", defaultColC: "", isNotice: true },
  { row: 43, colA: "4", colB: "Опубліковані FAIR-дані (вказати кількість)", defaultColC: "", isSectionTitle: true },
  { row: 44, colA: "", colB: "Додаток 4.", defaultColC: "", isNotice: true },
  { row: 45, colA: "", colB: "вказати кількість", defaultColC: "", indicatorKey: "Розділ 4. Опубліковані FAIR-дані — вказати кількість", format: 'number' },
  { row: 46, colA: "5", colB: "Опубліковані препринти, які мають DOI", defaultColC: "", isSectionTitle: true },
  { row: 47, colA: "", colB: "Додаток 5.", defaultColC: "", isNotice: true },
  { row: 48, colA: "", colB: "вказати кількість", defaultColC: "", indicatorKey: "Розділ 5. Опубліковані препринти, які мають DOI — вказати кількість", format: 'number' },
  { row: 49, colA: "6", colB: "Подати список членів кафедри, які мають публікації в наукометричній базі даних Scopus                                 Додаток 6.", defaultColC: "", isSectionTitle: true },
  { row: 50, colA: "", colB: "вказати кількість", defaultColC: "", indicatorKey: "Розділ 6. Список членів кафедри, які мають публікації в базі даних Scopus — вказати кількість", format: 'number' },
  { row: 51, colA: "7", colB: "Подати список членів кафедри, які мають публікації в наукометричній базі даних Web of Science Core Collection (WoS)                                                                                     Додаток 7.", defaultColC: "", isSectionTitle: true },
  { row: 52, colA: "", colB: "вказати кількість", defaultColC: "", indicatorKey: "Розділ 7. Список членів кафедри, які мають публікації в базі даних Web of Science (WoS) — вказати кількість", format: 'number' },
  { row: 53, colA: "8", colB: "Подати список усіх членів кафедри згідно з базою даних Google Scholar (обов’язково підвантажити всі публікації за останні роки)                                                                             Додаток 8.", defaultColC: "", isSectionTitle: true },
  { row: 54, colA: "", colB: "вказати кількість", defaultColC: "", indicatorKey: "Розділ 8. Список членів кафедри згідно з базою даних Google Scholar — вказати кількість", format: 'number' },
  { row: 55, colA: "9", colB: "Подати список усіх членів кафедри згідно з базою даних ORCID (обов’язково підвантажити всі публікації за останні роки)                                                                                  Додаток 9.", defaultColC: "", isSectionTitle: true },
  { row: 56, colA: "", colB: "вказати кількість", defaultColC: "", indicatorKey: "Розділ 9. Список членів кафедри згідно з базою даних ORCID — вказати кількість", format: 'number' },
  { row: 57, colA: "10", colB: "Інформація про авторські свідоцтва, патенти, ліцензії, отримані в 2026 р.                                                           Додаток 10.", defaultColC: "", isSectionTitle: true },
  { row: 58, colA: "", colB: "вказати кількість", defaultColC: "", indicatorKey: "Розділ 10. Інформація про авторські свідоцтва, патенти, ліцензії, отримані в 2026 р. — вказати кількість", format: 'number' },
  { row: 59, colA: "11", colB: "Інформація про науково-технічні (експериментальні) розробки, які впроваджено в 2026 р. за межами Черкаського національного університету імені Богдана Хмельницького                                                                       Додаток 11.", defaultColC: "", isSectionTitle: true },
  { row: 60, colA: "", colB: "вказати кількість", defaultColC: "", indicatorKey: "Розділ 11. Науково-технічні (експериментальні) розробки, впроваджені за межами університету — вказати кількість", format: 'number' },
  { row: 61, colA: "12", colB: "Науково-дослідна робота студентів:", defaultColC: "", isSectionTitle: true },
  { row: 62, colA: "", colB: "чисельність студентів, які беруть участь у НДР", defaultColC: "", indicatorKey: "Розділ 12. Науково-дослідна робота студентів — чисельність студентів, які беруть участь у НДР", format: 'number' },
  { row: 63, colA: "", colB: "кількість наукових публікацій (статей, тез доповідей), опублікованих студентами:", defaultColC: "" },
  { row: 64, colA: "", colB: "самостійно", defaultColC: "", indicatorKey: "Розділ 12. Науково-дослідна робота студентів — публікації студентів самостійно", format: 'number' },
  { row: 65, colA: "", colB: "у співавторстві з викладачем", defaultColC: "", indicatorKey: "Розділ 12. Науково-дослідна робота студентів — публікації студентів у співавторстві з викладачем", format: 'number' },
  { row: 66, colA: "", colB: "чисельність студентів-учасників  у всеукраїнських конкурсах, турнірах", defaultColC: "" },
  { row: 67, colA: "", colB: "чисельність студентів-переможців у всеукраїнських конкурсах, турнірах", defaultColC: "", indicatorKey: "Розділ 12. Науково-дослідна робота студентів — студенти-учасники всеукраїнських конкурсів, турнірів", format: 'number' },
  { row: 68, colA: "", colB: "Додаток 12.1.", defaultColC: "", isNotice: true, indicatorKey: "Розділ 12. Науково-дослідна робота студентів — студенти-переможці всеукраїнських конкурсів, турнірів", format: 'number' },
  { row: 69, colA: "", colB: "Додаток 12.2.", defaultColC: "", isNotice: true },
  { row: 70, colA: "13", colB: "Проведені кафедрою наукові заходи:", defaultColC: "", isSectionTitle: true },
  { row: 71, colA: "", colB: "міжнародні конференції", defaultColC: "", indicatorKey: "Розділ 13. Проведені кафедрою наукові заходи — міжнародні конференції", format: 'number' },
  { row: 72, colA: "", colB: "всеукраїнські конференції", defaultColC: "", indicatorKey: "Розділ 13. Проведені кафедрою наукові заходи — всеукраїнські конференції", format: 'number' },
  { row: 73, colA: "", colB: "наукові семінари", defaultColC: "" },
  { row: 74, colA: "", colB: "наукові круглі столи", defaultColC: "", indicatorKey: "Розділ 13. Проведені кафедрою наукові заходи — наукові семінари", format: 'number' },
  { row: 75, colA: "", colB: "Обов’язково здати звіти про проведені конференції!", defaultColC: "", indicatorKey: "Розділ 13. Проведені кафедрою наукові заходи — наукові круглі столи", format: 'number' },
  { row: 76, colA: "", colB: "Додаток 13. План конференцій на 2027 р.", defaultColC: "" },
  { row: 77, colA: "14", colB: "План НДР на 2027 р.", defaultColC: "", isSectionTitle: true },
  { row: 78, colA: "", colB: "Додаток 14.", defaultColC: "", isNotice: true, indicatorKey: "Розділ 14. План НДР на 2027 р. — план НДР", format: 'number' },
  { row: 79, colA: "15", colB: "Подати  інформацію за 2026 р. про:", defaultColC: "", isSectionTitle: true },
  { row: 80, colA: "", colB: "15.1. наукові результати, отримані в межах роботи над зареєстрованими кафедральними темами", defaultColC: "", indicatorKey: "Розділ 15. Наукові результати кафедральних тем, підрозділів та спецрад — наукові результати за зареєстрованими кафедральними темами", format: 'number' },
  { row: 81, colA: "", colB: "(звіт про виконання проміжного етапу досліджень           (Додаток 15.1.) чи звіт за завершеною кафедральною темою. Анотований звіт за завершеною кафедральною темою подається до УкрІНТЕІ (м. Київ), попередньо отримавши схвалення начальника НДЧ. До Анотованого звіту за завершеною кафедральною темою додається ОК, роздрукована із системи НДДКР.", defaultColC: "" },
  { row: 82, colA: "", colB: "15.2. роботу у звітному періоді наукових підрозділів (науково-дослідних інститутів, лабораторій тощо)                        Додаток 15.2. (Звіт буде прийнято тільки у разі дотримання плану)", defaultColC: "", indicatorKey: "Розділ 15. Наукові результати кафедральних тем, підрозділів та спецрад — робота наукових підрозділів (лабораторій, центрів)", format: 'number' },
  { row: 83, colA: "", colB: "15.3. діяльність спеціалізованих учених рад за 2026 р. Додаток 15.3.", defaultColC: "", indicatorKey: "Розділ 15. Наукові результати кафедральних тем, підрозділів та спецрад — діяльність спеціалізованих учених рад", format: 'number' },
  { row: 84, colA: "16", colB: "Кількість виїздів (онлайн участі) науково-педагогічних працівників за межі України", defaultColC: "", isSectionTitle: true },
  { row: 85, colA: "", colB: "всього", defaultColC: "", indicatorKey: "Розділ 16. Кількість виїздів (онлайн участі) НПП за межі України — всього", format: 'number' },
  { row: 86, colA: "", colB: "із метою:", defaultColC: "" },
  { row: 87, colA: "", colB: "стажування", defaultColC: "" },
  { row: 88, colA: "", colB: "до 1 тижня", defaultColC: "", indicatorKey: "Розділ 16. Кількість виїздів (онлайн участі) НПП за межі України — стажування до 1 тижня", format: 'number' },
  { row: 89, colA: "", colB: "2-4 тижні", defaultColC: "", indicatorKey: "Розділ 16. Кількість виїздів (онлайн участі) НПП за межі України — стажування 2-4 тижні", format: 'number' },
  { row: 90, colA: "", colB: "1-2 місяці", defaultColC: "", indicatorKey: "Розділ 16. Кількість виїздів (онлайн участі) НПП за межі України — стажування 1-2 місяці", format: 'number' },
  { row: 91, colA: "", colB: "не менше трьох місяців", defaultColC: "", indicatorKey: "Розділ 16. Кількість виїздів (онлайн участі) НПП за межі України — стажування не менше 3 місяців", format: 'number' },
  { row: 92, colA: "", colB: "навчання (не менше трьох місяців)", defaultColC: "", indicatorKey: "Розділ 16. Кількість виїздів (онлайн участі) НПП за межі України — навчання", format: 'number' },
  { row: 93, colA: "", colB: "підвищення кваліфікації", defaultColC: "", indicatorKey: "Розділ 16. Кількість виїздів (онлайн участі) НПП за межі України — підвищення кваліфікації", format: 'number' },
  { row: 94, colA: "", colB: "викладацької роботи", defaultColC: "", indicatorKey: "Розділ 16. Кількість виїздів (онлайн участі) НПП за межі України — викладацька робота", format: 'number' },
  { row: 95, colA: "", colB: "проведення наукових досліджень", defaultColC: "", indicatorKey: "Розділ 16. Кількість виїздів (онлайн участі) НПП за межі України — проведення наукових досліджень", format: 'number' },
  { row: 96, colA: "", colB: "участі в міжнародних семінарах, конференціях тощо", defaultColC: "", indicatorKey: "Розділ 16. Кількість виїздів (онлайн участі) НПП за межі України — участь у міжнародних семінарах, конференціях", format: 'number' },
  { row: 97, colA: "", colB: "Додаток 16.", defaultColC: "", isNotice: true },
  { row: 98, colA: "17", colB: "Залучення іноземних науковців, викладачів і волонтерів до освітньої та наукової діяльності університету (кількість осіб і проведених гостьових лекцій)                                                                          Додаток 17.", defaultColC: "", isSectionTitle: true, indicatorKey: "Розділ 17. Залучення іноземних науковців, викладачів і волонтерів — кількість осіб і проведених гостьових лекцій", format: 'number' },
  { row: 99, colA: "18", colB: "Кількість  грантів, отриманих від міжнародних фондів, та кількість міжнародних проектів у яких беруть участь науковці:", defaultColC: "", isSectionTitle: true },
  { row: 100, colA: "", colB: "кількість поданих заявок", defaultColC: "", indicatorKey: "Розділ 18. Кількість грантів від міжнародних фондів та міжнародних проєктів — кількість поданих заявок", format: 'number' },
  { row: 101, colA: "", colB: "кількість грантів, отриманих від міжнародних фондів", defaultColC: "", indicatorKey: "Розділ 18. Кількість грантів від міжнародних фондів та міжнародних проєктів — кількість грантів, отриманих від міжнародних фондів", format: 'number' },
  { row: 102, colA: "", colB: "кількість міжнародних проектів у яких беруть участь науковці", defaultColC: "", indicatorKey: "Розділ 18. Кількість грантів від міжнародних фондів та міжнародних проєктів — кількість міжнародних проєктів з участю науковців", format: 'number' },
  { row: 103, colA: "", colB: "Додаток 18.", defaultColC: "", isNotice: true },
  { row: 104, colA: "19", colB: "Кількість виїздів/онлайн-участь студентів:", defaultColC: "", isSectionTitle: true },
  { row: 105, colA: "", colB: "за межі України", defaultColC: "" },
  { row: 106, colA: "", colB: "навчання, закордонне стажування", defaultColC: "" },
  { row: 107, colA: "", colB: "до 1 тижня", defaultColC: "", indicatorKey: "Розділ 19. Кількість виїздів/онлайн-участь студентів за межі України — навчання, закордонне стажування (до 1 тижня)", format: 'number' },
  { row: 108, colA: "", colB: "2-4 тижні", defaultColC: "", indicatorKey: "Розділ 19. Кількість виїздів/онлайн-участь студентів за межі України — навчання, закордонне стажування (2-4 тижні)", format: 'number' },
  { row: 109, colA: "", colB: "1-2 місяці", defaultColC: "", indicatorKey: "Розділ 19. Кількість виїздів/онлайн-участь студентів за межі України — навчання, закордонне стажування (1-2 місяці)", format: 'number' },
  { row: 110, colA: "", colB: "не менше трьох місяців", defaultColC: "", indicatorKey: "Розділ 19. Кількість виїздів/онлайн-участь студентів за межі України — навчання, закордонне стажування (не менше 3 місяців)", format: 'number' },
  { row: 111, colA: "", colB: "участі в міжнародних конференціях, форумах, літніх школах", defaultColC: "", indicatorKey: "Розділ 19. Кількість виїздів/онлайн-участь студентів за межі України — участь у міжнародних конференціях, форумах", format: 'number' },
  { row: 112, colA: "", colB: "програмах студентської мобільності", defaultColC: "", indicatorKey: "Розділ 19. Кількість виїздів/онлайн-участь студентів за межі України — програми студентської мобільності", format: 'number' },
  { row: 113, colA: "", colB: "міжнародні гранти та проекти", defaultColC: "", indicatorKey: "Розділ 19. Кількість виїздів/онлайн-участь студентів за межі України — міжнародні гранти та проекти студентів", format: 'number' },
  { row: 114, colA: "", colB: "Додаток 19.", defaultColC: "", isNotice: true },
  { row: 115, colA: "20", colB: "Чисельність студентів-учасників та студентів-переможців у міжнародних конкурсах, олімпіадах, турнірах", defaultColC: "", isSectionTitle: true, indicatorKey: "Розділ 20. Студенти-учасники та переможці в міжнародних конкурсах, олімпіадах — чисельність студентів", format: 'number' },
  { row: 116, colA: "", colB: "Додаток 20.", defaultColC: "", isNotice: true },
  { row: 117, colA: "21", colB: "Чисельність науковців, які брали участь у виставковій діяльності в 2026 р.", defaultColC: "", isSectionTitle: true, indicatorKey: "Розділ 21. Чисельність науковців у виставковій діяльності — чисельність науковців", format: 'number' },
  { row: 118, colA: "", colB: "Додаток 21.", defaultColC: "", isNotice: true },
  { row: 119, colA: "22", colB: "Чисельність студентів, які брали участь у виставковій діяльності в 2026 р.", defaultColC: "", isSectionTitle: true, indicatorKey: "Розділ 22. Чисельність студентів у виставковій діяльності — чисельність студентів", format: 'number' },
  { row: 120, colA: "", colB: "Додаток 22.", defaultColC: "", isNotice: true },
  { row: 121, colA: "23", colB: "Чисельність науковців, які є членами редакційних колегій закордонних наукових видань", defaultColC: "", isSectionTitle: true, indicatorKey: "Розділ 23. Науковці - члени редколегій закордонних наукових видань — чисельність науковців", format: 'number' },
  { row: 122, colA: "", colB: "Додаток 23.", defaultColC: "", isNotice: true },
  { row: 123, colA: "24", colB: "Чисельність науковців, які є членами редакційних колегій вітчизняних наукових видань", defaultColC: "", isSectionTitle: true, indicatorKey: "Розділ 24. Науковці - члени редколегій вітчизняних наукових видань — чисельність науковців", format: 'number' },
  { row: 124, colA: "", colB: "Додаток 24.", defaultColC: "", isNotice: true },
  { row: 125, colA: "25", colB: "Кількість опонуваннь дисертацій доктора філософії, кандидата наук, доктора наук", defaultColC: "", isSectionTitle: true, indicatorKey: "Розділ 25. Опонування дисертацій доктора філософії, кандидата, доктора наук — кількість опонувань", format: 'number' },
  { row: 126, colA: "", colB: "Додаток 25.", defaultColC: "", isNotice: true },
  { row: 127, colA: "26", colB: "Кількість реалізованих експертних ролей НП та НПП  (експертиза міжнародних конкурсів: Горизонт 2020, Горизонт Європа, Євратом, Erasmus+)", defaultColC: "", isSectionTitle: true, indicatorKey: "Розділ 26. Експертні ролі у міжнародних конкурсах (Horizon Europe, Erasmus+ тощо) — кількість реалізованих ролей", format: 'number' },
  { row: 128, colA: "", colB: "Додаток 26.", defaultColC: "", isNotice: true },
  { row: 129, colA: "27", colB: "Кількість реалізованих експетрних ролей НП та НПП  (експертиза загальнодержавних конкурсних відборів Національного фонду досліджень України, Міністерства освіти і науки України)", defaultColC: "", isSectionTitle: true, indicatorKey: "Розділ 27. Експертні ролі у загальнодержавних конкурсах (НФДУ, МОН України) — кількість реалізованих ролей", format: 'number' },
  { row: 130, colA: "", colB: "Додаток 27.", defaultColC: "", isNotice: true },
  { row: 131, colA: "28", colB: "Кількість участей в експертних групах та комісіях МОН з питань державної атестації наукових установ / закладів вищої освіти / або процедур присудження наукового ступеня у разовій спеціалізованій вченій раді ЗВО, наукової установи про присудження ступеня доктора філософії", defaultColC: "", isSectionTitle: true, indicatorKey: "Розділ 28. Участь в експертних групах та комісіях МОН / разових спецрадах PhD — кількість участей", format: 'number' },
  { row: 132, colA: "", colB: "Додаток 28.", defaultColC: "", isNotice: true },
];

/**
 * Merged ranges in templates/2_Інформ._про_наук.роб_(бланк)_2026.xlsx
 */
export const TEMPLATE_MERGES = [
  { startRow: 12, endRow: 17, startCol: 0, endCol: 1 },  // A12:A17 (Section 1)
  { startRow: 18, endRow: 20, startCol: 0, endCol: 1 },  // A18:A20 (Section 2)
  { startRow: 21, endRow: 42, startCol: 0, endCol: 1 },  // A21:A42 (Section 3)
  { startRow: 43, endRow: 45, startCol: 0, endCol: 1 },  // A43:A45 (Section 4)
  { startRow: 46, endRow: 48, startCol: 0, endCol: 1 },  // A46:A48 (Section 5)
  { startRow: 49, endRow: 50, startCol: 0, endCol: 1 },  // A49:A50 (Section 6)
  { startRow: 51, endRow: 52, startCol: 0, endCol: 1 },  // A51:A52 (Section 7)
  { startRow: 53, endRow: 54, startCol: 0, endCol: 1 },  // A53:A54 (Section 8)
  { startRow: 55, endRow: 56, startCol: 0, endCol: 1 },  // A55:A56 (Section 9)
  { startRow: 57, endRow: 58, startCol: 0, endCol: 1 },  // A57:A58 (Section 10)
  { startRow: 59, endRow: 60, startCol: 0, endCol: 1 },  // A59:A60 (Section 11)
  { startRow: 61, endRow: 69, startCol: 0, endCol: 1 },  // A61:A69 (Section 12)
  { startRow: 70, endRow: 76, startCol: 0, endCol: 1 },  // A70:A76 (Section 13)
  { startRow: 77, endRow: 78, startCol: 0, endCol: 1 },  // A77:A78 (Section 14)
  { startRow: 79, endRow: 83, startCol: 0, endCol: 1 },  // A79:A83 (Section 15)
  { startRow: 84, endRow: 97, startCol: 0, endCol: 1 },  // A84:A97 (Section 16)
  { startRow: 99, endRow: 103, startCol: 0, endCol: 1 }, // A99:A103 (Section 18)
  { startRow: 104, endRow: 114, startCol: 0, endCol: 1 },// A104:A114 (Section 19)
];