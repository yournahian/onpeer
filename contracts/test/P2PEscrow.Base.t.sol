// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {P2PEscrow} from "../P2PEscrow.sol";

/// @dev Simple 6-decimal ERC20. `transfer` (used by escrow `_payout`) can be made to revert or
///      return false for chosen recipients; `transferFrom` is always normal.
contract MockUSDC is ERC20 {
    mapping(address => bool) public blocked;
    mapping(address => bool) public returnFalse;

    constructor() ERC20("Mock USDC", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address a, bool v) external {
        blocked[a] = v;
    }

    function setReturnFalse(address a, bool v) external {
        returnFalse[a] = v;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        require(!blocked[to], "blocked");
        if (returnFalse[to]) return false;
        return super.transfer(to, amount);
    }
}

abstract contract P2PEscrowTestBase is Test {
    MockUSDC internal usdc;
    P2PEscrow internal esc;

    address internal owner = makeAddr("owner");
    address internal arbiter = makeAddr("arbiter");
    address internal alice = makeAddr("alice"); // default maker
    address internal bob = makeAddr("bob"); // default taker
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");
    address internal stranger = makeAddr("stranger");

    uint8 internal constant SELL = 0;
    uint8 internal constant BUY = 1;
    bytes3 internal constant INR = "INR";
    uint128 internal constant PRICE = 90e6;
    uint256 internal constant T0 = 1_700_000_000;
    uint256 internal constant FUNDS = 1_000_000e6;

    uint256 internal nonce;

    function setUp() public virtual {
        vm.warp(T0);
        usdc = new MockUSDC();
        esc = new P2PEscrow(address(usdc), owner, arbiter);
        _fund(alice);
        _fund(bob);
        _fund(carol);
        _fund(dave);
        _fund(stranger);
        _fund(arbiter);
    }

    function _fund(address a) internal {
        usdc.mint(a, FUNDS);
        vm.prank(a);
        usdc.approve(address(esc), type(uint256).max);
    }

    function _newFunded() internal returns (address a) {
        a = address(uint160(0x100000 + ++nonce));
        _fund(a);
    }

    function _bal(address a) internal view returns (uint256) {
        return usdc.balanceOf(a);
    }

    struct AdP {
        uint8 side;
        uint128 price;
        uint128 total;
        uint128 min;
        uint128 max;
    }

    function _create(address maker, uint8 side, uint128 price, uint128 total, uint128 min, uint128 max)
        internal
        returns (uint256)
    {
        return _createP(maker, AdP(side, price, total, min, max));
    }

    function _createP(address maker, AdP memory p) internal returns (uint256 id) {
        string memory d = p.side == SELL ? "upi:maker@bank" : "";
        bytes memory data = abi.encodeWithSelector(
            P2PEscrow.createAd.selector, p.side, INR, p.price, p.total, p.min, p.max, uint32(1), uint16(60), uint32(0), d
        );
        vm.prank(maker);
        (bool ok, bytes memory ret) = address(esc).call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        id = abi.decode(ret, (uint256));
    }

    function _sell(address maker, uint128 total, uint128 min, uint128 max) internal returns (uint256) {
        return _createP(maker, AdP(SELL, PRICE, total, min, max));
    }

    function _buy(address maker, uint128 total, uint128 min, uint128 max) internal returns (uint256) {
        return _createP(maker, AdP(BUY, PRICE, total, min, max));
    }

    /// @dev Opens with limit == current ad price, which is always acceptable on both sides.
    function _open(address taker, uint256 adId, uint128 amount) internal returns (uint256) {
        uint128 limit = esc.getAd(adId).priceE6;
        vm.prank(taker);
        return esc.openOrder(adId, amount, limit, "bank:taker");
    }

    function _paid(uint256 orderId) internal {
        address buyer = esc.getOrder(orderId).buyer;
        vm.prank(buyer);
        esc.markPaid(orderId);
    }

    function _release(uint256 orderId) internal {
        address seller = esc.getOrder(orderId).seller;
        vm.prank(seller);
        esc.release(orderId);
    }

    function _cancel(address caller, uint256 orderId) internal {
        vm.prank(caller);
        esc.cancelOrder(orderId);
    }

    function _disputeBySeller(uint256 orderId) internal {
        address seller = esc.getOrder(orderId).seller;
        vm.prank(seller);
        esc.openDispute(orderId);
    }

    function _resolve(uint256 orderId, bool toBuyer, bool slash) internal {
        vm.prank(arbiter);
        esc.resolveDispute(orderId, toBuyer, slash);
    }

    /// @dev open -> paid -> disputed (by seller). Returns the order id.
    function _disputed(address taker, uint256 adId, uint128 amount) internal returns (uint256 oid) {
        oid = _open(taker, adId, amount);
        _paid(oid);
        _disputeBySeller(oid);
    }

    /// @dev Gives `a` ordersCompleted >= 1 by completing a 10 USDC trade with a fresh counterparty.
    function _qualify(address a) internal {
        address q = _newFunded();
        uint256 adId = _sell(q, 10e6, 10e6, 10e6);
        uint256 oid = _open(a, adId, 10e6);
        _paid(oid);
        _release(oid);
    }

    function _status(uint256 oid) internal view returns (P2PEscrow.OrderStatus) {
        return esc.getOrder(oid).status;
    }

    function _strikes(address a) internal view returns (uint8 s) {
        (,, s) = esc.penalties(a);
    }

    function _bannedUntil(address a) internal view returns (uint64 b) {
        (, b,) = esc.penalties(a);
    }
}
