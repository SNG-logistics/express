/**
 * public/js/crm-realtime.js
 * CRM Inbox — Socket.io client
 *
 * Responsibilities:
 *   - Connect to Socket.io server
 *   - Join crm:inbox room (and optionally crm:conv:<id>)
 *   - Handle crm:new_message   → flash badge + toast + reload conversation list
 *   - Handle crm:new_conversation → show banner
 *   - Handle crm:typing         → show typing indicator in chat
 *   - Handle crm:supervisor_alert → supervisor alert toast
 *   - Emit crm:typing when agent types
 *
 * Usage: included in views/crm/inbox.ejs
 *   <script src="/socket.io/socket.io.js"></script>
 *   <script src="/js/crm-realtime.js"></script>
 *   <script>CrmRealtime.init({ role, userId, conversationId })</script>
 */

const CrmRealtime = (() => {
  let _socket = null;
  let _opts   = {};
  let _typingTimeout = null;

  // ── Toast notification ──────────────────────────────────────────────────────
  function showToast(message, type = 'info', duration = 5000) {
    // Remove existing toasts beyond 3
    const existing = document.querySelectorAll('.crm-rt-toast');
    if (existing.length >= 3) existing[0].remove();

    const toast = document.createElement('div');
    toast.className = 'crm-rt-toast';
    toast.style.cssText = `
      position:fixed; bottom:24px; right:24px; z-index:9999;
      background:${type === 'error' ? '#dc2626' : type === 'warning' ? '#d97706' : type === 'success' ? '#059669' : '#4f46e5'};
      color:#fff; padding:12px 18px; border-radius:12px;
      font-size:0.82rem; font-weight:600; font-family:inherit;
      box-shadow:0 8px 32px rgba(0,0,0,0.4);
      display:flex; align-items:center; gap:10px;
      animation:crm-toast-in 0.3s ease;
      max-width:360px; cursor:pointer;
    `;
    const icon = { info: '💬', warning: '⚠️', success: '✅', error: '🔴' }[type] || '💬';
    toast.innerHTML = `<span style="font-size:1.1rem;">${icon}</span><span>${message}</span>`;
    toast.onclick = () => toast.remove();
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, duration);
  }

  // Inject keyframe once
  if (!document.getElementById('crm-rt-style')) {
    const s = document.createElement('style');
    s.id = 'crm-rt-style';
    s.textContent = `
      @keyframes crm-toast-in {
        from { opacity:0; transform:translateY(20px); }
        to   { opacity:1; transform:translateY(0); }
      }
      .crm-typing-indicator {
        display:flex; align-items:center; gap:4px; padding:8px 14px;
        font-size:0.72rem; color:#94a3b8; font-style:italic;
      }
      .crm-typing-dot {
        width:5px; height:5px; border-radius:50%; background:#818cf8;
        animation:crm-bounce 1.2s infinite;
      }
      .crm-typing-dot:nth-child(2) { animation-delay:0.2s; }
      .crm-typing-dot:nth-child(3) { animation-delay:0.4s; }
      @keyframes crm-bounce {
        0%,80%,100% { transform:translateY(0); }
        40%         { transform:translateY(-5px); }
      }
      .crm-unread-pulse {
        animation:crm-pulse 1.5s ease-in-out 3;
      }
      @keyframes crm-pulse {
        0%,100% { box-shadow:none; }
        50%      { box-shadow:0 0 0 4px rgba(129,140,248,0.4); }
      }
    `;
    document.head.appendChild(s);
  }

  // ── Sidebar badge update ────────────────────────────────────────────────────
  function updateSidebarBadge(increment = true) {
    const badge = document.getElementById('crm-unread-badge');
    if (!badge) return;
    const current = parseInt(badge.textContent) || 0;
    const next = increment ? current + 1 : 0;
    badge.textContent = next > 0 ? next : '';
    badge.style.display = next > 0 ? 'inline-block' : 'none';
  }

  // ── Conversation list flash ────────────────────────────────────────────────
  function flashConversationItem(conversationId) {
    const item = document.querySelector(`.crm-conv-item[href*="/crm/inbox/${conversationId}"]`);
    if (item) {
      item.classList.add('crm-unread-pulse');
      // Move to top of list (simple DOM prepend)
      const list = item.parentNode;
      if (list) list.prepend(item);
    }
  }

  // ── Typing indicator ────────────────────────────────────────────────────────
  let _typingIndicatorEl = null;

  function showTypingIndicator(agentName) {
    const msgs = document.getElementById('chatMessages');
    if (!msgs) return;

    if (!_typingIndicatorEl) {
      _typingIndicatorEl = document.createElement('div');
      _typingIndicatorEl.className = 'crm-typing-indicator';
      _typingIndicatorEl.innerHTML = `
        <div class="crm-typing-dot"></div>
        <div class="crm-typing-dot"></div>
        <div class="crm-typing-dot"></div>
        <span style="margin-left:4px;" id="typingLabel"></span>
      `;
      msgs.appendChild(_typingIndicatorEl);
    }
    document.getElementById('typingLabel').textContent = `${agentName} กำลังพิมพ์...`;
    _typingIndicatorEl.style.display = 'flex';
    msgs.scrollTop = msgs.scrollHeight;
  }

  function hideTypingIndicator() {
    if (_typingIndicatorEl) _typingIndicatorEl.style.display = 'none';
  }

  // ── Outbound typing emit ────────────────────────────────────────────────────
  function onAgentTyping(conversationId, agentName) {
    if (!_socket || !conversationId) return;
    _socket.emit('crm:typing', { conversationId, agentName, isTyping: true });

    clearTimeout(_typingTimeout);
    _typingTimeout = setTimeout(() => {
      _socket.emit('crm:typing', { conversationId, agentName, isTyping: false });
    }, 2000);
  }

  // ── Main init ───────────────────────────────────────────────────────────────
  function init({ role = 'crm_agent', userId, conversationId, agentName } = {}) {
    _opts = { role, userId, conversationId, agentName };

    // Dynamically inject socket.io client if not already loaded
    if (typeof io === 'undefined') {
      const script = document.createElement('script');
      script.src = '/socket.io/socket.io.js';
      script.onload = () => connect();
      document.head.appendChild(script);
    } else {
      connect();
    }

    // Attach typing listener to reply textarea
    const textarea = document.getElementById('messageTextarea');
    if (textarea && conversationId && agentName) {
      textarea.addEventListener('input', () => onAgentTyping(conversationId, agentName));
    }
  }

  function connect() {
    try {
      _socket = io({ transports: ['websocket', 'polling'] });

      _socket.on('connect', () => {
        console.log('[CRM RT] Connected:', _socket.id);
        _socket.emit('crm:join', { role: _opts.role, userId: _opts.userId });

        // If viewing a specific conversation, join its room
        if (_opts.conversationId) {
          _socket.emit('crm:join_conversation', { conversationId: _opts.conversationId });
        }
      });

      _socket.on('disconnect', () => {
        console.log('[CRM RT] Disconnected');
      });

      // ── Inbound events ──────────────────────────────────────────────────────

      _socket.on('crm:new_message', (data) => {
        console.log('[CRM RT] new_message:', data);
        updateSidebarBadge(true);
        flashConversationItem(data.conversationId);

        const chLabels = { FACEBOOK: 'Facebook', WHATSAPP: 'WhatsApp', LINE_OA: 'LINE' };
        const chIcons  = { FACEBOOK: '🔵', WHATSAPP: '🟢', LINE_OA: '🟩' };
        const ch = chLabels[data.channelType] || data.channelType;
        const icon = chIcons[data.channelType] || '💬';

        showToast(`${icon} ${data.senderName || 'ลูกค้า'} ส่งข้อความใหม่ (${ch})`, 'info');

        // If this message is for the currently open conversation, reload the page
        if (data.conversationId && String(data.conversationId) === String(_opts.conversationId)) {
          // Optionally scroll-to-bottom + soft-reload messages (future: AJAX)
          // For now: reload the conversation pane
          setTimeout(() => window.location.reload(), 800);
        }
      });

      _socket.on('crm:new_conversation', (data) => {
        console.log('[CRM RT] new_conversation:', data);
        showToast(`🆕 การสนทนาใหม่จาก ${data.senderName || 'ลูกค้า'} (${data.channelType})`, 'info', 8000);
      });

      _socket.on('crm:typing', (data) => {
        if (!data.conversationId || String(data.conversationId) !== String(_opts.conversationId)) return;
        if (data.isTyping) {
          showTypingIndicator(data.agentName || 'Agent');
        } else {
          hideTypingIndicator();
        }
      });

      _socket.on('crm:supervisor_alert', (data) => {
        console.log('[CRM RT] supervisor_alert:', data);
        showToast(`🚨 Alert: ${data.message}`, 'warning', 10000);
      });

    } catch (err) {
      console.error('[CRM RT] Connection error:', err.message);
    }
  }

  return { init, showToast };
})();

// Auto-init if data attributes are present on body
document.addEventListener('DOMContentLoaded', () => {
  const b = document.body;
  const role           = b.dataset.crmRole;
  const userId         = b.dataset.crmUserId;
  const conversationId = b.dataset.crmConvId;
  const agentName      = b.dataset.crmAgentName;
  if (role) {
    CrmRealtime.init({ role, userId, conversationId, agentName });
  }
});
