import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';

const BRIDGE     = readFileSync(new URL('../../src/services/waToCrmBridge.js', import.meta.url), 'utf8');
const CRM_SVC    = readFileSync(new URL('../../src/services/crmService.js', import.meta.url), 'utf8');
const CHANNEL    = readFileSync(new URL('../../src/services/channelService.js', import.meta.url), 'utf8');
const CTRL       = readFileSync(new URL('../../src/controllers/crmController.js', import.meta.url), 'utf8');
const ROUTES     = readFileSync(new URL('../../src/routes/crm.js', import.meta.url), 'utf8');
const INBOX_VIEW = readFileSync(new URL('../../views/crm/inbox.ejs', import.meta.url), 'utf8');
const CSS        = readFileSync(new URL('../../public/css/crm.css', import.meta.url), 'utf8');
const RT         = readFileSync(new URL('../../public/js/crm-realtime.js', import.meta.url), 'utf8');
const SCHEMA     = readFileSync(new URL('../../database/migrate_crm_001.sql', import.meta.url), 'utf8');

// ── Part 1 — inbound WhatsApp images ─────────────────────────────────────────

test('waToCrmBridge downloads image messages via downloadMediaMessage and stores them under public/uploads/whatsapp', () => {
  const branch = BRIDGE.slice(BRIDGE.indexOf("msgContent?.imageMessage"));
  const end = branch.indexOf('documentMessage');
  const body = branch.slice(0, end);

  assert.match(body, /downloadMediaMessage/, 'must call Baileys downloadMediaMessage');
  assert.match(body, /'buffer'/, 'download as buffer');
  assert.match(body, /public['"],\s*['"]uploads['"],\s*['"]whatsapp/, 'writes into public/uploads/whatsapp');
  assert.match(body, /attachmentUrl = `\/uploads\/whatsapp\/\$\{filename\}`/, 'stores a real URL path');
});

test('waToCrmBridge falls back to the [WhatsApp Image] placeholder when the download throws', () => {
  const branch = BRIDGE.slice(BRIDGE.indexOf("msgContent?.imageMessage"));
  const end = branch.indexOf('documentMessage');
  const body = branch.slice(0, end);

  const tryAt   = body.indexOf('try {');
  const catchAt = body.indexOf('} catch (dlErr)');
  const fallbackAt = body.indexOf("'[WhatsApp Image]'");
  assert.ok(tryAt > -1 && catchAt > -1 && fallbackAt > -1, 'missing try/catch/fallback');
  assert.ok(tryAt < catchAt && catchAt < fallbackAt, 'fallback must live inside the catch block');
});

// ── Part 2 — outbound agent images ───────────────────────────────────────────

test('crmService.createMessage INSERT includes attachment_name and it exists in the schema', () => {
  const fn = CRM_SVC.slice(CRM_SVC.indexOf('export async function createMessage'));
  const end = fn.indexOf('\nexport async function', 1);
  const body = fn.slice(0, end > -1 ? end : undefined);

  assert.match(body, /attachment_name/, 'INSERT column list must include attachment_name');
  // The schema really has the column (migrate_crm_001.sql) — using it must not
  // be a guess.
  assert.match(SCHEMA, /attachment_name\s+VARCHAR\(255\)/);
});

test('channelService.sendOutbound forwards imagePath; sendWhatsApp sends {image, caption} instead of {text}', () => {
  const outboundFn = CHANNEL.slice(CHANNEL.indexOf('export async function sendOutbound'));
  const outboundEnd = outboundFn.indexOf('\nasync function');
  const outboundBody = outboundFn.slice(0, outboundEnd > -1 ? outboundEnd : undefined);
  assert.match(outboundBody, /sendWhatsApp\(conv\.external_user_id,\s*text,\s*imagePath\)/,
    'sendOutbound must pass imagePath through to sendWhatsApp');

  const waFn = CHANNEL.slice(CHANNEL.indexOf('async function sendWhatsApp'));
  const waEnd = waFn.indexOf('\nasync function sendFacebook');
  const waBody = waFn.slice(0, waEnd > -1 ? waEnd : undefined);

  const imgAt = waBody.indexOf('if (imagePath) {');
  const imageSendAt = waBody.indexOf("{ image: fs.readFileSync(absPath), caption: text || undefined }");
  const textSendAt = waBody.indexOf('await sock.sendMessage(jid, { text })');
  assert.ok(imgAt > -1 && imageSendAt > -1 && textSendAt > -1, 'missing image/text branches');
  assert.ok(imgAt < imageSendAt && imageSendAt < textSendAt,
    'the image branch must come before the plain-text fallback');
});

test('Facebook sends imageUrl through to the Graph API attachment call; LINE still fails fast', () => {
  const switchBody = CHANNEL.slice(
    CHANNEL.indexOf('switch (conv.channel_type)'),
    CHANNEL.indexOf('async function sendWhatsApp')
  );
  const fbAt = switchBody.indexOf("case 'FACEBOOK':");
  const lineAt = switchBody.indexOf("case 'LINE_OA':");
  assert.ok(fbAt > -1 && lineAt > -1);
  assert.match(switchBody.slice(fbAt, lineAt), /sendFacebook\(conv\.external_user_id,\s*text,\s*conv\.channel_id,\s*imageUrl\)/,
    'FB must pass imageUrl through to sendFacebook');
  assert.match(switchBody.slice(lineAt), /image_unsupported_channel/, 'LINE must still reject images explicitly (no image-send implementation yet)');

  const fbFn = CHANNEL.slice(CHANNEL.indexOf('async function sendFacebook'));
  const fbEnd = fbFn.indexOf('\nasync function sendLine');
  const fbBody = fbFn.slice(0, fbEnd > -1 ? fbEnd : undefined);
  assert.match(fbBody, /type:\s*'image'/, 'sendFacebook must build an image attachment payload');
  assert.match(fbBody, /payload:\s*\{\s*url:\s*imageUrl/, 'the attachment payload must carry the public image URL');
});

test('reply route wires the multer upload middleware for field "attachment"', () => {
  assert.match(ROUTES, /uploadCrmAttachment\.single\('attachment'\)/);
  const replyRoute = ROUTES.slice(ROUTES.indexOf("/crm/inbox/:id/reply"), ROUTES.indexOf('/crm/inbox/:id/assign'));
  assert.match(replyRoute, /ctrl\.sendMessage/, 'middleware must sit on the reply route that calls sendMessage');
});

test('reply route checks the CRM-agent role before multer parses the upload', () => {
  const replyRoute = ROUTES.slice(ROUTES.indexOf("/crm/inbox/:id/reply"), ROUTES.indexOf('/crm/inbox/:id/assign'));
  const accessAt = replyRoute.indexOf('requireCrmAccess');
  const multerAt = replyRoute.indexOf('uploadCrmAttachment.single');
  assert.ok(accessAt > -1 && multerAt > -1, 'missing role check or multer middleware');
  assert.ok(accessAt < multerAt,
    'the role check must run before multer writes an unauthorized upload to disk');
});

test('inbox reply form is multipart with a hidden attachment input + preview + paperclip trigger', () => {
  const formStart = INBOX_VIEW.indexOf('id="replyForm"');
  const formEnd = INBOX_VIEW.indexOf('</form>', formStart);
  const form = INBOX_VIEW.slice(formStart, formEnd);

  assert.match(form, /enctype="multipart\/form-data"/);
  assert.match(form, /type="file"\s+name="attachment"\s+id="attachmentInput"/);
  assert.match(form, /accept="image\/[^"]*"/);
  assert.match(form, /attachmentPreview/);
  assert.match(form, /fa-paperclip/);
});

test('crm.css styles the message image and the attachment preview', () => {
  assert.match(CSS, /\.crm-msg-image\s*\{[^}]*max-width:\s*260px/);
  assert.match(CSS, /\.crm-attachment-preview\s*\{/);
  assert.match(CSS, /\.crm-attachment-thumb\s*\{/);
});

// ── Part 3 — the three real bugs ─────────────────────────────────────────────

test('BUG1 regression: assign() reads to_agent_id from the form, not agent_id', () => {
  const fn = CTRL.slice(CTRL.indexOf('export async function assign'));
  const end = fn.indexOf('\nexport async function', 1);
  const body = fn.slice(0, end > -1 ? end : undefined);

  assert.match(body, /to_agent_id:\s*agent_id/,
    'controller must destructure to_agent_id (what inbox.ejs actually submits)');
  assert.doesNotMatch(body, /\{\s*agent_id,/,
    'reading bare agent_id was the bug — every assignment silently cleared the owner');

  // And the view submits exactly that field name.
  const assignForm = INBOX_VIEW.slice(
    INBOX_VIEW.indexOf('/assign'),
    INBOX_VIEW.indexOf('/assign') + 600
  );
  assert.match(assignForm, /name="to_agent_id"/);
});

test('BUG2: conversation() marks customer messages READ before rendering, via markConversationRead', () => {
  const svcHasFn = /export async function markConversationRead/.test(CRM_SVC);
  assert.ok(svcHasFn, 'crmService must export markConversationRead');

  const fn = CTRL.slice(CTRL.indexOf('export async function conversation'));
  const end = fn.indexOf('\nexport async function', 1);
  const body = fn.slice(0, end > -1 ? end : undefined);

  const convCheckAt = body.indexOf("if (!conv)");
  const markAt = body.indexOf('await svc.markConversationRead(convId)');
  const renderAt = body.indexOf('return crmRender(res, \'inbox\'');
  assert.ok(convCheckAt > -1 && markAt > -1 && renderAt > -1, 'missing pieces in conversation()');
  assert.ok(convCheckAt < markAt && markAt < renderAt,
    'mark-as-read must run after the not-found guard and before render');

  // The UPDATE only touches CUSTOMER rows that are not already READ.
  const svcFn = CRM_SVC.slice(CRM_SVC.indexOf('export async function markConversationRead'));
  assert.match(svcFn, /sender_type = 'CUSTOMER'/);
  assert.match(svcFn, /delivery_status != 'READ'/);
});

test('BUG2: crm-realtime seeds the sidebar badge from GET /api/crm/inbox/unread on connect', () => {
  assert.match(RT, /setSidebarBadgeCount/, 'a direct-set helper must exist alongside the increment one');
  assert.match(RT, /fetch\('\/api\/crm\/inbox\/unread'/);
  const seedAt = RT.indexOf("fetch('/api/crm/inbox/unread'");
  const newMsgAt = RT.indexOf("'crm:new_message'");
  assert.ok(seedAt > -1 && newMsgAt > -1 && seedAt < newMsgAt,
    'badge seeding happens at connect time, before any socket event can bump it');
});

test('BUG3: listQuickReplies converts a string lang into a real language filter', () => {
  const fn = CRM_SVC.slice(CRM_SVC.indexOf('export async function listQuickReplies'));
  const end = fn.indexOf('\nexport async function', 1);
  const body = fn.slice(0, end > -1 ? end : undefined);

  assert.match(body, /opts = \{ language: opts \}/,
    'string argument must become { language } instead of being discarded');
  assert.match(body, /language = \?/, 'SQL must filter by language');
  // Backward-compat: object callers without a language still get everything.
  assert.match(body, /if \(language\)/);
});

test('BUG3: setReplyLanguage refreshes the quick-reply drawer via the API with th/lo mapping', () => {
  const script = INBOX_VIEW.slice(INBOX_VIEW.indexOf('<script>'));

  assert.match(script, /refreshQuickReplies/, 'refresh function must exist');
  assert.match(script, /lang === 'LA' \? 'lo' : 'th'/, 'TH/LA buttons map to the DB enum th/lo');
  assert.match(script, /fetch\('\/api\/crm\/quick-replies\?lang='/);

  const setLangAt = script.indexOf('function setReplyLanguage');
  const refreshCallAt = script.indexOf('refreshQuickReplies(lang);');
  assert.ok(setLangAt > -1 && refreshCallAt > setLangAt,
    'setReplyLanguage must invoke the drawer refresh');
});

test('refreshQuickReplies escapes each quick reply before building innerHTML from it', () => {
  const fn = INBOX_VIEW.slice(
    INBOX_VIEW.indexOf('async function refreshQuickReplies'),
    INBOX_VIEW.indexOf('// ── Attachment picker')
  );

  // A hand-rolled escaper must exist and be applied to every field that gets
  // interpolated into innerHTML — the server-rendered drawer gets this for
  // free from EJS's <%= %>, but this client-side rebuild does not.
  assert.match(fn, /replace\(\/\[&<>"'\]\/g/, 'must define an HTML-entity escaper');
  const escCallSites = fn.match(/esc\(qr\.\w+/g) || [];
  assert.ok(escCallSites.length >= 3,
    `expected content_text, title and shortcut_key all passed through esc(), got: ${escCallSites.join(', ')}`);
  assert.doesNotMatch(fn, /\$\{qr\.title\}/, 'qr.title must not be interpolated raw');
  assert.doesNotMatch(fn, /\$\{qr\.content_text/, 'qr.content_text must not be interpolated raw');
});
