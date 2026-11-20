// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {P2PEscrow} from "../P2PEscrow.sol";
import {P2PEscrowTestBase} from "./P2PEscrow.Base.t.sol";

contract P2PEscrowFuzzTest is P2PEscrowTestBase {
    function _createSide(address maker, bool sell, uint128 price, uint128 total, uint128 mn, uint128 mx)
        internal
        returns (uint256)
    {
        if (!sell) _qualifyN(maker, 3);
        return _createP(maker, AdP(sell ? SELL : BUY, price, total, mn, mx));
    }

    function testFuzz_BondMath(uint128 amount) public view {
        uint128 b = esc.computeBond(amount);
        assertGe(b, 2e6);
        assertLe(b, 5e6);
        uint256 pct = uint256(amount) * 500 / 10_000;
        uint256 expected = pct > 2e6 ? pct : 2e6;
        if (expected > 5e6) expected = 5e6;
        assertEq(b, expected);
    }

    function testFuzz_TierCaps(uint8 completed, uint32 ageSecs, bool merch) public {
        completed = uint8(bound(completed, 0, 25));
        ageSecs = uint32(bound(ageSecs, 0, 30 days));
        address u = _newFunded();
        if (merch) _makeMerchant(u);
        if (completed > 0) {
            _qualifyN(u, completed);
        } else {
            // touch firstSeen via a tiny cancelled order if testing age with 0 completed
            uint256 tmpAd = _sell(alice, 10e6, 1e6, 10e6);
            _cancel(u, _open(u, tmpAd, 1e6));
        }
        uint64 seen = esc.getStats(u).firstSeen;
        vm.warp(uint256(seen) + ageSecs);

        uint256 expected;
        if (completed >= 20 && ageSecs >= 14 days) expected = type(uint256).max;
        else if (completed >= 5 && ageSecs >= 7 days) expected = 2_000e6;
        else if (completed >= 1 || merch) expected = 500e6;
        else expected = 200e6;

        assertEq(esc.orderCap(u), expected);
    }

    function testFuzz_FiatAmountMath(uint128 price, uint128 amount, bool sell) public {
        price = uint128(bound(price, 1, 1e15));
        amount = uint128(bound(amount, 1, 200e6));
        uint256 id = _createSide(alice, sell, price, amount, 1, amount);
        uint256 oid = _open(bob, id, amount);
        P2PEscrow.Order memory o = esc.getOrder(oid);
        uint256 exact = uint256(amount) * uint256(price);
        assertEq(o.fiatAmountE6, exact / 1e6);
        assertLe(o.fiatAmountE6 * 1e6, exact);
        assertGt((o.fiatAmountE6 + 1) * 1e6, exact);
        assertEq(o.priceE6, price);
        assertEq(o.amount, amount);
    }

    function testFuzz_FiatAmountMonotonicInAmount(uint128 price, uint128 a1, uint128 a2) public {
        price = uint128(bound(price, 1, 1e15));
        a1 = uint128(bound(a1, 1, 100e6));
        a2 = uint128(bound(a2, a1, 100e6));
        uint256 id = _createP(alice, AdP(SELL, price, 200e6, 1, 200e6));
        uint256 o1 = _open(bob, id, a1);
        uint256 o2 = _open(carol, id, a2);
        assertLe(esc.getOrder(o1).fiatAmountE6, esc.getOrder(o2).fiatAmountE6);
    }

    function testFuzz_MinMaxRules(uint128 total, uint128 mn, uint128 mx, uint128 amount, bool sell) public {
        total = uint128(bound(total, 1, 195e6));
        mn = uint128(bound(mn, 1, total));
        mx = uint128(bound(mx, mn, total));
        amount = uint128(bound(amount, 0, uint256(total) + 5));
        uint256 id = _createSide(alice, sell, PRICE, total, mn, mx);
        bool ok = amount != 0 && amount <= total && amount <= mx && (amount >= mn || amount == total);
        vm.prank(bob);
        if (ok) {
            esc.openOrder(id, amount, PRICE, bytes32(0), "x");
            assertEq(esc.getAd(id).available, total - amount);
        } else {
            vm.expectRevert(P2PEscrow.InvalidAmount.selector);
            esc.openOrder(id, amount, PRICE, bytes32(0), "x");
        }
    }

    function testFuzz_PriceMovedBoundary(uint128 price, uint128 limit, bool sell) public {
        price = uint128(bound(price, 1, 1e15));
        uint256 id = _createSide(alice, sell, price, 10e6, 1e6, 10e6);
        bool ok = sell ? price <= limit : price >= limit;
        vm.prank(bob);
        if (!ok) vm.expectRevert(P2PEscrow.PriceMoved.selector);
        esc.openOrder(id, 1e6, limit, bytes32(0), "x");
    }

    function testFuzz_SellRelease_ExactBalances(uint128 total, uint128 amount) public {
        total = uint128(bound(total, 1, 200e6));
        amount = uint128(bound(amount, 1, total));
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        uint256 id = _createP(alice, AdP(SELL, PRICE, total, 1, total));
        uint256 oid = _open(bob, id, amount);
        _paid(oid);
        _release(oid);
        assertEq(_bal(bob), b0 + amount);
        assertEq(_bal(alice), a0 - total - FEE);
        assertEq(_bal(address(esc)), total - amount + FEE);
        assertEq(esc.getAd(id).available, total - amount);
    }

    function testFuzz_BuyRelease_ExactBalances(uint128 total, uint128 amount) public {
        total = uint128(bound(total, 1, 200e6));
        amount = uint128(bound(amount, 1, total));
        _qualifyN(alice, 3);
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        uint256 id = _createP(alice, AdP(BUY, PRICE, total, 1, total));
        uint256 oid = _open(bob, id, amount);
        _release(oid);
        assertEq(_bal(alice), a0 - FEE + amount);
        assertEq(_bal(bob), b0 - amount);
        assertEq(_bal(address(esc)), FEE);
    }

    function testFuzz_Cancel_RestoresInventoryAndFunds(uint128 total, uint128 amount, bool sell) public {
        total = uint128(bound(total, 1, 200e6));
        amount = uint128(bound(amount, 1, total));
        if (!sell) _qualifyN(alice, 3);
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        uint256 id = _createP(alice, AdP(sell ? SELL : BUY, PRICE, total, 1, total));
        uint256 aAfterCreate = _bal(alice);
        uint256 oid = _open(bob, id, amount);
        address canceller = sell ? bob : alice;
        _cancel(canceller, oid);
        assertEq(esc.getAd(id).available, total);
        assertEq(_bal(bob), b0);
        assertEq(_bal(alice), aAfterCreate);
        assertEq(_bal(address(esc)), (sell ? uint256(total) : 0) + FEE);
        assertEq(a0 - aAfterCreate, (sell ? uint256(total) : 0) + FEE);
    }

    function testFuzz_ClosedAd_CancelRefundsExactly(uint128 total, uint128 amount, bool sell) public {
        total = uint128(bound(total, 1, 200e6));
        amount = uint128(bound(amount, 1, total));
        if (!sell) _qualifyN(alice, 3);
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        uint256 id = _createP(alice, AdP(sell ? SELL : BUY, PRICE, total, 1, total));
        uint256 oid = _open(bob, id, amount);
        vm.prank(alice);
        esc.closeAd(id);
        _cancel(sell ? bob : alice, oid);
        assertEq(_bal(alice), a0 - FEE);
        assertEq(_bal(bob), b0);
        assertEq(_bal(address(esc)), FEE);
        assertEq(esc.getAd(id).available, 0);
    }

    function testFuzz_DisputeBondAndSlashMath(uint256 marginAmt, uint128 amount, bool toBuyer) public {
        marginAmt = bound(marginAmt, 0, 1_000e6);
        amount = uint128(bound(amount, 1, 200e6));
        uint256 id = _createP(alice, AdP(SELL, PRICE, amount, 1, amount));
        address loser = toBuyer ? alice : bob;
        address winner = toBuyer ? bob : alice;
        if (marginAmt != 0) {
            vm.prank(loser);
            esc.depositMargin(marginAmt);
        }
        uint256 w0 = _bal(winner);
        uint256 oid = _open(bob, id, amount);
        _paid(oid);
        _disputeBySeller(oid);
        _resolve(oid, toBuyer, true);

        uint256 bond = esc.computeBond(amount);
        uint256 bondFromMargin = marginAmt < bond ? marginAmt : bond;
        uint256 bondDebt = bond - bondFromMargin;
        uint256 remMargin = marginAmt - bondFromMargin;
        uint256 slash = remMargin < amount ? remMargin : amount;

        assertEq(esc.margin(loser), remMargin - slash);
        assertEq(esc.totalDebt(loser), bondDebt);
        assertEq(_bal(winner), w0 + amount + bondFromMargin + slash);
        assertEq(esc.getStats(loser).disputesLost, 1);
        assertEq(esc.getStats(winner).disputesLost, 0);
    }

    function testFuzz_SlashCapsPendingWithdrawal(uint256 marginAmt, uint256 reqAmt, uint128 amount) public {
        marginAmt = bound(marginAmt, 1, 1_000e6);
        reqAmt = bound(reqAmt, 1, marginAmt);
        amount = uint128(bound(amount, 1, 200e6));
        uint256 id = _createP(alice, AdP(SELL, PRICE, amount, 1, amount));
        vm.startPrank(alice);
        esc.depositMargin(marginAmt);
        esc.requestMarginWithdrawal(reqAmt);
        vm.stopPrank();
        uint256 oid = _open(bob, id, amount);
        _paid(oid);
        _disputeBySeller(oid);
        _resolve(oid, true, true);
        (uint128 pend,) = esc.marginWithdrawal(alice);
        uint256 m = esc.margin(alice);
        assertLe(pend, m);
        assertEq(pend, reqAmt < m ? reqAmt : m);
        assertLe(esc.effectiveMargin(alice), m);
    }

    function testFuzz_OrdersCompletedThreshold(uint128 amount) public {
        amount = uint128(bound(amount, 1, 200e6));
        uint256 id = _createP(alice, AdP(SELL, PRICE, amount, 1, amount));
        _release(_open(bob, id, amount));
        uint32 expected = amount >= 10e6 ? 1 : 0;
        assertEq(esc.getStats(bob).ordersCompleted, expected);
        assertEq(esc.getStats(alice).ordersCompleted, expected);
        assertEq(esc.getStats(bob).volume, amount);
        assertEq(esc.getStats(alice).volume, amount);
    }

    function testFuzz_StrikeWindow(uint256 dt) public {
        dt = bound(dt, 0, 3 days);
        uint256 id = _createP(alice, AdP(SELL, PRICE, 100e6, 1e6, 100e6));
        vm.prank(alice);
        esc.refreshAd(id, 168);
        _cancel(bob, _open(bob, id, 1e6));
        _cancel(bob, _open(bob, id, 1e6));
        vm.warp(block.timestamp + dt);
        _cancel(bob, _open(bob, id, 1e6));
        if (dt <= 24 hours) {
            assertGt(_bannedUntil(bob), 0);
            assertEq(_strikes(bob), 0);
        } else {
            assertEq(_bannedUntil(bob), 0);
            assertEq(_strikes(bob), 1);
        }
    }

    function testFuzz_BuyerDisputeTiming(uint256 dt) public {
        dt = bound(dt, 0, 1 hours);
        uint256 id = _createP(alice, AdP(SELL, PRICE, 100e6, 1e6, 100e6));
        uint256 oid = _open(bob, id, 1e6);
        _paid(oid);
        vm.warp(block.timestamp + dt);
        vm.prank(bob);
        if (dt < 15 minutes) vm.expectRevert(P2PEscrow.TooEarly.selector);
        esc.openDispute(oid);
    }

    function testFuzz_MarkPaidDeadlineAndGrace(uint256 dt) public {
        dt = bound(dt, 0, 2 hours);
        uint256 id = _createP(alice, AdP(SELL, PRICE, 100e6, 1e6, 100e6)); // 60 min window + 5 min grace
        uint256 oid = _open(bob, id, 1e6);
        vm.warp(block.timestamp + dt);
        bytes32 proof = dt > 60 minutes ? keccak256("fuzz-tx") : bytes32(0);
        vm.prank(bob);
        if (dt > 65 minutes) {
            vm.expectRevert(P2PEscrow.DeadlinePassed.selector);
            esc.markPaid(oid, proof);
        } else {
            esc.markPaid(oid, proof);
            assertEq(esc.getOrder(oid).paidLate, dt > 60 minutes);
        }
    }

    function testFuzz_MarginWithdrawalDelay(uint256 dt, uint256 amt) public {
        amt = bound(amt, 1, 500e6);
        dt = bound(dt, 0, 14 days);
        vm.startPrank(alice);
        esc.depositMargin(500e6);
        esc.requestMarginWithdrawal(amt);
        vm.warp(block.timestamp + dt);
        uint256 a0 = _bal(alice);
        if (dt < 7 days) vm.expectRevert(P2PEscrow.TooEarly.selector);
        esc.completeMarginWithdrawal();
        vm.stopPrank();
        if (dt >= 7 days) {
            assertEq(_bal(alice), a0 + amt);
            assertEq(esc.margin(alice), 500e6 - amt);
        }
    }

    function testFuzz_MessageLength(uint256 len) public {
        len = bound(len, 0, 400);
        uint256 id = _createP(alice, AdP(SELL, PRICE, 100e6, 1e6, 100e6));
        uint256 oid = _open(bob, id, 1e6);
        bytes memory b = new bytes(len);
        for (uint256 i; i < len; ++i) b[i] = "x";
        vm.prank(bob);
        if (len == 0 || len > 280) vm.expectRevert(P2PEscrow.InvalidMessage.selector);
        esc.postMessage(oid, string(b));
    }
}
