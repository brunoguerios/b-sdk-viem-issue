import {
    Address,
    createTestClient,
    encodeFunctionData,
    erc4626Abi,
    http,
    parseUnits,
    publicActions,
    TransactionReceipt,
    walletActions,
} from "viem";
import { sepolia } from "viem/chains";
import {
    approveSpenderOnPermit2,
    approveSpenderOnTokens,
    setTokenBalances,
    PERMIT2,
} from "./helper";
import { boostedPool_USDC_USDT } from "./mockData";
import { balancerRouterAbi } from "./balancerRouterAbi";
import { createAnvil } from "@viem/anvil";
import { config } from "dotenv";
config();

const BALANCER_ROUTER = "0x6A20a4b6DcFF78e6D21BF0dbFfD58C96644DB9cb";

const USDC = {
    address: "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8" as Address,
    decimals: 6,
    slot: 0,
};
const USDT = {
    address: "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0" as Address,
    decimals: 6,
    slot: 0,
};
const stataUSDT = {
    address: "0x978206fae13faf5a8d293fb614326b237684b750" as Address,
    decimals: 6,
    slot: 0,
};

const forkUrl = process.env.FORK_URL;

const anvil = createAnvil({
    // All anvil options are supported & typed.
    forkUrl,
    forkBlockNumber: 7655008n,
});

await anvil.start();

console.log(`http://${anvil.host}:${anvil.port}`);

const client = createTestClient({
    mode: "anvil",
    chain: sepolia,
    transport: http(`http://${anvil.host}:${anvil.port}`),
})
    .extend(publicActions)
    .extend(walletActions);

const testAddress = (await client.getAddresses())[0];

// set erc20 balances
await setTokenBalances(
    client,
    testAddress,
    [USDT.address, USDC.address],
    [USDT.slot, USDC.slot] as number[],
    [parseUnits("1000", USDT.decimals), parseUnits("1000", USDC.decimals)]
);

// set erc4626 token balance
await approveSpenderOnTokens(
    client,
    testAddress,
    [USDT.address],
    stataUSDT.address
);
await client.writeContract({
    account: testAddress,
    chain: sepolia,
    abi: erc4626Abi,
    address: stataUSDT.address,
    functionName: "deposit",
    args: [parseUnits("1000", USDT.decimals), testAddress],
});

// approve Permit2 to spend users DAI/USDC, does not include the sub approvals
await approveSpenderOnTokens(
    client,
    testAddress,
    [USDC.address, stataUSDT.address],
    PERMIT2
);

// Here we approve the Vault to spend tokens on the users behalf via Permit2
for (const token of boostedPool_USDC_USDT.tokens) {
    await approveSpenderOnPermit2(
        client,
        testAddress,
        token.address as Address,
        BALANCER_ROUTER
    );

    if (token.underlyingToken) {
        await approveSpenderOnPermit2(
            client,
            testAddress,
            token.underlyingToken.address as Address,
            BALANCER_ROUTER
        );
    }
}

const args = [
    "0x59fa488dda749cdd41772bb068bb23ee955a6d7a",
    [true, false],
    [1000000n, 2000000n],
    3591628586272439166n,
    false,
    "0x",
] as const;

const data = encodeFunctionData({
    abi: balancerRouterAbi,
    functionName: "addLiquidityUnbalancedToERC4626Pool",
    args,
});

const to = BALANCER_ROUTER;

for (let i = 0; i < 100; i++) {
    console.log("i", i);

    const hash = await client.sendTransaction({
        account: testAddress,
        chain: sepolia,
        data,
        to,
        value: 0n,
    });

    const transactionReceipt = (await client.waitForTransactionReceipt({
        hash,
    })) as TransactionReceipt;

    if (transactionReceipt.status === "success") {
        console.log("success");
    } else {
        const { result } = await client.simulateContract({
            account: testAddress,
            address: to,
            abi: balancerRouterAbi,
            functionName: "addLiquidityUnbalancedToERC4626Pool",
            args,
        });
        console.log("result: ", result);
        await anvil.stop();
        throw new Error("failed transaction");
    }
}

await anvil.stop();

const blockNumber = await client.getBlockNumber();

console.log(blockNumber);
