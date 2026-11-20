// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {P2PEscrow} from "../P2PEscrow.sol";
import {P2PEscrowTestBase} from "./P2PEscrow.Base.t.sol";

contract P2PEscrowDisputeTest is P2PEscrowTestBase {
    uint256 internal adId; // alice sells (maker/seller), bob buys (taker/buyer)

    function setUp() public override {
        super.setUp();
        adId = _sell(alice, 500e6, 1e6, 200e6);
    }

    function _paidOrder(uint128 amount) internal returns (uint256 oid) {
        oid = _open(bob, adId, amount);
        _paid(oid);
    }

    // ---------------------------------------------------------------- openDispute timing & 0 USDC buyer
    function test_OpenDispute_SellerImmediatelyWhenPaid() public {
        uint256 oid = _paidOrder(10e6);
        vm.expectEmit(true, true, false, true, address(esc));
        emit P2PEscrow.OrderDisputed(oid, alice, uint64(block.timestamp));
        vm.prank(alice);
        esc.openDispute(oid);
        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.Disputed));
        assertEq(esc.getOrder(oid).disputedAt, uint64(block.timestamp));
    }

    function test_OpenDispute_BuyerOnlyAfter15Minutes() public {
        uint256 oid = _paidOrder(10e6);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.TooEarly.selector);
        esc.openDispute(oid);
        vm.warp(block.timestamp + 15 minutes - 1);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.TooEarly.selector);
        esc.openDispute(oid);
        vm.warp(block.timestamp + 1);
        vm.prank(bob);
        esc.openDispute(oid);
        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.Disputed));
    }

    function test_OpenDispute_ZeroBalanceBuyerCanOpenAndWinFullEscrow() public {
        address zeroBuyer = makeAddr("zeroBuyer");
        assertEq(_bal(zeroBuyer), 0);

        vm.prank(zeroBuyer);
        uint256 oid = esc.openOrder(adId, 40e6, PRICE, bytes32(0), "");
        vm.prank(zeroBuyer);
        esc.markPaid(oid, bytes32(0));
        vm.warp(block.timestamp + 15 minutes);
        vm.prank(zeroBuyer);
        esc.openDispute(oid);

        _resolve(oid, true, false);
        assertEq(_bal(zeroBuyer), 40e6);
        assertEq(esc.totalDebt(alice), 2e6);
    }

    function test_OpenDispute_Reverts() public {
        uint256 oid = _open(bob, adId, 10e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.InvalidStatus.selector, P2PEscrow.OrderStatus.Pending));
        esc.openDispute(oid);
        _paid(oid);
        vm.prank(stranger);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.openDispute(oid);
        vm.warp(block.timestamp + 1 days);
        vm.prank(stranger);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.openDispute(oid);
        vm.prank(alice);
        esc.openDispute(oid);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.InvalidStatus.selector, P2PEscrow.OrderStatus.Disputed));
        esc.openDispute(oid);
    }

    // ---------------------------------------------------------------- settling during a dispute
    function test_Settle_SellerReleaseInDisputed_NoCompletionNoLossNoBond() public {
        uint256 b0 = _bal(bob);
        uint256 oid = _paidOrder(50e6);
        _disputeBySeller(oid);

        vm.prank(bob);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.release(oid);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.InvalidStatus.selector, P2PEscrow.OrderStatus.Disputed));
        esc.markPaid(oid, bytes32(0));

        vm.expectEmit(true, true, true, true, address(esc));
        emit P2PEscrow.DisputeSettled(oid, alice, bob, 50e6);
        _release(oid);

        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.Settled));
        assertEq(_bal(bob), b0 + 50e6);
        assertEq(esc.getStats(alice).disputesSettled, 1);
        assertEq(esc.getStats(bob).disputesSettled, 0);
        assertEq(esc.getStats(alice).disputesLost, 0);
        assertEq(esc.getStats(alice).ordersCompleted, 0);
        assertEq(esc.getStats(bob).ordersCompleted, 0);
        assertEq(esc.getStats(alice).volume, 0);
        assertEq(esc.totalDebt(alice), 0);
        assertEq(esc.openOrderCount(bob), 0);
        assertEq(esc.partyOpenOrders(alice), 0);
    }

    function test_Settle_BuyerCancelInDisputed_CleanInCoolingOffAndPaysSeller() public {
        uint256 a0 = _bal(alice);
        uint256 oid = _paidOrder(50e6);
        _disputeBySeller(oid);

        vm.expectEmit(true, true, true, true, address(esc));
        emit P2PEscrow.DisputeSettled(oid, bob, alice, 50e6);
        _cancel(bob, oid);

        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.Settled));
        assertEq(_bal(alice), a0 + 50e6);
        assertEq(_strikes(bob), 0);
        assertEq(esc.getStats(bob).concessions, 0);
        assertEq(esc.getStats(bob).disputesSettled, 1);
        assertEq(esc.getStats(bob).disputesLost, 0);
        assertEq(esc.totalDebt(bob), 0);
        assertEq(esc.getAd(adId).available, 450e6);
    }

    // ---------------------------------------------------------------- bond sizes & resolveDispute
    function test_ComputeBond_ExactSizes() public view {
        assertEq(esc.computeBond(10e6), 2e6);
        assertEq(esc.computeBond(40e6), 2e6);
        assertEq(esc.computeBond(60e6), 3e6);
        assertEq(esc.computeBond(100e6), 5e6);
        assertEq(esc.computeBond(500e6), 5e6);
    }

    function test_Resolve_ToBuyer_NoMargin_FullDebtCreated_EscrowNeverReduced() public {
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        uint256 oid = _paidOrder(60e6); // bond = 3e6
        _disputeBySeller(oid);

        vm.expectEmit(true, true, true, true, address(esc));
        emit P2PEscrow.DebtCreated(oid, alice, bob, 3e6);
        vm.expectEmit(true, true, false, true, address(esc));
        emit P2PEscrow.DisputeResolved(oid, true, bob, 60e6);
        _resolve(oid, true, false);

        assertEq(_bal(bob), b0 + 60e6);
        assertEq(_bal(alice), a0);
        assertEq(_bal(address(esc)), 440e6 + FEE);
        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.ResolvedToBuyer));
        assertEq(esc.getStats(alice).disputesLost, 1);
        assertEq(esc.totalDebt(alice), 3e6);
        P2PEscrow.Debt[] memory debts = esc.getDebts(alice);
        assertEq(debts.length, 1);
        assertEq(debts[0].creditor, bob);
        assertEq(debts[0].amount, 3e6);
    }

    function test_Resolve_ToSeller_NoMargin_FullDebtOnBuyer() public {
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        uint256 oid = _paidOrder(60e6); // bond = 3e6
        _disputeBySeller(oid);
        _resolve(oid, false, false);

        assertEq(_bal(alice), a0 + 60e6);
        assertEq(_bal(bob), b0);
        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.ResolvedToSeller));
        assertEq(esc.getStats(bob).disputesLost, 1);
        assertEq(esc.totalDebt(bob), 3e6);
    }

    function test_Resolve_BondFromFreeMargin_FullAndPartial() public {
        // 1) Full bond from free margin (queued withdrawal untouched)
        vm.startPrank(alice);
        esc.depositMargin(20e6);
        esc.requestMarginWithdrawal(15e6); // free = 5e6
        vm.stopPrank();

        uint256 b0 = _bal(bob);
        uint256 oid1 = _paidOrder(60e6); // bond = 3e6
        _disputeBySeller(oid1);
        _resolve(oid1, true, false);

        assertEq(esc.margin(alice), 17e6); // 20 - 3
        (uint128 pend,) = esc.marginWithdrawal(alice);
        assertEq(pend, 15e6); // untouched!
        assertEq(esc.effectiveMargin(alice), 2e6);
        assertEq(esc.totalDebt(alice), 0);
        assertEq(_bal(bob), b0 + 60e6 + 3e6);

        // Lift restriction so carol can open a second order against alice
        vm.prank(arbiter);
        esc.setDisputeWaiver(alice, true);

        // 2) Partial bond from remaining free margin (2e6) + 3e6 recorded as Debt
        uint256 c0 = _bal(carol);
        uint256 oid2 = _open(carol, adId, 100e6); // bond = 5e6
        _paid(oid2);
        _disputeBySeller(oid2);
        _resolve(oid2, true, false);

        assertEq(esc.margin(alice), 15e6); // only free 2e6 taken; queued 15e6 untouched
        assertEq(esc.totalDebt(alice), 3e6);
        assertEq(_bal(carol), c0 + 100e6 + 2e6);
    }

    function test_Resolve_ToBuyer_SlashSeller_AppliesBondThenSlash() public {
        vm.prank(alice);
        esc.depositMargin(150e6);
        uint256 b0 = _bal(bob);
        uint256 oid = _paidOrder(60e6); // bond = 3e6, extra slash = 60e6
        _disputeBySeller(oid);
        vm.expectEmit(true, true, true, true, address(esc));
        emit P2PEscrow.MarginSlashed(oid, alice, bob, 60e6);
        _resolve(oid, true, true);
        assertEq(esc.margin(alice), 150e6 - 3e6 - 60e6);
        assertEq(_bal(bob), b0 + 60e6 + 3e6 + 60e6);
        assertEq(esc.totalDebt(alice), 0);
    }

    function test_Resolve_ToSeller_SlashBuyer() public {
        vm.prank(bob);
        esc.depositMargin(80e6);
        uint256 a0 = _bal(alice);
        uint256 oid = _paidOrder(60e6); // bond = 3e6, slash = 60e6
        _disputeBySeller(oid);
        _resolve(oid, false, true);
        assertEq(esc.margin(bob), 17e6);
        assertEq(_bal(alice), a0 + 60e6 + 3e6 + 60e6);
    }

    function test_Resolve_Slash_CappedByLoserRemainingMargin() public {
        vm.prank(alice);
        esc.depositMargin(30e6);
        uint256 b0 = _bal(bob);
        uint256 oid = _paidOrder(60e6); // bond = 3e6, remaining margin = 27e6 < 60e6
        _disputeBySeller(oid);
        _resolve(oid, true, true);
        assertEq(esc.margin(alice), 0);
        assertEq(_bal(bob), b0 + 60e6 + 30e6);
        assertEq(esc.totalDebt(alice), 0);
    }

    function test_Resolve_Slash_CapsPendingWithdrawal() public {
        vm.startPrank(alice);
        esc.depositMargin(150e6);
        esc.requestMarginWithdrawal(120e6); // free = 30e6
        vm.stopPrank();
        uint256 oid = _paidOrder(100e6); // bond = 5e6 (from free 30 -> margin 145), slash = 100 -> margin 45 < pending 120
        _disputeBySeller(oid);
        _resolve(oid, true, true);
        assertEq(esc.margin(alice), 45e6);
        (uint128 pendingAmt, uint64 unlockAt) = esc.marginWithdrawal(alice);
        assertEq(pendingAmt, 45e6);
        assertGt(unlockAt, 0);
        assertEq(esc.effectiveMargin(alice), 0);
    }

    // ---------------------------------------------------------------- repayDebt & overflow safety
    function test_RepayDebt_FIFO_CappedAtOwed_UnblocksTrading() public {
        // Open 2 orders before any dispute so alice owes bob (2e6) then carol (3e6)
        uint256 oid1 = _open(bob, adId, 40e6);
        uint256 oid2 = _open(carol, adId, 60e6);
        _paid(oid1);
        _paid(oid2);
        _disputeBySeller(oid1);
        _disputeBySeller(oid2);
        _resolve(oid1, true, false); // bob owed 2e6
        _resolve(oid2, true, false); // carol owed 3e6
        assertEq(esc.totalDebt(alice), 5e6);

        // Waive dispute limit so only debt blocks alice
        vm.prank(arbiter);
        esc.setDisputeWaiver(alice, true);

        vm.prank(alice);
        vm.expectRevert(P2PEscrow.DebtOutstanding.selector);
        esc.createAd(SELL, INR, PRICE, 10e6, 1e6, 10e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "d");
        vm.prank(dave);
        vm.expectRevert(P2PEscrow.DebtOutstanding.selector);
        esc.openOrder(adId, 10e6, PRICE, bytes32(0), "x");

        uint256 b0 = _bal(bob);
        uint256 c0 = _bal(carol);
        uint256 a0 = _bal(alice);

        // Partial repay 3e6 -> pays bob 2e6 in full + carol 1e6
        vm.prank(alice);
        esc.repayDebt(3e6);
        assertEq(_bal(bob), b0 + 2e6);
        assertEq(_bal(carol), c0 + 1e6);
        assertEq(esc.totalDebt(alice), 2e6);
        assertEq(esc.getDebts(alice).length, 1);
        assertEq(esc.getDebts(alice)[0].creditor, carol);
        assertEq(esc.getDebts(alice)[0].amount, 2e6);

        // Overpayment attempt (100e6) pulls only remaining 2e6
        vm.prank(alice);
        esc.repayDebt(100e6);
        assertEq(_bal(alice), a0 - 5e6);
        assertEq(_bal(carol), c0 + 3e6);
        assertEq(esc.totalDebt(alice), 0);
        assertEq(esc.getDebts(alice).length, 0);

        // Trading unblocked
        _open(dave, adId, 10e6);
    }

    function test_DebtOverflow_NeverRevertsRuling() public {
        uint256 bigAd = _sell(alice, 500e6, 1e6, 500e6);
        uint256[] memory oids = new uint256[](10);
        address[] memory buyers = new address[](10);
        // Open 10 orders BEFORE any dispute so alice has no debt at openOrder time
        for (uint256 i; i < 9; ++i) {
            buyers[i] = _newFunded();
            oids[i] = _open(buyers[i], bigAd, 10e6);
            _paid(oids[i]);
            _disputeBySeller(oids[i]);
        }
        // 10th order repeats buyers[3] to test merging into existing creditor slot too
        buyers[9] = buyers[3];
        oids[9] = _open(buyers[9], bigAd, 10e6);
        _paid(oids[9]);
        _disputeBySeller(oids[9]);

        for (uint256 i; i < 10; ++i) {
            _resolve(oids[i], true, false);
        }
        assertEq(esc.getDebts(alice).length, esc.MAX_DEBTS_PER_ACCOUNT());
        assertEq(esc.totalDebt(alice), 20e6);
        // 9th distinct creditor merged into debts[0] (2e6 + 2e6 = 4e6), 10th merged into buyers[3] (4e6)
        assertEq(esc.getDebts(alice)[0].amount, 4e6);
        assertEq(esc.getDebts(alice)[3].amount, 4e6);
    }

    // ---------------------------------------------------------------- backup arbiter
    function test_BackupArbiter_BlockedBefore7Days_AllowedAt7Days_NeverParty() public {
        uint256 oid = _paidOrder(20e6);
        _disputeBySeller(oid);
        uint64 dispAt = esc.getOrder(oid).disputedAt;

        vm.prank(backupArbiter);
        vm.expectRevert(P2PEscrow.TooEarly.selector);
        esc.resolveDispute(oid, true, false, true);

        // Also blocked from posting messages before 7 days
        vm.prank(backupArbiter);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.postMessage(oid, "too early");

        vm.warp(uint256(dispAt) + 7 days - 1);
        vm.prank(backupArbiter);
        vm.expectRevert(P2PEscrow.TooEarly.selector);
        esc.resolveDispute(oid, true, false, true);

        // Exactly at 7 days: backupArbiter can post message and resolve
        vm.warp(uint256(dispAt) + 7 days);
        vm.prank(backupArbiter);
        esc.postMessage(oid, "backup ruling");
        vm.prank(backupArbiter);
        esc.resolveDispute(oid, true, false, true);
        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.ResolvedToBuyer));

        // Backup arbiter cannot resolve own trade even after 7 days
        uint256 bakAd = _sell(backupArbiter, 50e6, 1e6, 50e6);
        uint256 oid2 = _open(bob, bakAd, 10e6);
        _paid(oid2);
        _disputeBySeller(oid2);
        vm.warp(block.timestamp + 8 days);
        vm.prank(backupArbiter);
        vm.expectRevert(P2PEscrow.ArbiterIsParty.selector);
        esc.resolveDispute(oid2, false, false, true);
    }

    function test_SamePrimaryAndBackupArbiter_CanResolveImmediately() public {
        vm.prank(owner);
        esc.setBackupArbiter(arbiter);
        uint256 oid = _paidOrder(10e6);
        _disputeBySeller(oid);
        _resolve(oid, true, false);
        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.ResolvedToBuyer));
    }

    // ---------------------------------------------------------------- lost-dispute limits & waiver
    function test_LostDisputeLimit_NewAccountRestrictedAfter1_EstablishedAfter2_PlusWaiver() public {
        // 1) New account (<3 completed): 1 lost dispute restricts even after repaying debt
        uint256 oid1 = _paidOrder(10e6);
        _disputeBySeller(oid1);
        _resolve(oid1, false, false); // bob (<3 completed) loses 1
        vm.prank(bob);
        esc.repayDebt(2e6);
        assertTrue(esc.isDisputeLimitReached(bob));
        assertTrue(esc.getAccount(bob).disputeLimitReached);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.Restricted.selector);
        esc.openOrder(adId, 1e6, PRICE, bytes32(0), "x");

        // Non-admin cannot waive
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.NotAdmin.selector);
        esc.setDisputeWaiver(bob, true);

        // Arbiter waives -> bob can trade again
        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.DisputeWaiverUpdated(bob, true);
        vm.prank(arbiter);
        esc.setDisputeWaiver(bob, true);
        assertFalse(esc.isDisputeLimitReached(bob));
        uint256 oid2 = _open(bob, adId, 10e6);
        _paid(oid2);
        _disputeBySeller(oid2);
        // Losing a new dispute clears the waiver and re-restricts
        _resolve(oid2, false, false);
        vm.prank(bob);
        esc.repayDebt(2e6);
        assertTrue(esc.isDisputeLimitReached(bob));

        // 2) Established account (>= 3 completed): 1 lost dispute OK, 2nd restricts
        _qualifyN(carol, 3);
        assertEq(esc.getStats(carol).ordersCompleted, 3);
        uint256 c1 = _open(carol, adId, 10e6);
        _paid(c1);
        _disputeBySeller(c1);
        _resolve(c1, false, false);
        vm.prank(carol);
        esc.repayDebt(2e6);
        assertFalse(esc.isDisputeLimitReached(carol)); // 1 loss allowed!

        uint256 c2 = _open(carol, adId, 10e6);
        _paid(c2);
        _disputeBySeller(c2);
        _resolve(c2, false, false);
        vm.prank(carol);
        esc.repayDebt(2e6);
        assertTrue(esc.isDisputeLimitReached(carol)); // 2nd loss restricts!
        vm.prank(carol);
        vm.expectRevert(P2PEscrow.Restricted.selector);
        esc.openOrder(adId, 1e6, PRICE, bytes32(0), "x");
    }

    // ---------------------------------------------------------------- auth & existing checks
    function test_Resolve_OnlyArbiterAndStatusGuards() public {
        uint256 oid = _open(bob, adId, 10e6);
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.InvalidStatus.selector, P2PEscrow.OrderStatus.Pending));
        esc.resolveDispute(oid, true, false, true);

        _paid(oid);
        // Paid before 15m wait reverts TooEarly
        vm.prank(arbiter);
        vm.expectRevert(P2PEscrow.TooEarly.selector);
        esc.resolveDispute(oid, true, false, true);

        _disputeBySeller(oid);
        vm.prank(owner);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.resolveDispute(oid, true, false, true);
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.resolveDispute(oid, false, false, true);
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.OrderNotFound.selector, 99));
        esc.resolveDispute(99, true, false, true);
        _resolve(oid, true, false);
        vm.prank(arbiter);
        vm.expectRevert(
            abi.encodeWithSelector(P2PEscrow.InvalidStatus.selector, P2PEscrow.OrderStatus.ResolvedToBuyer)
        );
        esc.resolveDispute(oid, false, false, true);
    }

    function test_Resolve_ArbiterCannotResolveOwnOrder_AsSeller() public {
        uint256 arbAd = _sell(arbiter, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, arbAd, 10e6);
        _paid(oid);
        _disputeBySeller(oid);
        vm.prank(arbiter);
        vm.expectRevert(P2PEscrow.ArbiterIsParty.selector);
        esc.resolveDispute(oid, true, false, true);
        vm.prank(owner);
        esc.setArbiter(carol);
        vm.prank(arbiter);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.resolveDispute(oid, true, false, true);
        vm.prank(carol);
        esc.resolveDispute(oid, true, false, true);
        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.ResolvedToBuyer));
    }

    function test_Resolve_ArbiterCannotResolveOwnOrder_AsBuyer() public {
        uint256 oid = _open(arbiter, adId, 10e6);
        _paid(oid);
        _disputeBySeller(oid);
        vm.prank(arbiter);
        vm.expectRevert(P2PEscrow.ArbiterIsParty.selector);
        esc.resolveDispute(oid, false, false, true);
    }

    function test_RestrictedParty_CanStillFinishExistingOrder() public {
        uint256 oid = _open(bob, adId, 10e6);
        vm.prank(owner);
        esc.setRestricted(bob, true);
        _paid(oid);
        _release(oid);
        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.Completed));
    }

    function test_SetRestricted_OwnerAndArbiter() public {
        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.RestrictionUpdated(bob, true);
        vm.prank(owner);
        esc.setRestricted(bob, true);
        assertTrue(esc.restricted(bob));
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.Restricted.selector);
        esc.openOrder(adId, 1e6, PRICE, bytes32(0), "x");
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.Restricted.selector);
        esc.createAd(SELL, INR, PRICE, 10e6, 1e6, 10e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "d");

        vm.prank(arbiter);
        esc.setRestricted(bob, false);
        assertFalse(esc.restricted(bob));
        _open(bob, adId, 1e6);

        vm.prank(arbiter);
        esc.setRestricted(carol, true);
        assertTrue(esc.restricted(carol));
    }

    function test_SetRestricted_OthersRevert() public {
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.NotAdmin.selector);
        esc.setRestricted(bob, true);
        vm.prank(stranger);
        vm.expectRevert(P2PEscrow.NotAdmin.selector);
        esc.setRestricted(bob, true);
        assertFalse(esc.restricted(bob));
    }

    // ---------------------------------------------------------------- postMessage
    function test_PostMessage_PartiesAndArbiterRules() public {
        uint256 oid = _open(bob, adId, 10e6);
        vm.expectEmit(true, true, false, true, address(esc));
        emit P2PEscrow.OrderMessage(oid, bob, "hello");
        vm.prank(bob);
        esc.postMessage(oid, "hello");
        vm.prank(alice);
        esc.postMessage(oid, "hi");
        vm.prank(arbiter);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.postMessage(oid, "x");
        _paid(oid);
        _disputeBySeller(oid);
        vm.prank(arbiter);
        esc.postMessage(oid, "evidence please");
    }

    function test_PostMessage_LengthAndTerminalLimits() public {
        uint256 oid = _open(bob, adId, 10e6);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.InvalidMessage.selector);
        esc.postMessage(oid, "");
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.InvalidMessage.selector);
        esc.postMessage(oid, string(new bytes(281)));
        vm.prank(bob);
        esc.postMessage(oid, string(_bytes(280)));
        _release(oid);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.InvalidStatus.selector, P2PEscrow.OrderStatus.Completed));
        esc.postMessage(oid, "x");
    }

    function _bytes(uint256 n) internal pure returns (bytes memory b) {
        b = new bytes(n);
        for (uint256 i; i < n; ++i) b[i] = "m";
    }
}
