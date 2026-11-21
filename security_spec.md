# Security Specification — Nido (Firestore Rules TDD)

## 1. Data Invariants
1. **Authentication & Email Verification**: All reads and writes require `request.auth != null && request.auth.token.email_verified == true`.
2. **Household Membership Gate**: Every document under `/households/{hid}` and all 12 subcollections (`members`, `activity`, `initialCosts`, `checklist`, `items`, `recurring`, `transactions`, `budgets`, `monthClosures`, `goals`, `goalMovements`, `shopping`) is readable and writable ONLY when `request.auth.uid in get(/databases/$(database)/documents/households/$(hid)).data.memberUids`.
3. **Max 2 Members**: `households/{hid}.memberUids` has size 1 on creation (`memberUids == [request.auth.uid]`) and max size 2 (`memberUids.size() <= 2`). `/invites/{inviteCode}` tracks `memberCount` (`1` -> `2`) so a third user cannot bypass the 2-member cap and gets rejected immediately. Joining via `update` can only append the caller's own UID when `existing().memberUids.size() == 1`, validated against `/invites/{inviteCode}`.
4. **No PII Leakage**: `/users/{uid}` is strictly private (`uid == request.auth.uid`). `/invites/{inviteCode}` forbids `list` queries so invite codes cannot be scraped.
5. **Non-Negative Financial Amounts & Valid Budgets**: `initialCosts.amount`, `items.unitPrice`, `recurring.amount`, `transactions.amount`, `goals.targetAmount`, and each `budgets/{monthKey}.limits[cat]` must all be `number >= 0`. Budget `limits` and `households.csvKeywords` keys are restricted to the 13 known `ExpenseCategory` keys. `settings.presetA + settings.presetB == 100` is enforced. `shopping.qty` is bounded between `1` and `999`. Only `goalMovements.amount` (deposits `+` / withdrawals `-`) and `monthClosures.balanceA` may be negative.
6. **Payer Identity Validation**: `initialCosts.paidBy`, `recurring.paidByDefault`, `transactions.paidBy`, and `goalMovements.by` must be either `'cuenta_comun'` or a UID present in the household's `memberUids`.
7. **Immutable Audit, Timestamps & Exact Undo Restore**: `activity` entries cannot be updated or deleted once written (`uid == request.auth.uid`, `timestamp == request.time`). `createdAt` is immutable on update. For `initialCosts` and `transactions` (`create`), `createdAt` must be a timestamp `<= request.time` so Undo (`restoreTransaction` / `restoreInitialCost`) preserves the original `createdAt` without allowing future-dated forgery. On `transactions` (`create`), `createdBy` must equal `request.auth.uid` for private expenses (`isPrivate == true`), or may preserve the original household member's `createdBy` (must be in `memberUids`) when recreating/restoring a shared expense (`isPrivate == false`).
8. **Private Expenses (`isPrivate` + `createdBy`)**: Transactions with `isPrivate == true` are readable (`get`, `list`), updatable, restorable, and deletable ONLY when `createdBy == request.auth.uid`. Client queries on `transactions` MUST filter (`isPrivate == false` or `createdBy == request.auth.uid`) so Firestore `list` rules reject unfiltered queries. Private transactions cannot be settlements (`isSettlement == false`, `category != 'liquidacion'`, `settlementTo == ''`) and `paidBy` must equal `createdBy`. Only `createdBy` can mark their own expense as private.
9. **Shared Shopping List (`shopping/{id}`)**: Readable/writable only by household members, `qty` in `[1, 999]`, `text` `1..120`, `addedBy == request.auth.uid` on create and immutable on update.
10. **Strict Schema Keys**: Every `create` validates `keys().hasAll(...) && keys().hasOnly(...)`; every `update` validates `diff().affectedKeys().hasOnly(...)` per named action.
11. **Seed State Persistence (`seedPending`, `recurringSeedVersion`)**: Optional on `households/{hid}`. `seedPending` must be `bool` and `recurringSeedVersion` must be `int` in `[0, 1000]`. Only existing household members may update `['seedPending', 'recurringSeedVersion', 'updatedAt']` without mixing unrelated fields (`memberUids`, `name`, `inviteCode`, `settings`).
12. **Recurring Anchor (`startMonth`)**: Optional on `recurring/{recId}`. Must be `''` or a valid `YYYY-MM` month key.
13. **Shared Category Colors (`categoryColors`)**: Optional on `households/{hid}`. Restricted to the 13 `ExpenseCategory` keys with `#RRGGBB` hex strings. Only existing household members may update `['categoryColors', 'updatedAt']` without mixing unrelated fields.

## 2. The "Dirty Dozen" + Privacy & Shopping Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated read/write** on `/households/h1` -> Denied (`request.auth == null`).
2. **Unverified email spoofing** (`email_verified: false`) writing `/households/h1` -> Denied.
3. **Non-member read** on `/households/h1/transactions/t1` by UID `intruder` -> Denied (not in `memberUids`).
4. **Third member join attempt** when `memberUids` already has 2 UIDs -> Denied (`memberUids.size() == 1` fails).
5. **Join hijacking**: User B tries to replace `memberUids[0]` or set `name` while joining -> Denied (`affectedKeys().hasOnly(['memberUids', 'updatedAt'])` + `hasAll(existing().memberUids)`).
6. **Invite code scraping**: `list` query on `/invites` -> Denied (`allow list: if false`).
7. **Shadow field injection**: Creating a `Transaction` with extra field `isAdmin: true` -> Denied (`keys().hasOnly(...)`).
8. **Negative transaction amount**: Creating a `Transaction` with `amount: -50` -> Denied (`amount >= 0`).
9. **Future client timestamp forgery**: Creating `InitialCost` or `Transaction` with future `createdAt` (`> request.time`) -> Denied.
10. **Activity tampering**: Updating or deleting `/households/h1/activity/a1` -> Denied (`allow update, delete: if false`).
11. **Activity impersonation**: Creating `/households/h1/activity/a1` with `uid: 'other_uid'` -> Denied (`uid == request.auth.uid`).
12. **Resource poisoning**: Writing `/households/h1/items/{1500_char_id}` or `notes` > 500 chars -> Denied (`isValidId` + `.size()` limits).
13. **Partner private expense read / unfiltered list**: Partner B calls `get` on Partner A's `isPrivate == true` transaction OR runs an unfiltered `collection('transactions').get()` -> Denied.
14. **Private expense hijacking / spoofing**: Partner B tries to create or restore a **private** transaction with `createdBy: uid_alex`, restore a shared transaction with non-member `createdBy: 'intruder'`, flip Partner A's shared transaction to `isPrivate: true`, delete Partner A's private transaction, or mark a private transaction as `paidBy: 'cuenta_comun'` / `isSettlement: true` -> Denied.
15. **Shopping tampering / non-member access**: Non-member reads/writes `/households/h1/shopping/s1`, member mutates `addedBy` on update, or writes invalid `qty: 0` / `qty: 1000` -> Denied.
16. **Household csvKeywords shadow key injection**: Member writes an unknown key inside `csvKeywords` (e.g. `adminNote`) -> Denied.
17. **Household seed state tampering**: Negative/non-int `recurringSeedVersion`, non-bool `seedPending`, non-member updating `seedPending`, or mixing `seedPending` with `memberUids`/`name` -> Denied.
18. **Household categoryColors tampering**: Non-hex value, unknown category key, or non-member updating `categoryColors` -> Denied.
