// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Escrow} from "../src/Escrow.sol";

interface IFiatToken {
    function masterMinter() external view returns (address);
    function configureMinter(address minter, uint256 allowance) external returns (bool);
    function mint(address to, uint256 amount) external returns (bool);
}

/// @notice Runs against a fork of Arbitrum Sepolia using Circle's real testnet USDC.
///         Balances are minted in the local fork only by impersonating USDC's masterMinter.
contract EscrowForkTest is Test {
    address constant USDC = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;
    uint64 constant WINDOW = 3 minutes;
    uint64 constant TIMEOUT = 1 hours;
    uint16 constant BOND_BPS = 1_000; // 10%

    Escrow escrow;
    IERC20 usdc = IERC20(USDC);

    address owner = makeAddr("owner");
    address relayer = makeAddr("relayer");
    address client = makeAddr("client");
    address freelancer = makeAddr("freelancer");
    address stranger = makeAddr("stranger");

    bytes32 constant JOB = keccak256("job-1");
    bytes32 constant DELIVERABLE = keccak256("deliverable");
    bytes32 constant VERDICT = keccak256("verdict");
    bytes32 constant RULING = keccak256("ruling");
    uint256 constant AMOUNT = 250e6; // 250 USDC
    uint256 constant BOND = 25e6;
    uint256 constant START = 1_000e6;

    Escrow.Outcome constant RELEASE = Escrow.Outcome.Release;
    Escrow.Outcome constant REFUND = Escrow.Outcome.Refund;

    function setUp() public {
        vm.createSelectFork(vm.envOr("ARBITRUM_SEPOLIA_RPC_URL", string("https://sepolia-rollup.arbitrum.io/rpc")));
        escrow = new Escrow(USDC, relayer, owner, WINDOW, TIMEOUT, BOND_BPS);
        _mintUsdc(client, START);
        _mintUsdc(freelancer, START);
    }

    // ------------------------------------------------------------ helpers

    function _mintUsdc(address to, uint256 amount) internal {
        IFiatToken fiat = IFiatToken(USDC);
        vm.prank(fiat.masterMinter());
        fiat.configureMinter(address(this), amount);
        fiat.mint(to, amount);
    }

    function _fund() internal {
        vm.startPrank(client);
        usdc.approve(address(escrow), AMOUNT);
        escrow.fund(JOB, freelancer, AMOUNT);
        vm.stopPrank();
    }

    function _submit() internal {
        _fund();
        vm.prank(relayer);
        escrow.markSubmitted(JOB, DELIVERABLE);
    }

    function _propose(Escrow.Outcome outcome) internal {
        _submit();
        vm.prank(relayer);
        escrow.proposeVerdict(JOB, outcome, VERDICT);
    }

    function _challengeAs(address who) internal {
        vm.startPrank(who);
        usdc.approve(address(escrow), BOND);
        escrow.challenge(JOB);
        vm.stopPrank();
    }

    function _state() internal view returns (Escrow.State) {
        return escrow.getJob(JOB).state;
    }

    // ------------------------------------------------------------ config & funding

    function test_config() public view {
        assertEq(address(escrow.usdc()), USDC);
        assertEq(escrow.relayer(), relayer);
        assertEq(escrow.challengeWindow(), WINDOW);
        assertEq(escrow.relayerTimeout(), TIMEOUT);
        assertEq(escrow.bondBps(), BOND_BPS);
    }

    function test_constructor_rejectsBadConfig() public {
        vm.expectRevert(Escrow.BadConfig.selector);
        new Escrow(USDC, relayer, owner, 0, TIMEOUT, BOND_BPS);
        vm.expectRevert(Escrow.BadConfig.selector);
        new Escrow(USDC, relayer, owner, WINDOW, 0, BOND_BPS);
        vm.expectRevert(Escrow.BadConfig.selector);
        new Escrow(USDC, relayer, owner, WINDOW, TIMEOUT, 0);
        vm.expectRevert(Escrow.BadConfig.selector);
        new Escrow(USDC, relayer, owner, WINDOW, TIMEOUT, 10_001);
        vm.expectRevert(Escrow.ZeroAddress.selector);
        new Escrow(address(0), relayer, owner, WINDOW, TIMEOUT, BOND_BPS);
    }

    function test_fund() public {
        _fund();
        Escrow.Job memory j = escrow.getJob(JOB);
        assertEq(j.client, client);
        assertEq(j.freelancer, freelancer);
        assertEq(j.amount, AMOUNT);
        assertEq(uint8(j.state), uint8(Escrow.State.Funded));
        assertEq(j.stateSince, block.timestamp);
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);
        assertEq(escrow.bondFor(JOB), BOND);
    }

    function test_fund_revertsOnDuplicateJob() public {
        _fund();
        vm.startPrank(client);
        usdc.approve(address(escrow), AMOUNT);
        vm.expectRevert(abi.encodeWithSelector(Escrow.JobAlreadyExists.selector, JOB));
        escrow.fund(JOB, freelancer, AMOUNT);
        vm.stopPrank();
    }

    function test_fund_revertsWithoutApproval() public {
        vm.prank(client);
        vm.expectRevert();
        escrow.fund(JOB, freelancer, AMOUNT);
    }

    function test_fund_revertsOnBadParams() public {
        vm.startPrank(client);
        vm.expectRevert(Escrow.InvalidFreelancer.selector);
        escrow.fund(JOB, client, AMOUNT);
        vm.expectRevert(Escrow.InvalidFreelancer.selector);
        escrow.fund(JOB, address(0), AMOUNT);
        vm.expectRevert(Escrow.ZeroAmount.selector);
        escrow.fund(JOB, freelancer, 0);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ commitments

    function test_submitAndProposeRecordCommitments() public {
        _propose(RELEASE);
        Escrow.Job memory j = escrow.getJob(JOB);
        assertEq(j.deliverableHash, DELIVERABLE);
        assertEq(j.verdictHash, VERDICT);
        assertEq(uint8(j.proposed), uint8(RELEASE));
        assertEq(j.challengeDeadline, block.timestamp + WINDOW);
        assertEq(uint8(j.state), uint8(Escrow.State.Proposed));
    }

    function test_propose_rejectsNoneOutcome() public {
        _submit();
        vm.prank(relayer);
        vm.expectRevert(Escrow.BadOutcome.selector);
        escrow.proposeVerdict(JOB, Escrow.Outcome.None, VERDICT);
    }

    // ------------------------------------------------------------ optimistic path

    function test_unchallengedRelease_finalizedByAnyone() public {
        _propose(RELEASE);
        vm.expectRevert(abi.encodeWithSelector(Escrow.ChallengeWindowOpen.selector, uint64(block.timestamp + WINDOW)));
        escrow.finalize(JOB);

        vm.warp(block.timestamp + WINDOW);
        vm.prank(stranger); // no relayer needed
        escrow.finalize(JOB);

        assertEq(uint8(_state()), uint8(Escrow.State.Released));
        assertEq(usdc.balanceOf(freelancer), START + AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_unchallengedRefund_finalized() public {
        _propose(REFUND);
        vm.warp(block.timestamp + WINDOW);
        escrow.finalize(JOB);
        assertEq(uint8(_state()), uint8(Escrow.State.Refunded));
        assertEq(usdc.balanceOf(client), START);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // ------------------------------------------------------------ challenges

    function test_challenge_onlyLosingParty() public {
        _propose(RELEASE); // client loses a release proposal
        vm.startPrank(freelancer);
        usdc.approve(address(escrow), BOND);
        vm.expectRevert(Escrow.NotLosingParty.selector);
        escrow.challenge(JOB);
        vm.stopPrank();
        vm.prank(stranger);
        vm.expectRevert(Escrow.NotLosingParty.selector);
        escrow.challenge(JOB);
    }

    function test_challenge_closesAtDeadline() public {
        _propose(RELEASE);
        vm.warp(block.timestamp + WINDOW);
        vm.startPrank(client);
        usdc.approve(address(escrow), BOND);
        vm.expectRevert(abi.encodeWithSelector(Escrow.ChallengeWindowClosed.selector, uint64(block.timestamp)));
        escrow.challenge(JOB);
        vm.stopPrank();
    }

    function test_challenge_blocksFinalize() public {
        _propose(RELEASE);
        _challengeAs(client);
        Escrow.Job memory j = escrow.getJob(JOB);
        assertEq(uint8(j.state), uint8(Escrow.State.Challenged));
        assertEq(j.challenger, client);
        assertEq(j.bond, BOND);
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT + BOND);

        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(abi.encodeWithSelector(Escrow.InvalidState.selector, JOB, Escrow.State.Challenged));
        escrow.finalize(JOB);
    }

    function test_challengerWins_bondReturned() public {
        _propose(RELEASE);
        _challengeAs(client);
        vm.prank(relayer);
        escrow.resolveChallenge(JOB, REFUND, RULING); // jury overturns

        assertEq(uint8(_state()), uint8(Escrow.State.Refunded));
        assertEq(escrow.getJob(JOB).rulingHash, RULING);
        assertEq(usdc.balanceOf(client), START); // job amount + bond back
        assertEq(usdc.balanceOf(freelancer), START);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_challengerLoses_bondToOtherParty() public {
        _propose(RELEASE);
        _challengeAs(client);
        vm.prank(relayer);
        escrow.resolveChallenge(JOB, RELEASE, RULING); // jury upholds

        assertEq(uint8(_state()), uint8(Escrow.State.Released));
        assertEq(usdc.balanceOf(freelancer), START + AMOUNT + BOND);
        assertEq(usdc.balanceOf(client), START - AMOUNT - BOND);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_freelancerChallengesRefund_andWins() public {
        _propose(REFUND);
        _challengeAs(freelancer);
        vm.prank(relayer);
        escrow.resolveChallenge(JOB, RELEASE, RULING);
        assertEq(uint8(_state()), uint8(Escrow.State.Released));
        assertEq(usdc.balanceOf(freelancer), START + AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_escalate_uncertainAiGoesToJuryWithoutBond() public {
        _submit();
        vm.prank(relayer);
        escrow.escalate(JOB, VERDICT);
        Escrow.Job memory j = escrow.getJob(JOB);
        assertEq(uint8(j.state), uint8(Escrow.State.Challenged));
        assertEq(uint8(j.proposed), uint8(Escrow.Outcome.None));
        assertEq(j.bond, 0);

        vm.prank(relayer);
        escrow.resolveChallenge(JOB, RELEASE, RULING);
        assertEq(usdc.balanceOf(freelancer), START + AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // ------------------------------------------------------------ human review

    function test_splitJury_adminResolves_settlesBond() public {
        _propose(REFUND);
        _challengeAs(freelancer);
        vm.startPrank(relayer);
        escrow.dispute(JOB); // jury split
        escrow.resolve(JOB, REFUND, RULING); // admin upholds the proposal
        vm.stopPrank();

        assertEq(uint8(_state()), uint8(Escrow.State.ResolvedRefund));
        assertEq(usdc.balanceOf(client), START + BOND); // refund + freelancer's losing bond
        assertEq(usdc.balanceOf(freelancer), START - BOND);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_disputeFromFunded_nonDelivery() public {
        _fund();
        vm.startPrank(relayer);
        escrow.dispute(JOB);
        escrow.resolve(JOB, REFUND, RULING);
        vm.stopPrank();
        assertEq(uint8(_state()), uint8(Escrow.State.ResolvedRefund));
        assertEq(usdc.balanceOf(client), START);
    }

    function test_adminRelease() public {
        _submit();
        vm.startPrank(relayer);
        escrow.dispute(JOB);
        escrow.resolve(JOB, RELEASE, RULING);
        vm.stopPrank();
        assertEq(uint8(_state()), uint8(Escrow.State.ResolvedRelease));
        assertEq(usdc.balanceOf(freelancer), START + AMOUNT);
    }

    // ------------------------------------------------------------ liveness

    function test_escalateStale_fromSubmitted() public {
        _submit();
        vm.expectRevert(abi.encodeWithSelector(Escrow.RelayerNotStale.selector, uint64(block.timestamp + TIMEOUT)));
        escrow.escalateStale(JOB);
        vm.warp(block.timestamp + TIMEOUT);
        vm.prank(stranger);
        escrow.escalateStale(JOB);
        assertEq(uint8(_state()), uint8(Escrow.State.Disputed));
    }

    function test_escalateStale_fromChallenged() public {
        _propose(RELEASE);
        vm.warp(block.timestamp + 1);
        _challengeAs(client);
        // The timeout counts from the challenge, not from the submission.
        vm.warp(block.timestamp + TIMEOUT - 1);
        vm.expectRevert();
        escrow.escalateStale(JOB);
        vm.warp(block.timestamp + 1);
        vm.prank(client);
        escrow.escalateStale(JOB);
        assertEq(uint8(_state()), uint8(Escrow.State.Disputed));
    }

    function test_escalateStale_notFromProposed() public {
        _propose(RELEASE);
        vm.warp(block.timestamp + TIMEOUT);
        vm.expectRevert(abi.encodeWithSelector(Escrow.InvalidState.selector, JOB, Escrow.State.Proposed));
        escrow.escalateStale(JOB);
    }

    // ------------------------------------------------------------ access control & transitions

    function test_onlyRelayerCanDrive() public {
        _fund();
        address[3] memory callers = [client, freelancer, stranger];
        for (uint256 i; i < callers.length; i++) {
            vm.startPrank(callers[i]);
            vm.expectRevert(Escrow.NotRelayer.selector);
            escrow.markSubmitted(JOB, DELIVERABLE);
            vm.expectRevert(Escrow.NotRelayer.selector);
            escrow.proposeVerdict(JOB, RELEASE, VERDICT);
            vm.expectRevert(Escrow.NotRelayer.selector);
            escrow.escalate(JOB, VERDICT);
            vm.expectRevert(Escrow.NotRelayer.selector);
            escrow.resolveChallenge(JOB, RELEASE, RULING);
            vm.expectRevert(Escrow.NotRelayer.selector);
            escrow.dispute(JOB);
            vm.expectRevert(Escrow.NotRelayer.selector);
            escrow.resolve(JOB, RELEASE, RULING);
            vm.stopPrank();
        }
    }

    function test_invalidTransitions() public {
        _fund();
        vm.startPrank(relayer);
        vm.expectRevert(abi.encodeWithSelector(Escrow.InvalidState.selector, JOB, Escrow.State.Funded));
        escrow.proposeVerdict(JOB, RELEASE, VERDICT);
        vm.expectRevert(abi.encodeWithSelector(Escrow.InvalidState.selector, JOB, Escrow.State.Funded));
        escrow.resolve(JOB, RELEASE, RULING);
        vm.expectRevert(abi.encodeWithSelector(Escrow.InvalidState.selector, JOB, Escrow.State.Funded));
        escrow.resolveChallenge(JOB, RELEASE, RULING);

        escrow.markSubmitted(JOB, DELIVERABLE);
        vm.expectRevert(abi.encodeWithSelector(Escrow.InvalidState.selector, JOB, Escrow.State.Submitted));
        escrow.markSubmitted(JOB, DELIVERABLE);
        escrow.proposeVerdict(JOB, RELEASE, VERDICT);
        // A live proposal can only be challenged or finalized; the relayer cannot short-circuit it.
        vm.expectRevert(abi.encodeWithSelector(Escrow.InvalidState.selector, JOB, Escrow.State.Proposed));
        escrow.dispute(JOB);
        vm.expectRevert(abi.encodeWithSelector(Escrow.InvalidState.selector, JOB, Escrow.State.Proposed));
        escrow.resolveChallenge(JOB, REFUND, RULING);
        vm.stopPrank();

        vm.warp(block.timestamp + WINDOW);
        escrow.finalize(JOB);
        // terminal: nothing else is allowed
        vm.expectRevert(abi.encodeWithSelector(Escrow.InvalidState.selector, JOB, Escrow.State.Released));
        escrow.finalize(JOB);
        vm.startPrank(relayer);
        vm.expectRevert(abi.encodeWithSelector(Escrow.InvalidState.selector, JOB, Escrow.State.Released));
        escrow.dispute(JOB);
        vm.expectRevert(abi.encodeWithSelector(Escrow.InvalidState.selector, JOB, Escrow.State.Released));
        escrow.resolve(JOB, REFUND, RULING);
        vm.stopPrank();
    }

    function test_unknownJobReverts() public {
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(Escrow.InvalidState.selector, JOB, Escrow.State.None));
        escrow.markSubmitted(JOB, DELIVERABLE);
        vm.expectRevert(abi.encodeWithSelector(Escrow.InvalidState.selector, JOB, Escrow.State.None));
        escrow.finalize(JOB);
    }

    function test_setRelayer_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        escrow.setRelayer(stranger);

        vm.prank(owner);
        escrow.setRelayer(stranger);
        assertEq(escrow.relayer(), stranger);
    }

    /// @dev Whatever path a job takes, the escrow never keeps or loses a cent.
    function testFuzz_escrowAlwaysDrains(bool proposeRelease, bool challenge_, bool juryRelease, uint256 amount) public {
        amount = bound(amount, 10, START / 2);
        vm.startPrank(client);
        usdc.approve(address(escrow), amount);
        escrow.fund(JOB, freelancer, amount);
        vm.stopPrank();
        vm.startPrank(relayer);
        escrow.markSubmitted(JOB, DELIVERABLE);
        escrow.proposeVerdict(JOB, proposeRelease ? RELEASE : REFUND, VERDICT);
        vm.stopPrank();
        if (challenge_) {
            address who = proposeRelease ? client : freelancer;
            vm.startPrank(who);
            usdc.approve(address(escrow), escrow.bondFor(JOB));
            escrow.challenge(JOB);
            vm.stopPrank();
            vm.prank(relayer);
            escrow.resolveChallenge(JOB, juryRelease ? RELEASE : REFUND, RULING);
        } else {
            vm.warp(block.timestamp + WINDOW);
            escrow.finalize(JOB);
        }
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(usdc.balanceOf(client) + usdc.balanceOf(freelancer), 2 * START);
    }
}
