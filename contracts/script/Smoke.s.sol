// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Escrow} from "../src/Escrow.sol";

/// @notice Live check of every escrow path on Arbitrum Sepolia with real Circle USDC.
///         The relayer key doubles as the client here, so it needs ETH for gas
///         and 3 * SMOKE_AMOUNT USDC (faucet.circle.com). Funds go to SMOKE_FREELANCER
///         (release paths) or back to the client (refund path).
///   forge script script/Smoke.s.sol --rpc-url arbitrum_sepolia --broadcast --slow
contract Smoke is Script {
    uint256 constant ARBITRUM_SEPOLIA = 421614;

    function run() external {
        require(block.chainid == ARBITRUM_SEPOLIA, "Refusing to run: not Arbitrum Sepolia");

        uint256 pk = vm.envUint("RELAYER_PRIVATE_KEY");
        Escrow escrow = Escrow(vm.envAddress("ESCROW_ADDRESS"));
        address freelancer = vm.envAddress("SMOKE_FREELANCER");
        uint256 amount = vm.envOr("SMOKE_AMOUNT", uint256(100_000)); // 0.10 USDC
        IERC20 usdc = escrow.usdc();
        address me = vm.addr(pk);

        require(escrow.relayer() == me, "RELAYER_PRIVATE_KEY is not the escrow relayer");
        require(usdc.balanceOf(me) >= amount * 3, "Not enough USDC: get some from faucet.circle.com");

        string memory salt = vm.toString(block.timestamp);
        bytes32 jobRelease = keccak256(abi.encodePacked("smoke-release-", salt));
        bytes32 jobResolveRelease = keccak256(abi.encodePacked("smoke-resolve-release-", salt));
        bytes32 jobResolveRefund = keccak256(abi.encodePacked("smoke-resolve-refund-", salt));

        uint256 freelancerBefore = usdc.balanceOf(freelancer);

        vm.startBroadcast(pk);
        usdc.approve(address(escrow), amount * 3);

        // Path A: fund -> submitted -> released (AI auto-release)
        escrow.fund(jobRelease, freelancer, amount);
        escrow.markSubmitted(jobRelease);
        escrow.release(jobRelease);

        // Path B: fund -> submitted -> disputed -> resolved(release)
        escrow.fund(jobResolveRelease, freelancer, amount);
        escrow.markSubmitted(jobResolveRelease);
        escrow.dispute(jobResolveRelease);
        escrow.release(jobResolveRelease);

        // Path C: fund -> submitted -> disputed -> resolved(refund)
        escrow.fund(jobResolveRefund, freelancer, amount);
        escrow.markSubmitted(jobResolveRefund);
        escrow.dispute(jobResolveRefund);
        escrow.refund(jobResolveRefund);
        vm.stopBroadcast();

        require(escrow.getJob(jobRelease).state == Escrow.State.Released, "A: not Released");
        require(escrow.getJob(jobResolveRelease).state == Escrow.State.ResolvedRelease, "B: not ResolvedRelease");
        require(escrow.getJob(jobResolveRefund).state == Escrow.State.ResolvedRefund, "C: not ResolvedRefund");
        require(usdc.balanceOf(freelancer) == freelancerBefore + amount * 2, "Freelancer balance mismatch");

        console2.log("All escrow paths OK. Freelancer received:", amount * 2);
    }
}
