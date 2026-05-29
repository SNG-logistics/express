/**
 * src/services/automationService.js
 * CRM Automation Engine — evaluates rules on inbound messages/events.
 *
 * Flow:
 *  1. inboundMessage(conversationId, messageText) → load active rules
 *  2. evaluate each rule's conditions_json
 *  3. execute actions_json
 *
 * Supported trigger types:
 *   NEW_MESSAGE, NEW_CONVERSATION, SLA_BREACH
 *
 * Supported conditions (field):
 *   message_text     operator: contains_any | contains_all | equals | not_contains
 *   channel_type     operator: equals | in
 *   queue_id         operator: equals
 *   customer_type    operator: equals | in
 *   priority         operator: equals | in
 *
 * Supported actions (type):
 *   assign_queue       params: { queue_id }
 *   assign_agent       params: { agent_id }
 *   add_tag            params: { tag_name }
 *   change_priority    params: { priority }
 *   change_status      params: { status }
 *   send_quick_reply   params: { shortcut }   [outbound sending — future]
 *   notify_supervisor  params: { message }    [socket emit]
 */

import pool from '../config/db.js';
import { addTagToConversation, updateConversationStatus, assignConversation } from './crmService.js';
import { classifyIntent, analyzeSentiment } from './aiService.js';

// ── Cache rules in memory, refresh every 5 minutes ───────────────────────────
let _rulesCache = null;
let _rulesCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getActiveRules(triggerType) {
  const now = Date.now();
  if (!_rulesCache || now - _rulesCacheTime > CACHE_TTL_MS) {
    const [rows] = await pool.query(`
      SELECT * FROM crm_automation_rules
      WHERE is_active = 1
      ORDER BY priority ASC
    `);
    _rulesCache = rows;
    _rulesCacheTime = now;
  }
  return _rulesCache.filter(r => r.trigger_type === triggerType);
}

export function invalidateRulesCache() {
  _rulesCache = null;
  _rulesCacheTime = 0;
}

// ── Condition evaluator ───────────────────────────────────────────────────────

function evaluateCondition(condition, context) {
  const { field, operator, value } = condition;
  const ctxValue = context[field];

  if (ctxValue === undefined || ctxValue === null) return false;

  const strVal = String(ctxValue).toLowerCase();

  switch (operator) {
    case 'contains_any': {
      const terms = Array.isArray(value) ? value : [value];
      return terms.some(t => strVal.includes(String(t).toLowerCase()));
    }
    case 'contains_all': {
      const terms = Array.isArray(value) ? value : [value];
      return terms.every(t => strVal.includes(String(t).toLowerCase()));
    }
    case 'not_contains': {
      const terms = Array.isArray(value) ? value : [value];
      return !terms.some(t => strVal.includes(String(t).toLowerCase()));
    }
    case 'equals':
      return strVal === String(value).toLowerCase();
    case 'in': {
      const opts = Array.isArray(value) ? value : [value];
      return opts.map(o => String(o).toLowerCase()).includes(strVal);
    }
    case 'not_equals':
      return strVal !== String(value).toLowerCase();
    default:
      return false;
  }
}

function evaluateRule(rule, context) {
  let conditions = [];
  try { conditions = JSON.parse(rule.conditions_json); } catch { return false; }
  if (!Array.isArray(conditions) || conditions.length === 0) return true; // empty = always match
  return conditions.every(c => evaluateCondition(c, context));
}

// ── Action executor ───────────────────────────────────────────────────────────

