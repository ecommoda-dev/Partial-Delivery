// ══════════════════════════════════════════════════════════════
// §HEADER
// Worker: partial-delivery-worker — EcomModa
// Tool:   التسليم الجزئي — Partial Delivery
//
// skills: worker-builder v3.4.0 · constants v2.7.0 · html-builder v7.2.0 ·
//         order-lifecycle v1.8.0 · shopify-graphql-helper v2.3.0 — 20-09-2026
//
// 🔴 **بتعمل إيه بالظبط.** الموظف بيدخل رقم أوردر أو يسكن الـ Order ID —
//    الأوردر ده S1 = Shipped (أو In-Return — قاعدة ١٢) والمنتجات فيه
//    Fulfilled بالكامل. الموظف بيختار منتج (أو أكتر) اتضح إنه مش هيتسلّم
//    فعليًا، والأداة بتشيله من الأوردر بلا ما تلمس باقي المنتجات:
//    ① تلغي الفلفلمنت الحالي (بيرجع الكل Unfulfilled) ·
//    ② Order Edit (`orderEditBegin`→`orderEditSetQuantity`→`orderEditCommit`)
//       بيصفّر كمية المنتج(ات) المطلوب حذفها ·
//    ③ فلفلمنت جديد (`fulfillmentCreate`) لباقي المنتجات — فترجع الحالة
//       Fulfilled زي ما كانت، والأوردر يفضل S1=Shipped زي ما هو.
//    ⛔ **ده مش استرجاع ولا استبدال** — مفيش S2 ومفيش `returns[]`. الأثر
//    المالي (لو فيه رد فلوس) شغل أداة تانية (`cod-payment-center-worker`).
//
// 🔴 **الترتيب ده قرار معماري مش تفصيلة تنفيذ** — Shopify's Order Edit API
//    بيقدر يعدّل كمية غير مُنفَّذة بس (`unfulfilledQuantity`). المنتج
//    Fulfilled كامل مالوش `unfulfilledQuantity` يتصفّر، فلازم إلغاء
//    الفلفلمنت الأول يرجّع الكمية unfulfilled قبل أي تعديل (Order Edit
//    نفسه ما بيلمسش حالة الفلفلمنت — Step 5A ⑩ ①: كل تحقق ممكن قبل أول
//    فعل لا رجعة فيه، والإلغاء هنا هو الفعل الأول ومطلوب لغيره).
//
// 🔴 **الأداة دي قطعة مستقلة — نفس شكل الطابورين بالظبط** (قرار ٨ في
//    `ecommoda-tool-migration-playbook`): ريبو واحد + Worker واحد + HTML
//    واحد. مفيش دمج مع هب `Delivery-COD-Operations-Center` — بطاقة بس على
//    الشاشة الرئيسية بتاعته بتفتح رابط الصفحة دي (نفس نمط `ready-orders`/
//    `shipped-orders`)، عشان مولّد الصفحات المدموجة
//    (`docs/port-standalone.py`) مقفول على الأداتين المسجّلتين فيه ولازم
//    قرار أحمد صريح يوسّعه لأداة تالتة.
//
// ⛔⛔⛔ **بند حاجز قبل أول نشر — لازم يُحسم قبل التشغيل.**
//    `tool = 'partial_delivery'` **لسه مش مسجّل** في `ecommoda-constants`
//    §7 (Rule 7: التسجيل قبل أول `writeLog` — القاعدة دي اتخرقت **ست
//    مرات** في ستاك EcomModa، وكل مرة الادعاء كان مكتوب في `CLAUDE.md`).
//    القيم المقترحة هنا (بانتظار تأكيد أحمد):
//      tool = 'partial_delivery'
//      type = 'remove_item' · 'remove_failed' · 'login' · 'logout'
//    ممنوع أي `writeLog` بالقيم دي ينزل `main` قبل ما تتسجّل في المهارة.
//
// 🔴 **v1.0.1 (بلاغ #55619 · 20-09-2026)** — ② كانت بترمي دايمًا:
//    "calculatedOrder_lookup: Field 'calculatedOrder' doesn't exist on
//    type 'QueryRoot'". `calculatedOrder(id:)` **مش موجودة** كـ query
//    field على QueryRoot أصلاً (اتأكّد بالاستقصاء الحي على السكيما)، والوصول
//    ليها بعد `orderEditBegin` لازم يبقى عن طريق `node(id:)` العام + fragment
//    — تفاصيل كاملة فوق `editRemoveLineItems`. **والأثر الحقيقي على
//    #55619:** ① (fulfillmentCancel) نجحت وسابت الأوردر UNFULFILLED، وبعدين
//    ② رمت الاستثناء قبل أي Order Edit — يعني الأوردر فضل واقف UNFULFILLED
//    من غير إعادة فلفلمنت لحد ما التاب اتقفل. أي أوردر لمسته المحاولات
//    الفاشلة قبل النشرة دي محتاج مراجعة يدوية (فلفلمنت جديد أو إعادة محاولة
//    بعد النشر).
// ══════════════════════════════════════════════════════════════
const TOOL_NAME      = 'partial_delivery';
const WORKER_VERSION = '1.0.1';

