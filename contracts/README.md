# Yorse Escrow (Foundry)

`src/Escrow.sol` holds Circle testnet USDC (`0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`, 6 decimals) per job on **Arbitrum Sepolia (421614) only**.

State machine (only the relayer moves a job past `Funded`):

```
fund() [client]           None      -> Funded
markSubmitted() [relayer] Funded    -> Submitted
release() [relayer]       Submitted -> Released          (AI pass, confidence >= 0.85)
dispute() [relayer]       Submitted -> Disputed          (AI dispute / low confidence)
                          Funded    -> Disputed          (non-delivery escape hatch)
release() [relayer]       Disputed  -> ResolvedRelease   (admin decision)
refund()  [relayer]       Disputed  -> ResolvedRefund    (admin decision)
```

## Commands

```bash
./install-deps.sh               # restores lib/ (OpenZeppelin + forge-std); gitignored, so run this after cloning
cp .env.example .env            # fill RELAYER_PRIVATE_KEY etc. — never commit .env
forge test -vv                  # fork tests against real Circle USDC (no mock token)
forge script script/Deploy.s.sol --rpc-url arbitrum_sepolia --broadcast
# put the printed address in ESCROW_ADDRESS, then:
forge script script/Smoke.s.sol  --rpc-url arbitrum_sepolia --broadcast --slow
```

Both scripts refuse to run on any chain other than 421614.
The smoke script needs the relayer wallet to hold Arbitrum Sepolia ETH and at least `3 * SMOKE_AMOUNT` USDC from https://faucet.circle.com.
