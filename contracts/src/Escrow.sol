// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Yorse Escrow
/// @notice Holds Circle USDC per job. The chain only tracks funds and job state;
///         all job metadata, submissions and AI verdicts live off-chain.
/// @dev State machine:
///      Funded -> Submitted -> Released
///      Funded | Submitted -> Disputed -> ResolvedRelease | ResolvedRefund
///      Only the backend relayer can move a job past Funded.
contract Escrow is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State {
        None,
        Funded,
        Submitted,
        Released,
        Disputed,
        ResolvedRelease,
        ResolvedRefund
    }

    struct Job {
        address client;
        address freelancer;
        uint256 amount;
        State state;
    }

    IERC20 public immutable usdc;
    address public relayer;

    mapping(bytes32 jobId => Job) private _jobs;

    event RelayerUpdated(address indexed previousRelayer, address indexed newRelayer);
    event JobFunded(bytes32 indexed jobId, address indexed client, address indexed freelancer, uint256 amount);
    event JobSubmitted(bytes32 indexed jobId);
    event JobReleased(bytes32 indexed jobId, address indexed freelancer, uint256 amount, State finalState);
    event JobDisputed(bytes32 indexed jobId, State fromState);
    event JobRefunded(bytes32 indexed jobId, address indexed client, uint256 amount);

    error NotRelayer();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidFreelancer();
    error JobAlreadyExists(bytes32 jobId);
    error InvalidState(bytes32 jobId, State current);

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    constructor(address usdc_, address relayer_, address owner_) Ownable(owner_) {
        if (usdc_ == address(0) || relayer_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
        relayer = relayer_;
        emit RelayerUpdated(address(0), relayer_);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setRelayer(address newRelayer) external onlyOwner {
        if (newRelayer == address(0)) revert ZeroAddress();
        emit RelayerUpdated(relayer, newRelayer);
        relayer = newRelayer;
    }

    // ---------------------------------------------------------------------
    // Client
    // ---------------------------------------------------------------------

    /// @notice Client deposits `amount` USDC (6 decimals) for `jobId`.
    ///         Requires a prior `usdc.approve(escrow, amount)`.
    function fund(bytes32 jobId, address freelancer, uint256 amount) external nonReentrant {
        if (_jobs[jobId].state != State.None) revert JobAlreadyExists(jobId);
        if (freelancer == address(0) || freelancer == msg.sender) revert InvalidFreelancer();
        if (amount == 0) revert ZeroAmount();

        _jobs[jobId] = Job({client: msg.sender, freelancer: freelancer, amount: amount, state: State.Funded});
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        emit JobFunded(jobId, msg.sender, freelancer, amount);
    }

    // ---------------------------------------------------------------------
    // Relayer (backend service only)
    // ---------------------------------------------------------------------

    /// @notice Records that the freelancer submitted a deliverable off-chain.
    function markSubmitted(bytes32 jobId) external onlyRelayer {
        Job storage job = _jobs[jobId];
        if (job.state != State.Funded) revert InvalidState(jobId, job.state);
        job.state = State.Submitted;
        emit JobSubmitted(jobId);
    }

    /// @notice Pays the freelancer. From Submitted (AI pass) -> Released,
    ///         or from Disputed (admin decision) -> ResolvedRelease.
    function release(bytes32 jobId) external onlyRelayer nonReentrant {
        Job storage job = _jobs[jobId];
        State next;
        if (job.state == State.Submitted) next = State.Released;
        else if (job.state == State.Disputed) next = State.ResolvedRelease;
        else revert InvalidState(jobId, job.state);

        job.state = next;
        usdc.safeTransfer(job.freelancer, job.amount);
        emit JobReleased(jobId, job.freelancer, job.amount, next);
    }

    /// @notice Moves a job into dispute for admin resolution. Allowed from
    ///         Submitted (AI mismatch / low confidence) and from Funded
    ///         (e.g. non-delivery) so funds can never be permanently locked.
    function dispute(bytes32 jobId) external onlyRelayer {
        Job storage job = _jobs[jobId];
        State from = job.state;
        if (from != State.Submitted && from != State.Funded) revert InvalidState(jobId, from);
        job.state = State.Disputed;
        emit JobDisputed(jobId, from);
    }

    /// @notice Returns funds to the client after an admin resolves a dispute.
    function refund(bytes32 jobId) external onlyRelayer nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.state != State.Disputed) revert InvalidState(jobId, job.state);
        job.state = State.ResolvedRefund;
        usdc.safeTransfer(job.client, job.amount);
        emit JobRefunded(jobId, job.client, job.amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getJob(bytes32 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }
}
