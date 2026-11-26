// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {P2PEscrow} from "../P2PEscrow.sol";

/// @notice Deploys OnPeer P2PEscrow v2.2 for Arc Testnet USDC and EURC.
///         Foundry automatically deploys and links P2PEscrowDebtLib.
///
/// Usage (recommended - prompts securely for private key, never stored in files):
///   forge script contracts/script/DeployV22.s.sol:DeployV22 \
///     --rpc-url https://rpc.testnet.arc.io \
///     --broadcast --interactive
contract DeployV22 is Script {
    // Arc Testnet ERC-20 token addresses
    address constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;
    address constant ARC_TESTNET_EURC = 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a;

    // Default OnPeer Owner / Primary Arbiter / Backup Arbiter on Arc Testnet
    address constant DEFAULT_OWNER = 0x54190a788EEf66d9AbddcF7d135B09B4D2b72F3A;
    address constant DEFAULT_VERIFIER = 0xeebd29441AF1a931C4a6eEc2265B0757fd992f5e;

    function run() external {
        address owner = vm.envOr("ONPEER_OWNER", DEFAULT_OWNER);
        address arbiter = vm.envOr("ONPEER_ARBITER", owner);
        address backupArbiter = vm.envOr("ONPEER_BACKUP_ARBITER", owner);
        address verifier = vm.envOr("ONPEER_VERIFIER", DEFAULT_VERIFIER);

        vm.startBroadcast();

        P2PEscrow usdcEscrow = new P2PEscrow(ARC_TESTNET_USDC, owner, arbiter, backupArbiter);
        P2PEscrow eurcEscrow = new P2PEscrow(ARC_TESTNET_EURC, owner, arbiter, backupArbiter);

        // If the broadcaster is the owner, also wire the verifier wallet right away
        if (msg.sender == owner && verifier != address(0)) {
            usdcEscrow.setVerifier(verifier);
            eurcEscrow.setVerifier(verifier);
        }

        vm.stopBroadcast();

        console2.log("=== OnPeer P2PEscrow v2.2 Deployed (Arc Testnet) ===");
        console2.log("Block:      ", block.number);
        console2.log("Owner:      ", owner);
        console2.log("Verifier:   ", verifier);
        console2.log("USDC Escrow:", address(usdcEscrow));
        console2.log("EURC Escrow:", address(eurcEscrow));
    }
}
