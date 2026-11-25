import assert from 'assert/strict';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { WorkspaceService, workspaceSettings } from '../src/services/workspace.service';
import { UserError } from '../src/services/api-error';

interface FakeFile { id: string; name: string; mimeType: string; parents: string[]; owner: string; trashed: boolean; appProperties: Record<string, string>; }

// In-memory Drive shared by several Google users. Every file is visible to every user (as if shared),
// so tests prove that ownership and app tags, not visibility, decide which files are reused.
const files: FakeFile[] = [];
let nextId = 1, creates = 0, templateWrites = 0;
const unquote = (value: string) => value.replace(/\\'/g, "'").replace(/\\\\/g, '\\');

function fakeDrive(user: string) {
  return { files: {
    get: async ({ fileId }: any) => {
      const file = files.find(item => item.id === fileId);
      if (!file) throw Object.assign(new Error('Not found'), { code: 404 });
      return { data: { ...file, ownedByMe: file.owner === user } };
    },
    list: async ({ q }: any) => {
      const text: string = q;
      const mime = unquote(text.match(/mimeType = '((?:[^'\\]|\\.)*)'/)![1]);
      const name = text.match(/name = '((?:[^'\\]|\\.)*)'/)?.[1];
      const parent = text.match(/'((?:[^'\\]|\\.)*)' in parents/)?.[1];
      const tags = [...text.matchAll(/key='(\w+)' and value='((?:[^'\\]|\\.)*)'/g)].map(match => [match[1], unquote(match[2])]);
      assert.match(text, /'me' in owners/);
      const found = files.filter(file => file.mimeType === mime && !file.trashed && file.owner === user &&
        (name === undefined || file.name === unquote(name)) && (parent === undefined || file.parents.includes(unquote(parent))) &&
        tags.every(([key, value]) => file.appProperties[key] === value));
      return { data: { files: found.slice(0, 1).map(file => ({ id: file.id })) } };
    },
    update: async ({ fileId, requestBody }: any) => {
      Object.assign(files.find(item => item.id === fileId)!.appProperties, requestBody.appProperties);
      return { data: { id: fileId } };
    },
    create: async ({ requestBody }: any) => {
      creates++;
      const file = { id: `file-${nextId++}`, name: requestBody.name, mimeType: requestBody.mimeType, parents: requestBody.parents,
        owner: user, trashed: false, appProperties: { ...requestBody.appProperties } };
      files.push(file);
      return { data: { id: file.id } };
    },
  } };
}

const courseList = [
  { id: 'c1', name: 'Кафедра інформатики', section: '2026' },
  { id: 'c2', name: 'Кафедра математики' },
  { id: 'c3', name: 'Кафедра математики (архів)' },
];

