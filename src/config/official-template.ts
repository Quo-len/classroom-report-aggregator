/**
 * Official Reporting Template Schema based on:
 * digest/2_Інформ._про_наук.роб_(бланк)_2026.xlsx and digest/ІНСТРУКЦІЯ.docx
 */

export interface OfficialSectionDef {
  number: number;
  title: string;
  addonNumber?: string; // e.g. "Додаток 1", "Додаток 3"
  sourceType: 'dynamic_teachers' | 'static_dept_plan' | 'static_sci_plan' | 'hybrid';
  subIndicators: {
    code: string;
    name: string;
    format?: string; // e.g. "/" for count/printed_sheets
  }[];
}

export const OFFICIAL_SECTIONS: OfficialSectionDef[] = [
  {
    number: 1,
    title: 'Кількісний та якісний склад професорсько-викладацьких кадрів',
    addonNumber: 'Додаток 1',
    sourceType: 'static_dept_plan',
    subIndicators: [
      { code: '1.1', name: 'всього' },
      { code: '1.2', name: 'із них - штатних викладачів' },
      { code: '1.3', name: 'докт.н.' },
      { code: '1.4', name: 'канд.н., доктор філософії' },
    ],
  },
  {
    number: 2,
    title: 'Подати заявки до аспірантури та докторантури на 2027 р.',
    addonNumber: 'Додаток 2',
    sourceType: 'static_dept_plan',
    subIndicators: [{ code: '2.1', name: 'вказати кількість' }],
  },
  {
    number: 3,
    title: 'Публікації (к-сть публікацій / к-сть др. аркушів)',
    addonNumber: 'Додаток 3',
    sourceType: 'dynamic_teachers',
    subIndicators: [
      { code: '3.1', name: 'монографії', format: '/' },
      { code: '3.2', name: 'підручники', format: '/' },
      { code: '3.3', name: 'посібники', format: '/' },
      { code: '3.4', name: 'словники', format: '/' },
      { code: '3.5', name: 'довідники', format: '/' },
      { code: '3.6', name: 'збірники законодавства', format: '/' },
      { code: '3.7', name: 'збірники наукових праць', format: '/' },
      { code: '3.8', name: 'із них фахові', format: '/' },
      { code: '3.9', name: 'методичні розробки', format: '/' },
      { code: '3.10', name: 'статті в журналах Scopus', format: '/' },
      { code: '3.11', name: 'статті в журналах Web of Science', format: '/' },
      { code: '3.12', name: 'статті в журналах закордонні', format: '/' },
      { code: '3.13', name: 'статті в журналах Index Copernicus', format: '/' },
      { code: '3.14', name: 'статті в українських наукових виданнях', format: '/' },
      { code: '3.15', name: 'статті із них у фахових виданнях', format: '/' },
      { code: '3.16', name: 'тези доповідей', format: '/' },
    ],
  },
  {
    number: 4,
    title: 'Опубліковані FAIR-дані',
    addonNumber: 'Додаток 4',
    sourceType: 'dynamic_teachers',
    subIndicators: [{ code: '4.1', name: 'вказати кількість' }],
  },
  {
    number: 5,
    title: 'Опубліковані препринти, які мають DOI',
    addonNumber: 'Додаток 5',
    sourceType: 'dynamic_teachers',
    subIndicators: [{ code: '5.1', name: 'вказати кількість' }],
  },
  {
    number: 6,
    title: 'Список членів кафедри, які мають публікації в базі даних Scopus',
    addonNumber: 'Додаток 6',
    sourceType: 'static_sci_plan',
    subIndicators: [{ code: '6.1', name: 'вказати кількість' }],
  },
  {
    number: 7,
    title: 'Список членів кафедри, які мають публікації в базі даних Web of Science (WoS)',
    addonNumber: 'Додаток 7',
    sourceType: 'static_sci_plan',
    subIndicators: [{ code: '7.1', name: 'вказати кількість' }],
  },
  {
    number: 8,
    title: 'Список членів кафедри згідно з базою даних Google Scholar',
    addonNumber: 'Додаток 8',
    sourceType: 'static_sci_plan',
    subIndicators: [{ code: '8.1', name: 'вказати кількість' }],
  },
  {
    number: 9,
    title: 'Список членів кафедри згідно з базою даних ORCID',
    addonNumber: 'Додаток 9',
    sourceType: 'static_sci_plan',
    subIndicators: [{ code: '9.1', name: 'вказати кількість' }],
  },
  {
    number: 10,
    title: 'Інформація про авторські свідоцтва, патенти, ліцензії, отримані в 2026 р.',
    addonNumber: 'Додаток 10',
    sourceType: 'dynamic_teachers',
    subIndicators: [{ code: '10.1', name: 'вказати кількість' }],
  },
  {
    number: 11,
    title: 'Науково-технічні (експериментальні) розробки, впроваджені за межами університету',
    addonNumber: 'Додаток 11',
    sourceType: 'dynamic_teachers',
    subIndicators: [{ code: '11.1', name: 'вказати кількість' }],
  },
  {
    number: 12,
    title: 'Науково-дослідна робота студентів',
    addonNumber: 'Додаток 12.1, 12.2',
    sourceType: 'dynamic_teachers',
    subIndicators: [
      { code: '12.1', name: 'чисельність студентів, які беруть участь у НДР' },
      { code: '12.2', name: 'публікації студентів самостійно' },
      { code: '12.3', name: 'публікації студентів у співавторстві з викладачем' },
      { code: '12.4', name: 'студенти-учасники всеукраїнських конкурсів, турнірів' },
      { code: '12.5', name: 'студенти-переможці всеукраїнських конкурсів, турнірів' },
    ],
  },
  {
    number: 13,
    title: 'Проведені кафедрою наукові заходи',
    addonNumber: 'Додаток 13',
    sourceType: 'static_sci_plan',
    subIndicators: [
      { code: '13.1', name: 'міжнародні конференції' },
      { code: '13.2', name: 'всеукраїнські конференції' },
      { code: '13.3', name: 'наукові семінари' },
      { code: '13.4', name: 'наукові круглі столи' },
    ],
  },
  {
    number: 14,
    title: 'План НДР на 2027 р.',
    addonNumber: 'Додаток 14',
    sourceType: 'static_sci_plan',
    subIndicators: [{ code: '14.1', name: 'план НДР' }],
  },
  {
    number: 15,
    title: 'Наукові результати кафедральних тем, підрозділів та спецрад',
    addonNumber: 'Додаток 15.1, 15.2, 15.3',
    sourceType: 'static_sci_plan',
    subIndicators: [
      { code: '15.1', name: 'наукові результати за зареєстрованими кафедральними темами' },
      { code: '15.2', name: 'робота наукових підрозділів (лабораторій, центрів)' },
      { code: '15.3', name: 'діяльність спеціалізованих учених рад' },
    ],
  },
  {
    number: 16,
    title: 'Кількість виїздів (онлайн участі) НПП за межі України',
    addonNumber: 'Додаток 16',
    sourceType: 'dynamic_teachers',
    subIndicators: [
      { code: '16.1', name: 'стажування до 1 тижня' },
      { code: '16.2', name: 'стажування 2-4 тижні' },
      { code: '16.3', name: 'стажування 1-2 місяці' },
      { code: '16.4', name: 'стажування не менше 3 місяців' },
      { code: '16.5', name: 'підвищення кваліфікації' },
      { code: '16.6', name: 'викладацька робота' },
      { code: '16.7', name: 'проведення наукових досліджень' },
      { code: '16.8', name: 'участь у міжнародних семінарах, конференціях' },
    ],
  },
  {
    number: 17,
    title: 'Залучення іноземних науковців, викладачів і волонтерів',
    addonNumber: 'Додаток 17',
    sourceType: 'static_dept_plan',
    subIndicators: [{ code: '17.1', name: 'кількість осіб і проведених гостьових лекцій' }],
  },
  {
    number: 18,
    title: 'Кількість грантів від міжнародних фондів та міжнародних проєктів',
    addonNumber: 'Додаток 18',
    sourceType: 'dynamic_teachers',
    subIndicators: [
      { code: '18.1', name: 'кількість поданих заявок' },
      { code: '18.2', name: 'кількість грантів, отриманих від міжнародних фондів' },
      { code: '18.3', name: 'кількість міжнародних проєктів з участю науковців' },
    ],
  },
  {
    number: 19,
    title: 'Кількість виїздів/онлайн-участь студентів за межі України',
    addonNumber: 'Додаток 19',
    sourceType: 'dynamic_teachers',
    subIndicators: [
      { code: '19.1', name: 'навчання, закордонне стажування' },
      { code: '19.2', name: 'участь у міжнародних конференціях, форумах' },
      { code: '19.3', name: 'програми студентської мобільності' },
      { code: '19.4', name: 'міжнародні гранти та проекти студентів' },
    ],
  },
  {
    number: 20,
    title: 'Студенти-учасники та переможці в міжнародних конкурсах, олімпіадах',
    addonNumber: 'Додаток 20',
    sourceType: 'dynamic_teachers',
    subIndicators: [{ code: '20.1', name: 'чисельність студентів' }],
  },
  {
    number: 21,
    title: 'Чисельність науковців у виставковій діяльності',
    addonNumber: 'Додаток 21',
    sourceType: 'dynamic_teachers',
    subIndicators: [{ code: '21.1', name: 'чисельність науковців' }],
  },
  {
    number: 22,
    title: 'Чисельність студентів у виставковій діяльності',
    addonNumber: 'Додаток 22',
    sourceType: 'dynamic_teachers',
    subIndicators: [{ code: '22.1', name: 'чисельність студентів' }],
  },
  {
    number: 23,
    title: 'Науковці - члени редколегій закордонних наукових видань',
    addonNumber: 'Додаток 23',
    sourceType: 'static_sci_plan',
    subIndicators: [{ code: '23.1', name: 'чисельність науковців' }],
  },
  {
    number: 24,
    title: 'Науковці - члени редколегій вітчизняних наукових видань',
    addonNumber: 'Додаток 24',
    sourceType: 'static_sci_plan',
    subIndicators: [{ code: '24.1', name: 'чисельність науковців' }],
  },
  {
    number: 25,
    title: 'Опонування дисертацій доктора філософії, кандидата, доктора наук',
    addonNumber: 'Додаток 25',
    sourceType: 'dynamic_teachers',
    subIndicators: [{ code: '25.1', name: 'кількість опонувань' }],
  },
  {
    number: 26,
    title: 'Експертні ролі у міжнародних конкурсах (Horizon Europe, Erasmus+ тощо)',
    addonNumber: 'Додаток 26',
    sourceType: 'dynamic_teachers',
    subIndicators: [{ code: '26.1', name: 'кількість реалізованих ролей' }],
  },
  {
    number: 27,
    title: 'Експертні ролі у загальнодержавних конкурсах (НФДУ, МОН України)',
    addonNumber: 'Додаток 27',
    sourceType: 'dynamic_teachers',
    subIndicators: [{ code: '27.1', name: 'кількість реалізованих ролей' }],
  },
  {
    number: 28,
    title: 'Участь в експертних групах та комісіях МОН / разових спецрадах PhD',
    addonNumber: 'Додаток 28',
    sourceType: 'dynamic_teachers',
    subIndicators: [{ code: '28.1', name: 'кількість участей' }],
  },
];

/**
 * All flattened official indicator names to guarantee complete departmental coverage
 */
export const OFFICIAL_INDICATORS: string[] = OFFICIAL_SECTIONS.flatMap((sec) =>
  sec.subIndicators.map((sub) => `Розділ ${sec.number}. ${sec.title} — ${sub.name}`)
);

export * from './official-template-rows';
