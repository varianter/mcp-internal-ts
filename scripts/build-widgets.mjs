import { readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2).join(' ');

const widgets = readdirSync('widgets', { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

for (const widget of widgets) {
  console.log(`Building widget: ${widget}`);
  execSync(`vite build ${args}`, {
    env: { ...process.env, WIDGET: widget },
    stdio: 'inherit',
  });
}
