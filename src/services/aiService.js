/**
 * src/services/aiService.js
 * AI Integration — comitapi.com (OpenAI-compatible API)
 *
 * Features:
 *  1. classifyIntent(text)          → intent label + queue routing
 *  2. generateSmartReplies(context) → 3 suggested replies in Thai
 *  3. summarizeConversation(msgs)   → brief summary for agents
 *  4. analyzeSentiment(text)        → POSITIVE | NEUTRAL | NEGATIVE | URGENT
 */

const AI_BASE_URL = process.env.AI_BASE_URL || 'https://api.comitapi.com/v1';
const AI_API_KEY  = process.env.AI_API_KEY  || '';
const AI_MODEL    = process.env.AI_MODEL    || 'gpt-4o-mini';

// ── Rate limiting & cache ─────────────────────────────────────────────────────
const _intentCache   = new Map(); // text → { intent, at }
const CACHE_TTL_MS   = 10 * 60 * 1000; // 10 min
let   _lastCallAt    = 0;
const MIN_INTERVAL_MS = 200; // max 5 req/s

async function callAI({ messages, maxTokens = 300, temperature = 0.3 }) {
  // Simple rate limiter
  const now = Date.now();
  const wait = MIN_INTERVAL_MS - (now - _lastCallAt);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastCallAt = Date.now();

  if (!AI_API_KEY) throw new Error('AI_API_KEY not configured');

  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model:       AI_MODEL,
      messages,
      max_tokens:  maxTokens,
      temperature,
    }),
    signal: AbortSignal.timeout(15000), // 15s timeout
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ── 1. Intent Classification ──────────────────────────────────────────────────
// Returns: { intent, queue, priority, confidence }
// Intents: TRACKING | DELAYED_DELIVERY | COD | CHANGE_ADDRESS | COMPLAINT |
//          PRODUCT_INQUIRY | PAYMENT | DAMAGED_ITEM | MISSING_ITEM | GENERAL

const INTENT_QUEUE_MAP = {
  TRACKING:         { queue: 'LOGISTICS', priority: 'NORMAL' },
  DELAYED_DELIVERY: { queue: 'LOGISTICS', priority: 'HIGH'   },
  COD:              { queue: 'FINANCE',   priority: 'NORMAL' },
  CHANGE_ADDRESS:   { queue: 'LOGISTICS', priority: 'HIGH'   },
  COMPLAINT:        { queue: 'GENERAL',   priority: 'HIGH'   },
  PRODUCT_INQUIRY:  { queue: 'SALES',     priority: 'NORMAL' },
  PAYMENT:          { queue: 'FINANCE',   priority: 'NORMAL' },
  DAMAGED_ITEM:     { queue: 'LOGISTICS', priority: 'HIGH'   },
  MISSING_ITEM:     { queue: 'LOGISTICS', priority: 'URGENT' },
  GENERAL:          { queue: 'GENERAL',   priority: 'NORMAL' },
};

