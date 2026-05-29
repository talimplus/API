# BUGFIX TRACKER - Learning Center SaaS

Ushbu fayl loyihadagi barcha aniqlangan xatolarni kuzatish uchun ishlatiladi.
Har bir xato tuzatilgandan keyin `[x]` bilan belgilanadi.

---

## BOSQICH 1: XAVFSIZLIK (Security & Multi-tenancy)

### 1.1 IDOR — Students modulida organizationId tekshiruvi yo'q
- **Fayl:** `src/modules/students/students.service.ts` — `findById()`, `changeStatus()`
- **Muammo:** `findById` faqat `id` bo'yicha qidiradi, `organizationId` tekshirmaydi. Boshqa tashkilot talabalarini o'qish/o'zgartirish mumkin.
- **Tuzatish:** `findById` va `changeStatus` ga `organizationId` parametrini qo'shish, query ga `WHERE organizationId = :orgId` qo'shish. Controller da `req.user.organizationId` ni uzatish.
- [x] Tuzatildi

### 1.2 IDOR — findByActiveStatus() barcha tashkilotlarni qaytaradi
- **Fayl:** `src/modules/students/students.service.ts` — `findByActiveStatus()`
- **Muammo:** `organizationId` filtersiz barcha aktiv talabalarni qaytaradi.
- **Tuzatish:** `organizationId` parametri qo'shish, WHERE shartiga qo'shish.
- [x] Tuzatildi

### 1.3 IDOR — Group IDs tashkilotga tekshirilmaydi
- **Fayl:** `src/modules/students/students.service.ts` — `create()`, `update()`
- **Fayl:** `src/modules/leads/leads.service.ts` — `create()`, `transferToStudent()`
- **Muammo:** Student/Lead yaratishda groupIds tashkilot/markazga tegishli ekanligini tekshirmaydi. Boshqa tashkilot guruhiga student qo'shish mumkin.
- **Tuzatish:** Group larni yuklashda `centerId` yoki `organizationId` filtri qo'shish.
- [x] Tuzatildi (students)
- [x] Tuzatildi (leads)

### 1.4 IDOR — Referrer tashkilotga tekshirilmaydi
- **Fayl:** `src/modules/students/students.service.ts` — `create()` (799-806-qator)
- **Muammo:** `referrerId` bilan student yaratishda referrer bir xil tashkilotga tegishli ekanligini tekshirmaydi.
- **Tuzatish:** `findOneBy({ id: dto.referrerId, organizationId })` qilish.
- [x] Tuzatildi

### 1.5 @Roles() dekoratorlari yo'q — StudentsController
- **Fayl:** `src/modules/students/students.controller.ts`
- **Muammo:** Asosiy CRUD endpointlarda `@Roles()` yo'q. STUDENT roli ham create/update/delete qila oladi.
- **Tuzatish:** Har bir endpointga tegishli `@Roles()` dekoratorini qo'shish.
- [x] Tuzatildi

### 1.6 @Roles() dekoratorlari yo'q — GroupsController
- **Fayl:** `src/modules/groups/groups.controller.ts`
- **Muammo:** `create`, `update`, `findAll`, `remove` da `@Roles()` commented out.
- **Tuzatish:** Comment ni olib tashlash, tegishli rollarni belgilash.
- [x] Tuzatildi

### 1.7 tempPassword API response da ochiq qaytariladi
- **Fayl:** `src/modules/students/students.service.ts` — `findById()`
- **Muammo:** `tempPassword` har doim response da qaytariladi. IDOR bilan birgalikda boshqa tashkilot parollarini ko'rish mumkin.
- **Tuzatish:** `tempPassword` ni faqat student yaratish paytida qaytarish, `findById` dan olib tashlash.
- [x] Tuzatildi

### 1.8 Object.assign orqali status bypass
- **Fayl:** `src/modules/students/students.service.ts` — `update()` (924-qator)
- **Muammo:** `Object.assign(student, dto)` — agar update body da `status` yuborilsa, `changeStatus` logikasini chetlab o'tadi (to'lov yaratilmaydi, sana yozilmaydi).
- **Tuzatish:** `dto` dan `status`, `activatedAt`, `stoppedAt`, `groupIds` larni `delete` qilish yoki whitelist approach ishlatish.
- [x] Tuzatildi

