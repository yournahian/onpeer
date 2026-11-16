// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {P2PEscrow} from "../P2PEscrow.sol";
import {P2PEscrowTestBase} from "./P2PEscrow.Base.t.sol";

contract P2PEscrowCancelTest is P2PEscrowTestBase {
    // ---------------------------------------------------------------- cancel rules (sell ad)
    function test_Cancel_BuyerAnytimeWhilePending_RestoresInventory() public {
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        uint256 adId = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, adId, 40e6);
        assertEq(esc.getAd(adId).available, 60e6);

        vm.expectEmit(true, true, false, true, address(esc));
        emit P2PEscrow.OrderCancelled(oid, bob);
        _cancel(bob, oid);

        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.Cancelled));
        assertEq(esc.getAd(adId).available, 100e6);
        assertEq(_bal(address(esc)), 100e6); // stays escrowed as inventory
        assertEq(_bal(alice), a0 - 100e6);
        assertEq(_bal(bob), b0);
        assertEq(esc.openOrderCount(bob), 0);
        assertEq(esc.partyOpenOrders(alice), 0);
        assertEq(esc.partyOpenOrders(bob), 0);
        assertEq(_strikes(bob), 1);
        assertFalse(esc.getAd(adId).paused);
    }

    function test_Cancel_SellerCannotBeforeDeadline_NorStranger() public {
        uint256 adId = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, adId, 40e6);
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.cancelOrder(oid);
        vm.prank(stranger);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.cancelOrder(oid);
        // deadline itself is still "before expiry" (strictly after is required)
        vm.warp(esc.getOrder(oid).deadline);
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.cancelOrder(oid);
    }

    function test_Cancel_SellerAfterDeadline() public {
        uint256 adId = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, adId, 40e6);
        vm.warp(uint256(esc.getOrder(oid).deadline) + 1);
        _cancel(alice, oid);
        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.Cancelled));
        assertEq(esc.getAd(adId).available, 100e6);
        assertEq(_strikes(bob), 1); // buyer-taker still gets the strike
    }

    function test_Cancel_AnyoneAfterDeadline() public {
        uint256 adId = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, adId, 40e6);
        vm.warp(uint256(esc.getOrder(oid).deadline) + 1);
        _cancel(stranger, oid);
        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.Cancelled));
        assertEq(esc.getAd(adId).available, 100e6);
    }

    function test_Cancel_RevertsWhenNotPending() public {
        uint256 adId = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, adId, 40e6);
        _paid(oid);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.InvalidStatus.selector, P2PEscrow.OrderStatus.Paid));
        esc.cancelOrder(oid);
        vm.warp(block.timestamp + 2 days);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.InvalidStatus.selector, P2PEscrow.OrderStatus.Paid));
        esc.cancelOrder(oid);
        _disputeBySeller(oid);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.InvalidStatus.selector, P2PEscrow.OrderStatus.Disputed));
        esc.cancelOrder(oid);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.OrderNotFound.selector, 42));
        esc.cancelOrder(42);
    }

    function test_Cancel_Twice_Reverts() public {
        uint256 adId = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, adId, 40e6);
        _cancel(bob, oid);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.InvalidStatus.selector, P2PEscrow.OrderStatus.Cancelled));
        esc.cancelOrder(oid);
    }

    // ---------------------------------------------------------------- closed ads
    function test_Cancel_SellAdClosed_RefundsMakerNotInventory() public {
        uint256 a0 = _bal(alice);
        uint256 adId = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, adId, 40e6);
        vm.prank(alice);
        esc.closeAd(adId);
        assertEq(_bal(alice), a0 - 40e6);
        assertEq(_bal(address(esc)), 40e6);

        _cancel(bob, oid);
        assertEq(_bal(alice), a0);
        assertEq(_bal(address(esc)), 0);
        P2PEscrow.Ad memory ad = esc.getAd(adId);
        assertEq(ad.available, 0);
        assertTrue(ad.closed);
        assertFalse(ad.paused);
    }

    function test_Cancel_BuyAdClosed_RefundsSellerNoInventoryNoPause() public {
        uint256 b0 = _bal(bob);
        uint256 adId = _buy(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, adId, 40e6);
        vm.prank(alice);
        esc.closeAd(adId);
        _cancel(alice, oid);
        assertEq(_bal(bob), b0);
        assertEq(_bal(address(esc)), 0);
        P2PEscrow.Ad memory ad = esc.getAd(adId);
        assertEq(ad.available, 0);
        assertFalse(ad.paused);
        assertEq(_strikes(alice), 0);
    }

    // ---------------------------------------------------------------- buy-ad cancels
    function test_Cancel_BuyAd_BuyerCancelRefundsSellerAndPausesAd_NoStrike() public {
        uint256 b0 = _bal(bob);
        uint256 adId = _buy(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, adId, 40e6);
        assertEq(_bal(bob), b0 - 40e6);

        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.AdPaused(adId, true);
        _cancel(alice, oid);

        assertEq(_bal(bob), b0);
        assertEq(_bal(address(esc)), 0);
        P2PEscrow.Ad memory ad = esc.getAd(adId);
        assertTrue(ad.paused);
        assertEq(ad.available, 100e6);
        assertEq(_strikes(alice), 0);
        assertEq(_strikes(bob), 0);

        vm.prank(carol);
        vm.expectRevert(P2PEscrow.AdUnavailable.selector);
        esc.openOrder(adId, 1e6, PRICE, "x");
        vm.prank(alice);
        esc.setAdPaused(adId, false);
        _open(carol, adId, 1e6);
    }

    function test_Cancel_BuyAd_RepeatedBuyerCancelsNeverBanBuyer() public {
        uint256 adId = _buy(alice, 100e6, 1e6, 100e6);
        for (uint256 i; i < 5; ++i) {
            vm.prank(alice);
            esc.setAdPaused(adId, false);
            uint256 oid = _open(bob, adId, 1e6);
            _cancel(alice, oid);
        }
        assertEq(_strikes(alice), 0);
        assertEq(_bannedUntil(alice), 0);
        _sell(alice, 10e6, 1e6, 10e6); // maker can still act
    }

    function test_Cancel_BuyAd_SellerCannotBeforeDeadline_AnyoneAfter() public {
        uint256 b0 = _bal(bob);
        uint256 adId = _buy(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, adId, 40e6);
        vm.prank(bob); // seller (taker)
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.cancelOrder(oid);
        vm.prank(stranger);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.cancelOrder(oid);
        vm.warp(uint256(esc.getOrder(oid).deadline) + 1);
        _cancel(bob, oid);
        assertEq(_bal(bob), b0);
        assertTrue(esc.getAd(adId).paused);
        assertEq(esc.getAd(adId).available, 100e6);
        assertEq(_strikes(alice), 0);
        assertEq(_strikes(bob), 0);
    }

    // ---------------------------------------------------------------- strikes / cooldown
    function _openCancel(address taker, uint256 adId) internal {
        uint256 oid = _open(taker, adId, 1e6);
        _cancel(taker, oid);
    }

    function test_Strikes_ThreeCancelsWithin24h_StartCooldown() public {
        uint256 adId = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, adId, 1e6);
        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.StrikeAdded(bob, 1);
        _cancel(bob, oid);
        assertEq(_strikes(bob), 1);
        _openCancel(bob, adId);
        assertEq(_strikes(bob), 2);

        uint64 expected = uint64(block.timestamp + 24 hours);
        oid = _open(bob, adId, 1e6);
        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.CooldownStarted(bob, expected);
        _cancel(bob, oid);
        assertEq(_bannedUntil(bob), expected);
        assertEq(_strikes(bob), 0);

        vm.prank(bob);
        vm.expectRevert(P2PEscrow.CooldownActive.selector);
        esc.openOrder(adId, 1e6, PRICE, "x");
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.CooldownActive.selector);
        esc.createAd(SELL, INR, PRICE, 10e6, 1e6, 10e6, 1, 60, 0, "d");

        vm.warp(expected - 1);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.CooldownActive.selector);
        esc.openOrder(adId, 1e6, PRICE, "x");
        vm.warp(expected); // ban is `now < bannedUntil`
        _open(bob, adId, 1e6);
    }

    function test_Strikes_CooldownDoesNotBlockExistingTradeExits() public {
        uint256 adId = _sell(alice, 100e6, 1e6, 100e6);
        uint256 pending = _open(bob, adId, 1e6);
        _openCancel(bob, adId);
        _openCancel(bob, adId);
        _openCancel(bob, adId);
        assertGt(_bannedUntil(bob), block.timestamp);
        _paid(pending); // existing order still progresses
        _release(pending);
        assertEq(uint8(_status(pending)), uint8(P2PEscrow.OrderStatus.Completed));
    }

    function test_Strikes_WindowResetAfter24h() public {
        uint256 adId = _sell(alice, 100e6, 1e6, 100e6);
        _openCancel(bob, adId);
        _openCancel(bob, adId);
        assertEq(_strikes(bob), 2);
        vm.warp(block.timestamp + 24 hours + 1);
        _openCancel(bob, adId); // window rolled over: strike count restarts at 1
        assertEq(_strikes(bob), 1);
        assertEq(_bannedUntil(bob), 0);
        _open(bob, adId, 1e6); // not banned
    }

    function test_Strikes_WindowBoundaryExactly24hStillCounts() public {
        uint256 adId = _sell(alice, 100e6, 1e6, 100e6);
        _openCancel(bob, adId); // windowStart = T0
        _openCancel(bob, adId);
        vm.warp(T0 + 24 hours); // `>` is required for reset, so this strike lands in the same window
        _openCancel(bob, adId);
        assertGt(_bannedUntil(bob), block.timestamp);
    }

    function test_Strikes_SellAdExpiryCancelStrikesBuyer() public {
        uint256 adId = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, adId, 1e6);
        vm.warp(uint256(esc.getOrder(oid).deadline) + 1);
        _cancel(stranger, oid);
        assertEq(_strikes(bob), 1);
        assertEq(_strikes(alice), 0);
    }

    function test_Strikes_SecondBanAfterCooldown() public {
        uint256 adId = _sell(alice, 100e6, 1e6, 100e6);
        _openCancel(bob, adId);
        _openCancel(bob, adId);
        _openCancel(bob, adId);
        vm.warp(block.timestamp + 24 hours);
        _openCancel(bob, adId);
        _openCancel(bob, adId);
        _openCancel(bob, adId);
        assertGt(_bannedUntil(bob), block.timestamp);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.CooldownActive.selector);
        esc.openOrder(adId, 1e6, PRICE, "x");
    }

    // ---------------------------------------------------------------- maker eligibility in openOrder
    function test_OpenOrder_MakerRestrictedAfterAdCreation_Reverts() public {
        uint256 adId = _sell(alice, 100e6, 1e6, 100e6);
        vm.prank(owner);
        esc.setRestricted(alice, true);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.Restricted.selector);
        esc.openOrder(adId, 1e6, PRICE, "x");
        vm.prank(owner);
        esc.setRestricted(alice, false);
        _open(bob, adId, 1e6);
    }

    function test_OpenOrder_MakerInCooldown_Reverts() public {
        uint256 carolAd = _sell(carol, 100e6, 1e6, 100e6);
        uint256 daveAd = _sell(dave, 100e6, 1e6, 100e6);
        _openCancel(dave, carolAd);
        _openCancel(dave, carolAd);
        _openCancel(dave, carolAd);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.CooldownActive.selector);
        esc.openOrder(daveAd, 1e6, PRICE, "x");
        vm.warp(block.timestamp + 24 hours);
        _open(bob, daveAd, 1e6);
    }

    // ---------------------------------------------------------------- open-order cap
    function test_OpenOrderCap_FivePerTaker() public {
        uint256 adId = _sell(alice, 100e6, 1e6, 100e6);
        uint256[] memory ids = new uint256[](5);
        for (uint256 i; i < 5; ++i) ids[i] = _open(bob, adId, 1e6);
        assertEq(esc.openOrderCount(bob), 5);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.OpenOrderLimit.selector, bob));
        esc.openOrder(adId, 1e6, PRICE, "x");
        _cancel(bob, ids[0]); // frees one slot
        _open(bob, adId, 1e6);
        assertEq(esc.openOrderCount(bob), 5);
    }

    function test_OpenOrderCap_AppliesToBuyAdTakerToo() public {
        uint256 adId = _buy(alice, 100e6, 1e6, 100e6);
        for (uint256 i; i < 5; ++i) _open(bob, adId, 1e6);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.OpenOrderLimit.selector, bob));
        esc.openOrder(adId, 1e6, PRICE, "x");
    }

    function test_OpenOrderCap_DoesNotApplyToMakers() public {
        uint256 adId = _sell(alice, 100e6, 1e6, 100e6);
        for (uint256 i; i < 7; ++i) _open(_newFunded(), adId, 1e6);
        assertEq(esc.partyOpenOrders(alice), 7);
        assertEq(esc.openOrderCount(alice), 0);
        // alice (as buyer-taker on another ad) is unaffected by her maker-side orders
        uint256 other = _sell(carol, 10e6, 1e6, 10e6);
        _open(alice, other, 1e6);
        assertEq(esc.openOrderCount(alice), 1);
    }

    function test_OpenOrderCap_BuyAdMakerNotCounted() public {
        uint256 adId = _buy(alice, 100e6, 1e6, 100e6);
        for (uint256 i; i < 6; ++i) _open(_newFunded(), adId, 1e6);
        assertEq(esc.openOrderCount(alice), 0);
        assertEq(esc.partyOpenOrders(alice), 6);
    }
}
