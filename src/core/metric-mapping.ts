import { OFFICIAL_TEMPLATE_ROWS } from '../config/official-template';

export const normalizeLabel = (value: string): string => value.toLowerCase().replace(/\s+/g, ' ').replace(/[:.]+$/, '').trim();

export function mapToOfficialKey(rawName: string, section?: number): string | undefined {
  const name = normalizeLabel(rawName);
  const candidates = OFFICIAL_TEMPLATE_ROWS.filter(row => row.indicatorKey &&
    (!section || row.indicatorKey.startsWith(`Розділ ${section}.`)) &&
    [row.indicatorKey, row.colB, row.indicatorKey.split(' — ')[1]].some(label => normalizeLabel(label || '') === name));
  return candidates.length === 1 ? candidates[0].indicatorKey : undefined;
}

export function sectionForLabel(label: string): number | undefined {
  const explicit = label.match(/^Розділ\s+(\d+)(?:\.|\s|$)/i);
  if (explicit) return Number(explicit[1]);
  const row = OFFICIAL_TEMPLATE_ROWS.find(row => row.isSectionTitle && normalizeLabel(row.colB) === normalizeLabel(label));
  return row ? Number(row.colA) : undefined;
}

export const SHEETS_SUFFIX = ' [друковані аркуші]';

export function completePublicationTotals(metrics: Map<string, number>): void {
  const rows = OFFICIAL_TEMPLATE_ROWS.filter(row => row.indicatorKey?.startsWith('Розділ 3.'));
  const total = rows.find(row => row.colB === 'всього:')?.indicatorKey;
  if (!total || metrics.has(total) || ![...metrics.keys()].some(key => key.startsWith('Розділ 3.'))) return;
  // Subsets (Scopus, WoS, фахові) can overlap; sum only disjoint publication categories.
  const categories = rows.filter(row => (row.row >= 24 && row.row <= 32 && row.row !== 31) || row.row === 34 || row.colB === 'тези доповідей');
  for (const suffix of ['', SHEETS_SUFFIX]) {
    metrics.set(total + suffix, categories.reduce((sum, row) => sum + (metrics.get(row.indicatorKey! + suffix) || 0), 0));
  }
}
