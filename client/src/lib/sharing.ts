import { FieldInstallation } from '../types';

interface SharePayload {
  v: number;
  installations: FieldInstallation[];
  dateStr: string;
}

export function encodeShare(installations: FieldInstallation[], dateStr: string): string {
  const payload: SharePayload = { v: 1, installations, dateStr };
  const json = JSON.stringify(payload);
  // encodeURIComponent converts Unicode (Japanese) to ASCII %XX before btoa
  const b64 = btoa(encodeURIComponent(json))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = 'share=' + b64;
  return url.toString();
}

export function decodeShare(hash: string): { installations: FieldInstallation[]; dateStr: string } | null {
  try {
    const m = hash.replace(/^#/, '').match(/^share=(.+)$/);
    if (!m) return null;
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    const padded = pad ? b64 + '='.repeat(4 - pad) : b64;
    const json = decodeURIComponent(atob(padded));
    const data = JSON.parse(json) as SharePayload;
    if (!Array.isArray(data.installations) || data.installations.length === 0) return null;
    return { installations: data.installations, dateStr: data.dateStr ?? '' };
  } catch {
    return null;
  }
}
