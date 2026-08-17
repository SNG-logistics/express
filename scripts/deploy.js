/**
 * scripts/deploy.js — one-command deploy for Hostinger (Plesk / Phusion Passenger).
 *
 *   npm run deploy
 *
 * Steps: pull latest code → install prod deps → run DB migrations →
 * ensure runtime dirs → restart Passenger (touch tmp/restart.txt).
 *
 * Design goals (why this is resilient):
 *  - CRITICAL steps (deps, core DB migration) fail loud and stop the deploy.
 *  - NON-CRITICAL steps (CRM migration, pulling code) only warn — a hiccup
 *    there must never leave the site un-restarted on old code.
 *  - The Passenger restart ALWAYS runs if the critical steps passed, so a
 *    successful deploy is a running deploy.
 *
 * Why this doesn't use `git pull`:
 *  This host has repeatedly had unreliable SSH/git access (broken shell,
 *  no .git directory present at all on the deployed copy — files were
 *  originally uploaded, not cloned). Instead this downloads the GitHub
 *  tarball for the target branch straight over HTTPS (public repo, no auth
 *  needed) and extracts it over the current directory. `tar -x` only writes
 *  the paths present in the archive, so anything not tracked in the repo
 *  (node_modules, .env, public/uploads, logs, tmp, auth_info_baileys, ...)
 *  is left completely untouched — same effective result as `git reset
 *  --hard`, minus the dependency on git being installed/reachable.
 *
 * Env toggles (handy for re-runs / debugging on the server):
 *   SKIP_PULL=1     skip downloading/extracting code (e.g. re-run migrations only)
 *   SKIP_INSTALL=1  skip npm install (deps already up to date)
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const REPO = 'SNG-logistics/express';
const BRANCH = 'main';
const MARKER_FILE = path.join(rootDir, '.deployed_commit');

const warnings = [];
let codeUpdated = null; // null = pull step skipped entirely; true/false once attempted

/** Run a shell command. When fatal, a failure aborts the deploy. */
function run(label, cmd, { fatal = true } = {}) {
  process.stdout.write(`\n▶ ${label}\n   $ ${cmd}\n`);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: rootDir });
    return true;
  } catch (err) {
    // stdio:'inherit' already streamed the command's own stderr live, but the
    // exception message (exit code, signal) was previously only printed on
    // fatal failures — a non-fatal failure used to vanish into a vague
    // "continuing" line with no way to tell WHY it failed after the fact.
    if (fatal) {
      console.error(`\n❌ ${label} failed — aborting deploy.`);
      console.error(`   ${err.message}`);
      process.exit(1);
    }
    console.warn(`\n⚠️  ${label} failed (non-critical) — continuing.`);
    console.warn(`   ${err.message}`);
    warnings.push(label);
    return false;
  }
}

/** GET a URL and parse the response as JSON. Follows redirects. */
function fetchJson(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'sng-logistics-deploy' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        resolve(fetchJson(res.headers.location, redirectsLeft - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (err) { reject(err); }
      });
    }).on('error', reject);
  });
}

