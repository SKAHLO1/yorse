# Yorse Escrow (Foundry)

`src/Escrow.sol` holds Circle testnet USDC (`0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`, 6 decimals) per job on **Arbitrum Sepolia (421614) only**.

Optimistic AI arbitration: the AI's verdict is a *proposal* that the losing party can challenge
with a bond. Every verdict and ruling is committed on-chain as a hash of its full off-chain record.

```
fund() [client]                    None       -> Funded
markSubmitted(hash) [relayer]      Funded     -> Submitted
proposeVerdict(outcome, hash)      Submitted  -> Proposed          (challenge window starts)
finalize() [ANYONE, after window]  Proposed   -> Released | Refunded
challenge() [losing party + bond]  Proposed   -> Challenged
escalate(hash) [relayer]           Submitted  -> Challenged        (AI unsure, no bond)
resolveChallenge(outcome, hash)    Challenged -> Released | Refunded (jury majority; bond settled)
dispute() [relayer]                Funded | Submitted | Challenged -> Disputed
escalateStale() [ANYONE]           Submitted | Challenged -> Disputed  (relayer silent > relayerTimeout)
resolve(outcome, hash) [relayer]   Disputed   -> ResolvedRelease | ResolvedRefund (admin; bond settled)
```

Bond rule: returned to the challenger if the final outcome overturns the proposal, otherwise paid to
the other party. `challengeWindow`, `relayerTimeout` and `bondBps` are immutable per deployment.

Live deployment (Arbitrum Sepolia): `0xB0454dc7372c14f0AF25DD79581FA09a432977eC`
(180 s window, 3600 s relayer timeout, 10% bond; Sourcify-verified).

## Commands

```bash
./install-deps.sh               # restores lib/ (OpenZeppelin + forge-std); gitignored, so run this after cloning
cp .env.example .env            # fill RELAYER_PRIVATE_KEY etc. — never commit .env
forge test -vv                  # fork tests against real Circle USDC (no mock token)
# production defaults: 48h window, 24h relayer timeout, 10% bond. Testnet demo:
CHALLENGE_WINDOW_SECONDS=180 RELAYER_TIMEOUT_SECONDS=3600 forge script script/Deploy.s.sol --rpc-url arbitrum_sepolia --broadcast --verify
# put the printed address in ESCROW_ADDRESS, then:
forge script script/Smoke.s.sol  --rpc-url arbitrum_sepolia --broadcast --slow
```

Both scripts refuse to run on any chain other than 421614.
The smoke script needs the relayer wallet to hold Arbitrum Sepolia ETH and at least `5 * SMOKE_AMOUNT` USDC from https://faucet.circle.com.
