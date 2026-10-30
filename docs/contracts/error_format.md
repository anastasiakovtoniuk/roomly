# Єдиний формат помилок Roomly (MVP)

**Дата:** 2026-10-30
**Джерела:** `docs/requirements_digest.md` (TA-9, G5, BR-1, BR-4, BR-10, BR-14, BR-15); `docs/adr/0003-backend-stack.md`, `0005`, `0006`, `0008`; `results/3.5_acceptance_criteria_result.md` (Q05, Q11, Q13, Q15); `docs/contracts/api_spec.md`.

## 1. Структура

Будь-яка помилка будь-якого ендпоінта під `/api` має одне тіло **[Пропозиція]**:

| Поле | Тип | Обов'язкове | Призначення |
| --- | --- | --- | --- |
| `error.code` | string | так | Машинний код у `UPPER_SNAKE_CASE` з таблиці §3 |
| `error.message` | string | так | Запасний текст українською для журналу й аварійного показу |
| `error.details` | object | ні | Структуровані дані для коду, перелічені в §3 |

Валідація:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Некоректні дані запиту", "details": { "fields": [ { "path": "email", "reason": "invalid_email" }, { "path": "password", "reason": "too_short" } ] } } }
```

Конфлікт стану:

```json
{ "error": { "code": "BOOKING_STATUS_CONFLICT", "message": "Дію неможливо виконати для бронювання в цьому статусі", "details": { "currentStatus": "auto_cancelled" } } }
```

- `details.fields[].path` — шлях до поля (`name`, `equipment.1`, `query.date`); `reason` — машинна причина з переліку Zod **[Пропозиція]**.
- **Клієнт показує текст за `code`**, а не за `message`. Тести (ADR-0008) перевіряють `code` і HTTP-статус. Дослівні тексти для користувача не фіксуються: це відкриті Q05, Q11, Q13, Q15.
- Спільна обгортка `fetch` на клієнті (ADR-0002) розбирає це тіло для будь-якого статусу ≥ 400.

## 2. Правила вибору HTTP-статусу

Одне правило на категорію, без винятків **[Пропозиція]**:

| Категорія | HTTP | Правило |
| --- | --- | --- |
| Валідація | 400 | Запит не відповідає схемі Zod: тіло, параметри шляху, запиту, нерозбірний JSON |
| Автентифікація | 401 | Немає дійсної сесії або неправильні дані входу |
| Права | 403 | Сесія є, але роль не дозволяє дію |
| Не знайдено | 404 | Ресурсу за ідентифікатором немає або він недоступний цьому користувачу; невідомий шлях |
| Конфлікти стану | 409 | Запит коректний, але суперечить поточному стану даних |
| Підтвердження | 422 | Запит на підтвердження присутності коректний, але не може бути прийнятий за правилами вікна й QR (G5) |
| Внутрішня | 500 | Будь-яка непередбачена помилка сервера |

## 3. Коди помилок

### Валідація

| Код | HTTP | Коли виникає | Ендпоінти | Історії / BR |
| --- | --- | --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Вхід не відповідає схемі; `details.fields` обов'язкове | Усі з тілом, параметрами шляху чи запиту | TA-14, US-1.2, US-A.1a, US-A.1b, US-A.2, BR-13 (початок раніше за завершення) |

### Автентифікація й права

| Код | HTTP | Коли виникає | Ендпоінти | Історії / BR |
| --- | --- | --- | --- | --- |
| `UNAUTHENTICATED` | 401 | Немає cookie або сесію не знайдено | Усі, крім `health`, `register`, `login`, `logout` | US-3.1-AC-04, US-5.2-AC-03, US-X.1b, TA-12 |
| `INVALID_CREDENTIALS` | 401 | Неправильна пошта або пароль; ті самі код і повідомлення для обох випадків, щоб не розкривати існування пошти **[Пропозиція]** | `POST /api/auth/login` | US-X.1a-AC-02 |
| `FORBIDDEN` | 403 | Студент викликає `/api/admin/*`; адміністратор викликає ендпоінти лише для студента | Усі `/api/admin/*`; `POST /api/bookings`, `GET /api/bookings`, `GET /api/bookings/:bookingId`, `POST /api/bookings/:bookingId/cancel`, `POST /api/check-ins` | BR-15, SYS-AC-09, FB-12, US-A.1a-AC-03, US-A.2-AC-03, US-A.4b-AC-03, US-A.6-AC-03 |

### Не знайдено

| Код | HTTP | Коли виникає | Ендпоінти | Історії / BR |
| --- | --- | --- | --- | --- |
| `ROOM_NOT_FOUND` | 404 | Кімнати з `roomId` немає | `GET /api/rooms/:roomId`, `GET /api/rooms/:roomId/available-slots`, `PATCH /api/admin/rooms/:roomId`, `POST /api/admin/rooms/:roomId/slots`, `GET /api/admin/rooms/:roomId/qr` | US-2.1…US-2.4, US-A.1b, US-A.2, US-A.4a |
| `SLOT_NOT_FOUND` | 404 | Слота зі `slotId` немає | `POST /api/bookings` | US-3.1 |
| `BOOKING_NOT_FOUND` | 404 | Бронювання немає; для студента — також чуже бронювання | `GET /api/bookings/:bookingId`, `POST /api/bookings/:bookingId/cancel`, `POST /api/admin/bookings/:bookingId/cancel`, `POST /api/admin/bookings/:bookingId/confirm` | BR-6, BR-8, US-X.1a-AC-03 |
| `ENDPOINT_NOT_FOUND` | 404 | Невідомий шлях або метод під `/api` **[Пропозиція]** | Будь-який | ADR-0003 (єдиний формат) |

### Конфлікти стану

| Код | HTTP | Коли виникає | Ендпоінти | Історії / BR |
| --- | --- | --- | --- | --- |
| `EMAIL_ALREADY_REGISTERED` | 409 | Нормалізована пошта вже існує | `POST /api/auth/register` | BR-14, US-1.2 |
| `SLOT_ALREADY_BOOKED` | 409 | У слота є живе бронювання, зокрема порушення часткового обмеження BR-1 у сховищі | `POST /api/bookings` | BR-1, TA-7, US-3.4, SYS-AC-06 |
| `SLOT_NOT_BOOKABLE` | 409 | Слот завершився; за варіанта G1 (а) — почався | `POST /api/bookings` | BR-11, G1/Q04 |
| `SLOT_OVERLAP` | 409 | Новий слот перетинається з наявним слотом кімнати | `POST /api/admin/rooms/:roomId/slots` | BR-13, G7/Q10 |
| `BOOKING_STATUS_CONFLICT` | 409 | Статус бронювання не дозволяє дію; `details.currentStatus` обов'язкове | `POST /api/bookings/:bookingId/cancel`, `POST /api/admin/bookings/:bookingId/cancel`, `POST /api/admin/bookings/:bookingId/confirm` | BR-6, BR-7, BR-9, FB-1, Q02, Q07, Q18 |

### Підтвердження

Окремий код для кожного результату G5; успіхи «підтверджено» й «вже підтверджено» помилками не є (BR-10).

| Код | HTTP | Коли виникає | Ендпоінти | Історії / BR |
| --- | --- | --- | --- | --- |
| `QR_UNKNOWN` | 422 | Токен не належить жодній кімнаті | `POST /api/check-ins` | US-5.1-AC-03, G5 |
| `NO_CURRENT_BOOKING` | 422 | У кімнаті немає бронювання на поточний момент, або його скасовано | `POST /api/check-ins` | US-5.1-AC-04, G5 |
| `CHECK_IN_WINDOW_CLOSED` | 422 | Дедлайн минув, бронювання автоскасоване; той самий код для студента й адміністратора **[Рішення команди]** | `POST /api/check-ins`, `POST /api/admin/bookings/:bookingId/confirm` | BR-4, BR-9, US-5.1-AC-06, US-5.6b-AC-03, US-A.7-AC-03, G5 |
| `CHECK_IN_TOO_EARLY` | 422 | Бронювання ще не почалося; межі — Q01 | `POST /api/check-ins`, `POST /api/admin/bookings/:bookingId/confirm` | BR-4, G4/Q01 |

### Внутрішня помилка

| Код | HTTP | Коли виникає | Ендпоінти | Історії / BR |
| --- | --- | --- | --- | --- |
| `INTERNAL_ERROR` | 500 | Будь-яка непередбачена помилка. У відповіді лише код і загальне повідомлення, без стеку, SQL, шляхів і повідомлень бібліотек; деталі — лише в журналі сервера | Будь-який | ADR-0003 |

Разом: 18 кодів. Перелік лежить у `shared/` і є єдиним джерелом для клієнта, сервера й тестів.