export async function classifyIntent(text) {
  if (!text || text.trim().length < 3) {
    return { intent: 'GENERAL', queue: 'GENERAL', priority: 'NORMAL', confidence: 'low', source: 'fallback' };
  }

  // Cache check
  const cacheKey = text.slice(0, 80).toLowerCase();
  const cached = _intentCache.get(cacheKey);
  if (cached && (Date.now() - cached.at) < CACHE_TTL_MS) {
    return { ...cached.result, source: 'cache' };
  }

  try {
    const prompt = `คุณเป็น AI จำแนกประเภทข้อความจากลูกค้าของบริษัท SNG Logistics (ขนส่ง/โลจิสติกส์)
ข้อความ: "${text}"

จงตอบด้วย JSON เท่านั้น (ไม่มีข้อความอื่น):
{
  "intent": "<หนึ่งใน: TRACKING|DELAYED_DELIVERY|COD|CHANGE_ADDRESS|COMPLAINT|PRODUCT_INQUIRY|PAYMENT|DAMAGED_ITEM|MISSING_ITEM|GENERAL>",
  "confidence": "<high|medium|low>",
  "sentiment": "<POSITIVE|NEUTRAL|NEGATIVE|URGENT>",
  "summary_th": "<สรุปเนื้อหาในภาษาไทยสั้นๆ ไม่เกิน 30 คำ>"
}`;

    const rawResponse = await callAI({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 150,
      temperature: 0.1,
    });

    // Parse JSON response
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const parsed = JSON.parse(jsonMatch[0]);
    const intent  = Object.keys(INTENT_QUEUE_MAP).includes(parsed.intent) ? parsed.intent : 'GENERAL';
    const { queue, priority } = INTENT_QUEUE_MAP[intent];

    const result = {
      intent,
      queue,
      priority: parsed.sentiment === 'URGENT' ? 'URGENT' : priority,
      confidence: parsed.confidence || 'medium',
      sentiment: parsed.sentiment || 'NEUTRAL',
      summaryTh: parsed.summary_th || '',
      source: 'ai',
    };

    _intentCache.set(cacheKey, { result, at: Date.now() });
    console.log(`[AI] Intent: ${intent} (${result.confidence}) | Queue: ${queue} | Sentiment: ${result.sentiment}`);
    return result;

  } catch (err) {
    console.error('[AI] classifyIntent error:', err.message);
    // Keyword fallback
    return classifyIntentKeyword(text);
  }
}

// Keyword fallback (no AI)
function classifyIntentKeyword(text) {
  const t = text.toLowerCase();
  const KEYWORDS = {
    TRACKING:         ['ของถึงไหน','ติดตาม','tracking','status','เลขพัสดุ','เช็คพัสดุ'],
    DELAYED_DELIVERY: ['ล่าช้า','ไม่ได้รับ','หน้าหน่ายมาก','เมื่อไหร่จะถึง','รอนาน'],
    COD:              ['cod','เก็บเงินปลายทาง','ยังไม่โอน','รอเงิน','เงินไม่เข้า'],
    CHANGE_ADDRESS:   ['เปลี่ยนที่อยู่','address','ที่อยู่ใหม่','ย้าย'],
    DAMAGED_ITEM:     ['เสียหาย','แตก','บุบ','ชำรุด','หัก','ร้าว'],
    MISSING_ITEM:     ['หาย','ของหาย','สูญหาย','ไม่ครบ'],
    PAYMENT:          ['จ่าย','ชำระ','โอน','สลิป','payment'],
    COMPLAINT:        ['โกรธ','ไม่พอใจ','ร้องเรียน','แย่มาก','บริการแย่'],
    PRODUCT_INQUIRY:  ['สินค้า','ราคา','มี','ขาย','spec'],
  };
  for (const [intent, kws] of Object.entries(KEYWORDS)) {
    if (kws.some(k => t.includes(k))) {
      const { queue, priority } = INTENT_QUEUE_MAP[intent];
      return { intent, queue, priority, confidence: 'medium', sentiment: 'NEUTRAL', summaryTh: '', source: 'keyword' };
    }
  }
  return { intent: 'GENERAL', queue: 'GENERAL', priority: 'NORMAL', confidence: 'low', sentiment: 'NEUTRAL', summaryTh: '', source: 'keyword' };
}

// ── 2. Smart Reply Generation ─────────────────────────────────────────────────
// Returns: [{ title, content }] — 3 contextual replies in Thai/Lao

