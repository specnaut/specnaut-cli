---
description: Run architecture review and all quality checks (format, lint, typecheck, tests) on the implemented feature. Analyses architecture compliance and test coverage gaps first, then runs quality gates.
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

Goal: Ensure the implemented feature follows the project's architecture
patterns, has adequate test coverage, then run all project quality gates. Fix
any issues found and report a clean pass/fail status.

1. **Setup**: Run
   `.specify/scripts/bash/check-prerequisites.sh --json --paths-only` from repo
   root and parse FEATURE_DIR. For single quotes in args like "I'm Groot", use
   escape syntax: e.g 'I'\''m Groot' (or double-quote if possible: "I'm Groot").

2. **Announce**: Display a summary of what will be checked:

   ```text
   🔍 Running Quality Review for [feature name]

   Steps:
   1. Architecture Review
   2. Silent Error Handling Check
   3. ID Exposure Security Check
   4. Cache & Performance Integrity Check
   5. Test Coverage Analysis
   6. Format (Prettier)
   7. Lint (ESLint)
   8. TypeScript Type Check
   9. Tests (Japa)
   ```

3. **Step 1: Architecture Review** — Verify that the feature's code follows the
   project's clean architecture patterns. This step uses static analysis of the
   modified files — no commands to run.

   #### 1.0 — The Boy Scout Rule (Proactive Refactoring)

   Adopt the "Boy Scout Rule" from Robert C. Martin's Clean Code: Always leave the code cleaner than you found it. If you spot minor issues (like hardcoded URLs, explicit permission checks lacking policies, duplicate code) during the review or in adjacent code, **boldly fix them proactively** even if they weren't part of the original task. However, if a problem is too structurally complex to fix quickly, flag it as a ⚠️ WARN and ask the user to create a separate task.

   #### 1.1 — Identify modified files

   Use `git diff --name-only main` (or the spec's `tasks.md` / `plan.md`) to
   list files created or significantly modified as part of this feature. Focus
   on backend files: controllers, services, repositories, validators.

   #### 1.2 — Controller checks (Thin Controller pattern)

   For each controller file (`app/controllers/*_controller.ts`):

   | Rule                     | What to check                                                                                                      | Violation example                                 |
   | :----------------------- | :----------------------------------------------------------------------------------------------------------------- | :------------------------------------------------ |
   | **No Lucid calls**       | Controller must NOT import or call Lucid models directly (`Model.query()`, `Model.create()`, `Model.find()`, etc.) | `await User.create({...})` in controller          |
   | **No business logic**    | No data transformation, computation, or conditional logic beyond simple HTTP flow control                          | String parsing, price calculation in controller   |
   | **Bouncer Policies**     | Authorization and access checks must use Bouncer policies natively rather than manual `if(user.id !== id)` logic.  | `if (user.id !== post.userId) return abort()`     |
   | **DI present**           | `@inject()` decorator on class or methods that need services                                                       | `new UserService()` instead of `@inject()`        |
   | **Delegates to service** | Each action method calls a service, not a repository directly                                                      | Controller calling `this.userRepository.create()` |
   | **HTTP-only concerns**   | Controller only does: validate → delegate → respond (redirect/render/json)                                         | Complex orchestration in controller               |

   #### 1.3 — Service checks (Business Logic layer)

   For each service file (`app/services/*_service.ts`):

   | Rule                              | What to check                                                                                                                                                             | Violation example                                  |
   | :-------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------- |
   | **No HTTP context**               | Must NOT import `HttpContext` or use `request`/`response`/`inertia`                                                                                                       | `import type { HttpContext }` in service           |
   | **No direct Lucid calls**         | Database queries must go through a repository — no `Model.query()`, `Model.create()`, `Model.find()`                                                                      | `await User.findBy('email', email)` in service     |
   | **`@inject()` present**           | Class-level `@inject()` decorator for constructor DI                                                                                                                      | Missing `@inject()` on service class               |
   | **Constructor DI**                | Dependencies injected via constructor, not created manually                                                                                                               | `new ChatRepository()` inside a method             |
   | **Focused methods**               | Each public method does one thing                                                                                                                                         | `registerAndSendEmailAndLogActivity()`             |
   | **No direct NotificationService** | Business services MUST NOT import `NotificationService`. Side effects go through events (Constitution IX). Only listeners and the notifications controller may import it. | `import NotificationService` in a business service |

   > **Note**: Low-level `db` queries (e.g. `db.from('table')`) are acceptable in
   > repositories but should be flagged if found in services. The one exception
   > is `db.transaction()` calls for multi-step operations — these are acceptable
   > in services.

   #### 1.4 — Repository checks (Data Access layer)

   For each repository file (`app/repositories/*_repository.ts`):

   | Rule                  | What to check                                                                 | Violation example                                |
   | :-------------------- | :---------------------------------------------------------------------------- | :----------------------------------------------- |
   | **No business logic** | Repository should only do CRUD, queries, and data access. No decision-making. | If/else business rules inside repository methods |
   | **No HTTP concerns**  | Must NOT import `HttpContext`                                                 | `request.input()` in the repository              |

   #### 1.5 — Cross-cutting checks

   | Rule                       | What to check                                                                                                                   |
   | :------------------------- | :------------------------------------------------------------------------------------------------------------------------------ |
   | **DRY**                    | Is the same logic duplicated across multiple files? (e.g. the same query in two controllers, the same validation in two places) |
   | **YAGNI**                  | Are there unused methods, dead code, or over-engineered abstractions that aren't called anywhere?                               |
   | **Separation of concerns** | Does each file stick to its layer? No layer-skipping (controller → repository without service).                                 |
   | **Subpath imports**        | Uses `#services/...`, `#repositories/...`, `#models/...` — not relative `../` paths                                             |
   | **Native URL Builder**     | Hardcoded URLs must be avoided. Use AdonisJS `router.makeUrl()` or `router.builder().make()` for dynamic backend routing.       |

   #### 1.6 — Silent Error Handling Check

   **Purpose**: Ensure no catch block silently swallows errors. Every catch
   block MUST log the error via `logger.error()` or `logger.warn()` (or
   re-throw). Silent catches hide bugs and make debugging nearly impossible.

   **What to scan**: All files modified as part of this feature (backend AND
   frontend).

   | Pattern                                       | Violation?      | Reason                                                                   |
   | :-------------------------------------------- | :-------------- | :----------------------------------------------------------------------- |
   | `catch {` (bare catch, no error variable)     | **YES -- FAIL** | Error is discarded entirely; cannot log what you don't capture           |
   | `catch (e) { }` or `catch (error) { }`        | **YES -- FAIL** | Empty catch body silently swallows the error                             |
   | `catch (e) { /* comment only */ }`            | **YES -- FAIL** | A comment is not a substitute for logging                                |
   | `catch (e) { /* intentional */ }` without log | **WARN**        | Acceptable only with explicit justification AND a comment explaining why |
   | `catch (e) { logger.error(...) }`             | **PASS**        | Error is properly logged                                                 |
   | `catch (e) { logger.warn(...) }`              | **PASS**        | Warning-level log is acceptable for non-critical paths                   |
   | `catch (e) { throw ... }`                     | **PASS**        | Re-throwing propagates the error to a higher handler                     |
   | `catch (e) { console.error(...) }` (frontend) | **PASS**        | Acceptable in frontend code where `logger` is unavailable                |

   **Report format**:

   ```text
   🔇 Silent Error Handling Check

   | File                    | Line | Pattern                        | Status  |
   |-------------------------|------|--------------------------------|---------|
   | chat_service.ts         | 142  | catch (e) { } — empty body    | ❌ FAIL |
   | feed_repository.ts      | 89   | catch { — bare catch           | ❌ FAIL |
   | notification_service.ts | 203  | catch (e) { logger.error(…) } | ✅ PASS |
   ```

   If there are **FAIL** violations:
   1. List each violation with file, line, and the offending pattern
   2. **Fix them** — add `logger.error()` (or `logger.warn()` with justification)
      and ensure the error variable is captured
   3. Note the fixes in the final report

   #### 1.7 — Architecture report

   Display a pass/fail table per file:

   ```text
   🏗️ Architecture Review

   | File                          | Layer      | Status  | Issues |
   |-------------------------------|------------|---------|--------|
   | chat_controller.ts            | Controller | ✅ PASS | —      |
   | chat_service.ts               | Service    | ⚠️ WARN | db.from() call on line 83 — consider moving to repo |
   | chat_repository.ts            | Repository | ✅ PASS | —      |
   ```

   - **✅ PASS** — No violations found
   - **⚠️ WARN** — Minor violation that's acceptable with justification
     (e.g. `db.transaction()` in a service)
   - **❌ FAIL** — Serious violation that must be fixed (e.g. Lucid call in
     controller, business logic in controller)

   If there are **❌ FAIL** violations:
   1. List each violation with the file, line, and what should change
   2. **Fix them** before proceeding to the next steps
   3. Note the fixes in the final report

   If there are only **⚠️ WARN** or **✅ PASS**, proceed to the next step.

   #### 1.8 — Frontend checks (Feature-Driven & Smart/Dumb)

   For each frontend file created or modified (`inertia/**/*.tsx`, `inertia/**/*.ts`):

   | Rule                       | What to check                                                                                                                                                                                                                        | Violation example                                         |
   | :------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------- |
   | **Feature-Driven Layout**  | New business components MUST go in `inertia/features/<domain>/` or `inertia/pages/`.                                                                                                                                                 | `inertia/components/chat_box.tsx` instead of `features/`. |
   | **Smart vs Dumb**          | UI components MUST NOT use synchronous `fetch()`, Axios, or encapsulate `router.post()` directly if they are meant to be views. Data fetching/navigation logic MUST reside in `inertia/pages/` components or dedicated custom hooks. | `fetch('/api/data')` inside a component.                  |
   | **Client-Side Navigation** | Internal links must use Inertia's `<Link route="route.name">` or `router.visit/post`. NEVER use `window.location.href` or raw strings like `href="/params"`.                                                                         | `window.location.href = '/login'`                         |
   | **Form Management**        | Forms with inputs MUST use Inertia's `useForm` and include `<FieldError name="...">` component to map VineJS errors.                                                                                                                 | Custom `useState` form without `<FieldError>`.            |
   | **Zustand Scope**          | Zustand stores MUST NOT duplicate Server State (DB records/collections). Use only for ephemeral UI/drafts.                                                                                                                           | A Zustand store caching `Post[]` instead of props.        |

   #### 1.9 — Internal ID Exposure Check (Security)

   **Purpose**: Ensure no new feature exposes internal numeric IDs to the
   client. All public-facing entity references MUST use UUIDs.

   **What to check in modified/created files**:

   | Check                            | What to look for                                                          | Violation example                                                |
   | :------------------------------- | :------------------------------------------------------------------------ | :--------------------------------------------------------------- |
   | **Routes with `:id`**            | Route definitions using `:id` param for entity lookup (except pagination) | `router.get('posts/:id', ...)` instead of `posts/:uuid`          |
   | **Frontend URL construction**    | Template literals building URLs with numeric IDs                          | `` `/posts/${post.id}` `` instead of `` `/posts/${post.uuid}` `` |
   | **API responses with `id`**      | JSON responses that include numeric `id` fields for entities              | `{ id: 42, content: "..." }` in response                         |
   | **Query params with numeric ID** | URL query parameters using numeric entity IDs                             | `?conversationId=629` instead of UUID                            |
   | **Fetch/XHR with numeric ID**    | Frontend `fetch()` calls using numeric IDs in URLs                        | `fetch(\`/photos/\${photoId}/like\`)` with numeric photoId       |

   **Exemptions** (NOT violations):
   - Pagination cursors (numeric offsets, not entity IDs)
   - Admin-only routes and responses
   - Internal backend-to-backend communication
   - Join table references (internal, not client-exposed)
   - The `id` field in database schema files (`database/schema.ts`)

   **Report format**:

   ```text
   🔒 Internal ID Exposure Check

   | File                    | Issue                                    | Status  |
   |-------------------------|------------------------------------------|---------|
   | routes.ts               | `/posts/:id` exposes numeric ID          | ❌ FAIL |
   | post_actions.tsx        | fetch(`/posts/${postId}/like`) uses ID   | ❌ FAIL |
   | chat_service.ts         | Response includes `id: conversation.id`  | ⚠️ WARN |
   ```

   - **❌ FAIL** — Route or frontend URL uses numeric ID for an entity that
     has a UUID column. Must be fixed.
   - **⚠️ WARN** — API response includes numeric `id` alongside `uuid`. Flag
     for visibility but acceptable during migration period.
   - **✅ PASS** — No numeric ID exposure found.

   > **Note**: This check applies ONLY to entities that have a `uuid` column
   > in the database. For entities that don't have UUIDs yet, flag them as
   > **⚠️ WARN** with a note recommending UUID addition.

   If there are **❌ FAIL** violations:
   1. List each violation with the file, line, and what should change
   2. **Fix them** before proceeding to the next steps
   3. Note the fixes in the final report

   #### 1.10 — Cache & Performance Integrity Check

   **Purpose**: Verify that any caching or infrastructure integration follows
   the project's architectural principles (Constitution VIII: Infrastructure
   as Injectable Dependencies) and is correctly testable.

   **When to run**: Always run this check. Even features that do not add caching
   may interact with services that use cache. This step ensures no regressions.

   **What to check in modified/created files**:

   | Check                                   | What to look for                                                                                                                                                                                                                                       | Violation example                                                         |
   | :-------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------ |
   | **Static cache import in services**     | Services/middleware MUST NOT `import cache from '@.../services/main'` as a module-level singleton. Cache MUST be injected via constructor DI.                                                                                                          | `import cache from '@adonisjs/cache/services/main'` at top of a service   |
   | **Cache keys are centralized**          | All cache key strings MUST be defined as constants in a dedicated keys file (e.g. `app/cache_keys.ts`) — no magic strings scattered across services.                                                                                                   | `cache.getOrSet({ key: 'my-data' })` with inline string                   |
   | **Graceful degradation**                | Every cache read/write MUST be wrapped in try/catch with a fallback to the direct data source. Cache is a performance optimization, never a correctness dependency.                                                                                    | `await cache.getOrSet(...)` without try/catch and no fallback             |
   | **No raw infra calls for invalidation** | Cache invalidation MUST go through the application's cache API (e.g. `cache.delete()`), never through raw infrastructure commands (`redis-cli DEL`, direct Redis client calls). Raw commands bypass the L1 memory layer in multi-tier setups.          | `redis.del('key')` instead of `cache.delete({ key })`                     |
   | **TTL justification**                   | Cached data MUST have an explicit TTL appropriate to its nature: static reference data (hours/days), user-specific counts (safety TTL), volatile suggestions (minutes). A missing or unreasonable TTL should be flagged.                               | `cache.setForever(...)` on data that can change                           |
   | **Test isolation from cache**           | Unit tests MUST NOT depend on real cache state. If a service uses cache, the test should inject a mock/stub. If tests clear cache keys manually (`cache.delete()` in `setup()`), flag it as ⚠️ WARN — it indicates the cache is not properly injected. | Test that breaks when run after another suite because cache was populated |

   **Report format**:

   ```text
   ⚡ Cache & Performance Integrity Check

   | File                        | Issue                                        | Status  |
   |-----------------------------|----------------------------------------------|---------|
   | currency_service.ts         | Static `import cache from ...`               | ❌ FAIL |
   | inertia_middleware.ts        | Cache getOrSet without try/catch             | ❌ FAIL |
   | notification_service.ts     | Injected cache via constructor               | ✅ PASS |
   | cache_keys.ts               | All keys centralized                         | ✅ PASS |
   | currency_service.spec.ts    | Clears cache manually in setup               | ⚠️ WARN |
   ```

   - **❌ FAIL** — Cache imported as static singleton in a service, or missing
     graceful degradation on a production code path. Must be fixed.
   - **⚠️ WARN** — Test clears cache manually (acceptable workaround, but ideally
     cache should be injected). Or a TTL looks unusual but is justified.
   - **✅ PASS** — Cache properly injected, keys centralized, degradation handled.

   If there are **❌ FAIL** violations:
   1. List each violation with the file, line, and what should change
   2. **Fix them** before proceeding to the next steps
   3. Note the fixes in the final report

