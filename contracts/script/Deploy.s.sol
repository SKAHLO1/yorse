// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Escrow} from "../src/Escrow.sol";

/// @notice Deploys Escrow to Arbitrum Sepolia wired to Circle's testnet USDC.
///   forge script script/Deploy.s.sol --rpc-url arbitrum_sepolia --broadcast
contract Deploy is Script {
    uint256 constant ARBITRUM_SEPOLIA = 421614;
    address constant CIRCLE_USDC = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;

    function run() external returns (Escrow escrow) {
        require(block.chainid == ARBITRUM_SEPOLIA, "Refusing to deploy: not Arbitrum Sepolia");

        uint256 pk = vm.envUint("RELAYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        // Relayer defaults to the deployer key; override to split roles.
        address relayer = vm.envOr("RELAYER_ADDRESS", deployer);

        vm.startBroadcast(pk);
        escrow = new Escrow(CIRCLE_USDC, relayer, deployer);
        vm.stopBroadcast();

        console2.log("Escrow deployed at:", address(escrow));
        console2.log("USDC:", CIRCLE_USDC);
        console2.log("Relayer:", relayer);
        console2.log("Owner:", deployer);
    }
}
