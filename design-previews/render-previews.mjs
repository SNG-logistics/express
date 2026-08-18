import { execFileSync, spawn } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ejs from 'ejs';

const previewDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(previewDir, '..');
const viewport = { width: 500, height: 1100, deviceScaleFactor: 1 };
const options = new Set(process.argv.slice(2));
const supportedOptions = new Set(['--runtime-only', '--concepts-only']);

for (const option of options) {
  if (!supportedOptions.has(option)) throw new Error(`Unknown option: ${option}`);
}
if (options.has('--runtime-only') && options.has('--concepts-only')) {
  throw new Error('Choose either --runtime-only or --concepts-only, not both.');
}

const renderRuntime = !options.has('--concepts-only');
const renderConcepts = !options.has('--runtime-only');

const paths = {
  layout: path.join(projectRoot, 'views', 'customer', 'layout.ejs'),
  member: path.join(projectRoot, 'views', 'customer', 'member', 'profile.ejs'),
  home: path.join(projectRoot, 'views', 'customer', 'home.ejs'),
  css: path.join(projectRoot, 'public', 'css', 'portal.css'),
  logo: path.join(projectRoot, 'public', 'images', 'sng-logo-nav.png'),
  th: path.join(projectRoot, 'src', 'i18n', 'th.json'),
  lo: path.join(projectRoot, 'src', 'i18n', 'lo.json'),
};

function translate(dictionary) {
  return (key) => key.split('.').reduce((value, part) => value?.[part], dictionary) ?? key;
}

function currentCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

async function findEdge() {
  const candidates = [
    process.env.SNG_PREVIEW_EDGE,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known installation path.
    }
  }

  throw new Error('Microsoft Edge was not found. Set SNG_PREVIEW_EDGE to its executable path.');
}

function injectPreviewAssets(html, css, logoDataUri, label) {
  const previewCss = `
    ${css}
    .design-preview-watermark {
      position: fixed;
      z-index: 9999;
      top: 4.85rem;
      left: .5rem;
      padding: .28rem .42rem;
      border: 1px solid color-mix(in srgb, var(--portal-gold) 55%, transparent);
      border-radius: 999px;
      color: var(--portal-gold);
      background: color-mix(in srgb, var(--portal-bg) 88%, transparent);
      font: 800 8px/1 Arial, sans-serif;
      letter-spacing: .06em;
      pointer-events: none;
    }
  `.replace(/<\/style/gi, '<\\/style');

  return html
    .replace(/<link rel="manifest"[^>]*>\s*/g, '')
    .replace(/<link rel="icon"[^>]*>\s*/g, '')
    .replace(/<link rel="apple-touch-icon"[^>]*>\s*/g, '')
    .replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>\s*/g, '')
    .replace(/<script>tailwind\.config[^<]*<\/script>\s*/g, '')
    .replace(/<script defer src="https:\/\/cdn\.jsdelivr\.net\/npm\/alpinejs[^>]*><\/script>\s*/g, '')
    .replace(/<link rel="stylesheet" href="\/css\/portal\.css\?v=[^"]+">/, `<style>${previewCss}</style>`)
    .replaceAll('src="/images/sng-logo-nav.png"', `src="${logoDataUri}"`)
    .replace('<body>', `<body><div class="design-preview-watermark">${label}</div>`);
}

function renderPage({ template, templatePath, layout, theme, locals, css, logoDataUri, label }) {
  const body = ejs.render(template, locals, { filename: templatePath });
  const html = ejs.render(layout, {
    ...locals,
    body,
    theme,
    title: `SNG Design QA · ${label}`,
    assetVersion: 'design-preview',
    flash: null,
    otherTheme: theme === 'light' ? 'dark' : 'light',
  }, { filename: paths.layout });

  return injectPreviewAssets(html, css, logoDataUri, label);
}

