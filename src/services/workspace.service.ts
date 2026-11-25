import { google, drive_v3, sheets_v4 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { accountContext } from '../core/account-context';
import { database } from './database.service';
import { apiError, googleStatus, UserError } from './api-error';
import { setLocalResources } from '../config/env';

export const DEFAULT_ASSIGNMENT_NAME = 'Інформація про науково-дослідну роботу';
export const defaultAssignmentName = () => process.env.ASSIGNMENT_NAME?.trim() || DEFAULT_ASSIGNMENT_NAME;

const FOLDER = 'application/vnd.google-apps.folder';
const SPREADSHEET = 'application/vnd.google-apps.spreadsheet';

export interface Course { id: string; name: string; }
export interface Workspace { rootFolderId: string; reportsFolderId: string; planSheetId: string; sciPlanSheetId: string; }

type ResourceRole = 'root' | 'reports' | 'plan' | 'sciPlan';
interface ResourceSpec { role: ResourceRole; name: string; mimeType: string; template?: string[][]; }

const PLAN_TEMPLATE = [
  ['План роботи кафедри'],
  ['№ з/п', 'Назва заходу', 'Термін виконання', 'Відповідальний', 'Відмітка про виконання'],
];
const SCI_PLAN_TEMPLATE = [
  ['План наукової роботи кафедри'],
  ['№ з/п', 'Тема наукової роботи', 'Керівник / виконавці', 'Термін виконання', 'Очікувані результати'],
];

const normalize = (value: string) => value.normalize('NFC').toLocaleLowerCase('uk').replace(/\s+/g, ' ').trim();
// Drive query string literals escape backslashes and single quotes.
const literal = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export function workspaceLinks(workspace: Partial<Workspace>) {
  const folder = (id?: string) => id ? `https://drive.google.com/drive/folders/${id}` : null;
  const sheet = (id?: string) => id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null;
  return {
    rootFolderUrl: folder(workspace.rootFolderId), reportsFolderUrl: folder(workspace.reportsFolderId),
    planSheetUrl: sheet(workspace.planSheetId), sciPlanSheetUrl: sheet(workspace.sciPlanSheetId),
  };
}

/** Maps provisioned resources onto the setting keys the report pipeline already reads through `env`. */
export function workspaceSettings(courseId: string | undefined, workspace: Partial<Workspace>): Record<string, string> {
  const entries: [string, string | undefined][] = [
    ['CLASSROOM_COURSE_ID', courseId], ['MASTER_OUTPUT_FOLDER_ID', workspace.reportsFolderId],
    ['STATIC_PLAN_SHEET_ID', workspace.planSheetId], ['STATIC_SCI_PLAN_SHEET_ID', workspace.sciPlanSheetId],
  ];
  return Object.fromEntries(entries.filter((entry): entry is [string, string] => Boolean(entry[1])));
}

export class WorkspaceService {
  static rootFolderName(): string {
    return process.env.WORKSPACE_FOLDER_NAME?.trim() || 'Секретар кафедри';
  }

  static async listCourses(auth: OAuth2Client): Promise<Course[]> {
    const api = google.classroom({ version: 'v1', auth });
    const courses: Course[] = [];
    let pageToken: string | undefined;
    do {
      const response = await api.courses.list({ teacherId: 'me', courseStates: ['ACTIVE'], pageSize: 100, pageToken });
      for (const course of response.data.courses || []) {
        if (course.id) courses.push({ id: course.id, name: [course.name, course.section].filter(Boolean).join(' · ') || course.id });
      }
      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);
    return courses;
  }

  /**
   * Picks the active course the user teaches whose name matches `query`.
   * Exact (case/space-insensitive) matches win over partial ones; an empty query picks the only course.
   */
  static async resolveCourse(auth: OAuth2Client, query: string, fallbackId?: string): Promise<Course> {
    const courses = await this.listCourses(auth);
    if (!courses.length) throw new UserError('Не знайдено активних курсів Google Classroom, у яких ви викладаєте.');
    const wanted = normalize(query || '');
    if (!wanted) {
      const known = fallbackId && courses.find(course => course.id === fallbackId);
      if (known) return known;
      if (courses.length === 1) return courses[0];
      throw new UserError(`Вкажіть назву курсу. Доступні курси: ${courses.map(course => course.name).join('; ')}.`);
    }
    const baseName = (course: Course) => normalize(course.name.split(' · ')[0]);
    const exact = courses.filter(course => normalize(course.name) === wanted || baseName(course) === wanted);
    const candidates = exact.length ? exact : courses.filter(course => normalize(course.name).includes(wanted));
    if (candidates.length === 1) {
      console.log(`🎓 Course "${query}" resolved to "${candidates[0].name}" [${candidates[0].id}]`);
      return candidates[0];
    }
    if (candidates.length > 1) {
      throw new UserError(`Назва «${query}» підходить до кількох курсів: ${candidates.map(course => course.name).join('; ')}. Уточніть назву.`);
    }
    throw new UserError(`Курс «${query}» не знайдено. Доступні курси: ${courses.map(course => course.name).join('; ')}.`);
  }

  /**
   * Finds or creates the department folder, its report subfolder and both plan spreadsheets in the user's own Drive.
   * Resources are tagged with private app properties scoped to `ownerKey`, so renaming or moving them keeps them linked,
   * and files merely shared with the user are never picked up.
   */
  static async provision(auth: OAuth2Client, ownerKey: string, known: Partial<Workspace> = {}): Promise<Workspace> {
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });
    const ensure = (spec: ResourceSpec, parentId: string, knownId?: string) =>
      this.findOrCreate(drive, sheets, ownerKey, spec, parentId, knownId);
    const rootFolderId = await ensure({ role: 'root', name: this.rootFolderName(), mimeType: FOLDER }, 'root', known.rootFolderId);
    const reportsFolderId = await ensure({ role: 'reports', name: 'Зведені звіти', mimeType: FOLDER }, rootFolderId, known.reportsFolderId);
    const planSheetId = await ensure({ role: 'plan', name: 'План роботи кафедри', mimeType: SPREADSHEET, template: PLAN_TEMPLATE },
      rootFolderId, known.planSheetId);
    const sciPlanSheetId = await ensure({ role: 'sciPlan', name: 'План наукової роботи кафедри', mimeType: SPREADSHEET, template: SCI_PLAN_TEMPLATE },
      rootFolderId, known.sciPlanSheetId);
    return { rootFolderId, reportsFolderId, planSheetId, sciPlanSheetId };
  }

  private static async findOrCreate(drive: drive_v3.Drive, sheets: sheets_v4.Sheets, ownerKey: string,
    spec: ResourceSpec, parentId: string, knownId?: string): Promise<string> {
    const tags = { birdRole: spec.role, birdOwner: ownerKey };
    if (knownId) {
      try {
        const file = await drive.files.get({ fileId: knownId, fields: 'id, mimeType, trashed, ownedByMe, appProperties' });
        if (!file.data.trashed && file.data.mimeType === spec.mimeType && file.data.ownedByMe &&
          file.data.appProperties?.birdOwner === ownerKey) return knownId;
      } catch (error) {
        if (googleStatus(error) !== 404) throw error;
      }
      console.warn(`⚠️ Stored ${spec.role} resource is missing or trashed; looking for a replacement.`);
    }
    const base = `mimeType = ${literal(spec.mimeType)} and trashed = false and 'me' in owners`;
    const tagged = await drive.files.list({
      q: `${base} and appProperties has { key='birdRole' and value=${literal(spec.role)} } and appProperties has { key='birdOwner' and value=${literal(ownerKey)} }`,
      fields: 'files(id)', orderBy: 'createdTime', pageSize: 1, spaces: 'drive',
    });
    if (tagged.data.files?.[0]?.id) return tagged.data.files[0].id;

    const named = await drive.files.list({
      q: `${base} and name = ${literal(spec.name)} and ${literal(parentId)} in parents`,
      fields: 'files(id)', orderBy: 'createdTime', pageSize: 1, spaces: 'drive',
    });
    const existing = named.data.files?.[0]?.id;
    if (existing) {
      await drive.files.update({ fileId: existing, requestBody: { appProperties: tags }, fields: 'id' });
      console.log(`🔗 Linked existing "${spec.name}" [${existing}]`);
      return existing;
    }

    const created = await drive.files.create({
      requestBody: { name: spec.name, mimeType: spec.mimeType, parents: [parentId], appProperties: tags }, fields: 'id',
    });
    const id = created.data.id;
    if (!id) throw new Error(`Drive did not return an id for "${spec.name}"`);
    console.log(`✨ Created "${spec.name}" [${id}]`);
    if (spec.template) await this.writeTemplate(sheets, id, spec.template);
    return id;
  }

  private static async writeTemplate(sheets: sheets_v4.Sheets, spreadsheetId: string, template: string[][]) {
    try {
      await sheets.spreadsheets.values.update({ spreadsheetId, range: 'A1', valueInputOption: 'RAW', requestBody: { values: template } });
      const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId))' });
      const sheetId = meta.data.sheets?.[0]?.properties?.sheetId ?? 0;
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
        { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 13 } } }, fields: 'userEnteredFormat.textFormat' } },
        { repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: 2 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.91, green: 0.94, blue: 0.99 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
        { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 2 } }, fields: 'gridProperties.frozenRowCount' } },
      ] } });
    } catch (error) {
      // The sheet exists and can be filled in manually; a missing header is not worth failing setup.
      console.warn(`⚠️ Could not write template header into [${spreadsheetId}]:`, apiError(error));
    }
  }

  static async load(userId: string): Promise<{ course?: Course; workspace: Partial<Workspace> }> {
    const result = await database().query('SELECT * FROM bird.workspaces WHERE user_id = $1', [userId]);
    const row = result.rows[0];
    if (!row) return { workspace: {} };
    return {
      course: row.course_id ? { id: row.course_id, name: row.course_name || row.course_id } : undefined,
      workspace: { rootFolderId: row.root_folder_id || undefined, reportsFolderId: row.reports_folder_id || undefined,
        planSheetId: row.plan_sheet_id || undefined, sciPlanSheetId: row.sci_plan_sheet_id || undefined },
    };
  }

  static async save(userId: string, course: Course, workspace: Partial<Workspace>) {
    await database().query(`INSERT INTO bird.workspaces (user_id, course_id, course_name, root_folder_id, reports_folder_id, plan_sheet_id, sci_plan_sheet_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (user_id) DO UPDATE SET course_id = EXCLUDED.course_id, course_name = EXCLUDED.course_name,
        root_folder_id = EXCLUDED.root_folder_id, reports_folder_id = EXCLUDED.reports_folder_id, plan_sheet_id = EXCLUDED.plan_sheet_id,
        sci_plan_sheet_id = EXCLUDED.sci_plan_sheet_id, updated_at = now()`,
      [userId, course.id, course.name, workspace.rootFolderId || null, workspace.reportsFolderId || null,
        workspace.planSheetId || null, workspace.sciPlanSheetId || null]);
  }

  /** Single-account CLI: resolves the course by name and provisions the Drive workspace without a database. */
  static async prepareLocal(auth: OAuth2Client): Promise<void> {
    const course = await this.resolveCourse(auth, process.env.CLASSROOM_COURSE_NAME || '', process.env.CLASSROOM_COURSE_ID);
    const workspace = await this.provision(auth, 'local');
    setLocalResources({ CLASSROOM_COURSE_ID: course.id, ...workspaceSettings(course.id, workspace) } as any);
    console.log(`📂 Workspace ready: ${workspaceLinks(workspace).rootFolderUrl}`);
  }

  /**
   * Ensures the signed-in account has a resolved course and (when `drive` is set) a healthy Drive workspace,
   * then exposes both to the report pipeline through the account context.
   */
  static async ensure(options: { drive: boolean } = { drive: true }): Promise<{ course: Course; workspace: Partial<Workspace> }> {
    const context = accountContext.getStore();
    if (!context) throw new Error('Workspace provisioning requires an account context');
    const stored = await this.load(context.userId);
    const course = stored.course ||
      await this.resolveCourse(context.auth, context.settings.COURSE_NAME || '', context.settings.CLASSROOM_COURSE_ID);
    const workspace = options.drive ? await this.provision(context.auth, context.userId, stored.workspace) : stored.workspace;
    const changed = !stored.course || (Object.keys(workspace) as (keyof Workspace)[]).some(key => workspace[key] !== stored.workspace[key]);
    if (changed) await this.save(context.userId, course, workspace);
    Object.assign(context.settings, workspaceSettings(course.id, workspace));
    return { course, workspace };
  }
}