export async function generateSmartReplies({ customerMessage, conversationHistory = [], intent = 'GENERAL', customerName = '', lang = 'TH', groundingFacts = null }) {
  const historyText = conversationHistory.slice(-6).map(m =>
    `${m.sender_type === 'CUSTOMER' ? 'ลูกค้า' : 'เจ้าหน้าที่'}: ${m.content_text}`
  ).join('\n');

  const replyLangName = lang === 'LA' ? 'ภาษาลาว (Lao language)' : 'ภาษาไทย (Thai language)';
  const groundingBlock = formatGroundingFacts(groundingFacts);

  const prompt = `คุณเป็นเจ้าหน้าที่ CRM ของ SNG Logistics บริษัทขนส่ง
ลูกค้าชื่อ: ${customerName || 'ลูกค้า'}
ประเภทปัญหา: ${intent}

${groundingBlock}

ประวัติการสนทนา:
${historyText}

ข้อความล่าสุดจากลูกค้า: "${customerMessage}"

กฎสำคัญที่ต้องปฏิบัติตามอย่างเคร่งครัด: ห้ามสร้างหรือเดาตัวเลขราคา สถานะพัสดุ หรือข้อมูลอื่นใดที่ไม่มีอยู่ในบล็อก "ข้อมูลจริง" ด้านบน หากลูกค้าถามเรื่องที่ต้องใช้ข้อมูลจริง (เช่น ราคาค่าส่ง สถานะพัสดุ หรือค่าประมาณฝากซื้อ) แต่ไม่มีข้อมูลจริงให้ใช้ ให้ตอบกลับด้วยคำถามขอข้อมูลเพิ่มเติมจากลูกค้าแทนเท่านั้น ห้ามระบุตัวเลขหรือสถานะที่ไม่ได้มาจาก "ข้อมูลจริง" เด็ดขาด

จงสร้างคำตอบที่เหมาะสม 3 แบบ ในรูปแบบ JSON:
[
  { "title": "ชื่อแบบสั้น (ไม่เกิน 15 ตัว)", "content": "ข้อความตอบกลับ (20-80 คำ ใน${replyLangName} สุภาพ มืออาชีพ)" },
  { "title": "...", "content": "..." },
  { "title": "...", "content": "..." }
]
ตอบด้วย JSON อย่างเดียว ไม่มีข้อความอื่น`;

  try {
    const raw = await callAI({ messages: [{ role: 'user', content: prompt }], maxTokens: 500, temperature: 0.7 });
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array in response');
    const replies = JSON.parse(jsonMatch[0]);
    return Array.isArray(replies) ? replies.slice(0, 3) : [];
  } catch (err) {
    console.error('[AI] generateSmartReplies error:', err.message);
    return getDefaultReplies(intent, lang);
  }
}

/**
 * Renders whatever real facts replyGroundingService.buildGroundingContext()
 * found into a labelled block the model is told to treat as ground truth —
 * this is what stops it from inventing a price or a delivery status.
 */
function formatGroundingFacts(facts) {
  if (!facts) return 'ข้อมูลจริง: ไม่มี';

  const lines = [`วิธีสั่งซื้อ (ข้อมูลจริง): ${facts.howToOrder}`];

  if (facts.tracking) {
    lines.push(facts.tracking.found
      ? `ผลติดตามพัสดุเลข ${facts.tracking.ref} (ข้อมูลจริง): สถานะ "${facts.tracking.statusLabel || 'ไม่ระบุ'}" ปลายทาง ${facts.tracking.receiverProvince || '-'}`
      : `ไม่พบพัสดุหมายเลข ${facts.tracking.ref} ในระบบ (ข้อมูลจริง)`);
  }

  if (facts.shippingQuote) {
    lines.push(facts.shippingQuote.found
      ? `ราคาค่าส่งโดยประมาณ (ข้อมูลจริง): ${facts.shippingQuote.price} บาท`
      : 'ไม่พบเรทราคาที่ตรงกับน้ำหนัก/ขนาดที่ลูกค้าระบุ (ข้อมูลจริง)');
  }

  if (facts.purchaseAgentEstimate) {
    const e = facts.purchaseAgentEstimate;
    lines.push(e.missingPriceQty
      ? 'ลูกค้าแปะลิงก์สินค้ามาแต่ไม่ได้ระบุราคา/จำนวน (ข้อมูลจริง): ต้องถามราคาและจำนวนก่อนจะประเมินได้'
      : e.error
        ? 'ไม่สามารถคำนวณค่าประมาณฝากซื้อได้ในขณะนี้ (ข้อมูลจริง)'
        : `ค่าประมาณฝากซื้อ (ข้อมูลจริง): ชำระตอนสั่ง ~${e.payNowLak} กีบ, ชำระปลายทาง ~${e.payOnDeliveryLak} กีบ, รวม ~${e.totalLak} กีบ`);
  }

  return `ข้อมูลจริง (ใช้อ้างอิงเท่านั้น ห้ามเดานอกเหนือจากนี้):\n- ${lines.join('\n- ')}`;
}

