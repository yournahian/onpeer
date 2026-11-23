// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {P2PEscrow} from "../P2PEscrow.sol";

contract MockDecToken is ERC20 {
    uint8 private immutable _dec;

    constructor(string memory name_, string memory sym_, uint8 dec_) ERC20(name_, sym_) {
        _dec = dec_;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract P2PEscrowMultiDecimalsTest is Test {
    address internal owner = makeAddr("owner");
    address internal arbiter = makeAddr("arbiter");
    address internal backupArbiter = makeAddr("backupArbiter");
    address internal seller = makeAddr("seller");
    address internal buyer = makeAddr("buyer");

    function test_cirBtc8DecimalsExactFiatAndCaps() public {
        MockDecToken btc = new MockDecToken("Circle BTC", "cirBTC", 8);
        P2PEscrow esc = new P2PEscrow(address(btc), owner, arbiter, backupArbiter);

        assertEq(esc.listingFee(), 50); // 0.00000050 cirBTC
        assertEq(esc.orderCap(buyer), 200_000); // 0.0020 cirBTC Starter cap

        btc.mint(seller, 1e8); // 1 cirBTC
        vm.startPrank(seller);
        btc.approve(address(esc), type(uint256).max);
        // Sell 0.01 cirBTC (1_000_000 sats) at 11,500,000 BDT/BTC (priceE6 = 11_500_000e6)
        uint256 adId = esc.createAd(
            0,
            "BDT",
            uint128(11_500_000e6),
            uint128(1_000_000),
            uint128(50_000),
            uint128(200_000),
            1,
            30,
            0,
            72,
            0,
            bytes32(0),
            "bkash:01700000000"
        );
        vm.stopPrank();

        // Buyer opens order for 0.001 cirBTC (100_000 sats) -> expected fiat = 11,500 BDT (11_500e6)
        vm.prank(buyer);
        uint256 orderId = esc.openOrder(adId, uint128(100_000), uint128(11_500_000e6), bytes32(0), "");

        P2PEscrow.Order memory o = esc.getOrder(orderId);
        assertEq(o.fiatAmountE6, 11_500e6);

        vm.prank(buyer);
        esc.markPaid(orderId, bytes32(uint256(1)));

        vm.prank(seller);
        esc.release(orderId);

        assertEq(btc.balanceOf(buyer), 100_000);
    }

    function test_weth18DecimalsExactFiatAndCaps() public {
        MockDecToken weth = new MockDecToken("Wrapped Ether", "WETH", 18);
        P2PEscrow esc = new P2PEscrow(address(weth), owner, arbiter, backupArbiter);

        assertEq(esc.listingFee(), 20_000_000_000_000); // 0.00002 WETH
        assertEq(esc.orderCap(buyer), 80_000_000_000_000_000); // 0.08 WETH Starter cap

        weth.mint(seller, 2 ether);
        vm.startPrank(seller);
        weth.approve(address(esc), type(uint256).max);
        // Sell 0.5 WETH at 380,000 BDT/WETH (priceE6 = 380_000e6)
        uint256 adId = esc.createAd(
            0,
            "BDT",
            uint128(380_000e6),
            uint128(0.5 ether),
            uint128(0.01 ether),
            uint128(0.08 ether),
            1,
            30,
            0,
            72,
            0,
            bytes32(0),
            "bkash:01700000000"
        );
        vm.stopPrank();

        // Buyer opens order for 0.05 WETH -> expected fiat = 19,000 BDT (19_000e6)
        vm.prank(buyer);
        uint256 orderId = esc.openOrder(adId, uint128(0.05 ether), uint128(380_000e6), bytes32(0), "");

        P2PEscrow.Order memory o = esc.getOrder(orderId);
        assertEq(o.fiatAmountE6, 19_000e6);

        vm.prank(buyer);
        esc.markPaid(orderId, bytes32(uint256(1)));

        vm.prank(seller);
        esc.release(orderId);

        assertEq(weth.balanceOf(buyer), 0.05 ether);
    }
}
