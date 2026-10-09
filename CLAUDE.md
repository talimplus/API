# Backend — `learning-center-saas`

Ta'lim markazlari uchun multi-tenant CRM backendi. NestJS 10 + TypeORM 0.3 + Postgres.
Bu fayl loyihani qaytadan o'qib chiqmaslik uchun: modul xaritasi, domen qoidalari
va konvensiyalar shu yerda.

> Frontend — `../cabinet_front_new/` (faol; qoidalari `.claude/rules/*.md` da).
> `../cabinet_front/` — eski versiya, faqat o'qish/namuna uchun. API kontrakti
> o'zgarsa ikkalasi **bir vaqtda** to'g'rilanadi.

---

## 1. Ishga tushirish

```bash
npm run start:dev      # watch (nest start --watch)
npm run build          # nest build -> dist/
npm run lint           # eslint --fix
npm test               # ⚠️ hozir ishlamaydi (pastda "Ma'lum muammolar")
npm run migration:run      # build + typeorm migration:run
npm run migration:revert
npm run migration:generate -- db/migrations/<Name>
```

- Port: `PORT` (default **3004**), Swagger: `http://localhost:3004/api`
- Env: `.env` (`DB_HOST/DB_PORT/DB_USER/DB_PASS/DB_NAME`, `PORT`, JWT, OpenAI).
  `TRUST_PROXY=true` — server nginx/traefik ortida turganda (xodim davomatida
  mijoz IP'sini to'g'ri aniqlash uchun; batafsil 6.8).
  ⚠️ Telegram bot tokeni env'da **emas** — har bir tashkilot o'z botini
  kabinetdan ulaydi (`telegram_bot_settings.botToken`, batafsil 6.10).
- Import alias: `@/` → `src/`. `db/` papkasi alias'siz (`db/data-source`).
- `dist/` kompilyatsiya natijasi: `dist/src/...` va `dist/db/...`.

## 2. So'rov yo'li (global konfiguratsiya)

`main.ts`: `CustomValidationPipe` (global) + `TypeOrmExceptionFilter` (global) + CORS
(`Content-Disposition` ochilgan — Excel eksporti uchun) + Swagger `/api` (bearer auth)
+ body limiti **2mb** (standart 100kb yetmasdi: tashkilot logotipi data URL bo'lib keladi).

Global guard'lar (`app.module.ts`, shu tartibda):

| Guard | Vazifasi |
|---|---|
| `JwtAuthGuard` | JWT tekshiradi, `@Public()` bo'lmasa majburiy. `req.user` to'ldiradi |
| `AccessGuard` | Organization obunasi faolmi (`isVip` yoki active subscription) |
| `RolesGuard` | Eski `@Roles(...)` (yangi kodda **ishlatilmaydi**) |
| `PermissionsGuard` | `@RequirePermissions('x.y')` — dinamik ruxsatlar |

`req.user` ichida: `userId`, `role`, `centerId`, `organizationId`, `permissions`.

**Xatolik formati:**
- 422 — `ValidationException` → `{ statusCode, message: 'Validation Failed', errors: { field: msg } }`.
  Global pipe `class-validator` xatolarini shu shaklga keltiradi (`whitelist`, `forbidNonWhitelisted`).
- Postgres `23505` (unique) → `TypeOrmExceptionFilter` uni maydonga bog'langan 422 ga aylantiradi.
- 400 — umumiy biznes qoidasi (`BadRequestException`), frontda snackbar'da chiqadi.

## 3. Multi-tenancy

```
Organization ─┬─ Subscription (obuna, AccessGuard tekshiradi)
              └─ Center (filial) ─┬─ User (xodim/o'qituvchi)
                                  ├─ Room, Subject, Syllabus
                                  ├─ Group ─ GroupSchedule
                                  └─ Student ─ Payment
```

**Qoida:** har bir so'rov `organizationId` bilan chegaralanadi (IDOR oldini olish).
Admin/super_admin `centerId` ni tanlashi mumkin, qolganlar o'z `req.user.centerId` ida qamalgan.
Yangi servis metodi yozayotganda `organizationId` parametri **majburiy**.

## 4. Ruxsatlar (dinamik rollar)

- Katalog: `src/common/permissions/permission.catalog.ts` — **yagona manba** (~76 ta kalit,
  `<modul>.<amal>` ko'rinishida, UI uchun uz/ru label bilan, guruhlarga bo'lingan).
  `GET /roles/permissions` shu ro'yxatni frontga beradi.
- Boshlang'ich rollar: `src/common/permissions/role.presets.ts` (manager/reception/teacher/other + qulflangan `admin` va `student`).
  Ro'yxatdan o'tishda seed qilinadi.
- `admin` roli — `permissions = ['*']`, `isLocked`, o'zgartirib bo'lmaydi.
- Endpoint himoyasi: `@RequirePermissions('students.create')`. Bir nechta kalit — **OR**.
- `users.role` (enum) saqlangan, lekin u endi faqat **rol turi** (masalan `teacher`
  guruhga biriktiriladi va foiz oladi). Ruxsat `users.userRole.permissions` dan o'qiladi.
- `RolesService` da 15 soniyalik kesh + invalidatsiya → admin rolni o'zgartirsa,
  xodim qayta login qilmasdan yangi ruxsatni oladi.
- **Yangi `@RequirePermissions` qo'shilsa/o'zgarsa** → frontda `npm run gen:api-permissions`.

## 5. Modullar

| Modul | Route | Nima qiladi |
|---|---|---|
| `auth` | `/auth` | login/register, JWT, `jwt.strategy.ts` |
| `blacklist` | — | logout qilingan tokenlar, kunlik tozalash cron'i (03:00) |
| `organizations` | `/organizations` | tenant, obuna holati |
| `subscriptions` | `/subscriptions` | obuna/tarif |
| `centers` | `/centers` | filiallar (`/centers/all` — ochiq) |
| `users` | `/users` | xodimlar, `/users/me`, maosh/foiz sozlamalari, **bloklash** (`PUT /users/:id/active`) |
| `roles` | `/roles` | dinamik rollar, `/roles/permissions` |
| `rooms`, `subjects` | `/rooms`, `/subjects` | ma'lumotnomalar |
| `groups` | `/groups`, `/group` | guruh CRUD, status, **narx tarixi** (`group-fee.service.ts`), `groups-lifecycle.service.ts` (kunlik 03:00 auto-finish) |
| `group_schedule` | `/group-schedule` | guruh dars kunlari/vaqti, **dars jadvali** (`/board`) va xona/o'qituvchi bandligi (`/conflicts`) |
| `attendance` | `/groups/:groupId/attendance` | o'quvchilar davomati + dars ko'chirish (`AttendanceLessonOverride`) |
| `staff-attendance` | `/staff-attendance` | **xodim davomati** ("Keldim", kechikish, ishonchlilik, hisobot) |
| `students` | `/students`, `/student` | o'quvchi CRUD, status, chegirma davrlari, **boshqa guruhga ko'chirish** |
| `enrollments` | — | a'zolik oynalari (`joinedAt`/`leftAt`) — billing chegaralari uchun yagona manba |
| `leads` | `/leads` | potentsial mijoz, `transferToStudent` |
| `payments` | `/payments` | **eng katta modul** — oylik hisob, cheklar, eksport |
| `teacher-earnings` | `/teacher-earnings` | o'qituvchi oylik daromadi + carryover |
| `staff-salaries` | `/staff-salaries`, `/staff` | xodim maoshlari, to'lovlari, **jarimalar** va xodim sahifasi (overview) |
| `expenses` | `/expenses` | xarajatlar |
| `referrals` | `/referrals` | do'st taklif qilish chegirmasi |
| `syllabus` | `/syllabuses`, `/groups/:id/plan`, `/teachers/me` | kurs rejasi, AI yordamchi (OpenAI), o'qituvchining bugungi darslari |
| `telegram` | `/telegram` | **ota-onalar boti** — QR ulanish, to'lov/davomat/qarz xabarlari |
| `statistics` | `/statistics/dashboard` | dashboard ko'rsatkichlari |
| `lessons`, `student-history` | — | **bo'sh stub modullar** (entity bor, logika yo'q) |

## 6. Domen qoidalari

### 6.1 Guruh (`groups`)

- `startDate` / `endDate` (DATE, guruh timezone'ida, **inclusive**) — darslar, to'lovlar,
  syllabus rejasi va avtomatik yopilish shu sanalarga qarab ishlaydi. `endDate = null` → muddatsiz.
- Status: `new → started → finished`. `changeStatus` da `endDate` majburiy mos keladi;
  `finished` qilinganda kelajakdagi `endDate` bugunga tortiladi.
- **`started` qilish uchun `endDate` ham, `room` ham bo'lishi shart.** Yetishmaganlari
  bitta 422 da qaytadi (`endDate`, `roomId`) — front tahrirlash formasini ochib xatoni
  aynan shu maydonlarga qo'yadi.
- **Xona guruhning o'z filialidan bo'lishi shart** (`create` ham, `update` ham
  tekshiradi; o'qituvchi ham shunday). Xona o'chirilsa guruh **o'chmaydi** —
  FK `ON DELETE SET NULL`, guruh "xonasiz" bo'lib qoladi.
- Kunlik cron (03:00) `endDate` o'tgan guruhlarni yopadi va o'quvchilar statusini moslaydi
  (`syncStudentStatusesForGroups`: hamma guruhi tugagan o'quvchi → `finished`).
- Sana/jadval o'zgarsa → shu guruhning **ochiq** to'lovlari qayta hisoblanadi.
  Tugash sanasi **oldinga tortilsa** (yoki `finished` qilinsa) to'liq to'langan
  oylar ham qayta hisoblanadi — o'tmagan darslar puli `refundedAmount` ga.
- `lessonDurationMinutes` (default 90) — bitta darsning uzunligi. Guruhning
  barcha darslari bir xil uzunlikda deb hisoblanadi.
- **O'chirish:** faqat o'z tashkiloti/filiali ichida; to'lov yoki davomat tarixi
  bor guruh o'chirilmaydi (400) — `finished` qilinadi.
- **O'qituvchi** faqat `teacher` turidagi xodim bo'ladi (422 `teacherId`).

### 6.1.2 Jadval, o'qituvchi tarixi va pauza (MUHIM, 2026-09-27)

Uchalasi ham "o'tgan darslar o'tgan holicha qoladi" tamoyili bo'yicha:

| Jadval | Ma'no | Kim o'qiydi |
|---|---|---|
| `group_schedule_periods` (`groupId, fromDate, days jsonb`) | sana uchun jadval = `fromDate <= sana` ga mos eng oxirgisi, yo'q bo'lsa eng birinchisi | `computeLessonDates({ schedulePeriods })`: to'lov, jurnal, davomat tekshiruvi, kechikish, syllabus, komissiya |
| `group_teacher_periods` (`groupId, teacherId, fromDate`) | sana uchun o'qituvchi (xuddi shu qoida) | `TeacherEarningsService.computeCommissionAmount` |
| `group_pauses` (`fromDate..toDate` inclusive, `reason`) | bu kunlarda dars **o'tkazilmaydi** | `computeLessonDates({ pauses })` + to'lovda `lessonsBillable` dan chiqariladi |

- `group_schedule` — faqat HOZIRGI jadval (dars jadvali sahifasi, bandlik). Jadval
  `PUT /groups/:id` da **haqiqatan o'zgarganda** (kun+vaqt kaliti solishtiriladi —
  forma har saqlashda `days` yuboradi) yangi davr `scheduleEffectiveFrom` (default
  bugun) dan yoziladi, undan keyingi davrlar o'chadi. O'tgan oylar proratsiyasi va
  eski kunlardagi davomat saqlanadi. Tarix yuklanmagan joyda (`schedulePeriods`
  undefined) eski xatti-harakat — `group_schedule`.
- Yuklash: `ensureSchedulePeriods` / `ensureGroupPauses`
  (`group_schedule/schedule-periods.util.ts`) — guruh obyektiga bir marta yuklaydi.
- O'qituvchi almashsa (`teacherEffectiveFrom`, default bugun) — tarixga yoziladi va
  o'sha oydan joriy oygacha ikkala o'qituvchining komissiyasi qayta hisoblanadi.
  Oy o'rtasida almashgan guruhda har bir to'lov o'quvchining shu oydagi darslari
  (a'zolik oynasi bilan) soniga qarab bo'linadi. Oylik berilgan (muzlatilgan) oy
  eski o'qituvchidan qaytarib olinmaydi — faqat yangisiga carryover.
- **Bayram kunlari** (`holidays`, `HolidaysModule`, `GET/POST/DELETE /holidays`):
  butun tashkilot (`centerId = null`) yoki bitta filial. Bu kunlarda hech bir
  guruhda dars yo'q (jurnal, davomat, kechikish, syllabus). To'lovda bayram
  darslari **rejadan ham** chiqariladi — oylik narx **o'zgarmaydi** (pauzadan
  farqi shu). `ensureGroupHolidays` guruhga yuklaydi; lesson-dates javobida
  `holidays` (oraliqdagi). Ruxsat: ko'rish `schedule.view|groups.view|attendance.view`,
  boshqarish `schedule.manage`. Davomat yozilgan kun — 422.
- Pauza: `GET/POST/DELETE /groups/:id/pauses` (`groups.view` / `groups.update`),
  `GroupPausesService`. Sabab majburiy, davrlar kesishmaydi, davomat yozilgan kunni
  to'xtatib bo'lmaydi (422). Qo'shilganda/o'chirilganda guruh to'lovlari (PAID ham)
  qayta hisoblanadi. `lessonsPlanned` o'zgarmaydi — oylik narx to'xtatilgan
  darslar ulushiga kamayadi.

### 6.1.1 Dars jadvali va bandlik (`group_schedule`)

`ScheduleBoardService` (`group_schedule/schedule-board.service.ts`) — alohida
kichik modul (`ScheduleBoardModule`), uni ham `GroupsModule`, ham
`GroupScheduleModule` ishlatadi (`GroupFeeModule` bilan bir xil sabab).

- **To'qnashuv qoidasi:** bir kunda, bir xonada (yoki bir o'qituvchida) vaqti
  kesishgan ikkita dars bo'lolmaydi. Oraliq yopiq-ochiq:
  `[startTime .. startTime + lessonDurationMinutes)` — ya'ni 09:00–10:30 va
  10:30–12:00 **to'qnashmaydi**, 09:00–10:30 va 10:00–11:30 to'qnashadi.
- Tekshiruv guruh yaratishda ham, tahrirlashda ham bajariladi
  (`assertScheduleAvailable`) va **422** bo'lib qaytadi: xona to'qnashuvi
  `roomId` maydoniga, o'qituvchiniki `teacherId` ga bog'lanadi.
- `POST /group-schedule/conflicts` — saqlashdan oldin tekshirish (forma
  natijani input ostida ko'rsatadi). Ruxsat: `schedule.view` **yoki**
  `groups.create` **yoki** `groups.update`.
- `GET /group-schedule/board?centerId=` — sahifa uchun **butun hafta**:
  filial xonalari + tugamagan guruhlarning barcha darslari. Kunni front
  o'zi filtrlaydi. O'qituvchi ham butun jadvalni ko'radi (xona bandligi —
  umumiy ma'lumot). Ruxsat: `schedule.view`.

### 6.2 Guruh narxi — oyga bog'langan (MUHIM)

Narx `groups.monthlyFee` da emas, **`group_fee_periods`** jadvalida (oy aniqligida):

| Ustun | Ma'no |
|---|---|
| `groupId` + `fromMonth` | unique; `fromMonth` — narx kuchga kirgan oy (YYYY-MM-01) |
| `monthlyFee` | shu oydan boshlab amal qiladigan to'liq oylik narx |

- Oy uchun narx = `fromMonth <= forMonth` shartiga mos **eng oxirgi** qator;
  mos qator bo'lmasa — **eng birinchi** qator; umuman bo'lmasa — `groups.monthlyFee`
  (`pickFeeForMonth`, `group-fee.service.ts`).
- `groups.monthlyFee` — faqat **joriy oyda amal qilayotgan** narxning denormalizatsiya
  qilingan nusxasi (ro'yxat/eksport uchun). Uni kunlik cron (00:05) va har o'qishda
  `attachFeeInfo` yangilaydi. **Pulni undan hisoblash mumkin emas.**
- **Biznes qoida:** narx oyning istalgan kunida o'zgartirilsa ham **keyingi oydan**
  kuchga kiradi. Joriy va o'tgan oylar (to'langan ham, to'lanmagan ham) tegilmaydi.
- Xatoni tuzatish: `PUT /groups/:id` ga `applyFeeFrom: 'current_month'` →
  shu oydan qo'llanadi va joriy oyning **ochiq** to'lovlari qayta hisoblanadi.
- Yangi narx joriy narx bilan teng bo'lsa — rejalashtirilgan kelgusi o'zgarish bekor bo'ladi.
- Javobda: `monthlyFee` (joriy oy), `upcomingMonthlyFee` + `upcomingFeeFromMonth` (reja yoki null).
- **O'quvchining shaxsiy narxi ustun:** `students.monthlyFee > 0` bo'lsa, guruh narxi
  o'zgarishi bu o'quvchiga umuman ta'sir qilmaydi.

### 6.3 To'lovlar (`payments`) — hisob mantiqi

Bitta qator = `(studentId, groupId, forMonth)` unique. Oy — `YYYY-MM-01` (DATE).

```
baseMonthlyFee = student.monthlyFee > 0 ? student.monthlyFee
                                        : <shu OY uchun guruh narxi>
amountDue = baseMonthlyFee
          * (lessonsBillable / lessonsPlanned)   // proratsiya
          * (1 - discountPercent / 100)          // chegirma
          - manualExcludedAmount                 // reception qo'lda chiqargan summa
```

- `lessonsPlanned` — **to'liq kalendar oy** jadvali bo'yicha darslar soni
  (guruh sana chegarasidan qat'i nazar).
- `lessonsBillable` — shundan o'quvchi to'laydiganlari: `[group.startDate..endDate]` ∩
  o'quvchining faol oynasi (`activatedAt`/guruhga qo'shilgan sana … `stoppedAt` /
  `plannedStudyUntilDate`). Oy o'rtasida qo'shilish/ketish shu yerda proratsiya bo'ladi.
- `lessonsExcused` (sababli) — **to'lovni kamaytirmaydi**, faqat ma'lumot (Req1).
  Kamaytirish faqat qo'lda: `manualExcludedAmount` (+ sabab majburiy).
- Chegirma — `student_discount_periods` (oy oralig'i, stacking, 100% cap) +
  doimiy `students.discountPercent` / `students.discountAmount`.
- **Doimiy chegirma oyga bog'langan** (`student_base_discounts`, `StudentBaseDiscountService`,
  guruh narxi davrlari bilan bir xil uslub). `PUT /students/:id` da qiymat o'zgarsa:
  shu oy uchun o'quvchidan pul olinmagan bo'lsa (`amountPaid = 0` va `pending` chek
  yo'q, istalgan guruhda) — **shu oydan**, olingan bo'lsa — **keyingi oydan** kuchga
  kiradi. O'tgan oylar hech qachon qayta narxlanmaydi (davomat o'zgarishida ham).
  Oy uchun qiymat = `fromMonth <= forMonth` ga mos eng oxirgi qator, bo'lmasa eng
  birinchisi, jadval bo'sh bo'lsa — `students` ustunlari. `students.discountPercent/Amount`
  — admin oxirgi kiritgan qiymat (forma/ro'yxat uchun), pul undan emas, tarixdan.
  Birinchi o'zgarishda eski qiymat `from − 1 oy` qatori sifatida yoziladi.
  Davr **foizda** (`percent`) yoki **summada** (`amount`, so'm/oy) — aynan bittasi
  (aks holda 422). `groupId` bo'lsa faqat o'sha guruh to'loviga (ikki fanda
  o'qiganga chegirma odatda arzonroq fanga); bo'sh — barcha guruhlarga.
  Formula: `... × (1 − percent/100) − amount − manualExcludedAmount`.
  **Summa faqat to'liq oyga** (`lessonsBillable >= lessonsPlanned`): oy o'rtasida
  qo'shilgan/chiqqan o'quvchiga chegirma keyingi oydan. Pul tushgan oyga yangi
  yoki o'zgargan davr qo'yib bo'lmaydi; forma qayta yuborgan o'zgarmagan davrlar
  bu tekshiruvdan o'tkaziladi.
- O'quvchining kabinet akkaunti (`users`, role=student) **bo'lmasligi mumkin**
  (import qilinganlar) — `student.user` ni doim null-tekshirib o'qing.
  `UsersService.findOne/update` bo'sh id da 404 beradi: TypeORM `where: { id: undefined }`
  shartsiz bo'lib, birinchi foydalanuvchini qaytaradi.
- Muddatlar: `dueDate` = oyning 10-sanasi, `hardDueDate` = 15-sanasi (guruh timezone'ida).
- **Cheklar va parallellik:** `submitReceipt` to'lov qatorini `FOR UPDATE` qulflab
  qoldiqni qayta tekshiradi (ikki xodim bir vaqtda ortiqcha qabul qila olmaydi;
  `available < 0` bo'lsa ham rad etiladi). `confirmReceipt` chekni qulflab holatini
  qayta tekshiradi, chek holati va pul **bitta tranzaksiyada** — ikki marta
  tasdiqlab bo'lmaydi. Tasdiqlashda qarzdan ortiq pul `refundedAmount` ga.
- Status: `UNPAID` / `PARTIAL` / `PAID` — `amountPaid` va `amountDue` nisbatidan chiqadi.

**Yaratish va qayta hisoblash:**
- `ensurePayments*` — yetishmayotgan oylik qatorlarni yaratadi. **Kelajak oy uchun
  qator yaratilmaydi** (chegara — joriy oy), shuning uchun keyingi oy narxi tabiiy ravishda
  yangi narxda hisoblanadi. `@Cron` **har kuni 00:10 Toshkent** (`generateMonthlyPayments`,
  idempotent — server 1-sanada o'chiq bo'lsa ham keyingi kuni yaratiladi). Yozish
  `INSERT … ON CONFLICT DO NOTHING` (bitta to'qnashuv to'plamni bekor qilmaydi),
  har bir o'quvchi/guruh hisobi alohida try/catch.
- `recalcOpenPaymentRows` — odatda faqat `status != PAID` qatorlarni yangilaydi.
  PAID qator faqat `includePaid` bilan keladi va faqat **dars soni kamayganda**
  qayta hisoblanadi (guruh erta yopildi, pauza); `force` (ko'chirishda maqsad guruh,
  pauza o'chirilganda) — shartsiz.
  - Dars qolmagan oy: pul ham, rad etilmagan **chek** ham bo'lmasa — **o'chiriladi**;
    aks holda qarz 0, to'langan pul `refundedAmount` ga.
  - Yangi qarz to'langandan kam bo'lsa farq **`refundedAmount` ga** (jimgina kesilmaydi).
- `recalcOpenPaymentRows` faqat **o'zgargan** qatorlarni yozadi; har birini
  `FOR UPDATE` bilan qulflab, o'qilgandan beri `amountPaid/refundedAmount`
  o'zgarmaganini tekshiradi (parallel tasdiqlangan chekni ustidan yozmaydi).
  O'qituvchi komissiyasi faqat pul o'zgargan (guruh, oy) juftliklari uchun, bir
  martadan va ketma-ket qayta hisoblanadi. Guruh taqvimi (jadval tarixi, pauza,
  bayram), chegirma tarixi va asosiy guruh bitta operatsiya davomida keshlanadi
  (`resetBillingCaches`). Oyligi berilgan oyning carryover'i `pg_advisory_xact_lock`
  ostida yoziladi (ikki marta yozilmaydi).
- Jadvalni o'tgan sanadan o'zgartirish (`scheduleEffectiveFrom`) shu oraliqda
  davomati bor dars yangi jadvalda yo'qolsa — 422.
- O'quvchi shu oyning o'zida qaytsa joriy oy (PAID ham) majburan qayta hisoblanadi.
- **Pul hech qachon izsiz yo'qolmaydi** (2026-09-27): qarzdan ortiq pul har doim
  `refundedAmount` (kassadan chiqadi/qaytariladi) yoki `transferredOutAmount`
  (boshqa guruhga o'tdi) ga yoziladi. Cheki bor qator o'chirilmaydi
  (`payment_receipts` FK `ON DELETE CASCADE` — chek ham o'chib ketardi).
- **Davomat to'lovni o'zgartirmaydi**: `recalcPaymentForAttendanceChange` faqat
  `lessonsExcused` (ma'lumot) ni yangilaydi. Ilgari u PAID qatorni ham bugungi
  narx/oyna bilan qayta hisoblab, soxta "qaytariladigan pul" yozardi.
- **Shaxsiy narx ham oyga bog'langan**: `student_base_discounts.monthlyFee`
  (doimiy chegirma bilan bitta tarix, bir xil qoida — pul olinmagan bo'lsa shu
  oydan, olingan bo'lsa keyingi oydan). `resolvePersonalFeeForMonth`; NULL —
  `students.monthlyFee`.
- **Summadagi chegirma fanga bog'lanmagan bo'lsa** (doimiy `discountAmount` yoki
  `groupId` siz davr) — o'quvchining umumiy to'lovidan **bir marta**: shu oydagi
  "asosiy" guruh (a'zolik oynasi eng erta boshlangani, teng bo'lsa kichik id)
  to'loviga yoziladi (`primaryGroupForMonth`); boshqa guruh qatorlarida 0.
  `discountAmountApplied` / summary `discountAmount` shuni ko'rsatadi. Foizli
  chegirma har guruhda qoladi.
- **Qarz qayta oshsa** (pauza bekor qilindi, sana uzaytirildi) shu qatordagi
  `refundedAmount` avval qarzni yopishga qaytadi (to'lov tizimi pulni
  qaytarganini kuzatmaydi — `refundedAmount` "o'quvchining haqi").
- Chegirma yig'indisi 100% dan oshsa xato **tashlanmaydi** — 100% qo'llanib log
  yoziladi (aks holda bitta o'quvchi oylik cron'ni to'xtatardi). Chegirma davri
  qo'shilganda/o'zgarganda/o'chirilganda o'quvchining ochiq to'lovlari darhol
  qayta hisoblanadi; pul (yoki `pending` chek) bor oyga tegadigan o'zgarish — eski
  oraliq ham, yangisi ham — bloklanadi.
- Oyna: oxirgi 3 oy (`maxMonthsBack`, `openPaymentsWindow`).
- Chaqiruv nuqtalari: guruh sanasi/jadvali o'zgarganda, o'quvchi tahrirlanganda,
  davomat o'zgarganda (`recalcPaymentForAttendanceChange` — bu **PAID** larga ham tegadi
  va kerak bo'lsa refund yozadi), `PUT /payments/calculate/:id`.

**Chek/receipt oqimi (`payment_receipts`):**
`pay-partial` / `mark-as-paid` → `PENDING` receipt → `receipts.confirm` bilan tasdiqlanadi
(`CONFIRMED`) yoki rad etiladi. Tasdiqlangandan keyingina `payment.amountPaid` oshadi.
- `invoiceNo` — markaz ichida ketma-ket, oyning birinchi chekida biriktiriladi;
  keyingi qisman to'lovlar `1 → 1-A → 1-A-B` ko'rinishida davom etadi.
- `transactionNo`, `balanceBefore/After`, `paymentMethod` (`CASH/CARD/BANK_TRANSFER/ONLINE`).
- Qabul qilgan xodim komissiyasi (`receiverCommission*Snapshot`) — manager/reception uchun,
  qabul paytida snapshot olinadi.
- Ortiqcha pul: `amountDue` pasaysa `amountPaid` kesiladi va farq `refundedAmount` ga yoziladi.

**Eksport:** `GET /payments/export` — ExcelJS, `Content-Disposition` orqali fayl nomi.

### 6.4 O'qituvchi daromadi va maoshlar

**Oy — ISH oyi** (migratsiya `…053-SalaryWorkMonth`, 2026-09 dan). `staff_salaries.forMonth`,
`teacher_monthly_earnings.forMonth` va o'quvchi to'lovining `payments.forMonth` — bitta oy:
iyun oyligi iyunda turadi, pul iyulda berilsa ham. Ilgari bu to'lov oyi edi (iyun ishi →
"Iyul" qatori) — chalg'itgani uchun o'zgartirildi.

- `teacher_monthly_earnings` (unique: teacher+forMonth):
  `totalEarning = baseSalarySnapshot + commissionAmount + carryOverCommission`.
  Komissiya — shu oy uchun o'quvchilardan **tushgan pul** (PAID + PARTIAL `amountPaid`) × foiz.
- **Har to'lovda qayta hisoblanadi** (`triggerTeacherEarningsRecalcForPayment`, fire-and-forget).
  Joriy oy o'quvchilar to'lagan sari o'sib boradi; kelajak oyga oldindan to'lov o'sha oy
  ochilganda hisoblanadi.
- **Oylik berilgan (PAID) oy muzlatiladi.** Keyin shu oy uchun o'quvchi pul olib kelsa,
  ulushi `teacher_commission_carryovers` ga yoziladi (`sourceForMonth` = o'quvchi to'lagan oy)
  va **keyingi to'lanmagan oyga** qo'shiladi (`appliedForMonth`, joriy oydan oshmaydi).
  Hisoblangan-bo'lgan summa = snapshot komissiyasi + shu oydan chiqqan carryover'lar,
  shuning uchun bitta pul ikki marta sanalmaydi. Qayta hisoblashda (`force`) allaqachon
  qo'llangan carryover'lar saqlanadi.
- Qisman to'langan / to'lanmagan oy — daromad bilan sinxronlanadi (`baseSalary = totalEarning`).
- **Oylik va komissiya foizi oyga bog'langan** (`user_pay_periods`, `UserPayService`,
  `UserPayModule`): `PUT /users/:id` da o'zgarsa **shu oydan** kuchga kiradi,
  oldingi oylar (keyin kech to'langan o'quvchi puli — carryover ham) eski foizda.
  Jadval bo'sh — `users.salary/commissionPercentage`; birinchi o'zgarishda eski
  qiymat oldingi oy uchun yoziladi.
- `staff-salaries` — xodim oylik maoshi va unga qilingan to'lovlar. Statik maoshli xodim
  (qabulxona) — tizimga qo'shilgan oyidan boshlab; menejer/qabulxona komissiyasi —
  shu oyda tasdiqlangan cheklardan.

### 6.5 O'quvchi (`students`)

Status o'tishlari qat'iy (`ALLOWED_STATUS_TRANSITIONS`):

```
new     → active, ignored
active  → stopped, finished
stopped → active, finished
ignored → new, active
finished→ active
```

- `stopped`/`ignored` ga o'tishda `returnLikelihood` **majburiy**; izoh mavjudiga qo'shiladi.
- `activatedAt` — **birinchi** faollashish (new/ignored → active) sanasi, o'tgan
  oylarning quyi chegarasi. **Qaytishda (stopped/finished → active) qayta
  yozilmaydi** — ilgari yozilardi va to'xtashdan oldingi oylar qarzi o'chib ketardi.
- To'xtatishda (`stopped`) o'quvchining **barcha a'zolik oynalari yopiladi**
  (`leftAt` = bugun), qaytishda har bir guruhda **yangi oyna** ochiladi — to'xtab
  turgan davr to'lovga kirmaydi. `stoppedAt` ham saqlanadi (joriy oy chegarasi).
- Guruhga qo'shilgan/chiqqan sana — `student_group_enrollments` (pastda 6.5.1).
  `students_groups_groups.joinedAt` faqat eski ma'lumot uchun zaxira.
- Chegirma davrlari: `POST/PUT/DELETE /students/:id/discount-periods`;
  to'langan oyga tegadigan o'zgarish bloklanadi.
- `students.monthlyFee` — shaxsiy narx (guruh narxidan ustun, darhol kuchga kiradi).
- Fan: `subjectId` + ixtiyoriy `secondSubjectId` (qabulda ikki fan, migratsiya `…065`).
  Faqat qabul uchun ma'lumot — to'lovga ta'sir qilmaydi; `subjectId` filtri ikkalasini ham tekshiradi.
- **Telefon o'quvchilarda unique emas** (migratsiya `…066`): bir oiladan bir nechta
  o'quvchi bitta raqam bilan yoziladi. `users.phone` faqat xodimlar orasida unique
  (`UQ_users_phone_staff`, `WHERE role <> 'student'`); kirish `login` orqali.
- Telefon bazada har xil yozilgan (`97-752-20-14`, `+998…`); yangi front `+998XXXXXXXXX`
  yuboradi. `search` (o'quvchi) va lead `phone` filtri raqamlarni raqamlar bilan solishtiradi.

### 6.5.1 A'zolik oynasi va boshqa guruhga ko'chirish (MUHIM)

Jadval `student_group_enrollments` — o'quvchining bitta guruhdagi **a'zolik
oynasi**. Junction (`students_groups_groups`) faqat "hozir qaysi guruhda"
degan savolga javob beradi va o'quvchi chiqarilganda o'chadi; bu jadval esa
tarixni saqlaydi va **to'lov proratsiyasining chegaralarini beradi**:

| Ustun | Ma'no |
|---|---|
| `joinedAt` | guruhga qo'shilgan sana, **inclusive** — o'sha kungi dars to'lovga kiradi |
| `leftAt` | guruhdan chiqqan sana, **exclusive** — o'sha kungi dars KIRMAYDI. `null` — hali a'zo |
| `transferredToGroupId` / `transferredFromGroupId` | ko'chirish zanjiri |

- Bir juftlik uchun bir nechta oyna bo'lishi mumkin (chiqib, qaytib kelgan);
  ochiq oyna (`leftAt IS NULL`) esa bittadan ortiq emas (partial unique index).
  Bir oyda ikkita oyna bo'lsa (A→B→A) to'lov darslari **oynalar birlashmasi**
  bo'yicha filtrlanadi (`resolveWindowsForMonth`) — oradagi uzilish uchun pul
  so'ralmaydi; ko'chirishda maqsad guruhning mavjud qatori majburan qayta hisoblanadi.
- `computeMonthBilling` har doim shu oynani o'qiydi (`resolveEnrollmentWindow`)
  va `joinedAt`/`leftAt` ni chegara qilib qo'yadi. Shu sabab **qayta hisoblash
  (`recalcOpenPaymentRows`) ketgan guruhning proratsiyasini bekor qilmaydi**.
  Oyna topilmasa junction'dagi eski `joinedAt` ga, u ham bo'lmasa
  `activatedAt`/`group.startDate` ga qaytiladi.
- Davomat ham shu chegarada: oynadan tashqaridagi darsga davomat yozilmaydi
  (400), lekin ketgan o'quvchi jurnalda tarix uchun **ko'rinib turadi**
  (`leftAt` bilan, faqat o'qish uchun).

**Ko'chirish** — `POST /students/transfer` (`students.transfer` ruxsati),
`StudentsService.transferStudents`. Uchta hayotiy holatni qoplaydi: guruh
yopilishi (`closeSourceGroup: true` — tugash sanasi ko'chirish kuniga tortiladi),
oy o'rtasida boshqa guruhga o'tish, kurs tugab keyingi bosqichga o'tish
(o'quvchi `finished` → `active`).

Pul qismi — `PaymentsService.settlePaymentsForTransfer`:

1. eski guruh `leftAt` gacha qayta hisoblanadi (**PAID** qatorlar ham);
2. yangi guruh uchun `joinedAt` dan prorate qilingan qator yaratiladi —
   oyna tufayli qo'shilishdan oldingi oylarga qarz **yozilmaydi**;
3. eski guruhga ortiqcha to'langan pul `payments.transferredOutAmount` ga
   yoziladi va yangi guruh to'loviga **tasdiqlangan chek** bilan o'tkaziladi
   (`payment_receipts.transferFromPaymentId`, `paymentMethod` bo'sh, qabul
   qiluvchi komissiyasi yo'q — kassaga yangi pul tushmagan);
4. yangi guruhda yopadigan qarz qolmasa — qoldiq `refundedAmount` ga o'tadi
   (naqd qaytariladi). `refundedAmount` = pul kassadan chiqdi,
   `transferredOutAmount` = pul markazda qoldi; ikkalasi aralashtirilmaydi;
5. **eski guruhdagi qarz o'sha guruhda qoladi** — ko'chirish bloklanmaydi.

Natijada ko'chirilgan oy uchun `A + B = bitta oylik narx`. O'qituvchi
komissiyasi to'lov qatorining guruhiga bog'langani uchun avtomatik bo'linadi:
eski o'qituvchi o'tgan darslar uchun foizini saqlaydi.

Orqaga sanalangan ko'chirishda `ensurePayments` oynasi ko'chirish oyidan
bugungacha kengaytiriladi (aks holda o'rtadagi oylar uchun qator yaratilmasdi).

### 6.5.2 Xodimni bloklash (`users.isActive`)

- Ishdan ketgan xodim **o'chirilmaydi, bloklanadi**: login rad etiladi, amaldagi
  token `JwtStrategy` da `UsersService.isActiveCached` (15 s kesh) orqali o'ladi.
- `DELETE /users/:id`: admin akkaunti o'chirilmaydi (ilgari boshqa admin o'chirilsa
  **butun tashkilot** CASCADE bilan o'chardi); oylik/komissiya/chek/guruh tarixi
  bor xodim — 400 ("bloklang"). CASCADE bu tarixni yo'qotardi.
- `GET /users/:id` endi tashkilot bilan chegaralangan.

### 6.6 Lead va referral

- `leads` — potentsial mijoz; `transferToStudent` uni o'quvchiga aylantiradi.
- `referrals` — taklif qilgan o'quvchiga 10% chegirma, 1 oy
  (`REFERRAL_DISCOUNT_PERCENT`, `REFERRAL_DISCOUNT_MONTHS`), chegirma davri sifatida yoziladi.

### 6.7 Davomat va dars sanalari

- Dars sanalari jadval + `[startDate..endDate]` dan hisoblanadi
  (`attendance/utils/lesson-dates.ts` → `computeLessonDates`).
- `AttendanceLessonOverride` — darsni bekor qilish yoki boshqa kunga ko'chirish.
  Jadval o'zgarganda kelajakdagi override'lar tozalanadi.
- Davomat statuslari: `present`, `absent`, `late`, `excused` (sababli — izoh majburiy).
- Davomat to'lov summasini o'zgartirmaydi (faqat `lessonsExcused` ma'lumoti).
- **Kelmaganlar ro'yxati** (qabulxona): `GET /attendance/absences`
  (`attendance.view`, `centerId` qabul qiladi) — barcha guruhlar bo'yicha `absent` /
  `excused` qatorlari, filtrlar (sana, guruh, o'qituvchi, tur, qo'ng'iroq
  qilingan/qilinmagan, ism/telefon), `absencesInRange`, `summary`.
  `PUT /attendance/absences/:id/follow-up` (`attendance.manage`) — qo'ng'iroq natijasi
  (`attendance.followUpNote/followedUpAt/followedUpById`). `AttendanceAbsencesService`.
  O'qituvchi faqat o'z guruhlarini ko'radi.

### 6.8 Xodim davomati (`staff-attendance`)

Jadval `staff_attendances`, kuniga bitta qator: `(userId, workDate)` unique.
Hozircha faqat **o'qituvchilar** yoqilgan, lekin model umumiy — keyin boshqa
xodimlarga kengaytiriladi (ular uchun smena jadvali kerak bo'ladi).

**Asosiy tamoyil: hech narsa bloklanmaydi.** "Keldim" tugmasini yo'lda ham bosish
mumkin — shuning uchun tugmani ishonchli qilishga urinmaymiz, balki har yozuv
bilan **dalil** yig'amiz va uni `confidence` bilan belgilaymiz. Egaga qat'iy
to'siq emas, "shubhali yozuvlar" ro'yxati kerak.

| Signal | Kuchi | Izoh |
|---|---|---|
| `ipMatched` — markaz Wi-Fi'sining public IP'si (`centers.publicIp`) | kuchli | Bu tarmoqqa faqat bino ichidan ulanib bo'ladi |
| `geoMatched` — `centers.latitude/longitude` dan `checkInRadiusMeters` ichida | o'rta | Fake GPS bilan aldash mumkin |
| `confirmedAt` — qabulxona/admin tasdiqlagan | kuchli | Har doim `high` ga ko'taradi |

- `confidence`: ikkala langar mos → `high`; bittasi mos, ikkinchisi mos emas →
  `medium`; mos kelgani yo'q → `low`. Markaz umuman sozlanmagan bo'lsa `medium`
  (aybi xodimda emas) + `center_not_configured` bayrog'i.
- `shared_device` bayrog'i (bitta `deviceId` dan 60 kun ichida boshqa xodim ham
  kirgan) `high` ni `medium` ga tushiradi — bu eng real firibgarlik ssenariysi.
- **Kechikish:** `lateMinutes = checkInAt − o'sha kundagi birinchi dars vaqti`.
  Dars kunlari `computeLessonDates` + `AttendanceLessonOverride` (ko'chirilgan
  darslar) dan chiqadi; erta kelgan bo'lsa 0. Darsi yo'q kunda 0 va
  `no_lesson_today` bayrog'i.
- **Hisobot** (`GET /staff-attendance/report`): `expectedDays` (darsi bor kunlar),
  `attendedDays`, `missedDays`, `lateDays`, `totalLateMinutes`, `flaggedDays`.
  Kelajakdagi darslar "kelmagan" deb sanalmaydi — davr bugun bilan cheklanadi.
- `source`: `self` (o'zi bosgan) / `reception` / `manual` (admin qo'lda kiritgan —
  yashirilmaydi, hisobotda shunday ko'rinadi).
- Oylikdan ushlab qolish **hozircha yo'q** — bu keyingi task (jarimalar sahifasi
  + maosh berishda ushlab qolish maydoni).

**IP aniqlash:** `src/shared/utils/request-ip.ts` → `getClientIp(req)`.
Reverse proxy (nginx) ortida `x-forwarded-for` ni o'qish uchun **`TRUST_PROXY=true`**
env kerak; aks holda header mijoz tomonidan soxtalashtirilishi mumkin va shuning
uchun ataylab o'qilmaydi. `POST /centers/:id/capture-ip` ichki tarmoq IP'sini
saqlashni rad etadi.

**Brauzer talabi:** geolokatsiya faqat HTTPS'da (yoki `localhost` da) ishlaydi.

### 6.9 Xodim sahifasi va oylikdan ushlab qolish (`staff-salaries`)

**Xodim sahifasi** — `GET /staff/:userId/overview?forMonth=YYYY-MM`
(o'ziniki uchun `GET /staff/me/overview`). Bitta javobda: xodim ma'lumoti,
oyma-oy davomat (12 oy), shu oydagi kechikishlar, topshirilmagan pullar,
jarimalar va oylik holati. Boshqa xodimni ko'rish uchun `staffPerformance.view`
kerak; o'zini har kim ko'radi (`StaffOverviewService.assertCanView`).

**"Topshirilmagan pul"** — `payment_receipts` dagi `receivedById = xodim` va
`status IN (pending, rejected)` qatorlar. Rollar dinamik bo'lgani uchun
"kassir" degan rol yo'q: pulni **kim qabul qilgan bo'lsa** (o'qituvchi ham
bo'lishi mumkin), admin tasdiqlamaguncha pul o'shaning bo'ynida.
Davr bo'yicha cheklanmaydi — qarz yopilmaguncha ko'rinib turadi.

**Jarimalar** (`staff_deductions` + `staff_salary_deductions`):

| Jadval | Ma'no |
|---|---|
| `staff_deductions` | jarimaning o'zi: `amount`, `appliedAmount`, `reason` (majburiy), `sourceForMonth` |
| `staff_salary_deductions` | qaysi oy oyligidan qanchasi ushlangani (unique: salary+deduction) |
| `staff_salaries.deductionAmount` | shu oyda ushlangan yig'indi (denormalizatsiya) |

- **Tizim o'zi jarima solmaydi** — summani har doim admin yozadi. Kechikish va
  topshirilmagan pul faqat **asos** sifatida ko'rsatiladi.
- `netSalary = baseSalary − deductionAmount`; status `netSalary` ga qarab
  qo'yiladi (`applyStatus`). Jarima oylikni to'liq yeb qo'ysa (`netSalary = 0`)
  — beriladigan narsa qolmadi, status `paid`.
- **Jarima oylikdan katta bo'lishi mumkin:** o'sha oyda faqat sig'gani
  ushlanadi, qolgani ochiq qoladi va keyingi oyliklardan avtomatik ushlanadi
  (`applyOutstanding`, eski jarimadan boshlab FIFO).
- `applyOutstanding` **idempotent**: sig'im `baseSalary − applied − paid`, ya'ni
  allaqachon berilgan pul qaytarib olinmaydi. `findAll` har o'qishda chaqiradi.
- Jarimani o'chirish — ruxsat etilgan (xodim foydasiga), lekin oylik holati
  qayta hisoblanadi: `paid` oylikdan pastga tushsa status `unpaid/partial` ga qaytadi.
- `PUT /staff-salaries/pay/:id` ga `deduction: { amount, reason, type }` berish
  mumkin — avval jarima yoziladi, keyin qolgan summadan to'lov o'tadi.
  `amount: 0` yuborilsa faqat jarima yoziladi (to'lov tarixiga qator qo'shilmaydi).
- Ruxsatlar: `staffPerformance.view` (ko'rish), `payroll.deduct` (jarima yozish/o'chirish).

### 6.10 Ota-onalar uchun Telegram bot (`telegram`)

**Har bir tashkilotning o'z boti** (loyiha SaaS — markaz ota-onaga o'z nomi
bilan yozadi). Token env'da emas, `telegram_bot_settings.botToken` da:
markaz @BotFather'dan bot ochib, tokenini kabinetga kiritadi.

| Jadval | Ma'no |
|---|---|
| `telegram_link_tokens` | o'quvchining QR kalitiga mos tasodifiy token (har o'quvchiga bitta) |
| `telegram_parent_links` | chat ↔ o'quvchi ulanishi (+ `organizationId` nusxasi) |
| `telegram_bot_settings` | tashkilotning boti (token, username) va xabar kalitlari |

- **Token kiritiladi, username emas.** `PUT /telegram/bot-token` avval
  `getMe()` bilan tokenni tekshiradi va `botUsername` ni o'sha javobdan yozadi.
  Muvaffaqiyatli bo'lsa bot **darhol** ishga tushadi (`TelegramBotService
  .applyToken`), qayta deploy kerak emas. Token frontga hech qachon
  qaytarilmaydi — faqat `botConfigured` va niqob (`botTokenMasked`).
- Bitta token ikki tashkilotda bo'lolmaydi: partial unique index +
  servisda oldindan tekshiruv (aks holda Telegram 409 beradi va ikkala
  markazning ham boti tutilib qoladi).
- **QR ichida `studentId` YO'Q** — tasodifiy token turadi, aks holda begona
  odam `?start=123` yozib istalgan o'quvchiga ulanardi. Havola:
  `https://t.me/<bot>?start=<token>`. QR rasmi backendda (`qrcode`) PNG data
  URL bo'lib yasaladi, front faqat ko'rsatadi.
- **Tashkilot chegarasi:** `/start` da o'quvchining `center.organizationId`
  botning tashkiloti bilan solishtiriladi — A markazning QR kodi B markazning
  botiga ulanmaydi (foydalanuvchiga shunchaki "yaroqsiz QR" deyiladi).
  `/status` va `/stop` ham faqat shu tashkilot ichida ishlaydi.
- Ulanish uzilganda qator **o'chmaydi**: `isActive = false` (+ `blockedAt`
  botni bloklaganlar uchun). QR yangilansa (`.../regenerate`) eski QR o'ladi,
  lekin allaqachon ulanganlar uzilmaydi.
- **Xabar kalitlari** (default): `notifyPaymentReceived` ✅, qolgani ❌ —
  `notifyPaymentConfirmed`, `notifyAbsence`, `notifyDebt` (+ `debtReminderDay`,
  default 10). `isEnabled` — umumiy kalit.
- Chaqiruv nuqtalari: `submitReceipt` → `received`, `confirmReceipt` →
  `confirmed`, `rejectReceipt` → `rejected` (tuzatish xabari, faqat
  `notifyPaymentReceived` yoqilgan bo'lsa); `submitAttendance` → `absent/late`
  **status o'zgargan** o'quvchilar uchun; kunlik cron (09:00 Toshkent) → qarz.
- **Hech qachon xato tashlamaydi.** `TelegramNotifierService` ning barcha
  metodlari try/catch ichida, chaqiruvchilar `void ...catch(() => undefined)`
  bilan chaqiradi: bot yiqilsa ham to'lov/davomat oqimi to'xtamaydi.
- Modul **hech kimga bog'lanmaydi**, faqat repozitoriylarni o'qiydi —
  shuning uchun `PaymentsModule`/`AttendanceModule` uni `forwardRef`siz
  import qiladi.
- Bot buyruqlari: `/start <token>`, `/status` (ulangan o'quvchilar + qarz),
  `/stop`, `/help`. Til Telegram profilidan (`language_code`): `ru` → ruscha,
  qolganda o'zbekcha (`telegram.messages.ts`).
- Polling rejimi, har tashkilotga bitta instance. ⚠️ Bitta tokenli **ikkita
  server** (lokal + prod) bir vaqtda ishlasa Telegram 409 beradi — log'da
  `polling_error` bo'lib ko'rinadi, ilova yiqilmaydi.
- Ruxsat: QR ko'rish — `students.view`, QR yangilash/uzish — `students.update`,
  bot va sozlamalar — `telegram.settings`.

### 6.11 Tashkilot brendi (`organizations`)

Domen bitta (`talimplus`), lekin kabinet har bir markazning o'z nomi va
logotipini ko'rsatadi: `organizations.name` + `logoUrl` + `faviconUrl`.

- `GET /organizations/branding` — **ruxsatsiz** (har bir tizimga kirgan xodimga
  kerak: sidebar logosi va tab sarlavhasi shundan). `:id` qoidasidan **oldin**
  e'lon qilingan, aks holda `branding` id deb o'qilardi.
- `PUT /organizations/branding` — `organization.settings`.
- Rasm `data:image/...;base64,...` yoki `https://...` bo'lishi mumkin. Loyihada
  fayl yuklash infratuzilmasi (disk/S3/statik serving) **yo'q**, shuning uchun
  logo va favicon data URL bo'lib `text` ustunda saqlanadi — kichkina va kamdan
  kam o'zgaradi. Keyinchalik fayl saqlash qo'shilsa, shu ustunlarga havola
  yozish kifoya, o'qiydigan kod ikkalasini ham qabul qiladi.
- Cheklovlar: logo ≤ ~300 KB, favicon ≤ ~100 KB (DTO'da `MaxLength` bilan);
  bo'sh satr yuborilsa rasm olib tashlanadi.

## 7. Migratsiyalar

- Konfiguratsiya: `db/data-source.ts` (`synchronize: false` — **har doim migratsiya yoziladi**).
- Fayl: `db/migrations/<timestamp>-<Name>.ts`, timestamp ketma-ket (`1760000000043-...`).
- Uslub: xom SQL + `IF NOT EXISTS` / `DROP CONSTRAINT IF EXISTS` (idempotent), `down()` bor.
- Ma'lumot ko'chirish (backfill) ham shu yerda — mavjud yozuvlar yangi jadvalga moslanadi.
- Entity'lar `dist/**/*.entity.js` orqali avtomatik topiladi — `app.module` ga qo'shish shart emas,
  lekin `TypeOrmModule.forFeature([...])` kerakli modulda yoziladi.

## 8. Konvensiyalar

- Izohlar **o'zbekcha** (biznes qoidalari uchun), kod inglizcha.
- Sana: har doim `@/shared/utils/dayjs` dan `dayjs` (utc + timezone plagin ulangan).
  **Avval parse, keyin `.tz()`** — teskarisi dayjs'da noto'g'ri natija beradi.
  `date` ustunlariga **string** (`YYYY-MM-DD`) yoziladi — timezone siljishining oldini oladi.
- Postgres `numeric` → JS'ga **string** bo'lib keladi: doim `Number(x ?? 0)`.
- Oy kaliti har joyda `YYYY-MM-01`; SQL'da `TO_CHAR(col,'YYYY-MM-01')` bilan solishtiriladi
  (pg drayveri `date` ni JS `Date` qilib qaytaradi — to'g'ridan-to'g'ri string bilan solishtirmang).
- Yangi endpoint → Swagger dekoratorlari (`@ApiOperation`, `@ApiResponse`, `@ApiQuery`) majburiy.
- Modullararo halqa (`groups ↔ payments`) `forwardRef` bilan; uchinchi joyga kerak bo'lgan
  servis alohida kichik modulga chiqariladi (namuna: `group-fee.module.ts`).
- O'zgarishdan keyin: `npm run build` (yoki `npm run lint`).

## 9. Ma'lum muammolar (tegmasangiz ham bilib turing)

- **Ochiq biznes savollari (2026-09-27 auditidan):** doimiy chegirma **summada**
  masalalari 2026-09-27 da hal qilindi (yuqorida). Proratsiya tiyinli summalar
  beradi (`round2`).
- **Ssenariy testlari** (jest ishlamagani uchun) nusxa bazada API orqali yuritilgan:
  74 holat (bayram, foiz tarixi, summadagi chegirma, qo'shimcha guruh, ko'chirish, A→B→A, jadval 3→5, to'xtatish/qaytish,
  kutilayotgan chek, parallel tasdiqlash, o'qituvchi almashuvi, pauza, shaxsiy narx,
  chegirma). Kod o'zgarsa shu holatlarni qayta tekshiring.

- **Testlar ishlamaydi:** `jest` konfiguratsiyasida `@/` uchun `moduleNameMapper` yo'q —
  26 ta suite'dan 25 tasi "Cannot find module '@/...'" bilan yiqiladi. Tuzatish uchun
  `package.json` dagi jest bo'limiga `moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' }` kerak.
- **Lint'da 9 ta eski xato** bor (ishlatilmagan o'zgaruvchilar, `dayjs.ts` dagi `require`).
  Yangi kod ular sonini oshirmasligi kerak.
- `attendance.controller.spec.ts` mavjud bo'lmagan faylni import qiladi.
- `lessons`, `student-history` modullari bo'sh.
- `FEATURES-NOW.md`, `FEATURES-LATER.md`, `BUGFIX-TRACKER.md` — reja/tracker fayllari,
  yangi ish qilinganda belgilab qo'yiladi.