async function main() {
  const factories = { drive: google.drive, sheets: google.sheets, classroom: google.classroom };
  let currentUser = 'alice';
  let courses = courseList;
  (google as any).drive = () => fakeDrive(currentUser);
  (google as any).sheets = () => ({ spreadsheets: {
    values: { update: async () => { templateWrites++; return { data: {} }; } },
    get: async () => ({ data: { sheets: [{ properties: { sheetId: 0 } }] } }),
    batchUpdate: async () => ({ data: {} }),
  } });
  (google as any).classroom = () => ({ courses: { list: async () => ({ data: { courses } }) } });
  const auth = new OAuth2Client();
  try {
    const alice = await WorkspaceService.provision(auth, 'alice-id');
    assert.equal(creates, 4);
    assert.equal(templateWrites, 2);
    const root = files.find(file => file.id === alice.rootFolderId)!;
    assert.deepEqual(root.parents, ['root']);
    assert.equal(root.name, 'Секретар кафедри');
    for (const id of [alice.reportsFolderId, alice.planSheetId, alice.sciPlanSheetId]) {
      assert.deepEqual(files.find(file => file.id === id)!.parents, [alice.rootFolderId]);
    }
    assert.deepEqual(await WorkspaceService.provision(auth, 'alice-id', alice), alice);
    assert.deepEqual(await WorkspaceService.provision(auth, 'alice-id'), alice, 'tagged lookup survives a lost database row');
    root.name = 'Перейменована папка';
    assert.deepEqual(await WorkspaceService.provision(auth, 'alice-id'), alice, 'renamed resources stay linked');
    assert.equal(creates, 4);
    console.log('PASS: creates folder, report folder and both plan sheets once, then reuses them');

    files.find(file => file.id === alice.planSheetId)!.trashed = true;
    const repaired = await WorkspaceService.provision(auth, 'alice-id', alice);
    assert.notEqual(repaired.planSheetId, alice.planSheetId);
    assert.equal(repaired.rootFolderId, alice.rootFolderId);
    assert.equal(creates, 5);
    console.log('PASS: trashed resources are recreated inside the existing folder');

    currentUser = 'bob';
    const bob = await WorkspaceService.provision(auth, 'bob-id', repaired);
    assert.equal(new Set([...Object.values(bob), ...Object.values(repaired)]).size, 8, 'no resource is shared between accounts');
    assert.ok(Object.values(bob).every(id => files.find(file => file.id === id)!.owner === 'bob'));
    console.log('PASS: accounts never reuse files owned by or shared from another account');

    currentUser = 'carol';
    files.push({ id: 'carol-existing', name: 'Секретар кафедри', mimeType: 'application/vnd.google-apps.folder', parents: ['root'], owner: 'carol', trashed: false, appProperties: {} });
    files.push({ id: 'carol-plan', name: 'План роботи кафедри', mimeType: 'application/vnd.google-apps.spreadsheet', parents: ['carol-existing'], owner: 'carol', trashed: false, appProperties: {} });
    const carol = await WorkspaceService.provision(auth, 'carol-id');
    assert.equal(carol.rootFolderId, 'carol-existing');
    assert.equal(carol.planSheetId, 'carol-plan');
    assert.equal(files.find(file => file.id === 'carol-plan')!.appProperties.birdOwner, 'carol-id');
    console.log('PASS: existing folder and sheets with the expected names are adopted');

    process.env.WORKSPACE_FOLDER_NAME = "Кафедра O'Brien \\ звіти";
    currentUser = 'dave';
    const dave = await WorkspaceService.provision(auth, 'dave-id');
    assert.equal(files.find(file => file.id === dave.rootFolderId)!.name, "Кафедра O'Brien \\ звіти");
    assert.deepEqual(await WorkspaceService.provision(auth, 'dave-id'), dave);
    delete process.env.WORKSPACE_FOLDER_NAME;
    assert.deepEqual(workspaceSettings('c1', dave), { CLASSROOM_COURSE_ID: 'c1', MASTER_OUTPUT_FOLDER_ID: dave.reportsFolderId,
      STATIC_PLAN_SHEET_ID: dave.planSheetId, STATIC_SCI_PLAN_SHEET_ID: dave.sciPlanSheetId });
    console.log('PASS: configurable folder name with quotes is escaped in Drive queries');

    assert.equal((await WorkspaceService.resolveCourse(auth, '  кафедра   ІНФОРМАТИКИ ')).id, 'c1');
    assert.equal((await WorkspaceService.resolveCourse(auth, 'Кафедра математики')).id, 'c2', 'exact match beats partial');
    assert.equal((await WorkspaceService.resolveCourse(auth, 'інформ')).id, 'c1');
    assert.equal((await WorkspaceService.resolveCourse(auth, '', 'c3')).id, 'c3');
    await assert.rejects(WorkspaceService.resolveCourse(auth, 'математ'), (error: Error) => error instanceof UserError && /кількох/.test(error.message));
    await assert.rejects(WorkspaceService.resolveCourse(auth, 'фізика'), (error: Error) => error instanceof UserError && /не знайдено/.test(error.message));
    await assert.rejects(WorkspaceService.resolveCourse(auth, ''), UserError);
    courses = [courseList[1]];
    assert.equal((await WorkspaceService.resolveCourse(auth, '')).id, 'c2', 'single course is picked automatically');
    courses = [];
    await assert.rejects(WorkspaceService.resolveCourse(auth, 'будь-що'), UserError);
    console.log('PASS: course resolved by name (case/space-insensitive, exact before partial, ambiguity reported)');
  } finally {
    google.drive = factories.drive; google.sheets = factories.sheets; google.classroom = factories.classroom;
  }
  console.log('Workspace tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
