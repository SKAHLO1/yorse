// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Escrow} from "../src/Escrow.sol";

/// @notice Live check of the escrow paths on Arbitrum Sepolia with real Circle USDC.
///         The relayer key doubles as the client here, so it needs ETH for gas and
///         5 * SMOKE_AMOUNT USDC (faucet.circle.com; covers 4 jobs + one challenge bond).
///         Funds go to SMOKE_FREELANCER (release paths) or back to the client (refund paths).
///         Unchallenged finalize() needs the challenge window to pass, so it is covered by the
///         fork tests and by the backend keeper rather than here.
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
        require(usdc.balanceOf(me) >= amount * 5, "Not enough USDC: get some from faucet.circle.com");

        string memory salt = vm.toString(block.timestamp);
        bytes32 jobJury = keccak256(abi.encodePacked("smoke-jury-", salt));
        bytes32 jobChallenge = keccak256(abi.encodePacked("smoke-challenge-", salt));
        bytes32 jobAdminRelease = keccak256(abi.encodePacked("smoke-admin-release-", salt));
        bytes32 jobAdminRefund = keccak256(abi.encodePacked("smoke-admin-refund-", salt));
        bytes32 h = keccak256("smoke");

        uint256 freelancerBefore = usdc.balanceOf(freelancer);
        uint256 clientBefore = usdc.balanceOf(me);

        vm.startBroadcast(pk);
        usdc.approve(address(escrow), amount * 5);

        // Path A: AI unsure -> escalated to jury -> jury releases
        escrow.fund(jobJury, freelancer, amount);
        escrow.markSubmitted(jobJury, h);
        escrow.escalate(jobJury, h);
        escrow.resolveChallenge(jobJury, Escrow.Outcome.Release, h);

        // Path B: AI proposes release -> client challenges with a bond -> jury overturns (refund + bond back)
        escrow.fund(jobChallenge, freelancer, amount);
        escrow.markSubmitted(jobChallenge, h);
        escrow.proposeVerdict(jobChallenge, Escrow.Outcome.Release, h);
        escrow.challenge(jobChallenge);
        escrow.resolveChallenge(jobChallenge, Escrow.Outcome.Refund, h);

        // Path C: submitted -> disputed -> admin releases
        escrow.fund(jobAdminRelease, freelancer, amount);
        escrow.markSubmitted(jobAdminRelease, h);
        escrow.dispute(jobAdminRelease);
        escrow.resolve(jobAdminRelease, Escrow.Outcome.Release, h);

        // Path D: non-delivery -> disputed from Funded -> admin refunds
        escrow.fund(jobAdminRefund, freelancer, amount);
        escrow.dispute(jobAdminRefund);
        escrow.resolve(jobAdminRefund, Escrow.Outcome.Refund, h);
        vm.stopBroadcast();

        require(escrow.getJob(jobJury).state == Escrow.State.Released, "A: not Released");
        require(escrow.getJob(jobChallenge).state == Escrow.State.Refunded, "B: not Refunded");
        require(escrow.getJob(jobAdminRelease).state == Escrow.State.ResolvedRelease, "C: not ResolvedRelease");
        require(escrow.getJob(jobAdminRefund).state == Escrow.State.ResolvedRefund, "D: not ResolvedRefund");
        require(usdc.balanceOf(freelancer) == freelancerBefore + amount * 2, "Freelancer balance mismatch");
        require(usdc.balanceOf(me) == clientBefore - amount * 2, "Client balance mismatch");

        console2.log("All escrow paths OK. Freelancer received:", amount * 2);
    }
}
