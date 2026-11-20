// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {P2PEscrow} from "../P2PEscrow.sol";
import {P2PEscrowTestBase} from "./P2PEscrow.Base.t.sol";

contract P2PEscrowMarginTest is P2PEscrowTestBase {
    // ---------------------------------------------------------------- taker requirements & tier caps
    function test_MinTakerCompleted_Enforced() public {
        vm.prank(alice);
        uint256 id = esc.createAd(SELL, INR, PRICE, 100e6, 1e6, 100e6, 1, 60, 1, DEFAULT_TTL, 0, bytes32(0), "d");
        assertEq(esc.getAd(id).minTakerCompleted, 1);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.RequirementNotMet.selector);
        esc.openOrder(id, 1e6, PRICE, bytes32(0), "x");
        _qualify(bob);
        assertEq(esc.getStats(bob).ordersCompleted, 1);
        _open(bob, id, 1e6);
    }

    function test_MinTakerCompleted_SmallTradesDoNotQualify() public {
        vm.prank(alice);
        uint256 id = esc.createAd(SELL, INR, PRICE, 100e6, 1e6, 100e6, 1, 60, 1, DEFAULT_TTL, 0, bytes32(0), "d");
        uint256 other = _sell(carol, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, other, 10e6 - 1);
        _paid(oid);
        _release(oid);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.RequirementNotMet.selector);
        esc.openOrder(id, 1e6, PRICE, bytes32(0), "x");
    }

    function test_TierCaps_And_AgeBoundaries() public {
        usdc.mint(alice, 10_000e6);
        uint256 id = _sell(alice, 10_000e6, 1e6, 10_000e6);

        // Tier 0: 0 completed -> 200 USDC
        assertEq(esc.orderCap(bob), 200e6);
        assertEq(esc.getAccount(bob).tier, 0);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.AboveCap.selector);
        esc.openOrder(id, 200e6 + 1, PRICE, bytes32(0), "x");
        uint256 oid0 = _open(bob, id, 200e6);
        _cancel(bob, oid0);

        // Merchant with 0 completed gets Tier 1 (500 USDC)
        _makeMerchant(carol);
        assertEq(esc.orderCap(carol), 500e6);
        assertEq(esc.getAccount(carol).tier, 1);
        vm.prank(carol);
        vm.expectRevert(P2PEscrow.AboveCap.selector);
        esc.openOrder(id, 500e6 + 1, PRICE, bytes32(0), "x");
        _cancel(carol, _open(carol, id, 500e6));

        // Tier 1: 1..4 completed -> 500 USDC
        _qualifyN(bob, 4);
        assertEq(esc.orderCap(bob), 500e6);
        assertEq(esc.getAccount(bob).tier, 1);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.AboveCap.selector);
        esc.openOrder(id, 500e6 + 1, PRICE, bytes32(0), "x");

        // 5 completed, but age < 7 days -> stays Tier 1 (500 USDC)
        _qualifyN(bob, 1);
        assertEq(esc.getStats(bob).ordersCompleted, 5);
        uint64 seen = esc.getStats(bob).firstSeen;
        vm.warp(uint256(seen) + 7 days - 1);
        assertEq(esc.orderCap(bob), 500e6);
        assertEq(esc.getAccount(bob).tier, 1);

        // Exactly at age == 7 days -> Tier 2 (2,000 USDC)
        vm.warp(uint256(seen) + 7 days);
        vm.prank(alice);
        esc.refreshAd(id, 168);
        assertEq(esc.orderCap(bob), 2_000e6);
        assertEq(esc.getAccount(bob).tier, 2);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.AboveCap.selector);
        esc.openOrder(id, 2_000e6 + 1, PRICE, bytes32(0), "x");
        _release(_open(bob, id, 2_000e6));

        // 20 completed, age < 14 days -> still Tier 2 (2,000 USDC)
        _qualifyN(bob, 14); // bob already had 6 completed -> now 20
        assertGe(esc.getStats(bob).ordersCompleted, 20);
        vm.warp(uint256(seen) + 14 days - 1);
        assertEq(esc.orderCap(bob), 2_000e6);
        assertEq(esc.getAccount(bob).tier, 2);

        // Exactly at age == 14 days -> Tier 3 (uncapped)
        vm.warp(uint256(seen) + 14 days);
        vm.prank(alice);
        esc.refreshAd(id, 168);
        assertEq(esc.orderCap(bob), type(uint256).max);
        assertEq(esc.getAccount(bob).tier, 3);
        _release(_open(bob, id, 5_000e6));
    }

    function test_Tier0Cap_BuyAd() public {
        uint256 id = _buy(alice, 1000e6, 1e6, 1000e6);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.AboveCap.selector);
        esc.openOrder(id, 200e6 + 1, PRICE, bytes32(0), "x");
        _open(bob, id, 200e6);
    }

    // ---------------------------------------------------------------- ordersCompleted / volume
    function test_Stats_BelowQualifyMin_VolumeGrowsCompletedDoesNot() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, id, 10e6 - 1);
        assertEq(esc.getStats(alice).ordersCreated, 1);
        assertEq(esc.getStats(bob).ordersCreated, 1);
        _paid(oid);
        _release(oid);
        P2PEscrow.Stats memory sb = esc.getStats(bob);
        assertEq(sb.ordersCompleted, 0);
        assertEq(sb.volume, 10e6 - 1);
        assertEq(esc.getStats(alice).ordersCompleted, 0);
        assertEq(esc.getStats(alice).volume, 10e6 - 1);
    }

    function test_Stats_AtQualifyMin_CountsOncePerPair_VolumeAlwaysGrows() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        uint256 o1 = _open(bob, id, 10e6);
        _release(o1);
        assertEq(esc.getStats(alice).ordersCompleted, 1);
        assertEq(esc.getStats(bob).ordersCompleted, 1);
        assertEq(esc.getStats(bob).volume, 10e6);

        uint256 o2 = _open(bob, id, 25e6);
        _paid(o2);
        _release(o2);
        assertEq(esc.getStats(alice).ordersCompleted, 1);
        assertEq(esc.getStats(bob).ordersCompleted, 1);
        assertEq(esc.getStats(bob).volume, 35e6);
        assertEq(esc.getStats(alice).volume, 35e6);
    }

    function test_Stats_PairIsUnordered_ReverseRolesDoNotRecount() public {
        _makeMerchant(alice);
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        _release(_open(bob, id, 10e6));
        uint256 buyAd = _buy(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, buyAd, 10e6);
        _paid(oid);
        _release(oid);
        assertEq(esc.getStats(alice).ordersCompleted, 1);
        assertEq(esc.getStats(bob).ordersCompleted, 1);
        assertEq(esc.getStats(alice).volume, 20e6);
    }

    function test_Stats_DistinctCounterpartiesEachCount() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        _release(_open(bob, id, 10e6));
        _release(_open(carol, id, 10e6));
        _release(_open(dave, id, 10e6));
        assertEq(esc.getStats(alice).ordersCompleted, 3);
        assertEq(esc.getStats(bob).ordersCompleted, 1);
        assertEq(esc.getStats(carol).ordersCompleted, 1);
        assertEq(esc.getStats(alice).volume, 30e6);
        assertTrue(esc.pairCounted(keccak256(abi.encodePacked(_lo(alice, bob), _hi(alice, bob)))));
    }

    function _lo(address a, address b) internal pure returns (address) {
        return a < b ? a : b;
    }

    function _hi(address a, address b) internal pure returns (address) {
        return a < b ? b : a;
    }

    // ---------------------------------------------------------------- debt auto-offsets & exits
    function test_Debt_OffsetByDepositMargin_And_WithdrawClaimable_And_ExitsNeverBlocked() public {
        // Alice posts 2 sell ads & queues a margin withdrawal before losing a dispute
        vm.startPrank(alice);
        esc.depositMargin(50e6);
        esc.requestMarginWithdrawal(50e6); // free margin = 0
        vm.stopPrank();

        uint256 ad1 = _sell(alice, 200e6, 1e6, 200e6);
        uint256 oidDisputed = _open(bob, ad1, 100e6); // bond = 5e6
        uint256 oidLive = _open(carol, ad1, 20e6);
        _paid(oidDisputed);
        _disputeBySeller(oidDisputed);
        _resolve(oidDisputed, true, false); // alice owes bob 5e6
        assertEq(esc.totalDebt(alice), 5e6);

        // Exits still work while in debt: release existing order, closeAd, completeMarginWithdrawal
        _release(oidLive);
        vm.prank(alice);
        esc.closeAd(ad1);
        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        esc.completeMarginWithdrawal();
        assertEq(esc.margin(alice), 0);

        // 1) depositMargin offsets debt first: deposit 3e6 -> 3e6 to bob, 0 to margin; then 10e6 -> 2e6 to bob, 8e6 to margin
        uint256 b0 = _bal(bob);
        vm.prank(alice);
        esc.depositMargin(3e6);
        assertEq(esc.totalDebt(alice), 2e6);
        assertEq(esc.margin(alice), 0);
        assertEq(_bal(bob), b0 + 3e6);

        vm.prank(alice);
        esc.depositMargin(10e6);
        assertEq(esc.totalDebt(alice), 0);
        assertEq(esc.margin(alice), 8e6);
        assertEq(_bal(bob), b0 + 5e6);

        // 2) withdrawClaimable offsets debt first: give dave claimable 15e6 while blocked, then dave incurs 3e6 debt to alice
        uint256 ad2 = _sell(carol, 200e6, 1e6, 200e6);
        uint256 oidClaim = _open(dave, ad2, 15e6);
        uint256 oidLose = _open(dave, ad2, 60e6); // bond = 3e6
        usdc.setBlocked(dave, true);
        _release(oidClaim);
        assertEq(esc.claimable(dave), 15e6);

        _paid(oidLose);
        _disputeBySeller(oidLose);
        _resolve(oidLose, false, false); // dave owes carol 3e6
        assertEq(esc.totalDebt(dave), 3e6);

        usdc.setBlocked(dave, false);
        uint256 c0 = _bal(carol);
        uint256 d0 = _bal(dave);
        vm.prank(dave);
        esc.withdrawClaimable();
        assertEq(esc.totalDebt(dave), 0);
        assertEq(esc.claimable(dave), 0);
        assertEq(_bal(carol), c0 + 3e6);
        assertEq(_bal(dave), d0 + 12e6);
    }

    // ---------------------------------------------------------------- margin deposit / withdrawal
    function test_DepositMargin() public {
        uint256 a0 = _bal(alice);
        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.MarginDeposited(alice, 60e6);
        vm.prank(alice);
        esc.depositMargin(60e6);
        vm.prank(alice);
        esc.depositMargin(40e6);
        assertEq(esc.margin(alice), 100e6);
        assertEq(_bal(alice), a0 - 100e6);
        assertEq(_bal(address(esc)), 100e6);
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.depositMargin(0);
    }

    function test_RequestMarginWithdrawal_Rules() public {
        vm.startPrank(alice);
        esc.depositMargin(100e6);
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.requestMarginWithdrawal(0);
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.requestMarginWithdrawal(100e6 + 1);
        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.MarginWithdrawalRequested(alice, 40e6, uint64(block.timestamp + 7 days));
        esc.requestMarginWithdrawal(40e6);
        vm.expectRevert(P2PEscrow.WithdrawalPending.selector);
        esc.requestMarginWithdrawal(10e6);
        vm.stopPrank();
        (uint128 amt, uint64 unlockAt) = esc.marginWithdrawal(alice);
        assertEq(amt, 40e6);
        assertEq(unlockAt, uint64(block.timestamp + 7 days));
        assertEq(esc.margin(alice), 100e6);
        assertEq(esc.effectiveMargin(alice), 60e6);
    }

    function test_CompleteMarginWithdrawal_After7Days() public {
        vm.startPrank(alice);
        esc.depositMargin(100e6);
        esc.requestMarginWithdrawal(40e6);
        uint256 a0 = _bal(alice);
        vm.expectRevert(P2PEscrow.TooEarly.selector);
        esc.completeMarginWithdrawal();
        vm.warp(block.timestamp + 7 days - 1);
        vm.expectRevert(P2PEscrow.TooEarly.selector);
        esc.completeMarginWithdrawal();
        vm.warp(block.timestamp + 1);
        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.MarginWithdrawn(alice, 40e6);
        esc.completeMarginWithdrawal();
        vm.stopPrank();
        assertEq(_bal(alice), a0 + 40e6);
        assertEq(esc.margin(alice), 60e6);
        (uint128 amt,) = esc.marginWithdrawal(alice);
        assertEq(amt, 0);
        assertEq(_bal(address(esc)), 60e6);
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.NothingToWithdraw.selector);
        esc.completeMarginWithdrawal();
        vm.prank(alice);
        esc.requestMarginWithdrawal(60e6);
    }

    function test_CancelMarginWithdrawal() public {
        vm.startPrank(alice);
        vm.expectRevert(P2PEscrow.NothingToWithdraw.selector);
        esc.cancelMarginWithdrawal();
        esc.depositMargin(100e6);
        esc.requestMarginWithdrawal(100e6);
        assertEq(esc.effectiveMargin(alice), 0);
        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.MarginWithdrawalCancelled(alice, 100e6);
        esc.cancelMarginWithdrawal();
        vm.stopPrank();
        assertEq(esc.effectiveMargin(alice), 100e6);
        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.NothingToWithdraw.selector);
        esc.completeMarginWithdrawal();
    }

    function test_CompleteMarginWithdrawal_BlockedByOpenOrders_Maker() public {
        vm.startPrank(alice);
        esc.depositMargin(100e6);
        esc.requestMarginWithdrawal(100e6);
        vm.stopPrank();
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, id, 10e6);
        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.OpenOrdersRemain.selector);
        esc.completeMarginWithdrawal();
        _release(oid);
        vm.prank(alice);
        esc.completeMarginWithdrawal();
        assertEq(esc.margin(alice), 0);
    }

    function test_CompleteMarginWithdrawal_BlockedByOpenOrders_ThenAllowed() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        vm.startPrank(bob);
        esc.depositMargin(50e6);
        esc.requestMarginWithdrawal(50e6);
        vm.stopPrank();
        uint256 oid = _open(bob, id, 10e6);
        vm.warp(block.timestamp + 7 days);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.OpenOrdersRemain.selector);
        esc.completeMarginWithdrawal();
        _release(oid);
        uint256 b0 = _bal(bob);
        vm.prank(bob);
        esc.completeMarginWithdrawal();
        assertEq(_bal(bob), b0 + 50e6);
        assertEq(esc.margin(bob), 0);
    }

    function test_CompleteMarginWithdrawal_Seller_PartyOpenBlocks() public {
        uint256 id = _buy(alice, 100e6, 1e6, 100e6);
        vm.prank(bob);
        esc.depositMargin(50e6);
        uint256 oid = _open(bob, id, 10e6);
        vm.prank(bob);
        esc.requestMarginWithdrawal(50e6);
        vm.warp(block.timestamp + 7 days);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.OpenOrdersRemain.selector);
        esc.completeMarginWithdrawal();
        _cancel(bob, oid);
        vm.prank(bob);
        esc.completeMarginWithdrawal();
        assertEq(esc.margin(bob), 0);
    }

    // ---------------------------------------------------------------- merchant
    function test_Merchant_Threshold() public {
        vm.startPrank(alice);
        esc.depositMargin(100e6 - 1);
        assertFalse(esc.isMerchant(alice));
        esc.depositMargin(1);
        assertTrue(esc.isMerchant(alice));
        esc.requestMarginWithdrawal(1);
        assertFalse(esc.isMerchant(alice));
        esc.cancelMarginWithdrawal();
        assertTrue(esc.isMerchant(alice));
        vm.stopPrank();
    }

    function test_Merchant_AdFlagFixedAtCreation() public {
        uint256 plain = _sell(alice, 50e6, 1e6, 50e6);
        vm.prank(alice);
        esc.depositMargin(100e6);
        uint256 merch = _sell(alice, 50e6, 1e6, 50e6);
        assertFalse(esc.getAd(plain).merchantAd);
        assertTrue(esc.getAd(merch).merchantAd);
        uint256 buyMerch = _buy(alice, 50e6, 1e6, 50e6);
        assertTrue(esc.getAd(buyMerch).merchantAd);
    }

    function test_Merchant_MarginTooLow_BlocksOpenOrder() public {
        vm.prank(alice);
        esc.depositMargin(100e6);
        uint256 merch = _sell(alice, 50e6, 1e6, 50e6);
        _open(bob, merch, 1e6);
        vm.prank(alice);
        esc.requestMarginWithdrawal(1e6);
        vm.prank(carol);
        vm.expectRevert(P2PEscrow.MerchantMarginTooLow.selector);
        esc.openOrder(merch, 1e6, PRICE, bytes32(0), "x");
        vm.prank(alice);
        esc.cancelMarginWithdrawal();
        _open(carol, merch, 1e6);
    }

    function test_Merchant_MarginTooLow_AfterBondAndSlash_BuyAd() public {
        vm.prank(alice);
        esc.depositMargin(100e6);
        uint256 merch = _buy(alice, 50e6, 1e6, 50e6);
        uint256 oid = _open(bob, merch, 5e6); // bond = 2e6
        _paid(oid);
        _disputeBySeller(oid);
        _resolve(oid, false, true); // bond 2e6 + slash 5e6 -> margin 93e6 < 100e6
        assertEq(esc.margin(alice), 93e6);
        vm.prank(arbiter);
        esc.setDisputeWaiver(alice, true);
        vm.prank(carol);
        vm.expectRevert(P2PEscrow.MerchantMarginTooLow.selector);
        esc.openOrder(merch, 1e6, PRICE, bytes32(0), "x");
    }

    function test_NonMerchantAd_UnaffectedByLaterMargin() public {
        uint256 plain = _sell(alice, 50e6, 1e6, 50e6);
        vm.prank(alice);
        esc.depositMargin(100e6);
        vm.prank(alice);
        esc.requestMarginWithdrawal(100e6);
        _open(bob, plain, 1e6);
    }

    // ---------------------------------------------------------------- getAccount
    function test_GetAccount_Aggregates() public {
        vm.startPrank(alice);
        esc.depositMargin(150e6);
        esc.requestMarginWithdrawal(50e6);
        vm.stopPrank();
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, id, 20e6);
        vm.prank(owner);
        esc.setRestricted(alice, true);

        P2PEscrow.AccountView memory v = esc.getAccount(alice);
        assertEq(v.ordersCreated, 1);
        assertEq(v.ordersCompleted, 0);
        assertEq(v.disputesLost, 0);
        assertEq(v.volume, 0);
        assertEq(v.margin, 150e6);
        assertEq(v.effectiveMargin, 100e6);
        assertEq(v.pendingWithdrawal, 50e6);
        assertEq(v.withdrawalUnlockAt, uint64(block.timestamp + 7 days));
        assertTrue(v.merchant);
        assertTrue(v.restricted);
        assertEq(v.bannedUntil, 0);
        assertEq(v.strikes, 0);
        assertEq(v.partyOpen, 1);
        assertEq(v.claimable, 0);
        assertEq(v.firstSeen, uint64(T0));
        assertEq(v.totalDebt, 0);
        assertEq(v.orderCap, 500e6);
        assertEq(v.tier, 1);
        assertEq(v.disputesSettled, 0);
        assertFalse(v.disputeLimitReached);

        _cancel(bob, oid);
        P2PEscrow.AccountView memory vb = esc.getAccount(bob);
        assertEq(vb.strikes, 1);
        assertEq(vb.partyOpen, 0);
        assertEq(vb.ordersCreated, 1);
        assertEq(vb.tier, 0);
        assertEq(vb.orderCap, 200e6);
    }

    function test_GetAccount_ClaimableAndBan() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, id, 5e6);
        for (uint256 i; i < 3; ++i) _cancel(bob, _open(bob, id, 1e6));
        usdc.setBlocked(bob, true);
        _release(oid);
        P2PEscrow.AccountView memory v = esc.getAccount(bob);
        assertEq(v.claimable, 5e6);
        assertEq(v.bannedUntil, uint64(T0 + 24 hours));
        assertEq(v.volume, 5e6);
    }

    // ---------------------------------------------------------------- payout deferral
    function test_Payout_Release_BlockedBuyerDefersToClaimable() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, id, 40e6);
        _paid(oid);
        usdc.setBlocked(bob, true);
        uint256 b0 = _bal(bob);

        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.PayoutDeferred(bob, 40e6);
        _release(oid);

        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.Completed));
        assertEq(esc.claimable(bob), 40e6);
        assertEq(_bal(bob), b0);
        assertEq(_bal(address(esc)), 100e6 + FEE);

        vm.prank(bob);
        vm.expectRevert();
        esc.withdrawClaimable();
        assertEq(esc.claimable(bob), 40e6);

        usdc.setBlocked(bob, false);
        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.Withdrawn(bob, 40e6);
        vm.prank(bob);
        esc.withdrawClaimable();
        assertEq(_bal(bob), b0 + 40e6);
        assertEq(esc.claimable(bob), 0);
        assertEq(_bal(address(esc)), 60e6 + FEE);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.NothingToWithdraw.selector);
        esc.withdrawClaimable();
    }

    function test_Payout_TokenReturningFalseDefers() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, id, 40e6);
        usdc.setReturnFalse(bob, true);
        _release(oid);
        assertEq(esc.claimable(bob), 40e6);
        usdc.setReturnFalse(bob, false);
        vm.prank(bob);
        esc.withdrawClaimable();
        assertEq(esc.claimable(bob), 0);
    }

    function test_Payout_CloseAd_BlockedMaker() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        usdc.setBlocked(alice, true);
        vm.prank(alice);
        esc.closeAd(id);
        assertEq(esc.claimable(alice), 100e6);
        usdc.setBlocked(alice, false);
        uint256 a0 = _bal(alice);
        vm.prank(alice);
        esc.withdrawClaimable();
        assertEq(_bal(alice), a0 + 100e6);
    }

    function test_Payout_CancelBuyAd_BlockedSeller() public {
        _qualifyN(alice, 3);
        uint256 id = _buy(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, id, 40e6);
        usdc.setBlocked(bob, true);
        _cancel(alice, oid);
        assertEq(esc.claimable(bob), 40e6);
        assertEq(_bal(address(esc)), 40e6 + FEE);
    }

    function test_Payout_CancelClosedSellAd_BlockedMaker() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, id, 40e6);
        vm.prank(alice);
        esc.closeAd(id);
        usdc.setBlocked(alice, true);
        _cancel(bob, oid);
        assertEq(esc.claimable(alice), 40e6);
    }

    function test_Payout_MarginWithdrawal_Blocked() public {
        vm.startPrank(alice);
        esc.depositMargin(100e6);
        esc.requestMarginWithdrawal(100e6);
        vm.stopPrank();
        vm.warp(block.timestamp + 7 days);
        usdc.setBlocked(alice, true);
        vm.prank(alice);
        esc.completeMarginWithdrawal();
        assertEq(esc.margin(alice), 0);
        assertEq(esc.claimable(alice), 100e6);
    }

    function test_Payout_Resolve_BlockedWinnerGetsAmountBondAndSlashDeferred() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        vm.prank(alice);
        esc.depositMargin(30e6);
        uint256 oid = _open(bob, id, 50e6); // bond = 2.5e6, remaining margin 27.5e6 < 50e6 -> total 30e6
        _paid(oid);
        _disputeBySeller(oid);
        usdc.setBlocked(bob, true);
        _resolve(oid, true, true);
        assertEq(esc.claimable(bob), 80e6);
        assertEq(esc.margin(alice), 0);
        assertEq(_bal(address(esc)), 50e6 + 80e6 + FEE);
    }

    function test_WithdrawClaimable_WorksWhilePausedAndRestricted() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, id, 40e6);
        usdc.setBlocked(bob, true);
        _release(oid);
        usdc.setBlocked(bob, false);
        vm.prank(owner);
        esc.pause();
        vm.prank(owner);
        esc.setRestricted(bob, true);
        uint256 b0 = _bal(bob);
        vm.prank(bob);
        esc.withdrawClaimable();
        assertEq(_bal(bob), b0 + 40e6);
    }

    function test_DepositMargin_WorksWhilePaused() public {
        vm.prank(owner);
        esc.pause();
        vm.prank(alice);
        esc.depositMargin(5e6);
        assertEq(esc.margin(alice), 5e6);
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        esc.createAd(SELL, INR, PRICE, 10e6, 1e6, 10e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "d");
    }
}
