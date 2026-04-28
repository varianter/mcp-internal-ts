import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  type FileEntry,
  GitHubClient,
  liveURL,
  repoForTarget,
} from "../github/github.js";
import { log } from "../log.js";
import { loadSecret, type SecretsLoader } from "../secrets/secrets.js";
import { errorMessage, scan } from "../secretscanner/secretscanner.js";

export function registerGithubDeployApp(
  server: McpServer,
  loader: SecretsLoader,
): void {
  server.registerTool(
    "github-deploy-app",
    {
      description: `Deploy files to apps/<app_name>/ in a Variant artifact repo via a single atomic Git commit.
Supports static HTML/CSS/JS and Vite project files. All files land in one commit — either all succeed or none.

Repo targets:
  "public"   → varianter/external-artifacts → https://share.variant.dev/<app_name>/
  "internal" → varianter/vibe-artifacts     → https://artifacts.variant.dev/<app_name>/ (Variant employees only)

Only writes inside apps/ — never touches anything else in the repo.
Commit message is "deploy: <app_name>" for new apps, "update: <app_name>" when replacing.

FILE SIZE GUIDANCE:
  Small embedded JSON (config, initial state, lookup tables) inside index.html is fine.
  For large datasets (hundreds of entries, full text blobs, etc.), keep index.html lean:
    1. Put the data in a separate "data.json" (or multiple topic files) in the files array.
    2. Load it at runtime with fetch('./data.json').then(r => r.json()).
  This avoids hitting model output and transport limits when the content is AI-generated.`,
      inputSchema: {
        app_name: z
          .string()
          .describe(
            'App identifier in kebab-case (e.g. "budget-tracker"). Becomes apps/<app_name>/ in the repo. Must not contain "/" or "..".',
          ),
        repo: z
          .enum(["public", "internal"])
          .describe(
            'Deployment target: "public" (share.variant.dev) or "internal" (artifacts.variant.dev, employees only).',
          ),
        files: z
          .string()
          .describe(
            'JSON array of files to deploy. Each entry: {"path": "relative/path/file.html", "content": "plain text content"}. Paths are relative to apps/<app_name>/ with no leading slash. Content is plain UTF-8 text. Small embedded JSON in index.html is fine; for large datasets put them in a separate data.json and load with fetch(). Example: [{"path":"index.html","content":"<html>...</html>"},{"path":"data.json","content":"[...]"}]',
          ),
        author_name: z
          .string()
          .optional()
          .describe(
            'Full name of the person deploying the app. Defaults to "Variant Bot" if omitted.',
          ),
        author_email: z
          .string()
          .optional()
          .describe(
            'Email of the person deploying the app. Defaults to "no-one@variant.no" if omitted.',
          ),
      },
    },
    async ({
      app_name,
      repo: repoTarget,
      files: filesJSON,
      author_name,
      author_email,
    }) => {
      app_name = app_name.trim();
      filesJSON = filesJSON.trim();
      const authorName = (author_name ?? "").trim() || "Variant Bot";
      const authorEmail = (author_email ?? "").trim() || "no-one@variant.no";

      // Validate app_name
      if (!app_name) {
        return {
          content: [{ type: "text", text: "app_name is required" }],
          isError: true,
        };
      }
      if (app_name.includes("..") || app_name.includes("/")) {
        return {
          content: [
            { type: "text", text: 'app_name must not contain ".." or "/"' },
          ],
          isError: true,
        };
      }

      // Parse files
      if (!filesJSON) {
        return {
          content: [{ type: "text", text: "files is required" }],
          isError: true,
        };
      }

      let entries: FileEntry[];
      try {
        entries = JSON.parse(filesJSON) as FileEntry[];
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text", text: `files must be a valid JSON array: ${msg}` },
          ],
          isError: true,
        };
      }

      if (!Array.isArray(entries) || entries.length === 0) {
        return {
          content: [
            { type: "text", text: "files must contain at least one entry" },
          ],
          isError: true,
        };
      }

      // Validate each file path
      for (const f of entries) {
        if (!f.path) {
          return {
            content: [
              {
                type: "text",
                text: "each file entry must have a non-empty path",
              },
            ],
            isError: true,
          };
        }
        if (f.path.startsWith("/") || f.path.includes("..")) {
          return {
            content: [
              {
                type: "text",
                text: `invalid file path "${f.path}": must not start with '/' or contain '..'`,
              },
            ],
            isError: true,
          };
        }
      }

      // Scan all files for hardcoded secrets before deploying to the public repo.
      if (repoTarget === "public") {
        const findings = scan(
          entries.map((e) => ({ path: e.path, content: e.content })),
        );
        if (findings.length > 0) {
          log("warn", "github-deploy-app: secrets detected, aborting", {
            app: app_name,
            repo: repoTarget,
            findings: findings.length,
          });
          return {
            content: [{ type: "text", text: errorMessage(findings) }],
            isError: true,
          };
        }
      }

      let token: string;
      try {
        token = await loadSecret(loader, "GITHUB_TOKEN", "mcp-github-token");
      } catch (e) {
        log("error", "github-deploy-app: failed to load token", {
          error: e instanceof Error ? e.message : String(e),
        });
        return {
          content: [{ type: "text", text: "GitHub token not configured" }],
          isError: true,
        };
      }

      let owner: string;
      let repoName: string;
      try {
        ({ owner, repo: repoName } = repoForTarget(repoTarget));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text", text: msg }], isError: true };
      }

      const client = new GitHubClient(token);

      // Check existence to pick commit message prefix
      log("info", "github-deploy-app: checking app existence", {
        app: app_name,
        repo: repoTarget,
      });
      let exists: boolean;
      try {
        exists = await client.appExists(owner, repoName, app_name);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log("error", "github-deploy-app: existence check failed", {
          error: msg,
        });
        return {
          content: [{ type: "text", text: `GitHub API error: ${msg}` }],
          isError: true,
        };
      }

      const commitMsg = exists ? `update: ${app_name}` : `deploy: ${app_name}`;

      log("info", "github-deploy-app: deploying", {
        app: app_name,
        repo: repoTarget,
        files: entries.length,
        new: !exists,
      });
      let result: Awaited<ReturnType<GitHubClient["deploy"]>>;
      try {
        result = await client.deploy(
          owner,
          repoName,
          app_name,
          commitMsg,
          authorName,
          authorEmail,
          entries,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log("error", "github-deploy-app: deploy failed", { error: msg });
        return {
          content: [{ type: "text", text: `Deploy failed: ${msg}` }],
          isError: true,
        };
      }

      const action = exists ? "Updated" : "Deployed";
      const appLiveURL = liveURL(repoTarget, app_name);

      const isVite = entries.some(
        (f) => f.path.startsWith("vite.config") || f.path === "package.json",
      );

      const lines: string[] = [];
      lines.push(`## ${action}: \`${app_name}\``);
      lines.push("");
      lines.push(`**Live URL:** ${appLiveURL}`);
      lines.push("");
      lines.push(
        `**Commit:** [${result.commitSHA.slice(0, 8)}](${result.commitURL})`,
      );
      lines.push("");
      lines.push(`**Files deployed (${result.files.length}):**`);
      for (const f of result.files) {
        lines.push(`- \`${f}\``);
      }
      if (repoTarget === "internal") {
        lines.push("");
        lines.push("_Access requires Variant employee login._");
      } else {
        lines.push("");
        lines.push("_It may take a moment for changes to propagate._");
      }
      if (isVite) {
        lines.push(
          "_Vite project detected — the platform will build it automatically (takes a minute or two)._",
        );
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
