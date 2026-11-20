# How OnPeer P2P works

OnPeer lets two people trade USDC for local money (rupees, taka and so on) directly with each other. The app never touches the local money. It only holds the USDC, in a smart contract on Arc, until both sides are satisfied. Posting an ad costs a flat **0.05 USDC listing fee** (non-refundable); refreshing ads, opening orders, trading, chatting and filing disputes have **0 platform fee**.

## The two roles

- **Buyer:** pays local money (for example through UPI or bKash) and receives USDC.
- **Seller:** sends the local money's counterpart in USDC to escrow and receives local money.

Every trade starts from an **ad**. Someone posts an ad, someone else opens an **order** against it.

## Ads

There are two kinds:

| Ad type | Who posts it | What they want | USDC pulled on post |
| --- | --- | --- | --- |
| **Sell ad** | A seller | Sell USDC, get local money | Total USDC locked in escrow + 0.05 USDC listing fee |
| **Buy ad** | A buyer (Merchant or 3+ completed trades) | Buy USDC, pay local money | 0.05 USDC listing fee only (escrow locked when seller takes it) |

An ad sets:
- The country and currency (India INR, Pakistan PKR, Bangladesh BDT, Sri Lanka LKR, Nepal NPR, Bhutan BTN, Maldives MVR, Afghanistan AFN).
- The price per USDC, the total amount, and the smallest and largest order.
- Which payment apps are accepted, how long the buyer has to pay, and how long the ad stays live (1 to 168 hours, default 72 hours).
- Optionally, how many completed trades the other person must already have.
- On a sell ad, the details where the buyer should send local money.

The poster can change the price (it only applies to new orders), refresh the expiry timer, pause the ad, or close it. Expired ads disappear from the market and cannot take new orders, but closing a sell ad always returns any USDC that is not tied up in an open order.

On the market page, **Buy USDC** shows sell ads and **Sell USDC** shows buy ads. You always see the other side of the market.

## One trade, step by step

1. **Pick an ad.** Choose your country, payment app and amount. The market shows price, how much USDC is left, limits, the advertiser's trade record and any Merchant badge.
2. **Open the order.** Enter how much you want. The price is fixed for this order. If the advertiser changes the price in the same moment, your order fails instead of going through at a price you did not see.
   - On a **sell ad**, the seller's USDC is already in escrow, so the order reserves part of it.
   - On a **buy ad**, you are the seller, so you type your receiving details and your USDC is locked in escrow right now.
3. **Pay.** The buyer sends local money outside the app before the payment timer ends, strictly from an account in their own name, using the details shown in the order.
4. **Mark as paid.** After paying, the buyer taps **Transferred, Notify Seller**. If the payment timer just expired after the buyer already sent money, the order screen turns red (**"Time expired. Already paid? Mark it as paid now and add your transfer ID."**) so the buyer can submit their transfer ID within the 5-minute onchain recovery window (limited to 2 late marks in 30 days, flagged as paid late to the seller and arbiter).
5. **Release.** The seller checks their bank or app. Only when the full amount has arrived, from the buyer's own account, they tick the confirmation box and tap **Release USDC**. The USDC goes to the buyer and the order is complete.

A seller can release at any time, even before the buyer taps paid or while a dispute is open. A seller can never be forced to release by anyone except the arbiter (or backup arbiter after 7 days) after a dispute.

## When things go wrong

- **The buyer changes their mind.** The buyer can cancel any time before they mark paid. The USDC goes back to the ad (sell ad) or to the seller (buy ad).
- **The buyer never pays.** After both the payment timer and the 5-minute grace window end without a paid mark, anyone can cancel the order. The USDC is returned. Nobody else can cancel before the grace window ends, so a buyer who just paid cannot be cancelled on.
- **The buyer paid but the seller does not release.** The buyer waits 15 minutes after tapping paid, then can open a dispute (even with 0 USDC in their wallet).
- **The seller says no money arrived.** The seller can open a dispute at any time after the buyer taps paid.

### Disputes and dispute bonds

Once an order is **Paid** (or **Disputed**), either the buyer or the seller can file an **offchain dispute** (0 gas, 0 USDC required) with a reason code, statement, and encrypted evidence attachments (up to 1 MB). Filing notifies the counterparty and arbiter by email (if opted in) and adds the case to the arbiter's queue. The onchain `openDispute` button remains available as a fallback if the backend is unreachable. Order chat messages and evidence are stored encrypted offchain (free, 0 gas) and retained for 90 days after the order ends.

- **Direct settlement during a dispute:** Before an arbiter rules, the seller can still **Release USDC** to the buyer, or the buyer can **Cancel** to return USDC to the seller. Settled orders never charge a bond and earn no completion credit or volume:
  - Within **30 minutes** of the dispute opening (before the arbiter takes the case): clean settlement with **no strike, no concession, and no lost-dispute mark**.
  - After the **30-minute cooling-off** (before the arbiter takes the case): counts as **1 concession** for the conceding party (**every 2 concessions count as 1 lost dispute**).
  - After the arbiter calls **Take case** (`reviewStartedAt != 0`): counts as **1 lost dispute** for the conceding party, with **no bond charged**.