// ══════════════════════════════════════════════════════════════
// §CORS — Option B (قايمة صارمة)
// ══════════════════════════════════════════════════════════════
// ⚠️ أداة كتابة على أوردر حقيقي (Order Edit + Fulfillment) — نفس انحراف
//    `worker-builder` Step 3 الموثّق في أدوات التحصيل: الرد بيحمل اسم
//    عميل ومنتجات، ومستهلكه واحد معروف.
const ALLOWED_ORIGINS = ['https://ecommoda-dev.github.io'];
function getCORS(request) {
  const origin  = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

// ══════════════════════════════════════════════════════════════
// §HELPERS
// ══════════════════════════════════════════════════════════════
function json(data, status = 200, request = null) {
  const headers = { 'Content-Type': 'application/json' };
  Object.assign(headers, request ? getCORS(request) : { 'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0] });
  return new Response(JSON.stringify(data), { status, headers });
}

function assertEnv(env) {
  const missing = [];
  if (!env.DB)            missing.push('DB (d1_databases binding)');
  if (!env.SHOP_DOMAIN)   missing.push('SHOP_DOMAIN');
  if (!env.CLIENT_ID)     missing.push('CLIENT_ID');
  if (!env.CLIENT_SECRET) missing.push('CLIENT_SECRET');
  if (missing.length) {
    throw new Error(`متغيّرات ناقصة: ${missing.join(' · ')} — شغّل ?action=diag`);
  }
}

// ─── §HELPERS::time — توقيت القاهرة يتحسب مايتكتبش ثابت (constants §13) ───
const CAIRO_TZ = 'Africa/Cairo';
const _cairoFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAIRO_TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});
function cairoParts(d) {
  try {
    const o = {};
    for (const p of _cairoFmt.formatToParts(d)) if (p.type !== 'literal') o[p.type] = p.value;
    if (o.hour === '24') o.hour = '00';
    return o;
  } catch { return null; }
}
function cairoDate() { const p = cairoParts(new Date()); return p ? `${p.year}-${p.month}-${p.day}` : null; }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ══════════════════════════════════════════════════════════════
// §SHARED — copy verbatim from references/shared-functions.md — never modify
// ══════════════════════════════════════════════════════════════
async function verifyEmployee(db, username, pin) {
  const row = await db.prepare(
    'SELECT display_name, is_active FROM employees WHERE username = ? AND pin = ?'
  ).bind(username, pin).first();
  if (!row) return null;
  if (!row.is_active) throw new Error('الحساب موقوف — تواصل مع المسؤول');
  db.prepare('UPDATE employees SET last_login = ? WHERE username = ?')
    .bind(new Date().toISOString(), username).run().catch(() => {});
  return row.display_name;
}

async function checkEmployee(db, username) {
  const row = await db.prepare(
    'SELECT is_active, pin FROM employees WHERE username = ?'
  ).bind(username).first();
  if (!row) return { exists: false, hasPin: false, isActive: false };
  return { exists: true, hasPin: !!row.pin, isActive: !!row.is_active };
}

async function registerPin(db, username, pin) {
  const row = await db.prepare(
    'SELECT pin, is_active FROM employees WHERE username = ?'
  ).bind(username).first();
  if (!row)           throw new Error('اسم المستخدم غير موجود');
  if (!row.is_active) throw new Error('الحساب موقوف — تواصل مع المسؤول');
  if (row.pin)        throw new Error('هذا المستخدم مسجّل بالفعل — تواصل مع المسؤول لإعادة الضبط');
  await db.prepare('UPDATE employees SET pin = ? WHERE username = ?').bind(pin, username).run();
  return true;
}

async function writeLog(db, entry) {
  await db.prepare(`
    INSERT INTO logs
      (timestamp, tool, type, employee, order_id, order_name,
       sku, product_title, delta, value_before, value_after, notes, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    entry.timestamp    ?? new Date().toISOString(),
    entry.tool, entry.type,
    entry.employee     ?? null,
    entry.orderId      ?? null,
    entry.orderName    ?? null,
    entry.sku          ?? null,
    entry.productTitle ?? null,
    entry.delta        ?? null,
    entry.valueBefore  ?? null,
    entry.valueAfter   ?? null,
    entry.notes        ?? null,
    entry.extra ? JSON.stringify(entry.extra) : null
  ).run();
}

// ─── §SHARED::buildLogFilterSQL — قوايم (multi-select) + مدى تاريخ ───
function buildLogFilterSQL({ employees, types, search, dateFrom, dateTo }) {
  const where = ['tool = ?', "type NOT IN ('login','logout')"];
  const args  = [TOOL_NAME];
  if (employees && employees.length) {
    where.push(`employee IN (${employees.map(() => '?').join(',')})`);
    args.push(...employees);
  }
  if (types && types.length) {
    where.push(`type IN (${types.map(() => '?').join(',')})`);
    args.push(...types);
  }
  if (search) {
    where.push('(order_name LIKE ? OR notes LIKE ?)');
    args.push(`%${search}%`, `%${search}%`);
  }
  if (dateFrom) { where.push('timestamp >= ?'); args.push(dateFrom); }
  if (dateTo)   { where.push('timestamp <= ?'); args.push(dateTo); }
  return { whereSql: where.join(' AND '), args };
}

// ══════════════════════════════════════════════════════════════
// §SHOPIFY — نسخة قانونية من shopify-graphql-helper Step 1 · Step 1C
// ══════════════════════════════════════════════════════════════
let _lastThrottle = null, _lastQueryCost = [];

// §SHOPIFY::getAccessToken — بانضباط retry+backoff (worker-builder Step 5A ⑯②)
// التوكن مشترك بين كل Workers الستاك، فالفشل العابر لازم يتعافى.
const OAUTH_MAX_ATTEMPTS = 3;
async function getAccessToken(env) {
  let lastErr = null;
  for (let attempt = 1; attempt <= OAUTH_MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(`https://${env.SHOP_DOMAIN}/admin/oauth/access_token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET, grant_type: 'client_credentials' }),
      });
      if (!resp.ok) {
        const retriable = resp.status === 429 || resp.status >= 500;
        lastErr = new Error(`OAuth failed: ${resp.status}`);
        if (retriable && attempt < OAUTH_MAX_ATTEMPTS) { await sleep(700 * attempt); continue; }
        throw lastErr;
      }
      const data = await resp.json();
      if (!data.access_token) throw new Error('OAuth: No access_token in response');
      return data.access_token;
    } catch (e) {
      lastErr = e;
      if (attempt < OAUTH_MAX_ATTEMPTS) { await sleep(400 * attempt); continue; }
      throw lastErr;
    }
  }
  throw lastErr || new Error('OAuth: unknown failure');
}

