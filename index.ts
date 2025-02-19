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
import { BALANCER_ROUTER, USDT, stataUSDT, USDC } from "./constants";
config();

const forkUrl = process.env.FORK_URL;

const anvil = createAnvil({
    forkUrl,
    forkBlockNumber: 7655008n,
});

await anvil.start();

const client = createTestClient({
    mode: "anvil",
    chain: sepolia,
    transport: http(`http://${anvil.host}:${anvil.port}`),
})
    .extend(publicActions)
    .extend(walletActions);

// setup testAddress via setStorate or impersonate
const testAddress = await setupTestAddress("impersonate");

// approve tokens to be spent
await approveTokens();

// setup transaction data
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

        console.log("\n\n");
        console.log("-- SIMULATION SUCCEEDS even though transaction fails --");
        console.log("simulation result: ", result);
        console.log("\n\n");

        await anvil.stop();
        throw new Error("failed transaction");
    }
}

await anvil.stop();

// helper functions

async function setupTestAddress(
    option: "impersonate" | "setStorage"
): Promise<Address> {
    let testAddress: Address;
    if (option === "impersonate") {
        testAddress = "0x75D06bae37a9c349142fE7cee77804900b1C0EC3";
        await client.impersonateAccount({
            address: testAddress,
        });
    } else {
        testAddress = (await client.getAddresses())[0];
        await setTokenBalances(
            client,
            testAddress,
            [USDT.address, USDC.address],
            [USDT.slot, USDC.slot] as number[],
            [
                parseUnits("1000", USDT.decimals),
                parseUnits("1000", USDC.decimals),
            ]
        );
    }
    return testAddress;
}

async function approveTokens() {
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
}