### 1.9 GroupScheduleService — authorization tekshiruvi yo'q
- **Fayl:** `src/modules/group_schedule/group_schedule.service.ts`
- **Muammo:** Hech bir metod da org/center tekshiruvi yo'q. Istalgan foydalanuvchi istalgan guruh jadvalini o'zgartira oladi.
- **Tuzatish:** Barcha metodlarga organizationId/centerId tekshiruvini qo'shish.
- [x] Tuzatildi

### 1.10 JWT_SECRET undefined bo'lishi mumkin
- **Fayl:** `src/modules/auth/jwt.strategy.ts` (14-qator)
- **Muammo:** `process.env.JWT_SECRET` undefined bo'lsa, autentifikatsiya noaniq ishlaydi.
- **Tuzatish:** Startup da `.env` validatsiyasi qo'shish (masalan, `ConfigModule` `isGlobal` + `validationSchema`).
- [x] Tuzatildi

### 1.11 Parol deterministik va oldindan aytish mumkin
- **Fayl:** `src/modules/students/students.service.ts` — `create()`
- **Muammo:** Parol = `firstnamelastnamebirthdate`. Ism va tug'ilgan kunni bilgan har kim parolni topadi.
- **Tuzatish:** Random qism qo'shish yoki `crypto.randomBytes` ishlatish.
- [x] Tuzatildi

---

## BOSQICH 2: ROUTE VA CONTROLLER XATOLARI

### 2.1 Route conflict — PUT change-status/:id ishlamaydi
- **Fayl:** `src/modules/students/students.controller.ts` (169, 180-qatorlar)
- **Muammo:** `PUT :id` `PUT change-status/:id` dan oldin aniqlangan. NestJS `change-status` ni `:id` sifatida o'qiydi, `ParseIntPipe` xato beradi.
- **Tuzatish:** `change-status/:id` ni `PUT :id` dan OLDIN qo'yish.
- [x] Tuzatildi

### 2.2 Route conflict — Leads controller da ham xuddi shunday
- **Fayl:** `src/modules/leads/leads.controller.ts`
- **Muammo:** `PUT :id` va `PUT change-status/:id` tartibi tekshirilishi kerak.
- **Tuzatish:** `change-status/:id` ni birinchi qo'yish.
- [x] Tuzatildi

### 2.3 Lead center scoping yo'q — update/changeStatus/remove
- **Fayl:** `src/modules/leads/leads.service.ts` — `update()`, `changeStatus()`, `remove()`
- **Muammo:** Faqat `organizationId` tekshiriladi, `centerId` emas. Manager A markaz B lidlarini o'zgartira oladi.
- **Tuzatish:** Non-admin foydalanuvchilar uchun `centerId` filtrini qo'shish.
- [x] Tuzatildi

### 2.4 JWT centerId optional — TypeScript da required
- **Fayl:** `src/modules/auth/auth.service.ts` (68-77), `src/common/types/current.user.ts`
- **Muammo:** Center yo'q admin uchun JWT da `centerId` yo'q, lekin `CurrentUser` interface da `centerId: number` (required). Runtime da `undefined` bo'ladi.
- **Tuzatish:** `CurrentUser` da `centerId?: number` qilish, yoki login da default center belgilash.
- [x] Tuzatildi

---

## BOSQICH 3: HISOB-KITOB XATOLARI (Teacher Earnings & Payments)

### 3.1 KRITIK — totalEarning ga carryOverCommission qo'shilmaydi
- **Fayl:** `src/modules/teacher-earnings/teacher-earnings.service.ts` (220-qator)
- **Muammo:** `totalEarning = baseSalary + commissionAmount`. `carryOverCommission` tushib qolgan. Entity va DTO da "baseSalary + commission + carryover" deb yozilgan.
- **Tuzatish:** `totalEarning = baseSalary + commissionAmount + carryOverCommission`
- [x] Tuzatildi

