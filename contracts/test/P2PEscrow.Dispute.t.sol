// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
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

    // ---------------------------------------------------------------- openDispute timing
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

    function test_Release_NotAllowedInDisputed() public {
        uint256 oid = _paidOrder(10e6);
        _disputeBySeller(oid);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.InvalidStatus.selector, P2PEscrow.OrderStatus.Disputed));
        esc.release(oid);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.release(oid);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.InvalidStatus.selector, P2PEscrow.OrderStatus.Disputed));
        esc.markPaid(oid);
    }

    // ---------------------------------------------------------------- resolveDispute
    function test_Resolve_ToBuyer_NoSlash() public {
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        uint256 oid = _paidOrder(50e6);
        _disputeBySeller(oid);
        vm.expectEmit(true, true, false, true, address(esc));
        emit P2PEscrow.DisputeResolved(oid, true, bob, 50e6);
        _resolve(oid, true, false);

        assertEq(_bal(bob), b0 + 50e6);
        assertEq(_bal(alice), a0);
        assertEq(_bal(address(esc)), 450e6);
        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.ResolvedToBuyer));
        assertEq(esc.getStats(alice).disputesLost, 1);
        assertEq(esc.getStats(bob).disputesLost, 0);
        assertEq(esc.getAd(adId).available, 450e6); // lost disputes never replenish inventory
        assertEq(esc.partyOpenOrders(alice), 0);
        assertEq(esc.openOrderCount(bob), 0);
        // resolution does not count as a completed trade / volume
        assertEq(esc.getStats(bob).ordersCompleted, 0);
        assertEq(esc.getStats(bob).volume, 0);
    }

    function test_Resolve_ToSeller_NoSlash() public {
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        uint256 oid = _paidOrder(50e6);
        _disputeBySeller(oid);
        vm.expectEmit(true, true, false, true, address(esc));
        emit P2PEscrow.DisputeResolved(oid, false, alice, 50e6);
        _resolve(oid, false, false);

        assertEq(_bal(alice), a0 + 50e6);
        assertEq(_bal(bob), b0);
        assertEq(_bal(address(esc)), 450e6);
        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.ResolvedToSeller));
        assertEq(esc.getStats(bob).disputesLost, 1);
        assertEq(esc.getStats(alice).disputesLost, 0);
        assertEq(esc.getAd(adId).available, 450e6);
    }

    function test_Resolve_ToBuyer_SlashSeller_PaysWinnerAmountPlusMargin() public {
        vm.prank(alice);
        esc.depositMargin(150e6);
        uint256 b0 = _bal(bob);
        uint256 oid = _paidOrder(50e6);
        _disputeBySeller(oid);
        vm.expectEmit(true, true, true, true, address(esc));
        emit P2PEscrow.MarginSlashed(oid, alice, bob, 50e6);
        _resolve(oid, true, true);
        assertEq(esc.margin(alice), 100e6);
        assertEq(_bal(bob), b0 + 100e6);
        assertEq(_bal(address(esc)), 450e6 + 100e6); // inventory + remaining margin
    }

    function test_Resolve_ToSeller_SlashBuyer() public {
        vm.prank(bob);
        esc.depositMargin(80e6);
        uint256 a0 = _bal(alice);
        uint256 oid = _paidOrder(50e6);
        _disputeBySeller(oid);
        _resolve(oid, false, true);
        assertEq(esc.margin(bob), 30e6);
        assertEq(_bal(alice), a0 + 100e6);
        assertEq(esc.getStats(bob).disputesLost, 1);
    }

    function test_Resolve_Slash_CappedByLoserMargin() public {
        vm.prank(alice);
        esc.depositMargin(30e6);
        uint256 b0 = _bal(bob);
        uint256 oid = _paidOrder(50e6);
        _disputeBySeller(oid);
        _resolve(oid, true, true);
        assertEq(esc.margin(alice), 0);
        assertEq(_bal(bob), b0 + 50e6 + 30e6);
    }

    function test_Resolve_Slash_NoMarginSlashesNothing() public {
        uint256 b0 = _bal(bob);
        uint256 oid = _paidOrder(50e6);
        _disputeBySeller(oid);
        _resolve(oid, true, true);
        assertEq(_bal(bob), b0 + 50e6);
        assertEq(esc.margin(alice), 0);
    }

    function test_Resolve_Slash_CapsPendingWithdrawal() public {
        vm.startPrank(alice);
        esc.depositMargin(150e6);
        esc.requestMarginWithdrawal(120e6);
        vm.stopPrank();
        uint256 oid = _paidOrder(100e6);
        _disputeBySeller(oid);
        _resolve(oid, true, true); // slash = min(150, 100) = 100 -> margin 50 < pending 120
        assertEq(esc.margin(alice), 50e6);
        (uint128 pendingAmt, uint64 unlockAt) = esc.marginWithdrawal(alice);
        assertEq(pendingAmt, 50e6);
        assertGt(unlockAt, 0);
        assertEq(esc.effectiveMargin(alice), 0);
    }

    function test_Resolve_Slash_LeavesSmallerPendingUntouched() public {
        vm.startPrank(alice);
        esc.depositMargin(150e6);
        esc.requestMarginWithdrawal(20e6);
        vm.stopPrank();
        uint256 oid = _paidOrder(100e6);
        _disputeBySeller(oid);
        _resolve(oid, true, true); // margin 50, pending 20 stays
        (uint128 pendingAmt,) = esc.marginWithdrawal(alice);
        assertEq(pendingAmt, 20e6);
        assertEq(esc.effectiveMargin(alice), 30e6);
    }

    function test_Resolve_NoSlash_LeavesMarginAlone() public {
        vm.prank(alice);
        esc.depositMargin(150e6);
        uint256 oid = _paidOrder(100e6);
        _disputeBySeller(oid);
        _resolve(oid, true, false);
        assertEq(esc.margin(alice), 150e6);
    }

    function test_Resolve_OnlyArbiterAndOnlyDisputed() public {
        uint256 oid = _paidOrder(10e6);
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.InvalidStatus.selector, P2PEscrow.OrderStatus.Paid));
        esc.resolveDispute(oid, true, false);
        _disputeBySeller(oid);
        vm.prank(owner);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.resolveDispute(oid, true, false);
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.resolveDispute(oid, false, false);
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.OrderNotFound.selector, 99));
        esc.resolveDispute(99, true, false);
        _resolve(oid, true, false);
        vm.prank(arbiter);
        vm.expectRevert(
            abi.encodeWithSelector(P2PEscrow.InvalidStatus.selector, P2PEscrow.OrderStatus.ResolvedToBuyer)
        );
        esc.resolveDispute(oid, false, false);
    }

    function test_Resolve_ArbiterCannotResolveOwnOrder_AsSeller() public {
        uint256 arbAd = _sell(arbiter, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, arbAd, 10e6);
        _paid(oid);
        _disputeBySeller(oid); // arbiter is seller
        vm.prank(arbiter);
        vm.expectRevert(P2PEscrow.ArbiterIsParty.selector);
        esc.resolveDispute(oid, true, false);
        // owner appoints a replacement who can resolve
        vm.prank(owner);
        esc.setArbiter(carol);
        vm.prank(arbiter);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.resolveDispute(oid, true, false);
        vm.prank(carol);
        esc.resolveDispute(oid, true, false);
        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.ResolvedToBuyer));
    }

    function test_Resolve_ArbiterCannotResolveOwnOrder_AsBuyer() public {
        uint256 oid = _open(arbiter, adId, 10e6);
        _paid(oid);
        _disputeBySeller(oid);
        vm.prank(arbiter);
        vm.expectRevert(P2PEscrow.ArbiterIsParty.selector);
        esc.resolveDispute(oid, false, false);
    }

    // ---------------------------------------------------------------- disputesLost / auto-restriction
    function test_ThreeDisputesLost_AutoRestrictsBuyer() public {
        for (uint256 i; i < 3; ++i) {
            assertEq(esc.getStats(bob).disputesLost, i);
            uint256 oid = _paidOrder(10e6);
            _disputeBySeller(oid);
            _resolve(oid, false, false);
        }
        assertEq(esc.getStats(bob).disputesLost, 3);
        assertFalse(esc.restricted(bob)); // flag is not set; restriction is derived
        assertTrue(esc.getAccount(bob).disputesLost >= 3);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.Restricted.selector);
        esc.openOrder(adId, 1e6, PRICE, "x");
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.Restricted.selector);
        esc.createAd(SELL, INR, PRICE, 10e6, 1e6, 10e6, 1, 60, 0, "d");
    }

    function test_TwoDisputesLost_NotRestricted() public {
        for (uint256 i; i < 2; ++i) {
            uint256 oid = _paidOrder(10e6);
            _disputeBySeller(oid);
            _resolve(oid, false, false);
        }
        _open(bob, adId, 1e6);
    }

    function test_ThreeDisputesLost_SellerMakerBlockedFromTakingOrders() public {
        address[3] memory buyers = [bob, carol, dave];
        for (uint256 i; i < 3; ++i) {
            uint256 oid = _open(buyers[i], adId, 10e6);
            _paid(oid);
            _disputeBySeller(oid);
            _resolve(oid, true, false);
        }
        assertEq(esc.getStats(alice).disputesLost, 3);
        vm.prank(stranger);
        vm.expectRevert(P2PEscrow.Restricted.selector);
        esc.openOrder(adId, 1e6, PRICE, "x"); // maker restricted
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.Restricted.selector);
        esc.createAd(SELL, INR, PRICE, 10e6, 1e6, 10e6, 1, 60, 0, "d");
        // but alice can still close the ad and recover inventory
        uint256 a0 = _bal(alice);
        vm.prank(alice);
        esc.closeAd(adId);
        assertEq(_bal(alice), a0 + 470e6);
    }

    function test_RestrictedParty_CanStillFinishExistingOrder() public {
        uint256 oid = _open(bob, adId, 10e6);
        vm.prank(owner);
        esc.setRestricted(bob, true);
        _paid(oid);
        _release(oid);
        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.Completed));
    }

    // ---------------------------------------------------------------- setRestricted
    function test_SetRestricted_OwnerAndArbiter() public {
        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.RestrictionUpdated(bob, true);
        vm.prank(owner);
        esc.setRestricted(bob, true);
        assertTrue(esc.restricted(bob));
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.Restricted.selector);
        esc.openOrder(adId, 1e6, PRICE, "x");
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.Restricted.selector);
        esc.createAd(SELL, INR, PRICE, 10e6, 1e6, 10e6, 1, 60, 0, "d");

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

    function test_SetRestricted_FollowsNewArbiter() public {
        vm.prank(owner);
        esc.setArbiter(carol);
        vm.prank(arbiter);
        vm.expectRevert(P2PEscrow.NotAdmin.selector);
        esc.setRestricted(bob, true);
        vm.prank(carol);
        esc.setRestricted(bob, true);
        assertTrue(esc.restricted(bob));
    }

    // ---------------------------------------------------------------- postMessage
    function test_PostMessage_PartiesInPendingPaidDisputed() public {
        uint256 oid = _open(bob, adId, 10e6);
        vm.expectEmit(true, true, false, true, address(esc));
        emit P2PEscrow.OrderMessage(oid, bob, "hello");
        vm.prank(bob);
        esc.postMessage(oid, "hello");
        vm.prank(alice);
        esc.postMessage(oid, "hi");
        _paid(oid);
        vm.prank(bob);
        esc.postMessage(oid, "paid");
        _disputeBySeller(oid);
        vm.prank(alice);
        esc.postMessage(oid, "dispute");
    }

    function test_PostMessage_ArbiterOnlyWhenDisputed() public {
        uint256 oid = _open(bob, adId, 10e6);
        vm.prank(arbiter);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.postMessage(oid, "x");
        _paid(oid);
        vm.prank(arbiter);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.postMessage(oid, "x");
        _disputeBySeller(oid);
        vm.expectEmit(true, true, false, true, address(esc));
        emit P2PEscrow.OrderMessage(oid, arbiter, "evidence please");
        vm.prank(arbiter);
        esc.postMessage(oid, "evidence please");
    }

    function test_PostMessage_StrangerAndOwnerReverts() public {
        uint256 oid = _open(bob, adId, 10e6);
        vm.prank(stranger);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.postMessage(oid, "x");
        vm.prank(owner);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.postMessage(oid, "x");
    }

    function test_PostMessage_LengthLimits() public {
        uint256 oid = _open(bob, adId, 10e6);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.InvalidMessage.selector);
        esc.postMessage(oid, "");
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.InvalidMessage.selector);
        esc.postMessage(oid, string(new bytes(281)));
        vm.prank(bob);
        esc.postMessage(oid, string(_bytes(280)));
    }

    function test_PostMessage_TerminalOrMissingOrderReverts() public {
        uint256 oid = _open(bob, adId, 10e6);
        _release(oid);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.InvalidStatus.selector, P2PEscrow.OrderStatus.Completed));
        esc.postMessage(oid, "x");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.OrderNotFound.selector, 77));
        esc.postMessage(77, "x");
    }

    function _bytes(uint256 n) internal pure returns (bytes memory b) {
        b = new bytes(n);
        for (uint256 i; i < n; ++i) b[i] = "m";
    }
}