function getDefaultReplies(intent, lang = 'TH') {
  const isLao = lang === 'LA';
  
  const defaults = {
    TRACKING: isLao ? [
      { title: 'ຂໍເລກພັດສະດຸ', content: 'ສະບາຍດີເດີ, ຂໍຊາບເລກພັດສະດຸ ຫຼື ໝາຍເລກອໍເດີ້ເພື່ອທຳການກວດສອບສະຖານະໃຫ້ແດ່ເດີ' },
      { title: 'ກຳລັງກວດສອບ', content: 'ກຳລັງກວດສອບສະຖານະພັດສະດຸໃຫ້ເດີ, ກະລຸນາລໍຖ້າຈັກໜ້ອຍໜຶ່ງເດີ' },
      { title: 'ແຈ້ງລິ້ງຕິດຕາມ', content: 'ສາມາດຕິດຕາມພັດສະດຸໄດ້ທີ່ເວັບໄຊທ໌ຂອງພວກເຮົາເດີ, ຫາກມີບັນຫາສາມາດແຈ້ງທີມງານໄດ້ເລີຍ' },
    ] : [
      { title: 'ขอเลขพัสดุ', content: 'สวัสดีครับ/ค่ะ ขอทราบเลขพัสดุหรือหมายเลขออเดอร์เพื่อตรวจสอบสถานะให้ครับ/ค่ะ' },
      { title: 'กำลังตรวจสอบ', content: 'กำลังตรวจสอบสถานะพัสดุให้ครับ/ค่ะ กรุณารอสักครู่นะครับ/ค่ะ' },
      { title: 'แจ้งลิงก์ติดตาม', content: 'สามารถติดตามพัสดุได้ที่เว็บไซต์ของเราครับ/ค่ะ หากมีปัญหาแจ้งทีมงานได้เลยนะครับ/ค่ะ' },
    ],
    DELAYED_DELIVERY: isLao ? [
      { title: 'ຂໍອະໄພຫຼ້າຊ້າ', content: 'ຂໍອະໄພໃນความຫຼ້າຊ້າຫຼາຍໆເດີ, ທາງເຮົາກຳລັງກວດສອບສາເຫດ ແລະ ຈະແຈ້ງໃຫ້ຊາບໂດຍໄວທີ່ສຸດ' },
      { title: 'ແຈ້ງສະຖານະ', content: 'ຂໍໂທດໃນຄວາມບໍ່ສະດວກເດີ, ພັດສະດຸແມ່ນຢູ່ລະຫວ່າງການຈັດສົ່ງ ແລະ ຈະຮອດໃນໄວໆນີ້' },
      { title: 'ຕິດຕາມເພີ່ມເຕີມ', content: 'ທາງທີມງານກຳລັງຕິດຕາມພັດສະດຸຂອງທ່ານຢູ່ເດີ, ຈະໂທແຈ້ງພາຍໃນ 2 ຊົ່ວໂມງນີ້' },
    ] : [
      { title: 'ขอโทษล่าช้า', content: 'ขออภัยในความล่าช้าอย่างสุดซึ้งครับ/ค่ะ กำลังตรวจสอบสาเหตุและจะแจ้งให้ทราบโดยเร็วที่สุดครับ/ค่ะ' },
      { title: 'แจ้งสถานะ', content: 'ขอโทษในความไม่สะดวกครับ/ค่ะ พัสดุอยู่ระหว่างการจัดส่งและจะถึงในเร็ว ๆ นี้ครับ/ค่ะ' },
      { title: 'ติดตามเพิ่มเติม', content: 'ทางทีมกำลังติดตามพัสดุของคุณครับ/ค่ะ จะโทรแจ้งภายใน 2 ชั่วโมงนะครับ/ค่ะ' },
    ],
  };

  return defaults[intent] || (isLao ? [
    { title: 'ຮັບຊາບ', content: 'ໄດ້ຮັບຂໍ້ມູນແລ້ວເດີ, ກຳລັງດຳເນີນການ ແລະ ຈະແຈ້ງກັບໂດຍໄວທີ່ສຸດ' },
    { title: 'ຂໍຂໍ້ມູນເພີ່ມ', content: 'ຂໍລົບກວນຂໍ້ມູນເພີ່ມເຕີມເພື່ອໃຫ້ການຊ່ວຍເຫຼືອໄດ້ດີຂຶ້ນແດ່ເດີ' },
    { title: 'ສົ່ງຕໍ່ທີມງານ', content: 'ຂໍໂອນສາຍໃຫ້ທີມງານຜູ້ຊ່ຽວຊານຊ່ວຍເບິ່ງແຍງຕໍ່ໃຫ້ເດີ' },
  ] : [
    { title: 'รับทราบ', content: 'ได้รับข้อมูลแล้วครับ/ค่ะ กำลังดำเนินการและจะแจ้งกลับโดยเร็วครับ/ค่ะ' },
    { title: 'ขอข้อมูลเพิ่ม', content: 'ขอรบกวนข้อมูลเพิ่มเติมเพื่อช่วยเหลือได้ดีขึ้นครับ/ค่ะ' },
    { title: 'ส่งต่อทีม', content: 'ขอโอนสายให้ทีมผู้เชี่ยวชาญดูแลต่อนะครับ/ค่ะ' },
  ]);
}