async function capture(edge, htmlPath, outputPath, size, tempRoot, name) {
  const profilePath = path.join(tempRoot, `edge-${name}`);
  const capturePath = path.join(tempRoot, 'captures', `${name}.png`);
  await mkdir(profilePath, { recursive: true });
  await mkdir(path.dirname(capturePath), { recursive: true });
  await rm(capturePath, { force: true });

  const child = spawn(edge, [
    '--headless',
    '--disable-gpu',
    '--disable-background-mode',
    '--disable-breakpad',
    '--disable-component-update',
    '--disable-crash-reporter',
    '--disable-extensions',
    '--hide-scrollbars',
    '--noerrdialogs',
    '--no-first-run',
    '--allow-file-access-from-files',
    '--force-device-scale-factor=1',
    `--user-data-dir=${profilePath}`,
    `--window-size=${size.width},${size.height}`,
    `--screenshot=${capturePath}`,
    pathToFileURL(htmlPath).href,
  ], {
    cwd: projectRoot,
    stdio: 'ignore',
  });
  child.unref();
  let exited = false;
  child.once('exit', () => { exited = true; });

  const deadline = Date.now() + 30000;
  let lastSize = -1;
  let stableChecks = 0;

  while (Date.now() < deadline) {
    try {
      const output = await stat(capturePath);
      if (output.isFile() && output.size > 0) {
        stableChecks = output.size === lastSize ? stableChecks + 1 : 0;
        lastSize = output.size;
        if (stableChecks >= 2) break;
      }
    } catch {
      // Edge has not written the screenshot yet.
    }
    if (exited && lastSize < 0) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  child.kill('SIGKILL');
  await new Promise(resolve => setTimeout(resolve, 250));

  try {
    const output = await stat(capturePath);
    if (!output.isFile() || output.size === 0) throw new Error('empty output');
  } catch {
    throw new Error(`Edge did not create a valid screenshot for ${name}.`);
  }

  await copyFile(capturePath, outputPath);
}

function stopPreviewEdgeProcesses(tempRoot) {
  if (process.platform !== 'win32') return;

  const escapedTempRoot = tempRoot.replaceAll("'", "''");
  const command = [
    `$previewRoot='${escapedTempRoot}';`,
    "Get-CimInstance Win32_Process -Filter \"Name = 'msedge.exe'\"",
    "| Where-Object { $_.CommandLine -and $_.CommandLine.Contains($previewRoot) }",
    '| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
  ].join(' ');

  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { stdio: 'ignore' });
  } catch {
    // Temp cleanup below retries while isolated Edge helpers exit naturally.
  }
}

const [layout, memberTemplate, homeTemplate, css, logo, thJson, loJson] = await Promise.all([
  readFile(paths.layout, 'utf8'),
  readFile(paths.member, 'utf8'),
  readFile(paths.home, 'utf8'),
  readFile(paths.css, 'utf8'),
  readFile(paths.logo),
  readFile(paths.th, 'utf8'),
  readFile(paths.lo, 'utf8'),
]);

const th = JSON.parse(thJson);
const lo = JSON.parse(loJson);
const t = translate(th);
const commit = currentCommit();
const generatedAt = new Date().toISOString();
const logoDataUri = `data:image/png;base64,${logo.toString('base64')}`;
const edge = await findEdge();
const tempRoot = await mkdtemp(path.join(tmpdir(), 'sng-design-previews-'));

const syntheticMember = {
  id: 999999,
  first_name: 'สมาชิกเดโม',
  phone: '0000000000',
  phone_display: '000 0000 0000',
  referral_code: 'SNG-DEMO',
};

const baseLocals = {
  t,
  lang: 'th',
  otherLang: 'lo',
  otherFlag: lo._flag,
  otherLabel: lo._label,
};

