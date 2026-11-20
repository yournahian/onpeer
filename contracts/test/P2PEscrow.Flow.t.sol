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
        assertEq(esc.backupArbiter(), backupArbiter);
        assertEq(esc.feeRecipient(), owner);
        assertEq(esc.listingFee(), FEE);
        assertEq(esc.feesAccrued(), 0);
        assertEq(esc.verifier(), address(0));
        assertFalse(esc.kycRequired());
        assertFalse(esc.sealedEnabled());
        assertFalse(esc.payerProofRequired());
        assertTrue(esc.supportedCurrency("INR"));
        assertTrue(esc.supportedCurrency("AFN"));
        assertFalse(esc.supportedCurrency("USD"));
    }

    function test_Constructor_RevertsOnBadArgs() public {
        vm.expectRevert(P2PEscrow.InvalidAddress.selector);
        new P2PEscrow(address(0), owner, arbiter, backupArbiter);
        vm.expectRevert(P2PEscrow.InvalidAddress.selector);
        new P2PEscrow(address(0xBEEF), owner, arbiter, backupArbiter); // no code
        vm.expectRevert(P2PEscrow.InvalidAddress.selector);
        new P2PEscrow(address(usdc), owner, address(0), backupArbiter);
        vm.expectRevert(P2PEscrow.InvalidAddress.selector);
        new P2PEscrow(address(usdc), owner, arbiter, address(0));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new P2PEscrow(address(usdc), address(0), arbiter, backupArbiter);
    }

    // ---------------------------------------------------------------- createAd
    function test_CreateAd_Sell_EscrowsInventoryAndEmits() public {
        uint256 a0 = _bal(alice);
        vm.expectEmit(true, true, false, true, address(esc));
        emit P2PEscrow.AdCreated(1, alice, P2PEscrow.Side.Sell, INR, 100e6);
        uint256 id = _sell(alice, 100e6, 10e6, 50e6);
        assertEq(id, 1);
        assertEq(esc.adCount(), 1);
        assertEq(_bal(alice), a0 - 100e6 - FEE);
        assertEq(_bal(address(esc)), 100e6 + FEE);
        assertEq(esc.feesAccrued(), FEE);
        P2PEscrow.Ad memory ad = esc.getAd(id);
        assertEq(ad.maker, alice);
        assertEq(ad.available, 100e6);
        assertEq(ad.initialAmount, 100e6);
        assertEq(ad.priceE6, PRICE);
        assertEq(ad.minAmount, 10e6);
        assertEq(ad.maxAmount, 50e6);
        assertEq(ad.expiresAt, uint64(block.timestamp + uint256(DEFAULT_TTL) * 1 hours));
        assertFalse(ad.merchantAd);
        assertEq(ad.detailsMode, 0);
        assertEq(esc.getStats(alice).firstSeen, uint64(block.timestamp));
        assertEq(esc.getUserAdIds(alice).length, 1);
    }

    function test_CreateAd_Buy_NoDeposit() public {
        _qualifyN(alice, 3);
        uint256 a0 = _bal(alice);
        uint256 id = _buy(alice, 100e6, 10e6, 50e6);
        assertEq(_bal(alice), a0 - FEE);
        assertEq(_bal(address(esc)), FEE);
        assertEq(esc.feesAccrued(), FEE);
        assertEq(esc.getAd(id).available, 100e6);
        assertEq(uint8(esc.getAd(id).side), uint8(P2PEscrow.Side.Buy));
    }

    function test_CreateAd_BuyAdGate_RequiresMerchantOrThreeCompleted() public {
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.BuyAdNotAllowed.selector);
        esc.createAd(BUY, INR, PRICE, 100e6, 1e6, 100e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "");

        _qualifyN(alice, 2);
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.BuyAdNotAllowed.selector);
        esc.createAd(BUY, INR, PRICE, 100e6, 1e6, 100e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "");

        // 3rd completed trade unlocks Buy ads
        _qualifyN(alice, 1);
        vm.prank(alice);
        esc.createAd(BUY, INR, PRICE, 100e6, 1e6, 100e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "");

        // Merchant with 0 completed trades can also post Buy ads
        assertEq(esc.getStats(carol).ordersCompleted, 0);
        _makeMerchant(carol);
        vm.prank(carol);
        esc.createAd(BUY, INR, PRICE, 100e6, 1e6, 100e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "");
    }

    function test_CreateAd_Reverts() public {
        _makeMerchant(alice);
        vm.startPrank(alice);
        vm.expectRevert(P2PEscrow.InvalidSide.selector);
        esc.createAd(2, INR, PRICE, 100e6, 1e6, 100e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "d");
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.UnsupportedCurrency.selector, bytes3("USD")));
        esc.createAd(SELL, "USD", PRICE, 100e6, 1e6, 100e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "d");
        vm.expectRevert(P2PEscrow.InvalidPrice.selector);
        esc.createAd(SELL, INR, 0, 100e6, 1e6, 100e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "d");
        vm.expectRevert(P2PEscrow.InvalidPrice.selector);
        esc.createAd(SELL, INR, 1e15 + 1, 100e6, 1e6, 100e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "d");
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.createAd(SELL, INR, PRICE, 100e6, 0, 100e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "d");
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.createAd(SELL, INR, PRICE, 100e6, 11e6, 10e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "d");
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.createAd(SELL, INR, PRICE, 100e6, 1e6, 101e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "d");
        vm.expectRevert(P2PEscrow.InvalidPaymentMask.selector);
        esc.createAd(SELL, INR, PRICE, 100e6, 1e6, 100e6, 0, 60, 0, DEFAULT_TTL, 0, bytes32(0), "d");
        vm.expectRevert(P2PEscrow.InvalidWindow.selector);
        esc.createAd(SELL, INR, PRICE, 100e6, 1e6, 100e6, 1, 9, 0, DEFAULT_TTL, 0, bytes32(0), "d");
        vm.expectRevert(P2PEscrow.InvalidWindow.selector);
        esc.createAd(SELL, INR, PRICE, 100e6, 1e6, 100e6, 1, 1441, 0, DEFAULT_TTL, 0, bytes32(0), "d");
        vm.expectRevert(P2PEscrow.InvalidTtl.selector);
        esc.createAd(SELL, INR, PRICE, 100e6, 1e6, 100e6, 1, 60, 0, 0, 0, bytes32(0), "d");
        vm.expectRevert(P2PEscrow.InvalidTtl.selector);
        esc.createAd(SELL, INR, PRICE, 100e6, 1e6, 100e6, 1, 60, 0, 169, 0, bytes32(0), "d");
        vm.expectRevert(P2PEscrow.InvalidDetails.selector);
        esc.createAd(SELL, INR, PRICE, 100e6, 1e6, 100e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "");
        vm.expectRevert(P2PEscrow.InvalidDetails.selector);
        esc.createAd(BUY, INR, PRICE, 100e6, 1e6, 100e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), _str(201));
        vm.stopPrank();
    }

    function test_CreateAd_BoundaryValuesAccepted() public {
        _makeMerchant(alice);
        vm.startPrank(alice);
        esc.createAd(SELL, INR, 1e15, 100e6, 100e6, 100e6, 1, 10, 0, 1, 0, bytes32(0), _str(200));
        esc.createAd(BUY, INR, 1, 100e6, 1, 1, type(uint32).max, 1440, 0, 168, 0, bytes32(0), "");
        vm.stopPrank();
        assertEq(esc.adCount(), 2);
    }

    // ---------------------------------------------------------------- TTL, expiry & refreshAd
    function test_AdExpiry_BlocksOpenOrder_AllowsRefreshAndClose() public {
        uint256 a0 = _bal(alice);
        vm.prank(alice);
        uint256 id = esc.createAd(SELL, INR, PRICE, 100e6, 1e6, 100e6, 1, 60, 0, 2, 0, bytes32(0), "upi:alice");

        uint64 exp = esc.getAd(id).expiresAt;
        assertEq(exp, uint64(T0 + 2 hours));

        // Exactly at expiresAt is still valid
        vm.warp(exp);
        _open(bob, id, 10e6);

        // Strictly after expiresAt reverts AdExpired
        vm.warp(uint256(exp) + 1);
        vm.prank(carol);
        vm.expectRevert(P2PEscrow.AdExpired.selector);
        esc.openOrder(id, 10e6, PRICE, bytes32(0), "x");

        // Non-maker cannot refresh; invalid TTL rejected
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.refreshAd(id, 24);
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.InvalidTtl.selector);
        esc.refreshAd(id, 0);
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.InvalidTtl.selector);
        esc.refreshAd(id, 169);

        // Maker refreshes -> orders work again
        uint64 nextExp = uint64(block.timestamp + 24 hours);
        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.AdRefreshed(id, nextExp);
        vm.prank(alice);
        esc.refreshAd(id, 24);
        assertEq(esc.getAd(id).expiresAt, nextExp);
        _open(carol, id, 20e6);

        // Let it expire again; maker can still closeAd and recover remaining 70 USDC (listing fee not refunded)
        vm.warp(uint256(nextExp) + 10 hours);
        vm.prank(alice);
        esc.closeAd(id);
        assertEq(_bal(alice), a0 - 30e6 - FEE);

        // Closed ad cannot be refreshed
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.AdUnavailable.selector);
        esc.refreshAd(id, 24);
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
        esc.openOrder(id, 10e6, PRICE, bytes32(0), "x");
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
        assertEq(_bal(alice), a0 - 30e6 - FEE);
        assertEq(_bal(address(esc)), 30e6 + FEE);
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
        esc.openOrder(id, 1e6, PRICE, bytes32(0), "x");
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
        assertEq(o.bond, 2e6);
        assertEq(o.priceE6, PRICE);
        assertEq(o.fiatAmountE6, 3600e6);
        assertEq(o.deadline, uint64(block.timestamp + 60 minutes));
        assertTrue(o.detailsReady);
        assertFalse(o.paidLate);
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
        assertEq(_bal(alice), a0 - 100e6 - FEE);
        assertEq(_bal(address(esc)), 60e6 + FEE);
        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.Completed));
        assertEq(esc.openOrderCount(bob), 0);
        assertEq(esc.partyOpenOrders(alice), 0);
        assertEq(esc.partyOpenOrders(bob), 0);
        assertEq(esc.getAd(adId).available, 60e6);
    }

    function test_BuyAd_FullHappyPath_ExactBalances() public {
        _qualifyN(alice, 3);
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        uint256 adId = _buy(alice, 100e6, 10e6, 100e6);
        uint256 oid = _open(bob, adId, 40e6); // bob (taker) is the seller and escrows USDC

        assertEq(_bal(bob), b0 - 40e6);
        assertEq(_bal(address(esc)), 40e6 + FEE);
        P2PEscrow.Order memory o = esc.getOrder(oid);
        assertEq(o.buyer, alice);
        assertEq(o.seller, bob);
        assertEq(o.taker, bob);
        assertEq(o.paymentDetails, "bank:taker");
        assertEq(o.fiatAmountE6, 3600e6);
        assertEq(esc.getAd(adId).available, 60e6);

        _paid(oid);
        _release(oid);
        assertEq(_bal(alice), a0 - FEE + 40e6);
        assertEq(_bal(bob), b0 - 40e6);
        assertEq(_bal(address(esc)), FEE);
        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.Completed));
    }

    function test_BuyAd_OpenOrder_DetailsRequired() public {
        uint256 id = _buy(alice, 100e6, 1e6, 100e6);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.InvalidDetails.selector);
        esc.openOrder(id, 1e6, PRICE, bytes32(0), "");
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.InvalidDetails.selector);
        esc.openOrder(id, 1e6, PRICE, bytes32(0), _str(201));
    }

    // ---------------------------------------------------------------- markPaid / grace / release rules
    function test_MarkPaid_RulesAndGraceBoundaries() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid1 = _open(bob, id, 10e6);
        uint256 oid2 = _open(bob, id, 10e6);
        uint256 oid3 = _open(bob, id, 10e6);
        uint256 oid4 = _open(bob, id, 10e6);

        vm.prank(alice);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.markPaid(oid1, bytes32(0));
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.OrderNotFound.selector, 99));
        esc.markPaid(99, bytes32(0));

        uint64 dl = esc.getOrder(oid1).deadline;

        // 1) Exactly at deadline -> paidLate == false
        vm.warp(dl);
        _paid(oid1);
        assertFalse(esc.getOrder(oid1).paidLate);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.InvalidStatus.selector, P2PEscrow.OrderStatus.Paid));
        esc.markPaid(oid1, bytes32(0));

        // 2) deadline + 1 -> requires payerProof != 0, paidLate == true
        vm.warp(uint256(dl) + 1);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.PayerProofRequired.selector);
        esc.markPaid(oid2, bytes32(0));
        vm.prank(bob);
        esc.markPaid(oid2, keccak256("tx-2"));
        assertTrue(esc.getOrder(oid2).paidLate);

        // 3) Exactly at deadline + GRACE -> allowed with payerProof, paidLate == true
        vm.warp(uint256(dl) + esc.GRACE());
        vm.prank(bob);
        esc.markPaid(oid3, keccak256("tx-3"));
        assertTrue(esc.getOrder(oid3).paidLate);

        // 4) deadline + GRACE + 1 -> reverts DeadlinePassed
        vm.warp(uint256(dl) + esc.GRACE() + 1);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.DeadlinePassed.selector);
        esc.markPaid(oid4, keccak256("tx-4"));
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

    // ---------------------------------------------------------------- Step 2 hooks: detailsMode 1 & 2, payerProof, keys
    function test_SealedSellAd_RevealAndTimerStart() public {
        bytes32 adHash = keccak256("encrypted-ad-terms");
        bytes32 ordHash = keccak256("encrypted-upi-id");

        // Disabled by default
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.SealedDisabled.selector);
        esc.createAd(SELL, INR, PRICE, 100e6, 1e6, 100e6, 1, 30, 0, DEFAULT_TTL, 1, adHash, "");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        esc.setSealedEnabled(true);

        vm.expectEmit(false, false, false, true, address(esc));
        emit P2PEscrow.SealedEnabledUpdated(true);
        vm.prank(owner);
        esc.setSealedEnabled(true);
        assertTrue(esc.sealedEnabled());

        // Sealed ad requires detailsHash != 0, needs no plain details
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.InvalidDetails.selector);
        esc.createAd(SELL, INR, PRICE, 100e6, 1e6, 100e6, 1, 30, 0, DEFAULT_TTL, 1, bytes32(0), "");

        vm.prank(alice);
        uint256 adId = esc.createAd(SELL, INR, PRICE, 100e6, 1e6, 100e6, 1, 30, 0, DEFAULT_TTL, 1, adHash, "");

        vm.prank(bob);
        uint256 oid = esc.openOrder(adId, 25e6, PRICE, bytes32(0), "");
        P2PEscrow.Order memory o = esc.getOrder(oid);
        assertFalse(o.detailsReady);
        assertEq(o.deadline, 0);
        assertEq(o.revealDeadline, uint64(T0 + 10 minutes));

        // Buyer cannot markPaid before details are shared
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.DetailsNotReady.selector);
        esc.markPaid(oid, bytes32(0));

        // Only seller can shareDetails, with non-zero hash, within revealDeadline
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.shareDetails(oid, ordHash);
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.InvalidDetails.selector);
        esc.shareDetails(oid, bytes32(0));

        vm.warp(T0 + 4 minutes);
        uint64 expectedDl = uint64(block.timestamp + 30 minutes);
        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.DetailsShared(oid, ordHash, expectedDl);
        vm.prank(alice);
        esc.shareDetails(oid, ordHash);

        o = esc.getOrder(oid);
        assertTrue(o.detailsReady);
        assertEq(o.detailsHash, ordHash);
        assertEq(o.deadline, expectedDl);

        // Cannot shareDetails twice
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.DetailsAlreadyReady.selector);
        esc.shareDetails(oid, ordHash);

        // Now buyer can markPaid and seller can release
        _paid(oid);
        _release(oid);
        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.Completed));
    }

    function test_SealedSellAd_ShareDetailsAfterRevealDeadlineReverts() public {
        vm.prank(owner);
        esc.setSealedEnabled(true);
        vm.prank(alice);
        uint256 adId =
            esc.createAd(SELL, INR, PRICE, 100e6, 1e6, 100e6, 1, 30, 0, DEFAULT_TTL, 1, keccak256("a"), "");
        vm.prank(bob);
        uint256 oid = esc.openOrder(adId, 10e6, PRICE, bytes32(0), "");
        vm.warp(uint256(esc.getOrder(oid).revealDeadline) + 1);
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.DeadlinePassed.selector);
        esc.shareDetails(oid, keccak256("late"));
    }

    function test_SealedBuyAd_TakerPassesDetailsHashImmediately() public {
        _makeMerchant(alice);
        vm.prank(owner);
        esc.setSealedEnabled(true);
        vm.prank(alice);
        uint256 adId =
            esc.createAd(BUY, INR, PRICE, 100e6, 1e6, 100e6, 1, 45, 0, DEFAULT_TTL, 1, keccak256("buy-terms"), "");

        // Missing detailsHash rejected
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.InvalidDetails.selector);
        esc.openOrder(adId, 20e6, PRICE, bytes32(0), "");

        bytes32 sellerHash = keccak256("seller-sealed-bank");
        vm.prank(bob);
        uint256 oid = esc.openOrder(adId, 20e6, PRICE, sellerHash, "");
        P2PEscrow.Order memory o = esc.getOrder(oid);
        assertTrue(o.detailsReady);
        assertEq(o.detailsHash, sellerHash);
        assertEq(o.paymentDetails, "");
        assertEq(o.deadline, uint64(block.timestamp + 45 minutes));
    }

    function test_PayerProofRequired_ToggleAndEnforcement() public {
        uint256 adId = _sell(alice, 100e6, 1e6, 100e6);
        uint256 oid1 = _open(bob, adId, 10e6);
        uint256 oid2 = _open(bob, adId, 10e6);

        // Off: zero payerProof works
        _paid(oid1);
        assertEq(esc.getOrder(oid1).payerProof, bytes32(0));

        // Turn on
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        esc.setPayerProofRequired(true);

        vm.expectEmit(false, false, false, true, address(esc));
        emit P2PEscrow.PayerProofRequiredUpdated(true);
        vm.prank(owner);
        esc.setPayerProofRequired(true);

        vm.prank(bob);
        vm.expectRevert(P2PEscrow.PayerProofRequired.selector);
        esc.markPaid(oid2, bytes32(0));

        bytes32 proof = keccak256("payer:Bob Kumar");
        vm.prank(bob);
        esc.markPaid(oid2, proof);
        assertEq(esc.getOrder(oid2).payerProof, proof);
    }

    function test_EncryptionKeyRegistry_BoundsAndOrderView() public {
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.InvalidEncryptionKey.selector);
        esc.registerEncryptionKey(new bytes(32));
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.InvalidEncryptionKey.selector);
        esc.registerEncryptionKey(new bytes(66));

        bytes memory kAlice = new bytes(33);
        kAlice[0] = 0x02;
        bytes memory kBob = new bytes(65);
        kBob[0] = 0x04;
        bytes memory kArb = new bytes(33);
        kArb[0] = 0x03;

        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.EncryptionKeyRegistered(alice, kAlice);
        vm.prank(alice);
        esc.registerEncryptionKey(kAlice);
        vm.prank(bob);
        esc.registerEncryptionKey(kBob);
        vm.prank(arbiter);
        esc.registerEncryptionKey(kArb);

        uint256 adId = _sell(alice, 50e6, 1e6, 50e6);
        uint256 oid = _open(bob, adId, 10e6);
        (bytes memory bk, bytes memory sk, bytes memory ak) = esc.encryptionKeysFor(oid);
        assertEq(bk, kBob);
        assertEq(sk, kAlice);
        assertEq(ak, kArb);
    }

    function test_AutoRevealSellAd_Mode2_TimerStartsImmediately() public {
        bytes32 vaultHash = keccak256("vault-auto-reveal-blob");
        vm.prank(owner);
        esc.setSealedEnabled(true);

        vm.prank(alice);
        uint256 adId = esc.createAd(SELL, INR, PRICE, 50e6, 1e6, 50e6, 1, 30, 0, DEFAULT_TTL, 2, vaultHash, "");
        assertEq(esc.getAd(adId).detailsMode, 2);

        vm.prank(bob);
        uint256 oid = esc.openOrder(adId, 10e6, PRICE, bytes32(0), "");
        P2PEscrow.Order memory o = esc.getOrder(oid);
        assertTrue(o.detailsReady);
        assertEq(o.detailsHash, vaultHash);
        assertEq(o.paymentDetails, "");
        assertEq(o.deadline, uint64(block.timestamp + 30 minutes));
        assertEq(o.revealDeadline, 0);

        // shareDetails is rejected because detailsReady is already true
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.DetailsAlreadyReady.selector);
        esc.shareDetails(oid, vaultHash);

        _paid(oid);
        _release(oid);
        assertEq(uint8(_status(oid)), uint8(P2PEscrow.OrderStatus.Completed));
    }

    // ---------------------------------------------------------------- limit price
    function test_PriceMoved_SellAd() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.PriceMoved.selector);
        esc.openOrder(id, 1e6, PRICE - 1, bytes32(0), "x");
        vm.prank(bob);
        esc.openOrder(id, 1e6, PRICE, bytes32(0), "x");
        vm.prank(bob);
        esc.openOrder(id, 1e6, PRICE + 1, bytes32(0), "x");
        assertEq(esc.orderCount(), 2);
    }

    function test_PriceMoved_BuyAd() public {
        _makeMerchant(alice);
        uint256 id = _buy(alice, 100e6, 1e6, 100e6);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.PriceMoved.selector);
        esc.openOrder(id, 1e6, PRICE + 1, bytes32(0), "x");
        vm.prank(bob);
        esc.openOrder(id, 1e6, PRICE, bytes32(0), "x");
        vm.prank(bob);
        esc.openOrder(id, 1e6, PRICE - 1, bytes32(0), "x");
        assertEq(esc.orderCount(), 2);
    }

    function test_PriceMoved_AfterMakerRaisesSellPrice() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        vm.prank(alice);
        esc.setAdPrice(id, PRICE + 5);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.PriceMoved.selector);
        esc.openOrder(id, 1e6, PRICE, bytes32(0), "x");
    }

    // ---------------------------------------------------------------- min / max
    function test_MaxEnforced_MinExemptOnlyForRemainder() public {
        uint256 id = _sell(alice, 100e6, 10e6, 60e6);
        vm.startPrank(bob);
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.openOrder(id, 61e6, PRICE, bytes32(0), "x");
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.openOrder(id, 0, PRICE, bytes32(0), "x");
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.openOrder(id, 9e6, PRICE, bytes32(0), "x");
        esc.openOrder(id, 60e6, PRICE, bytes32(0), "x");
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.openOrder(id, 5e6, PRICE, bytes32(0), "x");
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.openOrder(id, 41e6, PRICE, bytes32(0), "x");
        esc.openOrder(id, 35e6, PRICE, bytes32(0), "x");
        vm.stopPrank();
        assertEq(esc.getAd(id).available, 5e6);
        vm.prank(carol);
        esc.openOrder(id, 5e6, PRICE, bytes32(0), "x");
        assertEq(esc.getAd(id).available, 0);
        vm.prank(carol);
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.openOrder(id, 1e6, PRICE, bytes32(0), "x");
    }

    function test_MinExemptRemainder_StillCappedByMax() public {
        uint256 id = _sell(alice, 100e6, 50e6, 60e6);
        _open(bob, id, 60e6);
        vm.prank(carol);
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.openOrder(id, 40e6 - 1, PRICE, bytes32(0), "x");
        _open(carol, id, 40e6);
        assertEq(esc.getAd(id).available, 0);
    }

    function test_MinExemptRemainder_AboveMaxStillReverts() public {
        uint256 id = _sell(alice, 100e6, 10e6, 60e6);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.InvalidAmount.selector);
        esc.openOrder(id, 100e6, PRICE, bytes32(0), "x");
    }

    // ---------------------------------------------------------------- misc open-order checks
    function test_OpenOrder_Reverts() public {
        uint256 id = _sell(alice, 100e6, 1e6, 100e6);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.AdNotFound.selector, 77));
        esc.openOrder(77, 1e6, PRICE, bytes32(0), "x");
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.SelfTrade.selector);
        esc.openOrder(id, 1e6, PRICE, bytes32(0), "x");
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
        esc.createAd(SELL, INR, PRICE, 10e6, 1e6, 10e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "d");
        vm.prank(carol);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        esc.openOrder(id, 1e6, PRICE, bytes32(0), "x");

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

        // clear alice's bond debt from losing oid2 so she can create an ad after unpause
        uint256 aliceDebt = esc.totalDebt(alice);
        if (aliceDebt > 0) {
            vm.prank(alice);
            esc.repayDebt(aliceDebt);
        }
        vm.prank(owner);
        esc.setDisputeWaiver(alice, true);

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

    function test_SetArbiter_And_SetBackupArbiter() public {
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

        vm.expectEmit(true, true, false, true, address(esc));
        emit P2PEscrow.BackupArbiterUpdated(backupArbiter, dave);
        vm.prank(owner);
        esc.setBackupArbiter(dave);
        assertEq(esc.backupArbiter(), dave);
        vm.prank(owner);
        vm.expectRevert(P2PEscrow.InvalidAddress.selector);
        esc.setBackupArbiter(address(0));
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, carol));
        esc.setBackupArbiter(alice);
    }

    function test_SetCurrency() public {
        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.CurrencyUpdated("USD", true);
        vm.prank(owner);
        esc.setCurrency("USD", true);
        assertTrue(esc.supportedCurrency("USD"));
        vm.prank(alice);
        esc.createAd(SELL, "USD", PRICE, 10e6, 1e6, 10e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "d");
        vm.prank(owner);
        esc.setCurrency("USD", false);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(P2PEscrow.UnsupportedCurrency.selector, bytes3("USD")));
        esc.createAd(SELL, "USD", PRICE, 10e6, 1e6, 10e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "d");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        esc.setCurrency("EUR", true);
    }

    // ---------------------------------------------------------------- pagination views
    function test_GetAdsAndOrders_Pagination() public {
        _makeMerchant(carol);
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