### 3.2 KRITIK — applyCarryoverToNextUnpaidEarningMonth dead code
- **Fayl:** `src/modules/teacher-earnings/teacher-earnings.service.ts` (36-63-qator)
- **Muammo:** Bu metod hech qayerda chaqirilmaydi. Carryover keyingi oyga o'tkazilmaydi.
- **Tuzatish:** Carryover yaratilgandan keyin (184-qator) bu metodni chaqirish.
- [x] Tuzatildi

### 3.3 KRITIK — Carryover to'langan oyga yoziladi
- **Fayl:** `src/modules/teacher-earnings/teacher-earnings.service.ts` (175-184-qator)
- **Muammo:** `appliedForMonth: payMonth` — allaqachon to'langan oy. Pul yo'qoladi.
- **Tuzatish:** `appliedForMonth: null` qilib saqlash, yoki keyingi to'lanmagan oyni topib belgilash.
- [x] Tuzatildi

### 3.4 Receipt overpayment tekshiruvi yo'q
- **Fayl:** `src/modules/payments/payments.service.ts` — `submitReceipt()` (124-179-qator)
- **Muammo:** 100,000 qarz bo'lsa, 1,000,000 receipt yaratsa bo'ladi. Ortiqcha pul `Math.min` bilan kesiladi va yo'qoladi.
- **Tuzatish:** `submitReceipt` da `amount <= (amountDue - amountPaid - pendingReceiptsSum)` tekshiruvini qo'shish.
- [x] Tuzatildi

### 3.5 Race condition — applyConfirmedMoneyToPayment
- **Fayl:** `src/modules/payments/payments.service.ts` (78-122-qator)
- **Muammo:** Ikki admin bir vaqtda confirm qilsa, oxirgi yozuv yutadi. Lock yo'q.
- **Tuzatish:** Transaction + `SELECT ... FOR UPDATE` lock ishlatish.
- [x] Tuzatildi

### 3.6 pay() — to'langan maoshga yana to'lov qabul qiladi
- **Fayl:** `src/modules/staff-salaries/staff-salaries.service.ts` — `pay()`
- **Muammo:** `PAID` statusdagi maoshga yana payment qo'shish mumkin. Payment history `baseSalary` dan oshib ketadi.
- **Tuzatish:** `if (salary.status === StaffSalaryStatus.PAID) throw BadRequestException` qo'shish.
- [x] Tuzatildi

### 3.7 Statistics — netCashflow refundedAmount ni hisobga olmaydi
- **Fayl:** `src/modules/statistics/statistics.service.ts` (191-qator)
- **Muammo:** `netCashflow = amountPaid - expenses - payroll`. `refundedAmount` tushib qolgan — daromad shishirilgan ko'rinadi.
- **Tuzatish:** Query ga `SUM(refundedAmount)` qo'shish, formuladan ayirish.
- [x] Tuzatildi

### 3.8 stoppedAt student qayta faollashtirilganda tozalanmaydi
- **Fayl:** `src/modules/students/students.service.ts` — `changeStatus()` (993-1008-qator)
- **Muammo:** STOPPED -> ACTIVE o'tishda `stoppedAt` eski qiymati qoladi. To'lov proration noto'g'ri hisoblanadi.
- **Tuzatish:** ACTIVE ga o'tishda `student.stoppedAt = null` qo'shish.
- [x] Tuzatildi

---

## BOSQICH 4: GURUHLAR VA DAVOMAT

### 4.1 findOne da global UPDATE ishlaydi
- **Fayl:** `src/modules/groups/groups.service.ts` (367-379-qator)
- **Muammo:** Har bir `GET /groups/:id` da `UPDATE groups SET status='finished' WHERE ...` org filtersiz ishga tushadi. Barcha tashkilotlarga ta'sir qiladi.
- **Tuzatish:** Bu logikani faqat cron/lifecycle service ga ko'chirish, yoki `organizationId` filtri qo'shish.
- [x] Tuzatildi