async function executeAction(action, conversation, io) {
  const { type, params = {} } = action;

  try {
    switch (type) {
      case 'assign_queue':
        if (params.queue_id) {
          await pool.query(`UPDATE crm_conversations SET queue_id = ? WHERE id = ?`, [params.queue_id, conversation.id]);
          console.log(`[AUTO] assign_queue ${params.queue_id} → conv ${conversation.id}`);
        }
        break;

      case 'assign_agent':
        if (params.agent_id) {
          await assignConversation({
            conversationId: conversation.id,
            toAgentId: params.agent_id,
            fromAgentId: conversation.assigned_agent_id,
            reason: 'automation_rule',
          });
          console.log(`[AUTO] assign_agent ${params.agent_id} → conv ${conversation.id}`);
        }
        break;

      case 'add_tag': {
        if (params.tag_name) {
          const [[tag]] = await pool.query(`SELECT id FROM crm_tags WHERE tag_name = ?`, [params.tag_name]);
          if (tag) {
            await addTagToConversation({ conversationId: conversation.id, tagId: tag.id });
            console.log(`[AUTO] add_tag "${params.tag_name}" → conv ${conversation.id}`);
          }
        }
        break;
      }

      case 'change_priority':
        if (params.priority) {
          await pool.query(`UPDATE crm_conversations SET priority = ? WHERE id = ?`, [params.priority, conversation.id]);
          console.log(`[AUTO] change_priority ${params.priority} → conv ${conversation.id}`);
        }
        break;

      case 'change_status':
        if (params.status) {
          await updateConversationStatus({ conversationId: conversation.id, status: params.status });
          console.log(`[AUTO] change_status ${params.status} → conv ${conversation.id}`);
        }
        break;

      case 'notify_supervisor':
        if (io && params.message) {
          io.to('crm:supervisors').emit('crm:supervisor_alert', {
            conversationId: conversation.id,
            customerId: conversation.crm_customer_id,
            message: params.message,
            at: new Date().toISOString(),
          });
          console.log(`[AUTO] notify_supervisor → "${params.message}"`);
        }
        break;

      case 'send_quick_reply':
        // Future: look up quick reply by shortcut and send via channel
        console.log(`[AUTO] send_quick_reply "${params.shortcut}" — queued for future channel integration`);
        break;

      case 'ai_auto_route':
        // AI-powered routing — already done in runOnNewMessage pre-step
        break;

      default:
        console.warn(`[AUTO] Unknown action type: ${type}`);
    }
  } catch (err) {
    console.error(`[AUTO] Action ${type} failed:`, err.message);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run automation for a NEW_MESSAGE event.
 * @param {object} conversation  - row from crm_conversations
 * @param {string} messageText   - inbound message content
 * @param {object} [io]          - Socket.io server instance (optional)
 */
export async function runOnNewMessage(conversation, messageText, io = null) {
  try {
    // ── Step 1: AI Intent Classification ─────────────────────────────────────
    let aiIntent = null;
    try {
      aiIntent = await classifyIntent(messageText);

      if (aiIntent && aiIntent.intent !== 'GENERAL') {
        // Auto-route queue based on AI intent
        const queueNameMap = { LOGISTICS: null, FINANCE: null, SALES: null, GENERAL: null };
        const [[queueRow]] = await pool.query(
          `SELECT id FROM crm_queues WHERE queue_type = ? AND is_active = 1 LIMIT 1`,
          [aiIntent.queue]
        ).catch(() => [[null]]);

        if (queueRow) {
          await pool.query(
            `UPDATE crm_conversations SET queue_id = ?, priority = ?,
             ai_intent = ?, ai_sentiment = ?, ai_summary = ?
             WHERE id = ?`,
            [queueRow.id, aiIntent.priority, aiIntent.intent, aiIntent.sentiment, aiIntent.summaryTh || null, conversation.id]
          ).catch(async () => {
            // ai_intent column may not exist yet — update only what we can
            await pool.query(
              `UPDATE crm_conversations SET queue_id = ?, priority = ? WHERE id = ?`,
              [queueRow.id, aiIntent.priority, conversation.id]
            );
          });
          console.log(`[AUTO][AI] Intent=${aiIntent.intent} → queue=${aiIntent.queue} priority=${aiIntent.priority} conv=${conversation.id}`);
        } else {
          // Fallback: update priority only
          await pool.query(
            `UPDATE crm_conversations SET priority = ? WHERE id = ?`,
            [aiIntent.priority, conversation.id]
          );
        }

        // Emit AI routing event to Socket.io
        if (io) {
          io.to('crm:inbox').emit('crm:ai_routed', {
            conversationId: conversation.id,
            intent: aiIntent.intent,
            queue: aiIntent.queue,
            priority: aiIntent.priority,
            sentiment: aiIntent.sentiment,
            source: aiIntent.source,
          });
        }
      }
    } catch (aiErr) {
      console.error('[AUTO][AI] Intent classification failed:', aiErr.message);
    }

    // ── Step 2: Rule-based automation ────────────────────────────────────────
    const rules = await getActiveRules('NEW_MESSAGE');
    if (!rules.length) return;

    const context = {
      message_text:  messageText || '',
      channel_type:  conversation.channel_type,
      queue_id:      String(conversation.queue_id || ''),
      customer_type: conversation.customer_type || '',
      priority:      conversation.priority,
      ai_intent:     aiIntent?.intent || '',
      ai_sentiment:  aiIntent?.sentiment || '',
    };

    for (const rule of rules) {
      if (!evaluateRule(rule, context)) continue;

      let actions = [];
      try { actions = JSON.parse(rule.actions_json); } catch { continue; }

      console.log(`[AUTO] Rule "${rule.rule_name}" matched conv ${conversation.id}`);
      for (const action of actions) {
        await executeAction(action, conversation, io);
      }
    }
  } catch (err) {
    console.error('[AUTO] runOnNewMessage error:', err.message);
  }
}

/**
 * Run automation for a NEW_CONVERSATION event.
 */
export async function runOnNewConversation(conversation, io = null) {
  try {
    const rules = await getActiveRules('NEW_CONVERSATION');
    if (!rules.length) return;

    const context = {
      channel_type:  conversation.channel_type,
      queue_id:      String(conversation.queue_id || ''),
      customer_type: '',
      priority:      conversation.priority,
    };

    for (const rule of rules) {
      if (!evaluateRule(rule, context)) continue;
      let actions = [];
      try { actions = JSON.parse(rule.actions_json); } catch { continue; }
      console.log(`[AUTO] NEW_CONVERSATION Rule "${rule.rule_name}" matched`);
      for (const action of actions) {
        await executeAction(action, conversation, io);
      }
    }
  } catch (err) {
    console.error('[AUTO] runOnNewConversation error:', err.message);
  }
}

/**
 * Run automation for SLA_BREACH.
 * Called by periodic SLA checker.
 */
export async function runOnSlaBreach(conversation, io = null) {
  try {
    const rules = await getActiveRules('SLA_BREACH');
    if (!rules.length) return;
    const context = { channel_type: conversation.channel_type, priority: conversation.priority };
    for (const rule of rules) {
      if (!evaluateRule(rule, context)) continue;
      let actions = [];
      try { actions = JSON.parse(rule.actions_json); } catch { continue; }
      for (const action of actions) {
        await executeAction(action, conversation, io);
      }
    }
  } catch (err) {
    console.error('[AUTO] runOnSlaBreach error:', err.message);
  }
}

/**
 * Periodic SLA breach checker — run every 5 minutes.
 * Call startSlaChecker(io) once from app.js after boot.
 */
export function startSlaChecker(io) {
  const CHECK_INTERVAL = 5 * 60 * 1000; // 5 min

  async function check() {
    try {
      const [overdue] = await pool.query(`
        SELECT * FROM crm_conversations
        WHERE status = 'OPEN'
          AND sla_due_at IS NOT NULL
          AND sla_due_at < NOW()
          AND first_response_at IS NULL
      `);

      for (const conv of overdue) {
        console.log(`[SLA] Breach detected: conv ${conv.id}`);
        await runOnSlaBreach(conv, io);
      }
    } catch (err) {
      console.error('[SLA] Checker error:', err.message);
    }
  }

  // Run immediately then at interval
  check();
  setInterval(check, CHECK_INTERVAL);
  console.log('[SLA] SLA breach checker started (every 5 min)');
}
