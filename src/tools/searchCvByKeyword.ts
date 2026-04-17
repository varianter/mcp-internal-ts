import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  authHeader,
  baseURL,
  doRequest,
  parseIntField,
  parseTags,
  type RawCV,
  type RawProjectExp,
  type SearchResponse,
} from '../flowcase/flowcase.js';
import { log } from '../log.js';
import { loadSecret, type SecretsLoader } from '../secrets/secrets.js';

const RESULTS_PER_SKILL = 200;
const MAX_RESULTS = 30;

interface SearchCandidate {
  userId: string;
  cvId: string;
  name: string;
  email: string;
  title: string;
  matchedSkills: string[];
  techYears: Record<string, number>;
  totalYears: number;
}

export function registerSearchCvByKeyword(server: McpServer, loader: SecretsLoader): void {
  server.tool(
    'search-cv-by-keyword',
    'Search FlowCase for consultants matching a list of technology or skill keywords. Returns consultants ranked by total years of experience with the requested technologies.',
    {
      keywords: z
        .string()
        .describe(
          "Comma-separated list of technologies or skills to search for (e.g. 'React, Kubernetes, PostgreSQL')",
        ),
    },
    async ({ keywords: raw }) => {
      raw = raw.trim();
      if (!raw) {
        return {
          content: [{ type: 'text', text: 'Error: keywords parameter is required' }],
          isError: true,
        };
      }

      const keywords = raw
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);

      if (keywords.length === 0) {
        return {
          content: [{ type: 'text', text: 'Error: at least one keyword is required' }],
          isError: true,
        };
      }

      log('info', 'flowcase-search: tool called', { keywords });

      let apiKey: string;
      let org: string;
      try {
        apiKey = await loadSecret(loader, 'FLOWCASE_API_KEY', 'flowcase-api-key');
        org = await loadSecret(loader, 'FLOWCASE_ORG', 'flowcase-org');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log('error', 'flowcase-search: failed to load secret', { error: msg });
        return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
      }

      try {
        const ranked = await searchByKeywords(baseURL(org), authHeader(apiKey), keywords);
        return { content: [{ type: 'text', text: formatSearchResults(ranked, keywords) }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log('error', 'flowcase-search: search failed', { error: msg });
        return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
      }
    },
  );
}

// ── Search payload types ───────────────────────────────────────────────────────

interface TagSearchRequest {
  must: { technology_skill: { tag: string } }[];
  size: number;
}

interface QuerySearchRequest {
  must: { query: { value: string } }[];
  size: number;
}

// ── Core search logic ──────────────────────────────────────────────────────────

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function searchByKeywords(
  api: string,
  auth: string,
  keywords: string[],
): Promise<SearchCandidate[]> {
  // Collect all unique consultants across all keywords
  const hitsByUser = new Map<
    string,
    { userId: string; cvId: string; name: string; email: string; title: string }
  >();
  const matchedSkills = new Map<string, Set<string>>();

  for (const skill of keywords) {
    log('info', 'flowcase-search: searching skill', { skill });
    let hits: SearchResponse['cvs'];
    try {
      hits = await searchSkill(api, auth, skill);
    } catch (e) {
      log('warn', 'flowcase-search: skill search failed, skipping', {
        skill,
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    for (const hit of hits) {
      const uid = hit.cv.user_id;
      if (!uid) continue;
      if (!hitsByUser.has(uid)) {
        hitsByUser.set(uid, {
          userId: uid,
          cvId: hit.cv.id,
          name: hit.cv.name,
          email: hit.cv.email,
          title: typeof hit.cv.title === 'string' ? hit.cv.title : '',
        });
      }
      if (!matchedSkills.has(uid)) matchedSkills.set(uid, new Set());
      matchedSkills.get(uid)?.add(skill);
    }
  }

  const candidates: SearchCandidate[] = [];
  for (const [uid, entry] of hitsByUser) {
    const skills = [...(matchedSkills.get(uid) ?? [])].sort();
    candidates.push({
      userId: uid,
      cvId: entry.cvId,
      name: entry.name,
      email: entry.email,
      title: entry.title,
      matchedSkills: skills,
      techYears: {},
      totalYears: 0,
    });
  }

  // Fetch full CVs rate-limited to ~5 req/s to stay under FlowCase's HTTP 429 limit.
  const currentYear = new Date().getFullYear();

  for (let i = 0; i < candidates.length; i++) {
    if (i > 0) await delay(200);
    const c = candidates[i];
    const cvURL = `${api}/v3/cvs/${c.userId}/${c.cvId}`;
    let cv: RawCV;
    try {
      cv = await fetchCVWithRetry(cvURL, auth);
    } catch (e) {
      log('warn', 'flowcase-search: CV fetch failed', {
        user: c.name,
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
    const { techYears, total } = scoreCV(cv, keywords, currentYear);
    candidates[i].techYears = techYears;
    candidates[i].totalYears = total;
  }

  candidates.sort((a, b) => {
    if (b.totalYears !== a.totalYears) return b.totalYears - a.totalYears;
    return a.name.localeCompare(b.name);
  });

  return candidates.slice(0, MAX_RESULTS);
}

// fetchCVWithRetry fetches a CV, retrying up to 3 times on HTTP 429 responses.
async function fetchCVWithRetry(cvURL: string, auth: string): Promise<RawCV> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await delay((attempt + 1) * 1000);
    }
    try {
      return await doRequest<RawCV>('GET', cvURL, auth);
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('429')) break;
    }
  }
  throw lastErr;
}

// scoreCV computes years of experience per keyword by collecting project date
// intervals, merging overlaps, then summing.
function scoreCV(
  cv: RawCV,
  keywords: string[],
  currentYear: number,
): { techYears: Record<string, number>; total: number } {
  const techYears: Record<string, number> = {};
  let total = 0;

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    const intervals: [number, number][] = [];

    for (const proj of cv.project_experiences ?? []) {
      if (!projectHasSkill(proj, kwLower)) continue;
      const yearFrom = parseIntField(proj.year_from);
      if (yearFrom === null) continue;
      const yearTo = parseIntField(proj.year_to) ?? currentYear;
      if (yearTo > yearFrom) {
        intervals.push([yearFrom, yearTo]);
      }
    }

    const years = mergedYears(intervals);
    techYears[kw] = years;
    total += years;
  }

  return { techYears, total };
}

// mergedYears sorts intervals, merges overlaps, and returns the total span in years.
function mergedYears(intervals: [number, number][]): number {
  if (intervals.length === 0) return 0;
  intervals.sort((a, b) => a[0] - b[0]);

  const merged: [number, number][] = [intervals[0]];
  for (const iv of intervals.slice(1)) {
    const last = merged[merged.length - 1];
    if (iv[0] <= last[1]) {
      if (iv[1] > last[1]) last[1] = iv[1];
    } else {
      merged.push(iv);
    }
  }

  return merged.reduce((sum, iv) => sum + (iv[1] - iv[0]), 0);
}

// projectHasSkill reports whether any skill tag in the project matches kw
// (case-insensitive substring in either direction).
function projectHasSkill(proj: RawProjectExp, kwLower: string): boolean {
  for (const skill of proj.project_experience_skills ?? []) {
    for (const tag of parseTags(skill.tags)) {
      if (tag.toLowerCase().includes(kwLower)) return true;
    }
  }
  return false;
}

async function searchSkill(
  api: string,
  auth: string,
  skill: string,
): Promise<SearchResponse['cvs']> {
  // FlowCase tag search is case-sensitive, so try original and title-cased variant.
  const variants = [skill];
  const titled = titleCase(skill);
  if (titled !== skill) variants.push(titled);

  const seen = new Set<string>();
  const tagHits: SearchResponse['cvs'] = [];

  for (const v of variants) {
    const tagPayload: TagSearchRequest = {
      must: [{ technology_skill: { tag: v } }],
      size: RESULTS_PER_SKILL,
    };
    const resp = await doRequest<SearchResponse>('POST', `${api}/v4/search`, auth, tagPayload);
    for (const h of resp.cvs ?? []) {
      if (!seen.has(h.cv.user_id)) {
        seen.add(h.cv.user_id);
        tagHits.push(h);
      }
    }
  }

  if (tagHits.length > 0) return tagHits;

  // Fallback: free-text query search.
  const queryPayload: QuerySearchRequest = {
    must: [{ query: { value: skill } }],
    size: RESULTS_PER_SKILL,
  };
  const resp = await doRequest<SearchResponse>('POST', `${api}/v4/search`, auth, queryPayload);
  return resp.cvs ?? [];
}

// titleCase capitalises the first letter of each word.
function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

// ── Formatter ──────────────────────────────────────────────────────────────────

function formatSearchResults(candidates: SearchCandidate[], keywords: string[]): string {
  const lines: string[] = [];

  lines.push('# Consultant search results');
  lines.push('');
  lines.push(`**Keywords searched:** ${keywords.join(', ')}`);
  lines.push('');

  if (candidates.length === 0) {
    lines.push('No consultants found matching the given keywords.');
    return lines.join('\n');
  }

  lines.push(`Found **${candidates.length}** consultants (ranked by total years of experience):`);
  lines.push('');

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    lines.push(`## ${i + 1}. ${c.name}`);
    const techParts = keywords.map((kw) => `${kw} (${c.techYears[kw] ?? 0} years)`);
    lines.push(`**Experience:** ${techParts.join(', ')}  `);
    lines.push(`**Total:** ${c.totalYears} years`);
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
