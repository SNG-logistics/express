/**
 * scripts/deploy.js — one-command deploy for Hostinger (Phusion Passenger).
 *
 *   npm run deploy
 *
 * Steps: pull latest code → install prod deps → run DB migrations →
 * ensure runtime dirs → restart Passenger (touch tmp/restart.txt).
 *
 * Design goals (why this is resilient):
 *  - CRITICAL steps (deps, core DB migration) fail loud and stop the deploy.
 *  - NON-CRITICAL steps (CRM migration, git pull) only warn — a hiccup there
 *    must never leave the site un-restarted on old code.
 *  - The Passenger restart ALWAYS runs if the critical steps passed, so a
 *    successful deploy is a running deploy.
 *
 * Env toggles (handy for re-runs / debugging on the server):
 *   SKIP_GIT=1      skip git fetch/reset (e.g. Plesk/hPanel manages files)
 *   SKIP_INSTALL=1  skip npm install (deps already up to date)
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const warnings = [];
let codeUpdated = null; // null = git step skipped entirely; true/false once attempted

/** Run a shell command. When fatal, a failure aborts the deploy. */
function run(label, cmd, { fatal = true } = {}) {
  process.stdout.write(`\n▶ ${label}\n   $ ${cmd}\n`);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: rootDir });
    return true;
  } catch (err) {
    // stdio:'inherit' already streamed the command's own stderr live, but the
    // exception message (exit code, signal) was previously only printed on
    // fatal failures — a non-fatal git failure used to vanish into a vague
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

function commitHash() {
  try {
    return execSync('git rev-parse HEAD', { cwd: rootDir }).toString().trim();
  } catch {
    return null;
  }
}

console.log('🚀 SNG Logistics — deploy (Hostinger / Passenger)');

// 1) Pull latest code (non-critical: on managed hosting the panel updates files)
if (process.env.SKIP_GIT === '1') {
  console.warn('\n⚠️⚠️⚠️  SKIP_GIT=1 is set — code will NOT be updated from GitHub this run.');
  console.warn('   If you did not mean to set this, unset it before deploying.');
} else if (fs.existsSync(path.join(rootDir, '.git'))) {
  const before = commitHash();
  let remoteUrl = 'unknown';
  try { remoteUrl = execSync('git remote get-url origin', { cwd: rootDir }).toString().trim(); } catch {}
  console.log(`\n▶ Git: current HEAD ${before || 'unknown'}, remote origin: ${remoteUrl}`);

  const fetched = run('Git: fetch origin main', 'git fetch origin main', { fatal: false });
  const reset = fetched && run('Git: reset to origin/main', 'git reset --hard origin/main', { fatal: false });
  const after = commitHash();

  codeUpdated = Boolean(reset) && before !== null && after !== null && before !== after;
  if (reset && before === after) {
    console.log(`\n▶ Git: already up to date at ${after}`);
    codeUpdated = true; // no-op pull is a legitimate "nothing changed" state, not a failure
  } else if (!reset) {
    console.warn(`\n⚠️  Git: HEAD is still ${before || 'unknown'} — code was NOT updated.`);
  }
} else {
  console.warn('\n⚠️  Git: skipped (no .git in this directory — code cannot be updated this way).');
}

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
  console.log('❌❌❌ DEPLOY DID NOT UPDATE THE CODE ❌❌❌');
  console.log(`   Passenger was restarted, but it is still running commit ${commitHash() || 'unknown'}.`);
  console.log('   Scroll up to the "Git:" section above for the actual error.');
} else if (warnings.length) {
  console.log(`✅ Deploy complete with ${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`   ⚠️  ${w}`);
} else {
  console.log('✅ Deploy complete — no warnings.');
}
console.log('   Site will run new code on the next request.');
process.exit(codeUpdated === false ? 1 : 0);
