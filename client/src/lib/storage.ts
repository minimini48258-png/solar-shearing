import { DesignCase } from '../types';

const KEY = 'solar-sharing-designs';

export function loadDesigns(): DesignCase[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DesignCase[]) : [];
  } catch {
    return [];
  }
}

export function saveDesigns(cases: DesignCase[]): void {
  localStorage.setItem(KEY, JSON.stringify(cases));
}

export function addDesign(cases: DesignCase[], item: DesignCase): DesignCase[] {
  const next = [...cases, item];
  saveDesigns(next);
  return next;
}

export function deleteDesign(cases: DesignCase[], id: string): DesignCase[] {
  const next = cases.filter((c) => c.id !== id);
  saveDesigns(next);
  return next;
}
