# HOZIR QO'SHILADIGAN FUNKSIYALAR

Ushbu fayldagi funksiyalar hozirgi bosqichda qo'shilishi kerak.
Har biri bajarilgandan keyin `[x]` bilan belgilanadi.

---

## 1. To'lov usuli (Payment Method) kuzatuvi
- **Muammo:** Tizim pulni kim to'laganini biladi, lekin QANDAY to'laganini (naqd, karta, bank o'tkazmasi, online) saqlamaydi. Buxgalteriya va soliq hisoboti uchun juda zarur.
- **Nima qilish kerak:**
  - `PaymentReceipt` entity ga `paymentMethod` enum fieldi qo'shish (`CASH`, `CARD`, `BANK_TRANSFER`, `ONLINE`)
  - `submitReceipt` DTO ga `paymentMethod` required field qo'shish
  - Statistika va hisobotlarda to'lov usuli bo'yicha guruhlash imkoniyati
  - Migration yozish
- **Tegishli fayllar:**
  - `src/modules/payments/entities/payment-receipt.entity.ts`
  - `src/modules/payments/dto/calculate-payment.dto.ts`
  - `src/modules/payments/payments.service.ts`
  - `src/modules/statistics/statistics.service.ts`
- [x] Entity va migration tayyor
- [x] DTO va service yangilandi
- [x] Statistikada to'lov usuli bo'yicha guruhlash qo'shildi

---

## 2. O'qituvchi va xona jadval to'qnashuvi tekshiruvi (Schedule Conflict Detection)
- **Muammo:** Bir o'qituvchi yoki bir xona bir vaqtning o'zida ikki guruhga biriktirilishi mumkin. Tizim hech qanday ogohlantirish bermaydi.
- **Nima qilish kerak:**
  - Guruh yaratish/yangilashda o'qituvchining boshqa guruhlar bilan jadval to'qnashuvini tekshirish
  - Xona band ekanligini tekshirish (bir xil kun va vaqt oralig'ida)
  - To'qnashuv bo'lsa — aniq xato xabari berish (qaysi guruh, qaysi kun, qaysi vaqt)
  - Dars davomiyligi (masalan, 1.5 soat) hisobga olinishi kerak
- **Tegishli fayllar:**
  - `src/modules/groups/groups.service.ts` — `create()`, `update()`
  - `src/modules/group_schedule/group_schedule.service.ts`
  - `src/modules/group_schedule/entities/group-schedule.entity.ts`
  - `src/modules/rooms/entities/rooms.entity.ts`
- [ ] O'qituvchi jadval conflict tekshiruvi qo'shildi
- [ ] Xona jadval conflict tekshiruvi qo'shildi
- [ ] Xato xabarlari aniq va tushunarli

---

## 3. PDF kvitansiya / hisob-faktura (Receipt Generation)
- **Muammo:** To'lov qabul qilinganda talaba/ota-onaga beradigan hech qanday hujjat yo'q. Rasmiy faoliyat uchun kvitansiya shart.
- **Nima qilish kerak:**
  - To'lov tasdiqlanganda avtomatik PDF kvitansiya yaratish
  - Kvitansiya tarkibi: markaz nomi, talaba ismi, guruh, summa, to'lov usuli, sana, qabul qiluvchi
  - Kvitansiya raqamlash tizimi (001, 002, ...)
  - PDF yuklab olish endpoint
  - `pdfkit` yoki `puppeteer` kutubxonasi ishlatish
- **Tegishli fayllar:**
  - Yangi: `src/modules/payments/receipt-pdf.service.ts`
  - `src/modules/payments/payments.controller.ts` — yuklab olish endpoint
  - `src/modules/payments/payments.service.ts` — `confirmReceipt()` dan keyin chaqirish
- [ ] PDF generatsiya service yaratildi
- [ ] Kvitansiya shabloni tayyor
- [ ] Yuklab olish endpoint ishlaydi
- [ ] To'lov tasdiqlanganda avtomatik yaratiladi

---

## 4. Audit Log (Amallar tarixi)
- **Muammo:** Kim qachon nima qilganini kuzatish imkoni yo'q. To'lov tasdiqlash, status o'zgartirish, refund — barchasi izsiz. Muammo yuzaga kelganda tekshirish mumkin emas.
- **Nima qilish kerak:**
  - `audit_logs` jadvali yaratish: `userId`, `action`, `entity`, `entityId`, `oldValue`, `newValue`, `ipAddress`, `timestamp`
  - Muhim operatsiyalar uchun avtomatik log yozish:
    - To'lov tasdiqlash/rad etish
    - Student status o'zgarishi
    - Refund berish
    - Maosh to'lash
    - Guruh status o'zgarishi
    - Foydalanuvchi yaratish/o'chirish
  - Audit log ko'rish endpoint (faqat ADMIN/SUPER_ADMIN)
  - Filtrlash: sana, foydalanuvchi, entity turi bo'yicha
- **Tegishli fayllar:**
  - Yangi: `src/modules/audit/audit.entity.ts`
  - Yangi: `src/modules/audit/audit.service.ts`
  - Yangi: `src/modules/audit/audit.controller.ts`
  - Yangi: `src/modules/audit/audit.module.ts`
  - Yangi: `src/modules/audit/audit.interceptor.ts` (yoki decorator)
  - Migration: `audit_logs` jadvali
- [ ] Entity va migration tayyor
- [ ] AuditService yaratildi
- [ ] Muhim operatsiyalarga log qo'shildi
- [ ] Ko'rish endpoint ishlaydi (filtrlash bilan)

---

## 5. Hisobotlar eksporti (Reports Export)
- **Muammo:** Faqat dashboard statistikasi bor. Ma'lumotlarni Excel/PDF formatda yuklab olish imkoni yo'q. Buxgalter, direktor uchun hisobot kerak.
- **Nima qilish kerak:**
  - Hisobot turlari:
    - **To'lovlar hisoboti** — oy bo'yicha, guruh bo'yicha, status bo'yicha (to'langan/qarzlar)
    - **Maoshlar hisoboti** — xodim, oy, to'langan/qolgan
    - **Xarajatlar hisoboti** — oy bo'yicha, kategoriya bo'yicha
    - **Talabalar hisoboti** — aktiv, to'xtatilgan, yangi, guruh bo'yicha
    - **Davomat hisoboti** — guruh bo'yicha, talaba bo'yicha, foizlar
  - Eksport formatlari: Excel (`.xlsx`), PDF
  - `exceljs` kutubxonasi ishlatish
  - Har bir hisobot uchun alohida endpoint
- **Tegishli fayllar:**
  - Yangi: `src/modules/reports/reports.service.ts`
  - Yangi: `src/modules/reports/reports.controller.ts`
  - Yangi: `src/modules/reports/reports.module.ts`
  - Mavjud service lardan ma'lumot olish (payments, salaries, students, attendance, expenses)
- [ ] Reports modul yaratildi
- [ ] To'lovlar hisoboti (Excel) ishlaydi
- [ ] Maoshlar hisoboti (Excel) ishlaydi
- [ ] Xarajatlar hisoboti (Excel) ishlaydi
- [ ] Talabalar hisoboti (Excel) ishlaydi
- [ ] Davomat hisoboti (Excel) ishlaydi
- [ ] PDF format qo'shildi

---

## PROGRESS

| # | Funksiya | Status |
|---|----------|--------|
| 1 | To'lov usuli | ✅ Tayyor |
| 2 | Jadval to'qnashuvi | Boshlanmadi |
| 3 | PDF kvitansiya | Boshlanmadi |
| 4 | Audit log | Boshlanmadi |
| 5 | Hisobotlar eksporti | Boshlanmadi |