const definitions = [
  {
    name: 'member-profile-light-th',
    route: '/member/profile',
    theme: 'light',
    auth: 'authenticated synthetic member',
    state: 'latest order at destination warehouse',
    template: memberTemplate,
    templatePath: paths.member,
    locals: {
      ...baseLocals,
      currentPath: '/member/profile',
      portalCurrentUser: syntheticMember,
      account: syntheticMember,
      referralCreditLak: 40000,
      latestOrderUnavailable: false,
      latestOrder: {
        id: 999999,
        job_no: 'SNG-DEMO-041',
        direction: 'TH_TO_LA',
        status: 'AT_DEST_WH',
        receiver_city: 'เวียงจันทน์',
        delivered_at: null,
      },
    },
  },
  {
    name: 'member-profile-dark-th',
    route: '/member/profile',
    theme: 'dark',
    auth: 'authenticated synthetic member',
    state: 'latest order at destination warehouse',
    template: memberTemplate,
    templatePath: paths.member,
    locals: {
      ...baseLocals,
      currentPath: '/member/profile',
      portalCurrentUser: syntheticMember,
      account: syntheticMember,
      referralCreditLak: 40000,
      latestOrderUnavailable: false,
      latestOrder: {
        id: 999999,
        job_no: 'SNG-DEMO-041',
        direction: 'TH_TO_LA',
        status: 'AT_DEST_WH',
        receiver_city: 'เวียงจันทน์',
        delivered_at: null,
      },
    },
  },
  {
    name: 'home-light-th',
    route: '/home',
    theme: 'light',
    auth: 'guest',
    state: 'no recent tracking searches',
    template: homeTemplate,
    templatePath: paths.home,
    locals: {
      ...baseLocals,
      currentPath: '/home',
      portalCurrentUser: null,
      company: {
        company_name_th: 'SNG Express · ข้อมูลตัวอย่าง',
        company_address_th: 'ที่อยู่ตัวอย่างสำหรับตรวจดีไซน์',
        company_phone: '000 000 0000',
        company_email: 'demo@example.invalid',
      },
    },
  },
  {
    name: 'home-dark-th',
    route: '/home',
    theme: 'dark',
    auth: 'guest',
    state: 'no recent tracking searches',
    template: homeTemplate,
    templatePath: paths.home,
    locals: {
      ...baseLocals,
      currentPath: '/home',
      portalCurrentUser: null,
      company: {
        company_name_th: 'SNG Express · ข้อมูลตัวอย่าง',
        company_address_th: 'ที่อยู่ตัวอย่างสำหรับตรวจดีไซน์',
        company_phone: '000 000 0000',
        company_email: 'demo@example.invalid',
      },
    },
  },
];

try {
  if (renderRuntime) {
    for (const definition of definitions) {
      const label = `SYNTHETIC · ${definition.route} · ${definition.theme.toUpperCase()} · TH`;
      const html = renderPage({
        ...definition,
        layout,
        css,
        logoDataUri,
        label,
      });
      const htmlPath = path.join(tempRoot, `${definition.name}.html`);
      const outputPath = path.join(previewDir, `${definition.name}.png`);
      await writeFile(htmlPath, html, 'utf8');
      await capture(edge, htmlPath, outputPath, viewport, tempRoot, definition.name);
    }
  }

  const conceptDefinitions = [
    { name: 'member-ui-concepts', width: 1500, height: 1060 },
    { name: 'home-ui-preview', width: 1500, height: 1320 },
  ];

  if (renderConcepts) {
    for (const concept of conceptDefinitions) {
      await capture(
        edge,
        path.join(previewDir, 'concepts', `${concept.name}.html`),
        path.join(previewDir, 'concepts', `${concept.name}.png`),
        concept,
        tempRoot,
        `concept-${concept.name}`,
      );
    }
  }

  if (renderRuntime) {
    const manifest = {
      schemaVersion: 1,
      generatedAt,
      sourceCommit: commit,
      generator: 'design-previews/render-previews.mjs',
      dataPolicy: 'All captured personal, shipment, credit, and company values are synthetic.',
      viewport,
      artifacts: definitions.map(({ name, route, theme, auth, state }) => ({
        file: `${name}.png`,
        status: 'rendered runtime template',
        route,
        theme,
        language: 'th',
        auth,
        state,
      })),
      concepts: [
        {
          file: 'concepts/member-ui-concepts.html',
          screenshot: 'concepts/member-ui-concepts.png',
          status: 'archived concept; option A informed the implementation',
        },
        {
          file: 'concepts/home-ui-preview.html',
          screenshot: 'concepts/home-ui-preview.png',
          status: 'archived static concept; not runtime evidence',
        },
      ],
    };

    await writeFile(
      path.join(previewDir, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
  }
} finally {
  const resolvedTempRoot = path.resolve(tempRoot);
  const resolvedSystemTemp = path.resolve(tmpdir());
  if (resolvedTempRoot.startsWith(`${resolvedSystemTemp}${path.sep}`)) {
    stopPreviewEdgeProcesses(resolvedTempRoot);
    await rm(resolvedTempRoot, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 250,
    });
  }
}

console.log([
  renderRuntime ? `${definitions.length} runtime-template previews` : null,
  renderConcepts ? '2 archived concepts' : null,
].filter(Boolean).join(' and ').replace(/^/, 'Rendered ') + '.');
