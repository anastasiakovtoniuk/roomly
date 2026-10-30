# Специфікація API Roomly (MVP)

**Дата:** 2026-10-30
**Джерела:** `docs/requirements_digest.md` (BR-1…BR-17, FB-1…FB-15, TA-1…TA-15, G1…G10); `docs/adr/0003-backend-stack.md`, `0004`, `0005`, `0006`; `results/3.5_acceptance_criteria_result.md` (§2, SYS-AC-01…10, §3.1, §3.3, Q01…Q18); `docs/project_digest.md` (§5, §6). Пов'язані контракти: [data_model.md](data_model.md), [error_format.md](error_format.md). Промпт: [prompts/4.3_technical_contracts.md](../../prompts/4.3_technical_contracts.md).

## 1. Загальні правила

- **Стиль:** REST поверх JSON, префікс `/api`, один процес Express (ADR-0003). Запити зі зміною даних мають `Content-Type: application/json` (ADR-0005, захист від CSRF).
- **Автентифікація:** cookie сесії `roomly_session` **[Пропозиція]** щодо назви: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` при HTTPS, без строку дії (ADR-0005, TA-1). Ідентифікатор і роль користувача беруться лише із сесії, ніколи з тіла, параметрів шляху чи запиту (BR-17, FB-11).
- **Ролі в таблицях:** «гість» — без сесії; «студент» — `role = student`; «адміністратор» — `role = admin`; «авторизований» — будь-яка роль. Студентські й адміністративні ендпоінти взаємовиключні: інша роль отримує `403 FORBIDDEN` ([error_format.md](error_format.md)).
- **Дата-час:** ISO 8601 в UTC із `Z`, наприклад `2026-11-03T12:00:00.000Z` (TA-4). Параметр «дата» — `YYYY-MM-DD` у часовому поясі університету з конфігурації (G9).
- **Ідентифікатори:** UUID, генерує сервер (TA-3). Невалідний UUID у шляху — `400 VALIDATION_ERROR`.
- **Списки:** без пагінації (TA-13), без фільтрів (FB-15).
- **Назви полів:** `camelCase`, збігаються з [data_model.md](data_model.md).
- **Тіло відповіді:** завжди JSON-об'єкт (не масив на верхньому рівні) **[Пропозиція]**; виняток — `204 No Content`.
- **Серверний час (TA-5):** кожна відповідь, що містить бронювання, має поле `serverTime` на верхньому рівні, а кожне бронювання — поле `deadline`. Клієнт рахує таймер від них, а не від власного годинника.
- **Ліниве автоскасування (ADR-0006):** перед читанням бронювань, створенням бронювання й підтвердженням сервер виконує функцію «скасувати прострочені», тому статуси у відповіді актуальні й між запусками таймера.
- **Помилки:** лише формат і коди з [error_format.md](error_format.md). `UNAUTHENTICATED` (401) повертають усі ендпоінти, крім `health`, `register`, `login`, `logout`; `INTERNAL_ERROR` (500) — будь-який. Невідомий шлях або метод під `/api` повертає `404 ENDPOINT_NOT_FOUND`. Нижче ці три коди в таблицях помилок не повторюються.
- **Валідація:** кожне тіло, параметр шляху й запиту перевіряється схемою Zod із `shared/` (ADR-0003); назва схеми вказана в кожному розділі. Невдача — `400 VALIDATION_ERROR` з `details.fields`.

## 2. Спільні об'єкти відповіді

### `User`

| Поле | Тип | Примітка |
| --- | --- | --- |
| `id` | string (UUID) | |
| `name` | string | |
| `email` | string | Нормалізована, нижній регістр |
| `role` | `"student"` \| `"admin"` | |

`passwordHash` і дані сесій не повертаються ніколи.

### `Room`

| Поле | Тип | Примітка |
| --- | --- | --- |
| `id` | string (UUID) | |
| `name` | string | |
| `capacity` | integer | US-2.1 |
| `building` | string | US-2.3 |
| `floor` | integer | US-2.3 |
| `equipment` | string[] | US-2.2; може бути порожнім |

`qrToken` у `Room` немає ні для студента, ні для адміністратора: токен віддає лише `GET /api/admin/rooms/:roomId/qr` (FB-12).

### `Slot`

| Поле | Тип | Примітка |
| --- | --- | --- |
| `id` | string (UUID) | |
| `roomId` | string (UUID) | |
| `startsAt` | string (дата-час) | |
| `endsAt` | string (дата-час) | |

### `AvailableSlot` = `Slot` +

| Поле | Тип | Примітка |
| --- | --- | --- |
| `releasedByAutoCancel` | boolean | `true`, якщо слот вільний і в нього є автоскасоване бронювання (US-2.6, G8) |

### `Booking`

| Поле | Тип | Примітка |
| --- | --- | --- |
| `id` | string (UUID) | |
| `status` | `"active"` \| `"confirmed"` \| `"cancelled_by_student"` \| `"auto_cancelled"` | Перелік розширюється за G2/Q03; клієнт має показувати невідоме значення нейтрально |
| `room` | `{ id, name, building, floor }` | US-3.2a |
| `slot` | `{ id, startsAt, endsAt }` | US-3.2a |
| `deadline` | string (дата-час) | Дедлайн підтвердження (TA-5, US-3.2b) |
| `createdAt` | string (дата-час) | |
| `confirmedAt` | string (дата-час) \| null | |
| `confirmedBy` | `"student"` \| `"admin"` \| null | Роль того, хто підтвердив; без ідентифікатора й імені (US-5.2-AC-04) |
| `cancelledAt` | string (дата-час) \| null | |

`Booking` не містить даних власника, тому його можна повертати й студенту, що підтвердив чуже бронювання (US-5.2).

### `AdminBooking` = `Booking` +

| Поле | Тип | Примітка |
| --- | --- | --- |
| `student` | `{ id, name, email }` | Власник бронювання (US-A.5) |

### `CheckInResult`

| Поле | Тип | Примітка |
| --- | --- | --- |
| `result` | `"confirmed"` \| `"already_confirmed"` | Обидва — успіх (BR-10, G5) |
| `booking` | `Booking` | Стан після операції |
| `serverTime` | string (дата-час) | TA-5 |

## 3. Зведена таблиця ендпоінтів

| Метод | Шлях | Роль | Історії | Коротко |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | гість | Walking Skeleton | Стан сервера й з'єднання з базою |
| POST | `/api/auth/register` | гість | US-1.2 | Реєстрація студента |
| POST | `/api/auth/login` | гість | US-X.1a | Вхід, видача cookie сесії |
| POST | `/api/auth/logout` | гість або авторизований | US-X.1b | Вихід, видалення сесії |
| GET | `/api/auth/me` | авторизований | US-1.3, US-X.1a, US-X.1b | Поточний користувач |
| GET | `/api/rooms` | авторизований | US-1.3, US-2.1, US-2.2, US-2.3 | Список кімнат |
| GET | `/api/rooms/:roomId` | авторизований | US-2.1, US-2.2, US-2.3 | Деталі кімнати |
| GET | `/api/rooms/:roomId/available-slots` | авторизований | US-2.4, US-2.6 | Вільні слоти кімнати на дату |
| POST | `/api/bookings` | студент | US-3.1, US-3.4 | Створити бронювання |
| GET | `/api/bookings` | студент | US-4.2, US-X.3, US-4.1, US-5.3, US-5.4 | Власні бронювання: майбутні або минулі |
| GET | `/api/bookings/:bookingId` | студент | US-3.2a, US-3.2b, US-5.3 | Деталі власного бронювання |
| POST | `/api/bookings/:bookingId/cancel` | студент | US-4.3 | Скасувати власне активне бронювання |
| POST | `/api/check-ins` | студент | US-5.1, US-5.2, US-5.6a, US-5.6b | Підтвердити присутність за токеном QR |
| POST | `/api/admin/rooms` | адміністратор | US-A.1a | Створити кімнату |
| PATCH | `/api/admin/rooms/:roomId` | адміністратор | US-A.1b | Змінити кімнату |
| POST | `/api/admin/rooms/:roomId/slots` | адміністратор | US-A.2 | Створити слот |
| GET | `/api/admin/rooms/:roomId/qr` | адміністратор | US-A.4a, US-A.4b | Токен QR кімнати |
| GET | `/api/admin/bookings` | адміністратор | US-A.5 | Усі бронювання зі статусами |
| POST | `/api/admin/bookings/:bookingId/cancel` | адміністратор | US-A.6 | Скасувати бронювання |
| POST | `/api/admin/bookings/:bookingId/confirm` | адміністратор | US-A.7 | Підтвердити вручну |

Разом: 20 ендпоінтів.

## 4. Службове

### GET `/api/health`

**Роль:** гість. **Схема Zod:** немає (вхідних даних немає).

**200 OK** — сервер працює; поле `database` показує результат тестового запиту до бази (ADR-0003, ADR-0004):

```json
{ "status": "ok", "database": "ok", "serverTime": "2026-11-03T12:00:00.000Z" }
```

| Поле | Тип | Примітка |
| --- | --- | --- |
| `status` | `"ok"` | Процес відповідає |
| `database` | `"ok"` \| `"unavailable"` | Тестовий запит до бази вдався чи ні **[Пропозиція]** |
| `serverTime` | string (дата-час) | |

Недоступна база не змінює HTTP-статус: ендпоінт показує стан, а не відмовляє **[Пропозиція]**.

**Помилки:** лише `INTERNAL_ERROR`.

## 5. Автентифікація

### POST `/api/auth/register`

**Роль:** гість. **Схема Zod:** `RegisterBody`.

| Поле тіла | Тип | Обов'язкове | Валідація |
| --- | --- | --- | --- |
| `name` | string | так | 1…100 символів після обрізання пробілів **[Пропозиція]**, Q08 |
| `email` | string | так | Формат пошти, ≤ 254 символи; сервер обрізає пробіли й переводить у нижній регістр (BR-14) |
| `password` | string | так | 8…72 символи (TA-14; верхня межа — обмеження bcrypt **[Пропозиція]**), Q08 |

Поле `role`, якщо його надіслано, ігнорується (BR-14, FB-14).

**201 Created** — створено студента й одразу відкрито сесію: відповідь ставить cookie `roomly_session` **[Пропозиція]**, Q08 (автоматичний вхід).

```json
{ "user": { "id": "0b6c…", "name": "Олена", "email": "olena@example.com", "role": "student" } }
```

| HTTP | Код помилки | Коли |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Тіло не відповідає `RegisterBody` |
| 409 | `EMAIL_ALREADY_REGISTERED` | Нормалізована пошта вже існує |

**Правила:** BR-14, FB-5, FB-14. **Критерії 3.5:** US-1.2-AC-01, US-1.2-AC-02, US-1.2-AC-03, SYS-AC-08.

**Q08:** якщо команда вирішить, що автоматичного входу немає, відповідь лишається тією самою, але без cookie; клієнт після неї викликає `login`.

### POST `/api/auth/login`

**Роль:** гість. **Схема Zod:** `LoginBody`.

| Поле тіла | Тип | Обов'язкове | Валідація |
| --- | --- | --- | --- |
| `email` | string | так | Формат пошти; нормалізується як у реєстрації |
| `password` | string | так | Непорожній рядок (довжину не перевіряє, щоб не розкривати правила) |

**200 OK** — створено нову сесію, cookie `roomly_session` встановлено. Наявна cookie цього пристрою замінюється.

```json
{ "user": { "id": "0b6c…", "name": "Олена", "email": "olena@example.com", "role": "student" } }
```

| HTTP | Код помилки | Коли |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Тіло не відповідає `LoginBody` |
| 401 | `INVALID_CREDENTIALS` | Пошти немає або пароль неправильний — однакова відповідь для обох випадків **[Пропозиція]** |

**Правила:** BR-8 (далі доступ лише до своїх даних), TA-1. **Критерії 3.5:** US-X.1a-AC-01, US-X.1a-AC-02, US-X.1b-AC-03, SYS-AC-08.

### POST `/api/auth/logout`

**Роль:** гість або авторизований. **Схема Zod:** немає.

**204 No Content** — сесію з бази видалено, cookie очищено. Без дійсної сесії відповідь та сама (ідемпотентно) **[Пропозиція]**.

**Помилки:** лише `INTERNAL_ERROR`.

**Правила:** TA-1, ADR-0005. **Критерії 3.5:** US-X.1b-AC-01, US-X.1b-AC-02.

### GET `/api/auth/me`

**Роль:** авторизований. **Схема Zod:** немає.

**200 OK**

```json
{ "user": { "id": "0b6c…", "name": "Олена", "email": "olena@example.com", "role": "student" } }
```

**Помилки:** лише `UNAUTHENTICATED`. Клієнт викликає ендпоінт під час відкриття застосунку, щоб вирішити, показувати вхід, список кімнат (US-1.3) чи адмін-екрани.

**Критерії 3.5:** US-1.3-AC-01, US-X.1b-AC-01, US-X.1b-AC-02.

## 6. Кімнати й слоти

### GET `/api/rooms`

**Роль:** авторизований. **Схема Zod:** немає.

**200 OK** — усі кімнати, впорядковані за `name` **[Пропозиція]**. Порожній список — `{ "rooms": [] }`.

```json
{ "rooms": [ { "id": "8f1a…", "name": "R101", "capacity": 6, "building": "Корпус 1", "floor": 2, "equipment": ["екран", "дошка"] } ] }
```

**Помилки:** лише загальні (§1).

**Правила:** FB-12 (без `qrToken`), FB-15 (без фільтрів). **Критерії 3.5:** US-1.3-AC-01, US-1.3-AC-02, US-2.1-AC-01, US-2.1-AC-02, US-2.2-AC-01, US-2.2-AC-02, US-2.3-AC-01, US-2.3-AC-02, US-A.1a-AC-02, US-A.1b-AC-02.

### GET `/api/rooms/:roomId`

**Роль:** авторизований. **Схема Zod:** `RoomIdParams` (`roomId`: UUID).

**200 OK** — `{ "room": Room }`.

| HTTP | Код помилки | Коли |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | `roomId` не UUID |
| 404 | `ROOM_NOT_FOUND` | Кімнати немає |

**Критерії 3.5:** US-2.1-AC-01, US-2.2-AC-01, US-2.3-AC-01.

### GET `/api/rooms/:roomId/available-slots`

**Роль:** авторизований. **Схеми Zod:** `RoomIdParams`, `AvailableSlotsQuery`.

| Параметр запиту | Тип | Обов'язкове | Валідація |
| --- | --- | --- | --- |
| `date` | string | так | `YYYY-MM-DD`, реальна календарна дата; дата в часовому поясі університету (G9) |

**200 OK** — вільні слоти кімнати, що починаються в цю дату, впорядковані за `startsAt`. Слот вільний, якщо в нього немає бронювання `active`/`confirmed` і він не завершився (TA-11, BR-11). Зайняті слоти не повертаються (US-2.4-AC-02).

```json
{
  "roomId": "8f1a…",
  "date": "2026-11-03",
  "serverTime": "2026-11-03T12:00:00.000Z",
  "slots": [
    { "id": "c41e…", "roomId": "8f1a…", "startsAt": "2026-11-03T12:00:00.000Z", "endsAt": "2026-11-03T13:00:00.000Z", "releasedByAutoCancel": true }
  ]
}
```

| HTTP | Код помилки | Коли |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | `roomId` не UUID; `date` відсутня чи некоректна |
| 404 | `ROOM_NOT_FOUND` | Кімнати немає |

**Правила:** BR-1, BR-5 (перед відповіддю виконується ліниве автоскасування), BR-11. **Критерії 3.5:** US-2.4-AC-01…03, US-2.6-AC-01…03, SYS-AC-10.

**Залежності:**

- **G1/Q04:** за варіантом (а) слоти, що вже почалися, не повертаються, і `releasedByAutoCancel` на сьогодні майже завжди `false`; за варіантом (б) повертаються до завершення. Змінюється лише умова «вільний» у сервісі.
- **G8:** позначка, а не окремий запит **[Пропозиція]**, як радить digest.
- US-2.4 говорить про «кімнати» на дату: клієнт викликає ендпоінт для обраної кімнати. Зведеного запиту для всіх кімнат немає: за TA-13 кімнат десятки **[Пропозиція]**.

## 7. Бронювання студента

### POST `/api/bookings`

**Роль:** студент. **Схема Zod:** `CreateBookingBody`.

| Поле тіла | Тип | Обов'язкове | Валідація |
| --- | --- | --- | --- |
| `slotId` | string | так | UUID |

Власник — користувач сесії (BR-17); інших полів тіло не приймає.

**201 Created**

```json
{
  "booking": {
    "id": "5d2b…", "status": "active",
    "room": { "id": "8f1a…", "name": "R101", "building": "Корпус 1", "floor": 2 },
    "slot": { "id": "c41e…", "startsAt": "2026-11-03T12:00:00.000Z", "endsAt": "2026-11-03T13:00:00.000Z" },
    "deadline": "2026-11-03T12:15:00.000Z", "createdAt": "2026-11-01T09:30:00.000Z",
    "confirmedAt": null, "confirmedBy": null, "cancelledAt": null
  },
  "serverTime": "2026-11-01T09:30:00.000Z"
}
```

| HTTP | Код помилки | Коли |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | `slotId` відсутній або не UUID |
| 403 | `FORBIDDEN` | Викликає адміністратор |
| 404 | `SLOT_NOT_FOUND` | Слота немає |
| 409 | `SLOT_ALREADY_BOOKED` | У слота є живе бронювання; зокрема порушення часткового обмеження BR-1 у сховищі при конкурентному запиті |
| 409 | `SLOT_NOT_BOOKABLE` | Слот завершився; за G1 (а) — уже почався |

**Як працює:** ліниве автоскасування → перевірка слота → обчислення `deadline` → `INSERT`. Захист — обмеження в сховищі ([data_model.md §4.3](data_model.md)), а не попередня перевірка (TA-7).

**Правила:** BR-1, BR-2, BR-3, BR-11, BR-17, FB-11. **Критерії 3.5:** US-3.1-AC-01…04, US-3.4-AC-01…03, US-1.2-AC-02, US-2.6-AC-03, SYS-AC-06.

**Залежності:** G1/Q04 — `deadline` для слота, що вже почався (за варіантом (б) digest: момент бронювання + grace period, але не пізніше `endsAt`). Змінюється лише функція обчислення дедлайну; форма відповіді та сама.

### GET `/api/bookings`

**Роль:** студент. **Схема Zod:** `ListMyBookingsQuery`.

| Параметр запиту | Тип | Обов'язкове | Валідація |
| --- | --- | --- | --- |
| `scope` | `"upcoming"` \| `"past"` | так | Одне з двох значень |

Лише бронювання користувача сесії (BR-8). Класифікація **[Пропозиція]**, Q12:

- `upcoming` — статус `active` або `confirmed` і слот ще не завершився (`slot.endsAt > now`), за зростанням `slot.startsAt`. Сюди входить і поточне бронювання, щоб клієнт показував таймер (US-5.3) і повідомлення про початок (US-5.4).
- `past` — усі інші власні: слот завершився або статус кінцевий скасований, за спаданням `slot.startsAt`.

**200 OK**

```json
{ "bookings": [ { "id": "5d2b…", "status": "active", "room": { "id": "8f1a…", "name": "R101", "building": "Корпус 1", "floor": 2 }, "slot": { "id": "c41e…", "startsAt": "2026-11-03T12:00:00.000Z", "endsAt": "2026-11-03T13:00:00.000Z" }, "deadline": "2026-11-03T12:15:00.000Z", "createdAt": "2026-11-01T09:30:00.000Z", "confirmedAt": null, "confirmedBy": null, "cancelledAt": null } ], "serverTime": "2026-11-02T12:00:00.000Z" }
```

| HTTP | Код помилки | Коли |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | `scope` відсутній або інший |
| 403 | `FORBIDDEN` | Викликає адміністратор |

**Сповіщення на клієнті (TA-8).** Окремого ендпоінта немає. Нагадування (US-4.1) клієнт показує для `active` бронювання зі списку `upcoming`, коли `slot.startsAt − serverTime` стає ≤ 24 год **[Гіпотеза]** H02; випадки Q05/G10 не закриваються. Повідомлення про початок (US-5.4) — для `active`, коли `serverTime ≥ slot.startsAt`, з `deadline` з того самого об'єкта. Push немає (FB-3).

**Правила:** BR-8, BR-12, BR-16, TA-8. **Критерії 3.5:** US-4.2-AC-01…03, US-X.3-AC-01…03, US-4.1-AC-01…03, US-5.4-AC-01…03, US-5.3-AC-01, SYS-AC-05.

**Залежності:** Q12 — що вважати «минулим»; змінюється лише функція класифікації. G2/Q03 — статус скасованих адміністратором записів у `past`.

### GET `/api/bookings/:bookingId`

**Роль:** студент. **Схема Zod:** `BookingIdParams` (`bookingId`: UUID).

**200 OK** — `{ "booking": Booking, "serverTime": "…" }`.

| HTTP | Код помилки | Коли |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | `bookingId` не UUID |
| 403 | `FORBIDDEN` | Викликає адміністратор |
| 404 | `BOOKING_NOT_FOUND` | Бронювання немає або воно чуже — однакова відповідь, щоб не розкривати чужі записи |

**Правила:** BR-8. **Критерії 3.5:** US-3.2a-AC-01, US-3.2a-AC-02, US-3.2b-AC-01…03, US-5.3-AC-01…03, US-X.1a-AC-03.

### POST `/api/bookings/:bookingId/cancel`

**Роль:** студент. **Схема Zod:** `BookingIdParams`. Тіло порожнє.

Одне умовне оновлення `active` → `cancelled_by_student` лише для власного бронювання (BR-6, ADR-0006).

**200 OK** — `{ "booking": Booking, "serverTime": "…" }` зі статусом `cancelled_by_student`.

| HTTP | Код помилки | Коли |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | `bookingId` не UUID |
| 403 | `FORBIDDEN` | Викликає адміністратор |
| 404 | `BOOKING_NOT_FOUND` | Бронювання немає або воно чуже |
| 409 | `BOOKING_STATUS_CONFLICT` | Статус не `active` (зокрема повторне скасування, підтверджене — FB-1); `details.currentStatus` |

**Правила:** BR-6, BR-9, FB-1. **Критерії 3.5:** US-4.3-AC-01…04, SYS-AC-05, SYS-AC-10.

**Залежності:** Q07 — чи можна скасувати активне бронювання, що вже почалося. Зараз дозволено, поки статус `active` **[Пропозиція]**; за іншої відповіді додається одна умова часу й той самий код `BOOKING_STATUS_CONFLICT`. G3 — скасування підтвердженого не додається.

## 8. Підтвердження присутності

### POST `/api/check-ins`

**Роль:** студент — будь-який, не обов'язково власник (BR-4, US-5.2) **[Рішення команди]**. **Схема Zod:** `CheckInBody`.

| Поле тіла | Тип | Обов'язкове | Валідація |
| --- | --- | --- | --- |
| `qrToken` | string | так | 1…200 символів; вміст QR без змін (TA-12) |

**Алгоритм** (ADR-0006):

1. Знайти кімнату за `qrToken`; немає → `QR_UNKNOWN`.
2. Виконати ліниве автоскасування.
3. Знайти бронювання кімнати, слот якого містить поточний момент (`startsAt ≤ now < endsAt`), серед статусів `active`, `confirmed`, `auto_cancelled`; пріоритет живого запису.
4. Вирішити результат за таблицею нижче. Перехід `active` → `confirmed` — одне умовне оновлення з умовою на статус і дедлайн; якщо конкурентне автоскасування виграло, відповідь — `CHECK_IN_WINDOW_CLOSED` (SYS-AC-07).

| Стан | Відповідь |
| --- | --- |
| `active`, дедлайн не минув | **200**, `result: "confirmed"` |
| `confirmed` | **200**, `result: "already_confirmed"`, без змін (BR-10) |
| `auto_cancelled` або `active` з минулим дедлайном | **422** `CHECK_IN_WINDOW_CLOSED` |
| Слот із поточним моментом не має бронювання, або воно скасоване студентом / адміністратором | **422** `NO_CURRENT_BOOKING` |
| Поточного бронювання немає, але в кімнаті є `active` бронювання, що починається пізніше (вікно раннього скану — Q01) | **422** `CHECK_IN_TOO_EARLY` |

**200 OK** — `CheckInResult`:

```json
{
  "result": "confirmed",
  "booking": { "id": "5d2b…", "status": "confirmed", "room": { "id": "8f1a…", "name": "R101", "building": "Корпус 1", "floor": 2 }, "slot": { "id": "c41e…", "startsAt": "2026-11-03T12:00:00.000Z", "endsAt": "2026-11-03T13:00:00.000Z" }, "deadline": "2026-11-03T12:15:00.000Z", "createdAt": "2026-11-01T09:30:00.000Z", "confirmedAt": "2026-11-03T12:05:00.000Z", "confirmedBy": "student", "cancelledAt": null },
  "serverTime": "2026-11-03T12:05:00.000Z"
}
```

| HTTP | Код помилки | Коли |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | `qrToken` відсутній, порожній чи задовгий |
| 403 | `FORBIDDEN` | Викликає адміністратор (він підтверджує через US-A.7) |
| 422 | `QR_UNKNOWN` | Токен не належить жодній кімнаті |
| 422 | `NO_CURRENT_BOOKING` | У кімнаті немає бронювання на поточний момент, або його скасовано |
| 422 | `CHECK_IN_WINDOW_CLOSED` | Дедлайн минув, бронювання автоскасоване |
| 422 | `CHECK_IN_TOO_EARLY` | Бронювання ще не почалося |

**Мережа (US-5.6a, US-5.6b).** Відсутність мережі до запиту клієнт визначає сам (запит не відправлено, коду сервера немає) і показує, що підтвердження не збережено. Повтор після відновлення мережі — той самий запит; ідемпотентність дає `already_confirmed`, якщо перша спроба таки збереглася (BR-10, TA-9). Втрачена відповідь — Q11.

**Правила:** BR-4, BR-9, BR-10, FB-10, FB-12, TA-5, TA-9, TA-12. **Критерії 3.5:** US-5.1-AC-01…06, US-5.2-AC-01…04, US-5.6a-AC-01…03, US-5.6b-AC-01…03, SYS-AC-03, SYS-AC-07.

**Залежності:** Q01/G4 — чи включені початок і дедлайн, яке вікно раннього скану (до рішення раннє вікно дорівнює grace period **[Пропозиція]**), який момент визначальний. Усе в одній функції перевірки вікна, спільній із ручним підтвердженням; коди й форма відповіді не змінюються. Q02 — пріоритет конкурентних дій; інваріант SYS-AC-07 виконується вже зараз.

## 9. Адміністрування

Усі шляхи `/api/admin/*` закриває проміжний обробник ролі: студент отримує `403 FORBIDDEN` (BR-15, SYS-AC-09). Нижче `FORBIDDEN` у таблицях не повторюється.

### POST `/api/admin/rooms`

**Схема Zod:** `CreateRoomBody`.

| Поле тіла | Тип | Обов'язкове | Валідація |
| --- | --- | --- | --- |
| `name` | string | так | 1…100 символів після обрізання |
| `capacity` | integer | так | ≥ 1 **[Пропозиція]**, Q09 |
| `building` | string | так | 1…100 символів |
| `floor` | integer | так | Ціле число **[Пропозиція]**, Q09 |
| `equipment` | string[] | так | 0…20 елементів, кожен 1…50 символів, без повторів **[Пропозиція]**, Q09 |

**201 Created** — `{ "room": Room }`. Сервер генерує `qrToken` (у відповіді його немає).

| HTTP | Код помилки | Коли |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Тіло не відповідає `CreateRoomBody` |

**Правила:** BR-15, TA-12. **Критерії 3.5:** US-A.1a-AC-01…03, SYS-AC-08, SYS-AC-09.

### PATCH `/api/admin/rooms/:roomId`

**Схеми Zod:** `RoomIdParams`, `UpdateRoomBody` — ті самі поля, що в `CreateRoomBody`, усі необов'язкові, але хоча б одне має бути. `equipment` замінює перелік цілком.

**200 OK** — `{ "room": Room }`. Незмінені поля лишаються як були (US-A.1b-AC-03).

| HTTP | Код помилки | Коли |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | `roomId` не UUID; порожнє тіло; поле не відповідає правилам |
| 404 | `ROOM_NOT_FOUND` | Кімнати немає |

**Правила:** BR-15, FB-8. **Критерії 3.5:** US-A.1b-AC-01…03, SYS-AC-09. **Залежності:** G6/Q09 — зміна кімнати діє одразу й на наявні бронювання (одна кімната — один запис).

### POST `/api/admin/rooms/:roomId/slots`

**Схеми Zod:** `RoomIdParams`, `CreateSlotBody`.

| Поле тіла | Тип | Обов'язкове | Валідація |
| --- | --- | --- | --- |
| `startsAt` | string (дата-час) | так | ISO 8601 UTC із `Z` |
| `endsAt` | string (дата-час) | так | ISO 8601 UTC із `Z`; `endsAt > startsAt` (BR-13); та сама дата університету, що й `startsAt` **[Пропозиція]**, G7; `endsAt > now` **[Пропозиція]**, Q10 |

**201 Created** — `{ "slot": Slot }`. Один слот на запит **[Пропозиція]**; кілька слотів клієнт створює послідовними запитами.

| HTTP | Код помилки | Коли |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | `roomId` не UUID; час некоректний; завершення не пізніше за початок; інша дата; слот у минулому |
| 404 | `ROOM_NOT_FOUND` | Кімнати немає |
| 409 | `SLOT_OVERLAP` | Слот перетинається з наявним слотом цієї кімнати |

**Правила:** BR-13, BR-15, FB-8. **Критерії 3.5:** US-A.2-AC-01…03, SYS-AC-09. **Залежності:** G7/Q10 — тривалість, крок, суміжність, перетин опівночі; змінюються лише правила валідації.

### GET `/api/admin/rooms/:roomId/qr`

**Схема Zod:** `RoomIdParams`.

**200 OK** — токен для побудови зображення QR на клієнті й друку (US-A.4b — лише на клієнті).

```json
{ "roomId": "8f1a…", "roomName": "R101", "qrToken": "q7Hn…" }
```

Повторний запит повертає той самий токен: QR статичний, перевипуску немає (FB-13, Q15).

| HTTP | Код помилки | Коли |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | `roomId` не UUID |
| 404 | `ROOM_NOT_FOUND` | Кімнати немає |

**Правила:** BR-15, FB-12, FB-13, TA-12. **Критерії 3.5:** US-A.4a-AC-01…03, US-A.4b-AC-01…03, SYS-AC-09.

### GET `/api/admin/bookings`

**Схема Zod:** немає (параметрів немає; фільтри — FB-15).

**200 OK** — усі бронювання всіх студентів, за спаданням `slot.startsAt` **[Пропозиція]**. Перед відповіддю — ліниве автоскасування.

```json
{ "bookings": [ { "id": "5d2b…", "status": "confirmed", "room": { "id": "8f1a…", "name": "R101", "building": "Корпус 1", "floor": 2 }, "slot": { "id": "c41e…", "startsAt": "2026-11-03T12:00:00.000Z", "endsAt": "2026-11-03T13:00:00.000Z" }, "deadline": "2026-11-03T12:15:00.000Z", "createdAt": "2026-11-01T09:30:00.000Z", "confirmedAt": "2026-11-03T12:05:00.000Z", "confirmedBy": "student", "cancelledAt": null, "student": { "id": "0b6c…", "name": "Олена", "email": "olena@example.com" } } ], "serverTime": "2026-11-03T12:30:00.000Z" }
```

**Помилки:** лише загальні.

**Правила:** BR-8, BR-15. **Критерії 3.5:** US-A.5-AC-01…03, SYS-AC-09.

### POST `/api/admin/bookings/:bookingId/cancel`

**Схема Zod:** `BookingIdParams`. Тіло порожнє.

Одне умовне оновлення: «перевести в `ADMIN_CANCEL_STATUS`, лише якщо поточний статус входить до `ADMIN_CANCELLABLE_STATUSES`», записати `cancelledAt`. Обидві константи — у `shared/`.

**200 OK** — `{ "booking": AdminBooking, "serverTime": "…" }`.

| HTTP | Код помилки | Коли |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | `bookingId` не UUID |
| 404 | `BOOKING_NOT_FOUND` | Бронювання немає |
| 409 | `BOOKING_STATUS_CONFLICT` | Статус не входить до `ADMIN_CANCELLABLE_STATUSES`; `details.currentStatus` |

**Правила:** BR-7, BR-9, BR-15. **Критерії 3.5:** US-A.6-AC-01…03, SYS-AC-09, SYS-AC-10.

**Залежності** (відповідь команди змінює лише значення двох констант, а не форму запиту чи відповіді):

- **G2/Q03 → `ADMIN_CANCEL_STATUS`:** варіант (б) — нове значення `cancelled_by_admin` **[Пропозиція]** у `BookingStatus`; варіант (а) — `cancelled_by_student`. До рішення ендпоінт реалізується, але статус не фіксується в тестах (SYS-AC-04).
- **Q18 → `ADMIN_CANCELLABLE_STATUSES`:** `["active"]` (базовий критерій US-A.6-AC-01) або `["active", "confirmed"]` (пропозиція G2). Повторне скасування — `BOOKING_STATUS_CONFLICT`.

### POST `/api/admin/bookings/:bookingId/confirm`

**Схема Zod:** `BookingIdParams`. Тіло порожнє.

Те саме умовне оновлення й та сама функція перевірки вікна, що в `POST /api/check-ins`, але бронювання задане ідентифікатором. Ручне підтвердження дозволене лише до дедлайну, після дедлайну — той самий код, що в студента **[Рішення команди]**.

**200 OK** — `CheckInResult`, у `booking` поле `confirmedBy: "admin"`. Для вже підтвердженого — `result: "already_confirmed"` без змін **[Пропозиція]**, Q06 (як BR-10).

| HTTP | Код помилки | Коли |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | `bookingId` не UUID |
| 404 | `BOOKING_NOT_FOUND` | Бронювання немає |
| 409 | `BOOKING_STATUS_CONFLICT` | Бронювання скасоване студентом або адміністратором; `details.currentStatus` |
| 422 | `CHECK_IN_WINDOW_CLOSED` | Дедлайн минув або бронювання автоскасоване |
| 422 | `CHECK_IN_TOO_EARLY` | Бронювання ще не почалося |

**Правила:** BR-4 (вікно), BR-7, BR-9, BR-15. **Критерії 3.5:** US-A.7-AC-01…03, SYS-AC-03, SYS-AC-07, SYS-AC-09.

**Залежності:** Q01 — межі «до початку» й «рівно на дедлайні», ті самі, що для студента. Q06 — повтор для підтвердженого (зараз `already_confirmed`).

## 10. Покриття історій

| ID історії | Ендпоінти | Таблиці | Критерії 3.5, перевірювані через контракт |
| --- | --- | --- | --- |
| US-1.2 | `POST /api/auth/register` | User, Session | US-1.2-AC-01…03 |
| US-1.3 | `GET /api/auth/me`, `GET /api/rooms` | User, Room | US-1.3-AC-01…02 |
| US-2.1 | `GET /api/rooms`, `GET /api/rooms/:roomId` | Room | US-2.1-AC-01…02 |
| US-2.2 | `GET /api/rooms`, `GET /api/rooms/:roomId` | Room | US-2.2-AC-01…02 |
| US-2.3 | `GET /api/rooms`, `GET /api/rooms/:roomId` | Room | US-2.3-AC-01…02 |
| US-2.4 | `GET /api/rooms/:roomId/available-slots` | Slot, Booking | US-2.4-AC-01…03, SYS-AC-10 |
| US-2.6 | `GET /api/rooms/:roomId/available-slots` (`releasedByAutoCancel`), `POST /api/bookings` | Slot, Booking | US-2.6-AC-01…02; AC-03 умовний (Q04) |
| US-3.1 | `POST /api/bookings` | Booking, Slot | US-3.1-AC-01…04, SYS-AC-06 |
| US-3.2a | `GET /api/bookings/:bookingId`, `GET /api/bookings` | Booking, Slot, Room | US-3.2a-AC-01…02 |
| US-3.2b | `GET /api/bookings/:bookingId` (`deadline`) | Booking | US-3.2b-AC-01…03, SYS-AC-01 |
| US-3.4 | `POST /api/bookings` (`SLOT_ALREADY_BOOKED`) | Booking | US-3.4-AC-01…03, SYS-AC-06 |
| US-4.1 | `GET /api/bookings?scope=upcoming`; показ — лише клієнт (TA-8) | Booking | US-4.1-AC-02; AC-01, AC-03 — ручна перевірка клієнта |
| US-4.2 | `GET /api/bookings?scope=upcoming` | Booking | US-4.2-AC-01…03 |
| US-4.3 | `POST /api/bookings/:bookingId/cancel` | Booking | US-4.3-AC-01…04, SYS-AC-05, SYS-AC-10 |
| US-5.1 | `POST /api/check-ins` | Booking, Room | US-5.1-AC-01…06, SYS-AC-03 |
| US-5.2 | `POST /api/check-ins` | Booking, Room | US-5.2-AC-01…04 |
| US-5.3 | `GET /api/bookings/:bookingId`, `GET /api/bookings` (`deadline`, `serverTime`); відлік — клієнт | Booking | US-5.3-AC-02…03 через дані; AC-01 — ручна перевірка клієнта |
| US-5.4 | `GET /api/bookings?scope=upcoming`; показ — лише клієнт (TA-8) | Booking | US-5.4-AC-02; AC-01, AC-03 — ручна перевірка клієнта |
| US-5.6a | `POST /api/check-ins`; виявлення відсутності мережі — клієнт | Booking | US-5.6a-AC-02…03; AC-01 — ручна перевірка клієнта |
| US-5.6b | `POST /api/check-ins` (повтор, `already_confirmed`, `CHECK_IN_WINDOW_CLOSED`) | Booking | US-5.6b-AC-01…03 |
| US-X.1a | `POST /api/auth/login`, `GET /api/bookings/:bookingId` (`BOOKING_NOT_FOUND` для чужого) | User, Session, Booking | US-X.1a-AC-01…03 |
| US-X.1b | `POST /api/auth/logout`, `GET /api/auth/me` | Session | US-X.1b-AC-01…03 |
| US-X.3 | `GET /api/bookings?scope=past` | Booking | US-X.3-AC-01…03 |
| US-A.1a | `POST /api/admin/rooms` | Room | US-A.1a-AC-01…03 |
| US-A.1b | `PATCH /api/admin/rooms/:roomId` | Room | US-A.1b-AC-01…03 |
| US-A.2 | `POST /api/admin/rooms/:roomId/slots` | Slot | US-A.2-AC-01…03 |
| US-A.4a | `GET /api/admin/rooms/:roomId/qr`; зображення QR — клієнт | Room | US-A.4a-AC-01…03 |
| US-A.4b | `GET /api/admin/rooms/:roomId/qr`; друк — лише клієнт | Room | US-A.4b-AC-03; AC-01…02 — ручна перевірка друку (Q14) |
| US-A.5 | `GET /api/admin/bookings` | Booking, User, Room, Slot | US-A.5-AC-01…03 |
| US-A.6 | `POST /api/admin/bookings/:bookingId/cancel` | Booking | US-A.6-AC-01…03 (статус — G2/Q03) |
| US-A.7 | `POST /api/admin/bookings/:bookingId/confirm` | Booking | US-A.7-AC-01…03 |

Разом 31 історія. Лише на клієнті показуються: нагадування (US-4.1), повідомлення про початок (US-5.4), відлік (US-5.3), повідомлення про відсутність мережі (US-5.6a), зображення й друк QR (US-A.4a, US-A.4b). Дані для них дає сервер.

## 11. Що лягає в `shared/`

Без коду; перелік для кроку 4.4.

- **Значення:** `BOOKING_STATUSES` (`active`, `confirmed`, `cancelled_by_student`, `auto_cancelled`); `LIVE_BOOKING_STATUSES` (`active`, `confirmed`); `USER_ROLES` (`student`, `admin`); `CHECK_IN_RESULTS` (`confirmed`, `already_confirmed`); `BOOKING_SCOPES` (`upcoming`, `past`); `ADMIN_CANCEL_STATUS`, `ADMIN_CANCELLABLE_STATUSES` (G2/Q03, Q18).
- **Константи:** `GRACE_PERIOD_MINUTES = 15` **[Гіпотеза]**; `PASSWORD_MIN_LENGTH = 8` (TA-14); `SESSION_COOKIE_NAME = "roomly_session"` **[Пропозиція]**.
- **Коди помилок:** усі 18 кодів із [error_format.md](error_format.md) і їхні HTTP-статуси; тип тіла помилки `{ error: { code, message, details? } }`.
- **Схеми Zod:**
  - `RegisterBody` — `name`, `email`, `password`;
  - `LoginBody` — `email`, `password`;
  - `RoomIdParams` — `roomId`;
  - `BookingIdParams` — `bookingId`;
  - `AvailableSlotsQuery` — `date`;
  - `CreateBookingBody` — `slotId`;
  - `ListMyBookingsQuery` — `scope`;
  - `CheckInBody` — `qrToken`;
  - `CreateRoomBody` — `name`, `capacity`, `building`, `floor`, `equipment`;
  - `UpdateRoomBody` — ті самі поля, необов'язкові, щонайменше одне;
  - `CreateSlotBody` — `startsAt`, `endsAt`.
- **Типи відповідей:** `User`, `Room`, `Slot`, `AvailableSlot`, `Booking`, `AdminBooking`, `CheckInResult`, відповідь `health`.

## 12. Що команда має підтвердити

У порядку впливу на реалізацію:

1. **G1/Q04** — бронювання слота, що вже почався, і дедлайн для нього: визначає `SLOT_NOT_BOOKABLE`, функцію дедлайну й корисність `releasedByAutoCancel`.
2. **G2/Q03, Q18** — `ADMIN_CANCEL_STATUS` і `ADMIN_CANCELLABLE_STATUSES`; від G2 також залежить, чи потрібне поле причини скасування.
3. **Q01/G4** — межі вікна підтвердження, раннє вікно для `CHECK_IN_TOO_EARLY` (зараз = grace period **[Пропозиція]**), визначальний момент.
4. **Q12** — класифікація `upcoming`/`past`.
5. **Машинні значення й назви [Пропозиція]:** статуси, ролі, `result`, `scope`, cookie `roomly_session`, змінні seed `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_NAME`.
6. **Q08** — автоматичний вхід після реєстрації, обов'язковість `name`, межі пароля.
7. **Q09, G7/Q10** — межі полів кімнати, правила слота (дата, суміжність, слот у минулому), один слот на запит.
8. **Q07** — скасування студентом бронювання, що вже почалося.
9. **Q06** — `already_confirmed` для повторного ручного підтвердження.
10. **`GET /api/health`** — 200 з `database: "unavailable"` замість статусу помилки при недоступній базі.
11. **Зберігання `Session.tokenHash`** замість токена у відкритому вигляді.
