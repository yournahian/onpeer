// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {P2PEscrow} from "../P2PEscrow.sol";
import {P2PEscrowTestBase, MockUSDC} from "./P2PEscrow.Base.t.sol";

/// @dev Drives bounded random actions through the escrow as a fixed set of users.
contract P2PEscrowHandler is Test {
    P2PEscrow public esc;
    MockUSDC public usdc;
    address public arbiter;
    address[] public users;

    uint256 public okCalls;

    constructor(P2PEscrow esc_, MockUSDC usdc_, address arbiter_, address[] memory users_) {
        esc = esc_;
        usdc = usdc_;
        arbiter = arbiter_;
        users = users_;
    }

    function usersLength() external view returns (uint256) {
        return users.length;
    }

    function _u(uint256 seed) internal view returns (address) {
        return users[seed % users.length];
    }

    function _oid(uint256 seed) internal view returns (uint256) {
        uint256 n = esc.orderCount();
        return n == 0 ? 0 : bound(seed, 1, n);
    }

    function _aid(uint256 seed) internal view returns (uint256) {
        uint256 n = esc.adCount();
        return n == 0 ? 0 : bound(seed, 1, n);
    }

    function _create(address u, uint8 side, uint128 price, uint128 total, uint128 mn, uint128 mx) private {
        bytes memory data = abi.encodeWithSelector(
            P2PEscrow.createAd.selector, side, bytes3("INR"), price, total, mn, mx, uint32(1), uint16(60), uint32(0), "d"
        );
        vm.prank(u);
        (bool ok,) = address(esc).call(data);
        if (ok) ++okCalls;
    }

    function createAd(uint256 seed, uint256 side, uint256 price, uint256 total, uint256 mn, uint256 mx) external {
        uint128 t = uint128(bound(total, 1e6, 600e6));
        uint128 lo = uint128(bound(mn, 1, t));
        uint128 hi = uint128(bound(mx, lo, t));
        _create(_u(seed), uint8(side % 2), uint128(bound(price, 1, 1e9)), t, lo, hi);
    }

    function openOrder(uint256 seed, uint256 adSeed, uint256 amount) external {
        uint256 id = _aid(adSeed);
        if (id == 0) return;
        uint128 price = esc.getAd(id).priceE6;
        vm.prank(_u(seed));
        try esc.openOrder(id, uint128(bound(amount, 1, 250e6)), price, "pay") {
            ++okCalls;
        } catch {}
    }

    function markPaid(uint256 oSeed) external {
        uint256 id = _oid(oSeed);
        if (id == 0) return;
        vm.prank(esc.getOrder(id).buyer);
        try esc.markPaid(id) {
            ++okCalls;
        } catch {}
    }

    function release(uint256 oSeed) external {
        uint256 id = _oid(oSeed);
        if (id == 0) return;
        vm.prank(esc.getOrder(id).seller);
        try esc.release(id) {
            ++okCalls;
        } catch {}
    }

    function cancelOrder(uint256 seed, uint256 oSeed) external {
        uint256 id = _oid(oSeed);
        if (id == 0) return;
        vm.prank(_u(seed));
        try esc.cancelOrder(id) {
            ++okCalls;
        } catch {}
    }

    function openDispute(uint256 oSeed, bool bySeller) external {
        uint256 id = _oid(oSeed);
        if (id == 0) return;
        P2PEscrow.Order memory o = esc.getOrder(id);
        vm.prank(bySeller ? o.seller : o.buyer);
        try esc.openDispute(id) {
            ++okCalls;
        } catch {}
    }

    function resolveDispute(uint256 oSeed, bool toBuyer, bool slash) external {
        uint256 id = _oid(oSeed);
        if (id == 0) return;
        vm.prank(arbiter);
        try esc.resolveDispute(id, toBuyer, slash) {
            ++okCalls;
        } catch {}
    }

    function closeAd(uint256 adSeed) external {
        uint256 id = _aid(adSeed);
        if (id == 0) return;
        vm.prank(esc.getAd(id).maker);
        try esc.closeAd(id) {
            ++okCalls;
        } catch {}
    }

    function depositMargin(uint256 seed, uint256 amount) external {
        vm.prank(_u(seed));
        try esc.depositMargin(bound(amount, 1, 300e6)) {
            ++okCalls;
        } catch {}
    }

    function requestMarginWithdrawal(uint256 seed, uint256 amount) external {
        address u = _u(seed);
        uint256 m = esc.margin(u);
        if (m == 0) return;
        vm.prank(u);
        try esc.requestMarginWithdrawal(bound(amount, 1, m)) {
            ++okCalls;
        } catch {}
    }

    function cancelMarginWithdrawal(uint256 seed) external {
        vm.prank(_u(seed));
        try esc.cancelMarginWithdrawal() {
            ++okCalls;
        } catch {}
    }

    function completeMarginWithdrawal(uint256 seed) external {
        vm.prank(_u(seed));
        try esc.completeMarginWithdrawal() {
            ++okCalls;
        } catch {}
    }

    function withdrawClaimable(uint256 seed) external {
        vm.prank(_u(seed));
        try esc.withdrawClaimable() {
            ++okCalls;
        } catch {}
    }

    function setBlocked(uint256 seed, bool v) external {
        usdc.setBlocked(_u(seed), v);
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 3 days));
    }
}

