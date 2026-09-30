// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Yorse Escrow — optimistic AI arbitration
/// @notice Holds Circle USDC per job. The AI never moves money directly: its verdict is
///         posted as a *proposal* that either party can challenge within a window by
///         posting a bond. Unchallenged proposals are finalized by anyone. Challenges go
///         to a multi-model AI jury; a split jury goes to a human admin. The same
///         propose/challenge/resolve shape Arbitrum itself uses for fraud proofs.
///
///         Every verdict and ruling is committed on-chain as a hash of the full off-chain
///         record (evidence, prompt version, model ids, outputs) so anyone can verify it.
///
/// @dev State machine:
///      Funded      --markSubmitted [relayer]--------------------> Submitted
///      Submitted   --proposeVerdict [relayer]-------------------> Proposed
///      Proposed    --finalize [anyone, after window]------------> Released | Refunded
///      Proposed    --challenge [losing party, posts bond]-------> Challenged
///      Submitted   --escalate [relayer, AI unsure]--------------> Challenged (no bond)
///      Challenged  --resolveChallenge [relayer, jury majority]--> Released | Refunded
///      Funded | Submitted | Challenged --dispute [relayer]------> Disputed
///      Submitted | Challenged --escalateStale [anyone, relayer silent]--> Disputed
///      Disputed    --resolve [relayer, admin decision]----------> ResolvedRelease | ResolvedRefund
contract Escrow is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State {
        None,
        Funded,
        Submitted,
        Released,
        Disputed,
        ResolvedRelease,
        ResolvedRefund,
        Proposed,
        Challenged,
        Refunded
    }

    enum Outcome {
        None,
        Release,
        Refund
    }

    struct Job {
        address client;
        address freelancer;
        uint256 amount;
        State state;
        /// @dev The AI's proposed outcome (None if the job was escalated straight to the jury).
        Outcome proposed;
        /// @dev When the current state began; drives the relayer-liveness timeout.
        uint64 stateSince;
        uint64 challengeDeadline;
        address challenger;
        uint256 bond;
        bytes32 deliverableHash;
        bytes32 verdictHash;
        bytes32 rulingHash;
    }

    uint16 public constant BPS = 10_000;

    IERC20 public immutable usdc;
    /// @notice Seconds after a proposal during which the losing party may challenge.
    uint64 public immutable challengeWindow;
    /// @notice Seconds the relayer may leave a Submitted/Challenged job untouched before
    ///         anyone can push it to human review. Funds can never be stranded by a dead backend.
    uint64 public immutable relayerTimeout;
    /// @notice Challenge bond as a share of the job amount, in basis points.
    uint16 public immutable bondBps;
    address public relayer;

    mapping(bytes32 jobId => Job) private _jobs;

    event RelayerUpdated(address indexed previousRelayer, address indexed newRelayer);
    event JobFunded(bytes32 indexed jobId, address indexed client, address indexed freelancer, uint256 amount);
    event JobSubmitted(bytes32 indexed jobId, bytes32 deliverableHash);
    event VerdictProposed(bytes32 indexed jobId, Outcome outcome, bytes32 verdictHash, uint64 challengeDeadline);
    event VerdictChallenged(bytes32 indexed jobId, address indexed challenger, uint256 bond);
    event JobEscalated(bytes32 indexed jobId, bytes32 verdictHash);
    event ChallengeResolved(bytes32 indexed jobId, Outcome outcome, bytes32 rulingHash);
    event BondSettled(bytes32 indexed jobId, address indexed to, uint256 amount, bool challengerWon);
    event JobPaidOut(bytes32 indexed jobId, address indexed to, uint256 amount, State finalState);
    event JobDisputed(bytes32 indexed jobId, State fromState);

    error NotRelayer();
    error NotLosingParty();
    error ZeroAddress();
    error ZeroAmount();
    error BadConfig();
    error BadOutcome();
    error InvalidFreelancer();
    error JobAlreadyExists(bytes32 jobId);
    error InvalidState(bytes32 jobId, State current);
    error ChallengeWindowClosed(uint64 deadline);
    error ChallengeWindowOpen(uint64 deadline);
    error RelayerNotStale(uint64 staleAt);

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    constructor(address usdc_, address relayer_, address owner_, uint64 challengeWindow_, uint64 relayerTimeout_, uint16 bondBps_)
        Ownable(owner_)
    {
        if (usdc_ == address(0) || relayer_ == address(0)) revert ZeroAddress();
        if (challengeWindow_ == 0 || relayerTimeout_ == 0 || bondBps_ == 0 || bondBps_ > BPS) revert BadConfig();
        usdc = IERC20(usdc_);
        relayer = relayer_;
        challengeWindow = challengeWindow_;
        relayerTimeout = relayerTimeout_;
        bondBps = bondBps_;
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

        Job storage job = _jobs[jobId];
        job.client = msg.sender;
        job.freelancer = freelancer;
        job.amount = amount;
        _moveTo(job, State.Funded);
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        emit JobFunded(jobId, msg.sender, freelancer, amount);
    }

    // ---------------------------------------------------------------------
    // Parties / anyone
    // ---------------------------------------------------------------------

    /// @notice The party the proposal goes against disputes it by posting a bond.
    ///         Requires a prior `usdc.approve(escrow, bondFor(jobId))`.
    function challenge(bytes32 jobId) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.state != State.Proposed) revert InvalidState(jobId, job.state);
        if (block.timestamp >= job.challengeDeadline) revert ChallengeWindowClosed(job.challengeDeadline);
        address loser = job.proposed == Outcome.Release ? job.client : job.freelancer;
        if (msg.sender != loser) revert NotLosingParty();

        uint256 bond = bondFor(jobId);
        job.challenger = msg.sender;
        job.bond = bond;
        _moveTo(job, State.Challenged);
        usdc.safeTransferFrom(msg.sender, address(this), bond);

        emit VerdictChallenged(jobId, msg.sender, bond);
    }

    /// @notice Executes an unchallenged proposal once its window has passed. Permissionless:
    ///         the backend usually calls it, but either party (or anyone) can.
    function finalize(bytes32 jobId) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.state != State.Proposed) revert InvalidState(jobId, job.state);
        if (block.timestamp < job.challengeDeadline) revert ChallengeWindowOpen(job.challengeDeadline);
        _payout(jobId, job, job.proposed, false);
    }

    /// @notice Liveness escape hatch: if the relayer leaves a job Submitted or Challenged
    ///         for longer than `relayerTimeout`, anyone can hand it to human review.
    function escalateStale(bytes32 jobId) external {
        Job storage job = _jobs[jobId];
        State from = job.state;
        if (from != State.Submitted && from != State.Challenged) revert InvalidState(jobId, from);
        uint64 staleAt = job.stateSince + relayerTimeout;
        if (block.timestamp < staleAt) revert RelayerNotStale(staleAt);
        _moveTo(job, State.Disputed);
        emit JobDisputed(jobId, from);
    }

    // ---------------------------------------------------------------------
    // Relayer (backend service only)
    // ---------------------------------------------------------------------

    /// @notice Records that the freelancer submitted a deliverable, committing to its contents.
    function markSubmitted(bytes32 jobId, bytes32 deliverableHash) external onlyRelayer {
        Job storage job = _jobs[jobId];
        if (job.state != State.Funded) revert InvalidState(jobId, job.state);
        job.deliverableHash = deliverableHash;
        _moveTo(job, State.Submitted);
        emit JobSubmitted(jobId, deliverableHash);
    }

    /// @notice Posts the AI's verdict as a challengeable proposal.
    function proposeVerdict(bytes32 jobId, Outcome outcome, bytes32 verdictHash) external onlyRelayer {
        Job storage job = _jobs[jobId];
        if (job.state != State.Submitted) revert InvalidState(jobId, job.state);
        if (outcome == Outcome.None) revert BadOutcome();
        job.proposed = outcome;
        job.verdictHash = verdictHash;
        job.challengeDeadline = uint64(block.timestamp) + challengeWindow;
        _moveTo(job, State.Proposed);
        emit VerdictProposed(jobId, outcome, verdictHash, job.challengeDeadline);
    }

    /// @notice The AI was not confident either way: skip the proposal and go straight to the jury.
    function escalate(bytes32 jobId, bytes32 verdictHash) external onlyRelayer {
        Job storage job = _jobs[jobId];
        if (job.state != State.Submitted) revert InvalidState(jobId, job.state);
        job.verdictHash = verdictHash;
        _moveTo(job, State.Challenged);
        emit JobEscalated(jobId, verdictHash);
    }

    /// @notice Applies the AI jury's majority ruling and settles the challenge bond.
    function resolveChallenge(bytes32 jobId, Outcome outcome, bytes32 rulingHash) external onlyRelayer nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.state != State.Challenged) revert InvalidState(jobId, job.state);
        if (outcome == Outcome.None) revert BadOutcome();
        job.rulingHash = rulingHash;
        emit ChallengeResolved(jobId, outcome, rulingHash);
        _payout(jobId, job, outcome, false);
    }

    /// @notice Moves a job to human review: non-delivery (from Funded), an AI that keeps
    ///         failing (from Submitted), or a split jury (from Challenged).
    function dispute(bytes32 jobId) external onlyRelayer {
        Job storage job = _jobs[jobId];
        State from = job.state;
        if (from != State.Funded && from != State.Submitted && from != State.Challenged) revert InvalidState(jobId, from);
        _moveTo(job, State.Disputed);
        emit JobDisputed(jobId, from);
    }

    /// @notice Applies an admin's decision on a disputed job, committing to its notes.
    function resolve(bytes32 jobId, Outcome outcome, bytes32 rulingHash) external onlyRelayer nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.state != State.Disputed) revert InvalidState(jobId, job.state);
        if (outcome == Outcome.None) revert BadOutcome();
        job.rulingHash = rulingHash;
        _payout(jobId, job, outcome, true);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getJob(bytes32 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    function bondFor(bytes32 jobId) public view returns (uint256) {
        return (_jobs[jobId].amount * bondBps) / BPS;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _moveTo(Job storage job, State next) private {
        job.state = next;
        job.stateSince = uint64(block.timestamp);
    }

    function _payout(bytes32 jobId, Job storage job, Outcome outcome, bool byAdmin) private {
        bool release = outcome == Outcome.Release;
        State next = byAdmin
            ? (release ? State.ResolvedRelease : State.ResolvedRefund)
            : (release ? State.Released : State.Refunded);
        address to = release ? job.freelancer : job.client;
        _moveTo(job, next);
        usdc.safeTransfer(to, job.amount);
        emit JobPaidOut(jobId, to, job.amount, next);

        uint256 bond = job.bond;
        if (bond == 0) return;
        // The challenger wins if the final outcome overturned the proposal. A losing bond
        // compensates the other side for the delay; a winning one is simply returned.
        bool challengerWon = outcome != job.proposed;
        address bondTo = challengerWon ? job.challenger : (job.challenger == job.client ? job.freelancer : job.client);
        usdc.safeTransfer(bondTo, bond);
        emit BondSettled(jobId, bondTo, bond, challengerWon);
    }
}
