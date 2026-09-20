# Partial-Delivery

Worker **التسليم الجزئي** لستاك EcomModa — شيل منتج (أو أكتر) من أوردر
`S1=Shipped`/`In-Return` Fulfilled من غير ما تلمس باقي المنتجات.

التفاصيل المعمارية والقواعد → [`CLAUDE.md`](./CLAUDE.md).

- `index.js` — Cloudflare Worker (المنطق كله هنا)
- `wrangler.toml` — إعداد الـ Worker

## 🔴 الريبو ده Worker بس — مفيش واجهة هنا (من 20-09-2026)

الواجهة اتشالت خالص من الريبو ده. الأداة بتشتغل **جوّه هب مركز عمليات
الشحن والتحصيل** (`Delivery-COD-Operations-Center` → `partial-delivery.html`)
— مش من صفحة مستقلة. تفاصيل الدمج كاملة في `CLAUDE.md`.

الواجهة : https://ecommoda-dev.github.io/Delivery-COD-Operations-Center/partial-delivery.html
