<div dir="rtl" style="text-align: right;">

# التسليم الجزئي — Partial Delivery (`Partial-Delivery`)

![version](https://img.shields.io/badge/version-v1.0.1-blue)

**بتعمل إيه:** أوردر `S1 = Shipped` (أو `In-Return`) ومنتجاته **Fulfilled** بالكامل،
واتضح إن منتج (أو أكتر) منه مش هيتسلّم فعليًا. الموظف بيدخل رقم الأوردر أو يسكن
الـ Order ID، بيختار المنتج(ات) المطلوب حذفها، والأداة بتشيلهم من الأوردر
**من غير ما تلمس الباقي**: الأوردر يفضل `S1=Shipped` وباقي المنتجات تفضل Fulfilled.

**مين بيستخدمها:** موظفو الشحن والتحصيل.
**الإصدار:** `v1.0.1`

> 🔴 **أداة مستقلة — نفس شكل الطابورين بالظبط في هب `Delivery-COD-Operations-Center`**
> (قرار ٨ في `ecommoda-tool-migration-playbook`: أداة = Worker واحد + HTML واحد +
> ريبو واحد). **مفيش دمج مع الهب** — بطاقة بس على الشاشة الرئيسية بتاعته بتفتح
> رابط الصفحة دي، بنفس نمط `ready-orders`/`shipped-orders`.
> ⛔ **وليه مفيش دمج فعلي:** مولّد الصفحات المدموجة `docs/port-standalone.py`
> في هب المركز مقفول على أداتين معروفتين بالاسم (`order-status.html` ·
> `cod-payment.html`) وبيحتاج الريبوهات التلاتة جنب بعض عشان يشتغل. توسيعه
> لأداة تالتة قرار أحمد صريح، مش افتراض بيتاخد هنا.

## الروابط

```
الواجهة : https://ecommoda-dev.github.io/Partial-Delivery/
الـ Worker : https://partial-delivery-worker.ecommoda-dev.workers.dev
tool في D1 : partial_delivery   ← 🔴 لسه مش مسجّل في ecommoda-constants §7 (حاجز نشر)
مفتاح localStorage : partial_delivery_worker_secret
```

## ⛔⛔⛔ حاجز التشغيل الوحيد — قيمة `tool` مش مسجّلة

`tool = 'partial_delivery'` بالقيم `type = 'remove_item' · 'remove_failed' ·
'login' · 'logout'` **لسه مش موجودة** في جدول D1 بـ `ecommoda-constants` §7.

> Rule 7 بتقول: التسجيل **قبل** أول `writeLog` — والقاعدة دي اتخرقت **ست مرات**
> في ستاك EcomModa، وكل مرة الادعاء كان مكتوب في `CLAUDE.md` بالظبط زي السطر ده.
> **التحقق الوحيد المقبول `grep` على المهارة نفسها**، مش على الملف ده.

**قبل أي نشر حي أو `writeLog` فعلي:**
1. سجّل `partial_delivery` وقيمه في `ecommoda-constants` §7 (قرار أحمد).
2. راجع الجدول ده وامسح السطر ده لما يتسجّل.

## القرارات المعمارية

### ① الترتيب: إلغاء الفلفلمنت → Order Edit → إعادة الفلفلمنت

Shopify's Order Edit API (`orderEditSetQuantity`) بيعدّل بس الكمية **غير
المُنفَّذة** (`unfulfilledQuantity`) لسطر الأوردر. منتج Fulfilled بالكامل
`unfulfilledQuantity` بتاعه صفر، فمفيش حاجة يتصفّر. الحل — نفس اللي المستخدم
اقترحه بالحرف:

```
① fulfillmentCancel على كل فلفلمنت شغّال في الأوردر
   → يرجّع كل الكميات Unfulfilled (فلفلمنت أوردر جديد OPEN بكل الكمية)
② orderEditBegin → orderEditSetQuantity(quantity: 0) على المنتج(ات) المطلوب حذفها
   → orderEditCommit
③ fulfillmentCreate على كل الباقي (كل الـ fulfillment orders الـ OPEN بعد التعديل)
   → الأوردر يرجع Fulfilled على المنتجات المتبقية
```

- 🔴 **الأوردر يفضل `S1=Shipped`** — الأداة **مش** بتلمس الميتافيلد. الحذف ده
  تصحيح على أوردر شحن، مش دورة استرجاع/استبدال (S2). لو فيه أثر مالي (استرداد
  فلوس تحصيل)، ده شغل أداة تانية (`cod-payment-center-worker`) — الأداة دي
  **مالهاش أي نداء تحصيل**.
- 🔴 **الحذف نفسه `restock` اختياري** — الموظف بيحدد في الشاشة لو الكمية
  ترجع للمخزون ولا لأ. القيمة بتتسجّل في `extra.restock`.
- ⚠️ **الفعل التكميلي (③) فشله `warning` مش `error`** (`worker-builder`
  Step 5A ⑩②) — لو الحذف (② orderEditCommit) نجح والفلفلمنت الجديد فشل، الحالة
  بتتسجّل `warning` والرسالة بتقول للموظف يفلفل الباقي يدويًا. الحذف نفسه لا
  رجعة فيه، فتسجيله `error` كان هيخلّي الصف يفضل يتعاد بلا داعي.

### ② الأهلية — `S1 ∈ {Shipped, In-Return}` و Fulfilled فعلاً

نفس فحص واحد للعرض (`lookup_order`) وللتحقق الطازج قبل الكتابة
(`remove_items`) — `checkEligibility()` في `index.js`. القاعدة ١٢ في
`ecommoda-order-lifecycle`: `In-Return` بيتعامل زي `Shipped` بالظبط.

- 🔴 **الفحص بيتكرر على قراءة طازجة قبل أي فعل لا رجعة فيه** (`worker-builder`
  Step 5A ⑩④) — `lookup_order` وقراءة العرض ممكن تكون قديمة (موظف تاني عدّل
  في نفس اللحظة)، فـ`remove_items` بتعمل `fetchOrderById` تاني وتفحص عليه هو،
  مش على اللي الواجهة باعتته.
- 🔴 **Idempotent** — لو المنتج(ات) المطلوبة اتشالت بالفعل (`currentQuantity
  === 0`)، الرد `already` (محايد) مش `error` — نفس عائلة `already` في
  `worker-builder` Step 5A ④.

### ③ الأربع حالات — `success` / `warning` / `error` / `already`

نفس العقد الرسمي في `ecommoda-constants` §12. الواجهة بتلوّن كل حالة بلونها
(أخضر/أصفر/أحمر/محايد) ومفيش لون تحذير أو فشل على `already`.

## 🔴 v1.0.1 — إصلاح `calculatedOrder_lookup` (بلاغ أحمد على #55619 · 20-09-2026)

**البلاغ:** «شيل المنتجات المحددة» بيفشل دايمًا بعد ما `fulfillmentCancel`
تنجح، برسالة:

```
calculatedOrder_lookup: Field 'calculatedOrder' doesn't exist on type
'QueryRoot' | Variable $id is declared by CalcOrder but not used
[undefinedField,variableNotUsed]
```

**السبب — خطوة ② في `editRemoveLineItems` كانت بتنادي:**

```graphql
query CalcOrder($id: ID!) {
  calculatedOrder(id: $id) { id lineItems(first: 50) { nodes { id quantity lineItem { id } } } }
}
```

**التشخيص (اتأكّد بالاستقصاء الحي على سكيما `2026-01`/`2026-07`، مش بالتخمين):**

1. **`calculatedOrder(id:)` مش موجودة كـ query field على `QueryRoot` أصلاً** —
   `QueryRoot` فيه `orderEditSession(id:)` بس من عيلة order-edit، ومفيش
   `calculatedOrder` جنبها. الوصول لـ `CalculatedOrder` بعد `orderEditBegin`
   بيبقى عن طريق **`node(id:)` العام** + `... on CalculatedOrder { ... }`.
2. **وحتى لو الاستعلام كان صح، السطر التاني كان هيفشل برضه:** `CalculatedLineItem`
   **مالوش أي حقل بيرجع لـ `LineItem` الأصلي** — مفيش `lineItem { id }` في
   النوع ده خالص (اتأكّد من الـ schema). يعني المطابقة المكتوبة أصلاً كانت
   هتطلّع «مالقتش calculated line item» حتى بعد تصليح الاستعلام.

**الحل — نفس نمط `Order-Item-Remover/index.js` §SHOPIFY::removeLineItem بالحرف:**

```graphql
query GetCalcLineItems($id: ID!) {
  node(id: $id) { ... on CalculatedOrder { id lineItems(first: 50) { nodes { id sku quantity } } } }
}
```

والمطابقة بالرقم العددي للـ ID: شوبيفاي بتدّي الـ `CalculatedLineItem` بتاع
عنصر موجود قبل التعديل **نفس الرقم بالظبط** اللي كان لـ `LineItem` الأصلي —
بس النوع في الـ `gid` بيتغيّر (`gid://shopify/LineItem/123` →
`gid://shopify/CalculatedLineItem/123`). **مقيس حيًا على #55619 (20-09-2026)**
بعد استقصاء مباشر على شوبيفاي، ونفس الملاحظة موجودة بالحرف في
`Order-Item-Remover` على #47101 (26-08-2026) — سلوك ثابت في الـ API مش صدفة.

> ⛔ **لو الأداة دي كانت مبنية بمراجعة `shopify-graphql-helper` الأول**، البند
> ده كان هيتمسك قبل النشر — المهارة الحالية (v2.3.0) **صفر ذكر** لـ Order
> Editing API أو `CalculatedOrder`/`CalculatedLineItem` خالص. التفاصيل اللي
> اتأكّدت هنا مرشحة تتضاف كبند جديد في المهارة (راجع رسالة الجلسة).

### ⚠️ الأثر على الأوردرات اللي اتمسّت بالمحاولات الفاشلة

الترتيب في `remove_items` هو: ① `fulfillmentCancel` (بترجع كل الكميات
Unfulfilled) **قبل** ② Order Edit (`worker-builder` Step 5A ⑩①). يعني أي
محاولة حذف وقعت في البند ده كانت بتنفّذ ① بنجاح **وبعدين ترمي الاستثناء في
②** — فالأوردر بيفضل `UNFULFILLED` (الفلفلمنت الأصلي اتلغى) من غير إعادة
فلفلمنت أبدًا، لحد ما حد يتدخّل يدويًا.

- 🔴 **مقيس فعليًا على #55619**: بعد المحاولات الفاشلة في الشاشة، الأوردر
  رجع `displayFulfillmentStatus = UNFULFILLED` بالكامل (الفلفلمنت الوحيد
  عليه `CANCELLED`) — بينما شوبيفاي لسه بتقول `tags: [Shipped]` والميتافيلد
  `manual_status` لسه `Shipped` (الأداة دي مش بتلمسه أصلاً، فده متوقع).
- ⛔ **أي أوردر لمسته الأداة قبل نشر v1.0.1 محتاج مراجعة يدوية** — إما إعادة
  فلفلمنت المنتجات كلها من شوبيفاي مباشرة، أو إعادة محاولة الحذف من الأداة
  بعد الترقية (لو المنتج المطلوب حذفه لسه هو نفسه، خطوة ③ هتفلفل الباقي
  تلقائيًا زي ما المفروض من الأول).
- 🟡 **مفيش تعويض تلقائي لهذا السيناريو في الكود** — الفعل التكميلي (③) مصمَّم
  يرجع `warning` لو فشل *بعد* commit ناجح (Step 5A ⑩②)، لكن هنا الفشل كان
  *قبل* أي commit، فالكود بيرمي `error` صح ومفيش صف `remove_item` اتكتب —
  لكن الأثر الحقيقي على شوبيفاي (fulfillment cancelled) فضل قايم برضه لأنه
  خطوة منفصلة لا رجعة فيها. هل تستاهل الأداة قفل تراجعي (auto re-fulfill) لو
  ② فشلت بعد ما ① نجحت؟ قرار مفتوح لأحمد — مش مطبَّق دلوقتي.

## CORS

```
ALLOWED_ORIGINS = ['https://ecommoda-dev.github.io']   ← Option B صارمة
```

نفس سبب أدوات التحصيل: الرد بيحمل اسم عميل ومنتجات أوردر، ومستهلكه واحد
معروف. مفيش wildcard.

## D1

```
tool  : partial_delivery
type  : remove_item · remove_failed · login · logout
```

`remove_item` بتتسجّل حتى لو الحالة `warning`/`already` — الفرق يبان في
`extra.result`. `remove_failed` بس لو `③` (الإلغاء أو التعديل نفسه) رمى
استثناء. استعلام خط الأساس لازم يفلتر على `extra.result` مش على `type` لوحده
(`ecommoda-constants` §12).

## النشر — قائمة التحقق (`ecommoda-tool-migration-playbook` §9 و§11)

```
[ ] الريبو دُفع على main
[ ] Worker متعمل ومربوط من أول لحظة (Project name = partial-delivery-worker)
[ ] Build watch paths = index.js + wrangler.toml (chip لكل واحد)
[ ] WORKER_SECRET (فريد للأداة دي — مش عضو في أي مجموعة سر) → Promote
[ ] CLIENT_ID / CLIENT_SECRET (Shopify Custom App) → Promote
[ ] GitHub Pages مفعّل (Deploy from a branch → main → / root)
[ ] tool/type مسجّلين في ecommoda-constants §7 (حاجز — راجع القسم فوق)
[ ] بطاقة على الشاشة الرئيسية لهب Delivery-COD-Operations-Center بترجع للرابط ده
[ ] صلاحيات التطبيق فيها write_order_edits + read_order_edits (Order Edit — مش
    write_orders، اتأكّد بالاستقصاء الحي 20-09-2026) + صلاحية fulfillment
    orders مناسبة (Fulfillment Cancel/Create)
```

## بصمة المهارات

| المهارة | الإصدار وقت آخر تعديل |
|---|---|
| ecommoda-worker-builder | **v3.4.0** |
| ecommoda-html-builder | **v7.2.0** |
| ecommoda-constants | **v2.7.0** |
| ecommoda-order-lifecycle | **v1.8.0** |
| shopify-graphql-helper | **v2.3.0** |
| ecommoda-tool-migration-playbook | §9 (أداة جديدة من الصفر) |

## مسائل مفتوحة

### ✅ اتقفلت في v1.0.1 (بلاغ #55619 · 20-09-2026)

- ~~`editRemoveLineItems` بترمي `calculatedOrder_lookup: Field 'calculatedOrder'
  doesn't exist on type 'QueryRoot'` — الحذف بيفشل دايمًا بعد ما
  `fulfillmentCancel` تنجح~~ — بقت بتستخدم `node(id:)` + المطابقة بالرقم
  العددي (القسم فوق).
- 🔴 **مراجعة يدوية مطلوبة على أي أوردر لمسته الأداة قبل v1.0.1** — تحديدًا
  `#55619`: فضل `UNFULFILLED` من غير إعادة فلفلمنت. راجع القسم فوق قبل أي
  استخدام حي للأداة.
- 🟡 **مرشّح لتحديث `shopify-graphql-helper`** — المهارة (v2.3.0 وقت الكتابة)
  صفر ذكر لـ Order Editing API. التفاصيل المؤكَّدة حيًا (لا يوجد
  `calculatedOrder(id:)` على `QueryRoot` · `CalculatedLineItem` مالوش
  `lineItem{id}` · تطابق الرقم العددي بين `LineItem`/`CalculatedLineItem`)
  اتبعتت لأحمد في نفس الجلسة عشان تتضاف كبند رسمي.

### لسه مفتوحة

- 🔴 **تسجيل `tool=partial_delivery` في `ecommoda-constants` §7** — حاجز
  النشر الوحيد. راجع القسم فوق.
- 🔴 **إنشاء الـ Worker + الأسرار + GitHub Pages + Build watch paths** — خطوات
  يدوية في داشبورد كلاودفلير وGitHub (`ecommoda-tool-migration-playbook` §9)،
  ولسه ما اتعملتش.
- 🟡 **إضافة بطاقة الأداة على الشاشة الرئيسية لهب `Delivery-COD-Operations-Center`**
  — بطاقة رابط خارجي بس (نفس نمط الطابورين)، جوّه ريبو الهب مش هنا.
- 🟡 **صلاحية `write_order_edits` + `read_order_edits`** (مش `write_orders` —
  القيمة القديمة كانت غلط، اتصلّحت في `?action=diag` v1.0.1 بعد استقصاء حي
  أثبت إن `write_orders` مش من صلاحيات `orderEditBegin`/`SetQuantity`/`Commit`
  المقبولة أصلاً) لازم تتأكد فعليًا بعد أول نشر. `fulfillmentCancel`/`Create`
  محتاجين صلاحية fulfillment orders منفصلة (على الأغلب
  `write_merchant_managed_fulfillment_orders`) — الاسم بالظبط بيتوقف على
  إعداد التطبيق ومش متأكَّد هنا، فالفحص في `diag` بيقتصر على `order_edits`.

</div>

آخر تحديث: 20-09-2026 — v1.0.1 (إصلاح `calculatedOrder_lookup` — بلاغ #55619:
`calculatedOrder(id:)` مش موجودة على `QueryRoot`، والمطابقة بقت بـ`node(id:)`
+ الرقم العددي للـ ID، نفس نمط `Order-Item-Remover`. ⚠️ أوردرات اتمسّت
بمحاولات فاشلة قبل النشرة دي محتاجة مراجعة يدوية)
