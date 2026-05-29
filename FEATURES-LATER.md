# KEYINGI BOSQICHLARDA QO'SHILADIGAN FUNKSIYALAR

Ushbu fayldagi funksiyalar hozircha kerak emas, keyingi etaplarda qo'shilishi mumkin.
Har biri bajarilgandan keyin `[x]` bilan belgilanadi.

---

## 1. SMS / Bildirishnoma tizimi (Notifications)
- **Tavsif:** To'lov muddati yaqinlashganda, davomat yo'qligida, lid follow-up sanasida avtomatik SMS/push bildirishnoma yuborish.
- **Kerak bo'ladigan narsalar:**
  - SMS provider integratsiyasi (Eskiz, PlayMobile yoki boshqa O'zbekiston SMS gateway)
  - Bildirishnoma shablonlari (to'lov eslatmasi, davomat, follow-up)
  - Cron job lar bildirishnomalarni yuborish uchun
  - Bildirishnoma tarixi jadvali
  - Sozlash: qaysi bildirishnomalar yoqilgan/o'chirilgan
- [ ] Boshlanmadi

---

## 2. Sinov darsi (Trial Lesson)
- **Tavsif:** Lid/potensial talaba birinchi darsga bepul kelishi — bu ko'p o'quv markazlarda standart amaliyot.
- **Kerak bo'ladigan narsalar:**
  - Lead entity ga `trialDate`, `trialGroupId` fieldlari
  - Sinov darsi uchun davomat yozish imkoniyati (student bo'lmasdan)
  - Sinov darsi natijasi: qabul qildi / rad etdi
  - Sinov darsidan keyin avtomatik lead status o'zgarishi
- [ ] Boshlanmadi

---

## 3. Ota-ona portali (Parent Portal)
- **Tavsif:** Bolalar uchun ota-onalar tizimga kirib farzandining davomati, to'lovlari, baholarini ko'rishi.
- **Kerak bo'ladigan narsalar:**
  - Parent role va entity
  - Parent-Student bog'lanishi (bitta ota-ona bir nechta bolaga)
  - Cheklangan ko'rish: faqat o'z farzandlari
  - Mobile-friendly UI
  - Push notification ota-onalarga
- [ ] Boshlanmadi

---

## 4. Dars mavzusi va uy vazifasi kuzatuvi (Lesson Content Tracking)
- **Tavsif:** Har bir darsda nima o'tilganini, qanday uy vazifasi berilganini qayd qilish.
- **Kerak bo'ladigan narsalar:**
  - `LessonContent` entity: `groupId`, `lessonDate`, `topic`, `homework`, `notes`
  - O'qituvchi har darsdan keyin to'ldiradi
  - Ota-ona/talaba ko'rishi mumkin
  - Dars mavzulari tarixini ko'rish
- [ ] Boshlanmadi

---

## 5. Guruh sig'imi (Group Capacity)
- **Tavsif:** Guruhga maksimal talabalar sonini belgilash va ortiqcha qo'shishni taqiqlash.
- **Kerak bo'ladigan narsalar:**
  - Group entity ga `maxStudents` fieldi
  - Student qo'shishda sig'im tekshiruvi
  - Xona sig'imi bilan bog'lash (Room entity da `capacity` bor)
  - Dashboard da guruh to'lganlik foizini ko'rsatish
- [ ] Boshlanmadi

---

## 6. Kechikish jarimasi (Late Fee)
- **Tavsif:** `hardDueDate` dan keyin to'lamaganlarga avtomatik jarima hisoblash.
- **Kerak bo'ladigan narsalar:**
  - Markaz sozlamalarida jarima foizi/summasi
  - Avtomatik hisoblash (cron yoki to'lov tekshiruvida)
  - Jarima to'lovdan alohida ko'rinishi
  - Jarima bekor qilish imkoniyati (admin)
- [ ] Boshlanmadi

---

## 7. Kutish ro'yxati (Waiting List)
- **Tavsif:** Guruh to'lganda talabalarni navbatga qo'yish.
- **Kerak bo'ladigan narsalar:**
  - `WaitingList` entity: `studentId`/`leadId`, `groupId`, `position`, `addedAt`
  - Guruh sig'imi bilan bog'lash
  - Joy bo'shaganda bildirishnoma
  - Navbat tartibi va boshqaruvi
- [ ] Boshlanmadi

---

## 8. Qarz undirish workflow (Debt Collection)
- **Tavsif:** To'lov muddati o'tgan talabalar uchun bosqichma-bosqich jarayon.
- **Kerak bo'ladigan narsalar:**
  - Bosqichlar: Eslatma (3 kun) -> Ogohlantirish (7 kun) -> Darsga kiritmaslik (14 kun) -> To'xtatish (30 kun)
  - Har bir bosqichda avtomatik SMS
  - Admin tomonidan bosqichni o'tkazib yuborish/bekor qilish
  - Dashboard da qarzlar statusi
- [ ] Boshlanmadi

---

## 9. Markaz aro transfer (Inter-Center Transfer)
- **Tavsif:** Talabani bir markazdan boshqasiga ko'chirish (masalan, boshqa shaharga ko'chganda).
- **Kerak bo'ladigan narsalar:**
  - Transfer so'rovi va tasdiqlash jarayoni
  - To'lov tarixini saqlash
  - Yangi markazda guruhga biriktirish
  - Transfer tarixi
- [ ] Boshlanmadi

---

## 10. Qayta dars (Makeup Lesson)
- **Tavsif:** Darsni o'tkazib yuborgan talabaga qo'shimcha dars belgilash.
- **Kerak bo'ladigan narsalar:**
  - `MakeupLesson` entity: `studentId`, `originalGroupId`, `originalDate`, `makeupGroupId`, `makeupDate`
  - O'qituvchi/admin tomonidan belgilash
  - Boshqa guruhda qayta dars olish imkoniyati
  - Davomatda qayta dars sifatida belgilash
- [ ] Boshlanmadi

---

## PROGRESS

| # | Funksiya | Status |
|---|----------|--------|
| 1 | SMS / Bildirishnoma | Boshlanmadi |
| 2 | Sinov darsi | Boshlanmadi |
| 3 | Ota-ona portali | Boshlanmadi |
| 4 | Dars mavzusi / uy vazifasi | Boshlanmadi |
| 5 | Guruh sig'imi | Boshlanmadi |
| 6 | Kechikish jarimasi | Boshlanmadi |
| 7 | Kutish ro'yxati | Boshlanmadi |
| 8 | Qarz undirish workflow | Boshlanmadi |
| 9 | Markaz aro transfer | Boshlanmadi |
| 10 | Qayta dars | Boshlanmadi |
