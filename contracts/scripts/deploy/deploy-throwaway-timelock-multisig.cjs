/**
 * Deploy throwaway testnet ton-multisig-v2 (2-of-3) + Order librarian for lab
 * Timelock.governor rehearsal. Expects compiled artifacts under
 * F:/Projects/_tmp-multisig-v2/build (or MULTISIG_V2_BUILD).
 *
 * Usage (from contracts/):
 *   node -r dotenv/config scripts/deploy/deploy-throwaway-timelock-multisig.cjs dotenv_config_path=.env.testnet
 */
const { readFileSync, existsSync } = require('fs');
const path = require('path');
const { mnemonicToPrivateKey } = require('@ton/crypto');
const {
    Address,
    beginCell,
    Cell,
    contractAddress,
    Dictionary,
    internal,
    SendMode,
    toNano,
    TonClient,
    WalletContractV5R1,
} = require('@ton/ton');

function requireEnv(key) {
    const v = process.env[key]?.trim();
    if (!v) throw new Error(`missing ${key}`);
    return v;
}

function buildDir() {
    const candidates = [
        process.env.MULTISIG_V2_BUILD?.trim(),
        path.resolve(__dirname, '../../../../_tmp-multisig-v2/build'),
        path.resolve(process.cwd(), '../_tmp-multisig-v2/build'),
        'F:/Projects/_tmp-multisig-v2/build',
    ].filter(Boolean);
    for (const d of candidates) {
        if (existsSync(d)) return d;
    }
    throw new Error(
        'multisig-v2 build dir missing — clone ton-blockchain/multisig-contract-v2, ' +
            '`npx blueprint build` Multisig/Order/Librarian, set MULTISIG_V2_BUILD',
    );
}

function loadCompiledHex(name) {
    const j = JSON.parse(readFileSync(path.join(buildDir(), `${name}.compiled.json`), 'utf8'));
    return Cell.fromBoc(Buffer.from(j.hex, 'hex'))[0];
}

function arrayToCell(arr) {
    let dict = Dictionary.empty(Dictionary.Keys.Uint(8), Dictionary.Values.Address());
    for (let i = 0; i < arr.length; i++) dict.set(i, arr[i]);
    return dict;
}

function multisigConfigToCell(config) {
    return beginCell()
        .storeUint(0, 256)
        .storeUint(config.threshold, 8)
        .storeRef(beginCell().storeDictDirect(arrayToCell(config.signers)).endCell())
        .storeUint(config.signers.length, 8)
        .storeDict(arrayToCell(config.proposers))
        .storeBit(config.allowArbitrarySeqno)
        .endCell();
}

async function sleep(ms) {
    await new Promise((r) => setTimeout(r, ms));
}

async function waitSeqno(opened, prev) {
    for (let i = 0; i < 40; i++) {
        const n = await opened.getSeqno();
        if (n > prev) return n;
        await sleep(2500);
    }
    return opened.getSeqno();
}

async function waitActive(client, address, label, attempts = 40) {
    for (let i = 0; i < attempts; i++) {
        const st = await client.getContractState(address);
        if (st.state === 'active') {
            console.log(`${label} active:`, address.toString({ urlSafe: true, bounceable: true }));
            return;
        }
        await sleep(3000);
    }
    throw new Error(`${label} not active after wait: ${address.toString()}`);
}

async function main() {
    const mnemonic = requireEnv('WALLET_MNEMONIC');
    const apiKey =
        process.env.TONCENTER_API_KEY_TESTNET?.trim() || process.env.TONCENTER_API_KEY?.trim();
    const client = new TonClient({
        endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
        apiKey,
    });

    const key = await mnemonicToPrivateKey(mnemonic.trim().split(/\s+/));
    const wallet = WalletContractV5R1.create({
        publicKey: key.publicKey,
        walletId: {
            networkGlobalId: Number(process.env.WALLET_NETWORK_ID ?? '-3'),
            context: {
                workchain: 0,
                subwalletNumber: Number(process.env.SUBWALLET_NUMBER ?? '0'),
                walletVersion: 'v5r1',
            },
        },
    });
    const opened = client.open(wallet);
    console.log('deployer', wallet.address.toString({ urlSafe: true, bounceable: false }));

    const threshold = Number(process.env.MULTISIG_THRESHOLD ?? '2');
    const signers = [
        Address.parse(requireEnv('MULTISIG_SIGNER_1_ADDRESS')),
        Address.parse(requireEnv('MULTISIG_SIGNER_2_ADDRESS')),
        Address.parse(requireEnv('MULTISIG_SIGNER_3_ADDRESS')),
    ];

    const multisigCode = loadCompiledHex('Multisig');
    const data = multisigConfigToCell({
        threshold,
        signers,
        proposers: [],
        allowArbitrarySeqno: true,
    });
    const init = { code: multisigCode, data };
    const multisigAddr = contractAddress(0, init);
    console.log(
        'Multisig address (predicted):',
        multisigAddr.toString({ urlSafe: true, bounceable: true }),
    );

    const orderCode = loadCompiledHex('Order');
    const librarianCode = loadCompiledHex('Librarian');
    const librarianInit = { code: librarianCode, data: orderCode };
    const librarianAddr = contractAddress(-1, librarianInit);
    console.log(
        'Librarian address (predicted):',
        librarianAddr.toString({ urlSafe: true, bounceable: true }),
    );

    const libState = await client.getContractState(librarianAddr);
    if (libState.state !== 'active') {
        console.log('Deploying Order librarian (~10 TON)...');
        const seqno = await opened.getSeqno();
        await opened.sendTransfer({
            seqno,
            secretKey: key.secretKey,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            messages: [
                internal({
                    to: librarianAddr,
                    value: toNano('10'),
                    init: librarianInit,
                    bounce: false,
                    body: beginCell().endCell(),
                }),
            ],
        });
        await waitSeqno(opened, seqno);
        await waitActive(client, librarianAddr, 'Librarian');
    } else {
        console.log('Librarian already active');
    }

    const msState = await client.getContractState(multisigAddr);
    if (msState.state !== 'active') {
        console.log('Deploying Multisig (0.2 TON)...');
        const seqno = await opened.getSeqno();
        await opened.sendTransfer({
            seqno,
            secretKey: key.secretKey,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            messages: [
                internal({
                    to: multisigAddr,
                    value: toNano('0.2'),
                    init,
                    bounce: false,
                    body: beginCell().storeUint(0, 32).storeUint(0, 64).endCell(),
                }),
            ],
        });
        await waitSeqno(opened, seqno);
        await waitActive(client, multisigAddr, 'Multisig');
    } else {
        console.log('Multisig already active');
    }

    console.log('Funding Multisig with 1.5 TON...');
    const seqno2 = await opened.getSeqno();
    await opened.sendTransfer({
        seqno: seqno2,
        secretKey: key.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        messages: [
            internal({
                to: multisigAddr,
                value: toNano('1.5'),
                bounce: true,
                body: beginCell().endCell(),
            }),
        ],
    });
    await waitSeqno(opened, seqno2);
    const bal = await client.getBalance(multisigAddr);
    console.log('Multisig balance TON', Number(bal) / 1e9);
    console.log(
        'TIMELOCK_GOVERNOR=' + multisigAddr.toString({ urlSafe: true, bounceable: true }),
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
