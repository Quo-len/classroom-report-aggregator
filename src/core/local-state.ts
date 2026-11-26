import fs from 'fs';
import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';

interface LocalReportState {
  spreadsheetId?: string;
  phases: Record<string, 'running' | 'completed'>;
  deliveries: Record<string, 'sending' | 'sent'>;
}
interface LocalRun { state: LocalReportState; phase: string; save(): void; }
export const localRun = new AsyncLocalStorage<LocalRun>();

export async function withLocalRun<T>(courseId: string, assignmentId: string, phase: string, action: () => Promise<T>, filename = path.resolve('state.json')): Promise<T | undefined> {
  const lock = fs.openSync(`${filename}.lock`, 'wx', 0o600);
  try {
    const all: Record<string, LocalReportState> = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : {};
    const key = JSON.stringify([courseId, assignmentId]);
    const state = all[key] || { phases: {}, deliveries: {} };
    all[key] = state;
    if (state.phases[phase] === 'completed') return;
    if (Object.values(state.deliveries).includes('sending')) throw new Error('Доставка потребує перевірки у state.json перед повторним запуском.');
    const save = () => {
      fs.writeFileSync(`${filename}.tmp`, JSON.stringify(all, null, 2), { mode: 0o600 });
      fs.renameSync(`${filename}.tmp`, filename);
    };
    state.phases[phase] = 'running';
    save();
    const result = await localRun.run({ state, phase, save }, action);
    if (result === null) throw new Error('Не вдалося створити звіт');
    state.phases[phase] = 'completed';
    save();
    return result;
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(`${filename}.lock`);
  }
}
