/**
 * src/services/crmService.js
 * Core CRM data-access layer � all DB queries for the CRM module.
 */

import pool from '../config/db.js';

// ������ Conversations ������������������������������������������������������������������������������������������������������������������������

/**
 * List conversations with filters.
 * Agents see only their assigned queue; supervisors see all in team.
 */
export async function listConversations({ status, channelType, queueId, agentId, search, limit = 50, offset = 0 } = {}) {
  const conditions = ['1=1'];
  const params = [];

  if (status)      { conditions.push('c.status = ?');       params.push(status); }
  if (channelType) { conditions.push('c.channel_type = ?'); params.push(channelType); }
  if (queueId)     { conditions.push('c.queue_id = ?');     params.push(queueId); }
  if (agentId)     { conditions.push('c.assigned_agent_id = ?'); params.push(agentId); }
  if (search) {
    conditions.push('(cu.full_name LIKE ? OR cu.phone LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const sql = `
    SELECT
      c.id, c.status, c.priority, c.channel_type, c.subject,
      c.first_message_at, c.last_message_at, c.sla_due_at,
      c.assigned_agent_id, c.queue_id,
      cu.id AS customer_id, cu.full_name AS customer_name, cu.customer_type,
      u.name AS agent_name,
      q.queue_name,
      m.content_text AS last_message_text,
      m.sender_type AS last_sender_type,
      (SELECT COUNT(*) FROM crm_messages msg
         WHERE msg.conversation_id = c.id
           AND msg.sender_type = 'CUSTOMER'
           AND msg.delivery_status != 'READ') AS unread_count,
      (SELECT GROUP_CONCAT(t.tag_name ORDER BY t.tag_name SEPARATOR ',')
         FROM crm_conversation_tags ct
         JOIN crm_tags t ON t.id = ct.tag_id
         WHERE ct.conversation_id = c.id) AS tags
    FROM crm_conversations c
    JOIN crm_customers cu ON cu.id = c.crm_customer_id
    LEFT JOIN users u ON u.id = c.assigned_agent_id
    LEFT JOIN crm_queues q ON q.id = c.queue_id
    LEFT JOIN crm_messages m ON m.id = (
      SELECT id FROM crm_messages WHERE conversation_id = c.id ORDER BY sent_at DESC LIMIT 1
    )
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE c.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 ELSE 4 END,
      c.last_message_at DESC
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);

  const [rows] = await pool.query(sql, params);
  return rows;
}

/**
 * Get a single conversation with all messages and customer context.
 */
export async function getConversation(id) {
  const [[conv]] = await pool.query(`
    SELECT
      c.*,
      cu.id AS customer_id, cu.full_name AS customer_name, cu.phone AS customer_phone,
      cu.email AS customer_email, cu.customer_type, cu.province, cu.country, cu.note AS customer_note,
      cu.legacy_customer_id,
      u.name AS agent_name,
      q.queue_name
    FROM crm_conversations c
    JOIN crm_customers cu ON cu.id = c.crm_customer_id
    LEFT JOIN users u ON u.id = c.assigned_agent_id
    LEFT JOIN crm_queues q ON q.id = c.queue_id
    WHERE c.id = ?
  `, [id]);
  return conv || null;
}

export async function getMessages(conversationId) {
  const [rows] = await pool.query(`
    SELECT m.*, u.name AS agent_display_name
    FROM crm_messages m
    LEFT JOIN users u ON u.id = m.sender_user_id
    WHERE m.conversation_id = ?
    ORDER BY m.sent_at ASC
  `, [conversationId]);
  return rows;
}

export async function getInternalNotes(conversationId) {
  const [rows] = await pool.query(`
    SELECT n.*, u.name AS author_name
    FROM crm_internal_notes n
    JOIN users u ON u.id = n.created_by
    WHERE n.conversation_id = ?
    ORDER BY n.created_at ASC
  `, [conversationId]);
  return rows;
}

export async function getConversationTags(conversationId) {
  const [rows] = await pool.query(`
    SELECT t.* FROM crm_conversation_tags ct
    JOIN crm_tags t ON t.id = ct.tag_id
    WHERE ct.conversation_id = ?
  `, [conversationId]);
  return rows;
}

/**
 * Post a message (agent reply) into a conversation.
 */
export async function createMessage({ conversationId, senderType = 'AGENT', senderUserId, senderName, messageType = 'TEXT', contentText, attachmentUrl }) {
  const [result] = await pool.query(`
    INSERT INTO crm_messages
      (conversation_id, sender_type, sender_user_id, sender_name, message_type, content_text, attachment_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [conversationId, senderType, senderUserId || null, senderName || null, messageType, contentText || null, attachmentUrl || null]);

  // Update conversation's last_message_at + set first_response_at if this is first agent reply
  await pool.query(`
    UPDATE crm_conversations
    SET last_message_at = NOW(),
        first_response_at = COALESCE(first_response_at, IF(? = 'AGENT', NOW(), NULL)),
        status = IF(status = 'PENDING' AND ? = 'AGENT', 'OPEN', status)
    WHERE id = ?
  `, [senderType, senderType, conversationId]);

  return result.insertId;
}

export async function addNote({ conversationId, userId, noteText }) {
  const [result] = await pool.query(`
    INSERT INTO crm_internal_notes (conversation_id, created_by, note_text) VALUES (?, ?, ?)
  `, [conversationId, userId, noteText]);
  return result.insertId;
}

export async function addTagToConversation({ conversationId, tagId, userId }) {
  await pool.query(`
    INSERT IGNORE INTO crm_conversation_tags (conversation_id, tag_id, tagged_by)
    VALUES (?, ?, ?)
  `, [conversationId, tagId, userId || null]);
}

export async function updateConversationStatus({ conversationId, status, userId }) {
  const updates = ['status = ?'];
  const params = [status];

  if (status === 'RESOLVED') { updates.push('resolved_at = NOW()'); }
  if (status === 'CLOSED')   { updates.push('resolved_at = COALESCE(resolved_at, NOW())'); }
  params.push(conversationId);

  await pool.query(`UPDATE crm_conversations SET ${updates.join(', ')} WHERE id = ?`, params);
}

export async function assignConversation({ conversationId, toAgentId, toQueueId, fromAgentId, fromQueueId, reason, assignedBy }) {
  await pool.query(`
    UPDATE crm_conversations
    SET assigned_agent_id = ?, queue_id = COALESCE(?, queue_id)
    WHERE id = ?
  `, [toAgentId, toQueueId, conversationId]);

  await pool.query(`
    INSERT INTO crm_assignments
      (conversation_id, from_user_id, to_user_id, from_queue_id, to_queue_id, reason, assigned_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [conversationId, fromAgentId || null, toAgentId || null, fromQueueId || null, toQueueId || null, reason || null, assignedBy || null]);
}

export async function getUnreadCount(agentId, role) {
  let sql, params;
  if (['admin', 'crm_admin'].includes(role)) {
    // Admin sees all open unread conversations
    sql = `SELECT COUNT(DISTINCT c.id) AS cnt FROM crm_conversations c
           JOIN crm_messages m ON m.conversation_id = c.id
           WHERE c.status = 'OPEN' AND m.sender_type = 'CUSTOMER' AND m.delivery_status != 'READ'`;
    params = [];
  } else {
    sql = `SELECT COUNT(DISTINCT c.id) AS cnt FROM crm_conversations c
           JOIN crm_messages m ON m.conversation_id = c.id
           WHERE c.assigned_agent_id = ? AND c.status = 'OPEN'
             AND m.sender_type = 'CUSTOMER' AND m.delivery_status != 'READ'`;
    params = [agentId];
  }
  const [[row]] = await pool.query(sql, params);
  return row?.cnt || 0;
}

// ������ Customers ��������������������������������������������������������������������������������������������������������������������������������

export async function listCrmCustomers({ search, customerType, limit = 50, offset = 0 } = {}) {
  const conditions = ['1=1'];
  const params = [];
  if (search) {
    conditions.push('(cu.full_name LIKE ? OR cu.phone LIKE ? OR cu.email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (customerType) { conditions.push('cu.customer_type = ?'); params.push(customerType); }

  const [rows] = await pool.query(`
    SELECT cu.*,
      (SELECT COUNT(*) FROM crm_conversations cv WHERE cv.crm_customer_id = cu.id) AS total_conversations,
      (SELECT COUNT(*) FROM crm_cases ca WHERE ca.crm_customer_id = cu.id AND ca.case_status NOT IN ('RESOLVED','CLOSED')) AS open_cases
    FROM crm_customers cu
    WHERE ${conditions.join(' AND ')}
    ORDER BY cu.updated_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);
  return rows;
}

export async function getCrmCustomer(id) {
  const [[customer]] = await pool.query(`SELECT * FROM crm_customers WHERE id = ?`, [id]);
  if (!customer) return null;

  // Channel identities
  const [identities] = await pool.query(`SELECT * FROM crm_customer_identities WHERE crm_customer_id = ?`, [id]);

  // Conversation history
  const [conversations] = await pool.query(`
    SELECT id, channel_type, status, priority, subject, first_message_at, last_message_at, resolved_at
    FROM crm_conversations WHERE crm_customer_id = ? ORDER BY last_message_at DESC LIMIT 10
  `, [id]);

  // Cases
  const [cases] = await pool.query(`
    SELECT id, case_no, case_type, case_status, priority, subject, opened_at, resolved_at
    FROM crm_cases WHERE crm_customer_id = ? ORDER BY opened_at DESC LIMIT 10
  `, [id]);

  // Linked legacy orders (if customer linked to existing customers table)
  let orders = [];
  if (customer.legacy_customer_id) {
    const [legacyOrders] = await pool.query(`
      SELECT o.id, o.job_no, o.status, o.cod_amount, o.price_amount, o.price_currency,
             o.created_at, t.status AS trip_status, t.trip_no
      FROM orders o
      LEFT JOIN trips t ON t.id = o.trip_id
      WHERE o.sender_id = ? OR o.receiver_id = ?
      ORDER BY o.created_at DESC LIMIT 10
    `, [customer.legacy_customer_id, customer.legacy_customer_id]);
    orders = legacyOrders;
  }

  return { customer, identities, conversations, cases, orders };
}

// ������ Cases ����������������������������������������������������������������������������������������������������������������������������������������

export async function listCases({ status, caseType, assignedTo, priority, search, limit = 50, offset = 0 } = {}) {
  const conditions = ['1=1'];
  const params = [];
  if (status)     { conditions.push('ca.case_status = ?'); params.push(status); }
  if (caseType)   { conditions.push('ca.case_type = ?');   params.push(caseType); }
  if (assignedTo) { conditions.push('ca.assigned_to = ?'); params.push(assignedTo); }
  if (priority)   { conditions.push('ca.priority = ?');    params.push(priority); }
  if (search) {
    conditions.push('(ca.case_no LIKE ? OR ca.subject LIKE ? OR cu.full_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const [rows] = await pool.query(`
    SELECT ca.*, cu.full_name AS customer_name, u.name AS assignee_name
    FROM crm_cases ca
    JOIN crm_customers cu ON cu.id = ca.crm_customer_id
    LEFT JOIN users u ON u.id = ca.assigned_to
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE ca.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 ELSE 4 END,
      ca.opened_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);
  return rows;
}

export async function getCase(id) {
  const [[c]] = await pool.query(`
    SELECT ca.*, cu.full_name AS customer_name, u.name AS assignee_name,
           o.job_no AS order_job_no
    FROM crm_cases ca
    JOIN crm_customers cu ON cu.id = ca.crm_customer_id
    LEFT JOIN users u ON u.id = ca.assigned_to
    LEFT JOIN orders o ON o.id = ca.related_order_id
    WHERE ca.id = ?
  `, [id]);
  return c || null;
}

export async function createCase({ conversationId, customerId, relatedOrderId, relatedJobNo, caseType, priority, subject, description, assignedTo, createdBy }) {
  // Generate case number: CASE-YYYYMMDDNNN
  const [[{ cnt }]] = await pool.query(`SELECT COUNT(*) AS cnt FROM crm_cases WHERE DATE(created_at) = CURDATE()`);
  const seq = String(cnt + 1).padStart(3, '0');
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const caseNo = `CASE-${today}${seq}`;

  const [result] = await pool.query(`
    INSERT INTO crm_cases
      (case_no, conversation_id, crm_customer_id, related_order_id, related_job_no,
       case_type, priority, subject, description, assigned_to, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [caseNo, conversationId || null, customerId, relatedOrderId || null, relatedJobNo || null,
      caseType, priority || 'NORMAL', subject, description || null, assignedTo || null, createdBy || null]);

  return { id: result.insertId, caseNo };
}

export async function resolveCase({ caseId, resolutionNote, userId }) {
  await pool.query(`
    UPDATE crm_cases SET case_status = 'RESOLVED', resolved_at = NOW(), resolution_note = ? WHERE id = ?
  `, [resolutionNote || null, caseId]);
}

// ������ Automation ������������������������������������������������������������������������������������������������������������������������������

export async function listAutomationRules() {
  const [rows] = await pool.query(`
    SELECT r.*, u.name AS creator_name
    FROM crm_automation_rules r
    LEFT JOIN users u ON u.id = r.created_by
    ORDER BY r.priority ASC, r.created_at DESC
  `);
  return rows;
}

export async function saveAutomationRule({ id, ruleName, description, triggerType, conditionsJson, actionsJson, priority, isActive, createdBy }) {
  if (id) {
    await pool.query(`
      UPDATE crm_automation_rules
      SET rule_name=?, description=?, trigger_type=?, conditions_json=?, actions_json=?,
          priority=?, is_active=?, updated_at=NOW()
      WHERE id=?
    `, [ruleName, description || null, triggerType, conditionsJson, actionsJson, priority || 10, isActive ? 1 : 0, id]);
    return id;
  }
  const [result] = await pool.query(`
    INSERT INTO crm_automation_rules
      (rule_name, description, trigger_type, conditions_json, actions_json, priority, is_active, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [ruleName, description || null, triggerType, conditionsJson, actionsJson, priority || 10, isActive ? 1 : 0, createdBy || null]);
  return result.insertId;
}

export async function deleteAutomationRule(id) {
  await pool.query(`DELETE FROM crm_automation_rules WHERE id = ?`, [id]);
}

// ������ Dashboard KPIs ����������������������������������������������������������������������������������������������������������������������

export async function getDashboardKpis() {
  const [[{ open_conversations }]] = await pool.query(
    `SELECT COUNT(*) AS open_conversations FROM crm_conversations WHERE status = 'OPEN'`
  );
  const [[{ pending_conversations }]] = await pool.query(
    `SELECT COUNT(*) AS pending_conversations FROM crm_conversations WHERE status = 'PENDING'`
  );
  const [[{ open_cases }]] = await pool.query(
    `SELECT COUNT(*) AS open_cases FROM crm_cases WHERE case_status NOT IN ('RESOLVED','CLOSED')`
  );
  const [[{ overdue_sla }]] = await pool.query(
    `SELECT COUNT(*) AS overdue_sla FROM crm_conversations WHERE sla_due_at < NOW() AND status = 'OPEN'`
  );
  const [channelVolume] = await pool.query(`
    SELECT channel_type, COUNT(*) AS cnt
    FROM crm_conversations WHERE DATE(created_at) = CURDATE()
    GROUP BY channel_type
  `);
  const [agentWorkload] = await pool.query(`
    SELECT u.name AS agent_name, COUNT(c.id) AS conversation_count
    FROM crm_conversations c
    JOIN users u ON u.id = c.assigned_agent_id
    WHERE c.status = 'OPEN'
    GROUP BY c.assigned_agent_id
    ORDER BY conversation_count DESC
    LIMIT 10
  `);
  const [topTags] = await pool.query(`
    SELECT t.tag_name, t.tag_color, COUNT(ct.id) AS usage_count
    FROM crm_conversation_tags ct
    JOIN crm_tags t ON t.id = ct.tag_id
    GROUP BY t.id ORDER BY usage_count DESC LIMIT 8
  `);

  return { open_conversations, pending_conversations, open_cases, overdue_sla, channelVolume, agentWorkload, topTags };
}

// ������ Helpers ������������������������������������������������������������������������������������������������������������������������������������

export async function listQueues() {
  const [rows] = await pool.query(`SELECT * FROM crm_queues WHERE is_active = 1 ORDER BY queue_name`);
  return rows;
}

export async function listTags() {
  const [rows] = await pool.query(`SELECT * FROM crm_tags WHERE is_active = 1 ORDER BY tag_group, tag_name`);
  return rows;
}


export async function listAgents() {
  const [rows] = await pool.query(`
    SELECT id, name, username, role FROM users
    WHERE role IN ('crm_admin','crm_supervisor','crm_agent','sales_agent','logistics_support','finance_support','admin','manager')
      AND (status = 'active' OR status IS NULL)
    ORDER BY name
  `);
  return rows;
}

export async function listChannels() {
  const [rows] = await pool.query(`SELECT * FROM crm_channels ORDER BY channel_type`);
  return rows;
}

export async function saveChannel({ channelType, channelName, pageId, accessToken, webhookSecret }) {
  const [[existing]] = await pool.query(`
    SELECT id FROM crm_channels WHERE channel_type = ? LIMIT 1
  `, [channelType]);

  if (existing) {
    const updates = ['channel_name = ?', 'external_account_id = ?', 'is_active = 1'];
    const params  = [channelName, pageId];
    if (accessToken) { updates.push('access_token_encrypted = ?'); params.push(accessToken); }
    if (webhookSecret) { updates.push('webhook_secret = ?'); params.push(webhookSecret); }
    params.push(existing.id);
    await pool.query(`UPDATE crm_channels SET ${updates.join(', ')} WHERE id = ?`, params);
    return existing.id;
  }

  const [result] = await pool.query(`
    INSERT INTO crm_channels (channel_type, channel_name, external_account_id, access_token_encrypted, webhook_secret, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `, [channelType, channelName, pageId, accessToken || null, webhookSecret || null]);
  return result.insertId;
}

// ������ Quick Reply CRUD ������������������������������������������������������������������������������������������������������������������

export async function listQuickReplies(opts = {}) {
  // Backward-compat: accepts string lang or object { search, category }
  if (typeof opts === 'string') opts = {};
  // Backward-compat: accepts string lang or object { search, category }
  const { search, category } = (typeof opts === "string") ? {} : opts;
  const conditions = ['is_active = 1'];
  const params = [];
  if (search)   { conditions.push('(title LIKE ? OR content_text LIKE ? OR shortcut_key LIKE ?)'); params.push('%'+search+'%', '%'+search+'%', '%'+search+'%'); }
  if (category) { conditions.push('category = ?'); params.push(category); }
  const where = conditions.join(' AND ');
  const [rows] = await pool.query('SELECT * FROM crm_quick_replies WHERE '+where+' ORDER BY category, title', params);
  return rows;
}

export async function createQuickReply({ title, shortcutKey, contentText, language = 'th', category, createdBy }) {
  const [r] = await pool.query(
    'INSERT INTO crm_quick_replies (title, shortcut_key, content_text, language, category, created_by, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
    [title, shortcutKey || null, contentText, language, category || null, createdBy || null]
  );
  return r.insertId;
}

export async function updateQuickReply(id, { title, shortcutKey, contentText, language, category }) {
  await pool.query(
    'UPDATE crm_quick_replies SET title=?, shortcut_key=?, content_text=?, language=?, category=? WHERE id=?',
    [title, shortcutKey || null, contentText, language || 'th', category || null, id]
  );
}

export async function deleteQuickReply(id) {
  await pool.query('UPDATE crm_quick_replies SET is_active = 0 WHERE id = ?', [id]);
}

// ������ Smart Reply Suggestions ����������������������������������������������������������������������������������������������������

const KEYWORD_GROUPS = {
  tracking:  ['�อ�!�ึ�!�ห�"','ส�า�"ะ','tracking','�"ิ��"าม','�~ัส�ุ','�ึ�!�ห�"','job'],
  delivery:  ['ล��า�`�0า','ยั�!�ม�����0','๬มื��อ�หร��','รอ�"า�"','�`�0า'],
  cod:       ['cod','๬ก�!�a๬�!ิ�"','�:ลาย�า�!','�อ�"','ยอ�'],
  greeting:  ['สวัส�ี','hello','hi','หวั��ี','�อสอ�a�าม'],
  complaint: ['ร�0อ�!๬รีย�"','�ม���~อ๒��','�Sิ��~ลา�','๬สียหาย','หาย'],
  inquiry:   ['รา�า','สั���!','อยาก���0','ส�"๒��','��:ร�ม�`ั���"'],
};

export async function getSmartReplySuggestions(conversationId) {
  const [[lastMsg]] = await pool.query(
    'SELECT content_text FROM crm_messages WHERE conversation_id=? AND sender_type=? ORDER BY sent_at DESC LIMIT 1',
    [conversationId, 'CUSTOMER']
  );
  const [qrs] = await pool.query('SELECT * FROM crm_quick_replies WHERE is_active=1');
  if (!lastMsg || !qrs.length) return [];
  const text = (lastMsg.content_text || '').toLowerCase();
  const scored = qrs.map(qr => {
    let score = 0;
    const qrText = (qr.title+' '+qr.content_text+' '+(qr.category||'')).toLowerCase();
    for (const [group, kws] of Object.entries(KEYWORD_GROUPS)) {
      const userHit = kws.some(k => text.includes(k));
      const qrHit   = kws.some(k => qrText.includes(k));
      if (userHit && qrHit)          score += 3;
      if (userHit && qr.category === group) score += 2;
    }
    if (qr.category === 'greeting') score += 0.5;
    return { ...qr, score };
  });
  return scored.filter(r => r.score > 0).sort((a,b) => b.score-a.score).slice(0,5);
}

// ������ Advanced Reports ������������������������������������������������������������������������������������������������������������������

export async function getAdvancedReportData({ startDate, endDate } = {}) {
  const start = startDate || new Date(Date.now()-14*24*3600*1000).toISOString().slice(0,10);
  const end   = endDate   || new Date().toISOString().slice(0,10);

  const [dailyTrend] = await pool.query(
    "SELECT DATE(created_at) AS day, COUNT(*) AS total, SUM(status IN ('RESOLVED','CLOSED')) AS resolved FROM crm_conversations WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY DATE(created_at) ORDER BY day",
    [start, end]
  );
  const [channelVolume] = await pool.query(
    'SELECT channel_type, COUNT(*) AS total FROM crm_conversations WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY channel_type',
    [start, end]
  );
  const [agentPerf] = await pool.query(
    "SELECT u.name AS agent_name, COUNT(DISTINCT c.id) AS total_conversations, SUM(c.status IN ('RESOLVED','CLOSED')) AS resolved, ROUND(AVG(TIMESTAMPDIFF(MINUTE,c.first_message_at,c.first_response_at)),0) AS avg_first_response_min, ROUND(AVG(TIMESTAMPDIFF(MINUTE,c.created_at,c.resolved_at)),0) AS avg_resolution_min FROM crm_conversations c JOIN users u ON u.id=c.assigned_agent_id WHERE DATE(c.created_at) BETWEEN ? AND ? GROUP BY c.assigned_agent_id ORDER BY resolved DESC",
    [start, end]
  );
  const [caseTypes] = await pool.query(
    'SELECT case_type, COUNT(*) AS total FROM crm_cases WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY case_type ORDER BY total DESC',
    [start, end]
  );
  const [topTags] = await pool.query(
    'SELECT t.tag_name, t.tag_color, COUNT(*) AS usage_count FROM crm_conversation_tags ct JOIN crm_tags t ON t.id=ct.tag_id JOIN crm_conversations c ON c.id=ct.conversation_id WHERE DATE(c.created_at) BETWEEN ? AND ? GROUP BY t.id ORDER BY usage_count DESC LIMIT 10',
    [start, end]
  );
  const [[sla]] = await pool.query(
    "SELECT COUNT(*) AS total, SUM(sla_due_at IS NULL OR first_response_at<=sla_due_at) AS compliant FROM crm_conversations WHERE DATE(created_at) BETWEEN ? AND ? AND first_response_at IS NOT NULL",
    [start, end]
  );
  const [[kpi]] = await pool.query(
    "SELECT COUNT(*) AS total_conversations, SUM(status='OPEN') AS open, SUM(status='PENDING') AS pending, SUM(status IN ('RESOLVED','CLOSED')) AS resolved, ROUND(AVG(TIMESTAMPDIFF(MINUTE,first_message_at,first_response_at)),0) AS avg_first_response_min, ROUND(AVG(TIMESTAMPDIFF(MINUTE,created_at,resolved_at)),0) AS avg_resolution_min FROM crm_conversations WHERE DATE(created_at) BETWEEN ? AND ?",
    [start, end]
  );
  return { dailyTrend, channelVolume, agentPerf, caseTypes, topTags, sla, kpi, start, end };
}

// ������ Customer Merge ����������������������������������������������������������������������������������������������������������������������

export async function mergeCrmCustomers(keepId, mergeId) {
  if (String(keepId) === String(mergeId)) throw new Error('Cannot merge customer with itself');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('UPDATE crm_customer_identities SET crm_customer_id=? WHERE crm_customer_id=?', [keepId, mergeId]);
    await conn.query('UPDATE crm_conversations SET crm_customer_id=? WHERE crm_customer_id=?', [keepId, mergeId]);
    await conn.query('UPDATE crm_cases SET crm_customer_id=? WHERE crm_customer_id=?', [keepId, mergeId]);
    const [[merged]] = await conn.query('SELECT note, customer_type FROM crm_customers WHERE id=?', [mergeId]);
    if (merged && merged.note) {
      await conn.query(
        "UPDATE crm_customers SET note=CONCAT(COALESCE(note,''),'\n[รวม��าก #',?,']: ',?) WHERE id=?",
        [mergeId, merged.note, keepId]
      );
    }
    if (merged && merged.customer_type === 'VIP') {
      await conn.query("UPDATE crm_customers SET customer_type='VIP' WHERE id=?", [keepId]);
    }
    await conn.query(
      "UPDATE crm_customers SET note=CONCAT('[MERGED INTO #',?,'] ',COALESCE(note,'')), customer_type='BLACKLIST' WHERE id=?",
      [keepId, mergeId]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function searchCrmCustomers(search, excludeId) {
  const [rows] = await pool.query(
    "SELECT id, full_name, phone, customer_type FROM crm_customers WHERE customer_type != 'BLACKLIST' AND id != ? AND (full_name LIKE ? OR phone LIKE ?) LIMIT 10",
    [excludeId, '%'+search+'%', '%'+search+'%']
  );
  return rows;
}