// §SHOPIFY::shopifyGQL — النسخة القانونية بالحرف (shopify-graphql-helper Step 1)
async function shopifyGQL(env, token, query, variables = {}, opName = 'shopify', costLog = null) {
  const MAX_ATTEMPTS = 3;
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let resp, text;
    try {
      resp = await fetch(`https://${env.SHOP_DOMAIN}/admin/api/2026-01/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body: JSON.stringify({ query, variables }),
      });
      text = await resp.text();
    } catch (e) {
      lastErr = new Error(`${opName}: network failure — ${e.message}`);
      if (attempt < MAX_ATTEMPTS) { await sleep(400 * attempt); continue; }
      throw lastErr;
    }
    if (!resp.ok) {
      const retriable = resp.status === 429 || resp.status >= 500;
      lastErr = new Error(`${opName}: Shopify HTTP ${resp.status} — ${text.slice(0, 180)}`);
      if (retriable && attempt < MAX_ATTEMPTS) { await sleep(700 * attempt); continue; }
      throw lastErr;
    }
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`${opName}: non-JSON response — ${text.slice(0, 180)}`); }

    if (Array.isArray(data.errors) && data.errors.length) {
      const codes = data.errors.map(e => e?.extensions?.code).filter(Boolean);
      lastErr = new Error(`${opName}: ${data.errors.map(e => e.message).join(' | ')}` + (codes.length ? ` [${codes.join(',')}]` : ''));
      if (codes.includes('THROTTLED') && attempt < MAX_ATTEMPTS) { await sleep(1200 * attempt); continue; }
      throw lastErr;
    }
    if (!data.data) throw new Error(`${opName}: response has no data — ${text.slice(0, 180)}`);

    if (data.extensions?.cost) {
      const c = data.extensions.cost;
      if (c.throttleStatus) _lastThrottle = c.throttleStatus;
      const entry = { op: opName, requested: c.requestedQueryCost ?? null, actual: c.actualQueryCost ?? null };
      _lastQueryCost = [entry];
      if (costLog) costLog.push(entry);
    }
    return data;
  }
  throw lastErr || new Error(`${opName}: unknown failure`);
}

// ─── §SHOPIFY::gidToNumeric / numericToGid ───
function gidToNumeric(gid) { return gid ? String(gid).split('/').pop() : null; }
function orderGid(numericId) { return `gid://shopify/Order/${numericId}`; }

// ─── §SHOPIFY::normalizeOrderQuery — الباركود الطويل مقابل الاسم ───
// نفس عتبة `dcoScanParse` بالحرف: ID رقمي طويل (≥١٠ خانات) يتفسّر كـ ID،
// وأي حاجة تانية اسم (بعد شيل `#`).
function parseOrderQuery(raw) {
  const clean = String(raw || '').trim();
  if (!clean) return null;
  const digitsOnly = clean.replace(/\D/g, '');
  if (digitsOnly.length >= 10 && digitsOnly === clean.replace(/^#/, ''))
    return { kind: 'id', id: digitsOnly };
  const name = clean.startsWith('#') ? clean : '#' + clean;
  return { kind: 'name', name };
}

// ══════════════════════════════════════════════════════════════
// §ORDER — قراءة أوردر كاملة (نفس الاستعلام للـ lookup وللتحقق الطازج قبل الكتابة)
// ══════════════════════════════════════════════════════════════
const ORDER_FIELDS = `
  id name cancelledAt displayFulfillmentStatus displayFinancialStatus
  customer { displayName }
  manualStatusMf: metafield(namespace: "custom", key: "manual_status") { value }
  lineItems(first: 50) {
    nodes { id title sku variantTitle currentQuantity quantity unfulfilledQuantity
             image { url } }
  }
  fulfillments(first: 10) { id status displayStatus createdAt }
  fulfillmentOrders(first: 10) {
    nodes {
      id status
      lineItems(first: 50) {
        nodes { id remainingQuantity totalQuantity lineItem { id } }
      }
    }
  }
`;

async function fetchOrderById(env, token, numericId, costLog) {
  const data = await shopifyGQL(env, token,
    `query OrderLookup($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`,
    { id: orderGid(numericId) }, 'order_lookup_id', costLog);
  return data?.data?.order || null;
}

// §3.1 shopify-graphql-helper: name: بحث مش قراءة بمفتاح — لازم مطابقة الاسم الراجع
function cleanOrderName(n) { return String(n || '').replace(/^#/, ''); }

async function fetchOrderByName(env, token, name, costLog) {
  const data = await shopifyGQL(env, token,
    `query OrderSearch($q: String!) { orders(first: 1, query: $q) { nodes { ${ORDER_FIELDS} } } }`,
    { q: `name:${name}` }, 'order_lookup_name', costLog);
  const node = data?.data?.orders?.nodes?.[0] || null;
  if (!node) return null;
  if (cleanOrderName(node.name) !== cleanOrderName(name)) return null; // مطابقة إلزامية
  return node;
}

async function resolveOrder(env, token, rawQuery, costLog) {
  const parsed = parseOrderQuery(rawQuery);
  if (!parsed) return { order: null, error: 'قيمة فاضية' };
  const order = parsed.kind === 'id'
    ? await fetchOrderById(env, token, parsed.id, costLog)
    : await fetchOrderByName(env, token, parsed.name, costLog);
  return { order, error: order ? null : 'الأوردر غير موجود' };
}

// ─── §ORDER::eligibility — نفس الفحص للعرض وللتحقق الطازج قبل الكتابة ───
// S1=Shipped أو In-Return (order-lifecycle Rule 12: In-Return ≡ Shipped)
const ELIGIBLE_S1 = new Set(['Shipped', 'In-Return']);
function checkEligibility(order, requestedLineItemIds) {
  if (!order) return { eligible: false, reason: 'الأوردر غير موجود' };
  if (order.cancelledAt) return { eligible: false, reason: 'الأوردر ملغي (cancelledAt) — مفيش تسليم جزئي على أوردر ملغي' };

  const s1 = order.manualStatusMf?.value || null;
  if (!s1 || !ELIGIBLE_S1.has(s1))
    return { eligible: false, reason: `S1 = ${s1 || '—'} — الأداة دي لأوردرات Shipped أو In-Return بس` };

  if (!['FULFILLED', 'PARTIALLY_FULFILLED'].includes(order.displayFulfillmentStatus))
    return { eligible: false, reason: `حالة الفلفلمنت = ${order.displayFulfillmentStatus} — الأداة محتاجة أوردر Fulfilled فعلاً` };

  if (requestedLineItemIds && requestedLineItemIds.length) {
    const byId = new Map((order.lineItems?.nodes || []).map(li => [li.id, li]));
    for (const id of requestedLineItemIds) {
      const li = byId.get(id);
      if (!li) return { eligible: false, reason: `المنتج ${id} مش في الأوردر ده`, itemIssue: id };
      if (li.currentQuantity === 0) return { eligible: true, already: true, alreadyItem: id }; // idempotent
    }
  }
  return { eligible: true };
}

// ══════════════════════════════════════════════════════════════
// §REMOVE — إلغاء الفلفلمنت → Order Edit → إعادة الفلفلمنت
// ══════════════════════════════════════════════════════════════

// ─── §REMOVE::cancelFulfillments ───
async function cancelFulfillments(env, token, fulfillments, actions, costLog) {
  const open = (fulfillments || []).filter(f => f.status !== 'CANCELLED');
  for (const f of open) {
    const data = await shopifyGQL(env, token, `
      mutation FulfillmentCancel($id: ID!) {
        fulfillmentCancel(id: $id) {
          fulfillment { id status }
          userErrors { field message }
        }
      }`, { id: f.id }, 'fulfillmentCancel', costLog);
    const res  = data.data?.fulfillmentCancel;
    const errs = res?.userErrors || [];
    if (errs.length) throw new Error('fulfillmentCancel: ' + errs.map(e => e.message).join(' | '));
    if (res?.fulfillment?.status !== 'CANCELLED')
      throw new Error(`fulfillmentCancel: شوبيفاي ما أكدتش الإلغاء (status=${res?.fulfillment?.status})`);
    actions.push(`fulfillmentCancel×1 (${f.id})`);
  }
}

// ─── §REMOVE::editRemoveLineItems ───
// 🔴 v1.0.1 — بلاغ #55619 (20-09-2026): كانت بتنادي `calculatedOrder(id:)`
//    كـ query جوّه QueryRoot — الحقل ده **مش موجود** أصلاً (اتأكّد بالاستقصاء
//    الحي على سكيما 2026-07: `calculatedOrder` مش من فروع QueryRoot، وهو
//    السبب الحرفي في فشل "calculatedOrder_lookup: Field 'calculatedOrder'
//    doesn't exist on type 'QueryRoot'"). الوصول للـ CalculatedOrder بعد
//    `orderEditBegin` بيبقى عن طريق `node(id:)` العام + fragment — نفس نمط
//    `Order-Item-Remover/index.js` §SHOPIFY::removeLineItem بالحرف.
//    ⚠️ ومعاها بند تاني: `CalculatedLineItem` مالوش أي حقل بيرجع لـ
//    `LineItem` الأصلي (مفيش `lineItem { id }` — اتأكّد من الـ schema)،
//    فالكود القديم كان أصلاً هيفشل تاني حتى لو الاستعلام صح. المطابقة
//    الصح بالرقم العددي: شوبيفاي بتدّي الـ CalculatedLineItem بتاع عنصر
//    موجود قبل التعديل **نفس الرقم بالظبط** اللي كان لـ LineItem الأصلي —
//    بس النوع في الـ gid بيتغيّر (مقيس حيًا على #55619 20-09-2026: LineItem
//    /17587028033858 → CalculatedLineItem/17587028033858، ونفس الملاحظة
//    موجودة في Order-Item-Remover على #47101 26-08-2026).
async function editRemoveLineItems(env, token, orderId, lineItemIds, restock, staffNote, actions, costLog) {
  // ① orderEditBegin
  const beginData = await shopifyGQL(env, token, `
    mutation OrderEditBegin($id: ID!) {
      orderEditBegin(id: $id) { calculatedOrder { id } userErrors { field message } }
    }`, { id: orderId }, 'orderEditBegin', costLog);
  const beginRes = beginData.data?.orderEditBegin;
  if (beginRes?.userErrors?.length) throw new Error('orderEditBegin: ' + beginRes.userErrors.map(e => e.message).join(' | '));
  const calcOrderId = beginRes?.calculatedOrder?.id;
  if (!calcOrderId) throw new Error('orderEditBegin: شوبيفاي ما رجّعتش calculatedOrder');
  actions.push('orderEditBegin×1');

  // ② هات الـ calculated line items عن طريق node(id:) — ومطابقتها بالـ line
  //    items الأصلية بالرقم العددي (راجع الشرح فوق الدالة)
  const calcData = await shopifyGQL(env, token, `
    query GetCalcLineItems($id: ID!) {
      node(id: $id) { ... on CalculatedOrder { id lineItems(first: 50) { nodes { id sku quantity } } } }
    }`, { id: calcOrderId }, 'calculatedOrder_lookup', costLog);
  const calcNodes = calcData.data?.node?.lineItems?.nodes || [];

  // ③ orderEditSetQuantity(quantity: 0) لكل عنصر مطلوب حذفه
  for (const liId of lineItemIds) {
    const targetNumericId = gidToNumeric(liId);
    const match = calcNodes.find(n => gidToNumeric(n.id) === targetNumericId);
    if (!match) throw new Error(`orderEditSetQuantity: مالقتش calculated line item للمنتج ${liId}`);
    const calcLiId = match.id;
    const setData = await shopifyGQL(env, token, `
      mutation SetQty($id: ID!, $lineItemId: ID!, $quantity: Int!, $restock: Boolean) {
        orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity, restock: $restock) {
          calculatedLineItem { id quantity }
          userErrors { field message }
        }
      }`, { id: calcOrderId, lineItemId: calcLiId, quantity: 0, restock: !!restock }, 'orderEditSetQuantity', costLog);
    const setRes  = setData.data?.orderEditSetQuantity;
    const setErrs = setRes?.userErrors || [];
    if (setErrs.length) throw new Error('orderEditSetQuantity: ' + setErrs.map(e => e.message).join(' | '));
    if (setRes?.calculatedLineItem?.quantity !== 0)
      throw new Error(`orderEditSetQuantity: الكمية ما اتصفّرتش فعليًا (${setRes?.calculatedLineItem?.quantity})`);
    actions.push(`orderEditSetQuantity(0)×1 (${liId})`);
  }

  // ④ orderEditCommit
  const commitData = await shopifyGQL(env, token, `
    mutation Commit($id: ID!, $notify: Boolean!, $note: String) {
      orderEditCommit(id: $id, notifyCustomer: $notify, staffNote: $note) {
        order { id name }
        userErrors { field message }
      }
    }`, { id: calcOrderId, notify: false, note: staffNote }, 'orderEditCommit', costLog);
  const commitRes = commitData.data?.orderEditCommit;
  if (commitRes?.userErrors?.length) throw new Error('orderEditCommit: ' + commitRes.userErrors.map(e => e.message).join(' | '));
  if (!commitRes?.order?.id) throw new Error('orderEditCommit: شوبيفاي ما أكدتش التعديل');
  actions.push('orderEditCommit×1');
  return commitRes.order.id;
}

// ─── §REMOVE::refulfillRemaining — فلفلمنت جديد على الباقي بعد التعديل ───
async function refulfillRemaining(env, token, orderId, actions, costLog) {
  const data = await shopifyGQL(env, token, `
    query FO($id: ID!) {
      order(id: $id) {
        fulfillmentOrders(first: 10) {
          nodes { id status lineItems(first: 50) { nodes { id remainingQuantity } } }
        }
      }
    }`, { id: orderId }, 'fulfillmentOrders_after_edit', costLog);

  const fos = (data.data?.order?.fulfillmentOrders?.nodes || []).filter(fo => fo.status === 'OPEN');
  const byFO = [];
  for (const fo of fos) {
    const lines = (fo.lineItems?.nodes || []).filter(l => l.remainingQuantity > 0)
      .map(l => ({ id: l.id, quantity: l.remainingQuantity }));
    if (lines.length) byFO.push({ fulfillmentOrderId: fo.id, fulfillmentOrderLineItems: lines });
  }
  if (!byFO.length) { actions.push('fulfillmentCreate×0 (مفيش حاجة متبقية تتفلفل)'); return null; }

  const fcData = await shopifyGQL(env, token, `
    mutation Fulfill($input: FulfillmentInput!) {
      fulfillmentCreate(fulfillment: $input) {
        fulfillment { id status }
        userErrors { field message }
      }
    }`, { input: { lineItemsByFulfillmentOrder: byFO, notifyCustomer: false } }, 'fulfillmentCreate', costLog);
  const fcRes  = fcData.data?.fulfillmentCreate;
  const fcErrs = fcRes?.userErrors || [];
  if (fcErrs.length) throw new Error('fulfillmentCreate: ' + fcErrs.map(e => e.message).join(' | '));
  if (!fcRes?.fulfillment?.id) throw new Error('fulfillmentCreate: شوبيفاي ما أكدتش الفلفلمنت الجديد');
  actions.push(`fulfillmentCreate×1 (${fcRes.fulfillment.status})`);
  return fcRes.fulfillment;
}

// ══════════════════════════════════════════════════════════════
// §DIAG
// ══════════════════════════════════════════════════════════════
async function handleDiag(env, request) {
  const checks = [];
  const push = (ok, label, detail, hint) => checks.push({ ok, label, detail, hint });

  const s = env.WORKER_SECRET;
  const hasSecret = typeof s === 'string' && s.trim() !== '';
  push(hasSecret, 'سر الـ Worker', hasSecret ? `WORKER_SECRET=${String(s).length} حرف` : 'WORKER_SECRET=❌ ناقص',
       'Dashboard → Settings → Variables، وبعدها Promote — من غير Promote القيمة بتفضل undefined');

  try {
    assertEnv(env);
    push(true, 'المتغيّرات الأساسية', 'DB · SHOP_DOMAIN · CLIENT_ID · CLIENT_SECRET كلهم موجودين');
  } catch (e) {
    push(false, 'المتغيّرات الأساسية', `FAILED: ${e.message}`);
  }

  try {
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM logs WHERE tool = ?').bind(TOOL_NAME).first();
    push(true, 'D1 — صفوف الأداة', `${rows?.n ?? 0} صف تحت \`${TOOL_NAME}\``,
         'صفر صف مش دليل على عطل (constants §7.0) — ممكن الأداة لسه ما اتنشرتش');
  } catch (e) {
    push(false, 'D1', `FAILED: ${e.message}`, 'binding اسمه DB بالحرف في wrangler.toml');
  }

  try {
    assertEnv(env);
    const token = await getAccessToken(env);
    const data  = await shopifyGQL(env, token, `{ currentAppInstallation { accessScopes { handle } } }`, {}, 'diag_scopes');
    const scopes = (data.data?.currentAppInstallation?.accessScopes || []).map(s => s.handle);
    // 🔴 v1.0.1 — كانت بتفحص write_orders، وده غلط: اتأكّد بالاستقصاء الحي
    //    على السكيما إن orderEditBegin/SetQuantity/Commit مفيهمش write_orders
    //    في صلاحياتهم المقبولة أصلاً — المطلوب write_order_edits +
    //    read_order_edits (نفس ملاحظة Order-Item-Remover CLAUDE.md بالحرف).
    //    fulfillmentCancel/Create محتاجين واحدة من صلاحيات fulfillment orders
    //    (على الأغلب write_merchant_managed_fulfillment_orders + read_orders
    //    لأداة بتدير الشحن داخليًا زي دي) — الاسم بالظبط بيتوقف على إعداد
    //    التطبيق، فمش بيتفحص هنا؛ راجعه يدويًا لو الحذف رمى خطأ صلاحية رغم
    //    نجاح البند ده.
    const need = ['write_order_edits', 'read_order_edits'];
    const missing = need.filter(n => !scopes.includes(n));
    push(missing.length === 0, 'صلاحيات شوبيفاي',
         `${scopes.join(', ') || '—'}${missing.length ? ` — ناقص: ${missing.join(', ')}` : ''}`,
         'orderEditBegin/SetQuantity/Commit محتاجين write_order_edits+read_order_edits (مش write_orders). fulfillmentCancel/Create محتاجين صلاحية fulfillment orders منفصلة — راجعها يدويًا لو الفحص ده OK والحذف برضه بيرمي خطأ صلاحية');
  } catch (e) {
    push(false, 'شوبيفاي', `FAILED: ${e.message}`);
  }

  push(!!_lastThrottle, 'آخر throttleStatus', _lastThrottle ? JSON.stringify(_lastThrottle) : 'لسه مفيش نداء');
  push(true, 'آخر actualQueryCost', _lastQueryCost.length ? JSON.stringify(_lastQueryCost) : 'لسه مفيش نداء');

  const origin = request.headers.get('Origin') || '(بلا Origin)';
  push(ALLOWED_ORIGINS.includes(origin), 'الـ Origin', `${origin} · المسموح: ${ALLOWED_ORIGINS.join(', ')}`);

  push(true, '🔴 تسجيل D1', 'tool=partial_delivery غير مسجّل في ecommoda-constants §7 لحظة كتابة هذا الكود — بند حاجز قبل أول نشر (راجع CLAUDE.md)');

  return json({ ok: checks.every(c => c.ok), version: WORKER_VERSION, tool: TOOL_NAME, cairoDate: cairoDate(), checks }, 200, request);
}

// ══════════════════════════════════════════════════════════════
// §HANDLER
// ══════════════════════════════════════════════════════════════
const MAX_ITEMS_PER_REQUEST = 10; // مصدر الحالة: أوردر واحد وقت المرة — عدد بنوده محدود بطبيعته

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: getCORS(request) });

    if (typeof env.WORKER_SECRET !== 'string' || !env.WORKER_SECRET.trim())
      return json({ ok: false, error: 'WORKER_SECRET غير مضبوط على الـ Worker', step: 'env' }, 500, request);

    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.WORKER_SECRET}`)
      return json({ error: 'Unauthorized' }, 401, request);

    const url    = new URL(request.url);
    const action = url.searchParams.get('action') || '';

    try {
      if (action === 'get_config')
        return json({ ok: true, version: WORKER_VERSION, WORKER_VERSION, tool: TOOL_NAME }, 200, request);

      if (action === 'diag') return await handleDiag(env, request);

      assertEnv(env);

      // ═══════════════════ §AUTH — منسوخة حرفيًا ═══════════════════
      if (action === 'check_employee') {
        const username = url.searchParams.get('username');
        if (!username) return json({ ok: false, error: 'username مطلوب' }, 400, request);
        return json({ ok: true, ...(await checkEmployee(env.DB, username)) }, 200, request);
      }

      if (action === 'register_pin') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const { username, pin } = await request.json().catch(() => ({}));
        if (!username || !pin) return json({ ok: false, error: 'username و pin مطلوبان' }, 400, request);
        await registerPin(env.DB, username, pin);
        return json({ ok: true }, 200, request);
      }

      if (action === 'verify_employee') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const { username, pin } = await request.json().catch(() => ({}));
        if (!username || !pin) return json({ ok: false, error: 'username و pin مطلوبان' }, 400, request);
        const displayName = await verifyEmployee(env.DB, username, pin);
        if (!displayName) return json({ ok: false, error: 'PIN خطأ أو المستخدم غير موجود' }, 401, request);
        let logged = true;
        try { await writeLog(env.DB, { tool: TOOL_NAME, type: 'login', employee: username, notes: `دخول: ${displayName}` }); }
        catch { logged = false; }
        return json({ ok: true, displayName, logged }, 200, request);
      }

      if (action === 'log_logout') {
        const username = url.searchParams.get('username');
        let logged = true;
        if (username) {
          try { await writeLog(env.DB, { tool: TOOL_NAME, type: 'logout', employee: username, notes: `خروج: ${username.replace(/_/g, ' ')}` }); }
          catch { logged = false; }
        }
        return json({ ok: true, logged }, 200, request);
      }

      if (action === 'get_employees') {
        const { results } = await env.DB.prepare(
          'SELECT username, display_name FROM employees WHERE is_active = 1 ORDER BY display_name'
        ).all();
        return json({ ok: true, employees: results }, 200, request);
      }
      // ═══════════════════════════════════════════════════════════

      // ─── §LOOKUP — قراءة الأوردر بالاسم أو بالـ ID الطويل ───
      if (action === 'lookup_order') {
        const q = url.searchParams.get('q');
        if (!q) return json({ ok: false, error: 'q (اسم الأوردر أو الـ ID) مطلوب' }, 400, request);
        const token = await getAccessToken(env);
        const costLog = [];
        const { order, error } = await resolveOrder(env, token, q, costLog);
        if (!order) return json({ ok: false, error }, 404, request);
        const elig = checkEligibility(order, null);
        return json({
          ok: true,
          order: {
            id: gidToNumeric(order.id), gid: order.id, name: order.name,
            s1: order.manualStatusMf?.value || null,
            fulfillmentStatus: order.displayFulfillmentStatus,
            financialStatus: order.displayFinancialStatus,
            customer: order.customer?.displayName || null,
            cancelledAt: order.cancelledAt,
            lineItems: (order.lineItems?.nodes || []).map(li => ({
              id: li.id, title: li.title, sku: li.sku, variantTitle: li.variantTitle,
              currentQuantity: li.currentQuantity, quantity: li.quantity,
              unfulfilledQuantity: li.unfulfilledQuantity, image: li.image?.url || null,
              removed: li.currentQuantity === 0,
            })),
          },
          eligibility: elig,
          queryCost: costLog,
        }, 200, request);
      }

      // ─── §REMOVE — الفعل الأساسي: إلغاء → تعديل → إعادة فلفلمنت ───
      if (action === 'remove_items') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const body = await request.json().catch(() => ({}));
        const { employee, orderId, lineItemIds, restock, reason } = body;

        if (!employee)                                    return json({ ok: false, error: 'employee مطلوب' }, 400, request);
        if (!orderId)                                      return json({ ok: false, error: 'orderId مطلوب' }, 400, request);
        if (!Array.isArray(lineItemIds) || !lineItemIds.length)
          return json({ ok: false, error: 'lineItemIds (مصفوفة) مطلوبة' }, 400, request);
        if (lineItemIds.length > MAX_ITEMS_PER_REQUEST)
          return json({ ok: false, error: `عدد كبير (${lineItemIds.length}) — الحد ${MAX_ITEMS_PER_REQUEST} لكل نداء` }, 400, request);

        const token   = await getAccessToken(env);
        const costLog = [];
        const actions = [];
        const gid     = orderGid(orderId);

        // ─── Step 5A ⑩④ — الفحص لازم يتعمل على القراءة **الكاملة الطازجة** ───
        const order = await fetchOrderById(env, token, orderId, costLog);
        if (!order) {
          await writeLog(env.DB, { tool: TOOL_NAME, type: 'rejected', employee, orderId,
            notes: 'الأوردر غير موجود', extra: { result: 'rejected', stage: 'lookup' } }).catch(() => {});
          return json({ ok: false, status: 'error', error: 'الأوردر غير موجود' }, 404, request);
        }

        const elig = checkEligibility(order, lineItemIds);
        if (!elig.eligible) {
          await writeLog(env.DB, { tool: TOOL_NAME, type: 'rejected', employee, orderId, orderName: order.name,
            notes: elig.reason, extra: { result: 'rejected', stage: 'lookup', lineItemIds } }).catch(() => {});
          return json({ ok: false, status: 'rejected', error: elig.reason }, 409, request);
        }

        // ③ idempotent — كل اللي اتطلب اتشال بالفعل
        if (elig.already) {
          await writeLog(env.DB, { tool: TOOL_NAME, type: 'remove_item', employee, orderId, orderName: order.name,
            notes: 'المنتج(ات) متشالة بالفعل من الأوردر — مفيش حاجة كانت مطلوبة',
            extra: { result: 'already', stage: 'lookup', lineItemIds } }).catch(() => {});
          return json({ ok: true, status: 'already', message: 'المنتج(ات) دي متشالة من الأوردر بالفعل' }, 200, request);
        }

        const removedItemsMeta = (order.lineItems.nodes || [])
          .filter(li => lineItemIds.includes(li.id))
          .map(li => ({ id: li.id, title: li.title, sku: li.sku, quantity: li.currentQuantity }));

        let result = { status: 'error', error: null, warnings: [] };
        try {
          // ① إلغاء الفلفلمنت الحالي — إلزامي قبل Order Edit
          await cancelFulfillments(env, token, order.fulfillments, actions, costLog);

          // ② Order Edit — تصفير كمية العناصر المطلوب حذفها
          const staffNote = `تسليم جزئي — شيل ${removedItemsMeta.length} منتج بمعرفة ${employee}` + (reason ? ` — ${reason}` : '');
          const editedOrderId = await editRemoveLineItems(env, token, gid, lineItemIds, !!restock, staffNote, actions, costLog);

          // ③ إعادة فلفلمنت الباقي — تكميلي، فشله warning مش error (Step 5A ⑩②)
          try {
            await refulfillRemaining(env, token, editedOrderId || gid, actions, costLog);
            result.status = 'success';
          } catch (e2) {
            result.status = 'warning';
            result.warnings.push(`الحذف تم، لكن إعادة فلفلمنت الباقي فشلت (${e2.message}) — راجع الأوردر يدويًا وفلفل الباقي بنفسك`);
          }
        } catch (e) {
          result.status = 'error';
          result.error  = e.message;
        }

        let logged = true;
        try {
          await writeLog(env.DB, {
            tool: TOOL_NAME,
            type: result.status === 'error' ? 'remove_failed' : 'remove_item',
            employee, orderId, orderName: order.name,
            notes: result.status === 'error' ? result.error : `شيل ${removedItemsMeta.map(i => i.sku || i.title).join(', ')}`,
            extra: {
              result: result.status, stage: 'write',
              actions, removedItems: removedItemsMeta, restock: !!restock, reason: reason || null,
              warnings: result.warnings, s1Before: order.manualStatusMf?.value || null,
              fulfillmentStatusBefore: order.displayFulfillmentStatus,
            },
          });
        } catch { logged = false; }

        return json({
          ok: result.status !== 'error', status: result.status,
          error: result.error, warnings: result.warnings,
          actions, removedItems: removedItemsMeta, logged, queryCost: costLog,
        }, result.status === 'error' ? 500 : 200, request);
      }

      // ─── §LOG-ENDPOINTS ───
      if (action === 'get_logs') {
        const limit  = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 100);
        const offset = parseInt(url.searchParams.get('offset') || '0', 10);
        const employees = (url.searchParams.get('employees') || '').split(',').filter(Boolean);
        const types      = (url.searchParams.get('types') || '').split(',').filter(Boolean);
        const search     = url.searchParams.get('search') || null;
        const dateFrom   = url.searchParams.get('dateFrom') || null;
        const dateTo     = url.searchParams.get('dateTo') || null;
        const { whereSql, args } = buildLogFilterSQL({ employees, types, search, dateFrom, dateTo });
        const { results } = await env.DB.prepare(
          `SELECT * FROM logs WHERE ${whereSql} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
        ).bind(...args, limit, offset).all();
        return json({ ok: true, entries: results }, 200, request);
      }

      if (action === 'get_logs_count') {
        const employees = (url.searchParams.get('employees') || '').split(',').filter(Boolean);
        const types      = (url.searchParams.get('types') || '').split(',').filter(Boolean);
        const search     = url.searchParams.get('search') || null;
        const dateFrom   = url.searchParams.get('dateFrom') || null;
        const dateTo     = url.searchParams.get('dateTo') || null;
        const { whereSql, args } = buildLogFilterSQL({ employees, types, search, dateFrom, dateTo });
        const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM logs WHERE ${whereSql}`).bind(...args).first();
        return json({ ok: true, total: row?.n ?? 0 }, 200, request);
      }

      const LOG_EXPORT_MAX = 2000; // مصدر الحالة: نفس سقف الأدوات المشابهة في الستاك
      if (action === 'get_logs_export') {
        const employees = (url.searchParams.get('employees') || '').split(',').filter(Boolean);
        const types      = (url.searchParams.get('types') || '').split(',').filter(Boolean);
        const search     = url.searchParams.get('search') || null;
        const dateFrom   = url.searchParams.get('dateFrom') || null;
        const dateTo     = url.searchParams.get('dateTo') || null;
        const { whereSql, args } = buildLogFilterSQL({ employees, types, search, dateFrom, dateTo });
        const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM logs WHERE ${whereSql}`).bind(...args).first();
        const total = totalRow?.n ?? 0;
        const { results } = await env.DB.prepare(
          `SELECT * FROM logs WHERE ${whereSql} ORDER BY timestamp DESC LIMIT ?`
        ).bind(...args, LOG_EXPORT_MAX).all();
        return json({ ok: true, entries: results, cap: LOG_EXPORT_MAX, total, truncated: total > LOG_EXPORT_MAX }, 200, request);
      }

      return json({ error: `Unknown action: ${action}` }, 404, request);
    } catch (e) {
      return json({ ok: false, error: e.message }, 500, request);
    }
  },
};
