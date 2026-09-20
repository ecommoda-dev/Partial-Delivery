# Partial-Delivery

أداة **التسليم الجزئي** لستاك EcomModa — شيل منتج (أو أكتر) من أوردر
`S1=Shipped`/`In-Return` Fulfilled من غير ما تلمس باقي المنتجات.

التفاصيل المعمارية والقواعد → [`CLAUDE.md`](./CLAUDE.md).

- `index.js` — Cloudflare Worker
- `index.html` — الواجهة (App Shell + دخول + الأداة + تاب سجل)
- `wrangler.toml` — إعداد الـ Worker

جزء من مجموعة أدوات مركز الشحن والتحصيل (`Delivery-COD-Operations-Center`) —
أداة مستقلة بريبو ووركر خاصين بيها، مرتبطة ببطاقة من الشاشة الرئيسية للهب.