4. **Step 2: Test Coverage Analysis** — Analyse the feature's backend code and
   check whether adequate tests exist. This step runs BEFORE the quality gates.

   #### 3.1 — Inventory the feature's backend artifacts

   Scan the following directories for files that were created or significantly
   modified as part of this feature (use the spec's `tasks.md`, `plan.md`, or a
   `git diff --name-only main` to identify them):

   | Layer        | Path pattern                      | Expected test type                    |
   | :----------- | :-------------------------------- | :------------------------------------ |
   | Services     | `app/services/*_service.ts`       | Unit test (required)                  |
   | Repositories | `app/repositories/*_repo*.ts`     | Unit test (recommended)               |
   | Controllers  | `app/controllers/*_controller.ts` | Functional test (if critical path)    |
   | Validators   | `app/validators/*.ts`             | Unit or functional test (recommended) |

   #### 3.2 — Check for existing test files

   For each service discovered in step 3.1, verify that a corresponding unit
   test file exists:

   ```
   app/services/feed_service.ts → tests/unit/services/feed_service.spec.ts
   ```

   Also check for functional and browser tests that exercise the feature's
   routes:

   ```
   tests/functional/<feature>/*.spec.ts
   tests/browser/<feature>/*.spec.ts
   ```

   #### 3.3 — Determine criticality

   A feature is **critical** if its spec, plan, or routes match any of the
   following keywords or patterns. This is a non-exhaustive guide — use your
   judgement:
   - **Authentication**: login, logout, session, signup, registration, password
   - **Authorization**: role, permission, access control, admin, guard
   - **Data integrity**: payment, billing, subscription, delete, migrate
   - **User-facing core flows**: onboarding, profile creation, feed posting

   Critical features SHOULD also have **functional tests** (HTTP endpoint
   assertions) and/or **browser tests** (E2E user flows) beyond just unit tests.

   #### 3.4 — Build the coverage report

   Display a table showing what exists and what's missing:

   ```text
   🧪 Test Coverage Analysis

   | Artifact                  | Test file                                   | Status   |
   |---------------------------|---------------------------------------------|----------|
   | feed_service.ts           | tests/unit/services/feed_service.spec.ts     | ⬜ MISSING |
   | registration_service.ts   | tests/unit/services/registration_service.spec.ts | ✅ EXISTS |
   | feed_controller (routes)  | tests/functional/feed/*.spec.ts              | ⬜ MISSING |

   Criticality: STANDARD | CRITICAL
   ```

   #### 3.5 — Propose and create missing tests

   If there are missing tests:
   1. **Ask the user** before writing any test:

      ```text
      ⚠️ Missing tests detected:
        - Unit test for FeedService (covers getFeed, createPost)
        - Functional test for POST /feed/posts (critical: user-facing mutation)

      Would you like me to create these tests? (Y/n)
      ```

   2. If the user agrees (or does not respond with "n"), **create the tests**
      following the Testing Strategy and Service Creation skills:
      - **Unit tests**: Mock repositories via constructor. Follow the Arrange →
        Act → Assert pattern. Cover at minimum: the happy path for each public
        method, edge cases (null, empty, not found), and error cases.
      - **Functional tests**: Use `client.get()` / `client.post()` with the Japa
        `apiClient` plugin. Assert status codes, redirects, and response shape.
      - **Browser tests**: Only for critical flows. Use Playwright via the
        `visit` helper. Test the full user interaction.

      Refer to the **Testing Strategy** skill
      (`.claude/skills/testing-strategy/SKILL.md`) and the **Service Creation**
      skill (`.claude/skills/service-creation/SKILL.md`) for patterns and rules.

   3. If the user declines, note the missing coverage in the final report but
      continue with the other steps.