### 4.2 formatDateOnly timezone hisobga olmaydi
- **Fayl:** `src/modules/attendance/attendance.service.ts` (73-75-qator)
- **Muammo:** `dayjs(input).format('YYYY-MM-DD')` — server UTC-5 da bo'lsa, DB dagi `2026-01-15` -> `2026-01-14` ga aylanadi.
- **Tuzatish:** `dayjs.utc(input).format('YYYY-MM-DD')` ishlatish.
- [x] Tuzatildi

### 4.3 findOverrideForDate — non-deterministic natija
- **Fayl:** `src/modules/attendance/attendance.service.ts` (77-84-qator)
- **Muammo:** `findOne` + OR sharti. Qaysi override topilishi noaniq — `fromDate` yoki `toDate` bir xil sana bo'lsa.
- **Tuzatish:** `find` (array) ishlatish yoki alohida querylar yozish.
- [x] Tuzatildi

### 4.4 Guruh statusi tekshirilmaydi — davomat va reschedule
- **Fayl:** `src/modules/attendance/attendance.service.ts` — `submitAttendance()`, `rescheduleLesson()`
- **Muammo:** `NEW` yoki `FINISHED` guruhlarga davomat yozish va dars ko'chirish mumkin.
- **Tuzatish:** Guruh statusini tekshirish: faqat `STARTED` guruhlar uchun ruxsat berish.
- [x] Tuzatildi

### 4.5 Jadval o'zgarishida mavjud davomat tekshirilmaydi
- **Fayl:** `src/modules/groups/groups.service.ts` (186-197-qator)
- **Muammo:** Jadval o'zgartirilganda eski davomat yozuvlari orphan bo'lib qoladi (yangi jadvalga mos kelmaydi).
- **Tuzatish:** Jadval o'zgarishida ogohlantirish berish yoki eski davomatni tekshirish.
- [x] Tuzatildi

### 4.6 Reschedule faqat bugungi dars uchun ishlaydi
- **Fayl:** `src/modules/attendance/attendance.service.ts` (438-439-qator)
- **Muammo:** `fromDate = today` hardcoded. Kelajakdagi darsni ko'chirib bo'lmaydi.
- **Tuzatish:** DTO ga `fromDate` parametrini qo'shish.
- [x] Tuzatildi

### 4.7 group_schedule create — eski jadvallarni o'chirmaydi
- **Fayl:** `src/modules/group_schedule/group_schedule.service.ts` (18-31-qator)
- **Muammo:** `create` metodi eski schedulelarni o'chirmaydi, duplicate qo'shadi.
- **Tuzatish:** Create da avval mavjud schedulelarni o'chirish yoki xatolik berish.
- [x] Tuzatildi

---

## BOSQICH 5: QOLGAN MUHIM XATOLAR

### 5.1 ensureSalariesForMonth — barcha org xodimlarini yuklaydi
- **Fayl:** `src/modules/staff-salaries/staff-salaries.service.ts` (64-72-qator)
- **Muammo:** `find` da `organizationId` filtri yo'q. Barcha org xodimlarini yuklaydi, xotirada filtrlaydi.
- **Tuzatish:** WHERE shartiga `organization: { id: organizationId }` qo'shish.
- [x] Tuzatildi

### 5.2 findAll (payments/salaries) har safar recalculate qiladi
- **Fayl:** `src/modules/payments/payments.service.ts` — `findAll()` (1266-1275-qator)
- **Fayl:** `src/modules/staff-salaries/staff-salaries.service.ts` — `findAll()` (232-243-qator)
- **Muammo:** Har bir GET request da barcha to'lovlar/maoshlar qayta hisoblanadi. Sekin va DoS xavfi.
- **Tuzatish:** Event-driven yoki alohida endpoint qilish, GET da faqat o'qish.
- [x] Tuzatildi (payments)
- [x] Tuzatildi (salaries)

### 5.3 Lead update orqali CONVERTED status qo'yish mumkin
- **Fayl:** `src/modules/leads/leads.service.ts` (288-qator)
- **Muammo:** `dto.status = 'converted'` yuborsa, student yaratmasdan lid CONVERTED bo'ladi.
- **Tuzatish:** `update` da `CONVERTED` statusga o'tishni taqiqlash.
- [x] Tuzatildi

