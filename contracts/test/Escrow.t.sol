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

    Escrow escrow;
    IERC20 usdc = IERC20(USDC);

    address owner = makeAddr("owner");
    address relayer = makeAddr("relayer");
    address client = makeAddr("client");
    address freelancer = makeAddr("freelancer");
    address stranger = makeAddr("stranger");

    bytes32 constant JOB = keccak256("job-1");
    uint256 constant AMOUNT = 250e6; // 250 USDC

    function setUp() public {
        vm.createSelectFork(vm.envOr("ARBITRUM_SEPOLIA_RPC_URL", string("https://sepolia-rollup.arbitrum.io/rpc")));
        escrow = new Escrow(USDC, relayer, owner);
        _mintUsdc(client, 1_000e6);
    }

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

    function test_usdcIsCircleTestnetToken() public view {
        assertEq(address(escrow.usdc()), USDC);
        assertEq(escrow.relayer(), relayer);
    }

    function test_fund() public {
        _fund();
        Escrow.Job memory j = escrow.getJob(JOB);
        assertEq(j.client, client);
        assertEq(j.freelancer, freelancer);
        assertEq(j.amount, AMOUNT);
        assertEq(uint8(j.state), uint8(Escrow.State.Funded));
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);
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

    function test_autoReleasePath() public {
        _fund();
        vm.startPrank(relayer);
        escrow.markSubmitted(JOB);
        escrow.release(JOB);
        vm.stopPrank();

        assertEq(uint8(escrow.getJob(JOB).state), uint8(Escrow.State.Released));
        assertEq(usdc.balanceOf(freelancer), AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_disputeThenResolveRelease() public {
        _fund();
        vm.startPrank(relayer);
        escrow.markSubmitted(JOB);
        escrow.dispute(JOB);
        assertEq(uint8(escrow.getJob(JOB).state), uint8(Escrow.State.Disputed));
        escrow.release(JOB);
        vm.stopPrank();

        assertEq(uint8(escrow.getJob(JOB).state), uint8(Escrow.State.ResolvedRelease));
        assertEq(usdc.balanceOf(freelancer), AMOUNT);
    }

    function test_disputeThenResolveRefund() public {
        uint256 before = usdc.balanceOf(client);
        _fund();
        vm.startPrank(relayer);
        escrow.markSubmitted(JOB);
        escrow.dispute(JOB);
        escrow.refund(JOB);
        vm.stopPrank();

        assertEq(uint8(escrow.getJob(JOB).state), uint8(Escrow.State.ResolvedRefund));
        assertEq(usdc.balanceOf(client), before);
        assertEq(usdc.balanceOf(freelancer), 0);
    }

    function test_disputeFromFunded_nonDelivery() public {
        _fund();
        vm.startPrank(relayer);
        escrow.dispute(JOB);
        escrow.refund(JOB);
        vm.stopPrank();
        assertEq(uint8(escrow.getJob(JOB).state), uint8(Escrow.State.ResolvedRefund));
    }

    function test_onlyRelayerCanMoveState() public {
        _fund();
        address[3] memory callers = [client, freelancer, stranger];
        for (uint256 i; i < callers.length; i++) {
            vm.startPrank(callers[i]);
            vm.expectRevert(Escrow.NotRelayer.selector);
            escrow.markSubmitted(JOB);
            vm.expectRevert(Escrow.NotRelayer.selector);
            escrow.release(JOB);
            vm.expectRevert(Escrow.NotRelayer.selector);
            escrow.refund(JOB);
            vm.expectRevert(Escrow.NotRelayer.selector);
            escrow.dispute(JOB);
            vm.stopPrank();
        }
    }

    function test_invalidTransitions() public {
        _fund();
        vm.startPrank(relayer);
        // cannot release or refund straight from Funded
        vm.expectRevert(abi.encodeWithSelector(Escrow.InvalidState.selector, JOB, Escrow.State.Funded));
        escrow.release(JOB);
        vm.expectRevert(abi.encodeWithSelector(Escrow.InvalidState.selector, JOB, Escrow.State.Funded));
        escrow.refund(JOB);

        escrow.markSubmitted(JOB);
        // cannot refund from Submitted (must dispute first)
        vm.expectRevert(abi.encodeWithSelector(Escrow.InvalidState.selector, JOB, Escrow.State.Submitted));
        escrow.refund(JOB);
        vm.expectRevert(abi.encodeWithSelector(Escrow.InvalidState.selector, JOB, Escrow.State.Submitted));
        escrow.markSubmitted(JOB);

        escrow.release(JOB);
        // terminal: nothing else is allowed
        vm.expectRevert(abi.encodeWithSelector(Escrow.InvalidState.selector, JOB, Escrow.State.Released));
        escrow.release(JOB);
        vm.expectRevert(abi.encodeWithSelector(Escrow.InvalidState.selector, JOB, Escrow.State.Released));
        escrow.dispute(JOB);
        vm.expectRevert(abi.encodeWithSelector(Escrow.InvalidState.selector, JOB, Escrow.State.Released));
        escrow.refund(JOB);
        vm.stopPrank();
    }

    function test_unknownJobReverts() public {
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(Escrow.InvalidState.selector, JOB, Escrow.State.None));
        escrow.markSubmitted(JOB);
    }

    function test_setRelayer_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        escrow.setRelayer(stranger);

        vm.prank(owner);
        escrow.setRelayer(stranger);
        assertEq(escrow.relayer(), stranger);
    }
}
