// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {P2PEscrow} from "../P2PEscrow.sol";

/// @notice Deploys OnPeer P2PEscrow v2.3 (native multi-arbiter + auto-debt offset) to Arc Mainnet (Chain ID 5042).
///         Foundry automatically deploys and links P2PEscrowDebtLib.
///
/// WARNING: Arc Mainnet uses REAL USDC for gas. Always review the dry-run output before broadcasting.
///
/// Usage:
///   forge script contracts/script/DeployMainnet.s.sol:DeployMainnet \
///     --rpc-url https://rpc.mainnet.arc.io \
///     --broadcast --interactive
contract DeployMainnet is Script {
    // Arc Mainnet ERC-20 token addresses (Chain ID 5042)
    address constant ARC_MAINNET_USDC = 0x3600000000000000000000000000000000000000;
    address constant ARC_MAINNET_EURC = 0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1;

    address constant DEFAULT_OWNER = 0x81eA9AdE2805e310E9f884a75B3a24Ab74557C69;
    address constant DEFAULT_ARBITER = 0xb213Dc9a65d3d748B6Ec5cCaCCb9b6EC82A40A33;
    address constant DEFAULT_VERIFIER = 0x74605c85676E9F514BA33B9B3005e0EE561DAfDd;

    function run() external {
        require(block.chainid == 5042, "DeployMainnet: must run on Arc Mainnet (chainId 5042)");

        address owner = vm.envOr("ONPEER_OWNER", DEFAULT_OWNER);
        address arbiter = vm.envOr("ONPEER_ARBITER", DEFAULT_ARBITER);
        address backupArbiter = vm.envOr("ONPEER_BACKUP_ARBITER", DEFAULT_ARBITER);
        address verifier = vm.envOr("ONPEER_VERIFIER", DEFAULT_VERIFIER);

        vm.startBroadcast();

        P2PEscrow usdcEscrow = new P2PEscrow(ARC_MAINNET_USDC, owner, arbiter, backupArbiter);
        P2PEscrow eurcEscrow = new P2PEscrow(ARC_MAINNET_EURC, owner, arbiter, backupArbiter);

        if (msg.sender == owner && verifier != address(0)) {
            usdcEscrow.setVerifier(verifier);
            eurcEscrow.setVerifier(verifier);
        }

        vm.stopBroadcast();

        console2.log("=== OnPeer P2PEscrow v2.3 Deployed (Arc MAINNET - Chain 5042) ===");
        console2.log("Block:      ", block.number);
        console2.log("Owner:      ", owner);
        console2.log("Verifier:   ", verifier);
        console2.log("USDC Escrow:", address(usdcEscrow));
        console2.log("EURC Escrow:", address(eurcEscrow));
    }
}
