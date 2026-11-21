---
name: circle-onramp
description: Integrate Circle's hosted Onramp widget (App Kit `kit.onramp`, or the standalone `@circle-fin/onramp-kit`) so a user can buy USDC with fiat straight into their own wallet. Use for any "buy USDC", "add funds", "card top-up" or "fiat on-ramp" task. Sandbox first, never production unless the owner says so.
---

# Circle Onramp (hosted buy-USDC widget)

Source of truth: the public docs. Read them before coding, they change.
- https://docs.arc.io/llms.txt (index) and https://docs.arc.io/app-kit/onramp
- https://developers.circle.com/llms.txt
- Always check the latest package version with `npm view @circle-fin/app-kit version`. Do not invent method names.

## What it is
A hosted widget that handles identity checks, payment and delivery. The purchased USDC (or EURC) lands in a wallet address you pass in. There is no wallet adapter and no signing by the user inside our app.

## Two halves, always
1. **Server**: holds the secret Circle API key, mints a short-lived session (30 minutes) for one user and one destination wallet.
2. **Browser**: gets that session from our server and renders the widget (`mountIframe`) or opens it (`openWindow`).

The API key never reaches the browser. Not in `VITE_*` variables, not in the bundle, not in logs.

## Session
Body: `{ appUserId, destinationAddress, assets? }`.
- `destinationAddress` must be the signed-in user's own wallet. Never take it from the request body without checking, never from repo files.
- `appUserId` is our own stable ID for the user (use `wallet:<lowercase address>`). Same value every time for the same user. No emails or phone numbers.
- `assets` only narrows what the widget shows, it does not change eligibility.

## Environments (never mix them)
| | Sandbox | Production |
|---|---|---|
| API key | testnet key (`TEST_API_KEY:...`) | mainnet key (`LIVE_API_KEY:...`) |
| API base URL | `https://api-test.circle.com` | `https://api.circle.com` |
| Widget origin | `https://onramp-sandbox.arc.io` | `https://onramp.arc.io` |

Drive all three from environment variables. A key, API URL and widget origin from different environments fail with `INPUT_INVALID_API_KEY` or `INPUT_WIDGET_URL_ORIGIN_MISMATCH`. Add a startup check that refuses to run if they disagree. Sandbox moves no real money: users enter dummy data only.

## Getting a key
Circle Console, environment toggle on Testnet, App Kits, Onramp Kit (https://console.circle.com/app-kits/onramp), or https://console.circle.com/api-keys. The owner creates it and stores it as a server secret. Never ask for it in chat. For production: Mainnet toggle, a mainnet key and KYB on the same page (about 48 hours, the card payment provider may email questions).

## Payment methods and countries
Per the public docs: debit card, Apple Pay and Google Pay for USDC and EURC on Arc in the US, UK, select EU countries and "other countries worldwide", and only after KYB in production. Bank transfer: select US states and EU countries. Credit cards are not supported. Coverage for any specific country (for example India, Pakistan, Bangladesh) is NOT guaranteed, so test in sandbox and tell the owner the result instead of promising it. The kit does not convert back to fiat.

## `referrerDomain`
Server-side kit option, a bare hostname (for example `app.onpeer.xyz`), equal to the domain registered in KYB. Needed only when the widget is embedded in an iframe on our site and cards are used in production. Set it from trusted config, never from the request body or an Origin header.

## Authorization of the session route
The default route is open. Always add an `authorize` step that:
- requires our signed-in wallet session,
- forces `destinationAddress` to that session's wallet and `appUserId` to `wallet:<address>`,
- rate limits (a few per minute per wallet),
- returns an explicit `true` or `false`.

## Events and confirming a purchase
- Browser events are hints only, sent by `postMessage`, and can be missed or faked. The envelope field is `.event`, not `.type`.
- Sandbox usually fires only `DEPOSIT_SUBMITTED` with `settlementExpected: false`. End the waiting state there.
- Circle sends no webhooks for Onramp Kit sessions. To confirm, read the balance or the transfer onchain (the `DEPOSIT_SETTLED` payload carries a `transactionHash`, which is untrusted input). We credit nothing ourselves, so the safe UI is: show the refreshed wallet balance.

## Iframe or popup
- Popup (`openWindow`) must run synchronously inside a click handler. Mint the session on a first click ("Continue"), open on a second ("Open checkout"). Handle `result.status === 'blocked'`.
- Iframe (`mountIframe`) needs a container with an explicit height and, in production, `referrerDomain`.
- Close the widget (`widget.close()`) before re-mounting. Re-mint once on `onSessionExpired`, never in a loop.

## Content Security Policy
If the app sends a CSP, allow the widget origin in `frame-src` and the widget and API origins in `connect-src` for the current environment. Never loosen CSP to hide a config error.

## Do not
- Put the API key anywhere public, or commit it.
- Skip the environment consistency check.
- Treat a browser event as proof of payment.
- Promise a country or payment method that you did not test.
- Use production keys or real money unless the owner asks explicitly and accepts the risk.