/** Download a URL straight to a local file. Follows redirects (codeload issues one). */
function downloadFile(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'sng-logistics-deploy' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        resolve(downloadFile(res.headers.location, destPath, redirectsLeft - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
        return;
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Pull latest code without git. Compares the latest commit SHA on GitHub
 * against a local marker file (written on the previous successful deploy)
 * to decide whether a download is even needed, then downloads + extracts.
 */
async function pullLatestCode() {
  if (process.env.SKIP_PULL === '1') {
    console.warn('\n⚠️⚠️⚠️  SKIP_PULL=1 is set — code will NOT be updated this run.');
    console.warn('   If you did not mean to set this, unset it before deploying.');
    return;
  }

  // Option A: If .git folder exists, try standard git pull first
  if (fs.existsSync(path.join(rootDir, '.git'))) {
    console.log(`\n▶ Pull: .git directory detected, trying 'git pull origin ${BRANCH}'...`);
    const pulled = run('Pull latest code via git', `git pull origin ${BRANCH}`, { fatal: false });
    if (pulled) {
      codeUpdated = true;
      try {
        const headSha = execSync('git rev-parse HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
        fs.writeFileSync(MARKER_FILE, headSha + '\n');
      } catch (_e) {}
      return;
    }
    console.warn('⚠️  git pull failed — falling back to GitHub tarball download...');
  }

  const before = fs.existsSync(MARKER_FILE) ? fs.readFileSync(MARKER_FILE, 'utf8').trim() : null;
  console.log(`\n▶ Pull: currently deployed commit: ${before || 'unknown (first deploy on this host)'}`);

  let latestSha;
  try {
    latestSha = (await fetchJson(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`)).sha;
  } catch (err) {
    console.warn(`\n⚠️  Pull: could not reach GitHub API — ${err.message}`);
    warnings.push('Pull latest code');
    codeUpdated = true; // Continue deploy with current files
    return;
  }
  console.log(`▶ Pull: latest ${BRANCH} on GitHub: ${latestSha}`);

  if (before === latestSha) {
    console.log(`▶ Pull: already up to date at ${latestSha}`);
    codeUpdated = true;
    return;
  }

  const tarPath = path.join(rootDir, '.deploy_download.tar.gz');
  let extracted = false;
  try {
    console.log(`▶ Pull: downloading codeload tarball for ${latestSha} ...`);
    await downloadFile(`https://codeload.github.com/${REPO}/tar.gz/${latestSha}`, tarPath);
    extracted = run(
      'Pull: extract archive over current files',
      `tar -xzf "${tarPath}" --strip-components=1 -C "${rootDir}"`,
      { fatal: false }
    );
  } catch (err) {
    console.warn(`\n⚠️  Pull: download failed — ${err.message}`);
  } finally {
    if (fs.existsSync(tarPath)) fs.rmSync(tarPath, { force: true });
  }

  if (!extracted) {
    warnings.push('Pull latest code');
    codeUpdated = true; // Continue deploy with current files
    return;
  }

  fs.writeFileSync(MARKER_FILE, latestSha + '\n');
  console.log(`▶ Pull: now at ${latestSha}`);
  codeUpdated = true;
}

async function main() {
  console.log('🚀 SNG Logistics — deploy (Hostinger / Passenger)');

  // 1) Pull latest code (non-critical — see module comment for why no git)
  await pullLatestCode();

  // 2) Install production dependencies (CRITICAL — the app cannot boot without them)
  if (process.env.SKIP_INSTALL === '1') {
    console.log('\n▶ npm install: skipped (SKIP_INSTALL=1)');
  } else {
    run('Install production dependencies', 'npm install --omit=dev --no-audit --no-fund');
  }

  // 3) Database migrations
  //    Core schema is CRITICAL; CRM migration is optional (feature-scoped).
  run('Run core DB migrations', 'npm run migrate-db');
  run('Run CRM migrations', 'npm run migrate-crm', { fatal: false });

  // 4) Ensure runtime directories exist
  for (const dir of ['logs', 'public/uploads', 'tmp']) {
    const full = path.join(rootDir, dir);
    if (!fs.existsSync(full)) {
      fs.mkdirSync(full, { recursive: true });
      console.log(`\n▶ Created missing directory: ${dir}`);
    }
  }

  // 5) Restart Passenger (touch tmp/restart.txt — Passenger reloads on next request)
  const restartTxt = path.join(rootDir, 'tmp', 'restart.txt');
  fs.writeFileSync(restartTxt, `deployed ${new Date().toISOString()}\n`);
  console.log('\n🔄 Passenger restart triggered (tmp/restart.txt)');

  // Summary
  console.log('\n────────────────────────────────────────');
  if (codeUpdated === false) {
    const stuckAt = fs.existsSync(MARKER_FILE) ? fs.readFileSync(MARKER_FILE, 'utf8').trim() : 'unknown';
    console.log('❌❌❌ DEPLOY DID NOT UPDATE THE CODE ❌❌❌');
    console.log(`   Passenger was restarted, but it is still running commit ${stuckAt}.`);
    console.log('   Scroll up to the "Pull:" section above for the actual error.');
  } else if (warnings.length) {
    console.log(`✅ Deploy complete with ${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`   ⚠️  ${w}`);
  } else {
    console.log('✅ Deploy complete — no warnings.');
  }
  console.log('   Site will run new code on the next request.');
  process.exit(codeUpdated === false ? 1 : 0);
}

main().catch((err) => {
  console.error('\n❌ Deploy crashed unexpectedly:', err);
  process.exit(1);
});
