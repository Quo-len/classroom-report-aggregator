export function calendarDaysRemaining(deadline: Date, now = new Date()): number {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' });
  const day = (date: Date) => {
    const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  };
  return Math.round((day(deadline) - day(now)) / 86400000);
}

export function phaseFor(deadline: Date | null, now = new Date()): 'monitor' | 'draft' | 'reconcile' | 'final' {
  if (!deadline) return 'monitor';
  if (now.getTime() >= deadline.getTime()) return 'final';
  const days = calendarDaysRemaining(deadline, now);
  if (days <= 1) return 'reconcile';
  return days <= 3 ? 'draft' : 'monitor';
}

export function classroomDeadline(work: { dueDate?: { year?: number | null; month?: number | null; day?: number | null } | null; dueTime?: { hours?: number | null; minutes?: number | null; seconds?: number | null } | null }): Date | null {
  if (!work.dueDate) return null;
  const { year, month, day } = work.dueDate;
  if (!year || !month || !day) throw new Error('Неповна дата дедлайну');
  if (work.dueTime) return new Date(Date.UTC(year, month - 1, day, work.dueTime.hours || 0, work.dueTime.minutes || 0, work.dueTime.seconds || 0));
  const wallClock = Date.UTC(year, month - 1, day, 23, 59, 59);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv', timeZoneName: 'longOffset' }).formatToParts(new Date(wallClock));
  const offset = parts.find(part => part.type === 'timeZoneName')!.value.match(/GMT([+-])(\d+):(\d+)/)!;
  const minutes = (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === '+' ? 1 : -1);
  return new Date(wallClock - minutes * 60000);
}