5. **Execute quality checks in order** — stop at the first failure and fix it
   before moving on. Each step MUST pass (exit code 0) before proceeding to the
   next.

   // turbo-all

   ### Step 3: Format (Prettier)

   ```bash
   npm run format
   ```

   - If Prettier modified files, note which files changed and re-run to confirm
     they are now clean.
   - If formatting fails, investigate and fix.

   ### Step 4: Lint (ESLint)

   ```bash
   npm run lint
   ```

   - If there are auto-fixable errors, run `npm run lint -- --fix` first, then
     re-check.
   - For remaining errors, fix them manually.

   ### Step 5: TypeScript Type Check

   ```bash
   npm run typecheck
   ```

   - If there are type errors, fix them. Pay attention to:
     - Missing imports
     - Incorrect types on Inertia page props
     - Unused variables/imports

   ### Step 6: Tests (Japa)

   ```bash
   node ace test
   ```

   - If tests fail, investigate and fix.
   - Run individual suites if needed:
     - `node ace test --suite unit` — unit tests only
     - `node ace test --suite functional` — functional tests only
     - `node ace test --suite browser` — browser tests only

6. **Report**: After all steps pass (or after fixing all issues), display a
   summary:

   ```text
   ✅ Quality Review: PASSED

   | Step            | Command            | Status  |
   |-----------------|--------------------|---------|
   | Architecture    | (static analysis)  | ✅ PASS |
   | Silent Errors   | (static analysis)  | ✅ PASS |
   | ID Exposure     | (security check)   | ✅ PASS |
   | Cache & Perf    | (infra check)      | ✅ PASS |
   | Test Coverage   | (analysis)         | ✅ PASS |
   | Format          | npm run format     | ✅ PASS |
   | Lint            | npm run lint       | ✅ PASS |
   | TypeCheck       | npm run typecheck  | ✅ PASS |
   | Tests           | node ace test      | ✅ PASS |

   Feature [name] is ready for commit/merge.
   ```

   If any step required fixes, include a summary of what was fixed:

   ```text
   🔧 Issues Fixed During Review:
   - [file.ts]: Formatting corrected by Prettier
   - [file.tsx]: Unused import removed
   ```

   If tests were created during the review, include a separate section:

   ```text
   🧪 Tests Created During Review:
   - tests/unit/services/feed_service.spec.ts (6 tests)
   - tests/functional/feed/create_post.spec.ts (3 tests)
   ```

   If the user declined test creation, include a warning:

   ```text
   ⚠️ Missing Test Coverage (user declined):
   - Unit test for FeedService
   - Functional test for POST /feed/posts
   ```

7. **Suggest next steps**: After a passing review, suggest committing, pushing,
   and creating a PR. **Always format commands inside fenced code blocks** for
   easy copy:

   ```
   git add -A && git commit -m "feat: [feature description]"
   ```

   ```
   git push origin [branch-name]
   ```
