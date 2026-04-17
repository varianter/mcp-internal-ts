// Package github provides a minimal client for the GitHub Git Data API,
// scoped to deploying static files into the varianter artifact repos.

import { z } from 'zod';

const repoOwner = 'varianter';
const repoPublic = 'external-artifacts';
const repoInternal = 'vibe-artifacts';
const urlPublic = 'https://share.variant.dev';
const urlInternal = 'https://artifacts.variant.dev';
const apiBase = 'https://api.github.com';
const branch = 'main';

// repoForTarget maps "public" / "internal" to owner + repo name.
export function repoForTarget(target: string): { owner: string; repo: string } {
  switch (target) {
    case 'public':
      return { owner: repoOwner, repo: repoPublic };
    case 'internal':
      return { owner: repoOwner, repo: repoInternal };
    default:
      throw new Error(`unknown repo target "${target}": must be "public" or "internal"`);
  }
}

// liveURL returns the hosting URL for the given target and app name.
export function liveURL(target: string, appName: string): string {
  const base = target === 'public' ? urlPublic : urlInternal;
  return `${base}/${appName}/`;
}

export interface FileEntry {
  path: string;
  content: string;
}

export interface DeployResult {
  commitSHA: string;
  commitURL: string;
  files: string[];
}

// ── GitHub API response schemas ────────────────────────────────────────────────

const RefResponseSchema = z.object({
  object: z.object({
    sha: z.string(),
  }),
});

const CommitResponseSchema = z.object({
  tree: z.object({
    sha: z.string(),
  }),
});

const ShaResponseSchema = z.object({
  sha: z.string(),
});

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}

export class GitHubClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  // appExists reports whether apps/<appName>/ already exists in the repo.
  async appExists(owner: string, repo: string, appName: string): Promise<boolean> {
    const url = `${apiBase}/repos/${owner}/${repo}/contents/apps/${appName}`;
    const resp = await fetch(url, { headers: this.headers() });
    // Drain body to free connection
    await resp.text();
    if (resp.status === 200) return true;
    if (resp.status === 404) return false;
    throw new Error(`unexpected HTTP ${resp.status} checking app existence`);
  }

  // deploy creates or replaces files under apps/<appName>/ in a single atomic commit.
  async deploy(
    owner: string,
    repo: string,
    appName: string,
    commitMsg: string,
    authorName: string,
    authorEmail: string,
    files: FileEntry[],
  ): Promise<DeployResult> {
    // Step 1+2: get HEAD commit SHA and its tree SHA
    const { commitSHA: headCommitSHA, treeSHA: headTreeSHA } = await this.headSHA(owner, repo);

    // Step 3: create blobs concurrently
    const blobResults = await Promise.all(
      files.map(async (f) => {
        const sha = await this.createBlob(owner, repo, f.content);
        return { path: `apps/${appName}/${f.path}`, sha };
      }),
    );

    // Step 4: create tree
    const treeSHA = await this.createTree(owner, repo, headTreeSHA, blobResults);

    // Step 5: create commit
    const newCommitSHA = await this.createCommit(
      owner,
      repo,
      commitMsg,
      treeSHA,
      headCommitSHA,
      authorName,
      authorEmail,
    );

    // Step 6: fast-forward branch ref
    await this.updateRef(owner, repo, newCommitSHA);

    return {
      commitSHA: newCommitSHA,
      commitURL: `https://github.com/${owner}/${repo}/commit/${newCommitSHA}`,
      files: files.map((f) => f.path),
    };
  }

  private async headSHA(
    owner: string,
    repo: string,
  ): Promise<{ commitSHA: string; treeSHA: string }> {
    const refResp = await this.request(
      'GET',
      `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
      RefResponseSchema,
    );
    const commitSHA = refResp.object.sha;

    const commitResp = await this.request(
      'GET',
      `/repos/${owner}/${repo}/git/commits/${commitSHA}`,
      CommitResponseSchema,
    );
    return { commitSHA, treeSHA: commitResp.tree.sha };
  }

  private async createBlob(owner: string, repo: string, content: string): Promise<string> {
    const resp = await this.request(
      'POST',
      `/repos/${owner}/${repo}/git/blobs`,
      ShaResponseSchema,
      { content: Buffer.from(content).toString('base64'), encoding: 'base64' },
    );
    return resp.sha;
  }

  private async createTree(
    owner: string,
    repo: string,
    baseTreeSHA: string,
    blobs: { path: string; sha: string }[],
  ): Promise<string> {
    const resp = await this.request(
      'POST',
      `/repos/${owner}/${repo}/git/trees`,
      ShaResponseSchema,
      {
        base_tree: baseTreeSHA,
        tree: blobs.map((b) => ({
          path: b.path,
          mode: '100644',
          type: 'blob',
          sha: b.sha,
        })),
      },
    );
    return resp.sha;
  }

  private async createCommit(
    owner: string,
    repo: string,
    message: string,
    treeSHA: string,
    parentSHA: string,
    authorName: string,
    authorEmail: string,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      message,
      tree: treeSHA,
      parents: [parentSHA],
    };
    if (authorName && authorEmail) {
      body.author = { name: authorName, email: authorEmail };
    }
    const resp = await this.request(
      'POST',
      `/repos/${owner}/${repo}/git/commits`,
      ShaResponseSchema,
      body,
    );
    return resp.sha;
  }

  private async updateRef(owner: string, repo: string, commitSHA: string): Promise<void> {
    await this.request('PATCH', `/repos/${owner}/${repo}/git/refs/heads/${branch}`, z.unknown(), {
      sha: commitSHA,
      force: false,
    });
  }

  private async request<S extends z.ZodTypeAny>(
    method: string,
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<z.infer<S>> {
    const url = `${apiBase}${path}`;
    const init: RequestInit = {
      method,
      headers: this.headers(),
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const resp = await fetch(url, init);
    const text = await resp.text();

    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`HTTP ${resp.status}: ${truncate(text, 300)}`);
    }

    if (!text) return schema.parse(undefined);
    return schema.parse(JSON.parse(text));
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    };
  }
}