/// forge-config: default.invariant.runs = 64
/// forge-config: default.invariant.depth = 150
contract P2PEscrowInvariantTest is P2PEscrowTestBase {
    P2PEscrowHandler internal handler;
    address[] internal actors;

    function setUp() public override {
        super.setUp();
        actors.push(alice);
        actors.push(bob);
        actors.push(carol);
        actors.push(dave);
        actors.push(stranger);
        handler = new P2PEscrowHandler(esc, usdc, arbiter, actors);
        targetContract(address(handler));
    }

    function _liveOrderStats() internal view returns (uint256 amounts, uint256 count) {
        P2PEscrow.Order[] memory orders = esc.getOrders(0, esc.orderCount());
        for (uint256 i; i < orders.length; ++i) {
            P2PEscrow.OrderStatus s = orders[i].status;
            if (
                s == P2PEscrow.OrderStatus.Pending || s == P2PEscrow.OrderStatus.Paid
                    || s == P2PEscrow.OrderStatus.Disputed
            ) {
                amounts += orders[i].amount;
                ++count;
            }
        }
    }

    /// @dev Escrow USDC == Sell inventory + live order amounts + margin + claimable.
    function invariant_EscrowBalanceConserved() public view {
        uint256 expected;
        P2PEscrow.Ad[] memory ads = esc.getAds(0, esc.adCount());
        for (uint256 i; i < ads.length; ++i) {
            if (ads[i].side == P2PEscrow.Side.Sell) expected += ads[i].available;
        }
        (uint256 live,) = _liveOrderStats();
        expected += live;
        for (uint256 i; i < actors.length; ++i) {
            expected += esc.margin(actors[i]) + esc.claimable(actors[i]);
        }
        assertEq(_bal(address(esc)), expected);
    }

    function invariant_OpenCountersMatchLiveOrders() public view {
        (, uint256 count) = _liveOrderStats();
        uint256 party;
        uint256 taker;
        for (uint256 i; i < actors.length; ++i) {
            party += esc.partyOpenOrders(actors[i]);
            taker += esc.openOrderCount(actors[i]);
            assertLe(esc.openOrderCount(actors[i]), 5);
        }
        assertEq(party, count * 2);
        assertEq(taker, count);
    }

    function invariant_PendingWithdrawalNeverExceedsMargin() public view {
        for (uint256 i; i < actors.length; ++i) {
            (uint128 pend,) = esc.marginWithdrawal(actors[i]);
            assertLe(pend, esc.margin(actors[i]));
        }
    }

    function invariant_ClosedAdsHoldNoInventory() public view {
        P2PEscrow.Ad[] memory ads = esc.getAds(0, esc.adCount());
        for (uint256 i; i < ads.length; ++i) {
            if (ads[i].closed) assertEq(ads[i].available, 0);
            assertLe(ads[i].available, ads[i].initialAmount);
        }
    }

    function invariant_StrikesBelowLimit() public view {
        for (uint256 i; i < actors.length; ++i) {
            assertLt(_strikes(actors[i]), esc.MAX_CANCEL_STRIKES());
        }
    }
}
