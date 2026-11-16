// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {P2PEscrow} from "../P2PEscrow.sol";
import {P2PEscrowTestBase} from "./P2PEscrow.Base.t.sol";

contract P2PEscrowFlowTest is P2PEscrowTestBase {
    // ---------------------------------------------------------------- constructor
    function test_Constructor_SetsState() public view {
        assertEq(address(esc.usdc()), address(usdc));
        assertEq(esc.owner(), owner);
        assertEq(esc.arbiter(), arbiter);
        assertTrue(esc.supportedCurrency("INR"));
        assertTrue(esc.supportedCurrency("AFN"));
        assertFalse(esc.supportedCurrency("USD"));
    }

    function test_Constructor_RevertsOnBadArgs() public {
        vm.expectRevert(P2PEscrow.InvalidAddress.selector);
        new P2PEscrow(address(0), owner, arbiter);
        vm.expectRevert(P2PEscrow.InvalidAddress.selector);
        new P2PEscrow(address(0xBEEF), owner, arbiter); // no code
        vm.expectRevert(P2PEscrow.InvalidAddress.selector);
        new P2PEscrow(address(usdc), owner, address(0));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new P2PEscrow(address(usdc), address(0), arbiter);
    }

    // ---------------------------------------------------------------- createAd
    function test_CreateAd_Sell_EscrowsInventoryAndEmits() public {
        uint256 a0 = _bal(alice);
        vm.expectEmit(true, true, false, true, address(esc));
        emit P2PEscrow.AdCreated(1, alice, P2PEscrow.Side.Sell, INR, 100e6);
        uint256 id = _sell(alice, 100e6, 10e6, 50e6);
        assertEq(id, 1);
        assertEq(esc.adCount(), 1);
        assertEq(_bal(alice), a0 - 100e6);
        assertEq(_bal(address(esc)), 100e6);
        P2PEscrow.Ad memory ad = esc.getAd(id);
        assertEq(ad.maker, alice);
        assertEq(ad.available, 100e6);
        assertEq(ad.initialAmount, 100e6);
        assertEq(ad.priceE6, PRICE);
        assertEq(ad.minAmount, 10e6);
        assertEq(ad.maxAmount, 50e6);
        assertFalse(ad.merchantAd);
        assertEq(esc.getUserAdIds(alice).length, 1);
    }

    function test_CreateAd_Buy_NoDeposit() public {
        uint256 a0 = _bal(alice);
        uint256 id = _buy(alice, 100e6, 10e6, 50e6);
        assertEq(_bal(alice), a0);
        assertEq(_bal(address(esc)), 0);
        assertEq(esc.getAd(id).available, 100e6);
        assertEq(uint8(esc.getAd(id).side), uint8(P2PEscrow.Side.Buy));
    }

    function test_CreateAd_Reverts() public {
        vm.startPrank(alice);
        vm.expectRevert(P2PEscrow.InvalidSide.selector);
        esc.createAd(2, INR, PRICE, 100e6, 1e6, 100e6, 1, 60, 0, "d");
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.UnsupportedCurrency.selector, bytes3("USD")));
        esc.createAd(SELL, "USD", PRICE, 100e6, 1e6, 100e6, 1, 60, 0, "d");
        vm.expectRevert(P2PEscrow.InvalidPrice.selector);
        esc.createAd(SELL, INR, 0, 100e6, 1e6, 100e6, 1, 60, 0, "d");
        vm.expectRevert(P2PEscrow.InvalidPrice.selector);
        esc.createAd(SELL, INR, 1e15 + 1, 100e6, 1e6, 100e6, 1, 60, 0, "d");
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.createAd(SELL, INR, PRICE, 100e6, 0, 100e6, 1, 60, 0, "d");
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.createAd(SELL, INR, PRICE, 100e6, 11e6, 10e6, 1, 60, 0, "d"); // min > max
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.createAd(SELL, INR, PRICE, 100e6, 1e6, 101e6, 1, 60, 0, "d"); // max > total
        vm.expectRevert(P2PEscrow.InvalidPaymentMask.selector);
        esc.createAd(SELL, INR, PRICE, 100e6, 1e6, 100e6, 0, 60, 0, "d");
        vm.expectRevert(P2PEscrow.InvalidWindow.selector);
        esc.createAd(SELL, INR, PRICE, 100e6, 1e6, 100e6, 1, 9, 0, "d");
        vm.expectRevert(P2PEscrow.InvalidWindow.selector);
        esc.createAd(SELL, INR, PRICE, 100e6, 1e6, 100e6, 1, 1441, 0, "d");
        vm.expectRevert(P2PEscrow.InvalidDetails.selector);
        esc.createAd(SELL, INR, PRICE, 100e6, 1e6, 100e6, 1, 60, 0, ""); // sell needs details
        vm.expectRevert(P2PEscrow.InvalidDetails.selector);
        esc.createAd(BUY, INR, PRICE, 100e6, 1e6, 100e6, 1, 60, 0, _str(201));
        vm.stopPrank();
    }

    function test_CreateAd_BoundaryValuesAccepted() public {
        vm.startPrank(alice);
        esc.createAd(SELL, INR, 1e15, 100e6, 100e6, 100e6, 1, 10, 0, _str(200));
        esc.createAd(BUY, INR, 1, 100e6, 1, 1, type(uint32).max, 1440, 0, "");
        vm.stopPrank();
        assertEq(esc.adCount(), 2);
    }

    // ---------------------------------------------------------------- ad management
    function test_SetAdPrice_MakerOnlyAndValidated() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.AdPriceUpdated(id, PRICE, 95e6);
        vm.prank(alice);
        esc.setAdPrice(id, 95e6);
        assertEq(esc.getAd(id).priceE6, 95e6);

        vm.prank(bob);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.setAdPrice(id, 1);
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.InvalidPrice.selector);
        esc.setAdPrice(id, 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.AdNotFound.selector, 99));
        esc.setAdPrice(99, 1);
    }

    function test_SetAdPrice_DoesNotChangeExistingOrder() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, id, 10e6);
        vm.prank(alice);
        esc.setAdPrice(id, 200e6);
        assertEq(esc.getOrder(oid).priceE6, PRICE);
        assertEq(esc.getOrder(oid).fiatAmountE6, 900e6);
    }

    function test_SetAdPaused_BlocksNewOrdersOnly() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, id, 10e6);
        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.AdPaused(id, true);
        vm.prank(alice);
        esc.setAdPaused(id, true);
        vm.prank(carol);
        vm.expectRevert(P2PEscrow.AdUnavailable.selector);
        esc.openOrder(id, 10e6, PRICE, "x");
        // existing order unaffected
        _paid(oid);
        _release(oid);
        vm.prank(alice);
        esc.setAdPaused(id, false);
        _open(carol, id, 10e6);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.setAdPaused(id, true);
    }

    function test_CloseAd_Sell_RefundsRemaining() public {
        uint256 a0 = _bal(alice);
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        _open(bob, id, 30e6);
        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.AdClosed(id, 70e6, 70e6);
        vm.prank(alice);
        esc.closeAd(id);
        assertEq(_bal(alice), a0 - 30e6);
        assertEq(_bal(address(esc)), 30e6);
        P2PEscrow.Ad memory ad = esc.getAd(id);
        assertTrue(ad.closed);
        assertEq(ad.available, 0);
    }

    function test_CloseAd_Buy_NoRefund() public {
        uint256 id = _buy(alice, 100e6, 1e6, 100e6);
        uint256 a0 = _bal(alice);
        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.AdClosed(id, 100e6, 0);
        vm.prank(alice);
        esc.closeAd(id);
        assertEq(_bal(alice), a0);
        assertTrue(esc.getAd(id).closed);
    }

    function test_CloseAd_Reverts() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.closeAd(id);
        vm.startPrank(alice);
        esc.closeAd(id);
        vm.expectRevert(P2PEscrow.AdUnavailable.selector);
        esc.closeAd(id);
        vm.expectRevert(P2PEscrow.AdUnavailable.selector);
        esc.setAdPrice(id, 1e6);
        vm.expectRevert(P2PEscrow.AdUnavailable.selector);
        esc.setAdPaused(id, true);
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.AdUnavailable.selector);
        esc.openOrder(id, 1e6, PRICE, "x");
    }

    // ---------------------------------------------------------------- happy paths
    function test_SellAd_FullHappyPath_ExactBalances() public {
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        uint256 adId = _sell(alice, 100e6, 10e6, 100e6);

        vm.expectEmit(true, true, true, true, address(esc));
        emit P2PEscrow.OrderOpened(1, adId, bob, alice, 40e6);
        uint256 oid = _open(bob, adId, 40e6);

        P2PEscrow.Order memory o = esc.getOrder(oid);
        assertEq(o.buyer, bob);
        assertEq(o.seller, alice);
        assertEq(o.taker, bob);
        assertEq(o.amount, 40e6);
        assertEq(o.priceE6, PRICE);
        assertEq(o.fiatAmountE6, 3600e6);
        assertEq(o.deadline, uint64(block.timestamp + 60 minutes));
        assertEq(o.paymentDetails, "upi:maker@bank");
        assertEq(uint8(o.status), uint8(P2PEscrow.OrderStatus.Pending));
        assertEq(esc.getAd(adId).available, 60e6);
        assertEq(esc.openOrderCount(bob), 1);
        assertEq(esc.partyOpenOrders(alice), 1);
        assertEq(esc.partyOpenOrders(bob), 1);

        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.OrderPaid(oid, uint64(block.timestamp));
        _paid(oid);
        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.Paid));
        assertEq(esc.getOrder(oid).paidAt, uint64(block.timestamp));

        vm.expectEmit(true, true, false, true, address(esc));
        emit P2PEscrow.OrderReleased(oid, bob, 40e6);
        _release(oid);

        assertEq(_bal(bob), b0 + 40e6);
        assertEq(_bal(alice), a0 - 100e6);
        assertEq(_bal(address(esc)), 60e6);
        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.Completed));
        assertEq(esc.openOrderCount(bob), 0);
        assertEq(esc.partyOpenOrders(alice), 0);
        assertEq(esc.partyOpenOrders(bob), 0);
        assertEq(esc.getAd(adId).available, 60e6);
    }

    function test_BuyAd_FullHappyPath_ExactBalances() public {
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        uint256 adId = _buy(alice, 100e6, 10e6, 100e6);
        uint256 oid = _open(bob, adId, 40e6); // bob (taker) is the seller and escrows USDC

        assertEq(_bal(bob), b0 - 40e6);
        assertEq(_bal(address(esc)), 40e6);
        P2PEscrow.Order memory o = esc.getOrder(oid);
        assertEq(o.buyer, alice);
        assertEq(o.seller, bob);
        assertEq(o.taker, bob);
        assertEq(o.paymentDetails, "bank:taker"); // seller-provided details
        assertEq(o.fiatAmountE6, 3600e6);
        assertEq(esc.getAd(adId).available, 60e6);

        _paid(oid);
        _release(oid);
        assertEq(_bal(alice), a0 + 40e6);
        assertEq(_bal(bob), b0 - 40e6);
        assertEq(_bal(address(esc)), 0);
        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.Completed));
    }

    function test_BuyAd_OpenOrder_DetailsRequired() public {
        uint256 id = _buy(alice, 100e6, 1e6, 100e6);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.InvalidDetails.selector);
        esc.openOrder(id, 1e6, PRICE, "");
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.InvalidDetails.selector);
        esc.openOrder(id, 1e6, PRICE, _str(201));
    }

    // ---------------------------------------------------------------- markPaid / release rules
    function test_MarkPaid_Rules() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, id, 10e6);
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.markPaid(oid);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.OrderNotFound.selector, 99));
        esc.markPaid(99);

        // deadline is inclusive
        vm.warp(esc.getOrder(oid).deadline);
        _paid(oid);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.InvalidStatus.selector, P2PEscrow.OrderStatus.Paid));
        esc.markPaid(oid);
    }

    function test_MarkPaid_RevertsAfterDeadline() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, id, 10e6);
        vm.warp(uint256(esc.getOrder(oid).deadline) + 1);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.DeadlinePassed.selector);
        esc.markPaid(oid);
    }

    function test_Release_Rules() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid = _open(bob, id, 10e6);
        vm.prank(bob); // buyer cannot release
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.release(oid);
        vm.prank(stranger);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.release(oid);
        // release straight from Pending is allowed
        _release(oid);
        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.Completed));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.InvalidStatus.selector, P2PEscrow.OrderStatus.Completed));
        esc.release(oid);
    }

    // ---------------------------------------------------------------- limit price
    function test_PriceMoved_SellAd() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6); // price 90e6
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.PriceMoved.selector);
        esc.openOrder(id, 1e6, PRICE - 1, "x");
        vm.prank(bob);
        esc.openOrder(id, 1e6, PRICE, "x");
        vm.prank(bob);
        esc.openOrder(id, 1e6, PRICE + 1, "x");
        assertEq(esc.orderCount(), 2);
    }

    function test_PriceMoved_BuyAd() public {
        uint256 id = _buy(alice, 100e6, 1e6, 100e6); // price 90e6
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.PriceMoved.selector);
        esc.openOrder(id, 1e6, PRICE + 1, "x");
        vm.prank(bob);
        esc.openOrder(id, 1e6, PRICE, "x");
        vm.prank(bob);
        esc.openOrder(id, 1e6, PRICE - 1, "x");
        assertEq(esc.orderCount(), 2);
    }

    function test_PriceMoved_AfterMakerRaisesSellPrice() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        vm.prank(alice);
        esc.setAdPrice(id, PRICE + 5);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.PriceMoved.selector);
        esc.openOrder(id, 1e6, PRICE, "x");
    }

    // ---------------------------------------------------------------- min / max
    function test_MaxEnforced_MinExemptOnlyForRemainder() public {
        uint256 id = _sell(alice, 100e6, 10e6, 60e6);
        vm.startPrank(bob);
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.openOrder(id, 61e6, PRICE, "x"); // over max
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.openOrder(id, 0, PRICE, "x");
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.openOrder(id, 9e6, PRICE, "x"); // under min, not the remainder
        esc.openOrder(id, 60e6, PRICE, "x"); // exactly max OK, remaining 40
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.openOrder(id, 5e6, PRICE, "x"); // under min, remaining is 40
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.openOrder(id, 41e6, PRICE, "x"); // above available
        esc.openOrder(id, 35e6, PRICE, "x"); // remaining 5
        vm.stopPrank();
        assertEq(esc.getAd(id).available, 5e6);
        vm.prank(carol);
        esc.openOrder(id, 5e6, PRICE, "x"); // below min but equals the remainder
        assertEq(esc.getAd(id).available, 0);
        vm.prank(carol);
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.openOrder(id, 1e6, PRICE, "x"); // nothing left
    }

    function test_MinExemptRemainder_StillCappedByMax() public {
        uint256 id = _sell(alice, 100e6, 50e6, 60e6);
        _open(bob, id, 60e6);
        vm.prank(carol);
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.openOrder(id, 40e6 - 1, PRICE, "x"); // not the remainder, below min 50
        _open(carol, id, 40e6); // the remainder, exempt from min
        assertEq(esc.getAd(id).available, 0);
    }

    function test_MinExemptRemainder_AboveMaxStillReverts() public {
        uint256 id = _sell(alice, 100e6, 10e6, 60e6);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.openOrder(id, 100e6, PRICE, "x"); // == available but > max
    }

    // ---------------------------------------------------------------- misc open-order checks
    function test_OpenOrder_Reverts() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.AdNotFound.selector, 77));
        esc.openOrder(77, 1e6, PRICE, "x");
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.SelfTrade.selector);
        esc.openOrder(id, 1e6, PRICE, "x");
    }

    // ---------------------------------------------------------------- pause / ownership / config
    function test_Pause_BlocksOnlyCreateAdAndOpenOrder() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid1 = _open(bob, id, 10e6);
        uint256 oid2 = _open(bob, id, 10e6);
        uint256 oid3 = _open(bob, id, 10e6);
        _paid(oid1);
        _paid(oid2);
        vm.prank(owner);
        esc.pause();

        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        esc.createAd(SELL, INR, PRICE, 10e6, 1e6, 10e6, 1, 60, 0, "d");
        vm.prank(carol);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        esc.openOrder(id, 1e6, PRICE, "x");

        // everything else still works
        _paid(oid3);
        _release(oid1);
        vm.warp(block.timestamp + 20 minutes);
        vm.prank(bob);
        esc.openDispute(oid2);
        _resolve(oid2, true, false);
        vm.prank(alice);
        esc.setAdPrice(id, 91e6);
        vm.prank(alice);
        esc.setAdPaused(id, true);
        vm.prank(bob);
        esc.depositMargin(1e6);
        vm.prank(alice);
        esc.postMessage(oid3, "hi");
        vm.prank(alice);
        esc.closeAd(id);
        _release(oid3);

        vm.prank(owner);
        esc.unpause();
        _sell(alice, 10e6, 1e6, 10e6);
    }

    function test_Pause_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        esc.pause();
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, arbiter));
        esc.pause();
        vm.prank(owner);
        esc.pause();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        esc.unpause();
    }

    function test_RenounceOwnership_AlwaysReverts() public {
        vm.prank(owner);
        vm.expectRevert(P2PEscrow.RenounceDisabled.selector);
        esc.renounceOwnership();
        assertEq(esc.owner(), owner);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        esc.renounceOwnership();
    }

    function test_TwoStepOwnershipTransfer() public {
        vm.prank(owner);
        esc.transferOwnership(alice);
        assertEq(esc.owner(), owner);
        vm.prank(alice);
        esc.acceptOwnership();
        assertEq(esc.owner(), alice);
    }

    function test_SetArbiter() public {
        vm.expectEmit(true, true, false, true, address(esc));
        emit P2PEscrow.ArbiterUpdated(arbiter, carol);
        vm.prank(owner);
        esc.setArbiter(carol);
        assertEq(esc.arbiter(), carol);
        vm.prank(owner);
        vm.expectRevert(P2PEscrow.InvalidAddress.selector);
        esc.setArbiter(address(0));
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, arbiter));
        esc.setArbiter(dave);
    }

    function test_SetCurrency() public {
        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.CurrencyUpdated("USD", true);
        vm.prank(owner);
        esc.setCurrency("USD", true);
        assertTrue(esc.supportedCurrency("USD"));
        vm.prank(alice);
        esc.createAd(SELL, "USD", PRICE, 10e6, 1e6, 10e6, 1, 60, 0, "d");
        vm.prank(owner);
        esc.setCurrency("USD", false);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.UnsupportedCurrency.selector, bytes3("USD")));
        esc.createAd(SELL, "USD", PRICE, 10e6, 1e6, 10e6, 1, 60, 0, "d");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        esc.setCurrency("EUR", true);
    }

    // ---------------------------------------------------------------- pagination views
    function test_GetAdsAndOrders_Pagination() public {
        uint256 id1 = _sell(alice, 100e6, 1e6, 100e6);
        _sell(alice, 100e6, 1e6, 100e6);
        _buy(carol, 100e6, 1e6, 100e6);
        assertEq(esc.getAds(0, 10).length, 3);
        assertEq(esc.getAds(1, 1).length, 1);
        assertEq(esc.getAds(1, 1)[0].maker, alice);
        assertEq(esc.getAds(2, 10)[0].maker, carol);
        assertEq(esc.getAds(3, 10).length, 0);
        uint256 o1 = _open(bob, id1, 1e6);
        _open(dave, id1, 1e6);
        assertEq(esc.getOrders(0, 10).length, 2);
        assertEq(esc.getOrders(1, 10)[0].buyer, dave);
        uint256[] memory ids = esc.getUserOrderIds(alice);
        assertEq(ids.length, 2);
        assertEq(ids[0], o1);
        assertEq(esc.getUserOrderIds(bob).length, 1);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.AdNotFound.selector, 9));
        esc.getAd(9);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.OrderNotFound.selector, 9));
        esc.getOrder(9);
    }

    function _str(uint256 n) internal pure returns (string memory) {
        bytes memory b = new bytes(n);
        for (uint256 i; i < n; ++i) b[i] = "a";
        return string(b);
    }
}
