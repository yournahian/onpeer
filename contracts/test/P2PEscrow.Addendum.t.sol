// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {P2PEscrow} from "../P2PEscrow.sol";
import {P2PEscrowTestBase} from "./P2PEscrow.Base.t.sol";

contract P2PEscrowAddendumTest is P2PEscrowTestBase {
    address internal verifierAddr = makeAddr("verifier");

    // ---------------------------------------------------------------- B. Listing fee & fee accrual
    function test_ListingFee_ChargedOnce_SellApprovesTotalPlusFee_BuyNeedsFeeInWallet() public {
        // 1) Sell maker who approves only totalAmount (missing 0.05 USDC fee) reverts
        address sellerOnlyTotal = makeAddr("sellerOnlyTotal");
        usdc.mint(sellerOnlyTotal, 100e6 + FEE);
        vm.prank(sellerOnlyTotal);
        usdc.approve(address(esc), 100e6); // short by FEE
        vm.prank(sellerOnlyTotal);
        vm.expectRevert();
        esc.createAd(SELL, INR, PRICE, 100e6, 10e6, 100e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "upi:s");

        // Approving totalAmount + FEE succeeds and pulls 100.05 USDC once
        vm.prank(sellerOnlyTotal);
        usdc.approve(address(esc), 100e6 + FEE);
        vm.prank(sellerOnlyTotal);
        uint256 sellAd =
            esc.createAd(SELL, INR, PRICE, 100e6, 10e6, 100e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "upi:s");
        assertEq(_bal(sellerOnlyTotal), 0);
        assertEq(esc.feesAccrued(), FEE);
        assertEq(esc.getAd(sellAd).available, 100e6);

        // 2) Buy maker with 0 USDC in wallet (qualified via 3 completed trades) reverts when posting Buy ad
        address brokeBuyerMaker = makeAddr("brokeBuyerMaker");
        _qualifyN(brokeBuyerMaker, 3);
        uint256 leftover = _bal(brokeBuyerMaker);
        if (leftover != 0) {
            vm.prank(brokeBuyerMaker);
            usdc.transfer(stranger, leftover);
        }
        assertEq(_bal(brokeBuyerMaker), 0);
        vm.prank(brokeBuyerMaker);
        usdc.approve(address(esc), type(uint256).max);
        vm.prank(brokeBuyerMaker);
        vm.expectRevert();
        esc.createAd(BUY, INR, PRICE, 50e6, 10e6, 50e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "");

        // Minting 0.05 USDC lets Buy maker post ad; pulls exactly 0.05 USDC
        usdc.mint(brokeBuyerMaker, FEE);
        vm.prank(brokeBuyerMaker);
        uint256 buyAd = esc.createAd(BUY, INR, PRICE, 50e6, 10e6, 50e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "");
        assertEq(_bal(brokeBuyerMaker), 0);
        assertEq(esc.getAd(buyAd).available, 50e6);
        assertEq(esc.feesAccrued(), FEE);
    }

    function test_ListingFee_NotRefundedOnCloseOrExpiry_RefreshAndTradesFree() public {
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        uint256 id = _sell(alice, 100e6, 10e6, 100e6);
        assertEq(esc.feesAccrued(), FEE);

        // Refresh is free
        uint256 aAfterCreate = _bal(alice);
        vm.prank(alice);
        esc.refreshAd(id, 48);
        assertEq(_bal(alice), aAfterCreate);
        assertEq(esc.feesAccrued(), FEE);

        // Trade charges 0 protocol fee to buyer or seller
        uint256 oid = _open(bob, id, 40e6);
        _paid(oid);
        _release(oid);
        assertEq(_bal(bob), b0 + 40e6);
        assertEq(esc.feesAccrued(), FEE);

        // Expire ad, then closeAd: remaining 60 USDC refunded, 0.05 USDC listing fee NOT refunded
        vm.warp(uint256(esc.getAd(id).expiresAt) + 1 hours);
        vm.prank(alice);
        esc.closeAd(id);
        assertEq(_bal(alice), a0 - 40e6 - FEE);
        assertEq(esc.feesAccrued(), FEE);
        assertEq(_bal(address(esc)), FEE);
    }

    function test_ListingFee_SetCap_ZeroFee_Recipient_CollectFees_And_BlockedRecipient() public {
        // Non-owner rejected
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        esc.setListingFee(100_000);

        // Above MAX_LISTING_FEE (0.50 USDC = 500_000) rejected
        vm.prank(owner);
        vm.expectRevert(P2PEscrow.InvalidFee.selector);
        esc.setListingFee(500_001);

        // At cap 500_000 accepted; only affects new ads
        uint256 adBefore = _sell(alice, 20e6, 1e6, 20e6);
        assertEq(esc.feesAccrued(), 50_000);

        vm.expectEmit(false, false, false, true, address(esc));
        emit P2PEscrow.ListingFeeUpdated(50_000, 500_000);
        vm.prank(owner);
        esc.setListingFee(500_000);
        assertEq(esc.listingFee(), 500_000);

        _sell(alice, 20e6, 1e6, 20e6);
        assertEq(esc.feesAccrued(), 550_000);

        // Closing earlier ad still does not refund anything extra
        vm.prank(alice);
        esc.closeAd(adBefore);
        assertEq(esc.feesAccrued(), 550_000);

        // Fee = 0 allowed and skips fee transfer on Buy ad
        vm.prank(owner);
        esc.setListingFee(0);
        _makeMerchant(carol);
        uint256 c0 = _bal(carol);
        vm.prank(carol);
        esc.createAd(BUY, INR, PRICE, 20e6, 1e6, 20e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "");
        assertEq(_bal(carol), c0);

        // setFeeRecipient validation
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        esc.setFeeRecipient(dave);
        vm.prank(owner);
        vm.expectRevert(P2PEscrow.InvalidAddress.selector);
        esc.setFeeRecipient(address(0));

        address treasury = makeAddr("treasury");
        vm.expectEmit(true, true, false, true, address(esc));
        emit P2PEscrow.FeeRecipientUpdated(owner, treasury);
        vm.prank(owner);
        esc.setFeeRecipient(treasury);
        assertEq(esc.feeRecipient(), treasury);

        // Anyone can collectFees; if recipient is blocked, defers to claimable[treasury] via _payout
        usdc.setBlocked(treasury, true);
        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.FeesCollected(treasury, 550_000);
        vm.expectEmit(true, false, false, true, address(esc));
        emit P2PEscrow.PayoutDeferred(treasury, 550_000);
        vm.prank(stranger);
        esc.collectFees();

        assertEq(esc.feesAccrued(), 0);
        assertEq(esc.claimable(treasury), 550_000);
        assertEq(_bal(treasury), 0);
        // Escrow still holds 20e6 (2nd sell ad) + 100e6 (carol margin) + 550_000 (treasury claimable)
        assertEq(_bal(address(esc)), 20e6 + 100e6 + 550_000);

        // Calling collectFees when feesAccrued == 0 reverts NothingToWithdraw
        vm.prank(stranger);
        vm.expectRevert(P2PEscrow.NothingToWithdraw.selector);
        esc.collectFees();

        // Unblock treasury and withdrawClaimable
        usdc.setBlocked(treasury, false);
        vm.prank(treasury);
        esc.withdrawClaimable();
        assertEq(_bal(treasury), 550_000);
        assertEq(esc.claimable(treasury), 0);
    }

    // ---------------------------------------------------------------- A & J.2: applyBond, takeCase & resolve from Paid
    function test_ResolveDispute_ApplyBondFalse_NoBondNoDebt_SlashStillIndependent() public {
        uint256 adId = _sell(alice, 200e6, 10e6, 200e6);

        // 1) applyBond = false, slashLoser = false -> loser has 0 debt and keeps all margin
        vm.prank(alice);
        esc.depositMargin(50e6);
        uint256 b0 = _bal(bob);
        uint256 oid1 = _disputed(bob, adId, 60e6);
        _resolve4(oid1, true, false, false);

        assertEq(_bal(bob), b0 + 60e6);
        assertEq(esc.margin(alice), 50e6);
        assertEq(esc.totalDebt(alice), 0);
        assertEq(esc.getStats(alice).disputesLost, 1);

        // Waive alice's 1st loss so she can take another order
        vm.prank(arbiter);
        esc.setDisputeWaiver(alice, true);

        // 2) applyBond = false, slashLoser = true -> slashes up to order amount (40e6), still 0 bond/debt
        uint256 c0 = _bal(carol);
        uint256 oid2 = _disputed(carol, adId, 40e6);
        _resolve4(oid2, true, true, false);

        assertEq(_bal(carol), c0 + 40e6 + 40e6);
        assertEq(esc.margin(alice), 10e6);
        assertEq(esc.totalDebt(alice), 0);
    }

    function test_TakeCase_And_ResolveFromPaid_15MinRule_And_BackupArbiter7Days() public {
        uint256 adId = _sell(alice, 300e6, 10e6, 200e6);

        // Order 1: Paid (no onchain openDispute) -> arbiter blocked < 15m, allowed at 15m for takeCase
        uint256 oid1 = _open(bob, adId, 20e6);
        _paid(oid1);
        uint64 paidAt1 = esc.getOrder(oid1).paidAt;

        vm.prank(stranger);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.takeCase(oid1);

        vm.prank(arbiter);
        vm.expectRevert(P2PEscrow.TooEarly.selector);
        esc.takeCase(oid1);

        vm.warp(uint256(paidAt1) + 15 minutes - 1);
        vm.prank(arbiter);
        vm.expectRevert(P2PEscrow.TooEarly.selector);
        esc.takeCase(oid1);

        uint64 t1 = uint64(uint256(paidAt1) + 15 minutes);
        vm.warp(t1);
        vm.expectEmit(true, true, false, true, address(esc));
        emit P2PEscrow.OrderDisputed(oid1, arbiter, t1);
        vm.expectEmit(true, true, false, true, address(esc));
        emit P2PEscrow.CaseTaken(oid1, arbiter, t1);
        vm.prank(arbiter);
        esc.takeCase(oid1);

        P2PEscrow.Order memory o1 = esc.getOrder(oid1);
        assertEq(uint8(o1.status), uint8(P2PEscrow.OrderStatus.Disputed));
        assertEq(o1.disputedAt, t1);
        assertEq(o1.reviewStartedAt, t1);

        // Order 2: Seller opened dispute immediately -> arbiter can takeCase at paidAt + 0 without 15m wait!
        uint256 oid2 = _open(bob, adId, 20e6);
        _paid(oid2);
        _disputeBySeller(oid2);
        vm.prank(arbiter);
        esc.takeCase(oid2);
        assertEq(esc.getOrder(oid2).reviewStartedAt, t1);

        // Order 3: Direct resolveDispute from Paid at 15m (behaves as takeCase + resolve)
        uint256 oid3 = _open(carol, adId, 30e6);
        _paid(oid3);
        uint64 paidAt3 = esc.getOrder(oid3).paidAt;
        uint64 t3 = uint64(uint256(paidAt3) + 15 minutes);
        vm.warp(t3);
        uint256 c0 = _bal(carol);
        _resolve4(oid3, true, false, false);
        assertEq(uint8(_status(oid3)), uint8(P2PEscrow.OrderStatus.ResolvedToBuyer));
        assertEq(_bal(carol), c0 + 30e6);
        assertEq(esc.getOrder(oid3).reviewStartedAt, t3);

        // Order 4: Backup arbiter acting on Paid (no onchain dispute) -> anchor is paidAt + 7 days
        vm.prank(arbiter);
        esc.setDisputeWaiver(alice, true);
        uint256 oid4 = _open(dave, adId, 20e6);
        _paid(oid4);
        uint64 paidAt4 = esc.getOrder(oid4).paidAt;

        vm.warp(uint256(paidAt4) + 7 days - 1);
        vm.prank(backupArbiter);
        vm.expectRevert(P2PEscrow.TooEarly.selector);
        esc.takeCase(oid4);
        vm.prank(backupArbiter);
        vm.expectRevert(P2PEscrow.TooEarly.selector);
        esc.resolveDispute(oid4, true, false, false);

        vm.warp(uint256(paidAt4) + 7 days);
        vm.prank(backupArbiter);
        esc.resolveDispute(oid4, true, false, false);
        assertEq(uint8(_status(oid4)), uint8(P2PEscrow.OrderStatus.ResolvedToBuyer));

        // ArbiterIsParty enforced on takeCase too
        uint256 arbAd = _sell(arbiter, 20e6, 10e6, 20e6);
        uint256 oid5 = _open(bob, arbAd, 10e6);
        _paid(oid5);
        vm.warp(block.timestamp + 20 minutes);
        vm.prank(arbiter);
        vm.expectRevert(P2PEscrow.ArbiterIsParty.selector);
        esc.takeCase(oid5);
    }

    // ---------------------------------------------------------------- A, J.1 & J.5: Cooling-off, Concessions & Waiver
    function test_CoolingOffBoundary_TwoConcessionsEqualOneLoss_PostReviewLossNoBond_And_WaiverReset() public {
        uint256 adId = _sell(alice, 500e6, 10e6, 200e6);
        vm.prank(alice);
        esc.refreshAd(adId, 168);

        // 1) Boundary at EXACTLY disputedAt + 30 minutes -> clean settlement, 0 concessions, 0 strikes, 0 bond
        uint256 oid1 = _disputed(bob, adId, 20e6);
        uint64 d1 = esc.getOrder(oid1).disputedAt;
        vm.warp(uint256(d1) + 30 minutes);
        _cancel(bob, oid1);
        assertEq(uint8(_status(oid1)), uint8(P2PEscrow.OrderStatus.Settled));
        assertEq(esc.getStats(bob).concessions, 0);
        assertEq(esc.getStats(bob).disputesLost, 0);
        assertEq(_strikes(bob), 0);
        assertEq(esc.totalDebt(bob), 0);
        assertEq(esc.getStats(bob).ordersCompleted, 0);
        assertEq(esc.getStats(bob).volume, 0);

        // 2) At disputedAt + 30 minutes + 1 -> 1st concession (not yet 1 lost dispute -> bob NOT restricted)
        uint256 oid2 = _disputed(bob, adId, 20e6);
        vm.warp(uint256(esc.getOrder(oid2).disputedAt) + 30 minutes + 1);
        _cancel(bob, oid2);
        assertEq(esc.getStats(bob).concessions, 1);
        assertEq(esc.getAccount(bob).concessions, 1);
        assertFalse(esc.isDisputeLimitReached(bob));
        assertEq(esc.totalDebt(bob), 0);

        // 3) 2nd concession after cooling-off -> 2 concessions == 1 lost dispute -> bob (<3 trades) restricted, 0 bond!
        uint256 oid3 = _disputed(bob, adId, 20e6);
        vm.warp(uint256(esc.getOrder(oid3).disputedAt) + 30 minutes + 1);
        _cancel(bob, oid3);
        assertEq(esc.getStats(bob).concessions, 2);
        assertTrue(esc.isDisputeLimitReached(bob));
        assertEq(esc.totalDebt(bob), 0);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.Restricted.selector);
        esc.openOrder(adId, 10e6, PRICE, bytes32(0), "");

        // 4) J.5: Arbiter waives bob; 3rd concession (effective still 1) keeps waiver; 4th concession (effective -> 2) clears waiver!
        vm.prank(arbiter);
        esc.setDisputeWaiver(bob, true);
        assertFalse(esc.isDisputeLimitReached(bob));

        vm.prank(alice);
        esc.refreshAd(adId, 168);
        uint256 oid4 = _disputed(bob, adId, 20e6);
        vm.warp(uint256(esc.getOrder(oid4).disputedAt) + 31 minutes);
        _cancel(bob, oid4); // concessions = 3 -> effectiveLosses still 1 -> waiver NOT cleared
        assertTrue(esc.disputeLimitWaived(bob));
        assertFalse(esc.isDisputeLimitReached(bob));

        uint256 oid5 = _disputed(bob, adId, 20e6);
        vm.warp(uint256(esc.getOrder(oid5).disputedAt) + 31 minutes);
        _cancel(bob, oid5); // concessions = 4 -> effectiveLosses = 2 -> waiver CLEARED!
        assertFalse(esc.disputeLimitWaived(bob));
        assertTrue(esc.isDisputeLimitReached(bob));

        // 5) J.1 & J.5: Settlement AFTER arbiter called takeCase (even within 30m!) records disputesLost++ and NO bond, clearing waiver!
        vm.prank(arbiter);
        esc.setDisputeWaiver(bob, true);
        vm.prank(alice);
        esc.depositMargin(50e6); // verify seller margin is NOT touched on post-review concession either

        uint256 oid6 = _disputed(carol, adId, 40e6);
        vm.prank(arbiter);
        esc.takeCase(oid6); // reviewStartedAt != 0 immediately
        // Seller releases 1 minute after dispute while in review -> alice gets disputesLost++ and NO bond!
        _release(oid6);
        assertEq(uint8(_status(oid6)), uint8(P2PEscrow.OrderStatus.Settled));
        assertEq(esc.getStats(alice).disputesLost, 1);
        assertEq(esc.getStats(alice).concessions, 0);
        assertEq(esc.margin(alice), 50e6);
        assertEq(esc.totalDebt(alice), 0);
        assertTrue(esc.isDisputeLimitReached(alice));

        // Waive alice, then bob settles after takeCase -> bob gets disputesLost++, waiver cleared, NO bond!
        vm.prank(arbiter);
        esc.setDisputeWaiver(alice, true);
        uint256 oid7 = _disputed(bob, adId, 20e6);
        vm.prank(arbiter);
        esc.takeCase(oid7);
        _cancel(bob, oid7);
        assertEq(esc.getStats(bob).disputesLost, 1);
        assertFalse(esc.disputeLimitWaived(bob));
        assertTrue(esc.isDisputeLimitReached(bob));
        assertEq(esc.totalDebt(bob), 0);
    }

    // ---------------------------------------------------------------- C & J.4: KYC, Verifier Isolation & Level-2 Uplift
    function test_KycGating_BothSidesInOpenOrder_Expiry_Revoke_And_ExitsNeverBlocked() public {
        // Configure verifier (owner only)
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        esc.setVerifier(verifierAddr);

        vm.expectEmit(true, true, false, true, address(esc));
        emit P2PEscrow.VerifierUpdated(address(0), verifierAddr);
        vm.prank(owner);
        esc.setVerifier(verifierAddr);
        assertEq(esc.verifier(), verifierAddr);

        // Only verifier can setVerification; level 0 or past/present expiry rejected
        vm.prank(owner);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.setVerification(alice, 1, uint64(block.timestamp + 30 days));

        vm.startPrank(verifierAddr);
        vm.expectRevert(P2PEscrow.InvalidAddress.selector);
        esc.setVerification(address(0), 1, uint64(block.timestamp + 30 days));
        vm.expectRevert(P2PEscrow.InvalidVerification.selector);
        esc.setVerification(alice, 0, uint64(block.timestamp + 30 days));
        vm.expectRevert(P2PEscrow.InvalidVerification.selector);
        esc.setVerification(alice, 1, uint64(block.timestamp));
        vm.stopPrank();

        // Open an ad & Paid order BEFORE turning kycRequired on so we can test exits while unverified
        uint256 preAd = _sell(dave, 50e6, 10e6, 50e6);
        uint256 preOrder = _open(carol, preAd, 20e6);
        _paid(preOrder);
        vm.startPrank(dave);
        esc.depositMargin(40e6);
        esc.requestMarginWithdrawal(40e6);
        vm.stopPrank();

        // Enable kycRequired
        vm.prank(owner);
        esc.setKycRequired(true);
        assertTrue(esc.kycRequired());

        // Unverified createAd & openOrder revert NotVerified
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.NotVerified.selector);
        esc.createAd(SELL, INR, PRICE, 50e6, 10e6, 50e6, 1, 60, 0, DEFAULT_TTL, 0, bytes32(0), "upi:alice");

        vm.prank(bob);
        vm.expectRevert(P2PEscrow.NotVerified.selector);
        esc.openOrder(preAd, 10e6, PRICE, bytes32(0), "");

        // Verify alice (expires in 10 days) -> alice can createAd, but unverified bob still blocked in openOrder
        uint64 expAlice = uint64(block.timestamp + 10 days);
        vm.prank(verifierAddr);
        esc.setVerification(alice, 1, expAlice);
        assertTrue(esc.isVerified(alice));
        (uint8 lvl, uint64 expOut) = esc.verification(alice);
        assertEq(lvl, 1);
        assertEq(expOut, expAlice);

        uint256 kycAd = _sell(alice, 100e6, 10e6, 100e6);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.NotVerified.selector);
        esc.openOrder(kycAd, 10e6, PRICE, bytes32(0), "");

        // Verify bob -> now BOTH maker & taker verified -> openOrder succeeds
        vm.prank(verifierAddr);
        esc.setVerification(bob, 1, uint64(block.timestamp + 30 days));
        uint256 kycOrder = _open(bob, kycAd, 10e6);
        _paid(kycOrder);
        _release(kycOrder);

        // J.4: If maker (alice) expires or is revoked, verified bob CANNOT openOrder against alice's ad!
        vm.warp(uint256(expAlice) + 1);
        assertFalse(esc.isVerified(alice));
        vm.prank(alice);
        esc.refreshAd(kycAd, 168); // refresh still allowed
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.NotVerified.selector);
        esc.openOrder(kycAd, 10e6, PRICE, bytes32(0), "");

        // Re-verify alice, then owner revokes alice -> openOrder blocked again; stranger cannot revoke
        vm.prank(verifierAddr);
        esc.setVerification(alice, 1, uint64(vm.getBlockTimestamp() + 20 days));
        vm.prank(stranger);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.revokeVerification(alice);
        vm.prank(owner);
        esc.revokeVerification(alice);
        assertFalse(esc.isVerified(alice));
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.NotVerified.selector);
        esc.openOrder(kycAd, 10e6, PRICE, bytes32(0), "");

        // Unverified dave & carol can still finish preOrder, closeAd, completeMarginWithdrawal, and collectFees!
        _release(preOrder);
        vm.prank(dave);
        esc.closeAd(preAd);
        vm.warp(vm.getBlockTimestamp() + 7 days);
        vm.prank(dave);
        esc.completeMarginWithdrawal();
        esc.collectFees();
    }

    function test_Verifier_CannotMoveFundsOrRuleOrAdmin() public {
        vm.prank(owner);
        esc.setVerifier(verifierAddr);
        uint256 adId = _sell(alice, 100e6, 10e6, 100e6);
        uint256 oid = _disputed(bob, adId, 20e6);

        vm.startPrank(verifierAddr);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, verifierAddr));
        esc.pause();
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, verifierAddr));
        esc.setListingFee(0);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, verifierAddr));
        esc.setFeeRecipient(verifierAddr);
        vm.expectRevert(P2PEscrow.NotAdmin.selector);
        esc.setRestricted(alice, true);
        vm.expectRevert(P2PEscrow.NotAdmin.selector);
        esc.setDisputeWaiver(alice, true);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.takeCase(oid);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.resolveDispute(oid, true, false, false);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.release(oid);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.cancelOrder(oid);
        vm.expectRevert(P2PEscrow.Unauthorized.selector);
        esc.closeAd(adId);
        vm.stopPrank();
    }

    function test_Level2Kyc_CapUplift_And_ExpiryRevertsUplift() public {
        vm.prank(owner);
        esc.setVerifier(verifierAddr);
        usdc.mint(alice, 10_000e6);
        uint256 bigAd = _sell(alice, 10_000e6, 10e6, 10_000e6);

        // 0 trades: Level 1 stays Tier 0 (200 USDC); Level 2 lifts to Tier 1 (500 USDC)
        vm.prank(verifierAddr);
        esc.setVerification(bob, 1, uint64(block.timestamp + 10 days));
        assertEq(esc.orderCap(bob), 200e6);
        assertEq(esc.getAccount(bob).tier, 0);

        vm.prank(verifierAddr);
        esc.setVerification(bob, 2, uint64(block.timestamp + 10 days));
        assertEq(esc.orderCap(bob), 500e6);
        assertEq(esc.getAccount(bob).tier, 1);
        _cancel(bob, _open(bob, bigAd, 500e6));

        // 1 trade (< 7 days age): base Tier 1 -> Level 2 lifts to Tier 2 (2,000 USDC)
        _qualify(bob);
        assertEq(esc.orderCap(bob), 2_000e6);
        assertEq(esc.getAccount(bob).tier, 2);
        _release(_open(bob, bigAd, 2_000e6));

        // 5 trades + 7 days age: base Tier 2 -> Level 2 lifts to Tier 3 (uncapped)
        _qualifyN(bob, 4);
        vm.warp(uint256(esc.getStats(bob).firstSeen) + 7 days);
        vm.prank(alice);
        esc.refreshAd(bigAd, 168);
        assertEq(esc.orderCap(bob), type(uint256).max);
        assertEq(esc.getAccount(bob).tier, 3);
        _release(_open(bob, bigAd, 3_000e6));

        // Once Level-2 KYC expires, bob drops back to base Tier 2 (2,000 USDC)
        vm.warp(vm.getBlockTimestamp() + 10 days);
        assertEq(esc.orderCap(bob), 2_000e6);
        assertEq(esc.getAccount(bob).tier, 2);
    }

    // ---------------------------------------------------------------- D & J.6: Late-mark proof & 30d limit
    function test_LateMark_RequiresProof_And_Rolling30DayLimit() public {
        uint256 adId = _sell(alice, 200e6, 1e6, 200e6);
        vm.prank(alice);
        esc.refreshAd(adId, 168);

        // Late mark #1: requires payerProof != 0 even with payerProofRequired == false
        uint256 o1 = _open(bob, adId, 5e6);
        vm.warp(uint256(esc.getOrder(o1).deadline) + 10);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.PayerProofRequired.selector);
        esc.markPaid(o1, bytes32(0));

        vm.prank(bob);
        esc.markPaid(o1, keccak256("TX-1"));
        assertEq(esc.getAccount(bob).lateMarks, 1);
        _release(o1);

        // Late mark #2 (within 30 days): allowed -> lateMarks == 2
        vm.prank(alice);
        esc.refreshAd(adId, 168);
        uint256 o2 = _open(bob, adId, 5e6);
        vm.warp(uint256(esc.getOrder(o2).deadline) + 20);
        vm.prank(bob);
        esc.markPaid(o2, keccak256("TX-2"));
        assertEq(esc.getAccount(bob).lateMarks, 2);
        _release(o2);

        // Late mark #3 (still within 30 days): reverts LateMarkLimit!
        vm.prank(alice);
        esc.refreshAd(adId, 168);
        uint256 o3 = _open(bob, adId, 5e6);
        uint256 oOnTime = _open(bob, adId, 5e6);
        // On-time markPaid is still allowed even when at late-mark limit
        _paid(oOnTime);
        _release(oOnTime);

        vm.warp(uint256(esc.getOrder(o3).deadline) + 15);
        vm.prank(bob);
        vm.expectRevert(P2PEscrow.LateMarkLimit.selector);
        esc.markPaid(o3, keccak256("TX-3"));
        _cancel(bob, o3);

        // After 30 days from first late mark: rolling window resets -> late mark allowed again!
        vm.warp(vm.getBlockTimestamp() + 30 days + 1);
        assertEq(esc.getAccount(bob).lateMarks, 0);
        vm.prank(alice);
        esc.refreshAd(adId, 168);
        uint256 o4 = _open(bob, adId, 5e6);
        vm.warp(uint256(esc.getOrder(o4).deadline) + 15);
        vm.prank(bob);
        esc.markPaid(o4, keccak256("TX-4"));
        assertEq(esc.getAccount(bob).lateMarks, 1);
    }

    // ---------------------------------------------------------------- E: detailsMode validation
    function test_DetailsMode_InvalidReverts_And_Mode2StrikeOnCancel() public {
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.InvalidDetailsMode.selector);
        esc.createAd(SELL, INR, PRICE, 50e6, 1e6, 50e6, 1, 30, 0, DEFAULT_TTL, 3, bytes32(0), "upi");

        // Mode 2 when sealedEnabled == false reverts SealedDisabled
        vm.prank(alice);
        vm.expectRevert(P2PEscrow.SealedDisabled.selector);
        esc.createAd(SELL, INR, PRICE, 50e6, 1e6, 50e6, 1, 30, 0, DEFAULT_TTL, 2, keccak256("v"), "");

        // Enable sealedEnabled: Mode 2 sets detailsReady = true immediately, so buyer cancel adds a strike
        vm.prank(owner);
        esc.setSealedEnabled(true);
        vm.prank(alice);
        uint256 adId = esc.createAd(SELL, INR, PRICE, 50e6, 1e6, 50e6, 1, 30, 0, DEFAULT_TTL, 2, keccak256("v"), "");
        vm.prank(bob);
        uint256 oid = esc.openOrder(adId, 10e6, PRICE, bytes32(0), "");
        _cancel(bob, oid);
        assertEq(_strikes(bob), 1);
    }
}
