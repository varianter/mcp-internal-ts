// secretscanner detects hardcoded secrets in files before public deployment.

interface Pattern {
  name: string;
  re: RegExp;
}

const patterns: Pattern[] = [
  // GitHub personal access tokens (classic and fine-grained)
  { name: 'GitHub PAT (classic)', re: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'GitHub PAT (fine-grained)', re: /github_pat_[A-Za-z0-9_]{82}/ },
  { name: 'GitHub OAuth token', re: /gho_[A-Za-z0-9]{36}/ },
  { name: 'GitHub Actions token', re: /ghs_[A-Za-z0-9]{36}/ },

  // HubSpot tokens
  {
    name: 'HubSpot Private App token',
    re: /pat-[a-z]{2,3}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
  },
  {
    name: 'HubSpot API key',
    re: /hubspot[_-]?(?:api[_-]?)?key\s*[:=]\s*["']?([A-Za-z0-9-]{20,})["']?/i,
  },

  // AWS
  { name: 'AWS Access Key ID', re: /AKIA[0-9A-Z]{16}/ },
  {
    name: 'AWS Secret Access Key',
    re: /aws[_-]?secret[_-]?(?:access[_-]?)?key\s*[:=]\s*["']?([A-Za-z0-9/+]{40})["']?/i,
  },

  // Generic high-value secret assignments in code/config
  {
    name: 'bearer token assignment',
    re: /(?:authorization|auth)\s*[:=]\s*["']?bearer\s+([A-Za-z0-9\-._~+/]{20,})["']?/i,
  },
  {
    name: 'API key assignment',
    re: /(?:api[_-]?key|apikey|access[_-]?key)\s*[:=]\s*["']([A-Za-z0-9\-._]{20,})["']/i,
  },
  {
    name: 'secret/token assignment',
    re: /(?:secret|private[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*["']([A-Za-z0-9\-._+/]{20,})["']/i,
  },
  { name: 'password assignment', re: /password\s*[:=]\s*["']([^"']{8,})["']/i },
];

export interface Finding {
  file: string;
  kind: string;
  excerpt: string;
}

export interface ScannedFile {
  path: string;
  content: string;
}

// scan checks every file for hardcoded secrets and returns all findings.
export function scan(files: ScannedFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const f of files) {
    for (const p of patterns) {
      const match = p.re.exec(f.content);
      if (match) {
        findings.push({
          file: f.path,
          kind: p.name,
          excerpt: redact(match[0]),
        });
      }
    }
  }
  return findings;
}

// errorMessage builds a human-readable error string from a list of findings.
export function errorMessage(findings: Finding[]): string {
  const lines = [
    'Deployment aborted: potential secrets detected in files to be deployed.',
    '',
    'Remove all credentials, tokens, and API keys from the source files before deploying.',
    '',
    'Findings:',
  ];
  for (const f of findings) {
    lines.push(`  - ${f.kind}: ${f.excerpt} (in \`${f.file}\`)`);
  }
  lines.push('');
  lines.push(
    'Never commit secrets to a repository. Use environment variables or a secrets manager instead.',
  );
  return lines.join('\n');
}

// redact replaces the middle portion of a matched secret with asterisks.
function redact(s: string): string {
  if (s.length <= 8) return '*'.repeat(s.length);
  return s.slice(0, 4) + '*'.repeat(s.length - 8) + s.slice(s.length - 4);
}
