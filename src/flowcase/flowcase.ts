// Package flowcase provides a client for the FlowCase CV API.
// It handles JSON parsing of FlowCase's inconsistent field types,
// HTTP communication, and shared formatting helpers.

// ── HTTP helpers ───────────────────────────────────────────────────────────────

export function baseURL(org: string): string {
  return `https://${org}.flowcase.com/api`;
}

// authHeader returns the Authorization header value for the given API key.
// FlowCase uses: Token token="<key>"
export function authHeader(apiKey: string): string {
  return `Token token="${apiKey}"`;
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}

export async function doRequest<T>(
  method: string,
  url: string,
  auth: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const resp = await fetch(url, init);
  const text = await resp.text();

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${truncate(text, 200)}`);
  }

  return JSON.parse(text) as T;
}

// ── Custom type parsers ────────────────────────────────────────────────────────
// FlowCase returns inconsistent field types depending on endpoint/version.
// These helpers normalise the polymorphic fields at parse time.

// parseIntField handles fields that can be a JSON number, a numeric string, or null.
export function parseIntField(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    if (val === '') return null;
    const n = parseInt(val, 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

// parseTags handles tag fields that can be a string[] or a Record<string,string>.
export function parseTags(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val.filter((s): s is string => typeof s === 'string');
  }
  if (val !== null && typeof val === 'object') {
    return Object.values(val as Record<string, string>).filter((s) => s !== '');
  }
  return [];
}

// textString extracts the best string from a localised text field.
// FlowCase stores localised text as {no, en, int} but some endpoints return plain strings.
export function textString(val: unknown): string {
  if (typeof val === 'string') return val;
  if (val !== null && typeof val === 'object') {
    const t = val as { no?: string; en?: string; int?: string };
    return t.en ?? t.int ?? t.no ?? '';
  }
  return '';
}

// ── Search API types ───────────────────────────────────────────────────────────

export interface SearchResponse {
  cvs: SearchHit[];
}

export interface SearchHit {
  cv: SearchCV;
}

export interface SearchCV {
  user_id: string;
  id: string;
  name: string;
  email: string;
  default: boolean;
  title: unknown; // Text
}

// ── CV detail types ────────────────────────────────────────────────────────────
// All fields use `unknown` for the polymorphic types (Int, Text, Tags).
// Use parseIntField(), textString(), and parseTags() to access them.

export interface RawCV {
  name?: string;
  email?: string;
  title?: unknown;
  born_year?: unknown;
  key_qualifications?: RawKeyQualification[];
  technologies?: RawTechnologyGroup[];
  work_experiences?: RawWorkExperience[];
  project_experiences?: RawProjectExp[];
  educations?: RawEducation[];
  certifications?: RawCertification[];
  presentations?: RawPresentation[];
  languages?: RawLanguage[];
  courses?: RawCourse[];
}

export interface RawKeyQualification {
  label?: unknown;
  long_description?: unknown;
  tag_line?: unknown;
  starred?: boolean;
  disabled?: boolean;
}

export interface RawTechnologyGroup {
  category?: unknown;
  technology?: RawTechItem[];
}

export interface RawTechItem {
  tags?: unknown;
}

export interface RawWorkExperience {
  employer?: unknown;
  title?: unknown;
  description?: unknown;
  year_from?: unknown;
  month_from?: unknown;
  year_to?: unknown;
  month_to?: unknown;
  currently_working_here?: boolean;
}

export interface RawProjectExp {
  customer?: unknown;
  description?: unknown;
  roles?: RawRole[];
  year_from?: unknown;
  month_from?: unknown;
  year_to?: unknown;
  month_to?: unknown;
  project_experience_skills?: RawProjSkill[];
}

export interface RawRole {
  name?: unknown;
}

export interface RawProjSkill {
  tags?: unknown;
}

export interface RawEducation {
  school?: unknown;
  degree?: unknown;
  description?: unknown;
  year_from?: unknown;
  year_to?: unknown;
}

export interface RawCertification {
  name?: unknown;
  organizer?: unknown;
  long_description?: unknown;
  year?: unknown;
  month?: unknown;
}

export interface RawPresentation {
  description?: unknown;
  long_description?: unknown;
  year?: unknown;
  month?: unknown;
}

export interface RawLanguage {
  name?: unknown;
  level?: unknown;
}

export interface RawCourse {
  name?: unknown;
  program?: unknown;
  year?: unknown;
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

export const monthNames = [
  '',
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function formatPeriod(
  yearFrom: unknown,
  monthFrom: unknown,
  yearTo: unknown,
  monthTo: unknown,
  current: boolean,
): string {
  const yf = parseIntField(yearFrom);
  const mf = parseIntField(monthFrom);
  const yt = parseIntField(yearTo);
  const mt = parseIntField(monthTo);

  let from = '';
  if (yf !== null) {
    if (mf !== null && mf >= 1 && mf <= 12) {
      from = `${monthNames[mf]} ${yf}`;
    } else {
      from = `${yf}`;
    }
  }

  let to = '';
  if (current) {
    to = 'Present';
  } else if (yt !== null) {
    if (mt !== null && mt >= 1 && mt <= 12) {
      to = `${monthNames[mt]} ${yt}`;
    } else {
      to = `${yt}`;
    }
  }

  if (from && to) return `${from} – ${to}`;
  if (from) return from;
  if (to) return `– ${to}`;
  return '';
}

export function formatYearRange(from: unknown, to: unknown): string {
  const f = parseIntField(from);
  const t = parseIntField(to);
  if (f !== null && t !== null) return `${f} – ${t}`;
  if (f !== null) return `${f}`;
  if (t !== null) return `– ${t}`;
  return '';
}
