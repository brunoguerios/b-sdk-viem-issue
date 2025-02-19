import {
    Address,
    Client,
    TestActions,
    TransactionReceipt,
    concat,
    keccak256,
    maxUint256,
    maxUint160,
    maxUint48,
    pad,
    toBytes,
    toHex,
    erc20Abi,
    WalletClient,
    PublicActions,
} from "viem";

import { permit2Abi } from "./permit2Abi";

export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

export type PublicWalletClient = WalletClient & PublicActions;

export type TxOutput = {
    transactionReceipt: TransactionReceipt;
    balanceDeltas: bigint[];
    gasUsed: bigint;
};

export const hasApprovedToken = async (
    client: PublicWalletClient,
    account: Address,
    token: Address,
    spender: Address,
    amount = maxUint256
): Promise<boolean> => {
    const allowance = await client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, spender],
    });

    const hasApproved = allowance >= amount;
    return hasApproved;
};

export const hasApprovedTokenOnPermit2 = async (
    client: PublicWalletClient,
    account: Address,
    token: Address,
    spender: Address,
    amount = maxUint160
): Promise<boolean> => {
    const chainId = await client.getChainId();
    const [allowance, ,] = await client.readContract({
        address: PERMIT2,
        abi: permit2Abi,
        functionName: "allowance",
        args: [account, token, spender],
    });

    const hasApproved = allowance >= amount;
    return hasApproved;
};

export const approveSpenderOnTokens = async (
    client: PublicWalletClient,
    accountAddress: Address,
    tokens: Address[],
    spender: Address,
    amounts?: bigint[]
): Promise<boolean> => {
    const approvals: boolean[] = [];
    for (let i = 0; i < tokens.length; i++) {
        const approved = await approveSpenderOnToken(
            client,
            accountAddress,
            tokens[i],
            spender,
            amounts ? amounts[i] : undefined
        );
        approvals.push(approved);
    }
    return approvals.every((approved) => approved);
};

export const approveSpenderOnToken = async (
    client: PublicWalletClient,
    account: Address,
    token: Address,
    spender: Address,
    amount = maxUint256 // approve max by default
): Promise<boolean> => {
    let approved = await hasApprovedToken(
        client,
        account,
        token,
        spender,
        amount
    );

    if (!approved) {
        // approve token on the vault
        await client.writeContract({
            account,
            chain: client.chain,
            address: token,
            abi: erc20Abi,
            functionName: "approve",
            args: [spender, amount],
        });

        approved = await hasApprovedToken(
            client,
            account,
            token,
            spender,
            amount
        );
    }

    return approved;
};

export const approveSpenderOnPermit2 = async (
    client: PublicWalletClient,
    account: Address,
    token: Address,
    spender: Address,
    amount = maxUint160, // approve max by default
    deadline = maxUint48 // approve max by default
): Promise<boolean> => {
    let approved = await hasApprovedTokenOnPermit2(
        client,
        account,
        token,
        spender,
        amount
    );

    if (!approved) {
        await client.writeContract({
            account,
            chain: client.chain,
            address: PERMIT2,
            abi: permit2Abi,
            functionName: "approve",
            args: [token, spender, amount, Number(deadline)],
        });

        approved = await hasApprovedTokenOnPermit2(
            client,
            account,
            token,
            spender,
            amount
        );
    }

    return approved;
};

/**
 * Set local ERC20 token balance for a given account address (used for testing)
 *
 * @param client client that will perform the setStorageAt call
 * @param accountAddress Account address that will have token balance set
 * @param token Token address which balance will be set
 * @param slot Slot memory that stores balance - use npm package `slot20` to identify which slot to provide
 * @param balance Balance in EVM amount
 * @param isVyperMapping Whether the storage uses Vyper or Solidity mapping
 */
export const setTokenBalance = async (
    client: Client & TestActions,
    accountAddress: Address,
    token: Address,
    slot: number,
    balance: bigint,
    isVyperMapping = false
): Promise<void> => {
    // Get storage slot index

    const slotBytes = pad(toBytes(slot));
    const accountAddressBytes = pad(toBytes(accountAddress));

    let index: Address;
    if (isVyperMapping) {
        index = keccak256(concat([slotBytes, accountAddressBytes])); // slot, key
    } else {
        index = keccak256(concat([accountAddressBytes, slotBytes])); // key, slot
    }

    // Manipulate local balance (needs to be bytes32 string)
    await client.setStorageAt({
        address: token,
        index,
        value: toHex(balance, { size: 32 }),
    });
};

/**
 * Set local ERC20 token balance for a given account address (used for testing)
 *
 * @param client client that will perform the setStorageAt call
 * @param accountAddress Account address that will have token balance set
 * @param tokens Token addresses which balance will be set
 * @param slots Slot memories that stores balance - use npm package `slot20` to identify which slot to provide
 * @param balances Balances in EVM amount
 * @param isVyperMapping Whether the storage uses Vyper or Solidity mapping
 */
export const setTokenBalances = async (
    client: Client & TestActions,
    accountAddress: Address,
    tokens: Address[],
    slots: number[],
    balances: bigint[],
    isVyperMapping: boolean[] = Array(tokens.length).fill(false)
): Promise<void> => {
    for (let i = 0; i < tokens.length; i++) {
        await setTokenBalance(
            client,
            accountAddress,
            tokens[i],
            slots[i],
            balances[i],
            isVyperMapping[i]
        );
    }
};
