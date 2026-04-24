# SSE with @adonisjs/transmit

📖 **Packages:**

- Server: [`@adonisjs/transmit`](https://github.com/adonisjs/transmit)
- Client:
  [`@adonisjs/transmit-client`](https://github.com/adonisjs/transmit-client)

## Key Concepts

- **Unidirectional:** Server → Client only (not bidirectional like WebSockets)
- **Text only:** No binary data
- **HTTP-based:** Uses standard HTTP, no special protocol
- **Channels:** Group events by topic (e.g., `users/1/notifications`)

## Architecture

```
Server                              Client (React)
──────                              ──────────────
transmit.broadcast(channel, data)   subscription.onMessage(callback)
         ↓                                   ↑
    text/event-stream ──────────────► EventSource API
```

> **Important:** SSE is server→client only. To send data from client→server, use
> standard HTTP requests (`fetch` / `POST` / `PATCH`). The server can then
> broadcast SSE events to other clients based on those requests.

---

## Server Setup

### 1. Install & configure

```bash
node ace add @adonisjs/transmit
```

This creates `config/transmit.ts` and registers the provider.

### 2. Configuration

```typescript
// config/transmit.ts
import { defineConfig } from '@adonisjs/transmit'

export default defineConfig({
  pingInterval: '1m',
})
```

With Redis transport (multi-instance):

```typescript
import env from '#start/env'
import { defineConfig } from '@adonisjs/transmit'
import { redis } from '@adonisjs/transmit/transports'

export default defineConfig({
  pingInterval: '1m',
  transport: {
    driver: redis({
      host: env.get('REDIS_HOST'),
      port: env.get('REDIS_PORT'),
      password: env.get('REDIS_PASSWORD'),
    }),
  },
})
```

### 3. Broadcasting events

```typescript
import transmit from '@adonisjs/transmit/services/main'

// From anywhere: controller, service, event listener, etc.
transmit.broadcast('notifications/global', {
  type: 'info',
  message: 'System maintenance in 30 minutes',
})

// User-specific channel
transmit.broadcast(`users/${user.id}/notifications`, {
  type: 'new_message',
  from: sender.fullName,
  preview: message.content.slice(0, 100),
})
```

#### Payload serialization

Always use `JSON.parse(JSON.stringify(payload))` when the payload contains
dates, Luxon `DateTime`, or other non-plain objects. Transmit expects a plain
JSON-serializable object:

```typescript
// ✅ Safe — plain object
transmit.broadcast('channel', { id: 1, name: 'test', readAt: null })

// ✅ Safe — serialized
const payload = { id: 1, createdAt: message.createdAt.toISO() }
transmit.broadcast('channel', JSON.parse(JSON.stringify(payload)))

// ❌ Dangerous — may contain non-serializable values
transmit.broadcast('channel', lucidModelInstance)
```

### 4. Channel naming

Channel names use `/` as separator, no other special characters:

```typescript
transmit.broadcast('users', { ... })
transmit.broadcast('users/1', { ... })
transmit.broadcast('users/1/posts', { ... })
transmit.broadcast('chat/room-42/messages', { ... })
```

### 5. Channel authorization (private channels)

Create `start/transmit.ts` and add it to `preloads` in `adonisrc.ts`:

```typescript
// start/transmit.ts
import transmit from '@adonisjs/transmit/services/main'
import type { HttpContext } from '@adonisjs/core/http'

// Only the user themselves can subscribe to their notifications
transmit.authorize<{ id: string }>('users/:id/notifications', (ctx: HttpContext, { id }) => {
  return ctx.auth.user?.id === +id
})

// Only members can subscribe to a chat room
transmit.authorize<{ roomId: string }>('chat/:roomId', async (ctx: HttpContext, { roomId }) => {
  const isMember = await ctx.auth.user?.isMemberOf(+roomId)
  return !!isMember
})
```

> **⚠️ Don't forget** to add `start/transmit.ts` to the `preloads` array in
> `adonisrc.ts`.

### 6. Lifecycle events (optional)

```typescript
transmit.on('connect', ({ uid }) => {
  console.log(`Client connected: ${uid}`)
})

transmit.on('disconnect', ({ uid }) => {
  console.log(`Client disconnected: ${uid}`)
})

transmit.on('subscribe', ({ channel, uid }) => {
  console.log(`${uid} subscribed to ${channel}`)
})

transmit.on('unsubscribe', ({ channel, uid }) => {
  console.log(`${uid} unsubscribed from ${channel}`)
})
```

---

## Client Setup (React / Inertia)

### 1. Install

```bash
npm i @adonisjs/transmit-client
```

### 2. Create the singleton and hook

> **⚠️ CRITICAL:** Never create multiple `Transmit` instances. Each instance
> opens its own `EventSource` (SSE) connection. Browsers limit HTTP/1.1 to ~6
> connections per hostname. Multiple instances + multiple tabs = connection
> exhaustion → app becomes unresponsive. See **Pitfall #11** for full details.

First, create a **centralized Transmit singleton module** (e.g.
`lib/transmit_singleton.ts` or `lib/sse.ts`). See Pitfall #11 for the full
visibility-aware implementation.

Then, create a React hook that delegates to the singleton:

```typescript
// hooks/use_transmit.ts
import { useEffect, useRef } from 'react'
import { subscribe } from '@/lib/transmit_singleton'

/**
 * Subscribe to a Transmit channel and auto-cleanup on unmount.
 * Uses the shared visibility-aware singleton — only 1 SSE connection
 * for the entire app, auto-closed when the tab is hidden.
 */
export function useTransmit<T = unknown>(channel: string, onMessage: (data: T) => void) {
  const callbackRef = useRef(onMessage)
  callbackRef.current = onMessage

  useEffect(() => {
    if (!channel) return
    return subscribe(channel, (data) => callbackRef.current(data as T))
  }, [channel])
}
```

### 3. Use in a component

```tsx
// inertia/components/notifications_bell.tsx
import { useState } from 'react'
import { useTransmit } from '@/hooks/use_transmit'

interface Notification {
  type: string
  message: string
}

export function NotificationsBell({ userId }: { userId: number }) {
  const [notifications, setNotifications] = useState<Notification[]>([])

  useTransmit<Notification>(`users/${userId}/notifications`, (data) => {
    setNotifications((prev) => [data, ...prev])
  })

  return (
    <div className="relative">
      {notifications.length > 0 && (
        <span className="absolute -top-1 -right-1 size-4 rounded-full bg-destructive text-xs text-white">
          {notifications.length}
        </span>
      )}
      {/* bell icon */}
    </div>
  )
}
```

### 4. Authenticated streams

The SSE stream itself (`__transmit/events`) uses `EventSource` which cannot send
custom headers. For cookie-based auth (like AdonisJS sessions), it works out of
the box. For token-based auth, use a custom `eventSourceFactory`:

```typescript
import { Transmit } from '@adonisjs/transmit-client'
import { fetchEventSource } from '@microsoft/fetch-event-source'

const transmit = new Transmit({
  baseUrl: window.location.origin,
  eventSourceFactory: (url, options) => {
    const controller = new AbortController()
    const listeners = new Map<string, Set<(event: MessageEvent) => void>>()

    const dispatch = (type: string, data?: string) => {
      const event = new MessageEvent(type, { data })
      listeners.get(type)?.forEach((fn) => fn(event))
    }

    fetchEventSource(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      credentials: options.withCredentials ? 'include' : 'omit',
      signal: controller.signal,
      onopen: () => dispatch('open'),
      onmessage: (msg) => dispatch(msg.event ?? 'message', msg.data),
      onerror: () => dispatch('error'),
    })

    return {
      addEventListener(type: string, fn: (event: MessageEvent) => void) {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type)!.add(fn)
      },
      removeEventListener(type: string, fn: (event: MessageEvent) => void) {
        listeners.get(type)?.delete(fn)
      },
      close() {
        controller.abort()
      },
    } as EventSource
  },
})
```

---

## Common Use Cases

| Use case             | Channel pattern           | Broadcast from        |
| :------------------- | :------------------------ | :-------------------- |
| Global announcements | `announcements`           | Admin action          |
| User notifications   | `users/:id/notifications` | Service / Event       |
| Chat messages        | `chat/:roomId/messages`   | Message controller    |
| Read receipts        | `chat/:roomId/messages`   | markAsRead service    |
| Live feed updates    | `feed/global`             | Post creation event   |
| Real-time stats      | `admin/stats`             | Cron / scheduled task |

---

## ⚠️ Critical Pitfalls & Patterns

### 1. React Strict Mode creates duplicate subscriptions

In development, React Strict Mode mounts → unmounts → remounts every component.
This causes `subscription.create()` to be called, then `subscription.delete()`
(which may fail silently if the subscription is still pending), then
`subscription.create()` again.

**Result:** The client may have 2 active server-side subscriptions for the same
channel, causing every SSE event to fire the handler **twice**.

**Mitigation:** Design your handlers to be **idempotent** — use deduplication by
ID or check for duplicates before adding to state:

```tsx
setMessages((prev) => {
  if (prev.some((m) => m.id === msg.id)) return prev // dedupe
  return [...prev, msg]
})
```

### 2. SSE broadcast vs HTTP response race condition

When a service both broadcasts an SSE event AND returns an HTTP response in the
same request, the **SSE event can arrive at the client BEFORE the HTTP
response**.

This is critical for optimistic updates. Example flow:

```
1. Client sends POST /messages       → creates optimistic msg (tempId)
2. Server creates message            → broadcasts SSE to all subscribers
3. Server returns HTTP response      → client replaces tempId with real msg

BUT: step 2 (SSE) arrives at OTHER clients before step 3 completes.
Those clients may trigger actions (e.g., markAsRead) that broadcast BACK
to the original client. This read_receipt SSE arrives BEFORE step 3,
updating state with readAt. Then step 3 replaces the message with
readAt: null → overwriting the read receipt!
```

**Fix:** When replacing optimistic messages with the server response, **preserve
any state that may have been set by SSE events during the race**:

```tsx
// ❌ BAD — overwrites any SSE-driven state changes
setMessages((prev) => prev.map((m) => (m.id === tempId ? realMessage : m)))

// ✅ GOOD — preserves readAt if a read_receipt SSE already set it
setMessages((prev) =>
  prev.map((m) =>
    m.id === tempId ? { ...realMessage, readAt: m.readAt || realMessage.readAt } : m
  )
)
```

### 3. Multiple components subscribing to the same channel

If two components both use `useTransmit('same-channel', handler)`, you get two
independent subscriptions and handlers. Each SSE event fires both handlers.

**Solutions:**

- **Single subscriber pattern:** Only ONE component subscribes to each channel.
  Other components receive data via props, context, or a shared state store.
- **Server-side props:** For data like unread counts, use Inertia shared props
  (refreshed on each navigation) instead of SSE for secondary consumers.

> **⚠️ Critical:** See also pitfall #10 below — if a module-level subscription
> already exists for a channel, do NOT use `useTransmit` for the same channel.
> The `useTransmit` cleanup will call `subscription.delete()` and destroy the
> shared subscription.

### 4. fire-and-forget HTTP requests from SSE handlers

When an SSE handler triggers an HTTP request (e.g., `markAsRead` on receiving a
message), use fire-and-forget carefully:

```tsx
// ✅ Fire-and-forget for side effects
function sendMarkAsRead(conversationId: number) {
  fetch(`/chat/${conversationId}/read`, {
    method: 'PATCH',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'X-XSRF-TOKEN': getCSRFToken(),
    },
  })
}
```

> **Important:** These requests need the CSRF token. Use
> `X-Requested-With: XMLHttpRequest` and `X-XSRF-TOKEN` from cookies.

### 5. Use a `type` field to multiplex event types on one channel

Instead of creating separate channels, use a `type` discriminator in the payload
to send different event types on the same channel:

```typescript
// Server: broadcast different event types on the same channel
transmit.broadcast(`chat/${roomId}/messages`, {
  id: message.id,
  senderId: sender.id,
  content: message.content,
  // No "type" field → it's a regular message
})

transmit.broadcast(`chat/${roomId}/messages`, {
  type: 'read_receipt',
  messageIds: [1, 2, 3],
  readBy: userId,
  readAt: new Date().toISOString(),
})

transmit.broadcast(`chat/${roomId}/messages`, {
  type: 'typing',
  userId: userId,
})
```

```tsx
// Client: dispatch based on type
useTransmit(`chat/${roomId}/messages`, (data) => {
  if (data.type === 'read_receipt') {
    // Handle read receipt
    return
  }
  if (data.type === 'typing') {
    // Handle typing indicator
    return
  }
  // Default: it's a message (no type field)
  handleNewMessage(data)
})
```

### 6. Implied read receipts from user actions

When a user sends a message, it **implies they have read all previous messages**
from the other person. Use this pattern to avoid requiring a separate "mark as
read" user action:

```typescript
// In sendMessage service method:
async sendMessage(data: SendMessageData) {
  const message = await this.repository.createMessage(...)

  // The sender has read all previous messages by replying
  const readIds = await this.repository.markAsRead(data.conversationId, data.senderId)
  if (readIds.length > 0) {
    transmit.broadcast(`chat/${data.conversationId}/messages`, {
      type: 'read_receipt',
      messageIds: readIds,
      readBy: data.senderId,
      readAt: new Date().toISOString(),
    })
  }

  // Then broadcast the new message
  transmit.broadcast(`chat/${data.conversationId}/messages`, serializedMessage)
  return serializedMessage
}
```

```tsx
// Client: when receiving a message from the other user,
// it proves they have the conversation open → mark our messages as read
setMessages((prev) => {
  if (prev.some((m) => m.id === msg.id)) return prev

  // Mark all our sent messages as read (the other user is active)
  const updated = prev.map((m) =>
    m.senderId === currentUserId && !m.readAt ? { ...m, readAt: new Date().toISOString() } : m
  )

  return [...updated, msg]
})
```

### 7. Stale closures in useCallback SSE handlers

When a `useCallback` captures a reactive value (like `isOnChatPage`) in its
closure, the value is **frozen** at callback creation time. Even if the
component re-renders with a new value, the SSE handler still reads the old one.

Example bug: user navigates from `/chat` to `/feed`, but the SSE handler still
has `isOnChatPage: true` from the original closure:

```tsx
// ❌ BAD — isOnChatPage is stale after navigation
useTransmit(
  channel,
  useCallback(
    (data) => {
      if (!isOnChatPage) incrementCount() // isOnChatPage is FROZEN
    },
    [isOnChatPage]
  )
)

// ✅ GOOD — use a ref to always read the latest value
const isOnChatPageRef = useRef(isOnChatPage)
isOnChatPageRef.current = isOnChatPage

useTransmit(
  channel,
  useCallback((data) => {
    if (!isOnChatPageRef.current) incrementCount() // always fresh
  }, [])
)
```

**Why this happens:** `useTransmit` stores the callback in a `callbackRef`, but
`useCallback` still captures variables from its closure scope. The ref updates
the _function reference_, not the _closed-over variables_ inside it.

### 8. SPA navigation breaks component-level subscriptions

With Inertia.js or React Router, SPA navigations may **unmount and remount**
layout components. When a component hosting `useTransmit` remounts:

1. Cleanup fires → `subscription.delete()` sends unsubscribe to server
2. Re-mount → `subscription.create()` sends subscribe to server
3. Race condition: the unsubscribe from step 1 can arrive AFTER the subscribe
   from step 2, leaving the client with **no active subscription**

**Result:** SSE events work after initial page load but stop after SPA
navigation. User must hard-refresh to get real-time updates back.

**Solution: Module-level subscription pattern.** Move the SSE subscription
outside React's lifecycle entirely. Use `useSyncExternalStore` for React
integration:

```typescript
import { useEffect, useSyncExternalStore } from 'react'
import { subscribe } from '@/lib/transmit_singleton' // your centralized singleton

// ─── Module-level (outside React) ───

let moduleCount = 0
let subscribedUserId: number | null = null
let lastProcessedId: number | null = null
const listeners = new Set<() => void>()

function notifyListeners() {
  listeners.forEach((fn) => fn())
}
function getSnapshot(): number {
  return moduleCount
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function setModuleCount(count: number) {
  if (moduleCount !== count) {
    moduleCount = count
    notifyListeners()
  }
}

function ensureSubscription(userId: number) {
  if (subscribedUserId === userId) return
  subscribedUserId = userId

  subscribe(`users/${userId}/inbox`, (data: any) => {
    if (data.type !== 'new_message') return

    // Deduplicate (Strict Mode fires events twice)
    const msgId = data.message?.id
    if (msgId && msgId === lastProcessedId) return
    lastProcessedId = msgId

    if (!window.location.pathname.startsWith('/chat')) {
      moduleCount += 1
      notifyListeners()
    }
  })
}

// ─── React hook ───
export function useUnreadChatCount(userId: number | undefined, initialCount = 0) {
  useEffect(() => {
    if (userId) ensureSubscription(userId)
  }, [userId])

  useEffect(() => {
    setModuleCount(initialCount)
  }, [initialCount])

  const count = useSyncExternalStore(subscribe, getSnapshot, () => 0)
  return { unreadCount: count }
}
```

**Key benefits:**

- SSE subscription is created **once** and never torn down
- Survives all SPA navigations, component remounts, and Strict Mode
- `useSyncExternalStore` provides reactive updates to React components
- Deduplication by message ID prevents double-counting

### 9. useSyncExternalStore requires getServerSnapshot for SSR

When using `useSyncExternalStore` with SSR (Inertia SSR, Next.js, etc.), you
**must** provide a third argument (`getServerSnapshot`). Without it, server-side
rendering crashes with:

```
Error: Missing getServerSnapshot, which is required for server-rendered content.
```

```tsx
// ❌ BAD — crashes during SSR
useSyncExternalStore(subscribe, getSnapshot)

// ✅ GOOD — returns 0 during SSR (no SSE on server)
useSyncExternalStore(subscribe, getSnapshot, () => 0)
```

The server snapshot should return a safe default (usually `0` or `null`) since
SSE is client-only. The real value is synced from server-side Inertia props via
`useEffect` after hydration.

### 10. Subscription cleanup conflict between useTransmit and module-level subscriptions

When a **module-level** subscription (pitfall #8) manages a channel like
`users/:id/inbox`, and a **component** also uses `useTransmit` for the **same
channel**, the Transmit client returns the same `Subscription` object. When the
component unmounts, `useTransmit`'s cleanup calls `subscription.delete()` which
**destroys the shared subscription** — breaking the module-level listener.

**Symptom:** Real-time updates work initially, then stop after any component
using `useTransmit` on the same channel unmounts or the page navigates.

```tsx
// ❌ BAD — useTransmit cleanup destroys the module-level subscription
// Module-level (e.g., hooks/use_unread_chat_count.ts):
ensureSubscription(userId) // subscribes to users/${id}/inbox

// Page component (e.g., chat/index.tsx):
useTransmit(`users/${userId}/inbox`, handler) // same channel!
// On unmount → subscription.delete() → kills BOTH listeners
```

**Solution: Event dispatch pattern.** The module-level subscription dispatches
events to registered listeners. Components subscribe to events, not to the SSE
channel directly:

```typescript
// In the module-level subscription file (e.g., hooks/use_unread_chat_count.ts)
type InboxEventListener = (data: InboxEvent) => void
const eventListeners = new Set<InboxEventListener>()

export function onInboxEvent(listener: InboxEventListener): () => void {
  eventListeners.add(listener)
  return () => eventListeners.delete(listener)
}

// Inside ensureSubscription's onMessage handler:
subscription.onMessage((data: any) => {
  // 1. Handle unread count (module-level)
  if (!window.location.pathname.startsWith('/chat')) {
    moduleCount += 1
    notifyCountListeners()
  }
  // 2. Dispatch to all registered event listeners
  eventListeners.forEach((fn) => fn(data as InboxEvent))
})

// React hook for components:
export function useInboxEvent(userId: number | undefined, callback: (data: InboxEvent) => void) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (userId) ensureSubscription(userId)
  }, [userId])

  useEffect(() => {
    return onInboxEvent((data) => callbackRef.current(data))
  }, [])
}
```

```tsx
// Page component — no useTransmit, no cleanup conflict
useInboxEvent(user.id, (data) => {
  setConversations((prev) => /* update conversation list */)
})
```

**Key benefits:**

- Single SSE subscription per channel, managed at module level
- Components register/unregister lightweight JS listeners (no SSE lifecycle)
- No `subscription.delete()` conflict
- Works across SPA navigations and React Strict Mode

---

## Debugging SSE Issues

When SSE events don't seem to work, add **temporary** `console.log` at these 3
strategic points to trace the full flow:

```
1. SERVER (controller)  → "Did the HTTP request arrive?"
2. SERVER (service)     → "Did the broadcast fire?"
3. CLIENT (SSE handler) → "Did the SSE event reach the browser?"
```

```typescript
// 1. Controller
console.log('[CONTROLLER] received request, userId:', user.id)

// 2. Service (before broadcast)
console.log('[SERVICE] broadcasting:', channel, payload)

// 3. Client (in useTransmit handler)
console.log('[CLIENT SSE] received:', data)
```

Common diagnostic results:

| Controller | Service Broadcast | Client SSE | Problem                                                                   |
| :--------- | :---------------- | :--------- | :------------------------------------------------------------------------ |
| ❌ No log  | —                 | —          | HTTP request not reaching server (CSRF, auth, wrong URL)                  |
| ✅         | ❌ No broadcast   | —          | No unread items found, or condition skipped                               |
| ✅         | ✅                | ❌ No log  | Client not subscribed (strict mode, wrong channel name)                   |
| ✅         | ✅                | ✅         | SSE works! Issue is in state update logic (race condition, stale closure) |

---

## Rules

1. **Channel names** use `/` separator only — no special characters
2. **Private channels** must be authorized in `start/transmit.ts`
3. **One Transmit instance** on the client — use a singleton or context
4. **Always cleanup** subscriptions on component unmount
5. **Type your payloads** — define interfaces for broadcast data
6. **Idempotent handlers** — SSE events may fire multiple times (Strict Mode)
7. **Preserve optimistic state** — don't overwrite SSE-driven state with HTTP
   responses
8. **Single subscriber per channel** — avoid multiple components subscribing to
   the same channel; use props/context for secondary consumers
9. **Use refs for reactive values** in SSE handlers — never capture changing
   values directly in `useCallback` closures
10. **Module-level subscriptions** for global state (badges, counts) — use
    `useSyncExternalStore` to survive SPA navigations
11. **Always provide getServerSnapshot** when using `useSyncExternalStore` in
    SSR environments (Inertia, Next.js)
12. **Never mix `useTransmit` with module-level subscriptions** on the same
    channel — use the event dispatch pattern instead
13. **GZip exclusion** — exclude `text/event-stream` from compression in reverse
    proxies (Nginx, Traefik)
14. **NEVER create multiple Transmit instances** — each instance opens its own
    `EventSource` connection. Create a centralized singleton module for all SSE
15. **Close SSE on hidden tabs** — use the Page Visibility API to free HTTP slots
    for other tabs (see pitfall #11)

## Checklist

- [ ] `@adonisjs/transmit` installed and configured (`config/transmit.ts`)
- [ ] `start/transmit.ts` created for channel authorization (if private)
- [ ] `start/transmit.ts` added to `preloads` in `adonisrc.ts`
- [ ] **Single Transmit singleton** module (e.g. `lib/transmit_singleton.ts`)
- [ ] **No direct `new Transmit()` calls** anywhere except the singleton module
- [ ] Subscriptions cleaned up on unmount
- [ ] Payload types defined (no `any`)
- [ ] Handlers are idempotent (deduplication by ID)
- [ ] Optimistic updates preserve SSE-driven state on HTTP response
- [ ] Only one component subscribes per channel (no duplicate handlers)
- [ ] SSE handlers use refs for reactive values (no stale closures)
- [ ] Global counters use module-level subscriptions + `useSyncExternalStore`
- [ ] `useSyncExternalStore` has `getServerSnapshot` for SSR
- [ ] Module-level channels use event dispatch for multi-component access
- [ ] No `useTransmit` on channels already managed at module level
- [ ] GZip exclusion configured for `text/event-stream` in production

---

## ⚠️ CRITICAL Pitfall #11: Browser Connection Exhaustion from SSE

### The Problem

Browsers limit HTTP/1.1 connections to **~6 per hostname**. Each `Transmit`
instance opens its own `EventSource` (SSE) connection — a **persistent, long-
lived HTTP connection** that counts toward this limit.

If your app has:

- Multiple hooks/modules creating separate `Transmit` instances
- Multiple tabs open (each with their own JavaScript context)

The connections multiply and quickly exhaust the browser's connection pool:

```
Tab 1: Transmit for notifications (1 SSE) + Transmit for chat (1 SSE) = 2 connections
Tab 2: same = 2 connections
Tab 3: same = 2 connections
Tab 4: same = 2 connections  ← TOTAL: 8 → exceeds 6 limit!

Result: NO new HTTP requests can be sent from this browser.
        The app becomes completely unresponsive.
        Pages hang on "loading..." forever.
```

**Symptoms:**

- App works fine with 1-2 tabs, becomes unresponsive with 3+ tabs
- `AxiosError: Network Error` in the browser console
- **Other browsers still work** (each browser has its own pool)
- The SERVER is healthy — only the affected browser is stuck
- Closing tabs "unstucks" the remaining ones

**This is extremely hard to diagnose** because:

- The server logs show nothing wrong
- Database queries are fine
- The problem looks like a server crash but is browser-only
- It only reproduces with multiple tabs of the SAME browser

### Root Cause

Multiple modules each create their own `Transmit` instance with the same
"singleton" pattern. Since each JS module has its own scope, these are actually
**separate instances**, each opening its own `EventSource`:

```typescript
// ❌ BAD — Module A (e.g., a notification hook) has its own Transmit instance
let transmitInstance: Transmit | null = null
function getTransmit(): Transmit {
  if (!transmitInstance) {
    transmitInstance = new Transmit({ baseUrl: window.location.origin })
  }
  return transmitInstance
}

// ❌ BAD — Module B (e.g., a chat hook) ALSO has its own Transmit instance
let transmitInstance: Transmit | null = null // DIFFERENT module = DIFFERENT variable!
function getTransmit(): Transmit {
  if (!transmitInstance) {
    transmitInstance = new Transmit({ baseUrl: window.location.origin })
  }
  return transmitInstance
}
```

Each `new Transmit()` opens its own `EventSource` = **2 SSE connections per tab**.
With 4 tabs open = 8 connections → exceeds the browser's limit of 6 → deadlock.

### Solution: Centralized Visibility-Aware Singleton

**Step 1: Create a single `transmit_singleton.ts` module**

Place it anywhere accessible to all frontend modules (e.g. `lib/`, `utils/`).
This module:

1. Creates only ONE `Transmit` instance for the entire app
2. **Closes SSE when the tab is hidden** (frees the HTTP slot)
3. **Reconnects when the tab becomes visible again**

```typescript
// lib/transmit_singleton.ts
import { Transmit, type Subscription } from '@adonisjs/transmit-client'

let instance: Transmit | null = null

const pendingChannels = new Map<string, Set<(data: unknown) => void>>()
const activeSubscriptions = new Map<string, Subscription>()

function createInstance(): Transmit {
  return new Transmit({ baseUrl: window.location.origin })
}

function closeInstance() {
  if (instance) {
    instance.close()
    instance = null
    activeSubscriptions.clear()
  }
}

function activatePendingSubscriptions() {
  if (!instance) return
  for (const [channel] of pendingChannels.entries()) {
    if (activeSubscriptions.has(channel)) continue
    const subscription = instance.subscription(channel)
    activeSubscriptions.set(channel, subscription)
    subscription.create().then(() => {
      subscription.onMessage((data) => {
        const cbs = pendingChannels.get(channel)
        if (cbs) cbs.forEach((cb) => cb(data))
      })
    })
  }
}

let visibilitySetup = false
function setupVisibility() {
  if (visibilitySetup || typeof document === 'undefined') return
  visibilitySetup = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      closeInstance() // Free the HTTP slot for other tabs
    } else if (document.visibilityState === 'visible') {
      if (!instance && pendingChannels.size > 0) {
        instance = createInstance()
        activatePendingSubscriptions()
      }
    }
  })
}

export function subscribe(channel: string, callback: (data: unknown) => void): () => void {
  setupVisibility()
  if (!pendingChannels.has(channel)) pendingChannels.set(channel, new Set())
  pendingChannels.get(channel)!.add(callback)

  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    if (!instance) instance = createInstance()
    if (!activeSubscriptions.has(channel)) {
      const subscription = instance.subscription(channel)
      activeSubscriptions.set(channel, subscription)
      subscription.create().then(() => {
        subscription.onMessage((data) => {
          const cbs = pendingChannels.get(channel)
          if (cbs) cbs.forEach((cb) => cb(data))
        })
      })
    }
  }

  return () => {
    const cbs = pendingChannels.get(channel)
    if (cbs) {
      cbs.delete(callback)
      if (cbs.size === 0) {
        pendingChannels.delete(channel)
        const sub = activeSubscriptions.get(channel)
        if (sub) {
          sub.delete()
          activeSubscriptions.delete(channel)
        }
      }
    }
  }
}
```

**Step 2: Update the `useTransmit` hook to use the singleton**

```typescript
// hooks/use_transmit.ts
import { useEffect, useRef } from 'react'
import { subscribe } from '@/lib/transmit_singleton' // your centralized singleton

export function useTransmit<T = unknown>(channel: string, onMessage: (data: T) => void) {
  const callbackRef = useRef(onMessage)
  callbackRef.current = onMessage

  useEffect(() => {
    if (!channel) return
    return subscribe(channel, (data) => callbackRef.current(data as T))
  }, [channel])
}
```

**Step 3: Update ALL other modules** that create their own `Transmit`

Search the codebase for `new Transmit(` — any module that creates its own
instance must be updated to import `subscribe` from the centralized singleton.

### Result

```
After fix:
- Visible tab    = 1 SSE (shared between all channels)
- Hidden tab     = 0 SSE (automatically closed)
- 20 tabs open   = 1 SSE total (only the active tab)
- Unlimited tabs without any connection issues ✅
```

### Prevention

When adding ANY new SSE subscription in the app:

1. **NEVER** import `Transmit` from `@adonisjs/transmit-client` directly in
   hooks or components
2. **ALWAYS** use `subscribe()` from the centralized singleton module
3. **Search** the codebase for `new Transmit(` — there should be exactly ONE
   occurrence (in the singleton module)
