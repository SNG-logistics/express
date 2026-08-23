/**
 * src/controllers/crmController.js
 * CRM controller — handles all HTTP request/response for CRM routes.
 */

import * as svc from '../services/crmService.js';
import { generateSmartReplies, classifyIntent } from '../services/aiService.js';
import pool from '../config/db.js';
import { sendOutbound } from '../services/channelService.js';
import { bulkSyncAllLegacy, getSyncStats } from '../services/customerSyncService.js';

// ─── Shared render helper ────────────────────────────────────────────────────
function crmRender(res, view, data = {}) {
  return res.render(`crm/${view}`, {
    title: data.title || 'CRM | SNG Express',
    ...data,
  });
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
export async function dashboard(req, res) {
  try {
    const [kpis, queues] = await Promise.all([
      svc.getDashboardKpis(),
      svc.listQueues(),
    ]);
    return crmRender(res, 'dashboard', { title: 'CRM Dashboard | SNG Express', kpis, queues });
  } catch (err) {
    console.error('[CRM] dashboard error:', err);
    return res.status(500).send('CRM Dashboard error: ' + err.message);
  }
}

// ─── Unified Inbox ────────────────────────────────────────────────────────────
export async function inbox(req, res) {
  try {
    const user = req.session.user;
    const { status = 'OPEN', channel, queue, search, page = 1 } = req.query;
    const limit = 40;
    const offset = (parseInt(page) - 1) * limit;

    // Agents see only their queue; admins/supervisors see all
    const agentFilter = ['crm_agent','sales_agent','logistics_support','finance_support'].includes(user.role)
      ? user.id : null;

    const [conversations, queues, tags] = await Promise.all([
      svc.listConversations({ status, channelType: channel, queueId: queue, agentId: agentFilter, search, limit, offset }),
      svc.listQueues(),
      svc.listTags(),
    ]);

    return crmRender(res, 'inbox', {
      title: 'Unified Inbox | CRM',
      conversations, queues, tags,
      filters: { status, channel, queue, search, page: parseInt(page) },
      activeConversation: null,
    });
  } catch (err) {
    console.error('[CRM] inbox error:', err);
    return res.status(500).send('CRM Inbox error: ' + err.message);
  }
}

export async function conversation(req, res) {
  try {
    const user = req.session.user;
    const convId = req.params.id;
    const { status = 'OPEN', channel, queue, search } = req.query;

    const agentFilter = ['crm_agent','sales_agent','logistics_support','finance_support'].includes(user.role)
      ? user.id : null;

    const [conv, messages, notes, convTags, conversations, queues, tags, agents, quickReplies] = await Promise.all([
      svc.getConversation(convId),
      svc.getMessages(convId),
      svc.getInternalNotes(convId),
      svc.getConversationTags(convId),
      svc.listConversations({ status, channelType: channel, queueId: queue, agentId: agentFilter, search, limit: 40, offset: 0 }),
      svc.listQueues(),
      svc.listTags(),
      svc.listAgents(),
      svc.listQuickReplies(req.query.lang || 'th'),
    ]);

    if (!conv) {
      req.session.flash = { type: 'error', message: 'ไม่พบการสนทนานี้' };
      return res.redirect('/crm/inbox');
    }

    // Opening the conversation marks its customer messages as read — do it
    // before rendering so the unread badge in the sidebar/list is already
    // correct on this very render.
    await svc.markConversationRead(convId);

    return crmRender(res, 'inbox', {
      title: `${conv.customer_name} — Inbox | CRM`,
      conversations, queues, tags, agents, quickReplies,
      activeConversation: conv,
      messages,
      notes,
      convTags,
      filters: { status, channel, queue, search, page: 1 },
    });
  } catch (err) {
    console.error('[CRM] conversation error:', err);
    return res.status(500).send('CRM conversation error: ' + err.message);
  }
}

export async function sendMessage(req, res) {
  try {
    const user = req.session.user;
    const convId = req.params.id;
    const { message_text } = req.body;
    const hasFile = Boolean(req.file);

    if (!message_text?.trim() && !hasFile) {
      req.session.flash = { type: 'error', message: 'กรุณาพิมพ์ข้อความหรือแนบรูปภาพ' };
      return res.redirect(`/crm/inbox/${convId}`);
    }

    const messageType = hasFile ? 'IMAGE' : 'TEXT';
    const attachmentUrl = hasFile ? `/uploads/crm/${req.file.filename}` : null;
    const attachmentName = hasFile ? req.file.originalname : null;
    const contentText = message_text?.trim() || null;

    const messageId = await svc.createMessage({
      conversationId: convId,
      senderType: 'AGENT',
      senderUserId: user.id,
      senderName: user.name || user.username,
      messageType,
      contentText,
      attachmentUrl,
      attachmentName,
    });

    // Send the outbound message via integrated channel
    const sendResult = await sendOutbound({
      conversationId: convId,
      text: contentText,
      imagePath: attachmentUrl,
    });
    if (sendResult && !sendResult.sent) {
      console.warn(`[CRM] sendOutbound failed for conversation ${convId}: ${sendResult.reason}`);
      // Update message delivery status to FAILED
      await pool.query('UPDATE crm_messages SET delivery_status = ? WHERE id = ?', ['FAILED', messageId]);
      req.session.flash = { type: 'error', message: `ส่งข้อความไม่สำเร็จ: ${sendResult.reason || 'ช่องทางการเชื่อมต่อปิดอยู่'}` };
    }

    return res.redirect(`/crm/inbox/${convId}`);
  } catch (err) {
    console.error('[CRM] sendMessage error:', err);
    req.session.flash = { type: 'error', message: 'ส่งข้อความล้มเหลว' };
    return res.redirect(`/crm/inbox/${req.params.id}`);
  }
}

export async function assign(req, res) {
  try {
    const user = req.session.user;
    const convId = req.params.id;
    // The inbox form submits the field as to_agent_id — reading agent_id here
    // made every assignment look empty and silently CLEAR assigned_agent_id.
    const { to_agent_id: agent_id, queue_id, reason } = req.body;

    const conv = await svc.getConversation(convId);
    await svc.assignConversation({
      conversationId: convId,
      toAgentId: agent_id || null,
      toQueueId: queue_id || null,
      fromAgentId: conv?.assigned_agent_id,
      fromQueueId: conv?.queue_id,
      reason: reason || null,
      assignedBy: user.id,
    });

    req.session.flash = { type: 'success', message: 'Assigned successfully' };
    return res.redirect(`/crm/inbox/${convId}`);
  } catch (err) {
    console.error('[CRM] assign error:', err);
    req.session.flash = { type: 'error', message: 'Assign ล้มเหลว' };
    return res.redirect(`/crm/inbox/${req.params.id}`);
  }
}

export async function changeStatus(req, res) {
  try {
    const user = req.session.user;
    const convId = req.params.id;
    const { status } = req.body;
    const validStatuses = ['OPEN','PENDING','RESOLVED','CLOSED'];
    if (!validStatuses.includes(status)) {
      req.session.flash = { type: 'error', message: 'Invalid status' };
      return res.redirect(`/crm/inbox/${convId}`);
    }
    await svc.updateConversationStatus({ conversationId: convId, status, userId: user.id });
    req.session.flash = { type: 'success', message: `สถานะเปลี่ยนเป็น ${status}` };
    return res.redirect(`/crm/inbox/${convId}`);
  } catch (err) {
    console.error('[CRM] changeStatus error:', err);
    req.session.flash = { type: 'error', message: 'เปลี่ยนสถานะล้มเหลว' };
    return res.redirect(`/crm/inbox/${req.params.id}`);
  }
}

export async function addNote(req, res) {
  try {
    const user = req.session.user;
    const convId = req.params.id;
    const { note_text } = req.body;
    if (!note_text?.trim()) {
      req.session.flash = { type: 'error', message: 'กรุณาพิมพ์โน้ต' };
      return res.redirect(`/crm/inbox/${convId}`);
    }
    await svc.addNote({ conversationId: convId, userId: user.id, noteText: note_text.trim() });
    req.session.flash = { type: 'success', message: 'เพิ่มโน้ตแล้ว' };
    return res.redirect(`/crm/inbox/${convId}`);
  } catch (err) {
    console.error('[CRM] addNote error:', err);
    req.session.flash = { type: 'error', message: 'เพิ่มโน้ตล้มเหลว' };
    return res.redirect(`/crm/inbox/${req.params.id}`);
  }
}

export async function addTag(req, res) {
  try {
    const user = req.session.user;
    const convId = req.params.id;
    const { tag_id } = req.body;
    if (!tag_id) return res.redirect(`/crm/inbox/${convId}`);
    await svc.addTagToConversation({ conversationId: convId, tagId: tag_id, userId: user.id });
    return res.redirect(`/crm/inbox/${convId}`);
  } catch (err) {
    console.error('[CRM] addTag error:', err);
    return res.redirect(`/crm/inbox/${req.params.id}`);
  }
}

export async function unreadCount(req, res) {
  try {
    const user = req.session.user;
    const count = await svc.getUnreadCount(user.id, user.role);
    return res.json({ count });
  } catch (err) {
    return res.json({ count: 0 });
  }
}

// ─── Customer 360 ─────────────────────────────────────────────────────────────
export async function customerList(req, res) {
  try {
    const { search, type, page = 1 } = req.query;
    const limit = 40;
    const offset = (parseInt(page) - 1) * limit;
    const [customers, syncStats] = await Promise.all([
      svc.listCrmCustomers({ search, customerType: type, limit, offset }),
      getSyncStats().catch(() => null),
    ]);
    return crmRender(res, 'customers', {
      title: 'Customer 360 | CRM',
      customers,
      filters: { search, type, page: parseInt(page) },
      syncStats,
    });
  } catch (err) {
    console.error('[CRM] customerList error:', err);
    return res.status(500).send('CRM customer list error: ' + err.message);
  }
}

export async function customer360(req, res) {
  try {
    const data = await svc.getCrmCustomer(req.params.id);
    if (!data) {
      req.session.flash = { type: 'error', message: 'ไม่พบลูกค้า' };
      return res.redirect('/crm/customers');
    }
    return crmRender(res, 'customer-360', {
      title: `${data.customer.full_name} — Customer 360 | CRM`,
      ...data,
    });
  } catch (err) {
    console.error('[CRM] customer360 error:', err);
    return res.status(500).send('Customer 360 error: ' + err.message);
  }
}

// ─── Cases ────────────────────────────────────────────────────────────────────
export async function caseList(req, res) {
  try {
    const { status, type, assignee, priority, search, page = 1 } = req.query;
    const limit = 40;
    const offset = (parseInt(page) - 1) * limit;
    const [cases, agents] = await Promise.all([
      svc.listCases({ status, caseType: type, assignedTo: assignee, priority, search, limit, offset }),
      svc.listAgents(),
    ]);
    return crmRender(res, 'cases', {
      title: 'Cases / Tickets | CRM',
      cases, agents,
      filters: { status, type, assignee, priority, search, page: parseInt(page) },
    });
  } catch (err) {
    console.error('[CRM] caseList error:', err);
    return res.status(500).send('CRM case list error: ' + err.message);
  }
}

export async function newCase(req, res) {
  try {
    const [agents, customers] = await Promise.all([
      svc.listAgents(),
      svc.listCrmCustomers({ limit: 200 }),
    ]);
    return crmRender(res, 'case-new', { title: 'เปิดเคสใหม่ | CRM', agents, customers });
  } catch (err) {
    console.error('[CRM] newCase error:', err);
    return res.status(500).send(err.message);
  }
}

export async function createCase(req, res) {
  try {
    const user = req.session.user;
    const { customer_id, related_order_id, related_job_no, case_type, priority, subject, description, assigned_to, conversation_id } = req.body;
    const { id, caseNo } = await svc.createCase({
      conversationId: conversation_id || null,
      customerId: customer_id,
      relatedOrderId: related_order_id || null,
      relatedJobNo: related_job_no || null,
      caseType: case_type || 'OTHER',
      priority: priority || 'NORMAL',
      subject,
      description,
      assignedTo: assigned_to || null,
      createdBy: user.id,
    });
    req.session.flash = { type: 'success', message: `เปิดเคส ${caseNo} สำเร็จ` };
    return res.redirect(`/crm/cases/${id}`);
  } catch (err) {
    console.error('[CRM] createCase error:', err);
    req.session.flash = { type: 'error', message: 'เปิดเคสล้มเหลว: ' + err.message };
    return res.redirect('/crm/cases/new');
  }
}

export async function caseDetail(req, res) {
  try {
    const c = await svc.getCase(req.params.id);
    if (!c) {
      req.session.flash = { type: 'error', message: 'ไม่พบเคสนี้' };
      return res.redirect('/crm/cases');
    }
    const agents = await svc.listAgents();
    return crmRender(res, 'case-detail', { title: `${c.case_no} | CRM`, case: c, agents });
  } catch (err) {
    console.error('[CRM] caseDetail error:', err);
    return res.status(500).send(err.message);
  }
}

export async function resolveCase(req, res) {
  try {
    const user = req.session.user;
    const { resolution_note } = req.body;
    await svc.resolveCase({ caseId: req.params.id, resolutionNote: resolution_note, userId: user.id });
    req.session.flash = { type: 'success', message: 'ปิดเคสสำเร็จ' };
    return res.redirect(`/crm/cases/${req.params.id}`);
  } catch (err) {
    console.error('[CRM] resolveCase error:', err);
    req.session.flash = { type: 'error', message: 'ปิดเคสล้มเหลว' };
    return res.redirect(`/crm/cases/${req.params.id}`);
  }
}

// ─── Automation ───────────────────────────────────────────────────────────────
export async function automationList(req, res) {
  try {
    const rules = await svc.listAutomationRules();
    return crmRender(res, 'automation', { title: 'Automation Rules | CRM', rules });
  } catch (err) {
    console.error('[CRM] automationList error:', err);
    return res.status(500).send(err.message);
  }
}

export async function saveRule(req, res) {
  try {
    const user = req.session.user;
    const { id, rule_name, description, trigger_type, conditions_json, actions_json, priority, is_active } = req.body;
    await svc.saveAutomationRule({
      id: id || null,
      ruleName: rule_name,
      description,
      triggerType: trigger_type,
      conditionsJson: conditions_json,
      actionsJson: actions_json,
      priority: priority || 10,
      isActive: is_active === '1' || is_active === 'on',
      createdBy: user.id,
    });
    req.session.flash = { type: 'success', message: 'บันทึก rule สำเร็จ' };
    return res.redirect('/crm/automation');
  } catch (err) {
    console.error('[CRM] saveRule error:', err);
    req.session.flash = { type: 'error', message: 'บันทึกล้มเหลว: ' + err.message };
    return res.redirect('/crm/automation');
  }
}

export async function deleteRule(req, res) {
  try {
    await svc.deleteAutomationRule(req.params.id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ─── Reports ─────────────────────────────────────────────────────────────────
export async function reports(req, res) {
  try {
    const kpis = await svc.getDashboardKpis();
    return crmRender(res, 'reports', { title: 'รายงานทีม CRM | SNG Express', kpis });
  } catch (err) {
    console.error('[CRM] reports error:', err);
    return res.status(500).send(err.message);
  }
}

// ─── API Endpoints ────────────────────────────────────────────────────────────
export async function quickReplies(req, res) {
  try {
    const replies = await svc.listQuickReplies(req.query.lang || 'th');
    return res.json(replies);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function tagList(req, res) {
  try {
    const tags = await svc.listTags();
    return res.json(tags);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ─── Channel Settings ─────────────────────────────────────────────────────────
export async function channelList(req, res) {
  try {
    const channels = await svc.listChannels();
    const { getStatus } = await import('../services/whatsappService.js');
    return crmRender(res, 'channels', {
      title: 'ช่องทาง | CRM',
      channels,
      waConnectionStatus: getStatus(),
    });
  } catch (err) {
    console.error('[CRM] channelList error:', err);
    return res.status(500).send(err.message);
  }
}

export async function channelSave(req, res) {
  try {
    const { channel_type, channel_name, page_id, access_token, webhook_secret } = req.body;
    await svc.saveChannel({ channelType: channel_type, channelName: channel_name, pageId: page_id, accessToken: access_token || null, webhookSecret: webhook_secret || null });
    req.session.flash = { type: 'success', message: `บันทึก ${channel_type} Channel สำเร็จ` };
    return res.redirect('/crm/channels');
  } catch (err) {
    console.error('[CRM] channelSave error:', err);
    req.session.flash = { type: 'error', message: 'บันทึกล้มเหลว: ' + err.message };
    return res.redirect('/crm/channels');
  }
}

// ─── Quick Reply Management ───────────────────────────────────────────────────

export async function quickReplyList(req, res) {
  try {
    const { search, category } = req.query;
    const replies = await svc.listQuickReplies({ search, category });
    const categories = [...new Set(replies.map(r => r.category).filter(Boolean))].sort();
    return crmRender(res, 'quick-replies', {
      title: 'Quick Reply | SNG CRM',
      replies, categories, filters: { search, category },
    });
  } catch (err) {
    console.error('[CRM] quickReplyList:', err);
    return res.status(500).send(err.message);
  }
}

export async function quickReplyCreate(req, res) {
  try {
    const { title, shortcut_key, content_text, language, category } = req.body;
    await svc.createQuickReply({ title, shortcutKey: shortcut_key, contentText: content_text, language, category, createdBy: req.session.user?.id });
    req.session.flash = { type: 'success', message: 'สร้าง Quick Reply สำเร็จ' };
    return res.redirect('/crm/quick-replies');
  } catch (err) {
    console.error('[CRM] quickReplyCreate:', err);
    const message = err.code === 'ER_DUP_ENTRY'
      ? `Shortcut "${req.body.shortcut_key}" มีคนใช้ไปแล้ว — ตั้งชื่ออื่น`
      : 'บันทึกล้มเหลว: ' + err.message;
    req.session.flash = { type: 'error', message };
    return res.redirect('/crm/quick-replies');
  }
}

export async function quickReplyUpdate(req, res) {
  try {
    const { id } = req.params;
    const { title, shortcut_key, content_text, language, category } = req.body;
    await svc.updateQuickReply(id, { title, shortcutKey: shortcut_key, contentText: content_text, language, category });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[CRM] quickReplyUpdate:', err);
    const error = err.code === 'ER_DUP_ENTRY'
      ? `Shortcut "${req.body.shortcut_key}" มีคนใช้ไปแล้ว — ตั้งชื่ออื่น`
      : err.message;
    return res.status(500).json({ ok: false, error });
  }
}

export async function quickReplyDelete(req, res) {
  try {
    const { id } = req.params;
    await svc.deleteQuickReply(id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[CRM] quickReplyDelete:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ─── Smart Reply Suggestions API (AI-powered) ────────────────────────────────

export async function smartReplySuggestions(req, res) {
  try {
    const convId = req.params.id;
    const { lang = 'TH' } = req.query;

    // Get last few messages for context
    const [messages] = await pool.query(
      `SELECT sender_type, content_text FROM crm_messages
       WHERE conversation_id = ? ORDER BY sent_at DESC LIMIT 10`,
      [convId]
    );
    const [[conv]] = await pool.query(
      `SELECT c.*, cu.full_name AS customer_name
       FROM crm_conversations c
       LEFT JOIN crm_customers cu ON cu.id = c.crm_customer_id
       WHERE c.id = ? LIMIT 1`,
      [convId]
    );

    const lastCustomerMsg = messages.find(m => m.sender_type === 'CUSTOMER');
    const history = [...messages].reverse();

    if (!lastCustomerMsg) {
      // No customer message yet — return keyword-based quick replies
      const fallback = await svc.listQuickReplies({});
      return res.json({ ok: true, suggestions: fallback.slice(0, 3), source: 'quickreplies' });
    }

    // Get AI intent for better context
    let intent = 'GENERAL';
    try {
      const aiIntent = await classifyIntent(lastCustomerMsg.content_text);
      intent = aiIntent.intent;
    } catch { /* ignore */ }

    // Generate AI smart replies
    const aiReplies = await generateSmartReplies({
      customerMessage: lastCustomerMsg.content_text,
      conversationHistory: history,
      intent,
      customerName: conv?.customer_name || '',
      lang,
    });

    if (aiReplies && aiReplies.length > 0) {
      // Format to match quick reply structure
      const suggestions = aiReplies.map((r, i) => ({
        id: `ai_${i}`,
        title: r.title || `ตัวเลือก ${i + 1}`,
        content_text: r.content,
        shortcut_key: null,
        source: 'ai',
      }));
      return res.json({ ok: true, suggestions, source: 'ai', intent });
    }

    // Fallback: keyword-based quick replies
    const fallback = await svc.listQuickReplies({});
    return res.json({ ok: true, suggestions: fallback.slice(0, 3), source: 'quickreplies' });

  } catch (err) {
    console.error('[CRM] smartReplySuggestions:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ─── Advanced Reports ─────────────────────────────────────────────────────────

export async function reportsAdvanced(req, res) {
  try {
    const { start, end } = req.query;
    const data = await svc.getAdvancedReportData({ startDate: start, endDate: end });
    return crmRender(res, 'reports', {
      title: 'รายงาน CRM | SNG Express',
      reportData: data,
      reportJson: JSON.stringify(data),
    });
  } catch (err) {
    console.error('[CRM] reportsAdvanced:', err);
    return res.status(500).send(err.message);
  }
}

export async function reportsDataApi(req, res) {
  try {
    const { start, end } = req.query;
    const data = await svc.getAdvancedReportData({ startDate: start, endDate: end });
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ─── Customer Merge ───────────────────────────────────────────────────────────

export async function customerMerge(req, res) {
  try {
    const { keep_id, merge_id } = req.body;
    if (!keep_id || !merge_id) return res.status(400).json({ ok: false, error: 'Missing keep_id or merge_id' });
    await svc.mergeCrmCustomers(keep_id, merge_id);
    return res.json({ ok: true, message: 'รวมลูกค้าสำเร็จ' });
  } catch (err) {
    console.error('[CRM] customerMerge:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

export async function customerMergeSearch(req, res) {
  try {
    const { q } = req.query;
    const { id } = req.params;
    if (!q || q.length < 2) return res.json({ ok: true, results: [] });
    const results = await svc.searchCrmCustomers(q, id);
    return res.json({ ok: true, results });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ─── Customer Sync API (Admin) ────────────────────────────────────────────────

/** GET /api/crm/sync/stats — return sync statistics */
export async function syncStats(req, res) {
  try {
    const stats = await getSyncStats();
    return res.json({ ok: true, ...stats });
  } catch (err) {
    console.error('[CRM] syncStats error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/** POST /api/crm/sync/run — trigger full bulk sync (Admin only) */
export async function syncRun(req, res) {
  try {
    const result = await bulkSyncAllLegacy();
    return res.json({
      ok: true,
      message: `ซิงค์สำเร็จ: นำเข้าใหม่ ${result.inserted} รายการ, เชื่อมโยงจาก CRM เดิม ${result.linked} รายการ (${result.duration_ms}ms)`,
      ...result,
    });
  } catch (err) {
    console.error('[CRM] syncRun error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
