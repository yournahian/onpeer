// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {P2PEscrow} from "../P2PEscrow.sol";
import {P2PEscrowTestBase} from "./P2PEscrow.Base.t.sol";

contract P2PEscrowMarginTest is P2PEscrowTestBase {
    // ---------------------------------------------------------------- taker requirements
    function test_MinTakerCompleted_Enforced() public {
        vm.prank(alice);
        uint256 id = esc.createAd(SELL, INR, PRICE, 100e6, 1e6, 100e6, 1, 60, 1, "d");
        assertEq(esc.getAd(id).minTakerCompleted, 1);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.RequirementNotMet.selector);
        esc.openOrder(id, 1e6, PRICE, "x");
        _qualify(bob);
        assertEq(esc.getStats(bob).ordersCompleted, 1);
        _open(bob, id, 1e6);
    }

    function test_MinTakerCompleted_SmallTradesDoNotQualify() public {
        vm.prank(alice);
        uint256 id = esc.createAd(SELL, INR, PRICE, 100e6, 1e6, 100e6, 1, 60, 1, "d");
        uint256 other = _sell(carol, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, other, 10e6 - 1);
        _paid(oid);
        _release(oid);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.RequirementNotMet.selector);
        esc.openOrder(id, 1e6, PRICE, "x");
    }

    function test_NewTakerMax_200Usdc_SellAd() public {
        uint256 id = _sell(alice, 1000e6, 1e6, 1000e6);
        assertEq(esc.NEW_TAKER_MAX(), 200e6);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.NewUserLimit.selector);
        esc.openOrder(id, 200e6 + 1, PRICE, "x");
        uint256 oid = _open(bob, id, 200e6); // exactly the cap is fine
        _cancel(bob, oid);
        _qualify(bob);
        _open(bob, id, 300e6); // experienced taker is uncapped
    }

    function test_NewTakerMax_200Usdc_BuyAd() public {
        uint256 id = _buy(alice, 1000e6, 1e6, 1000e6);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.NewUserLimit.selector);
        esc.openOrder(id, 200e6 + 1, PRICE, "x");
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

        uint256 o2 = _open(bob, id, 25e6); // same pair again
        _paid(o2);
        _release(o2);
        assertEq(esc.getStats(alice).ordersCompleted, 1);
        assertEq(esc.getStats(bob).ordersCompleted, 1);
        assertEq(esc.getStats(bob).volume, 35e6);
        assertEq(esc.getStats(alice).volume, 35e6);
    }

    function test_Stats_PairIsUnordered_ReverseRolesDoNotRecount() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        _release(_open(bob, id, 10e6)); // alice sells to bob
        uint256 buyAd = _buy(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, buyAd, 10e6); // bob sells to alice
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
        assertEq(esc.margin(alice), 100e6); // still held (and slashable) until completed
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
        // a new request can be made after completion
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
        uint256 oid = _open(bob, id, 10e6); // bob is the buyer party
        vm.warp(block.timestamp + 7 days - 1 hours); // order still pending, deadline not passed? 60min window
        vm.warp(block.timestamp + 1 hours);
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
        uint256 oid = _open(bob, id, 10e6); // bob is seller party
        vm.prank(bob);
        esc.requestMarginWithdrawal(50e6);
        vm.warp(block.timestamp + 7 days);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.OpenOrdersRemain.selector);
        esc.completeMarginWithdrawal();
        _cancel(bob, oid); // after deadline anyone can cancel
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
        esc.requestMarginWithdrawal(1); // queued margin no longer counts
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
        esc.openOrder(merch, 1e6, PRICE, "x");
        vm.prank(alice);
        esc.cancelMarginWithdrawal();
        _open(carol, merch, 1e6); // re-funded
    }

    function test_Merchant_MarginTooLow_AfterSlash_BuyAd() public {
        vm.prank(alice);
        esc.depositMargin(100e6);
        uint256 merch = _buy(alice, 50e6, 1e6, 50e6);
        uint256 oid = _open(bob, merch, 5e6);
        _paid(oid);
        _disputeBySeller(oid); // seller bob disputes
        _resolve(oid, false, false);
        // arbiter ruled for seller: alice (buyer) lost; with slash she'd drop below threshold
        uint256 oid2 = _open(bob, merch, 5e6);
        _paid(oid2);
        _disputeBySeller(oid2);
        _resolve(oid2, false, true);
        assertEq(esc.margin(alice), 95e6);
        vm.prank(carol);
        vm.expectRevert(P2PEscrow.MerchantMarginTooLow.selector);
        esc.openOrder(merch, 1e6, PRICE, "x");
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

        _cancel(bob, oid);
        P2PEscrow.AccountView memory vb = esc.getAccount(bob);
        assertEq(vb.strikes, 1);
        assertEq(vb.partyOpen, 0);
        assertEq(vb.ordersCreated, 1);
        assertFalse(vb.merchant);
        assertFalse(vb.restricted);
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
        assertEq(_bal(address(esc)), 100e6); // 60 inventory + 40 claimable

        vm.prank(bob);
        vm.expectRevert(); // token still refuses; claim stays intact
        esc.withdrawClaimable();
        assertEq(esc.claimable(bob), 40e6);

        usdc.setBlocked(bob, false);
        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.Withdrawn(bob, 40e6);
        vm.prank(bob);
        esc.withdrawClaimable();
        assertEq(_bal(bob), b0 + 40e6);
        assertEq(esc.claimable(bob), 0);
        assertEq(_bal(address(esc)), 60e6);
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
        uint256 id = _buy(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, id, 40e6);
        usdc.setBlocked(bob, true);
        _cancel(alice, oid);
        assertEq(esc.claimable(bob), 40e6);
        assertEq(_bal(address(esc)), 40e6);
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

    function test_Payout_Resolve_BlockedWinnerGetsAmountAndSlashDeferred() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        vm.prank(alice);
        esc.depositMargin(30e6);
        uint256 oid = _open(bob, id, 50e6);
        _paid(oid);
        _disputeBySeller(oid);
        usdc.setBlocked(bob, true);
        _resolve(oid, true, true);
        assertEq(esc.claimable(bob), 80e6); // 50 escrow + 30 slashed margin
        assertEq(esc.margin(alice), 0);
        assertEq(_bal(address(esc)), 50e6 + 80e6); // remaining inventory + claimable
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
        esc.createAd(SELL, INR, PRICE, 10e6, 1e6, 10e6, 1, 60, 0, "d");
    }
}