### 5.4 TransferLeadToStudentDto dead code
- **Fayl:** `src/modules/leads/leads.controller.ts` (124-qator)
- **Muammo:** Transfer endpoint `CreateStudentDto` ishlatadi, `TransferLeadToStudentDto` ishlatilmaydi. Required fieldlar tekshirilmaydi.
- **Tuzatish:** Controller da `TransferLeadToStudentDto` ishlatish yoki uni o'chirish.
- [x] Tuzatildi

### 5.5 Statistics — invalid month qabul qilinadi
- **Fayl:** `src/modules/statistics/statistics.service.ts`, `dto/dashboard-query.dto.ts`
- **Muammo:** `fromMonth=2026-13` ni dayjs `2027-01` ga aylantiradi, xato bermaydi.
- **Tuzatish:** Custom validator: oy 01-12 orasida ekanligini tekshirish.
- [x] Tuzatildi

### 5.6 Stopped student to'lov moslashtirishi faqat joriy oy
- **Fayl:** `src/modules/payments/payments.service.ts` — `adjustPaymentsForStudentStopped()` (639-650-qator)
- **Muammo:** Faqat `dayjs().startOf('month')` — kelajak oylar (agar yaratilgan bo'lsa) tushib qoladi.
- **Tuzatish:** Joriy va kelajak barcha UNPAID to'lovlarni moslashtirish.
- [x] Tuzatildi

### 5.7 Receipt reject endpoint yo'q
- **Fayl:** `src/modules/payments/payments.service.ts`, `payments.controller.ts`
- **Muammo:** `REJECTED` status mavjud, lekin reject qilish uchun API yo'q.
- **Tuzatish:** `rejectReceipt` endpoint va service metodi qo'shish.
- [x] Tuzatildi

### 5.8 Discount toMonth — entity "inclusive" deydi, kod "exclusive" ishlaydi
- **Fayl:** `src/modules/students/entities/student-discount-period.entity.ts` (33-qator)
- **Fayl:** `src/modules/payments/payments.service.ts` (331, 421-qator)
- **Muammo:** Entity comment "Inclusive" deydi, lekin query `toMonth > :mStart` (exclusive) ishlaydi.
- **Tuzatish:** Entity commentni tuzatish YOKI query logikasini o'zgartirish.
- [x] Tuzatildi

### 5.9 Blacklisted tokenlar hech qachon tozalanmaydi
- **Fayl:** `src/modules/blacklist/blacklist.service.ts`
- **Muammo:** `blacklisted_tokens` jadvali cheksiz o'sadi. Har bir auth request bu jadvalni tekshiradi.
- **Tuzatish:** Cron job bilan expired tokenlarni tozalash.
- [x] Tuzatildi

### 5.10 Student status transitions — state machine yo'q
- **Fayl:** `src/modules/students/students.service.ts` — `changeStatus()`
- **Muammo:** Istalgan statusdan istalgan statusga o'tish mumkin (FINISHED->ACTIVE, STOPPED->NEW).
- **Tuzatish:** Ruxsat etilgan o'tishlar xaritasini yaratish va tekshirish.
- [x] Tuzatildi

### 5.11 referral.entity.ts — createAt typo
- **Fayl:** `src/modules/referrals/entities/referal.entity.ts` (34-qator)
- **Muammo:** `createAt` bo'lishi kerak `createdAt`.
- **Tuzatish:** Migration bilan column nomini o'zgartirish yoki entity property nomini tuzatish.
- [x] Tuzatildi

---

## PROGRESS

| Bosqich | Jami | Tuzatildi | Qoldi |
|---------|------|-----------|-------|
| 1. Xavfsizlik | 11 | 11 | 0 |
| 2. Route/Controller | 4 | 4 | 0 |
| 3. Hisob-kitob | 8 | 8 | 0 |
| 4. Guruh/Davomat | 7 | 7 | 0 |
| 5. Qolganlar | 11 | 11 | 0 |
| **JAMI** | **41** | **41** | **0** |
