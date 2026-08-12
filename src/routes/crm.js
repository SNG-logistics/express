/**
 * src/routes/crm.js
 * Omnichannel CRM � all routes
 * Role guards use the existing requireLogin / requireRole pattern.
 */

import { Router } from 'express';
import { requireLogin } from '../middleware/auth.js';
import {
  ROLES_CRM_VIEW,
  ROLES_CRM_AGENT,
  ROLES_CRM_ADMIN,
  ROLES_CRM_SUPERVISOR,
} from '../middleware/auth.js';
import * as ctrl from '../controllers/crmController.js';

const router = Router();

// Scope the guard to CRM paths. A router-level catch-all here would also
// intercept public routes mounted later (for example /track/:jobNo).
router.use(['/crm', '/api/crm'], requireLogin);

// ���� CRM role guard helper ��������������������������������������������������������������������������������������������������������
function requireCrmAccess(res, user, roles = ROLES_CRM_VIEW) {
  // owner = system owner: wildcard access to every CRM route.
  if (user?.role === 'owner') return null;
  if (!roles.includes(user?.role)) {
    return res.status(403).render('errors/403', {
      user,
      title: 'ไม่มีสิทธิ์เข้าถึง CRM',
      requiredRoles: roles,
    });
  }
  return null;
}

// ���� Channel Settings (crm_admin only) ������������������������������������������������������������������������������
router.get('/crm/channels', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_ADMIN);
  if (denied) return;
  return ctrl.channelList(req, res, next);
});

router.post('/crm/channels/save', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_ADMIN);
  if (denied) return;
  return ctrl.channelSave(req, res, next);
});


router.get('/crm', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user);
  if (denied) return;
  return ctrl.dashboard(req, res, next);
});

// ���� Unified Inbox ������������������������������������������������������������������������������������������������������������������������
router.get('/crm/inbox', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_AGENT);
  if (denied) return;
  return ctrl.inbox(req, res, next);
});

router.get('/crm/inbox/:id', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_AGENT);
  if (denied) return;
  return ctrl.conversation(req, res, next);
});

router.post('/crm/inbox/:id/reply', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_AGENT);
  if (denied) return;
  return ctrl.sendMessage(req, res, next);
});

router.post('/crm/inbox/:id/assign', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_SUPERVISOR);
  if (denied) return;
  return ctrl.assign(req, res, next);
});

router.post('/crm/inbox/:id/status', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_AGENT);
  if (denied) return;
  return ctrl.changeStatus(req, res, next);
});

router.post('/crm/inbox/:id/note', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_AGENT);
  if (denied) return;
  return ctrl.addNote(req, res, next);
});

router.post('/crm/inbox/:id/tag', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_AGENT);
  if (denied) return;
  return ctrl.addTag(req, res, next);
});

// ���� API: conversation list + unread count (JSON, for sidebar badge) ��������������������
router.get('/api/crm/inbox/unread', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_AGENT);
  if (denied) return;
  return ctrl.unreadCount(req, res, next);
});

// ���� Customer 360 ��������������������������������������������������������������������������������������������������������������������������
router.get('/crm/customers', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user);
  if (denied) return;
  return ctrl.customerList(req, res, next);
});

router.get('/crm/customers/:id', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user);
  if (denied) return;
  return ctrl.customer360(req, res, next);
});

// ���� Cases / Tickets ��������������������������������������������������������������������������������������������������������������������
router.get('/crm/cases', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user);
  if (denied) return;
  return ctrl.caseList(req, res, next);
});

router.get('/crm/cases/new', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_AGENT);
  if (denied) return;
  return ctrl.newCase(req, res, next);
});

router.post('/crm/cases', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_AGENT);
  if (denied) return;
  return ctrl.createCase(req, res, next);
});

router.get('/crm/cases/:id', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user);
  if (denied) return;
  return ctrl.caseDetail(req, res, next);
});

router.post('/crm/cases/:id/resolve', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_AGENT);
  if (denied) return;
  return ctrl.resolveCase(req, res, next);
});

// ���� Automation (crm_admin only) ��������������������������������������������������������������������������������������������
router.get('/crm/automation', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_ADMIN);
  if (denied) return;
  return ctrl.automationList(req, res, next);
});

router.post('/crm/automation', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_ADMIN);
  if (denied) return;
  return ctrl.saveRule(req, res, next);
});

router.delete('/crm/automation/:id', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_ADMIN);
  if (denied) return;
  return ctrl.deleteRule(req, res, next);
});

// ���� Reports (supervisor+) ��������������������������������������������������������������������������������������������������������
router.get('/crm/reports', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_SUPERVISOR);
  if (denied) return;
  return ctrl.reportsAdvanced(req, res, next);
});

// ���� Quick Replies API ����������������������������������������������������������������������������������������������������������������
router.get('/api/crm/quick-replies', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_AGENT);
  if (denied) return;
  return ctrl.quickReplies(req, res, next);
});

// ���� Tags API ����������������������������������������������������������������������������������������������������������������������������������
router.get('/api/crm/tags', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_AGENT);
  if (denied) return;
  return ctrl.tagList(req, res, next);
});

// ���� Quick Reply Management (crm_admin) ������������������������������������������������������������������������������
router.get('/crm/quick-replies', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_ADMIN);
  if (denied) return;
  return ctrl.quickReplyList(req, res, next);
});
router.post('/crm/quick-replies', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_ADMIN);
  if (denied) return;
  return ctrl.quickReplyCreate(req, res, next);
});
router.post('/crm/quick-replies/:id/update', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_ADMIN);
  if (denied) return;
  return ctrl.quickReplyUpdate(req, res, next);
});
router.post('/crm/quick-replies/:id/delete', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_ADMIN);
  if (denied) return;
  return ctrl.quickReplyDelete(req, res, next);
});

// ���� Smart Reply Suggestions API ����������������������������������������������������������������������������������������������
router.get('/api/crm/inbox/:id/suggestions', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_AGENT);
  if (denied) return;
  return ctrl.smartReplySuggestions(req, res, next);
});

// ���� Advanced Reports API (JSON) ����������������������������������������������������������������������������������������������
router.get('/api/crm/reports/data', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_SUPERVISOR);
  if (denied) return;
  return ctrl.reportsDataApi(req, res, next);
});

// ���� Customer Merge API ����������������������������������������������������������������������������������������������������������������
router.get('/api/crm/customers/:id/merge-search', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_SUPERVISOR);
  if (denied) return;
  return ctrl.customerMergeSearch(req, res, next);
});
router.post('/crm/customers/merge', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_SUPERVISOR);
  if (denied) return;
  return ctrl.customerMerge(req, res, next);
});

// ── AI Health Check ──────────────────────────────────────────────────────────
router.get('/api/crm/ai/health', async (req, res) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_ADMIN);
  if (denied) return;
  const { checkAiHealth } = await import('../services/aiService.js');
  const result = await checkAiHealth();
  return res.json(result);
});

// ── Customer Sync API (Admin) ─────────────────────────────────────────────────
router.get('/api/crm/sync/stats', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_ADMIN);
  if (denied) return;
  return ctrl.syncStats(req, res, next);
});

router.post('/api/crm/sync/run', (req, res, next) => {
  const denied = requireCrmAccess(res, req.session.user, ROLES_CRM_ADMIN);
  if (denied) return;
  return ctrl.syncRun(req, res, next);
});


export default router;


