const record = require('../helps/record');
const ChainsData = require('../helps/chains');

Number.prototype.toAddress = function () {
    const hexStr = ethers.BigNumber.from(Number(this)).toHexString().slice(2);
    const pad = 40 - hexStr.length;
    return `0x${'0'.repeat(pad)}${hexStr}`;
}
String.prototype.toAddress = Number.prototype.toAddress;

function ContractAt(Contract, address) {
    return ethers.getSigners().then(
        account => ethers.getContractAt(
            Contract,
            address,
            account[0]
        )
    );
}

const u1e17 = ethers.utils.parseUnits('0.1', 18);
const GasFixFee = {
    "BSC": [u1e17],
    "HECO": [u1e17],
    "OEC": [u1e17],
    "POLYGON": [u1e17],
    "ARBITRUM": [u1e17]
}

const func = async function (hre) {
    const { deployments, ethers } = hre;
    const { deploy } = deployments;
    const { getChainId } = hre;
    hre.chainId = await getChainId();

    const accounts = await ethers.getSigners();
    const deployAcc = accounts[0].address;
    console.log(deployAcc);

    const Deployed = record(hre.Record);
    //const tokens = ChainsData(hre.Tokens);

    const chains = ChainsData(hre.Chains);

    const configC = await ContractAt('Config', Deployed.Config);

    const remotePolyIds = Object.keys(Deployed.Gateways);
    const gases = remotePolyIds.map(polyId => GasFixFee[chains._polyToName(polyId)]);
    console.log(remotePolyIds, gases);
    //return;
    for (let polyId of remotePolyIds) {
        console.log(polyId)
        console.log("price:", polyId, await configC.crossFee(polyId))
    }
    //await configC.setCrossFee(remotePolyIds, gases.map(g => g[0]));
};

module.exports = func;
func.tags = ['FixedGas'];