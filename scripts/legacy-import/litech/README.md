# LITECH — Google Sheet'dan tarixni ko'chirish (iyun–sentabr 2026)

Bir martalik import: markazning `LITECH 2026.xlsx` jurnalini (har o'qituvchi +
kun turi uchun varaq, har oy 26 ustunlik blok) tizimga "iyundan beri ishlab
kelayotgandek" yuklaydi. Xlsx faylda shaxsiy ma'lumot bor — `new-data/`
gitignore qilingan, repoga tushmaydi.

```bash
# 1) Bazaga tegmasdan tahlil (guruh zanjirlari, birlashtirilgan o'quvchilar, summalar)
npx ts-node -r tsconfig-paths/register --transpile-only \
  scripts/legacy-import/litech/dry-run.ts "new-data/LITECH 2026.xlsx"

# 2) Yuklash (qayta yuklashda --reset: shu filialdagi hamma narsa o'chadi, admin qoladi)
npx ts-node -r tsconfig-paths/register --transpile-only \
  scripts/legacy-import/litech/import.ts "new-data/LITECH 2026.xlsx" --apply --reset \
  --org 4 --center 7 --admin litech@talimplus.uz
```

Prod'da `--org/--center/--admin` o'sha bazadagi qiymatlar bilan beriladi.
Telegram bot **import tugagandan keyin** ulansin (skript botlarni o'zi o'chirib ishlaydi).

## Qoidalar (markaz egasi bilan kelishilgan)

| Sheet | Tizimda |
|---|---|
| Summa (ming so'm) | `submitReceipt` orqali tasdiqlangan chek, naqd |
| Chek sanasi | oy boshidan bor o'quvchi — oyning 10-sanasi; keyin qo'shilgan — qo'shilgan kuni |
| `proba`, `baza`, `bonus`, `ehson` | o'sha oy tekin: `manualExcludedAmount` = hisob, sababi bilan |
| To'lanmagan oy | qarz (ochiq to'lov qatori) |
| Qoldiq aynan 10% yoki 20 000 (to'liq oy) | qarz emas — o'sha oy va guruhga chegirma davri (`infer-discounts.ts`) |
| Hisobdan ko'p to'langan | `amountDue` to'langan summaga tenglanadi (pul bo'yicha haqiqat — sheet) |
| Davomat `1` / `0` / `2` / `5` | present / absent / excused ("Sababli") / present ("Bayram", to'lovga kiradi) |
| Bonus / jarima / izoh / imtihon | o'quvchi izohiga oyma-oy (guruh fondi hozircha yo'q) |
| Mentor ulushi | o'qituvchi `commissionPercentage = 50`, statik maosh yo'q |
| Qabulxona / mobilograf | 1 500 000 / 1 000 000 statik oylik, barcha oylar to'langan |
| O'qituvchiga berilgan oylik | alohida `Oqituvchilar Oylik-2026.xlsx` (parolli) — varaqdagi oy blokining "Mentor" qatori; oylik ish oyida turadi, pul keyingi oyning 5-sanasida (`salaries.ts`, jadval kodda). Faylda yo'q Shaxriyor — tizim hisobi |
| Avgust ishi | o'qituvchilarga **to'lanmagan**, summa tizim hisobi — rahbar o'zi to'g'rilaydi |
| O'qituvchi davomati (sheet'da yo'q) | darsi bor har kun bugungacha "keldi" (`manualCheckIn`, darsdan 10 daq. oldin). Alohida: `staff-attendance.ts` |
| Ijara, svet, gaz | `expenses` (100$ = 1 200 000 so'm) |

- **A'zolik oynasi** (`student_group_enrollments`) davomatdan chiqadi: birinchi
  belgili dars — qo'shilgan kun (to'liq to'lagan bo'lsa oy boshi); keyingi oy
  ro'yxatida yo'q bo'lsa — oxirgi kelgan darsdan keyin chiqqan.
- **Guruhni nomi belgilaydi**, vaqt o'zgarishi mumkin (FRONTEND-1 avgustda 08:00,
  sentabrda 08:30 — bitta guruh). Bir varaqda nomi bir xil guruhlar avval bog'lanadi;
  nomi yo'q yoki qayta nomlanganlari (N-1 → KOMP-6) umumiy o'quvchilar orqali.
  Guruhda oxirgi oy vaqti saqlanadi. Sentabrda yo'q guruh — `finished`.
- **O'quvchi** takrorlari: bir xil ism, yoki bitta telefon + o'xshash ism
  (tug'ilgan yil farq qilsa va ism ham farq qilsa — opa-singil, birlashtirilmaydi;
  bitta guruh-oyda yonma-yon turganlar hech qachon birlashtirilmaydi).
- Sentabr ro'yxatida bor, lekin hali kelmaganlar — `new` holatda, a'zolik 1-oktabrdan.

## Tekshiruv

`import.ts` oxirida baza sheet bilan solishtiriladi: har oy tushumi va har
o'qituvchining oylik ulushi (tizim komissiyasi) sheet'dagi JAMI / Mentor qatorlariga teng bo'lishi kerak.
Haqiqatda berilgan oylik esa boshqa fayldan — komissiya bilan farq qiladi, bu kutilgan.
Ma'lum istisno: `Nafisa_DCHJ` avgust footer'idagi `SUM(BZ5:BZ94)` guruh
sarlavhalaridagi narxlarni ham qo'shib yuborgan (sheet xatosi, +1 270 000).

`who.ts <ism qismi>` — sheet'dagi qatorlarni ism bo'yicha topish (tahlil uchun).
