const { EthWeb3 } = require('./ethWeb3');
const Web3 = require('web3');
const Gateway = require('../artifacts/contracts/Gateway.sol/Gateway.json');
const Vault = require('../artifacts/contracts/Vault.sol/Vault.json');

const bn = n => new Web3.utils.BN(n);

const NETENV = 'mainnet';
//BSC->HECO:DAI
const SYMBOL = 'USDT';
const Chains = [
    {
        net: 'polygon',
        tx: '0x6a6c53fd9fc9ae2b709605bfef71d5f4e75b026f516bc882a65d944ae580981e'
    },
    {
        net: 'arbitrum'
    }
]

const networks = require('../networks.json')[NETENV];
const chainFile = `chains_${NETENV}.json`;
const recordFile = `record_${NETENV}.json`;
const chainConfig = require('../helps/chains');
const records = require('../helps/record');

const CrossTransferTopic = '0x34f724ddc8a8cef32aa7b72109150fe6f1e80cabdc83b19f90605a103d877a9e';
const CrossTransferTypes = ['uint256', 'address', 'uint256', 'uint256', 'int256'];
const CrossTransferWithDataTopic = '0xa9b6efdb260eb3884044ffa6b8d3fd27a0775f552c93586245268b1623b44af0';
const CrossTransferWithDataTypes = ['uint256', 'address', 'uint256', 'uint256', 'int256', 'address', 'bytes'];
const PolyTopic = '0x6ad3bf15c1988bc04bc153490cab16db8efb9a3990215bf1c64ea6e28be88483';

async function newChain(name) {
    name = name.toLowerCase();
    name = name == 'oec' ? 'ok' : name;
    const network = networks[name];
    const chain = new EthWeb3(network.url);
    const chainId = await chain.web3.eth.getChainId();
    console.log("chaihnId:", chainId)
    chain.config = chainConfig(chainFile, chainId);
    chain.record = records(recordFile, undefined, undefined, chainId);
    chain.chainId = chainId;
    chain.polyId = chain.config.polyId;
    console.log(name, chainId, network.chainId, chain.polyId);
    return chain;
}

//const PolyTopic = '0x6ad3bf15c1988bc04bc153490cab16db8efb9a3990215bf1c64ea6e28be88483';

const ContractAt = (chain, abi, address) => {
    const contract = chain.ContractAt(abi, address);
    contract.address = address;
    return contract;
}

async function main() {
    const fromIndex = 0;
    const toIndex = 1;
    const srcChain = await newChain(Chains[fromIndex].net);
    const destChain = await newChain(Chains[toIndex].net);
    const fromReceipt = await srcChain.web3.eth.getTransactionReceipt(Chains[fromIndex].tx);

    let srcData;
    const CrossLog = fromReceipt.logs.find(log => [CrossTransferTopic, CrossTransferWithDataTopic].includes(log.topics[0]));
    const isCrossData = Number(CrossLog.topics[1]) > 1e18;
    let srcLogs;
    console.log('isCrossData:', isCrossData)
    if (isCrossData) {
        const CrossTransferWithDataABI = Gateway.abi.find(item => item.type == 'event' && item.name == 'CrossTransferWithData').inputs;
        srcLogs = srcChain.web3.eth.abi.decodeLog(CrossTransferWithDataABI, CrossLog.data, CrossLog.topics.slice(1));
        // crossId, to, metaAmount, metaFee, _feeFlux, from, data
        srcData = srcChain.web3.eth.abi.encodeParameters(CrossTransferWithDataTypes, [
            srcLogs.crossId,
            srcLogs.to,
            srcLogs.amount,
            srcLogs.fee,
            srcLogs.feeFlux,
            srcLogs.from,
            srcLogs.extData,
        ]);
    }
    else {
        const CrossTransferABI = Gateway.abi.find(item => item.type == 'event' && item.name == 'CrossTransfer').inputs;
        srcLogs = srcChain.web3.eth.abi.decodeLog(CrossTransferABI, CrossLog.data, CrossLog.topics.slice(1));
        srcData = srcChain.web3.eth.abi.encodeParameters(CrossTransferTypes, [
            srcLogs.crossId,
            srcLogs.to,
            srcLogs.amount,
            srcLogs.fee,
            srcLogs.feeFlux
        ]);
    }
    srcInput = srcData.slice(2);

    const srcR = isCrossData ?
        srcChain.web3.eth.abi.decodeParameters(['uint256', 'address', 'uint256', 'uint256', 'int256', 'address', 'bytes'], srcInput)
        : srcChain.web3.eth.abi.decodeParameters(['uint256', 'address', 'uint256', 'uint256', 'int256'], srcInput);

    const srcHash = srcChain.web3.utils.keccak256(`0x${srcInput}`);
    console.log('----SrcHash: ', srcHash);
    console.log('srcR: ', srcR);
    console.log('src:', Number(srcR[2]) / 1e18, Number(srcR[3]) / 1e18, Number(srcR[4]) / 1e18)

    const destGatewayAddress = destChain.record._path(['Gateways', srcChain.polyId, SYMBOL])
    console.log('destGateway:', destGatewayAddress);

    const gateway = ContractAt(destChain, Gateway.abi, destGatewayAddress);

    const confirms = bn(await gateway.methods.crossConfirms(srcHash).call());
    console.log('confirms:', srcHash, confirms.toString(16));

    const srcGateway = srcChain.record._path(['Gateways', destChain.polyId, SYMBOL]);
    console.log('srcGateway:', srcGateway);
    if (true || confirms == 1) {
        console.log('need confirm')
        const CONFIRM_THRESHOLD = await gateway.methods.CONFIRM_THRESHOLD().call();
        console.log('CONFIRM_THRESHOLD:', CONFIRM_THRESHOLD);
        const r = await gateway.methods.onCrossTransferExecute(`0x${srcInput}`).call({ gasLimit: 4000000 });
        console.log(r)
        //const tx = await gateway.methods.onCrossTransferByHotpoter(`0x${srcInput}`, srcGateway, srcChain.polyId);
        //const r = await gateway.eweb3.sendTx(tx, { gas: 1000000 });
        //console.log('second confirm:', r);
    }
    /*
        const vaultAddress = destChain.record._path(['Vaults', SYMBOL]);
        const vault = ContractAt(destChain, Vault.abi, vaultAddress);
        console.log("vault:", await gateway.methods.vault().call(), vaultAddress);
        console.log("ftoken:", await vault.methods.ftoken().call());
        r = await gateway.methods.onCrossTransferExecute(`0x${srcInput}`).call();
    */
}

main();