// ── 3. Conversation Summary ───────────────────────────────────────────────────
export async function summarizeConversation(messages) {
  if (!messages || messages.length < 3) return null;

  const dialog = messages.slice(-20).map(m =>
    `${m.sender_type === 'CUSTOMER' ? 'ลูกค้า' : 'เจ้าหน้าที่'}: ${m.content_text}`
  ).join('\n');

  const prompt = `สรุปการสนทนานี้สั้นๆ ในภาษาไทย ไม่เกิน 60 คำ โดยระบุ: ปัญหา / สิ่งที่ดำเนินการแล้ว / สถานะปัจจุบัน\n\n${dialog}`;

  try {
    return await callAI({ messages: [{ role: 'user', content: prompt }], maxTokens: 120, temperature: 0.3 });
  } catch (err) {
    console.error('[AI] summarizeConversation error:', err.message);
    return null;
  }
}

// ── 4. Sentiment Analysis (standalone) ───────────────────────────────────────
export async function analyzeSentiment(text) {
  if (!text) return 'NEUTRAL';
  const kw = text.toLowerCase();
  // Fast keyword check
  if (['โกรธ','ไม่พอใจ','แย่มาก','ห่วยมาก','เลิกใช้'].some(k => kw.includes(k))) return 'NEGATIVE';
  if (['ด่วน','เร่งด่วน','ด่วนมาก','ฉุกเฉิน'].some(k => kw.includes(k))) return 'URGENT';
  if (['ขอบคุณ','ประทับใจ','ดีมาก','พอใจ','ชอบ'].some(k => kw.includes(k))) return 'POSITIVE';
  return 'NEUTRAL';
}

// ── Health check ──────────────────────────────────────────────────────────────
export async function checkAiHealth() {
  try {
    const result = await callAI({
      messages: [{ role: 'user', content: 'Reply with: OK' }],
      maxTokens: 5,
    });
    return { ok: true, response: result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
