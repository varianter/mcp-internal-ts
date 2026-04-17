import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  authHeader,
  baseURL,
  doRequest,
  formatPeriod,
  formatYearRange,
  monthNames,
  parseIntField,
  parseTags,
  type RawCV,
  type RawKeyQualification,
  type SearchResponse,
  textString,
} from '../flowcase/flowcase.js';
import { log } from '../log.js';
import { loadSecret, type SecretsLoader } from '../secrets/secrets.js';

export function registerGetCvForConsultant(server: McpServer, loader: SecretsLoader): void {
  server.tool(
    'get-cv-for-consultant',
    "Fetch a consultant's full CV from FlowCase by name. Returns a structured Markdown summary of their profile, skills, work history, projects, education, certifications, and languages.",
    {
      query: z.string().describe("Consultant's full name (e.g. 'Mikael Brevik')"),
    },
    async ({ query }) => {
      query = query.trim();
      if (!query) {
        return {
          content: [{ type: 'text', text: 'Error: query parameter is required' }],
          isError: true,
        };
      }

      log('info', 'flowcase-cv: tool called', { query });

      let apiKey: string;
      let org: string;
      try {
        apiKey = await loadSecret(loader, 'FLOWCASE_API_KEY', 'flowcase-api-key');
        org = await loadSecret(loader, 'FLOWCASE_ORG', 'flowcase-org');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log('error', 'flowcase-cv: failed to load secret', { error: msg });
        return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
      }

      log('info', 'flowcase-cv: fetching CV', { query, org });
      try {
        const md = await fetchCV(apiKey, org, query);
        return { content: [{ type: 'text', text: md }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log('error', 'flowcase-cv: fetch failed', { query, error: msg });
        return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
      }
    },
  );
}

// ── Name search payload ────────────────────────────────────────────────────────

interface NameSearchRequest {
  must: { bool: { should: { query: { field: string; value: string } }[] } }[];
  size: number;
}

// ── Fetch ──────────────────────────────────────────────────────────────────────

async function fetchCV(apiKey: string, org: string, query: string): Promise<string> {
  const api = baseURL(org);
  const auth = authHeader(apiKey);

  const payload: NameSearchRequest = {
    must: [{ bool: { should: [{ query: { field: 'name', value: query } }] } }],
    size: 5,
  };

  const searchResp = await doRequest<SearchResponse>('POST', `${api}/v4/search`, auth, payload);

  if (!searchResp.cvs || searchResp.cvs.length === 0) {
    throw new Error(`no consultant found matching "${query}" in FlowCase`);
  }

  // Prefer the CV marked as default; fall back to the first result.
  let hit = searchResp.cvs[0].cv;
  for (const h of searchResp.cvs) {
    if (h.cv.default) {
      hit = h.cv;
      break;
    }
  }

  if (!hit.user_id) {
    throw new Error('FlowCase search returned a result but user_id is empty');
  }

  const cvURL = `${api}/v3/cvs/${hit.user_id}/${hit.id}`;
  const cv = await doRequest<RawCV>('GET', cvURL, auth);

  return formatCV(cv, searchResp.cvs);
}

// ── Markdown formatter ─────────────────────────────────────────────────────────

function formatCV(cv: RawCV, allHits: SearchResponse['cvs']): string {
  const lines: string[] = [];

  lines.push(`# ${cv.name ?? ''}`);
  lines.push('');

  const title = textString(cv.title);
  if (title) lines.push(`**Title:** ${title}  `);

  if (cv.email) lines.push(`**Email:** ${cv.email}  `);

  const bornYear = parseIntField(cv.born_year);
  if (bornYear !== null) lines.push(`**Born:** ${bornYear}  `);

  if (allHits.length > 1) {
    const others = allHits
      .slice(1)
      .map((h) => (h.cv.email ? `${h.cv.name} (${h.cv.email})` : h.cv.name))
      .join(', ');
    lines.push('');
    lines.push(
      `> **Note:** ${allHits.length} matches found; showing first result. Other matches: ${others}`,
    );
  }

  // Show the starred key qualification as the main profile/summary text.
  // Fall back to the first non-disabled one if none are starred.
  const profileKQ = findProfileKQ(cv.key_qualifications ?? []);
  if (profileKQ) {
    lines.push('');
    lines.push('## Profile');
    lines.push('');
    const tagLine = textString(profileKQ.tag_line);
    if (tagLine) lines.push(`_${tagLine}_`);
    lines.push('');
    const desc = textString(profileKQ.long_description);
    if (desc) lines.push(desc);
  }

  if (cv.technologies && cv.technologies.length > 0) {
    lines.push('## Skills & Technologies');
    lines.push('');
    for (const tg of cv.technologies) {
      const cat = textString(tg.category);
      const tags: string[] = [];
      for (const item of tg.technology ?? []) {
        tags.push(...parseTags(item.tags));
      }
      if (tags.length > 0) {
        if (cat) {
          lines.push(`- **${cat}:** ${tags.join(', ')}`);
        } else {
          lines.push(`- ${tags.join(', ')}`);
        }
      }
    }
    lines.push('');
  }

  if (cv.work_experiences && cv.work_experiences.length > 0) {
    lines.push('## Work Experience');
    lines.push('');
    for (const w of cv.work_experiences) {
      const employer = textString(w.employer) || '(unknown employer)';
      const period = formatPeriod(
        w.year_from,
        w.month_from,
        w.year_to,
        w.month_to,
        w.currently_working_here ?? false,
      );
      lines.push(`### ${employer}${period ? ` (${period})` : ''}`);
      const wTitle = textString(w.title);
      if (wTitle) lines.push(`**Role:** ${wTitle}  `);
      const desc = textString(w.description);
      if (desc) lines.push(desc);
      lines.push('');
    }
  }

  if (cv.project_experiences && cv.project_experiences.length > 0) {
    lines.push('## Project Experience');
    lines.push('');
    for (const p of cv.project_experiences) {
      const customer = textString(p.customer) || '(unnamed project)';
      const period = formatPeriod(p.year_from, p.month_from, p.year_to, p.month_to, false);
      lines.push(`### ${customer}${period ? ` (${period})` : ''}`);
      const roleNames = (p.roles ?? []).map((r) => textString(r.name)).filter(Boolean);
      if (roleNames.length > 0) lines.push(`**Role:** ${roleNames.join(', ')}  `);
      const desc = textString(p.description);
      if (desc) {
        lines.push('');
        lines.push(desc);
      }
      const skillTags: string[] = [];
      for (const s of p.project_experience_skills ?? []) {
        skillTags.push(...parseTags(s.tags));
      }
      if (skillTags.length > 0) {
        lines.push('');
        lines.push(`**Technologies/Competencies:** ${skillTags.join(', ')}`);
      }
      lines.push('');
    }
  }

  if (cv.educations && cv.educations.length > 0) {
    lines.push('## Education');
    lines.push('');
    for (const e of cv.educations) {
      const parts: string[] = [];
      const degree = textString(e.degree);
      if (degree) parts.push(degree);
      const school = textString(e.school);
      if (school) parts.push(school);
      const heading = parts.length > 0 ? parts.join(', ') : '(unknown)';
      const period = formatYearRange(e.year_from, e.year_to);
      lines.push(`### ${heading}${period ? ` (${period})` : ''}`);
      const desc = textString(e.description);
      if (desc) lines.push(desc);
      lines.push('');
    }
  }

  if (cv.certifications && cv.certifications.length > 0) {
    lines.push('## Certifications');
    lines.push('');
    for (const c of cv.certifications) {
      const name = textString(c.name);
      if (!name) continue;
      lines.push(`### ${name}`);
      const org = textString(c.organizer);
      if (org) lines.push(`**Issuer:** ${org}  `);
      const year = parseIntField(c.year);
      const month = parseIntField(c.month);
      if (year !== null) {
        if (month !== null && month >= 1 && month <= 12) {
          lines.push(`**Date:** ${monthNames[month]} ${year}  `);
        } else {
          lines.push(`**Year:** ${year}  `);
        }
      }
      const desc = textString(c.long_description);
      if (desc) lines.push(desc);
      lines.push('');
    }
  }

  if (cv.presentations && cv.presentations.length > 0) {
    lines.push('## Presentations');
    lines.push('');
    for (const p of cv.presentations) {
      let desc = textString(p.description);
      if (!desc) desc = textString(p.long_description);
      if (!desc) continue;
      lines.push(`### ${desc}`);
      const year = parseIntField(p.year);
      const month = parseIntField(p.month);
      if (year !== null) {
        if (month !== null && month >= 1 && month <= 12) {
          lines.push(`**Date:** ${monthNames[month]} ${year}`);
        } else {
          lines.push(`**Year:** ${year}`);
        }
      }
      const longDesc = textString(p.long_description);
      if (longDesc && longDesc !== desc) lines.push(longDesc);
      lines.push('');
    }
  }

  if (cv.courses && cv.courses.length > 0) {
    lines.push('## Courses');
    lines.push('');
    for (const c of cv.courses) {
      const name = textString(c.name);
      if (!name) continue;
      const prog = textString(c.program);
      const year = parseIntField(c.year);
      let line = `- **${name}**`;
      if (prog) line += ` — ${prog}`;
      if (year !== null) line += ` (${year})`;
      lines.push(line);
    }
    lines.push('');
  }

  if (cv.languages && cv.languages.length > 0) {
    lines.push('## Languages');
    lines.push('');
    for (const l of cv.languages) {
      const name = textString(l.name);
      if (!name) continue;
      const level = textString(l.level);
      lines.push(`- **${name}**${level ? `: ${level}` : ''}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function findProfileKQ(kqs: RawKeyQualification[]): RawKeyQualification | null {
  let fallback: RawKeyQualification | null = null;
  for (const kq of kqs) {
    if (kq.disabled) continue;
    if (kq.starred) return kq;
    if (fallback === null) fallback = kq;
  }
  return fallback;
}
