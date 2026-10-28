import { readFileSync } from 'node:fs';
const expectedVersion = readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();
const [base, revision, environment] = process.argv.slice(2);
if (!base || !revision || !environment) throw new Error('Usage: verify-deployment.mjs <url> <revision> <environment>');
let failure;
for (let attempt = 0; attempt < 6; attempt++) {
  try {
    const response = await fetch(`${base}/api/health`, { cache: 'no-store' });
    const health = await response.json();
    if (!response.ok || health.status !== 'ok' || health.revision !== revision || health.environment !== environment || health.version !== expectedVersion || health.contract !== 'utsp-studio/0.03') throw new Error(`Health mismatch: ${JSON.stringify(health)}`);
    const privateResponse = await fetch(`${base}/api/overview`, { redirect: 'manual' });
    if (privateResponse.status !== 401) throw new Error('Private Studio API is not protected');
    const page = await fetch(base);
    const html = await page.text();
    if (!page.ok || !html.includes('id="root"') || !html.includes('/assets/')) throw new Error('Studio frontend is missing');
    const script = html.match(/src="([^\"]+\.js)"/);
    if (!script || !(await fetch(new URL(script[1], base))).ok) throw new Error('Frontend bundle cannot be read');
    console.log(JSON.stringify({ verified: true, version: expectedVersion, environment, revision, url: base, contract: health.contract }));
    process.exit(0);
  } catch (error) { failure = error; }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
throw failure;
