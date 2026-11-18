# Security Specification — Nido (Firestore Rules TDD)

## 1. Data Invariants
1. **Authentication & Email Verification**: All reads and writes require `request.auth != null && request.auth.token.email_verified == true`.
2. **Household Membership Gate**: Every document under `/households/{hid}` and all 10 subcollections (`members`, `activity`, `initialCosts`, `checklist`, `items`, `recurring`, `transactions`, `budgets`, `monthClosures`, `goals`, `goalMovements`) is readable and writable ONLY when `request.auth.uid in get(/databases/$(database)/documents/households/$(hid)).data.memberUids`.
3. **Max 2 Members**: `households/{hid}.memberUids` has size 1 on creation (`memberUids == [request.auth.uid]`) and max size 2 (`memberUids.size() <= 2`). `/invites/{inviteCode}` tracks `memberCount` (`1` -> `2`) so a third user cannot bypass the 2-member cap and gets rejected immediately. Joining via `update` can only append the caller's own UID when `existing().memberUids.size() == 1`, validated against `/invites/{inviteCode}`.
4. **No PII Leakage**: `/users/{uid}` is strictly private (`uid == request.auth.uid`). `/invites/{inviteCode}` forbids `list` queries so invite codes cannot be scraped.
5. **Non-Negative Financial Amounts & Valid Budgets**: `initialCosts.amount`, `items.unitPrice`, `recurring.amount`, `transactions.amount`, `goals.targetAmount`, and each `budgets/{monthKey}.limits[cat]` must all be `number >= 0`. Budget `limits` keys are restricted to the 13 known `ExpenseCategory` keys. `settings.presetA + settings.presetB == 100` is enforced. Only `goalMovements.amount` (deposits `+` / withdrawals `-`) and `monthClosures.balanceA` may be negative.
6. **Payer Identity Validation**: `initialCosts.paidBy`, `recurring.paidByDefault`, `transactions.paidBy`, and `goalMovements.by` must be either `'cuenta_comun'` or a UID present in the household's `memberUids`.
7. **Immutable Audit & Timestamps**: `activity` entries cannot be updated or deleted once written (`uid == request.auth.uid`, `timestamp == request.time`). `createdAt` is immutable on update and validated against `request.time` on create.
8. **Strict Schema Keys**: Every `create` validates `keys().hasAll(...) && keys().hasOnly(...)`; every `update` validates `diff().affectedKeys().hasOnly(...)` per named action.

## 2. The "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated read/write** on `/households/h1` -> Denied (`request.auth == null`).
2. **Unverified email spoofing** (`email_verified: false`) writing `/households/h1` -> Denied.
3. **Non-member read** on `/households/h1/transactions/t1` by UID `intruder` -> Denied (not in `memberUids`).
4. **Third member join attempt** when `memberUids` already has 2 UIDs -> Denied (`memberUids.size() == 1` fails).
5. **Join hijacking**: User B tries to replace `memberUids[0]` or set `name` while joining -> Denied (`affectedKeys().hasOnly(['memberUids', 'updatedAt'])` + `hasAll(existing().memberUids)`).
6. **Invite code scraping**: `list` query on `/invites` -> Denied (`allow list: if false`).
7. **Shadow field injection**: Creating a `Transaction` with extra field `isAdmin: true` -> Denied (`keys().hasOnly(...)`).
8. **Negative transaction amount**: Creating a `Transaction` with `amount: -50` -> Denied (`amount >= 0`).
9. **Client timestamp forgery**: Creating `InitialCost` with backdated `createdAt` (`!= request.time`) -> Denied.
10. **Activity tampering**: Updating or deleting `/households/h1/activity/a1` -> Denied (`allow update, delete: if false`).
11. **Activity impersonation**: Creating `/households/h1/activity/a1` with `uid: 'other_uid'` -> Denied (`uid == request.auth.uid`).
12. **Resource poisoning**: Writing `/households/h1/items/{1500_char_id}` or `notes` > 500 chars -> Denied (`isValidId` + `.size()` limits).
