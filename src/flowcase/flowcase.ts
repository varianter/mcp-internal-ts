// Package flowcase provides a client for the FlowCase CV API.
// It handles JSON parsing of FlowCase's inconsistent field types,
// HTTP communication, and shared formatting helpers.

import { z } from 'zod';

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

export async function doRequest<S extends z.ZodTypeAny>(
  method: string,
  url: string,
  auth: string,
  schema: S,
  body?: unknown,
): Promise<z.infer<S>> {
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

  return schema.parse(JSON.parse(text));
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

// ── Search API schemas ─────────────────────────────────────────────────────────

export const SearchCVSchema = z.object({
  user_id: z.string(),
  id: z.string(),
  name: z.string(),
  email: z.string(),
  default: z.boolean().optional(),
  title: z.unknown(), // Text (localised or plain string)
});

export const SearchHitSchema = z.object({
  cv: SearchCVSchema,
});

export const SearchResponseSchema = z.object({
  cvs: z.array(SearchHitSchema),
});

export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type SearchHit = z.infer<typeof SearchHitSchema>;
export type SearchCV = z.infer<typeof SearchCVSchema>;

// ── CV detail schemas ──────────────────────────────────────────────────────────
// All polymorphic fields (Int, Text, Tags) use z.unknown() and are accessed
// via parseIntField(), textString(), and parseTags().

export const RawKeyQualificationSchema = z.object({
  label: z.unknown().optional(),
  long_description: z.unknown().optional(),
  tag_line: z.unknown().optional(),
  starred: z.boolean().optional(),
  disabled: z.boolean().optional(),
});

export const RawTechItemSchema = z.object({
  tags: z.unknown().optional(),
});

export const RawTechnologyGroupSchema = z.object({
  category: z.unknown().optional(),
  technology: z.array(RawTechItemSchema).optional(),
});

export const RawWorkExperienceSchema = z.object({
  employer: z.unknown().optional(),
  title: z.unknown().optional(),
  description: z.unknown().optional(),
  year_from: z.unknown().optional(),
  month_from: z.unknown().optional(),
  year_to: z.unknown().optional(),
  month_to: z.unknown().optional(),
  currently_working_here: z.boolean().optional(),
});

export const RawRoleSchema = z.object({
  name: z.unknown().optional(),
});

export const RawProjSkillSchema = z.object({
  tags: z.unknown().optional(),
});

export const RawProjectExpSchema = z.object({
  customer: z.unknown().optional(),
  description: z.unknown().optional(),
  roles: z.array(RawRoleSchema).optional(),
  year_from: z.unknown().optional(),
  month_from: z.unknown().optional(),
  year_to: z.unknown().optional(),
  month_to: z.unknown().optional(),
  project_experience_skills: z.array(RawProjSkillSchema).optional(),
});

export const RawEducationSchema = z.object({
  school: z.unknown().optional(),
  degree: z.unknown().optional(),
  description: z.unknown().optional(),
  year_from: z.unknown().optional(),
  year_to: z.unknown().optional(),
});

export const RawCertificationSchema = z.object({
  name: z.unknown().optional(),
  organizer: z.unknown().optional(),
  long_description: z.unknown().optional(),
  year: z.unknown().optional(),
  month: z.unknown().optional(),
});

export const RawPresentationSchema = z.object({
  description: z.unknown().optional(),
  long_description: z.unknown().optional(),
  year: z.unknown().optional(),
  month: z.unknown().optional(),
});

export const RawLanguageSchema = z.object({
  name: z.unknown().optional(),
  level: z.unknown().optional(),
});

export const RawCourseSchema = z.object({
  name: z.unknown().optional(),
  program: z.unknown().optional(),
  year: z.unknown().optional(),
});

export const RawCVSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  title: z.unknown().optional(),
  born_year: z.unknown().optional(),
  key_qualifications: z.array(RawKeyQualificationSchema).optional(),
  technologies: z.array(RawTechnologyGroupSchema).optional(),
  work_experiences: z.array(RawWorkExperienceSchema).optional(),
  project_experiences: z.array(RawProjectExpSchema).optional(),
  educations: z.array(RawEducationSchema).optional(),
  certifications: z.array(RawCertificationSchema).optional(),
  presentations: z.array(RawPresentationSchema).optional(),
  languages: z.array(RawLanguageSchema).optional(),
  courses: z.array(RawCourseSchema).optional(),
});

export type RawCV = z.infer<typeof RawCVSchema>;
export type RawKeyQualification = z.infer<typeof RawKeyQualificationSchema>;
export type RawTechnologyGroup = z.infer<typeof RawTechnologyGroupSchema>;
export type RawTechItem = z.infer<typeof RawTechItemSchema>;
export type RawWorkExperience = z.infer<typeof RawWorkExperienceSchema>;
export type RawProjectExp = z.infer<typeof RawProjectExpSchema>;
export type RawRole = z.infer<typeof RawRoleSchema>;
export type RawProjSkill = z.infer<typeof RawProjSkillSchema>;
export type RawEducation = z.infer<typeof RawEducationSchema>;
export type RawCertification = z.infer<typeof RawCertificationSchema>;
export type RawPresentation = z.infer<typeof RawPresentationSchema>;
export type RawLanguage = z.infer<typeof RawLanguageSchema>;
export type RawCourse = z.infer<typeof RawCourseSchema>;

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