- **Arbiter ruling & loser-pays bond:** Each order records a dispute bond reference equal to **5% of the order (minimum 2 USDC, maximum 5 USDC)**. Opening a dispute requires **0 USDC** upfront. When the **arbiter** (or the **backup arbiter** after 7 days) rules from Paid (after 15 minutes) or Disputed:
  - Full escrowed USDC goes to the winner (**Release to buyer** or **Return to seller**) — the escrowed order amount is never reduced.
  - If the arbiter enables **`applyBond`** on the ruling, the loser owes the dispute bond to the winner: it is taken from the loser's free security margin first, and any unpaid remainder becomes a recorded **bond debt** that blocks new ads and orders until repaid (or offset from future margin deposits / claimable payouts). If `applyBond` is off, nobody pays a bond.
  - Optionally, the arbiter can **slash extra margin** from the loser (up to the order amount) to compensate the winner.

The loser gets one lost dispute on their record. Accounts with fewer than 3 completed trades hit the dispute limit after **1 lost dispute**; others after **2 lost disputes** (the owner or arbiter can waive that limit).

## Safety rules built in

- **Open-order cap:** one person can have at most 5 open orders as the person who opened them.
- **Account tiers (per-order cap):**
  - **Starter (0 completed trades):** up to **200 USDC** per order.
  - **Active (1–4 completed trades, or Merchant badge):** up to **500 USDC** per order.
  - **Established (5–19 completed trades and 7+ days account age):** up to **2,000 USDC** per order.
  - **Trusted (20+ completed trades and 14+ days account age):** **uncapped**.
  - **Level-2 KYC uplift:** raises the trade-earned tier by one step. When KYC enforcement (`kycRequired`) is switched on, both advertiser and taker must hold active KYC verification to post ads or open orders (exits and withdrawals are never blocked).
- **Buy-ad requirement:** posting a buy ad requires a **Merchant** badge (100+ USDC margin) or at least **3 completed trades**, plus the 0.05 USDC listing fee.
- **Strikes:** when a buyer who opened a Pending order cancels it (once payment details are ready), or lets the payment + recovery window expire without marking paid, they get a strike. Three strikes in 24 hours start a 24-hour cooldown during which they cannot open new orders or ads. If the buyer is the ad's poster (a buy ad), the ad is paused instead, so nobody can be pushed into a strike by spam orders.
- **Counterparty requirement:** an ad can require a minimum number of completed trades.
- **Trade record:** a trade counts toward someone's record only when completed normally (not during a dispute), is at least 10 USDC, and is with a person they have not counted before.
- **Restrictions & unpaid bond debts:** an unpaid dispute bond, a reached dispute limit, or a manual restriction blocks new ads and orders while keeping existing orders and withdrawals open.
- **Pause switch:** the owner can pause new ads and new orders. Releases, cancels, disputes and withdrawals always keep working.
- **Blocked wallets:** if a USDC payout cannot be delivered (for example the receiving wallet is blocklisted), it is kept as a claimable balance so the other person is never stuck.

## Merchant margin

Anyone can deposit USDC as a security deposit. With **100 USDC or more** of free margin they get a **Merchant** badge, instant Buy-ad access, and at least the 500 USDC per-order tier. A Merchant ad stops accepting orders if free margin falls below 100.

- Withdrawals take **7 days** and are blocked while the account has any open order.
- Unpaid dispute bonds are paid from free margin first (or offset when depositing new margin), and the arbiter can slash extra margin up to the order amount.

## Walkthrough example

Priya in India wants USDC. Sam has 100 USDC and wants rupees. The numbers below are only an illustration.

1. Sam posts a sell ad: 100 USDC, accepts UPI, 30 minutes to pay. His 100 USDC moves to escrow, plus the 0.05 USDC listing fee.
2. Priya opens the market, picks India and UPI, and chooses Sam's ad. She orders 40 USDC. 40 USDC is reserved, and a 30 minute timer starts.
3. Priya sends rupees to Sam's UPI ID from her own account, then taps **I've paid**.
4. Sam sees the rupees arrive, ticks the confirmation and releases. Priya receives 40 USDC. Sam's ad still holds 60 USDC for the next buyer.
5. Both traders' records now show one completed trade.

## What the app cannot do

- **It cannot check local payments.** Whether money arrived is decided by the seller, or by the arbiter in a dispute.
- **Server-side envelope encryption (Mode 2) protects against outsiders, not the operator.** When `sealedEnabled` is on, payment details, chat, and evidence are encrypted with per-record AES-256-GCM keys wrapped by a server-held master key, and only the `keccak256` commitment is written onchain. This blocks public blockchain scraping and raw database leaks, but the operator could technically decrypt stored records (see `/privacy`). True end-to-end browser encryption (`detailsMode 1`) is a future phase.
- **Sandbox KYC only on testnet.** Identity verification currently uses Didit Sandbox ("Test KYC") with synthetic test scenarios; real identity documents require legal review before mainnet launch.
- **It is a testnet demo** on Arc Testnet with test USDC. Check your country's rules on crypto trading before anyone uses it with real money.
